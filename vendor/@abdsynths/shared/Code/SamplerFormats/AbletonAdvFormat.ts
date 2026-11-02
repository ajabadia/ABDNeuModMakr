// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Ableton Live Sampler / Simpler (.adv) Reader & Writer (Fase 32.4)
//
// Clean-room implementation of Ableton's .adv XML / GZIP-XML preset format
// (<Ableton><MultiSampler> and <Ableton><OriginalSimpler>).
// Reference: Jürgen Moßgraber's ConvertWithMoss format documentation.
// ─────────────────────────────────────────────────────────

import { crc32, inflateRaw } from '../NeuronFormats/ZipArchive.ts';
import type {
  DahdsrEnvelope,
  FilterSlopePoles,
  LoopMode,
  PitchEnvelopeConfig,
  RegionFilterConfig,
  SamplerPlayLogic,
} from './SamplerTypes.ts';
import type { UniformSamplerRegion } from './rawSamplerTypes.ts';

export interface AbletonAdvSamplePart {
  id: number;
  name: string;
  samplePath: string;
  rootKey: number;
  lowKey: number;
  highKey: number;
  keyFadeIn: number;
  keyFadeOut: number;
  lowVel: number;
  highVel: number;
  velFadeIn: number;
  velFadeOut: number;
  detuneCents: number;
  pitchKeytrack: number;
  volumeDb: number;
  pan: number; // -50..+50
  sampleStartFrame: number;
  sampleEndFrame?: number;
  reversed: boolean;
  loopMode: LoopMode;
  loopStart: number;
  loopEnd: number;
  loopCrossfadeFrames: number;
}

export interface ParsedAbletonAdv {
  presetName: string;
  deviceType: 'MultiSampler' | 'OriginalSimpler';
  playLogic: SamplerPlayLogic;
  parts: AbletonAdvSamplePart[];
  ampEnv?: Partial<DahdsrEnvelope>;
  velToVolumeDepth?: number;
  filter?: Partial<RegionFilterConfig>;
  pitchEnv?: Partial<PitchEnvelopeConfig>;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

/**
 * Unpacks a GZIP (RFC 1952) or plain UTF-8 `.adv` buffer into XML text.
 */
export function unpackAbletonAdvXml(input: ArrayBuffer | Uint8Array | string): string {
  if (typeof input === 'string') return input;
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength >= 18 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 0x08) {
    const flg = bytes[3];
    let pos = 10;
    // FEXTRA
    if (flg & 0x04) {
      const xlen = bytes[pos] | (bytes[pos + 1] << 8);
      pos += 2 + xlen;
    }
    // FNAME
    if (flg & 0x08) {
      while (pos < bytes.byteLength && bytes[pos] !== 0) pos++;
      pos++;
    }
    // FCOMMENT
    if (flg & 0x10) {
      while (pos < bytes.byteLength && bytes[pos] !== 0) pos++;
      pos++;
    }
    // FHCRC
    if (flg & 0x02) {
      pos += 2;
    }
    const deflateSlice = bytes.subarray(pos, Math.max(pos, bytes.byteLength - 8));
    const inflated = inflateRaw(deflateSlice);
    return textDecoder.decode(inflated);
  }
  return textDecoder.decode(bytes);
}

/**
 * Compresses XML text into a valid RFC 1952 GZIP stream (using stored DEFLATE blocks + CRC32 + ISIZE)
 * so Ableton Live and any standard gunzip tool can read `.adv` presets without native zlib dependencies.
 */
export function packAbletonAdvGzip(xmlText: string): Uint8Array {
  const payload = textEncoder.encode(xmlText);
  const maxBlock = 65535;
  const numBlocks = Math.max(1, Math.ceil(payload.byteLength / maxBlock));
  // 10B gzip header + numBlocks * 5B stored block headers + payload + 8B trailer
  const out = new Uint8Array(10 + numBlocks * 5 + payload.byteLength + 8);
  const view = new DataView(out.buffer);

  // GZIP header
  out[0] = 0x1f;
  out[1] = 0x8b;
  out[2] = 0x08; // deflate
  out[3] = 0x00; // flags
  view.setUint32(4, 0, true); // mtime
  out[8] = 0x00; // xfl
  out[9] = 0x03; // OS = Unix

  let ptr = 10;
  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const isFinal = b === numBlocks - 1 ? 1 : 0;
    const chunkLen = Math.min(maxBlock, payload.byteLength - offset);
    out[ptr++] = isFinal; // BFINAL=isFinal, BTYPE=00 (stored)
    view.setUint16(ptr, chunkLen, true);
    view.setUint16(ptr + 2, chunkLen ^ 0xffff, true);
    ptr += 4;
    out.set(payload.subarray(offset, offset + chunkLen), ptr);
    ptr += chunkLen;
    offset += chunkLen;
  }

  const crc = crc32(payload);
  view.setUint32(ptr, crc, true);
  view.setUint32(ptr + 4, payload.byteLength >>> 0, true);
  return out;
}

function getTagVal(xml: string, tag: string): string | undefined {
  // Matches either <Tag Value="..." /> or <Tag><Manual Value="..." /></Tag>
  const direct = new RegExp(`<${tag}\\b[^>]*\\bValue=["']([^"']*)["']`, 'i').exec(xml);
  if (direct) return direct[1];
  const block = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  if (block) {
    const manual = /<Manual\b[^>]*\bValue=["']([^"']*)["']/i.exec(block[1]);
    if (manual) return manual[1];
  }
  return undefined;
}

function getTagNum(xml: string, tag: string, fallback: number): number {
  const raw = getTagVal(xml, tag);
  if (raw === undefined || raw === '') return fallback;
  const num = parseFloat(raw);
  return Number.isFinite(num) ? num : fallback;
}

function getTagBool(xml: string, tag: string, fallback: boolean): boolean {
  const raw = getTagVal(xml, tag);
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

function extractBlock(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  return m ? m[1] : undefined;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Parses an Ableton `.adv` (MultiSampler or OriginalSimpler) XML or GZIP buffer.
 */
export function parseAbletonAdv(
  content: ArrayBuffer | Uint8Array | string,
  fallbackName = 'AbletonSampler'
): ParsedAbletonAdv {
  const xml = unpackAbletonAdvXml(content);
  const isSimpler = /<OriginalSimpler\b/i.test(xml) && !/<MultiSampler\b/i.test(xml);
  const deviceType: 'MultiSampler' | 'OriginalSimpler' = isSimpler ? 'OriginalSimpler' : 'MultiSampler';

  const userNameBlock = extractBlock(xml, 'Annotation') ?? xml;
  const rawUserName = getTagVal(xml, 'UserName');
  const presetName = (rawUserName && rawUserName.trim()) ? rawUserName.trim() : fallbackName;
  void userNameBlock;

  const mapBlock = extractBlock(xml, 'MultiSampleMap') ?? xml;
  const rrOn = getTagBool(mapBlock, 'RoundRobin', false);
  const rrMode = getTagNum(mapBlock, 'RoundRobinMode', 0);
  const playLogic: SamplerPlayLogic = rrOn ? (rrMode === 3 ? 'random' : 'round_robin') : 'velocity';

  const parts: AbletonAdvSamplePart[] = [];
  const partRegex = /<MultiSamplePart\b([^>]*)>([\s\S]*?)<\/MultiSamplePart>/gi;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = partRegex.exec(mapBlock)) !== null) {
    const attrs = match[1];
    const body = match[2];
    const idMatch = /\bId=["'](\d+)["']/i.exec(attrs);
    const id = idMatch ? parseInt(idMatch[1], 10) : idx;

    const name = getTagVal(body, 'Name') || `Part_${idx + 1}`;
    const fileRefBlock = extractBlock(body, 'SampleRef') ?? body;
    const relPath = getTagVal(fileRefBlock, 'RelativePath') || '';
    const absPath = getTagVal(fileRefBlock, 'Path') || '';
    const fileName = getTagVal(fileRefBlock, 'FileName') || '';
    const samplePath = relPath || absPath || fileName || `${name}.wav`;

    const keyRangeBlock = extractBlock(body, 'KeyRange') ?? '';
    const lowKey = Math.max(0, Math.min(127, getTagNum(keyRangeBlock, 'Min', 0)));
    const highKey = Math.max(0, Math.min(127, getTagNum(keyRangeBlock, 'Max', 127)));
    const xfadeKeyMin = getTagNum(keyRangeBlock, 'CrossfadeMin', lowKey);
    const xfadeKeyMax = getTagNum(keyRangeBlock, 'CrossfadeMax', highKey);
    const keyFadeIn = Math.max(0, Math.round(Math.abs(xfadeKeyMin - lowKey)));
    const keyFadeOut = Math.max(0, Math.round(Math.abs(highKey - xfadeKeyMax)));

    const velRangeBlock = extractBlock(body, 'VelocityRange') ?? '';
    const lowVel = Math.max(1, Math.min(127, getTagNum(velRangeBlock, 'Min', 1)));
    const highVel = Math.max(1, Math.min(127, getTagNum(velRangeBlock, 'Max', 127)));
    const xfadeVelMin = getTagNum(velRangeBlock, 'CrossfadeMin', lowVel);
    const xfadeVelMax = getTagNum(velRangeBlock, 'CrossfadeMax', highVel);
    const velFadeIn = Math.max(0, Math.round(Math.abs(xfadeVelMin - lowVel)));
    const velFadeOut = Math.max(0, Math.round(Math.abs(highVel - xfadeVelMax)));

    const rootKey = Math.max(0, Math.min(127, getTagNum(body, 'RootKey', 60)));
    const detuneCents = getTagNum(body, 'Detune', 0);
    const pitchKeytrack = getTagNum(body, 'TuneScale', 100);
    const panNorm = getTagNum(body, 'Panorama', 0); // -1..1
    const pan = Math.max(-50, Math.min(50, Math.round(panNorm * 50)));

    // Ableton Volume is linear gain where dB = 6 * log2(Volume)
    const volLinear = getTagNum(body, 'Volume', 1);
    const volumeDb = volLinear > 0 ? Math.max(-60, Math.min(24, 6 * Math.log2(volLinear))) : -60;

    const sampleStartFrame = Math.max(0, Math.round(getTagNum(body, 'SampleStart', 0)));
    const rawEnd = getTagNum(body, 'SampleEnd', -1);
    const sampleEndFrame = rawEnd > sampleStartFrame ? Math.round(rawEnd) : undefined;
    const reversed = getTagBool(body, 'Reverse', false);

    const sustainLoopBlock = extractBlock(body, 'SustainLoop') ?? '';
    const loopModeNum = getTagNum(sustainLoopBlock, 'Mode', 0);
    const loopStart = Math.max(0, Math.round(getTagNum(sustainLoopBlock, 'Start', 0)));
    const loopEnd = Math.max(0, Math.round(getTagNum(sustainLoopBlock, 'End', 0)));
    const loopCrossfadeFrames = Math.max(0, Math.round(getTagNum(sustainLoopBlock, 'Crossfade', 0)));
    const loopMode: LoopMode =
      loopModeNum === 2 && loopEnd > loopStart
        ? 'ping_pong'
        : loopModeNum === 1 && loopEnd > loopStart
          ? 'loop_continuous'
          : 'no_loop';

    parts.push({
      id,
      name,
      samplePath,
      rootKey,
      lowKey,
      highKey,
      keyFadeIn,
      keyFadeOut,
      lowVel,
      highVel,
      velFadeIn,
      velFadeOut,
      detuneCents,
      pitchKeytrack,
      volumeDb,
      pan,
      sampleStartFrame,
      sampleEndFrame,
      reversed,
      loopMode,
      loopStart,
      loopEnd,
      loopCrossfadeFrames,
    });
    idx++;
  }

  // Parse VolumeAndPan envelope (times in ms)
  let ampEnv: Partial<DahdsrEnvelope> | undefined;
  let velToVolumeDepth: number | undefined;
  const volAndPanBlock = extractBlock(xml, 'VolumeAndPan');
  if (volAndPanBlock) {
    const velScale = getTagNum(volAndPanBlock, 'VolumeVelScale', 0.35);
    velToVolumeDepth = Math.round(Math.max(0, Math.min(1, velScale)) * 100);
    const envBlock = extractBlock(volAndPanBlock, 'Envelope');
    if (envBlock) {
      ampEnv = {
        delaySec: 0,
        attackSec: Math.max(0.0005, getTagNum(envBlock, 'AttackTime', 1) / 1000),
        holdSec: 0,
        decaySec: Math.max(0.001, getTagNum(envBlock, 'DecayTime', 100) / 1000),
        sustainLevel: Math.max(0, Math.min(1, getTagNum(envBlock, 'SustainLevel', 1))),
        releaseSec: Math.max(0.001, getTagNum(envBlock, 'ReleaseTime', 50) / 1000),
      };
    }
  }

  // Parse Filter
  let filter: Partial<RegionFilterConfig> | undefined;
  const filterBlock = extractBlock(xml, 'Filter');
  if (filterBlock) {
    const isOn = getTagBool(filterBlock, 'IsOn', false);
    const simplerFilterBlock = extractBlock(filterBlock, 'SimplerFilter') ?? filterBlock;
    const typeNum = getTagNum(simplerFilterBlock, 'Type', 0);
    const slope24 = getTagBool(simplerFilterBlock, 'Slope', true);
    const poles: FilterSlopePoles = slope24 ? 4 : 2;
    const cutoffHz = Math.max(20, Math.min(22000, getTagNum(simplerFilterBlock, 'Freq', 20000)));
    const resNorm = Math.max(0, Math.min(1.25, getTagNum(simplerFilterBlock, 'Res', 0)));
    const filterEnvBlock = extractBlock(simplerFilterBlock, 'Envelope');
    const filterEnvOn = filterEnvBlock ? getTagBool(filterEnvBlock, 'IsOn', false) : false;
    const envAmountSt = filterEnvBlock ? getTagNum(filterEnvBlock, 'Amount', 0) : 0; // -72..72 semitones

    let filterEnv: DahdsrEnvelope | undefined;
    if (filterEnvBlock && filterEnvOn) {
      filterEnv = {
        delaySec: 0,
        attackSec: Math.max(0.0005, getTagNum(filterEnvBlock, 'AttackTime', 1) / 1000),
        holdSec: 0,
        decaySec: Math.max(0.001, getTagNum(filterEnvBlock, 'DecayTime', 200) / 1000),
        sustainLevel: Math.max(0, Math.min(1, getTagNum(filterEnvBlock, 'SustainLevel', 0))),
        releaseSec: Math.max(0.001, getTagNum(filterEnvBlock, 'ReleaseTime', 100) / 1000),
        velModDepth: 0,
      };
    }

    filter = {
      enabled: isOn,
      type: typeNum === 1 ? 'hpf' : typeNum === 2 ? 'bpf' : typeNum === 3 ? 'notch' : 'lpf',
      poles,
      cutoffHz,
      resonanceDb: Math.round((resNorm / 1.25) * 24 * 10) / 10,
      envToFilterCents: Math.round(envAmountSt * 100),
      velToFilterCents: 0,
      keytrackCents: 0,
      filterEnv,
    };
  }

  // Parse Pitch / Aux Envelope
  let pitchEnv: Partial<PitchEnvelopeConfig> | undefined;
  const auxBlock = extractBlock(xml, 'AuxEnv');
  if (auxBlock) {
    const auxOn = getTagBool(auxBlock, 'IsOn', false);
    const auxEnvInner = extractBlock(auxBlock, 'SimplerAuxEnvelope') ?? auxBlock;
    const conn0 = extractBlock(auxEnvInner, 'ModConnections.0') ?? auxEnvInner;
    const connTarget = getTagNum(conn0, 'Connection', 0);
    const amountPct = getTagNum(conn0, 'Amount', 0); // -100..100 -> +/- 4800 cents max
    if (auxOn && (connTarget === 6 || Math.abs(amountPct) > 0)) {
      pitchEnv = {
        enabled: true,
        depthCents: Math.round((amountPct / 100) * 4800),
        env: {
          delaySec: 0,
          attackSec: Math.max(0.0005, getTagNum(auxEnvInner, 'AttackTime', 1) / 1000),
          holdSec: 0,
          decaySec: Math.max(0.001, getTagNum(auxEnvInner, 'DecayTime', 150) / 1000),
          sustainLevel: Math.max(0, Math.min(1, getTagNum(auxEnvInner, 'SustainLevel', 0))),
          releaseSec: Math.max(0.001, getTagNum(auxEnvInner, 'ReleaseTime', 50) / 1000),
          velModDepth: 0,
        },
      };
    }
  }

  return {
    presetName,
    deviceType,
    playLogic,
    parts,
    ampEnv,
    velToVolumeDepth,
    filter,
    pitchEnv,
  };
}

/**
 * Generates an Ableton `<MultiSampler>` XML string from uniform sampler regions and global articulation.
 */
export function buildAbletonAdvXml(options: {
  presetName: string;
  regions: Array<UniformSamplerRegion & { cleanFileName: string; totalFrames: number }>;
  ampEnv?: Partial<DahdsrEnvelope>;
  filter?: Partial<RegionFilterConfig>;
  pitchEnv?: Partial<PitchEnvelopeConfig>;
}): string {
  const { presetName, regions, ampEnv, filter, pitchEnv } = options;
  const cleanBank = presetName.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim() || 'AbletonSampler';
  const hasRoundRobin = regions.some((r) => r.playLogic === 'round_robin' || r.playLogic === 'random' || (r.seqLength ?? 0) > 1);
  const rrMode = regions.some((r) => r.playLogic === 'random') ? 3 : 0;

  const partXmls: string[] = [];
  regions.forEach((reg, idx) => {
    const startFrame = Math.max(0, Math.round(reg.sampleStartFrame ?? 0));
    const endFrame =
      reg.sampleEndFrame && reg.sampleEndFrame > startFrame
        ? Math.round(reg.sampleEndFrame)
        : Math.max(startFrame + 1, reg.totalFrames - 1);
    const hasLoop = reg.loopMode !== 'no_loop' && reg.loopEnd > reg.loopStart;
    const loopModeVal = !hasLoop ? 0 : reg.loopMode === 'ping_pong' ? 2 : 1;
    const loopStart = hasLoop ? Math.round(reg.loopStart) : 0;
    const loopEnd = hasLoop ? Math.round(reg.loopEnd) : endFrame;
    const xfadeFrames = Math.round(((reg.loopCrossfadeMs ?? 0) / 1000) * 44100);

    const xfadeKeyMin = Math.min(reg.highKey, reg.lowKey + (reg.keyFadeIn ?? 0));
    const xfadeKeyMax = Math.max(reg.lowKey, reg.highKey - (reg.keyFadeOut ?? 0));
    const xfadeVelMin = Math.min(reg.highVel, reg.lowVel + (reg.velFadeIn ?? 0));
    const xfadeVelMax = Math.max(reg.lowVel, reg.highVel - (reg.velFadeOut ?? 0));

    // Volume = 2^(dB / 6)
    const volLinear = Math.pow(2, (reg.volumeDb ?? 0) / 6);
    const panNorm = Math.max(-1, Math.min(1, (reg.pan ?? 0) / 50));
    const relPath = `Samples/Imported/${cleanBank}/${reg.cleanFileName}`;
    const stemName = reg.cleanFileName.replace(/\.[^.]+$/, '');

    partXmls.push(`          <MultiSamplePart Id="${idx}" HasImportedSlicePoints="false">
            <LomId Value="0" />
            <Selection Value="true" />
            <IsActive Value="true" />
            <Solo Value="false" />
            <Name Value="${escapeXml(stemName)}" />
            <KeyRange>
              <Min Value="${reg.lowKey}" />
              <Max Value="${reg.highKey}" />
              <CrossfadeMin Value="${xfadeKeyMin}" />
              <CrossfadeMax Value="${xfadeKeyMax}" />
            </KeyRange>
            <VelocityRange>
              <Min Value="${reg.lowVel}" />
              <Max Value="${reg.highVel}" />
              <CrossfadeMin Value="${xfadeVelMin}" />
              <CrossfadeMax Value="${xfadeVelMax}" />
            </VelocityRange>
            <SelectorRange>
              <Min Value="0" />
              <Max Value="127" />
              <CrossfadeMin Value="0" />
              <CrossfadeMax Value="127" />
            </SelectorRange>
            <RootKey Value="${reg.rootKey}" />
            <Detune Value="${Math.round(reg.detuneCents)}" />
            <TuneScale Value="${Math.round(reg.pitchKeytrack ?? 100)}" />
            <Panorama Value="${panNorm.toFixed(4)}" />
            <Volume Value="${volLinear.toFixed(6)}" />
            <Link Value="false" />
            <SampleStart Value="${startFrame}" />
            <SampleEnd Value="${endFrame}" />
            <Reverse><Manual Value="${reg.reversed ? 'true' : 'false'}" /></Reverse>
            <SustainLoop>
              <Start Value="${loopStart}" />
              <End Value="${loopEnd}" />
              <Mode Value="${loopModeVal}" />
              <Crossfade Value="${xfadeFrames}" />
              <Detune Value="0" />
            </SustainLoop>
            <ReleaseLoop>
              <Start Value="${loopStart}" />
              <End Value="${loopEnd}" />
              <Mode Value="3" />
              <Crossfade Value="0" />
              <Detune Value="0" />
            </ReleaseLoop>
            <SampleRef>
              <FileRef>
                <HasRelativePath Value="true" />
                <RelativePathType Value="3" />
                <RelativePath Value="${escapeXml(relPath)}" />
                <Path Value="${escapeXml(relPath)}" />
                <FileName Value="${escapeXml(reg.cleanFileName)}" />
                <Type Value="1" />
                <LivePackName Value="" />
                <LivePackId Value="" />
                <OriginalFileSize Value="0" />
                <OriginalCrc Value="0" />
              </FileRef>
              <LastModDate Value="0" />
              <SourceContext />
              <SampleUsageHint Value="0" />
              <DefaultDuration Value="${reg.totalFrames}" />
              <DefaultSampleRate Value="44100" />
            </SampleRef>
          </MultiSamplePart>`);
  });

  const atkMs = Math.max(0.5, ((ampEnv?.attackSec ?? 0.005) + (ampEnv?.delaySec ?? 0)) * 1000);
  const decMs = Math.max(1, (ampEnv?.decaySec ?? 0.25) * 1000);
  const susLvl = Math.max(0, Math.min(1, ampEnv?.sustainLevel ?? 1));
  const relMs = Math.max(1, (ampEnv?.releaseSec ?? 0.25) * 1000);

  const fltEnabled = Boolean(filter?.enabled);
  const fltType = filter?.type === 'hpf' ? 1 : filter?.type === 'bpf' ? 2 : filter?.type === 'notch' || filter?.type === 'brf' ? 3 : 0;
  const fltSlope = (filter?.poles ?? 4) >= 4;
  const fltFreq = Math.max(20, Math.min(22000, filter?.cutoffHz ?? 20000));
  const fltRes = Math.max(0, Math.min(1.25, ((filter?.resonanceDb ?? 0) / 24) * 1.25));
  const fltEnvSt = Math.max(-72, Math.min(72, (filter?.envToFilterCents ?? 0) / 100));
  const fltEnv = filter?.filterEnv;

  const pitchEnvOn = Boolean(pitchEnv?.enabled && Math.abs(pitchEnv.depthCents ?? 0) > 0);
  const pitchAmtPct = Math.max(-100, Math.min(100, ((pitchEnv?.depthCents ?? 0) / 4800) * 100));

  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="11.0_433" SchemaChangeCount="3" Creator="ABDNeuModMakr" Revision="">
  <MultiSampler Id="0">
    <LomId Value="0" />
    <IsExpanded Value="true" />
    <On><Manual Value="true" /></On>
    <ModulationSourceCount Value="0" />
    <ParametersListWrapper LomId="0" />
    <Pointee Id="0" />
    <LastSelectedTimeableIndex Value="0" />
    <LastSelectedClipEnvelopeIndex Value="0" />
    <LastPresetRef><Value /></LastPresetRef>
    <LockedScripts />
    <IsFolded Value="false" />
    <ShouldShowPresetName Value="true" />
    <UserName Value="${escapeXml(presetName)}" />
    <Annotation Value="" />
    <Player>
      <MultiSampleMap>
        <SampleParts>
${partXmls.join('\n')}
        </SampleParts>
        <LoadInRam Value="false" />
        <LayerCrossfade Value="0" />
        <SourceContext />
        <RoundRobin Value="${hasRoundRobin ? 'true' : 'false'}" />
        <RoundRobinMode Value="${rrMode}" />
        <RoundRobinResetPeriod Value="0" />
        <RoundRobinRandom Value="false" />
      </MultiSampleMap>
    </Player>
    <Filter>
      <IsOn><Manual Value="${fltEnabled ? 'true' : 'false'}" /></IsOn>
      <Slot>
        <Value>
          <SimplerFilter Id="0">
            <Type><Manual Value="${fltType}" /></Type>
            <Slope><Manual Value="${fltSlope ? 'true' : 'false'}" /></Slope>
            <Freq><Manual Value="${fltFreq.toFixed(2)}" /></Freq>
            <Res><Manual Value="${fltRes.toFixed(4)}" /></Res>
            <Envelope>
              <IsOn><Manual Value="${Math.abs(fltEnvSt) > 0.01 ? 'true' : 'false'}" /></IsOn>
              <Amount><Manual Value="${fltEnvSt.toFixed(2)}" /></Amount>
              <AttackTime><Manual Value="${((fltEnv?.attackSec ?? 0.005) * 1000).toFixed(2)}" /></AttackTime>
              <DecayTime><Manual Value="${((fltEnv?.decaySec ?? 0.25) * 1000).toFixed(2)}" /></DecayTime>
              <SustainLevel><Manual Value="${(fltEnv?.sustainLevel ?? 0).toFixed(4)}" /></SustainLevel>
              <ReleaseTime><Manual Value="${((fltEnv?.releaseSec ?? 0.2) * 1000).toFixed(2)}" /></ReleaseTime>
            </Envelope>
          </SimplerFilter>
        </Value>
      </Slot>
    </Filter>
    <VolumeAndPan>
      <Volume><Manual Value="0" /></Volume>
      <VolumeVelScale><Manual Value="0.35" /></VolumeVelScale>
      <Panorama><Manual Value="0" /></Panorama>
      <Envelope>
        <AttackTime><Manual Value="${atkMs.toFixed(2)}" /></AttackTime>
        <DecayTime><Manual Value="${decMs.toFixed(2)}" /></DecayTime>
        <SustainLevel><Manual Value="${susLvl.toFixed(4)}" /></SustainLevel>
        <ReleaseTime><Manual Value="${relMs.toFixed(2)}" /></ReleaseTime>
      </Envelope>
    </VolumeAndPan>
    <AuxEnv>
      <IsOn><Manual Value="${pitchEnvOn ? 'true' : 'false'}" /></IsOn>
      <Slot>
        <Value>
          <SimplerAuxEnvelope Id="0">
            <AttackTime><Manual Value="${((pitchEnv?.env?.attackSec ?? 0.005) * 1000).toFixed(2)}" /></AttackTime>
            <DecayTime><Manual Value="${((pitchEnv?.env?.decaySec ?? 0.15) * 1000).toFixed(2)}" /></DecayTime>
            <SustainLevel><Manual Value="${(pitchEnv?.env?.sustainLevel ?? 0).toFixed(4)}" /></SustainLevel>
            <ReleaseTime><Manual Value="${((pitchEnv?.env?.releaseSec ?? 0.1) * 1000).toFixed(2)}" /></ReleaseTime>
            <ModDst>
              <ModConnections.0>
                <Amount Value="${pitchAmtPct.toFixed(2)}" />
                <Connection Value="6" />
              </ModConnections.0>
            </ModDst>
          </SimplerAuxEnvelope>
        </Value>
      </Slot>
    </AuxEnv>
  </MultiSampler>
</Ableton>
`;
}
