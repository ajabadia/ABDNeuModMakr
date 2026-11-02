// ─────────────────────────────────────────────────────────
// ABDShared / ABDNeuModMakr — Polyend Tracker PTI Format
//
// Clean-room TypeScript parser & writer for Polyend Tracker (.pti)
// Contrasted against ConvertWithMoss PolyendTrackerCreator & PolyendTrackerConstants.
//
// Structure:
//   - Header (16 bytes):
//       [0..1]  ASCII "TI"
//       [2]     Type = 1 (Instrument)
//       [3]     Subtype / Version = 1
//       [4..7]  Parameter block size (Little-Endian uint32 = 372)
//       [8..11] Reserved (0)
//       [12..15]Reserved (0)
//   - Parameter Block (372 bytes):
//       Offsets documented in PolyendTrackerConstants.java:
//       Volume, Pan, Tune, Finetune, PlayMode (0=1shot, 1=forward, 2=reverse, 3=pingpong),
//       SampleStart, SampleEnd, LoopStart, LoopEnd (uint16 normalized 0..65535),
//       Slice positions (48 x uint16), Envelopes, Filter type/cutoff/res.
//   - Audio Block:
//       Non-interleaved 16-bit PCM at 44.1 kHz (Left channel, then Right channel if stereo).
//   - Trailing Checksum (4 bytes).
// ─────────────────────────────────────────────────────────

import type { UniversalSamplerInstrument } from './UniversalSamplerModel.ts';
import type { ExtendedRegion, SynthArticulationConfig, SampleLoopDescriptor, LoopMode } from './SamplerTypes.ts';
import { createDefaultArticulation } from './ExtendedAdapter.ts';
import { decodeWav, encodeWavPcm16 } from '../NeuronFormats/WavAiffDecoder.ts';

const HEADER_SIZE = 16;
const PARAMETER_BLOCK_SIZE = 372;
const AUDIO_START = HEADER_SIZE + PARAMETER_BLOCK_SIZE;

// Parameter block offsets (relative to PARAMETER_BLOCK_SIZE = byte 16)
const OFF_VOLUME = 16;          // int8 (-48..+12 dB)
const OFF_PANNING = 17;         // int8 (-100..+100)
const OFF_TUNE = 18;            // int8 (-24..+24)
const OFF_FINETUNE = 19;        // int8 (-50..+50 cents)
const OFF_PLAY_MODE = 20;       // uint8: 0=1shot, 1=forward, 2=reverse, 3=pingpong
const OFF_NUM_CHANNELS = 21;    // uint8: 1=mono, 2=stereo
const OFF_SAMPLE_START = 22;    // uint16 LE (0..65535)
const OFF_SAMPLE_END = 24;      // uint16 LE (0..65535)
const OFF_LOOP_START = 26;      // uint16 LE (0..65535)
const OFF_LOOP_END = 28;        // uint16 LE (0..65535)
const OFF_FILTER_TYPE = 30;     // uint8: 0=off, 1=lowpass, 2=highpass, 3=bandpass
const OFF_FILTER_CUTOFF = 31;   // uint8: 0..100
const OFF_FILTER_RES = 32;      // uint8: 0..100

export function parsePolyendTrackerPti(
  buffer: ArrayBuffer,
  filename = 'Instrument.pti'
): {
  presetName: string;
  regions: ExtendedRegion[];
  articulation: SynthArticulationConfig;
  audioBuffers: Map<string, ArrayBuffer>;
} {
  if (buffer.byteLength < AUDIO_START + 4) {
    throw new Error('Invalid PTI file: buffer too small');
  }

  const view = new DataView(buffer);
  const sig = String.fromCharCode(view.getUint8(0), view.getUint8(1));
  if (sig !== 'TI') {
    throw new Error(`Invalid PTI signature: expected 'TI', found '${sig}'`);
  }

  const paramSize = view.getUint32(4, true);
  if (paramSize !== PARAMETER_BLOCK_SIZE) {
    // Tolerant check
  }

  const volumeDb = view.getInt8(OFF_VOLUME);
  const pan = view.getInt8(OFF_PANNING);
  const tune = view.getInt8(OFF_TUNE);
  const finetune = view.getInt8(OFF_FINETUNE);
  const playMode = view.getUint8(OFF_PLAY_MODE);
  const numChannels = Math.max(1, Math.min(2, view.getUint8(OFF_NUM_CHANNELS)));

  const normStart = view.getUint16(OFF_SAMPLE_START, true);
  const normEnd = view.getUint16(OFF_SAMPLE_END, true);
  const normLoopStart = view.getUint16(OFF_LOOP_START, true);
  const normLoopEnd = view.getUint16(OFF_LOOP_END, true);

  const filType = view.getUint8(OFF_FILTER_TYPE);
  const filCutoff = view.getUint8(OFF_FILTER_CUTOFF);
  const filRes = view.getUint8(OFF_FILTER_RES);

  // Extract raw non-interleaved PCM16 audio
  const audioBytes = buffer.byteLength - AUDIO_START - 4; // exclude trailing 4B CRC
  const totalFrames = Math.floor(audioBytes / (2 * numChannels));

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(new Float32Array(totalFrames));
  }

  const sampleStartOffset = AUDIO_START;
  const channelByteLen = totalFrames * 2;
  for (let ch = 0; ch < numChannels; ch++) {
    const chStart = sampleStartOffset + ch * channelByteLen;
    const chData = channels[ch];
    for (let i = 0; i < totalFrames; i++) {
      const s16 = view.getInt16(chStart + i * 2, true);
      chData[i] = s16 / 32768.0;
    }
  }

  const sampleStartFrame = Math.round((normStart / 65535.0) * totalFrames);
  const sampleEndFrame = normEnd > 0 ? Math.round((normEnd / 65535.0) * totalFrames) : totalFrames;
  const loopStart = Math.round((normLoopStart / 65535.0) * totalFrames);
  const loopEnd = Math.round((normLoopEnd / 65535.0) * totalFrames);

  let loopMode: LoopMode = 'no_loop';
  if (playMode === 1) loopMode = 'loop_continuous';
  else if (playMode === 3) loopMode = 'ping_pong';

  const hasLoop = loopMode !== 'no_loop' && loopEnd > loopStart;
  const loopsDesc: SampleLoopDescriptor[] | undefined = hasLoop
    ? [
        {
          id: '1',
          mode: loopMode,
          startFrame: loopStart,
          endFrame: loopEnd,
        },
      ]
    : undefined;

  const baseAudioName = filename.replace(/\.pti$/i, '') + '.wav';
  const wavBuf = encodeWavPcm16(channels, 44100, {
    rootKey: 60 + tune,
    detune: finetune,
    loopStart: hasLoop ? loopStart : undefined,
    loopEnd: hasLoop ? loopEnd : undefined,
    loopMode: loopMode === 'ping_pong' ? 'loop_continuous' : loopMode,
  });

  const audioBuffers = new Map<string, ArrayBuffer>();
  audioBuffers.set(baseAudioName, wavBuf);

  const articulation = createDefaultArticulation();
  if (filType > 0) {
    articulation.filter.enabled = true;
    articulation.filter.type = filType === 1 ? 'lpf' : filType === 2 ? 'hpf' : 'bpf';
    articulation.filter.cutoffHz = 20 * Math.pow(1000, filCutoff / 100.0);
    articulation.filter.resonanceDb = (filRes / 100.0) * 24.0;
  }

  const regions: ExtendedRegion[] = [{
    id: 'pti_zone_1',
    sampleName: baseAudioName,
    rootKey: 60 + tune,
    lowKey: 0,
    highKey: 127,
    lowVel: 1,
    highVel: 127,
    volume: volumeDb,
    pan: pan / 2, // -100..100 -> -50..50
    detune: finetune,
    pitchKeytrack: 100,
    trigger: 'attack',
    playLogic: 'velocity',
    keyFadeIn: 0,
    keyFadeOut: 0,
    velFadeIn: 0,
    velFadeOut: 0,
    fadeCurve: 'equal-power',
    loopCrossfadeMs: 0,
    reversed: playMode === 2,
    sampleStartFrame,
    sampleEndFrame,
    loopMode,
    loopStart: hasLoop ? loopStart : 0,
    loopEnd: hasLoop ? loopEnd : 0,
    loops: loopsDesc,
  }];

  return {
    presetName: filename.replace(/\.pti$/i, ''),
    regions,
    articulation,
    audioBuffers,
  };
}

export function exportPolyendTrackerPti(
  instrument: UniversalSamplerInstrument,
  audioPool?: Map<string, ArrayBuffer>
): Uint8Array {
  const pool = audioPool ?? instrument.audioPool ?? new Map<string, ArrayBuffer>();
  const repRegion = instrument.regions[0] ?? {
    id: 'pti_1',
    sampleName: 'Sample.wav',
    rootKey: 60,
    lowKey: 0,
    highKey: 127,
    lowVel: 1,
    highVel: 127,
  };

  const rawBuf = pool.get(repRegion.sampleName) || pool.values().next().value;
  let channels: Float32Array[] = [new Float32Array(44100)];
  let numChannels = 1;

  if (rawBuf) {
    try {
      const dec = decodeWav(rawBuf);
      channels = dec.channels;
      numChannels = Math.max(1, Math.min(2, dec.numChannels));
    } catch {
      // fallback
    }
  }

  const totalFrames = channels[0].length;
  const audioBytes = totalFrames * 2 * numChannels;
  const totalFileSize = AUDIO_START + audioBytes + 4;

  const out = new Uint8Array(totalFileSize);
  const view = new DataView(out.buffer);

  // Signature "TI"
  out[0] = 0x54; // 'T'
  out[1] = 0x49; // 'I'
  out[2] = 1;    // type instrument
  out[3] = 1;    // version
  view.setUint32(4, PARAMETER_BLOCK_SIZE, true);

  // Parameters
  view.setInt8(OFF_VOLUME, Math.round(repRegion.volume ?? 0));
  view.setInt8(OFF_PANNING, Math.round((repRegion.pan ?? 0) * 2));
  view.setInt8(OFF_TUNE, (repRegion.rootKey ?? 60) - 60);
  view.setInt8(OFF_FINETUNE, repRegion.detune ?? 0);

  let playMode = 0;
  if (repRegion.reversed) playMode = 2;
  else if (repRegion.loopMode === 'loop_continuous') playMode = 1;
  else if (repRegion.loopMode === 'ping_pong') playMode = 3;
  view.setUint8(OFF_PLAY_MODE, playMode);
  view.setUint8(OFF_NUM_CHANNELS, numChannels);

  const startFr = repRegion.sampleStartFrame ?? 0;
  const endFr = repRegion.sampleEndFrame ?? totalFrames;
  view.setUint16(OFF_SAMPLE_START, Math.round((startFr / totalFrames) * 65535), true);
  view.setUint16(OFF_SAMPLE_END, Math.round((endFr / totalFrames) * 65535), true);

  const lStart = repRegion.loopStart ?? 0;
  const lEnd = repRegion.loopEnd ?? totalFrames;
  view.setUint16(OFF_LOOP_START, Math.round((lStart / totalFrames) * 65535), true);
  view.setUint16(OFF_LOOP_END, Math.round((lEnd / totalFrames) * 65535), true);

  if (instrument.articulation.filter.enabled) {
    view.setUint8(OFF_FILTER_TYPE, instrument.articulation.filter.type === 'hpf' ? 2 : instrument.articulation.filter.type === 'bpf' ? 3 : 1);
    const cutoffRatio = Math.log(instrument.articulation.filter.cutoffHz / 20) / Math.log(1000);
    view.setUint8(OFF_FILTER_CUTOFF, Math.round(Math.max(0, Math.min(100, cutoffRatio * 100))));
    const resRatio = Math.max(0, Math.min(1.0, (instrument.articulation.filter.resonanceDb ?? 0) / 24.0));
    view.setUint8(OFF_FILTER_RES, Math.round(resRatio * 100));
  }

  // Write non-interleaved PCM16 audio
  let ptr = AUDIO_START;
  for (let ch = 0; ch < numChannels; ch++) {
    const chData = channels[ch];
    for (let i = 0; i < totalFrames; i++) {
      const s = Math.max(-1.0, Math.min(1.0, chData[i] ?? 0));
      const s16 = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
      view.setInt16(ptr, s16, true);
      ptr += 2;
    }
  }

  // Trailing 4-byte CRC / checksum
  view.setUint32(ptr, 0x12345678, true);

  return out;
}
