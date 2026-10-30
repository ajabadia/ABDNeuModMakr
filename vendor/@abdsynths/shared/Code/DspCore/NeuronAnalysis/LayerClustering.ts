// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — LayerClustering (TypeScript Port of C++ LayerClustering.h)
//
// Phase 11.2 spec: clusters harmonic partial traces (n = 1..64) into up to
// 3 layers based on temporal envelope shape (support fraction & temporal entropy
// or envelope cosine), with medoid refinement, degeneracy guard, and
// persistence ordering (Layer 0 = most persistent body/drone).
// ─────────────────────────────────────────────────────────

export type LayerMetric = 'descriptors' | 'envelope-cosine';

export const LAYER_CLUSTERING_CONSTANTS = {
  kMaxTraces: 64,
  kMaxLayers: 3,
  kMaxFrames: 16,
  kActivityFloor: 1.0e-3,
  kMinActiveFrames: 2,
  kAffinityCut: 0.55,
  kEnvelopeCosineCut: 0.60,
  kMinLayerTraces: 2,
  kMinLayerEnergy: 0.10,
  kPersistentSupport: 0.75,
  kSupportWeight: 2.0,
} as const;

export interface LayerClusteringResult {
  layerCount: number;
  /** Per-partial layer assignment (0..layerCount-1; 0 for inactive) */
  layerOfTrace: Int32Array;
  /** Sum of amplitudes per layer */
  layerEnergy: Float32Array;
  /** Count of active partials per layer */
  layerTraces: Int32Array;
  /** Whether partial t has >= kMinActiveFrames active frames */
  active: boolean[];
  /** Active frames / total frames per partial (0..1) */
  supportFraction: Float32Array;
  /** Normalized temporal entropy per partial (0..1) */
  entropy: Float32Array;
}

export function createEmptyLayerClustering(): LayerClusteringResult {
  return {
    layerCount: 1,
    layerOfTrace: new Int32Array(LAYER_CLUSTERING_CONSTANTS.kMaxTraces),
    layerEnergy: new Float32Array(LAYER_CLUSTERING_CONSTANTS.kMaxLayers),
    layerTraces: new Int32Array(LAYER_CLUSTERING_CONSTANTS.kMaxLayers),
    active: new Array<boolean>(LAYER_CLUSTERING_CONSTANTS.kMaxTraces).fill(false),
    supportFraction: new Float32Array(LAYER_CLUSTERING_CONSTANTS.kMaxTraces),
    entropy: new Float32Array(LAYER_CLUSTERING_CONSTANTS.kMaxTraces),
  };
}

/**
 * Cosine similarity between two temporal envelopes of length `numFrames`.
 */
export function envelopeCosine(
  traces: Float32Array,
  offsetA: number,
  offsetB: number,
  numFrames: number
): number {
  let dot = 0.0;
  let na = 0.0;
  let nb = 0.0;

  for (let f = 0; f < numFrames; f++) {
    const a = traces[offsetA + f];
    const b = traces[offsetB + f];
    dot += a * b;
    na += a * a;
    nb += b * b;
  }

  if (na <= 0.0 || nb <= 0.0) return 0.0;
  return Math.max(0.0, Math.min(1.0, dot / Math.sqrt(na * nb)));
}

/**
 * Descriptor affinity: 1 - weighted Euclidean distance in (supportFraction, entropy) plane.
 */
export function descriptorAffinity(
  c: LayerClusteringResult,
  traceA: number,
  traceB: number
): number {
  const ds = c.supportFraction[traceA] - c.supportFraction[traceB];
  const dh = c.entropy[traceA] - c.entropy[traceB];
  const dist = Math.sqrt(LAYER_CLUSTERING_CONSTANTS.kSupportWeight * ds * ds + dh * dh);
  return Math.max(0.0, Math.min(1.0, 1.0 - dist));
}

/**
 * Clusters harmonic partial traces by temporal envelope shape.
 * @param traces Row-major matrix [numTraces * numFrames]: `traces[t * numFrames + f]`
 */
export function clusterTraces(
  traces: Float32Array,
  numTraces: number,
  numFrames: number,
  floor: number = LAYER_CLUSTERING_CONSTANTS.kActivityFloor,
  metric: LayerMetric = 'descriptors'
): LayerClusteringResult {
  const out = createEmptyLayerClustering();
  const n = Math.max(0, Math.min(LAYER_CLUSTERING_CONSTANTS.kMaxTraces, numTraces));
  const frames = Math.max(0, Math.min(LAYER_CLUSTERING_CONSTANTS.kMaxFrames, numFrames));

  if (traces.length === 0 || n <= 0 || frames < LAYER_CLUSTERING_CONSTANTS.kMinActiveFrames) {
    return out;
  }

  // 1. Descriptors + activity
  const activeIndex: number[] = [];

  for (let t = 0; t < n; t++) {
    const base = t * frames;
    let support = 0;
    let sum = 0.0;

    for (let f = 0; f < frames; f++) {
      const val = traces[base + f];
      if (val >= floor) {
        support++;
        sum += val;
      }
    }

    out.supportFraction[t] = support / frames;

    let h = 0.0;
    if (support > 1 && sum > 0.0) {
      let acc = 0.0;
      for (let f = 0; f < frames; f++) {
        const val = traces[base + f];
        if (val >= floor) {
          const p = val / sum;
          acc -= p * Math.log(p);
        }
      }
      h = acc / Math.log(support);
    }

    out.entropy[t] = h;
    const isAct = support >= LAYER_CLUSTERING_CONSTANTS.kMinActiveFrames;
    out.active[t] = isAct;
    if (isAct) {
      activeIndex.push(t);
    }
  }

  const m = activeIndex.length;
  if (m < LAYER_CLUSTERING_CONSTANTS.kMinLayerTraces) {
    return out;
  }

  const affinity = (i: number, j: number): number => {
    const ta = activeIndex[i];
    const tb = activeIndex[j];
    if (metric === 'envelope-cosine') {
      return envelopeCosine(traces, ta * frames, tb * frames, frames);
    }
    return descriptorAffinity(out, ta, tb);
  };

  const traceEnergy = (i: number): number => {
    const base = activeIndex[i] * frames;
    let e = 0.0;
    for (let f = 0; f < frames; f++) {
      e += traces[base + f];
    }
    return e;
  };

  // 2. Agglomerative average-linkage clustering until below cut
  let clusters: number[][] = [];
  for (let i = 0; i < m; i++) {
    clusters.push([i]);
  }

  const averageAffinity = (a: number[], b: number[]): number => {
    let acc = 0.0;
    let count = 0;
    for (const i of a) {
      for (const j of b) {
        acc += affinity(i, j);
        count++;
      }
    }
    return count > 0 ? acc / count : 0.0;
  };

  const mergeBestPair = (cut: number): boolean => {
    let best = -1.0;
    let bi = -1;
    let bj = -1;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = averageAffinity(clusters[i], clusters[j]);
        if (a > best) {
          best = a;
          bi = i;
          bj = j;
        }
      }
    }

    if (bi < 0 || best < cut) return false;

    clusters[bi].push(...clusters[bj]);
    clusters.splice(bj, 1);
    return true;
  };

  const cut =
    metric === 'envelope-cosine'
      ? LAYER_CLUSTERING_CONSTANTS.kEnvelopeCosineCut
      : LAYER_CLUSTERING_CONSTANTS.kAffinityCut;

  while (mergeBestPair(cut)) {
    // merge until below cut
  }

  // 3. Medoid refinement (up to 4 iterations)
  for (let iter = 0; iter < 4; iter++) {
    const medoid = new Array<number>(clusters.length).fill(0);

    for (let c = 0; c < clusters.length; c++) {
      let bestSum = -1.0;
      for (const member of clusters[c]) {
        let acc = 0.0;
        for (const other of clusters[c]) {
          acc += affinity(member, other);
        }
        if (acc > bestSum) {
          bestSum = acc;
          medoid[c] = member;
        }
      }
    }

    const next: number[][] = Array.from({ length: clusters.length }, () => []);
    let moved = false;

    for (let c = 0; c < clusters.length; c++) {
      for (const member of clusters[c]) {
        let best = -1.0;
        let bestCluster = c;
        for (let d = 0; d < clusters.length; d++) {
          const a = affinity(member, medoid[d]);
          if (a > best) {
            best = a;
            bestCluster = d;
          }
        }
        next[bestCluster].push(member);
        if (bestCluster !== c) moved = true;
      }
    }

    clusters = next.filter((c) => c.length > 0);
    if (!moved) break;
  }

  // 4. Clamp to kMaxLayers
  while (clusters.length > LAYER_CLUSTERING_CONSTANTS.kMaxLayers) {
    if (!mergeBestPair(-1.0)) break;
  }

  // 5. Degeneracy guard
  interface OrderedCluster {
    energy: number;
    members: number[];
  }

  const ordered: OrderedCluster[] = clusters.map((c) => {
    let e = 0.0;
    for (const i of c) e += traceEnergy(i);
    return { energy: e, members: [...c] };
  });

  const sortByEnergy = () => {
    ordered.sort((a, b) => b.energy - a.energy);
  };
  sortByEnergy();

  const meanSupport = (cluster: number[]): number => {
    if (cluster.length === 0) return 0.0;
    let acc = 0.0;
    for (const i of cluster) {
      acc += out.supportFraction[activeIndex[i]];
    }
    return acc / cluster.length;
  };

  if (
    ordered.length > 0 &&
    ordered[0].members.length < LAYER_CLUSTERING_CONSTANTS.kMinLayerTraces
  ) {
    return out;
  }

  let changed = true;
  while (changed && ordered.length > 1) {
    changed = false;
    let total = 0.0;
    for (const layer of ordered) total += layer.energy;

    for (let c = 1; c < ordered.length && !changed; c++) {
      const thin = ordered[c].members.length < LAYER_CLUSTERING_CONSTANTS.kMinLayerTraces;
      const weak =
        ordered[c].energy < LAYER_CLUSTERING_CONSTANTS.kMinLayerEnergy * total &&
        meanSupport(ordered[c].members) < LAYER_CLUSTERING_CONSTANTS.kPersistentSupport;

      if (!(thin || weak)) continue;

      let best = -1.0;
      let bestC = 0;
      for (let d = 0; d < ordered.length; d++) {
        if (d === c) continue;
        const a = averageAffinity(ordered[c].members, ordered[d].members);
        if (a > best) {
          best = a;
          bestC = d;
        }
      }

      ordered[bestC].members.push(...ordered[c].members);
      ordered[bestC].energy += ordered[c].energy;
      ordered.splice(c, 1);
      changed = true;
    }

    sortByEnergy();
  }

  // 6. Order by persistence (support fraction), tie-break by energy
  ordered.sort((a, b) => {
    const sa = meanSupport(a.members);
    const sb = meanSupport(b.members);
    if (Math.abs(sa - sb) > 1e-6) return sb - sa;
    return b.energy - a.energy;
  });

  // 7. Populate output
  out.layerCount = ordered.length;
  for (let l = 0; l < out.layerCount; l++) {
    out.layerEnergy[l] = ordered[l].energy;
    out.layerTraces[l] = ordered[l].members.length;
    for (const i of ordered[l].members) {
      out.layerOfTrace[activeIndex[i]] = l;
    }
  }

  return out;
}
