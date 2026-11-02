// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Synclavier II / Synclavier V / Synclavier Regen Parser
// ─────────────────────────────────────────────────────────

import type { LoopMode } from './SamplerTypes.ts';
import type { ParsedImportRegion, ParsedSamplerPreset } from './rawSamplerParsers.ts';

export interface SynclavierPartial {
  name: string;
  sampleName: string;
  keyLow: number;
  keyHigh: number;
  rootKey: number;
  tuningCents: number;
  volumeDb: number;
  pan: number;
  attackSec: number;
  decaySec: number;
  sustainLevel: number;
  releaseSec: number;
}

export interface SynclavierTimbre {
  title: string;
  comment: string;
  partials: SynclavierPartial[];
}

export function deobfuscateSynclavierSflc(
  fileBytes: Uint8Array,
  baseFileNameWithoutExt: string
): Uint8Array {
  const A = 0x3357c6a7c5dcc7f5n;
  const C = 0x8d14b6503262bd01n;
  const SEED = 0xaeaee9b5e0e46745n;
  const MASK64 = 0xffffffffffffffffn;

  let state = SEED;
  const nameBytes = new TextEncoder().encode(baseFileNameWithoutExt);

  for (let i = 0; i < nameBytes.length; i++) {
    const b = BigInt(nameBytes[i]);
    state = (((b ^ state) * A + C) & MASK64);
  }

  const out = new Uint8Array(fileBytes.length);
  for (let i = 0; i < fileBytes.length; i++) {
    state = ((state * A + C) & MASK64);
    const keyByte = Number(state & 0xffn);
    out[i] = fileBytes[i] ^ keyByte;
  }

  return out;
}

export function isSynclavierTimbre(text: string): boolean {
  return text.includes('SynclavierVirtualInstrumentTimbreVersion') || text.includes('serialization::archive');
}

export function parseSynclavierTimbre(
  content: string,
  timbreName: string = 'Synclavier Timbre'
): SynclavierTimbre {
  const lines = content.split(/\r?\n/);
  const partials: SynclavierPartial[] = [];

  let title = timbreName;
  let comment = '';

  if (lines.length > 2 && lines[2].startsWith('SynclavierVirtualInstrumentTimbreVersion')) {
    title = lines[0].trim() || timbreName;
    comment = lines[1].trim();

    for (let i = 3; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const tokens = line.split(/\s+/);
      if (tokens.length >= 5) {
        const pName = tokens[0];
        const sName = tokens[1];
        const kLow = parseInt(tokens[2], 10) || 0;
        const kHigh = parseInt(tokens[3], 10) || 127;
        const root = parseInt(tokens[4], 10) || 60;
        const tune = parseFloat(tokens[5] || '0') * 100;
        const vol = parseFloat(tokens[6] || '0');

        partials.push({
          name: pName,
          sampleName: sName,
          keyLow: Math.max(0, Math.min(127, kLow)),
          keyHigh: Math.max(0, Math.min(127, kHigh)),
          rootKey: Math.max(0, Math.min(127, root)),
          tuningCents: tune,
          volumeDb: vol,
          pan: 0,
          attackSec: 0.01,
          decaySec: 0.5,
          sustainLevel: 1.0,
          releaseSec: 0.2,
        });
      }
    }
  } else if (content.includes('serialization::archive')) {
    const tokens = content.trim().split(/\s+/);
    if (tokens.length > 8) {
      title = tokens[6] || timbreName;
    }
    for (let t = 0; t < tokens.length; t++) {
      const tok = tokens[t];
      if (tok.endsWith('.wav') || tok.endsWith('.aif') || tok.endsWith('.flac')) {
        partials.push({
          name: `Partial_${partials.length + 1}`,
          sampleName: tok,
          keyLow: 0,
          keyHigh: 127,
          rootKey: 60,
          tuningCents: 0,
          volumeDb: 0,
          pan: 0,
          attackSec: 0.01,
          decaySec: 0.5,
          sustainLevel: 1.0,
          releaseSec: 0.2,
        });
      }
    }
  }

  if (partials.length === 0) {
    partials.push({
      name: 'Partial_1',
      sampleName: `${title}.wav`,
      keyLow: 0,
      keyHigh: 127,
      rootKey: 60,
      tuningCents: 0,
      volumeDb: 0,
      pan: 0,
      attackSec: 0.01,
      decaySec: 0.5,
      sustainLevel: 1.0,
      releaseSec: 0.2,
    });
  }

  return {
    title,
    comment,
    partials,
  };
}

export function convertSynclavierToPreset(
  timbre: SynclavierTimbre,
  availableSamples?: Map<string, ArrayBuffer>
): ParsedSamplerPreset {
  const regions: ParsedImportRegion[] = [];
  const audioBuffers = new Map<string, ArrayBuffer>();

  for (let i = 0; i < timbre.partials.length; i++) {
    const p = timbre.partials[i];
    let sRef = p.sampleName;
    if (!sRef.toLowerCase().endsWith('.wav') && !sRef.toLowerCase().endsWith('.flac')) {
      sRef += '.wav';
    }

    if (availableSamples) {
      const found =
        availableSamples.get(p.sampleName) ||
        availableSamples.get(sRef) ||
        availableSamples.get(sRef.toLowerCase());
      if (found) {
        audioBuffers.set(sRef, found);
      }
    }

    regions.push({
      id: `synclavier_${i + 1}`,
      sampleName: sRef,
      samplePath: sRef,
      rootKey: p.rootKey,
      lowKey: p.keyLow,
      highKey: p.keyHigh,
      lowVel: 0,
      highVel: 127,
      detuneCents: p.tuningCents,
      volumeDb: p.volumeDb,
      pan: p.pan,
      loopMode: 'loop_continuous',
      loopStart: 0,
      loopEnd: 0,
    });
  }

  return {
    format: 'synclavier',
    formatLabel: 'Synclavier Timbre / SYNX',
    presetName: timbre.title,
    modelName: timbre.title.slice(0, 11),
    detectedCategory: 'vintage',
    suggestedParameterSet: 1,
    regions,
    audioBuffers,
  };
}
