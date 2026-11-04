// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Apple Logic EXS24 / Sampler (.exs) Reader & Writer (Fase 32.4)
//
// Clean-room binary implementation of Apple Logic EXS24 / Logic Pro Sampler (.exs).
// Supports both Big-Endian ("SOBT"/"SOBJ", endianFlag=0) and Little-Endian ("TBOS"/"JBOS", endianFlag=1)
// sequential 84-byte block headers + payloads:
//   - Block 0x00: Instrument Header
//   - Block 0x01: Zone (key/vel range, root, coarse/fine tune, sampleStart/End, loop, reverse, one-shot, group/sample links)
//   - Block 0x02: Group (polyphony, mute/exclusive class, release trigger, keyswitch, key/vel crossfade, round-robin)
//   - Block 0x03: Sample Descriptor (length, sampleRate, bitDepth, fileName/filePath)
//   - Block 0x04: Global Synth Parameters (Filter, Env1 Pitch/Filter, Env2 Amp, PitchBend, Polyphony)
// Reference: Jürgen Moßgraber's ConvertWithMoss format documentation.
// ─────────────────────────────────────────────────────────

import type {
  DahdsrEnvelope,
  FilterSlopePoles,
  LoopMode,
  MidiNote,
  PitchEnvelopeConfig,
  RegionFilterConfig,
  SamplerPlayLogic,
  TriggerMode,
} from './SamplerTypes.ts';
import type { UniformSamplerRegion } from './rawSamplerTypes.ts';

export interface Exs24ZoneRecord {
  id: number;
  name: string;
  rootKey: number;
  lowKey: number;
  highKey: number;
  lowVel: number;
  highVel: number;
  coarseTuneSt: number;
  fineTuneCents: number;
  volumeDb: number;
  pan: number; // -50..+50
  pitchKeytrack: number; // 100 or 0
  oneShot: boolean;
  reversed: boolean;
  sampleStartFrame: number;
  sampleEndFrame: number;
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  loopCrossfadeMs: number;
  loopEqualPower: boolean;
  loopMode: LoopMode;
  groupIndex: number;
  sampleIndex: number;
}

export interface Exs24GroupRecord {
  id: number;
  name: string;
  volumeDb: number;
  pan: number;
  polyphony: number;
  muteGroup: number;
  velCrossfade: number;
  keyCrossfade: number;
  trigger: TriggerMode;
  playLogic: SamplerPlayLogic;
  roundRobinPos: number;
  keyswitchNote?: MidiNote;
}

export interface Exs24SampleRecord {
  id: number;
  name: string;
  lengthFrames: number;
  sampleRate: number;
  bitDepth: number;
  channels: number;
  filePath: string;
  fileName: string;
}

export interface ParsedExs24Instrument {
  presetName: string;
  isBigEndian: boolean;
  zones: Exs24ZoneRecord[];
  groups: Exs24GroupRecord[];
  samples: Exs24SampleRecord[];
  ampEnv: DahdsrEnvelope;
  filter: RegionFilterConfig;
  pitchEnv?: PitchEnvelopeConfig;
  pitchBendUpSt: number;
  pitchBendDownSt: number;
  polyphony: number;
}

function readAsciiFixed(bytes: Uint8Array, offset: number, maxLen: number): string {
  const end = Math.min(bytes.byteLength, offset + maxLen);
  let str = '';
  for (let i = offset; i < end; i++) {
    const b = bytes[i];
    if (b === 0) break;
    if (b >= 32 && b < 127) str += String.fromCharCode(b);
  }
  return str.trim();
}

function writeAsciiFixed(bytes: Uint8Array, offset: number, maxLen: number, text: string): void {
  const len = Math.min(maxLen - 1, text.length);
  for (let i = 0; i < len; i++) {
    bytes[offset + i] = text.charCodeAt(i) & 0x7f;
  }
  bytes[offset + len] = 0;
}

// EXS24 envelope parameter [0..127] <-> seconds [0..10s] quartic law
function exsParamToEnvSec(paramVal: number): number {
  const clamped = Math.max(0, Math.min(127, paramVal));
  return Math.max(0.001, 10 * Math.pow(clamped / 127, 4));
}

function envSecToExsParam(sec: number): number {
  const clamped = Math.max(0, Math.min(10, sec));
  return Math.max(0, Math.min(127, Math.round(127 * Math.pow(clamped / 10, 0.25))));
}

/**
 * Checks whether a buffer starts with a valid EXS24 84-byte header ("SOBT", "SOBJ", "TBOS", "JBOS" at +16).
 */
export function isExs24Buffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 84) return false;
  const bytes = new Uint8Array(buffer, 0, 84);
  const magic =
    String.fromCharCode(bytes[16], bytes[17], bytes[18], bytes[19]);
  return magic === 'SOBT' || magic === 'SOBJ' || magic === 'TBOS' || magic === 'JBOS';
}

/**
 * Parses an Apple Logic EXS24 `.exs` binary buffer.
 */
export function parseExs24(buffer: ArrayBuffer, fallbackName = 'EXS24Instrument'): ParsedExs24Instrument {
  if (!isExs24Buffer(buffer)) {
    throw new Error('Invalid EXS24 file: missing SOBT/TBOS magic at offset +16.');
  }

  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const le = bytes[0] !== 0; // 0 = BE, 1 = LE

  let presetName = fallbackName;
  const zones: Exs24ZoneRecord[] = [];
  const groups: Exs24GroupRecord[] = [];
  const samples: Exs24SampleRecord[] = [];
  const paramsMap = new Map<number, number>();

  let pos = 0;
  while (pos + 84 <= bytes.byteLength) {
    const magic = readAsciiFixed(bytes, pos + 16, 4);
    if (magic !== 'SOBT' && magic !== 'SOBJ' && magic !== 'TBOS' && magic !== 'JBOS') {
      break;
    }

    const typeAndFlags = bytes[pos + 3];
    const blockType = typeAndFlags & 0x0f;
    let payloadSize = view.getUint32(pos + 4, le);
    if ((typeAndFlags & 0x80) !== 0 && payloadSize > 0x8000) {
      payloadSize &= 0x7fff;
    }
    const blockIndex = view.getUint32(pos + 8, le);
    const blockName = readAsciiFixed(bytes, pos + 20, 64);

    const payloadOffset = pos + 84;
    if (payloadOffset + payloadSize > bytes.byteLength) {
      break;
    }

    if (blockType === 0) {
      // Instrument Header — preserve meaningful filename if header has generic Logic default ("Instrument #2")
      if (blockName && !/^(instrument\s*#?\d*|untitled|default|exs24instrument)$/i.test(blockName.trim())) {
        presetName = blockName;
      }
    } else if (blockType === 1 && payloadSize >= 96) {
      // Zone Block
      const zoneOpts = bytes[payloadOffset + 0];
      const oneShot = (zoneOpts & 0x01) !== 0;
      const noPitchTrack = (zoneOpts & 0x02) !== 0;
      const reversed = (zoneOpts & 0x04) !== 0;
      const velRangeOn = (zoneOpts & 0x08) !== 0;

      const rootKey = Math.max(0, Math.min(127, bytes[payloadOffset + 1]));
      const fineTuneCents = view.getInt8(payloadOffset + 2);
      const pan = Math.max(-50, Math.min(50, view.getInt8(payloadOffset + 3)));
      const volumeDb = view.getInt8(payloadOffset + 4);
      const lowKey = Math.max(0, Math.min(127, bytes[payloadOffset + 6]));
      const highKey = Math.max(0, Math.min(127, bytes[payloadOffset + 7]));
      const lowVel = velRangeOn ? Math.max(1, Math.min(127, bytes[payloadOffset + 9])) : 1;
      const highVel = velRangeOn ? Math.max(1, Math.min(127, bytes[payloadOffset + 10])) : 127;

      const sampleStartFrame = view.getUint32(payloadOffset + 12, le);
      const sampleEndFrame = view.getUint32(payloadOffset + 16, le);
      const loopStart = view.getUint32(payloadOffset + 20, le);
      const loopEnd = view.getUint32(payloadOffset + 24, le);
      const loopCrossfadeMs = view.getUint32(payloadOffset + 28, le);
      const loopOptions = bytes[payloadOffset + 33];
      const loopDirection = bytes[payloadOffset + 34];
      const loopEnabled = (loopOptions & 0x01) !== 0 && loopEnd > loopStart;
      const loopEqualPower = (loopOptions & 0x02) !== 0;

      const coarseTuneSt = payloadSize > 80 ? view.getInt8(payloadOffset + 80) : 0;
      const groupIndex = view.getInt32(payloadOffset + 88, le);
      const sampleIndex = view.getInt32(payloadOffset + 92, le);

      const loopMode: LoopMode = oneShot
        ? 'one_shot'
        : !loopEnabled
          ? 'no_loop'
          : loopDirection === 2
            ? 'ping_pong'
            : loopDirection === 1
              ? 'loop_backward'
              : 'loop_continuous';

      zones.push({
        id: blockIndex,
        name: blockName || `Zone_${zones.length + 1}`,
        rootKey,
        lowKey,
        highKey,
        lowVel,
        highVel,
        coarseTuneSt,
        fineTuneCents,
        volumeDb,
        pan,
        pitchKeytrack: noPitchTrack ? 0 : 100,
        oneShot,
        reversed,
        sampleStartFrame,
        sampleEndFrame,
        loopEnabled,
        loopStart,
        loopEnd,
        loopCrossfadeMs,
        loopEqualPower,
        loopMode,
        groupIndex,
        sampleIndex,
      });
    } else if (blockType === 2 && payloadSize >= 64) {
      // Group Block
      const volumeDb = view.getInt8(payloadOffset + 0);
      const pan = Math.max(-50, Math.min(50, view.getInt8(payloadOffset + 1)));
      const polyphony = bytes[payloadOffset + 2] || 16;
      const muteGroup = bytes[payloadOffset + 4] || 0;
      const velCrossfade = Math.max(0, (bytes[payloadOffset + 32] || 128) - 128);
      const keyCrossfade = Math.max(0, (bytes[payloadOffset + 35] || 128) - 128);

      let trigger: TriggerMode = 'attack';
      let playLogic: SamplerPlayLogic = 'velocity';
      let roundRobinPos = -1;
      let keyswitchNote: MidiNote | undefined;

      if (payloadSize >= 90) {
        const relTrig = bytes[payloadOffset + 73];
        if (relTrig !== 0) trigger = 'release';
        roundRobinPos = view.getInt32(payloadOffset + 80, le);
        const enableByType = bytes[payloadOffset + 84];
        if (enableByType === 1) {
          keyswitchNote = Math.max(0, Math.min(127, bytes[payloadOffset + 88]));
        } else if (enableByType === 2 || roundRobinPos >= 0) {
          playLogic = 'round_robin';
        }
      }

      groups.push({
        id: blockIndex,
        name: blockName || `Group_${groups.length + 1}`,
        volumeDb,
        pan,
        polyphony,
        muteGroup,
        velCrossfade,
        keyCrossfade,
        trigger,
        playLogic,
        roundRobinPos,
        keyswitchNote,
      });
    } else if (blockType === 3 && payloadSize >= 84) {
      // Sample Block
      const lengthFrames = view.getUint32(payloadOffset + 4, le);
      const sampleRate = view.getUint32(payloadOffset + 8, le) || 44100;
      const bitDepth = view.getUint32(payloadOffset + 12, le) || 16;
      const channels = view.getUint32(payloadOffset + 16, le) || 2;
      const filePath = payloadSize >= 336 ? readAsciiFixed(bytes, payloadOffset + 80, 256) : '';
      const fileName =
        payloadSize >= 592
          ? readAsciiFixed(bytes, payloadOffset + 336, 256) || blockName
          : blockName || filePath.split(/[\\/:]/).filter(Boolean).pop() || `Sample_${samples.length + 1}.wav`;

      samples.push({
        id: blockIndex,
        name: blockName || fileName,
        lengthFrames,
        sampleRate,
        bitDepth,
        channels,
        filePath,
        fileName: fileName || blockName,
      });
    } else if (blockType === 4 && payloadSize >= 4) {
      // Parameters Block
      const count = Math.min(200, view.getUint32(payloadOffset + 0, le));
      const idsOffset = payloadOffset + 4;
      const valsOffset = idsOffset + count;
      if (valsOffset + count * 2 <= payloadOffset + payloadSize) {
        for (let i = 0; i < count; i++) {
          const pid = bytes[idsOffset + i];
          const pval = view.getInt16(valsOffset + i * 2, le);
          if (pid !== 0) paramsMap.set(pid, pval);
        }
      }
    }

    pos = payloadOffset + payloadSize;
  }

  // Decode synth parameters
  const polyphony = Math.max(1, Math.min(64, paramsMap.get(5) ?? 16));
  const pitchBendUpSt = Math.max(0, Math.min(24, paramsMap.get(8) ?? 2));
  const pitchBendDownSt = Math.max(0, Math.min(24, paramsMap.get(9) ?? pitchBendUpSt));

  const ampEnv: DahdsrEnvelope = {
    delaySec: 0,
    attackSec: paramsMap.has(77) ? exsParamToEnvSec(paramsMap.get(77)!) : 0.005,
    holdSec: paramsMap.has(78) && paramsMap.get(78)! > 0 ? exsParamToEnvSec(paramsMap.get(78)!) : 0,
    decaySec: paramsMap.has(79) ? exsParamToEnvSec(paramsMap.get(79)!) : 0.25,
    sustainLevel: paramsMap.has(80) ? Math.max(0, Math.min(1, paramsMap.get(80)! / 127)) : 1.0,
    releaseSec: paramsMap.has(81) ? exsParamToEnvSec(paramsMap.get(81)!) : 0.2,
    velModDepth: 100,
  };

  const filterOn = (paramsMap.get(44) ?? 0) !== 0;
  const fltTypeCode = paramsMap.get(243) ?? 0;
  let fltType: RegionFilterConfig['type'] = 'lpf';
  let poles: FilterSlopePoles = 4;
  if (fltTypeCode === 1) {
    fltType = 'lpf';
    poles = 3;
  } else if (fltTypeCode === 2) {
    fltType = 'lpf';
    poles = 2;
  } else if (fltTypeCode === 3) {
    fltType = 'lpf';
    poles = 1;
  } else if (fltTypeCode === 4) {
    fltType = 'hpf';
    poles = 2;
  } else if (fltTypeCode === 5) {
    fltType = 'bpf';
    poles = 2;
  }

  const cutoffNorm = Math.max(0, Math.min(1000, paramsMap.get(45) ?? 1000)) / 1000;
  const cutoffHz = Math.round(20 * Math.pow(1000, cutoffNorm));
  const resNorm = Math.max(0, Math.min(1000, paramsMap.get(46) ?? 0)) / 1000;
  const keytrackNorm = Math.max(0, Math.min(100, paramsMap.get(60) ?? 0));

  const env1: DahdsrEnvelope = {
    delaySec: 0,
    attackSec: paramsMap.has(72) ? exsParamToEnvSec(paramsMap.get(72)!) : 0.005,
    holdSec: 0,
    decaySec: paramsMap.has(73) ? exsParamToEnvSec(paramsMap.get(73)!) : 0.2,
    sustainLevel: paramsMap.has(74) ? Math.max(0, Math.min(1, paramsMap.get(74)! / 127)) : 0,
    releaseSec: paramsMap.has(75) ? exsParamToEnvSec(paramsMap.get(75)!) : 0.15,
    velModDepth: 0,
  };

  const filter: RegionFilterConfig = {
    enabled: filterOn,
    type: fltType,
    poles,
    cutoffHz,
    resonanceDb: Math.round(resNorm * 24 * 10) / 10,
    envToFilterCents: filterOn ? 2400 : 0,
    velToFilterCents: 0,
    keytrackCents: Math.round((keytrackNorm / 100) * 1200),
    filterEnv: env1,
  };

  return {
    presetName,
    isBigEndian: !le,
    zones,
    groups,
    samples,
    ampEnv,
    filter,
    pitchBendUpSt,
    pitchBendDownSt,
    polyphony,
  };
}

/**
 * Builds a standard Big-Endian ("SOBT") Apple Logic EXS24 `.exs` binary file.
 */
export function buildExs24Binary(options: {
  presetName: string;
  regions: Array<
    UniformSamplerRegion & {
      cleanFileName: string;
      totalFrames: number;
      sampleRate: number;
      bitDepth: number;
      channels: number;
      byteLength: number;
    }
  >;
  ampEnv?: Partial<DahdsrEnvelope>;
  filter?: Partial<RegionFilterConfig>;
  polyphony?: number;
  pitchBendUpSt?: number;
  pitchBendDownSt?: number;
}): Uint8Array {
  const {
    presetName,
    regions,
    ampEnv,
    filter,
    polyphony = 16,
    pitchBendUpSt = 2,
    pitchBendDownSt = 2,
  } = options;

  // Deduplicate sample descriptors
  const sampleList: Array<{
    cleanFileName: string;
    totalFrames: number;
    sampleRate: number;
    bitDepth: number;
    channels: number;
    byteLength: number;
  }> = [];
  const sampleIdxByFile = new Map<string, number>();
  for (const reg of regions) {
    if (!sampleIdxByFile.has(reg.cleanFileName)) {
      sampleIdxByFile.set(reg.cleanFileName, sampleList.length);
      sampleList.push({
        cleanFileName: reg.cleanFileName,
        totalFrames: reg.totalFrames,
        sampleRate: reg.sampleRate,
        bitDepth: reg.bitDepth,
        channels: reg.channels,
        byteLength: reg.byteLength,
      });
    }
  }

  // Group regions by groupName / muteGroup / trigger / keyswitchNote
  const groupList: Array<{
    name: string;
    muteGroup: number;
    trigger: TriggerMode;
    playLogic: SamplerPlayLogic;
    keyswitchNote?: MidiNote;
    keyCrossfade: number;
    velCrossfade: number;
  }> = [];
  const groupIdxByKey = new Map<string, number>();
  for (const reg of regions) {
    const gKey = `${reg.groupName || 'Main'}|${reg.muteGroup ?? 0}|${reg.trigger ?? 'attack'}|${reg.keyswitchNote ?? -1}`;
    if (!groupIdxByKey.has(gKey)) {
      groupIdxByKey.set(gKey, groupList.length);
      groupList.push({
        name: reg.groupName || `Group ${groupList.length + 1}`,
        muteGroup: reg.muteGroup ?? 0,
        trigger: reg.trigger ?? 'attack',
        playLogic: reg.playLogic ?? 'velocity',
        keyswitchNote: reg.keyswitchNote,
        keyCrossfade: Math.max(reg.keyFadeIn ?? 0, reg.keyFadeOut ?? 0),
        velCrossfade: Math.max(reg.velFadeIn ?? 0, reg.velFadeOut ?? 0),
      });
    }
  }

  const numZones = regions.length;
  const numGroups = groupList.length;
  const numSamples = sampleList.length;
  const numParams = 1;

  const instBlockSize = 84 + 40;
  const zoneBlockSize = 84 + 192;
  const groupBlockSize = 84 + 96;
  const sampleBlockSize = 84 + 592;
  const paramPayloadSize = 4 + 100 + 200; // 304 bytes
  const paramBlockSize = 84 + paramPayloadSize;

  const totalBytes =
    instBlockSize +
    numZones * zoneBlockSize +
    numGroups * groupBlockSize +
    numSamples * sampleBlockSize +
    paramBlockSize;

  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);
  const le = false; // Write canonical Big-Endian "SOBT"

  const writeHeader = (
    offset: number,
    blockType: number,
    payloadSize: number,
    blockIndex: number,
    name: string
  ) => {
    out[offset + 0] = 0; // BE
    out[offset + 1] = 1;
    out[offset + 2] = 0;
    out[offset + 3] = blockType & 0x0f;
    view.setUint32(offset + 4, payloadSize, le);
    view.setUint32(offset + 8, blockIndex, le);
    writeAsciiFixed(out, offset + 16, 5, 'SOBT');
    writeAsciiFixed(out, offset + 20, 64, name.slice(0, 63));
  };

  let ptr = 0;

  // 1. Instrument Header (0x00, 40B payload)
  writeHeader(ptr, 0x00, 40, 0, presetName);
  const instPayload = ptr + 84;
  view.setUint32(instPayload + 4, numZones, le);
  view.setUint32(instPayload + 8, numGroups, le);
  view.setUint32(instPayload + 12, numSamples, le);
  view.setUint32(instPayload + 16, numParams, le);
  ptr += instBlockSize;

  // 2. Zone Blocks (0x01, 192B payload)
  regions.forEach((reg, idx) => {
    writeHeader(ptr, 0x01, 192, idx, reg.cleanFileName.replace(/\.[^.]+$/, ''));
    const p = ptr + 84;
    const isOneShot = reg.loopMode === 'one_shot';
    const noPitchTrack = reg.pitchKeytrack === 0;
    const isRev = Boolean(reg.reversed);
    let zoneOpts = 0x08; // velocity range active
    if (isOneShot) zoneOpts |= 0x01;
    if (noPitchTrack) zoneOpts |= 0x02;
    if (isRev) zoneOpts |= 0x04;
    out[p + 0] = zoneOpts;
    out[p + 1] = Math.max(0, Math.min(127, reg.rootKey));

    const coarseSt = Math.max(-48, Math.min(48, Math.trunc(reg.detuneCents / 100)));
    const fineCents = Math.max(-50, Math.min(50, Math.round(reg.detuneCents - coarseSt * 100)));
    view.setInt8(p + 2, fineCents);
    view.setInt8(p + 3, Math.max(-50, Math.min(50, Math.round(reg.pan))));
    view.setInt8(p + 4, Math.max(-96, Math.min(12, Math.round(reg.volumeDb))));
    out[p + 6] = Math.max(0, Math.min(127, reg.lowKey));
    out[p + 7] = Math.max(0, Math.min(127, reg.highKey));
    out[p + 9] = Math.max(1, Math.min(127, reg.lowVel));
    out[p + 10] = Math.max(1, Math.min(127, reg.highVel));

    const startFrame = Math.max(0, Math.round(reg.sampleStartFrame ?? 0));
    const endFrame =
      reg.sampleEndFrame && reg.sampleEndFrame > startFrame
        ? Math.round(reg.sampleEndFrame)
        : reg.totalFrames;
    view.setUint32(p + 12, startFrame, le);
    view.setUint32(p + 16, endFrame, le);

    const hasLoop = reg.loopMode !== 'no_loop' && reg.loopMode !== 'one_shot' && reg.loopEnd > reg.loopStart;
    view.setUint32(p + 20, hasLoop ? Math.round(reg.loopStart) : 0, le);
    view.setUint32(p + 24, hasLoop ? Math.round(reg.loopEnd) : endFrame, le);
    view.setUint32(p + 28, Math.round(reg.loopCrossfadeMs ?? 0), le);

    let loopOpts = hasLoop ? 0x01 : 0x00;
    if (reg.crossfadeCurve === 'equal-power') loopOpts |= 0x02;
    out[p + 33] = loopOpts;
    out[p + 34] =
      reg.loopMode === 'ping_pong' ? 2 : reg.loopMode === 'loop_backward' ? 1 : 0;

    view.setInt8(p + 80, coarseSt);
    const gKey = `${reg.groupName || 'Main'}|${reg.muteGroup ?? 0}|${reg.trigger ?? 'attack'}|${reg.keyswitchNote ?? -1}`;
    const gIdx = groupIdxByKey.get(gKey) ?? 0;
    const sIdx = sampleIdxByFile.get(reg.cleanFileName) ?? 0;
    view.setInt32(p + 88, gIdx, le);
    view.setInt32(p + 92, sIdx, le);

    ptr += zoneBlockSize;
  });

  // 3. Group Blocks (0x02, 96B payload)
  groupList.forEach((grp, idx) => {
    writeHeader(ptr, 0x02, 96, idx, grp.name);
    const p = ptr + 84;
    view.setInt8(p + 0, 0); // volume
    view.setInt8(p + 1, 0); // pan
    out[p + 2] = Math.max(1, Math.min(64, polyphony));
    out[p + 4] = Math.max(0, Math.min(32, grp.muteGroup));
    out[p + 10] = 127; // max vel
    out[p + 32] = Math.min(255, 128 + grp.velCrossfade);
    out[p + 35] = Math.min(255, 128 + grp.keyCrossfade);
    out[p + 61] = 127; // high key
    out[p + 73] = grp.trigger === 'release' ? 1 : 0;
    view.setInt32(p + 80, grp.playLogic === 'round_robin' ? idx : -1, le);
    if (grp.keyswitchNote !== undefined) {
      out[p + 84] = 1; // enable by note
      out[p + 88] = grp.keyswitchNote;
      out[p + 89] = grp.keyswitchNote;
    } else if (grp.playLogic === 'round_robin') {
      out[p + 84] = 2; // enable by round robin
    }
    ptr += groupBlockSize;
  });

  // 4. Sample Blocks (0x03, 592B payload)
  sampleList.forEach((smp, idx) => {
    writeHeader(ptr, 0x03, 592, idx, smp.cleanFileName);
    const p = ptr + 84;
    view.setUint32(p + 4, smp.totalFrames, le);
    view.setUint32(p + 8, smp.sampleRate, le);
    view.setUint32(p + 12, smp.bitDepth, le);
    view.setUint32(p + 16, smp.channels, le);
    view.setUint32(p + 20, smp.channels, le);
    writeAsciiFixed(out, p + 28, 5, 'WAVE');
    view.setUint32(p + 32, smp.byteLength, le);
    writeAsciiFixed(out, p + 80, 256, `Samples/${smp.cleanFileName}`);
    writeAsciiFixed(out, p + 336, 256, smp.cleanFileName);
    ptr += sampleBlockSize;
  });

  // 5. Parameters Block (0x04, 304B payload)
  writeHeader(ptr, 0x04, paramPayloadSize, 0, 'Parameters');
  const p = ptr + 84;
  view.setUint32(p + 0, 100, le);
  const paramEntries: Array<[number, number]> = [
    [7, 0], // master volume
    [5, Math.max(1, Math.min(64, polyphony))],
    [8, Math.max(0, Math.min(24, pitchBendUpSt))],
    [9, Math.max(0, Math.min(24, pitchBendDownSt))],
    [44, filter?.enabled ? 1 : 0],
    [
      243,
      filter?.type === 'hpf'
        ? 4
        : filter?.type === 'bpf'
          ? 5
          : filter?.poles === 1
            ? 3
            : filter?.poles === 2
              ? 2
              : 0,
    ],
    [
      45,
      Math.max(
        0,
        Math.min(1000, Math.round((Math.log10(Math.max(20, filter?.cutoffHz ?? 20000) / 20) / 3) * 1000))
      ),
    ],
    [46, Math.max(0, Math.min(1000, Math.round(((filter?.resonanceDb ?? 0) / 24) * 1000)))],
    [60, Math.max(0, Math.min(100, Math.round(((filter?.keytrackCents ?? 0) / 1200) * 100)))],
    [72, envSecToExsParam(filter?.filterEnv?.attackSec ?? 0.005)],
    [73, envSecToExsParam(filter?.filterEnv?.decaySec ?? 0.25)],
    [74, Math.round(Math.max(0, Math.min(1, filter?.filterEnv?.sustainLevel ?? 0.5)) * 127)],
    [75, envSecToExsParam(filter?.filterEnv?.releaseSec ?? 0.2)],
    [77, envSecToExsParam((ampEnv?.attackSec ?? 0.005) + (ampEnv?.delaySec ?? 0))],
    [78, (ampEnv?.holdSec ?? 0) > 0 ? envSecToExsParam(ampEnv!.holdSec!) : 0],
    [79, envSecToExsParam(ampEnv?.decaySec ?? 0.25)],
    [80, Math.round(Math.max(0, Math.min(1, ampEnv?.sustainLevel ?? 1)) * 127)],
    [81, envSecToExsParam(ampEnv?.releaseSec ?? 0.2)],
  ];
  paramEntries.forEach(([id, val], idx) => {
    out[p + 4 + idx] = id & 0xff;
    view.setInt16(p + 104 + idx * 2, val, le);
  });

  return out;
}
