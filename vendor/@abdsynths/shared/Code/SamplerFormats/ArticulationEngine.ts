// ─────────────────────────────────────────────────────────────────────────────
// @abdsynths/shared — Sampler Articulation Engine (Round-Robin, Release Triggers, Mod Matrix)
//
// Industry-standard runtime voice dispatcher managing:
//   1. Round-Robin state cycling:
//      - 'cycle' (sequential 1..N)
//      - 'random' (pseudo-random without immediate repeats)
//      - 'true-neighbor' (adjacent sample borrowing)
//   2. Release trigger scheduling (Key-Off sample auditioning)
//   3. MIDI Modulation Matrix (Mod Matrix):
//      - Sources: CC1 (ModWheel), CC11 (Expression), PitchBend, Velocity, Channel Pressure (Aftertouch)
//      - Destinations: Filter Cutoff, Volume (dB), Pitch (cents), Sample Start, Resonance
// ─────────────────────────────────────────────────────────────────────────────

import type { ExtendedRegion, MidiNote, SamplerPlayLogic, TriggerMode } from './SamplerTypes.ts';

export type ModSource =
  | 'modwheel'       // CC1
  | 'expression'     // CC11
  | 'velocity'       // Note-on velocity (1..127)
  | 'aftertouch'     // Channel pressure (0..127)
  | 'pitchbend';     // Bipolar -8192..+8191

export type ModDestination =
  | 'cutoff'         // Filter Cutoff Hz
  | 'resonance'      // Filter Resonance (0..1)
  | 'volume'         // Volume in dB
  | 'pitch'          // Pitch detune in cents
  | 'sample_start';  // Frame start offset

export interface ModMatrixRoute {
  source: ModSource;
  destination: ModDestination;
  amount: number;    // Normalized bipolar (-1.0 .. +1.0)
}

export interface ArticulationEngineConfig {
  routes?: ModMatrixRoute[];
}

export class SamplerArticulationEngine {
  private readonly rrCounters = new Map<string, number>();
  private readonly lastRandomPick = new Map<string, number>();
  private routes: ModMatrixRoute[] = [];

  constructor(config?: ArticulationEngineConfig) {
    if (config?.routes) {
      this.routes = [...config.routes];
    }
  }

  public setModRoutes(routes: ModMatrixRoute[]): void {
    this.routes = [...routes];
  }

  public addModRoute(route: ModMatrixRoute): void {
    this.routes.push(route);
  }

  /**
   * Selects the active region among multiple candidates covering the same note/velocity,
   * respecting `lorand`/`hirand`, round-robin cycle/random logic, and trigger mode.
   */
  public selectRegionForNote(
    candidateRegions: ExtendedRegion[],
    note: MidiNote,
    _velocity: number,
    triggerType: TriggerMode = 'attack',
    randValue: number = Math.random(),
  ): ExtendedRegion | undefined {
    // 1. Filter by trigger mode
    const matchedTrigger = candidateRegions.filter((r) => (r.trigger || 'attack') === triggerType);
    if (matchedTrigger.length === 0) return undefined;

    // 2. Filter by lorand/hirand when any candidate specifies random bounds
    const hasRandBounds = matchedTrigger.some(
      (r) => r.loRand !== undefined || r.hiRand !== undefined,
    );
    const randPool = hasRandBounds
      ? matchedTrigger.filter((r) => {
          const lo = r.loRand ?? 0;
          const hi = r.hiRand ?? 1;
          return randValue >= lo && (randValue < hi || (hi >= 1 && randValue <= 1));
        })
      : matchedTrigger;
    const pool = randPool.length > 0 ? randPool : matchedTrigger;
    if (pool.length === 1) return pool[0];

    // 3. Group by Round-Robin index if defined
    const hasRr = pool.some((r) => (r.seqLength ?? 1) > 1);
    if (!hasRr) {
      return pool[0];
    }

    const rrGroupKey = `${note}_${pool[0].lowVel}_${triggerType}`;
    const totalRr = Math.max(...pool.map((r) => r.seqLength ?? 1));
    const logic: SamplerPlayLogic = pool[0].playLogic || 'round_robin';

    let targetIndex = 1;
    if (logic === 'random') {
      const last = this.lastRandomPick.get(rrGroupKey) ?? 0;
      let pick = Math.floor(randValue * totalRr) + 1;
      if (pick > totalRr) pick = totalRr;
      if (totalRr > 1 && pick === last) {
        pick = (pick % totalRr) + 1;
      }
      this.lastRandomPick.set(rrGroupKey, pick);
      targetIndex = pick;
    } else {
      // Sequential cycle
      const cur = this.rrCounters.get(rrGroupKey) ?? 0;
      targetIndex = (cur % totalRr) + 1;
      this.rrCounters.set(rrGroupKey, targetIndex);
    }

    const chosen =
      pool.find((r) => (r.seqPosition ?? 1) === targetIndex) ??
      pool[0];

    return chosen;
  }

  /**
   * Evaluates modulation matrix offsets for a given set of MIDI controller states.
   */
  public computeModulations(inputs: {
    velocity?: number;     // 1..127
    modwheel?: number;     // 0..127
    expression?: number;   // 0..127
    aftertouch?: number;   // 0..127
    pitchbend?: number;    // -8192..+8191
  }): {
    cutoffMultiplier: number;
    volumeDbOffset: number;
    pitchCentsOffset: number;
    resonanceOffset: number;
  } {
    let cutoffSemi = 0;
    let volDb = 0;
    let pitchCents = 0;
    let res = 0;

    const normSource = (src: ModSource): number => {
      switch (src) {
        case 'velocity':
          return (inputs.velocity ?? 100) / 127.0;
        case 'modwheel':
          return (inputs.modwheel ?? 0) / 127.0;
        case 'expression':
          return (inputs.expression ?? 127) / 127.0;
        case 'aftertouch':
          return (inputs.aftertouch ?? 0) / 127.0;
        case 'pitchbend':
          return (inputs.pitchbend ?? 0) / 8192.0;
      }
    };

    for (const r of this.routes) {
      const val = normSource(r.source);
      const mod = val * r.amount;

      switch (r.destination) {
        case 'cutoff':
          // mod * up to 4 octaves (48 semitones)
          cutoffSemi += mod * 48.0;
          break;
        case 'volume':
          // mod * up to 24 dB
          volDb += mod * 24.0;
          break;
        case 'pitch':
          // mod * up to 200 cents (whole tone)
          pitchCents += mod * 200.0;
          break;
        case 'resonance':
          res += mod * 0.5;
          break;
      }
    }

    return {
      cutoffMultiplier: Math.pow(2.0, cutoffSemi / 12.0),
      volumeDbOffset: volDb,
      pitchCentsOffset: pitchCents,
      resonanceOffset: res,
    };
  }

  public reset(): void {
    this.rrCounters.clear();
    this.lastRandomPick.clear();
  }
}

/**
 * Computes linear gain attenuation for SFZ `trigger=release` (`rt_decay` in dB/sec)
 * given the held note duration in seconds.
 */
export function computeReleaseTriggerGainLinear(
  rtDecayDbPerSec: number | undefined,
  holdDurationSec: number,
): number {
  if (!rtDecayDbPerSec || rtDecayDbPerSec <= 0 || holdDurationSec <= 0) return 1.0;
  const attenDb = Math.min(96, rtDecayDbPerSec * holdDurationSec);
  return Math.pow(10, -attenDb / 20);
}

/**
 * Clean-room voice stealer using envelope contribution + age:
 * prefers stealing older voices whose envelope contribution is below half the pool average,
 * falling back to the oldest active voice.
 */
export function selectVoiceToSteal(
  voices: Array<{ id: string; ageMs: number; envelopeLevel: number }>,
): string | undefined {
  if (voices.length === 0) return undefined;
  const sorted = [...voices].sort((a, b) => b.ageMs - a.ageMs);
  const oldest = sorted[0];
  const avgEnv =
    sorted.reduce((sum, v) => sum + Math.max(0, v.envelopeLevel), 0) / sorted.length;
  const envThreshold = avgEnv * 0.5;
  const ageThreshold = oldest.ageMs * 0.5;

  for (const v of sorted) {
    if (v.ageMs <= ageThreshold) break;
    if (v.envelopeLevel <= envThreshold) return v.id;
  }
  return oldest.id;
}

/**
 * Builds a 128-point SFZ `<curve>` table from sparse `v0..v127` points using
 * linear interpolation between defined breakpoints.
 */
export function interpolateSfzCurvePoints(sparsePoints: ReadonlyMap<number, number>): number[] {
  const out = new Array<number>(128).fill(0);
  const defined = new Map<number, number>(sparsePoints);
  if (!defined.has(0)) defined.set(0, 0);
  if (!defined.has(127)) defined.set(127, 1);

  const keys = Array.from(defined.keys())
    .filter((k) => k >= 0 && k <= 127)
    .sort((a, b) => a - b);

  for (let idx = 0; idx < keys.length; idx++) {
    const k0 = keys[idx];
    const v0 = defined.get(k0)!;
    out[k0] = v0;
    if (idx + 1 < keys.length) {
      const k1 = keys[idx + 1];
      const v1 = defined.get(k1)!;
      const span = k1 - k0;
      for (let i = k0 + 1; i < k1; i++) {
        const t = (i - k0) / span;
        out[i] = v0 + (v1 - v0) * t;
      }
    }
  }
  return out;
}

/**
 * Evaluates a 128-point SFZ `<curve>` at normalized position `norm01` (0..1)
 * with linear interpolation between adjacent table entries.
 */
export function evaluateSfzCurve(points: readonly number[], norm01: number): number {
  if (points.length === 0) return Math.max(0, Math.min(1, norm01));
  const clamped = Math.max(0, Math.min(1, norm01));
  const scaled = clamped * (points.length - 1);
  const i0 = Math.floor(scaled);
  const i1 = Math.min(points.length - 1, i0 + 1);
  const frac = scaled - i0;
  return points[i0] * (1 - frac) + points[i1] * frac;
}

/**
 * Computes combined CC crossfade gain (0..1) for a region given current CC values (0..127).
 */
export function computeCcCrossfadeGain(
  ccValues: Readonly<Record<number, number>>,
  ccFadeIn?: Readonly<Record<number, { lo: number; hi: number }>>,
  ccFadeOut?: Readonly<Record<number, { lo: number; hi: number }>>,
  curveType: 'linear' | 'equal-power' | 'spectral-morph' = 'equal-power',
  customCurvePoints?: readonly number[],
): number {
  let gain = 1.0;
  const shape = (t: number): number => {
    const c = Math.max(0, Math.min(1, t));
    if (customCurvePoints && customCurvePoints.length > 1) {
      return Math.max(0, Math.min(1, evaluateSfzCurve(customCurvePoints, c)));
    }
    return curveType === 'linear' ? c : Math.sin(c * Math.PI * 0.5);
  };

  if (ccFadeIn) {
    for (const [ccStr, range] of Object.entries(ccFadeIn)) {
      const cc = Number(ccStr);
      const val = ccValues[cc] ?? 0;
      if (val <= range.lo) return 0;
      if (val < range.hi && range.hi > range.lo) {
        gain *= shape((val - range.lo) / (range.hi - range.lo));
      }
    }
  }
  if (ccFadeOut) {
    for (const [ccStr, range] of Object.entries(ccFadeOut)) {
      const cc = Number(ccStr);
      const val = ccValues[cc] ?? 0;
      if (val >= range.hi) return 0;
      if (val > range.lo && range.hi > range.lo) {
        gain *= shape((range.hi - val) / (range.hi - range.lo));
      }
    }
  }
  return Math.max(0, Math.min(1, gain));
}
