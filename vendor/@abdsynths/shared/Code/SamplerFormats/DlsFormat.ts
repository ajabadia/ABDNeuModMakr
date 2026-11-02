// ─────────────────────────────────────────────────────────
// @abdsynths/shared — MMA Downloadable Sounds Level 1/2 (.dls) Reader & Writer (Fase 32.4)
//
// Clean-room Little-Endian RIFF "DLS " implementation:
//   - colh (collection header), ptbl (pool table), LIST('lins') -> LIST('ins ')
//   - insh (instrument header), LIST('lrgn') -> LIST('rgn ' / 'rgn2') -> rgnh, wsmp, wlnk
//   - LIST('lart' / 'lar2') -> art1 / art2 (12-byte connection blocks for EG1 Amp, EG2 Mod/Filter/Pitch, LFO, Filter, Pan)
//   - LIST('wvpl') -> LIST('wave') (fmt , data, wsmp, INFO/INAM)
// Reference: MMA DLS Level 2.2 Specification & Jürgen Moßgraber's ConvertWithMoss format documentation.
// ─────────────────────────────────────────────────────────

import { encodeWavPcm16 } from '../NeuronFormats/WavAiffDecoder.ts';
import type {
  DahdsrEnvelope,
  LoopMode,
  PitchEnvelopeConfig,
  RegionFilterConfig,
} from './SamplerTypes.ts';
import type { UniformSamplerRegion } from './rawSamplerTypes.ts';

export interface DlsRegionRecord {
  lowKey: number;
  highKey: number;
  lowVel: number;
  highVel: number;
  keyGroup: number; // muteGroup (0..15)
  rootKey: number;
  detuneCents: number;
  volumeDb: number;
  pan: number; // -50..+50
  loopMode: LoopMode;
  loopStart: number;
  loopEnd: number;
  waveIndex: number;
}

export interface DlsInstrumentRecord {
  index: number;
  bank: number;
  program: number;
  isDrum: boolean;
  name: string;
  regions: DlsRegionRecord[];
  ampEnv: DahdsrEnvelope;
  filter: RegionFilterConfig;
  pitchEnv?: PitchEnvelopeConfig;
}

export interface DlsWaveRecord {
  index: number;
  name: string;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  rootKey: number;
  detuneCents: number;
  loopMode: LoopMode;
  loopStart: number;
  loopEnd: number;
  wavBuffer: ArrayBuffer;
}

export interface ParsedDlsBank {
  bankName: string;
  author?: string;
  copyright?: string;
  comment?: string;
  instruments: DlsInstrumentRecord[];
  waves: DlsWaveRecord[];
}

// DLS Connection Block constants
const CONN_SRC_NONE = 0x0000;
const CONN_SRC_KEYONVELOCITY = 0x0002;
const CONN_SRC_KEYNUMBER = 0x0003;
const CONN_SRC_EG2 = 0x0005;

const CONN_DST_GAIN = 0x0001;
const CONN_DST_PITCH = 0x0003;
const CONN_DST_PAN = 0x0004;

const CONN_DST_EG1_ATTACKTIME = 0x0206;
const CONN_DST_EG1_DECAYTIME = 0x0207;
const CONN_DST_EG1_RELEASETIME = 0x0209;
const CONN_DST_EG1_SUSTAINLEVEL = 0x020a;
const CONN_DST_EG1_DELAYTIME = 0x020b;
const CONN_DST_EG1_HOLDTIME = 0x020c;

const CONN_DST_EG2_ATTACKTIME = 0x030a;
const CONN_DST_EG2_DECAYTIME = 0x030b;
const CONN_DST_EG2_RELEASETIME = 0x030d;
const CONN_DST_EG2_SUSTAINLEVEL = 0x030e;
const CONN_DST_EG2_DELAYTIME = 0x030f;
const CONN_DST_EG2_HOLDTIME = 0x0310;

const CONN_DST_FILTER_CUTOFF = 0x0500;
const CONN_DST_FILTER_Q = 0x0501;

function readFourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3]
  );
}

function writeFourCC(bytes: Uint8Array, offset: number, tag: string): void {
  for (let i = 0; i < 4; i++) {
    bytes[offset + i] = (tag.charCodeAt(i) || 0x20) & 0x7f;
  }
}

function readNullTerminatedAscii(bytes: Uint8Array, offset: number, maxLen: number): string {
  const end = Math.min(bytes.byteLength, offset + maxLen);
  let out = '';
  for (let i = offset; i < end; i++) {
    const b = bytes[i];
    if (b === 0) break;
    if (b >= 32 && b < 127) out += String.fromCharCode(b);
  }
  return out.trim();
}

// DLS lScale conversions:
// Timecents: lScale = round(1200 * log2(sec) * 65536), -2147483648 = 0s
export function dlsScaleToSeconds(lScale: number, fallbackSec: number): number {
  if (lScale <= -0x7fffffff) return 0;
  const timecents = lScale / 65536;
  const sec = Math.pow(2, timecents / 1200);
  if (!Number.isFinite(sec)) return fallbackSec;
  return Math.max(0.0005, Math.min(60, sec));
}

export function secondsToDlsScale(sec: number): number {
  if (sec <= 0.0002) return -0x80000000;
  const clamped = Math.max(0.0005, Math.min(60, sec));
  return Math.round(1200 * Math.log2(clamped) * 65536);
}

// Percent [0..1] <-> lScale [0..1000 * 65536]
export function dlsScaleToUnitRatio(lScale: number): number {
  return Math.max(0, Math.min(1, lScale / (1000 * 65536)));
}

export function unitRatioToDlsScale(ratio: number): number {
  return Math.round(Math.max(0, Math.min(1, ratio)) * 1000 * 65536);
}

// Pitch Hz <-> DLS Absolute Pitch: lScale = round((1200 * log2(hz / 440) + 6900) * 65536)
export function dlsScaleToHz(lScale: number): number {
  const absCents = lScale / 65536;
  const hz = 440 * Math.pow(2, (absCents - 6900) / 1200);
  return Math.max(20, Math.min(22000, Math.round(hz)));
}

export function hzToDlsScale(hz: number): number {
  const clamped = Math.max(20, Math.min(20000, hz));
  return Math.round((1200 * Math.log2(clamped / 440) + 6900) * 65536);
}

/**
 * Checks whether an ArrayBuffer is a RIFF `"DLS "` container.
 */
export function isDlsBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const bytes = new Uint8Array(buffer, 0, 12);
  return readFourCC(bytes, 0) === 'RIFF' && readFourCC(bytes, 8) === 'DLS ';
}

interface ParsedWsmp {
  unityNote: number;
  fineTune: number;
  volumeDb: number;
  loopMode: LoopMode;
  loopStart: number;
  loopEnd: number;
}

function parseWsmpChunk(view: DataView, offset: number, size: number): ParsedWsmp {
  if (size < 20) {
    return {
      unityNote: 60,
      fineTune: 0,
      volumeDb: 0,
      loopMode: 'no_loop',
      loopStart: 0,
      loopEnd: 0,
    };
  }
  const unityNote = Math.max(0, Math.min(127, view.getUint16(offset + 4, true)));
  const fineTune = view.getInt16(offset + 6, true);
  const attenuation = view.getInt32(offset + 8, true); // in 1/655360 dB
  const volumeDb =
    attenuation <= -0x3fffffff ? -60 : Math.max(-60, Math.min(24, Math.round((attenuation / 655360) * 100) / 100));
  const cSampleLoops = view.getUint32(offset + 16, true);
  let loopMode: LoopMode = 'no_loop';
  let loopStart = 0;
  let loopEnd = 0;
  if (cSampleLoops > 0 && size >= 36) {
    const loopStartVal = view.getUint32(offset + 28, true);
    const loopLenVal = view.getUint32(offset + 32, true);
    if (loopLenVal > 0) {
      loopMode = 'loop_continuous';
      loopStart = loopStartVal;
      loopEnd = loopStartVal + loopLenVal;
    }
  }
  return {
    unityNote,
    fineTune,
    volumeDb,
    loopMode,
    loopStart,
    loopEnd,
  };
}

interface ParsedArticulationBlocks {
  pan?: number; // -50..+50
  ampEnv: Partial<DahdsrEnvelope>;
  filter: Partial<RegionFilterConfig>;
  eg2Env: Partial<DahdsrEnvelope>;
  pitchEnvDepthCents?: number;
}

function parseArtChunk(view: DataView, offset: number, size: number): ParsedArticulationBlocks {
  const res: ParsedArticulationBlocks = {
    ampEnv: {},
    filter: {},
    eg2Env: {},
  };
  if (size < 8) return res;
  const cbSize = view.getUint32(offset + 0, true);
  const numBlocks = view.getUint32(offset + 4, true);
  let ptr = offset + Math.max(8, cbSize);

  for (let i = 0; i < numBlocks && ptr + 12 <= offset + size; i++) {
    const source = view.getUint16(ptr + 0, true);
    const destination = view.getUint16(ptr + 4, true);
    const lScale = view.getInt32(ptr + 8, true);
    ptr += 12;

    if (source === CONN_SRC_NONE) {
      switch (destination) {
        case CONN_DST_PAN:
          res.pan = Math.max(-50, Math.min(50, Math.round((lScale / (1000 * 65536)) * 100)));
          break;
        case CONN_DST_EG1_DELAYTIME:
          res.ampEnv.delaySec = dlsScaleToSeconds(lScale, 0);
          break;
        case CONN_DST_EG1_ATTACKTIME:
          res.ampEnv.attackSec = dlsScaleToSeconds(lScale, 0.005);
          break;
        case CONN_DST_EG1_HOLDTIME:
          res.ampEnv.holdSec = dlsScaleToSeconds(lScale, 0);
          break;
        case CONN_DST_EG1_DECAYTIME:
          res.ampEnv.decaySec = dlsScaleToSeconds(lScale, 0.25);
          break;
        case CONN_DST_EG1_SUSTAINLEVEL:
          res.ampEnv.sustainLevel = dlsScaleToUnitRatio(lScale);
          break;
        case CONN_DST_EG1_RELEASETIME:
          res.ampEnv.releaseSec = dlsScaleToSeconds(lScale, 0.2);
          break;
        case CONN_DST_EG2_DELAYTIME:
          res.eg2Env.delaySec = dlsScaleToSeconds(lScale, 0);
          break;
        case CONN_DST_EG2_ATTACKTIME:
          res.eg2Env.attackSec = dlsScaleToSeconds(lScale, 0.005);
          break;
        case CONN_DST_EG2_HOLDTIME:
          res.eg2Env.holdSec = dlsScaleToSeconds(lScale, 0);
          break;
        case CONN_DST_EG2_DECAYTIME:
          res.eg2Env.decaySec = dlsScaleToSeconds(lScale, 0.2);
          break;
        case CONN_DST_EG2_SUSTAINLEVEL:
          res.eg2Env.sustainLevel = dlsScaleToUnitRatio(lScale);
          break;
        case CONN_DST_EG2_RELEASETIME:
          res.eg2Env.releaseSec = dlsScaleToSeconds(lScale, 0.15);
          break;
        case CONN_DST_FILTER_CUTOFF:
          res.filter.cutoffHz = dlsScaleToHz(lScale);
          res.filter.enabled = res.filter.cutoffHz < 19500;
          break;
        case CONN_DST_FILTER_Q:
          res.filter.resonanceDb = Math.max(0, Math.min(36, Math.round((lScale / 655360) * 10) / 10));
          break;
      }
    } else if (source === CONN_SRC_EG2 && destination === CONN_DST_FILTER_CUTOFF) {
      res.filter.envToFilterCents = Math.round(lScale / 65536);
      res.filter.enabled = true;
    } else if (source === CONN_SRC_EG2 && destination === CONN_DST_PITCH) {
      res.pitchEnvDepthCents = Math.round(lScale / 65536);
    } else if (source === CONN_SRC_KEYNUMBER && destination === CONN_DST_FILTER_CUTOFF) {
      res.filter.keytrackCents = Math.round(lScale / 65536);
    }
  }

  return res;
}

/**
 * Parses a RIFF `"DLS "` Level 1 / Level 2 bank buffer.
 */
export function parseDlsBank(buffer: ArrayBuffer, fallbackName = 'DLSBank'): ParsedDlsBank {
  if (!isDlsBuffer(buffer)) {
    throw new Error('Invalid DLS file: missing RIFF "DLS " signature.');
  }

  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  let bankName = fallbackName;
  let author: string | undefined;
  let copyright: string | undefined;
  let comment: string | undefined;

  const waves: DlsWaveRecord[] = [];
  const instruments: DlsInstrumentRecord[] = [];

  const parseInfoList = (start: number, end: number): { name?: string; author?: string; copyright?: string; comment?: string } => {
    const info: { name?: string; author?: string; copyright?: string; comment?: string } = {};
    let p = start;
    while (p + 8 <= end) {
      const id = readFourCC(bytes, p);
      const sz = view.getUint32(p + 4, true);
      const payload = p + 8;
      if (payload + sz > end) break;
      const txt = readNullTerminatedAscii(bytes, payload, sz);
      if (id === 'INAM' && txt) info.name = txt;
      else if (id === 'IART' && txt) info.author = txt;
      else if (id === 'ICOP' && txt) info.copyright = txt;
      else if (id === 'ICMT' && txt) info.comment = txt;
      p = payload + sz + (sz & 1);
    }
    return info;
  };

  // First pass: locate wvpl (Wave Pool) so wave metadata is ready when instruments reference tableIndex
  let pos = 12;
  while (pos + 8 <= bytes.byteLength) {
    const chunkId = readFourCC(bytes, pos);
    const chunkSize = view.getUint32(pos + 4, true);
    const payload = pos + 8;
    const chunkEnd = Math.min(bytes.byteLength, payload + chunkSize);

    if (chunkId === 'LIST' && chunkSize >= 4) {
      const listType = readFourCC(bytes, payload);
      if (listType === 'wvpl') {
        let wp = payload + 4;
        let waveIdx = 0;
        while (wp + 8 <= chunkEnd) {
          const wId = readFourCC(bytes, wp);
          const wSize = view.getUint32(wp + 4, true);
          const wPayload = wp + 8;
          const wEnd = Math.min(chunkEnd, wPayload + wSize);
          if (wId === 'LIST' && wSize >= 4 && readFourCC(bytes, wPayload) === 'wave') {
            let sampleRate = 44100;
            let channels = 1;
            let bitDepth = 16;
            let pcmData = new Uint8Array(0);
            let waveName = `DLS_Wave_${waveIdx + 1}`;
            let wsmp: ParsedWsmp = {
              unityNote: 60,
              fineTune: 0,
              volumeDb: 0,
              loopMode: 'no_loop',
              loopStart: 0,
              loopEnd: 0,
            };

            let sub = wPayload + 4;
            while (sub + 8 <= wEnd) {
              const sId = readFourCC(bytes, sub);
              const sSize = view.getUint32(sub + 4, true);
              const sPayload = sub + 8;
              if (sPayload + sSize > wEnd) break;

              if (sId === 'fmt ' && sSize >= 16) {
                channels = Math.max(1, view.getUint16(sPayload + 2, true));
                sampleRate = view.getUint32(sPayload + 4, true) || 44100;
                bitDepth = view.getUint16(sPayload + 14, true) || 16;
              } else if (sId === 'data') {
                pcmData = bytes.subarray(sPayload, sPayload + sSize);
              } else if (sId === 'wsmp') {
                wsmp = parseWsmpChunk(view, sPayload, sSize);
              } else if (sId === 'LIST' && sSize >= 4 && readFourCC(bytes, sPayload) === 'INFO') {
                const inf = parseInfoList(sPayload + 4, sPayload + sSize);
                if (inf.name) waveName = inf.name;
              }
              sub = sPayload + sSize + (sSize & 1);
            }

            // Convert PCM data to Float32Array channels and encode canonical WAV
            const bytesPerSample = bitDepth === 8 ? 1 : 2;
            const frameStride = channels * bytesPerSample;
            const numFrames = frameStride > 0 ? Math.floor(pcmData.byteLength / frameStride) : 0;
            const chanArrays: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(numFrames));
            const pcmView = new DataView(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);

            for (let f = 0; f < numFrames; f++) {
              for (let ch = 0; ch < channels; ch++) {
                const off = f * frameStride + ch * bytesPerSample;
                if (bitDepth === 8) {
                  // 8-bit WAV/DLS is unsigned 0..255
                  chanArrays[ch][f] = (pcmData[off] - 128) / 128;
                } else {
                  chanArrays[ch][f] = pcmView.getInt16(off, true) / 32768;
                }
              }
            }

            const wavBuffer = encodeWavPcm16(chanArrays.length > 0 ? chanArrays : [new Float32Array(64)], sampleRate, {
              rootKey: wsmp.unityNote,
              lowKey: 0,
              highKey: 127,
              lowVelocity: 1,
              highVelocity: 127,
              detune: wsmp.fineTune,
              gainDb: wsmp.volumeDb,
              loopMode: wsmp.loopMode === 'loop_continuous' ? 'loop_continuous' : 'no_loop',
              loopStart: wsmp.loopStart,
              loopEnd: wsmp.loopEnd,
            });

            waves.push({
              index: waveIdx,
              name: waveName.replace(/\.[^.]+$/, '') + '.wav',
              sampleRate,
              channels,
              bitDepth,
              rootKey: wsmp.unityNote,
              detuneCents: wsmp.fineTune,
              loopMode: wsmp.loopMode,
              loopStart: wsmp.loopStart,
              loopEnd: wsmp.loopEnd,
              wavBuffer,
            });
            waveIdx++;
          }
          wp = wEnd + (wSize & 1);
        }
      } else if (listType === 'INFO') {
        const inf = parseInfoList(payload + 4, chunkEnd);
        if (inf.name) bankName = inf.name;
        if (inf.author) author = inf.author;
        if (inf.copyright) copyright = inf.copyright;
        if (inf.comment) comment = inf.comment;
      }
    }
    pos = chunkEnd + (chunkSize & 1);
  }

  // Second pass: parse LIST('lins') instruments
  pos = 12;
  while (pos + 8 <= bytes.byteLength) {
    const chunkId = readFourCC(bytes, pos);
    const chunkSize = view.getUint32(pos + 4, true);
    const payload = pos + 8;
    const chunkEnd = Math.min(bytes.byteLength, payload + chunkSize);

    if (chunkId === 'LIST' && chunkSize >= 4 && readFourCC(bytes, payload) === 'lins') {
      let ip = payload + 4;
      let instIdx = 0;
      while (ip + 8 <= chunkEnd) {
        const iId = readFourCC(bytes, ip);
        const iSize = view.getUint32(ip + 4, true);
        const iPayload = ip + 8;
        const iEnd = Math.min(chunkEnd, iPayload + iSize);

        if (iId === 'LIST' && iSize >= 4 && readFourCC(bytes, iPayload) === 'ins ') {
          let instName = `${bankName}_${instIdx + 1}`;
          let ulBank = 0;
          let ulInstrument = 0;
          const regions: DlsRegionRecord[] = [];
          let globalArt: ParsedArticulationBlocks = { ampEnv: {}, filter: {}, eg2Env: {} };

          let sub = iPayload + 4;
          while (sub + 8 <= iEnd) {
            const sId = readFourCC(bytes, sub);
            const sSize = view.getUint32(sub + 4, true);
            const sPayload = sub + 8;
            const sEnd = Math.min(iEnd, sPayload + sSize);

            if (sId === 'insh' && sSize >= 12) {
              ulBank = view.getUint32(sPayload + 4, true);
              ulInstrument = view.getUint32(sPayload + 8, true);
            } else if (sId === 'LIST' && sSize >= 4) {
              const lType = readFourCC(bytes, sPayload);
              if (lType === 'INFO') {
                const inf = parseInfoList(sPayload + 4, sEnd);
                if (inf.name) instName = inf.name;
              } else if (lType === 'lart' || lType === 'lar2') {
                let ap = sPayload + 4;
                while (ap + 8 <= sEnd) {
                  const aId = readFourCC(bytes, ap);
                  const aSize = view.getUint32(ap + 4, true);
                  const aPayload = ap + 8;
                  if (aId === 'art1' || aId === 'art2') {
                    globalArt = parseArtChunk(view, aPayload, aSize);
                  }
                  ap = aPayload + aSize + (aSize & 1);
                }
              } else if (lType === 'lrgn') {
                let rp = sPayload + 4;
                while (rp + 8 <= sEnd) {
                  const rId = readFourCC(bytes, rp);
                  const rSize = view.getUint32(rp + 4, true);
                  const rPayload = rp + 8;
                  const rEnd = Math.min(sEnd, rPayload + rSize);

                  if (rId === 'LIST' && rSize >= 4) {
                    const rType = readFourCC(bytes, rPayload);
                    if (rType === 'rgn ' || rType === 'rgn2') {
                      let lowKey = 0;
                      let highKey = 127;
                      let lowVel = 1;
                      let highVel = 127;
                      let keyGroup = 0;
                      let waveIndex = 0;
                      let regWsmp: ParsedWsmp | undefined;
                      let regArt: ParsedArticulationBlocks | undefined;

                      let rSub = rPayload + 4;
                      while (rSub + 8 <= rEnd) {
                        const rcId = readFourCC(bytes, rSub);
                        const rcSize = view.getUint32(rSub + 4, true);
                        const rcPayload = rSub + 8;
                        const rcEnd = Math.min(rEnd, rcPayload + rcSize);

                        if (rcId === 'rgnh' && rcSize >= 12) {
                          lowKey = Math.max(0, Math.min(127, view.getUint16(rcPayload + 0, true)));
                          highKey = Math.max(0, Math.min(127, view.getUint16(rcPayload + 2, true)));
                          lowVel = Math.max(1, Math.min(127, view.getUint16(rcPayload + 4, true) || 1));
                          highVel = Math.max(1, Math.min(127, view.getUint16(rcPayload + 6, true) || 127));
                          keyGroup = rcSize >= 14 ? view.getUint16(rcPayload + 10, true) & 0x0f : 0;
                        } else if (rcId === 'wsmp') {
                          regWsmp = parseWsmpChunk(view, rcPayload, rcSize);
                        } else if (rcId === 'wlnk' && rcSize >= 12) {
                          waveIndex = view.getUint32(rcPayload + 8, true);
                        } else if (rcId === 'LIST' && rcSize >= 4) {
                          const rlType = readFourCC(bytes, rcPayload);
                          if (rlType === 'lart' || rlType === 'lar2') {
                            let rap = rcPayload + 4;
                            while (rap + 8 <= rcEnd) {
                              const raId = readFourCC(bytes, rap);
                              const raSize = view.getUint32(rap + 4, true);
                              const raPayload = rap + 8;
                              if (raId === 'art1' || raId === 'art2') {
                                regArt = parseArtChunk(view, raPayload, raSize);
                              }
                              rap = raPayload + raSize + (raSize & 1);
                            }
                          }
                        }
                        rSub = rcEnd + (rcSize & 1);
                      }

                      const waveRef = waves[waveIndex];
                      const rootKey = regWsmp?.unityNote ?? waveRef?.rootKey ?? 60;
                      const detuneCents = regWsmp?.fineTune ?? waveRef?.detuneCents ?? 0;
                      const volumeDb = regWsmp?.volumeDb ?? 0;
                      const loopMode = regWsmp?.loopMode ?? waveRef?.loopMode ?? 'no_loop';
                      const loopStart = regWsmp?.loopStart ?? waveRef?.loopStart ?? 0;
                      const loopEnd = regWsmp?.loopEnd ?? waveRef?.loopEnd ?? 0;
                      const pan = regArt?.pan ?? globalArt.pan ?? 0;

                      if (regArt && Object.keys(regArt.ampEnv).length > 0 && Object.keys(globalArt.ampEnv).length === 0) {
                        globalArt = regArt;
                      }

                      regions.push({
                        lowKey,
                        highKey,
                        lowVel,
                        highVel,
                        keyGroup,
                        rootKey,
                        detuneCents,
                        volumeDb,
                        pan,
                        loopMode,
                        loopStart,
                        loopEnd,
                        waveIndex,
                      });
                    }
                  }
                  rp = rEnd + (rSize & 1);
                }
              }
            }
            sub = sEnd + (sSize & 1);
          }

          const ampEnv: DahdsrEnvelope = {
            delaySec: globalArt.ampEnv.delaySec ?? 0,
            attackSec: globalArt.ampEnv.attackSec ?? 0.005,
            holdSec: globalArt.ampEnv.holdSec ?? 0,
            decaySec: globalArt.ampEnv.decaySec ?? 0.25,
            sustainLevel: globalArt.ampEnv.sustainLevel ?? 1.0,
            releaseSec: globalArt.ampEnv.releaseSec ?? 0.2,
            velModDepth: 100,
          };

          const eg2Full: DahdsrEnvelope = {
            delaySec: globalArt.eg2Env.delaySec ?? 0,
            attackSec: globalArt.eg2Env.attackSec ?? 0.005,
            holdSec: globalArt.eg2Env.holdSec ?? 0,
            decaySec: globalArt.eg2Env.decaySec ?? 0.2,
            sustainLevel: globalArt.eg2Env.sustainLevel ?? 0,
            releaseSec: globalArt.eg2Env.releaseSec ?? 0.15,
            velModDepth: 0,
          };

          const filter: RegionFilterConfig = {
            enabled: Boolean(globalArt.filter.enabled),
            type: 'lpf',
            poles: 2,
            cutoffHz: globalArt.filter.cutoffHz ?? 20000,
            resonanceDb: globalArt.filter.resonanceDb ?? 0,
            envToFilterCents: globalArt.filter.envToFilterCents ?? 0,
            velToFilterCents: 0,
            keytrackCents: globalArt.filter.keytrackCents ?? 0,
            filterEnv: eg2Full,
          };

          let pitchEnv: PitchEnvelopeConfig | undefined;
          if (globalArt.pitchEnvDepthCents && Math.abs(globalArt.pitchEnvDepthCents) > 0) {
            pitchEnv = {
              enabled: true,
              depthCents: globalArt.pitchEnvDepthCents,
              env: eg2Full,
            };
          }

          instruments.push({
            index: instIdx,
            bank: ulBank & 0x7fff,
            program: ulInstrument & 0x7f,
            isDrum: (ulBank & 0x80000000) !== 0,
            name: instName,
            regions,
            ampEnv,
            filter,
            pitchEnv,
          });
          instIdx++;
        }
        ip = iEnd + (iSize & 1);
      }
    }
    pos = chunkEnd + (chunkSize & 1);
  }

  return {
    bankName,
    author,
    copyright,
    comment,
    instruments,
    waves,
  };
}

function makeChunk(id: string, payload: Uint8Array): Uint8Array {
  const pad = payload.byteLength & 1;
  const out = new Uint8Array(8 + payload.byteLength + pad);
  const view = new DataView(out.buffer);
  writeFourCC(out, 0, id);
  view.setUint32(4, payload.byteLength, true);
  out.set(payload, 8);
  return out;
}

function makeListChunk(listType: string, children: Uint8Array[]): Uint8Array {
  let bodyLen = 4;
  for (const c of children) bodyLen += c.byteLength;
  const pad = bodyLen & 1;
  const out = new Uint8Array(8 + bodyLen + pad);
  const view = new DataView(out.buffer);
  writeFourCC(out, 0, 'LIST');
  view.setUint32(4, bodyLen, true);
  writeFourCC(out, 8, listType);
  let ptr = 12;
  for (const c of children) {
    out.set(c, ptr);
    ptr += c.byteLength;
  }
  return out;
}

function makeAsciiChunk(id: string, text: string): Uint8Array {
  const clean = text.slice(0, 120);
  const bytes = new Uint8Array(clean.length + 1);
  for (let i = 0; i < clean.length; i++) {
    bytes[i] = clean.charCodeAt(i) & 0x7f;
  }
  bytes[clean.length] = 0;
  return makeChunk(id, bytes);
}

function buildWsmpBytes(opts: {
  rootKey: number;
  detuneCents: number;
  volumeDb: number;
  loopMode: LoopMode;
  loopStart: number;
  loopEnd: number;
}): Uint8Array {
  const hasLoop = opts.loopMode !== 'no_loop' && opts.loopMode !== 'one_shot' && opts.loopEnd > opts.loopStart;
  const bytes = new Uint8Array(hasLoop ? 36 : 20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 20, true); // cbSize = 20
  view.setUint16(4, Math.max(0, Math.min(127, opts.rootKey)), true);
  view.setInt16(6, Math.max(-1200, Math.min(1200, Math.round(opts.detuneCents))), true);
  // Attenuation in 1/655360 dB (0 dB = 0, negative dB = negative value)
  const atten = Math.round(Math.max(-60, Math.min(12, opts.volumeDb)) * 655360);
  view.setInt32(8, atten, true);
  view.setUint32(12, 1, true); // fulOptions = F_WSMP_NO_TRUNCATION
  view.setUint32(16, hasLoop ? 1 : 0, true);
  if (hasLoop) {
    const start = Math.max(0, Math.round(opts.loopStart));
    const len = Math.max(1, Math.round(opts.loopEnd) - start);
    view.setUint32(20, 16, true); // cbSize = 16
    view.setUint32(24, 0, true); // ulLoopType = WLOOP_TYPE_FORWARD
    view.setUint32(28, start, true);
    view.setUint32(32, len, true);
  }
  return makeChunk('wsmp', bytes);
}

/**
 * Builds a complete Little-Endian RIFF `"DLS "` Level 2 bank binary.
 */
export function buildDlsBinary(options: {
  bankName: string;
  author?: string;
  copyright?: string;
  comment?: string;
  regions: Array<
    UniformSamplerRegion & {
      pcm16Mono: Int16Array;
      sampleRate: number;
    }
  >;
  ampEnv?: Partial<DahdsrEnvelope>;
  filter?: Partial<RegionFilterConfig>;
  pitchEnv?: Partial<PitchEnvelopeConfig>;
}): Uint8Array {
  const {
    bankName,
    author = 'ABDNeuModMakr',
    copyright = 'CC-BY 4.0',
    comment = 'DLS Level 2 Multisample Bank',
    regions,
    ampEnv,
    filter,
    pitchEnv,
  } = options;

  // 1. Deduplicate waves
  const uniqueWaves: Array<{
    sampleName: string;
    pcm16Mono: Int16Array;
    sampleRate: number;
    rootKey: number;
    detuneCents: number;
    loopMode: LoopMode;
    loopStart: number;
    loopEnd: number;
  }> = [];
  const waveIdxByName = new Map<string, number>();

  for (const reg of regions) {
    if (!waveIdxByName.has(reg.sampleName)) {
      waveIdxByName.set(reg.sampleName, uniqueWaves.length);
      uniqueWaves.push({
        sampleName: reg.sampleName,
        pcm16Mono: reg.pcm16Mono,
        sampleRate: reg.sampleRate,
        rootKey: reg.rootKey,
        detuneCents: 0,
        loopMode: reg.loopMode,
        loopStart: reg.loopStart,
        loopEnd: reg.loopEnd,
      });
    }
  }

  // 2. Build wave LIST chunks and record offsets inside wvpl payload
  const waveListChunks: Uint8Array[] = [];
  const poolOffsets: number[] = [];
  let currentWvplOffset = 0; // relative to start of wvpl data (after 'wvpl' fourCC)

  for (const w of uniqueWaves) {
    poolOffsets.push(currentWvplOffset);
    // fmt chunk (18 bytes)
    const fmtBytes = new Uint8Array(18);
    const fmtView = new DataView(fmtBytes.buffer);
    fmtView.setUint16(0, 1, true); // PCM
    fmtView.setUint16(2, 1, true); // 1 channel (mono)
    fmtView.setUint32(4, w.sampleRate, true);
    fmtView.setUint32(8, w.sampleRate * 2, true);
    fmtView.setUint16(12, 2, true); // blockAlign
    fmtView.setUint16(14, 16, true); // 16-bit
    fmtView.setUint16(16, 0, true);
    const fmtChunk = makeChunk('fmt ', fmtBytes);

    const wsmpChunk = buildWsmpBytes({
      rootKey: w.rootKey,
      detuneCents: w.detuneCents,
      volumeDb: 0,
      loopMode: w.loopMode,
      loopStart: w.loopStart,
      loopEnd: w.loopEnd,
    });

    const pcmBytes = new Uint8Array(w.pcm16Mono.length * 2);
    const pcmView = new DataView(pcmBytes.buffer);
    for (let i = 0; i < w.pcm16Mono.length; i++) {
      pcmView.setInt16(i * 2, w.pcm16Mono[i], true);
    }
    const dataChunk = makeChunk('data', pcmBytes);
    const infoList = makeListChunk('INFO', [makeAsciiChunk('INAM', w.sampleName.replace(/\.[^.]+$/, ''))]);

    const waveList = makeListChunk('wave', [fmtChunk, wsmpChunk, dataChunk, infoList]);
    waveListChunks.push(waveList);
    currentWvplOffset += waveList.byteLength;
  }

  // 3. Build Region LIST('rgn2') chunks
  const rgnListChunks: Uint8Array[] = [];
  for (const reg of regions) {
    const rgnhBytes = new Uint8Array(14);
    const rgnhView = new DataView(rgnhBytes.buffer);
    rgnhView.setUint16(0, Math.max(0, Math.min(127, reg.lowKey)), true);
    rgnhView.setUint16(2, Math.max(0, Math.min(127, reg.highKey)), true);
    rgnhView.setUint16(4, Math.max(1, Math.min(127, reg.lowVel)), true);
    rgnhView.setUint16(6, Math.max(1, Math.min(127, reg.highVel)), true);
    rgnhView.setUint16(8, 1, true); // F_RGN_OPTION_SELFNONEXCLUSIVE
    rgnhView.setUint16(10, Math.max(0, Math.min(15, reg.muteGroup ?? 0)), true);
    rgnhView.setUint16(12, 1, true);
    const rgnhChunk = makeChunk('rgnh', rgnhBytes);

    const coarseSt = Math.trunc(reg.detuneCents / 100);
    const fineCents = Math.round(reg.detuneCents - coarseSt * 100);
    const adjustedRoot = Math.max(0, Math.min(127, reg.rootKey - coarseSt));
    const wsmpChunk = buildWsmpBytes({
      rootKey: adjustedRoot,
      detuneCents: fineCents,
      volumeDb: reg.volumeDb,
      loopMode: reg.loopMode,
      loopStart: reg.loopStart,
      loopEnd: reg.loopEnd,
    });

    const wlnkBytes = new Uint8Array(12);
    const wlnkView = new DataView(wlnkBytes.buffer);
    wlnkView.setUint16(0, 0, true); // options
    wlnkView.setUint16(2, 0, true); // phaseGroup
    wlnkView.setUint32(4, 1, true); // channel = 1 (left/mono)
    wlnkView.setUint32(8, waveIdxByName.get(reg.sampleName) ?? 0, true);
    const wlnkChunk = makeChunk('wlnk', wlnkBytes);

    const children: Uint8Array[] = [rgnhChunk, wsmpChunk, wlnkChunk];
    if (reg.pan !== 0) {
      const artBytes = new Uint8Array(8 + 12);
      const artView = new DataView(artBytes.buffer);
      artView.setUint32(0, 8, true);
      artView.setUint32(4, 1, true);
      artView.setUint16(8, CONN_SRC_NONE, true);
      artView.setUint16(10, CONN_SRC_NONE, true);
      artView.setUint16(12, CONN_DST_PAN, true);
      artView.setUint16(14, 0, true);
      artView.setInt32(16, Math.round((reg.pan / 100) * 1000 * 65536), true);
      children.push(makeListChunk('lar2', [makeChunk('art2', artBytes)]));
    }

    rgnListChunks.push(makeListChunk('rgn2', children));
  }

  // 4. Build Instrument Articulation ('lar2' -> 'art2')
  const connBlocks: Array<{ src: number; ctl: number; dst: number; trn: number; scale: number }> = [
    { src: CONN_SRC_NONE, ctl: CONN_SRC_NONE, dst: CONN_DST_EG1_DELAYTIME, trn: 0, scale: secondsToDlsScale(ampEnv?.delaySec ?? 0) },
    { src: CONN_SRC_NONE, ctl: CONN_SRC_NONE, dst: CONN_DST_EG1_ATTACKTIME, trn: 0, scale: secondsToDlsScale(ampEnv?.attackSec ?? 0.005) },
    { src: CONN_SRC_NONE, ctl: CONN_SRC_NONE, dst: CONN_DST_EG1_HOLDTIME, trn: 0, scale: secondsToDlsScale(ampEnv?.holdSec ?? 0) },
    { src: CONN_SRC_NONE, ctl: CONN_SRC_NONE, dst: CONN_DST_EG1_DECAYTIME, trn: 0, scale: secondsToDlsScale(ampEnv?.decaySec ?? 0.25) },
    { src: CONN_SRC_NONE, ctl: CONN_SRC_NONE, dst: CONN_DST_EG1_SUSTAINLEVEL, trn: 0, scale: unitRatioToDlsScale(ampEnv?.sustainLevel ?? 1.0) },
    { src: CONN_SRC_NONE, ctl: CONN_SRC_NONE, dst: CONN_DST_EG1_RELEASETIME, trn: 0, scale: secondsToDlsScale(ampEnv?.releaseSec ?? 0.2) },
    { src: CONN_SRC_KEYONVELOCITY, ctl: CONN_SRC_NONE, dst: CONN_DST_GAIN, trn: 0, scale: Math.round(96 * 655360) },
  ];

  const eg2Source = filter?.filterEnv ?? pitchEnv?.env;
  if (eg2Source) {
    connBlocks.push(
      { src: CONN_SRC_NONE, ctl: CONN_SRC_NONE, dst: CONN_DST_EG2_ATTACKTIME, trn: 0, scale: secondsToDlsScale(eg2Source.attackSec ?? 0.005) },
      { src: CONN_SRC_NONE, ctl: CONN_SRC_NONE, dst: CONN_DST_EG2_DECAYTIME, trn: 0, scale: secondsToDlsScale(eg2Source.decaySec ?? 0.2) },
      { src: CONN_SRC_NONE, ctl: CONN_SRC_NONE, dst: CONN_DST_EG2_SUSTAINLEVEL, trn: 0, scale: unitRatioToDlsScale(eg2Source.sustainLevel ?? 0) },
      { src: CONN_SRC_NONE, ctl: CONN_SRC_NONE, dst: CONN_DST_EG2_RELEASETIME, trn: 0, scale: secondsToDlsScale(eg2Source.releaseSec ?? 0.15) }
    );
  }

  if (filter?.enabled) {
    connBlocks.push(
      { src: CONN_SRC_NONE, ctl: CONN_SRC_NONE, dst: CONN_DST_FILTER_CUTOFF, trn: 0, scale: hzToDlsScale(filter.cutoffHz ?? 20000) },
      { src: CONN_SRC_NONE, ctl: CONN_SRC_NONE, dst: CONN_DST_FILTER_Q, trn: 0, scale: Math.round(Math.max(0, filter.resonanceDb ?? 0) * 655360) }
    );
    if (filter.envToFilterCents) {
      connBlocks.push({
        src: CONN_SRC_EG2,
        ctl: CONN_SRC_NONE,
        dst: CONN_DST_FILTER_CUTOFF,
        trn: 0,
        scale: Math.round(filter.envToFilterCents * 65536),
      });
    }
    if (filter.keytrackCents) {
      connBlocks.push({
        src: CONN_SRC_KEYNUMBER,
        ctl: CONN_SRC_NONE,
        dst: CONN_DST_FILTER_CUTOFF,
        trn: 0,
        scale: Math.round(filter.keytrackCents * 65536),
      });
    }
  }

  if (pitchEnv?.enabled && pitchEnv.depthCents) {
    connBlocks.push({
      src: CONN_SRC_EG2,
      ctl: CONN_SRC_NONE,
      dst: CONN_DST_PITCH,
      trn: 0,
      scale: Math.round(pitchEnv.depthCents * 65536),
    });
  }

  const art2Bytes = new Uint8Array(8 + connBlocks.length * 12);
  const art2View = new DataView(art2Bytes.buffer);
  art2View.setUint32(0, 8, true);
  art2View.setUint32(4, connBlocks.length, true);
  connBlocks.forEach((b, idx) => {
    const off = 8 + idx * 12;
    art2View.setUint16(off + 0, b.src, true);
    art2View.setUint16(off + 2, b.ctl, true);
    art2View.setUint16(off + 4, b.dst, true);
    art2View.setUint16(off + 6, b.trn, true);
    art2View.setInt32(off + 8, b.scale, true);
  });

  // 5. Build LIST('ins ') -> LIST('lins')
  const inshBytes = new Uint8Array(12);
  const inshView = new DataView(inshBytes.buffer);
  inshView.setUint32(0, rgnListChunks.length, true);
  inshView.setUint32(4, 0, true); // bank 0
  inshView.setUint32(8, 0, true); // program 0
  const inshChunk = makeChunk('insh', inshBytes);
  const lrgnList = makeListChunk('lrgn', rgnListChunks);
  const lar2List = makeListChunk('lar2', [makeChunk('art2', art2Bytes)]);
  const insInfoList = makeListChunk('INFO', [makeAsciiChunk('INAM', bankName)]);
  const insList = makeListChunk('ins ', [inshChunk, lrgnList, lar2List, insInfoList]);
  const linsList = makeListChunk('lins', [insList]);

  // 6. Build colh, ptbl, wvpl, INFO
  const colhBytes = new Uint8Array(4);
  new DataView(colhBytes.buffer).setUint32(0, 1, true); // 1 instrument
  const colhChunk = makeChunk('colh', colhBytes);

  const ptblBytes = new Uint8Array(8 + poolOffsets.length * 4);
  const ptblView = new DataView(ptblBytes.buffer);
  ptblView.setUint32(0, 8, true); // cbSize = 8
  ptblView.setUint32(4, poolOffsets.length, true); // cCues
  poolOffsets.forEach((off, idx) => {
    ptblView.setUint32(8 + idx * 4, off, true);
  });
  const ptblChunk = makeChunk('ptbl', ptblBytes);
  const wvplList = makeListChunk('wvpl', waveListChunks);
  const bankInfoList = makeListChunk('INFO', [
    makeAsciiChunk('INAM', bankName),
    makeAsciiChunk('IART', author),
    makeAsciiChunk('ICOP', copyright),
    makeAsciiChunk('ICMT', comment),
  ]);

  const topChunks = [colhChunk, linsList, ptblChunk, wvplList, bankInfoList];
  let riffBodyLen = 4;
  for (const c of topChunks) riffBodyLen += c.byteLength;
  const out = new Uint8Array(8 + riffBodyLen);
  const outView = new DataView(out.buffer);
  writeFourCC(out, 0, 'RIFF');
  outView.setUint32(4, riffBodyLen, true);
  writeFourCC(out, 8, 'DLS ');
  let ptr = 12;
  for (const c of topChunks) {
    out.set(c, ptr);
    ptr += c.byteLength;
  }

  return out;
}
