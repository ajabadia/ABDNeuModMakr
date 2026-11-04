// ─────────────────────────────────────────────────────────
// AI honesty — deterministic stem-separation fallback (consent-gated DSP).
// ─────────────────────────────────────────────────────────


export function separateStemsDspFallback(
  pcm: Float32Array,
  sampleRate: number,
  stems: readonly string[],
  encodeWavFn: (samples: Float32Array, sr: number) => ArrayBuffer
): Record<string, ArrayBuffer> {
  const n = pcm.length;
  const out: Record<string, ArrayBuffer> = {};
  if (n === 0) return out;

  // One-pole low-pass at ~180 Hz (bass) and ~3200 Hz (vocals/mid body)
  const rcLow = 1.0 / (2.0 * Math.PI * 180.0);
  const dt = 1.0 / Math.max(8000, sampleRate);
  const alphaLow = dt / (rcLow + dt);

  const rcHigh = 1.0 / (2.0 * Math.PI * 3200.0);
  const alphaHigh = dt / (rcHigh + dt);

  const bass = new Float32Array(n);
  const midBand = new Float32Array(n);
  const highs = new Float32Array(n);

  let lp180 = 0;
  let lp3200 = 0;
  for (let i = 0; i < n; i++) {
    const x = pcm[i];
    lp180 += alphaLow * (x - lp180);
    lp3200 += alphaHigh * (x - lp3200);
    bass[i] = lp180;
    midBand[i] = lp3200 - lp180;
    highs[i] = x - lp3200;
  }

  // Envelope follower for transient/percussive vs harmonic gating
  const fastAttack = Math.exp(-1.0 / (0.002 * sampleRate));
  const slowRelease = Math.exp(-1.0 / (0.065 * sampleRate));
  let envFast = 0;
  let envSlow = 0;
  const drums = new Float32Array(n);
  const sustainedMid = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const absX = Math.abs(pcm[i]);
    envFast = absX > envFast ? fastAttack * envFast + (1 - fastAttack) * absX : slowRelease * envFast;
    envSlow = 0.999 * envSlow + 0.001 * absX;
    const transientRatio = envSlow > 1e-5 ? Math.min(1, Math.max(0, (envFast - envSlow) / (envSlow * 2.5))) : 0;
    drums[i] = pcm[i] * transientRatio + highs[i] * 0.45;
    sustainedMid[i] = midBand[i] * (1 - 0.65 * transientRatio);
  }

  for (const stem of stems) {
    if (stem === 'bass') {
      out.bass = encodeWavFn(bass, sampleRate);
    } else if (stem === 'drums') {
      out.drums = encodeWavFn(drums, sampleRate);
    } else if (stem === 'vocals') {
      out.vocals = encodeWavFn(sustainedMid, sampleRate);
    } else if (stem === 'instrumental') {
      const inst = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        inst[i] = bass[i] + highs[i] + (midBand[i] - sustainedMid[i] * 0.7);
      }
      out.instrumental = encodeWavFn(inst, sampleRate);
    }
  }

  return out;
}
