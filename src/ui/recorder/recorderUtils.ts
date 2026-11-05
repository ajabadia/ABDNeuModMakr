import type { FinalizedTake, RecorderState } from '@abdsynths/shared/dsp/take/recordingEngine.ts';
import type { NoiseProfile } from '@abdsynths/shared/dsp/take/takeDsp.ts';

export function formatTakeTime(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const tenths = Math.floor((s * 10) % 10);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${tenths}`;
}

export function toDbfs(linearPeak: number): number {
  return linearPeak <= 0 ? -Infinity : 20 * Math.log10(linearPeak);
}

export function normalizeNoiseProfile(
  np: { levelDbfs: number; spectrumBands: number[]; hum50HzDb?: number; hum60HzDb?: number } | undefined
): NoiseProfile | undefined {
  if (!np) return undefined;
  return {
    levelDbfs: np.levelDbfs,
    spectrumBands: [...np.spectrumBands],
    hum50HzDb: np.hum50HzDb ?? -Infinity,
    hum60HzDb: np.hum60HzDb ?? -Infinity,
  };
}

export function mixToMono(take: FinalizedTake): Float32Array {
  const { samples } = take;
  if (samples.length === 0) return new Float32Array(0);
  if (samples.length === 1) return samples[0];
  const len = samples[0].length;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let acc = 0;
    for (const ch of samples) acc += ch[i];
    out[i] = acc / samples.length;
  }
  return out;
}

export const STATE_BADGE: Record<RecorderState, string> = {
  idle: 'IDLE',
  monitoring: 'MONITORING',
  recording: 'REC',
  paused: 'PAUSED',
  stopped: 'STOPPED',
};
