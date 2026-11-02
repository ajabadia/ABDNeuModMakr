// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Raw Multi-Format Sampler Exporter (Fase 16 + Fase 32.3/32.4)
//
// Exports raw samples and zone/region mappings (unaltered by
// Scape/Sphere resynthesis) to industry standard sampler formats:
// - SoundFont 2.04 (.sf2 binary RIFF sfbk)
// - SFZ Format (.sfz + Samples/ folder packaged as .zip)
// - Decent Sampler (.dspreset + Samples/ folder packaged as .zip)
// - Bitwig Studio Multisample (.multisample zip package)
// - Native Instruments Kontakt (.nki.zip with XML definition)
// - Steinberg HALion (.vstpreset.zip with XML definition)
// - Akai MPC Keygroup / Drum (.xpm.zip & .xpn)
// - Ableton Sampler / Simpler (.adv.zip with GZIP .adv + Samples/Imported/)
// - Apple Logic EXS24 / Sampler (.exs.zip with binary .exs + Samples/)
// - Togu Audio Line TAL-Sampler (.talsmpl.zip)
// - CWITEC TX16Wx Software Sampler (.txprog.zip)
// - Korg Trinity / Triton / M3 / Pa (.kmp.zip with .KMP + .KSF + .KSC)
// - MMA Downloadable Sounds Level 2 (.dls RIFF "DLS ")
// - Linear Sample Chain (.wav with RIFF cue markers + slice index)
// ─────────────────────────────────────────────────────────

import type { SamplerSessionLike as Session } from './SamplerTypes.ts';
import {
  decodeWav,
  encodeWavPcm16,
  encodeWavPcm24,
  createZipArchive,
  type DecodedWav,
  type ZipEntryInput,
} from '../NeuronFormats/index.ts';
import type {
  RawExportOptions,
  RawExportResult,
  RawNormalization,
} from './rawSamplerTypes.ts';
import {
  analyzeRawSamplerPreflight,
  extractUniformSamplerRegions,
  SAMPLER_FORMAT_METADATA,
} from './rawSamplerPreflight.ts';
import {
  buildSoundFont2Archive,
  type Sf2BankData,
  type Sf2SampleEntry,
} from './soundfont2Writer.ts';
import {
  buildLinearSampleChainWav,
} from './sampleChainWriter.ts';
import {
  writeMpcXpm,
  regionsToMpcInstruments,
  buildExpansionXml,
  type MpcSourceRegion,
  type MpcProgramType,
} from './MpcXpmFormat.ts';
import { buildAbletonAdvXml, packAbletonAdvGzip } from './AbletonAdvFormat.ts';
import { buildExs24Binary } from './Exs24Format.ts';
import { buildTalSamplerXml } from './TalSamplerFormat.ts';
import { buildTx16WxProgramXml } from './Tx16WxFormat.ts';
import { buildKorgKmpPackage } from './KorgKmpKsfFormat.ts';
import { buildDlsBinary } from './DlsFormat.ts';
import { exportMusic1010Zip } from './Music1010Format.ts';
import { exportDelugeZip } from './DelugeFormat.ts';
import { exportRenoiseXrni } from './RenoiseFormat.ts';
import { exportBlissZip } from './BlissFormat.ts';
import { exportPolyendTrackerPti } from './PolyendTrackerFormat.ts';
import { sessionToUniversalSamplerInstrument } from './UniversalSamplerModel.ts';

const textEncoder = new TextEncoder();

function cleanFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_');
}

function resampleChannel(source: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (srcRate === dstRate || source.length === 0) return source;
  const ratio = dstRate / srcRate;
  const newLen = Math.max(1, Math.round(source.length * ratio));
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const srcPos = i / ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const s0 = source[idx] ?? 0;
    const s1 = source[idx + 1] ?? s0;
    out[i] = s0 + frac * (s1 - s0);
  }
  return out;
}

function normalizeChannels(channels: Float32Array[], mode: RawNormalization): Float32Array[] {
  if (mode === 'none') return channels;
  let maxPeak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const abs = Math.abs(ch[i]);
      if (abs > maxPeak) maxPeak = abs;
    }
  }
  if (maxPeak <= 0.00001) return channels;
  const target = mode === 'minus_0_3db' ? 0.96605 : 1.0;
  const scale = target / maxPeak;
  if (Math.abs(scale - 1.0) < 0.001) return channels;
  return channels.map((ch) => {
    const out = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      out[i] = Math.max(-1.0, Math.min(1.0, ch[i] * scale));
    }
    return out;
  });
}

interface ProcessedSampleItem {
  cleanName: string;
  originalName: string;
  decoded: DecodedWav;
  processedChannels: Float32Array[];
  sampleRate: number;
  wavBuffer: ArrayBuffer;
  pcm16Mono: Int16Array;
}

/**
 * Main export function for raw multisample libraries.
 */
export async function exportRawSamplerLibrary(
  session: Session,
  options: RawExportOptions,
  sampleBufferProvider: (sampleName: string) => ArrayBuffer | undefined
): Promise<RawExportResult> {
  const meta = SAMPLER_FORMAT_METADATA[options.format];
  const report = analyzeRawSamplerPreflight(session, options, sampleBufferProvider);

  if (!report.canExport) {
    throw new Error(
      `Cannot export sampler bank: active session contains 0 regions or no valid audio buffers.`
    );
  }

  const regions = extractUniformSamplerRegions(session);
  const bankName = options.bankName || session.processConfig.expandedName || session.processConfig.modelName || 'SamplerBank';
  const cleanBankName = cleanFilename(bankName);
  const author = options.author || session.processConfig.extendedMetadata?.author || 'ABDNeuModMakr User';
  const license = options.license || session.processConfig.extendedMetadata?.license || 'CC-BY 4.0';
  const description = options.description || session.processConfig.extendedMetadata?.description || 'Raw Multi-Format Sampler Bank';

  // 1. Process all unique audio buffers
  const processedSamplesMap = new Map<string, ProcessedSampleItem>();
  const uniqueNames = Array.from(new Set(regions.map((r) => r.sampleName).filter(Boolean)));

  let totalRawDurationSec = 0;

  for (const sName of uniqueNames) {
    const raw = sampleBufferProvider(sName);
    if (!raw || raw.byteLength === 0) continue;

    let decoded: DecodedWav;
    try {
      decoded = decodeWav(raw);
    } catch {
      continue;
    }

    const targetRate = options.sampleRate === 'original' ? decoded.sampleRate : options.sampleRate;
    let channels = decoded.channels.map((ch) =>
      resampleChannel(ch, decoded.sampleRate, targetRate)
    );

    channels = normalizeChannels(channels, options.normalization);

    // Prepare 16-bit PCM mono for SF2 / Korg KSF / DLS
    const monoChan = channels.length === 1 ? channels[0] : new Float32Array(channels[0].length);
    if (channels.length > 1) {
      for (let i = 0; i < channels[0].length; i++) {
        monoChan[i] = (channels[0][i] + channels[1][i]) * 0.5;
      }
    }
    const pcm16Mono = new Int16Array(monoChan.length);
    for (let i = 0; i < monoChan.length; i++) {
      const s = Math.max(-1.0, Math.min(1.0, monoChan[i]));
      pcm16Mono[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    }

    const isPcm16 =
      options.resolution === 'pcm16' ||
      options.format === 'sf2' ||
      options.format === 'korg_kmp' ||
      options.format === 'dls';
    const wavBuffer = isPcm16
      ? encodeWavPcm16(channels, targetRate, decoded.instrument)
      : encodeWavPcm24(channels, targetRate, decoded.instrument);

    const cleanName = cleanFilename(sName.replace(/\.[^/.]+$/, '')) + '.wav';

    processedSamplesMap.set(sName, {
      cleanName,
      originalName: sName,
      decoded,
      processedChannels: channels,
      sampleRate: targetRate,
      wavBuffer,
      pcm16Mono,
    });

    totalRawDurationSec += decoded.durationSec;
  }

  const validRegions = regions.filter((r) => processedSamplesMap.has(r.sampleName));

  let outFilename = `${cleanBankName}${meta.extension}`;
  let mimeType = meta.mimeType;
  let outData: Uint8Array;
  let totalFiles = 1;

  // ── 2. Format-Specific Generation ───────────────────────
  switch (options.format) {
    case 'sf2': {
      const sf2Samples: Sf2SampleEntry[] = [];
      const sampleIndexMap = new Map<string, number>();

      for (const [name, ps] of processedSamplesMap.entries()) {
        sampleIndexMap.set(name, sf2Samples.length);
        const inst = ps.decoded.instrument;
        sf2Samples.push({
          name: ps.cleanName.replace('.wav', '').slice(0, 19),
          sampleRate: ps.sampleRate,
          rootKey: inst?.rootKey ?? 60,
          detuneCents: inst?.detune ?? 0,
          loopMode: inst?.loopMode === 'loop_continuous' ? 'loop_continuous' : 'no_loop',
          loopStart: inst?.loopStart ?? 0,
          loopEnd: inst?.loopEnd ?? ps.pcm16Mono.length,
          pcm16: ps.pcm16Mono,
        });
      }

      const sf2Regions = validRegions.map((r) => ({
        ...r,
        sampleIndex: sampleIndexMap.get(r.sampleName) ?? 0,
        loopMode: (r.loopMode !== 'no_loop' && r.loopMode !== 'one_shot' ? 'loop_continuous' : 'no_loop') as
          | 'loop_continuous'
          | 'no_loop',
      }));

      const bankData: Sf2BankData = {
        bankName: cleanBankName,
        author,
        copyright: license,
        comment: description,
        samples: sf2Samples,
        regions: sf2Regions,
      };

      outData = buildSoundFont2Archive(bankData);
      totalFiles = 1;
      break;
    }

    case 'sfz': {
      // SFZ v1/v2 text + Samples/ in ZIP (with Fase 32.3 opcodes)
      const sfzLines: string[] = [
        '// ========================================================',
        `// ABDNeuModMakr SFZ Definition: ${bankName}`,
        `// Author: ${author} | License: ${license}`,
        `// Generated: ${new Date().toISOString()}`,
        '// ========================================================',
        '',
        '<control>',
        'default_path=Samples/',
        '',
        '<global>',
        `// ${description}`,
        'volume=0',
      ];

      const art = session.articulation;
      if (art?.pitchBendUpSt !== undefined) sfzLines.push(`bend_up=${Math.round(art.pitchBendUpSt * 100)}`);
      if (art?.pitchBendDownSt !== undefined) sfzLines.push(`bend_down=${-Math.round(art.pitchBendDownSt * 100)}`);
      if (art?.polyphony !== undefined) sfzLines.push(`polyphony=${art.polyphony}`);

      const globalFlt = art?.filter;
      if (globalFlt?.enabled) {
        const poles = globalFlt.poles ?? 2;
        const filType =
          globalFlt.type === 'hpf'
            ? `hpf_${poles}p`
            : globalFlt.type === 'bpf'
              ? `bpf_${poles}p`
              : globalFlt.type === 'brf' || globalFlt.type === 'notch'
                ? 'brf_2p'
                : `lpf_${poles}p`;
        sfzLines.push(`fil_type=${filType}`);
        sfzLines.push(`cutoff=${Math.round(globalFlt.cutoffHz)}`);
        if (globalFlt.resonanceDb > 0) sfzLines.push(`resonance=${globalFlt.resonanceDb.toFixed(1)}`);
        if (globalFlt.keytrackCents) sfzLines.push(`fil_keytrack=${Math.round(globalFlt.keytrackCents)}`);
        if (globalFlt.envToFilterCents) {
          sfzLines.push(`fileg_depth=${Math.round(globalFlt.envToFilterCents)}`);
          const fe = globalFlt.filterEnv ?? art?.modEnv;
          if (fe) {
            sfzLines.push(`fileg_attack=${(fe.attackSec ?? 0.005).toFixed(3)}`);
            sfzLines.push(`fileg_decay=${(fe.decaySec ?? 0.25).toFixed(3)}`);
            sfzLines.push(`fileg_sustain=${Math.round((fe.sustainLevel ?? 0.5) * 100)}`);
            sfzLines.push(`fileg_release=${(fe.releaseSec ?? 0.2).toFixed(3)}`);
          }
        }
      }

      const globalPitchEnv = art?.pitchEnv;
      if (globalPitchEnv?.enabled && globalPitchEnv.depthCents) {
        sfzLines.push(`pitcheg_depth=${Math.round(globalPitchEnv.depthCents)}`);
        sfzLines.push(`pitcheg_attack=${(globalPitchEnv.env.attackSec ?? 0.005).toFixed(3)}`);
        sfzLines.push(`pitcheg_decay=${(globalPitchEnv.env.decaySec ?? 0.15).toFixed(3)}`);
        sfzLines.push(`pitcheg_sustain=${Math.round((globalPitchEnv.env.sustainLevel ?? 0) * 100)}`);
        sfzLines.push(`pitcheg_release=${(globalPitchEnv.env.releaseSec ?? 0.1).toFixed(3)}`);
      }
      sfzLines.push('');

      for (const reg of validRegions) {
        const ps = processedSamplesMap.get(reg.sampleName);
        if (!ps) continue;

        sfzLines.push('<region>');
        sfzLines.push(`sample=${ps.cleanName}`);
        sfzLines.push(`lokey=${reg.lowKey}`);
        sfzLines.push(`hikey=${reg.highKey}`);
        sfzLines.push(`pitch_keycenter=${reg.rootKey}`);
        sfzLines.push(`lovel=${reg.lowVel}`);
        sfzLines.push(`hivel=${reg.highVel}`);

        if (reg.detuneCents !== 0) sfzLines.push(`tune=${reg.detuneCents}`);
        if (reg.volumeDb !== 0) sfzLines.push(`volume=${reg.volumeDb.toFixed(1)}`);
        if (reg.pan !== 0) sfzLines.push(`pan=${Math.round(reg.pan * 2)}`);
        if (reg.pitchKeytrack !== 100) sfzLines.push(`pitch_keytrack=${reg.pitchKeytrack}`);
        if (reg.sampleStartFrame && reg.sampleStartFrame > 0) sfzLines.push(`offset=${Math.round(reg.sampleStartFrame)}`);
        if (reg.sampleEndFrame && reg.sampleEndFrame > 0) sfzLines.push(`end=${Math.round(reg.sampleEndFrame)}`);
        if (reg.reversed) sfzLines.push('direction=reverse');
        if (reg.trigger && reg.trigger !== 'attack') sfzLines.push(`trigger=${reg.trigger}`);
        if (reg.seqLength && reg.seqLength > 1) sfzLines.push(`seq_length=${reg.seqLength}`);
        if (reg.seqPosition && reg.seqPosition >= 1) sfzLines.push(`seq_position=${reg.seqPosition}`);
        if (reg.muteGroup && reg.muteGroup > 0) {
          sfzLines.push(`group=${reg.muteGroup}`);
          sfzLines.push(`off_by=${reg.muteGroup}`);
        }
        if (reg.groupName) sfzLines.push(`group_label=${reg.groupName}`);
        if (reg.keyswitchNote !== undefined) sfzLines.push(`sw_last=${reg.keyswitchNote}`);

        if ((reg.keyFadeIn ?? 0) > 0) {
          sfzLines.push(`xfin_lokey=${reg.lowKey}`);
          sfzLines.push(`xfin_hikey=${Math.min(reg.highKey, reg.lowKey + reg.keyFadeIn!)}`);
        }
        if ((reg.keyFadeOut ?? 0) > 0) {
          sfzLines.push(`xfout_lokey=${Math.max(reg.lowKey, reg.highKey - reg.keyFadeOut!)}`);
          sfzLines.push(`xfout_hikey=${reg.highKey}`);
        }
        if ((reg.velFadeIn ?? 0) > 0) {
          sfzLines.push(`xfin_lovel=${reg.lowVel}`);
          sfzLines.push(`xfin_hivel=${Math.min(reg.highVel, reg.lowVel + reg.velFadeIn!)}`);
        }
        if ((reg.velFadeOut ?? 0) > 0) {
          sfzLines.push(`xfout_lovel=${Math.max(reg.lowVel, reg.highVel - reg.velFadeOut!)}`);
          sfzLines.push(`xfout_hivel=${reg.highVel}`);
        }

        if (reg.loopMode === 'one_shot') {
          sfzLines.push('loop_mode=one_shot');
        } else if (reg.loopMode !== 'no_loop' && reg.loopEnd > reg.loopStart) {
          sfzLines.push(`loop_mode=${reg.loopMode === 'loop_sustain' ? 'loop_sustain' : 'loop_continuous'}`);
          sfzLines.push(`loop_start=${Math.round(reg.loopStart)}`);
          sfzLines.push(`loop_end=${Math.round(reg.loopEnd)}`);
          if (reg.loopCrossfadeMs > 0) {
            sfzLines.push(`loop_crossfade=${(reg.loopCrossfadeMs / 1000).toFixed(4)}`);
          }
        }

        const env = reg.ampEnvelope;
        if (env) {
          const atk = Math.max(0.001, (env.delaySec ?? 0) + (env.attackSec ?? 0.01) + (env.holdSec ?? 0));
          sfzLines.push(`ampeg_attack=${atk.toFixed(3)}`);
          sfzLines.push(`ampeg_decay=${(env.decaySec ?? 0.1).toFixed(3)}`);
          sfzLines.push(`ampeg_sustain=${Math.round((env.sustainLevel ?? 1) * 100)}`);
          sfzLines.push(`ampeg_release=${(env.releaseSec ?? 0.25).toFixed(3)}`);
        }
        sfzLines.push('');
      }

      const zipEntries: ZipEntryInput[] = [
        {
          path: `${cleanBankName}.sfz`,
          data: textEncoder.encode(sfzLines.join('\n')),
        },
      ];

      for (const [, ps] of processedSamplesMap) {
        zipEntries.push({
          path: `Samples/${ps.cleanName}`,
          data: new Uint8Array(ps.wavBuffer),
        });
      }

      outData = createZipArchive(zipEntries);
      totalFiles = zipEntries.length;
      break;
    }

    case 'dspreset': {
      // Decent Sampler XML + Samples/ in ZIP (with Fase 32.3 attributes)
      const sampleXmlLines: string[] = [];

      for (const reg of validRegions) {
        const ps = processedSamplesMap.get(reg.sampleName);
        if (!ps) continue;

        const hasLoop = reg.loopMode !== 'no_loop' && reg.loopMode !== 'one_shot' && reg.loopEnd > reg.loopStart;
        const loopStart = hasLoop ? Math.round(reg.loopStart) : 0;
        const loopEnd = hasLoop ? Math.round(reg.loopEnd) : ps.processedChannels[0].length - 1;
        const loopXfadeFrames = Math.round(((reg.loopCrossfadeMs ?? 0) / 1000) * ps.sampleRate);
        const panNorm = (reg.pan / 50).toFixed(2);
        const volNorm = reg.volumeDb !== 0 ? `${reg.volumeDb.toFixed(1)}dB` : '0dB';
        const tuning = (reg.detuneCents / 100).toFixed(2);

        const extraAttrs: string[] = [];
        if (reg.sampleStartFrame && reg.sampleStartFrame > 0) extraAttrs.push(`start="${Math.round(reg.sampleStartFrame)}"`);
        if (reg.sampleEndFrame && reg.sampleEndFrame > 0) extraAttrs.push(`end="${Math.round(reg.sampleEndFrame)}"`);
        if (loopXfadeFrames > 0) extraAttrs.push(`loopCrossfade="${loopXfadeFrames}"`);
        if (reg.trigger && reg.trigger !== 'attack') extraAttrs.push(`trigger="${reg.trigger}"`);
        if (reg.playLogic === 'round_robin') extraAttrs.push('seqMode="round_robin"');
        else if (reg.playLogic === 'random') extraAttrs.push('seqMode="random"');
        if (reg.seqPosition && reg.seqPosition >= 1) extraAttrs.push(`seqPosition="${reg.seqPosition}"`);
        if (reg.seqLength && reg.seqLength > 1) extraAttrs.push(`seqLength="${reg.seqLength}"`);
        if (reg.muteGroup && reg.muteGroup > 0) {
          extraAttrs.push(`tags="mute_${reg.muteGroup}" silencedByTags="mute_${reg.muteGroup}" silencingMode="fast"`);
        }

        sampleXmlLines.push(
          `      <sample path="Samples/${ps.cleanName}" rootNote="${reg.rootKey}" loNote="${reg.lowKey}" hiNote="${reg.highKey}" loVel="${reg.lowVel}" hiVel="${reg.highVel}" tuning="${tuning}" volume="${volNorm}" pan="${panNorm}" loopEnabled="${hasLoop ? 'true' : 'false'}" loopStart="${loopStart}" loopEnd="${loopEnd}"${extraAttrs.length > 0 ? ' ' + extraAttrs.join(' ') : ''}/>`
        );
      }

      const env = session.articulation?.ampEnv;
      const gAtk = (env?.attackSec ?? 0.01).toFixed(3);
      const gDec = (env?.decaySec ?? 0.1).toFixed(3);
      const gSus = (env?.sustainLevel ?? 1.0).toFixed(2);
      const gRel = (env?.releaseSec ?? 0.3).toFixed(3);

      const flt = session.articulation?.filter;
      const fltType =
        flt?.type === 'hpf'
          ? 'highpass'
          : flt?.type === 'bpf'
            ? 'bandpass'
            : flt?.type === 'notch' || flt?.type === 'brf'
              ? 'notch'
              : 'lowpass';
      const fltCutoff = (flt?.enabled ? flt.cutoffHz : 20000).toFixed(1);
      const fltRes = (0.7 + ((flt?.resonanceDb ?? 0) / 6)).toFixed(2);

      const dsXml = `<?xml version="1.0" encoding="UTF-8"?>
<DecentSampler minVersion="1.0.0">
  <!-- Generated by ABDNeuModMakr Raw Sampler Exporter -->
  <!-- Bank: ${cleanBankName} | Author: ${author} | License: ${license} -->
  <ui width="812" height="375" layoutMode="relative" bgMode="top_left">
    <tab name="main">
      <labeled-knob x="200" y="75" width="90" textSize="16" textColor="AAFFFFFF"
        trackForegroundColor="CC00F0FF" trackBackgroundColor="66222222"
        label="Attack" type="float" minValue="0.0" maxValue="4.0" value="${gAtk}">
        <binding type="amp" level="instrument" position="0" parameter="ENV_ATTACK"/>
      </labeled-knob>
      <labeled-knob x="320" y="75" width="90" textSize="16" textColor="AAFFFFFF"
        trackForegroundColor="CC00F0FF" trackBackgroundColor="66222222"
        label="Release" type="float" minValue="0.0" maxValue="8.0" value="${gRel}">
        <binding type="amp" level="instrument" position="0" parameter="ENV_RELEASE"/>
      </labeled-knob>
      <labeled-knob x="440" y="75" width="90" textSize="16" textColor="AAFFFFFF"
        trackForegroundColor="CC00F0FF" trackBackgroundColor="66222222"
        label="Tone" type="float" minValue="0.0" maxValue="1.0" value="1.0">
        <binding type="effect" level="instrument" position="0" parameter="FX_FILTER_FREQUENCY"
          translation="table" translationTable="0,30;0.5,1200;1,20000"/>
      </labeled-knob>
      <labeled-knob x="560" y="75" width="90" textSize="16" textColor="AAFFFFFF"
        trackForegroundColor="CC00F0FF" trackBackgroundColor="66222222"
        label="Volume" type="float" minValue="0.0" maxValue="1.0" value="0.8">
        <binding type="amp" level="instrument" position="0" parameter="AMP_VOLUME"/>
      </labeled-knob>
    </tab>
  </ui>
  <groups attack="${gAtk}" decay="${gDec}" sustain="${gSus}" release="${gRel}" volume="0dB">
    <group name="Main">
${sampleXmlLines.join('\n')}
    </group>
  </groups>
  <effects>
    <effect type="${fltType}" frequency="${fltCutoff}" resonance="${fltRes}"/>
  </effects>
</DecentSampler>
`;

      const zipEntries: ZipEntryInput[] = [
        {
          path: `${cleanBankName}.dspreset`,
          data: textEncoder.encode(dsXml),
        },
      ];

      for (const [, ps] of processedSamplesMap) {
        zipEntries.push({
          path: `Samples/${ps.cleanName}`,
          data: new Uint8Array(ps.wavBuffer),
        });
      }

      outData = createZipArchive(zipEntries);
      totalFiles = zipEntries.length;
      break;
    }

    case 'multisample': {
      // Bitwig Studio Multisample package (multisample.xml + WAVs) — Upgraded Fase 32.3
      const sampleXmlLines: string[] = [];

      for (const reg of validRegions) {
        const ps = processedSamplesMap.get(reg.sampleName);
        if (!ps) continue;

        const totalFrames = ps.processedChannels[0].length;
        const startFrame = Math.max(0, Math.round(reg.sampleStartFrame ?? 0));
        const stopFrame =
          reg.sampleEndFrame && reg.sampleEndFrame > startFrame
            ? Math.round(reg.sampleEndFrame)
            : totalFrames;

        const hasLoop = reg.loopMode !== 'no_loop' && reg.loopMode !== 'one_shot' && reg.loopEnd > reg.loopStart;
        const loopModeStr = !hasLoop ? 'off' : reg.loopMode === 'ping_pong' ? 'ping-pong' : 'loop';
        const loopStart = hasLoop ? Math.round(reg.loopStart) : 0;
        const loopStop = hasLoop ? Math.round(reg.loopEnd) : stopFrame;
        const loopLen = Math.max(1, loopStop - loopStart);
        const loopFadeFrac = hasLoop
          ? Math.max(0, Math.min(1, (((reg.loopCrossfadeMs ?? 0) / 1000) * ps.sampleRate) / loopLen))
          : 0;

        const tuneSt = (reg.detuneCents / 100).toFixed(2);
        const trackVal = ((reg.pitchKeytrack ?? 100) / 100).toFixed(4);
        const zoneLogic = reg.playLogic === 'round_robin' ? ' zone-logic="round-robin"' : ' zone-logic="always-play"';

        sampleXmlLines.push(`    <sample file="Samples/${ps.cleanName}" group="0" sample-start="${startFrame.toFixed(3)}" sample-stop="${stopFrame.toFixed(3)}" gain="${reg.volumeDb.toFixed(2)}" pan="${(reg.pan / 50).toFixed(2)}" tune="${tuneSt}" reverse="${reg.reversed ? 'true' : 'false'}"${zoneLogic} root="${reg.rootKey}" low="${reg.lowKey}" high="${reg.highKey}" low-vel="${reg.lowVel}" high-vel="${reg.highVel}" loop="${hasLoop ? 'true' : 'false'}" loop-start="${loopStart}" loop-end="${loopStop}">
      <key root="${reg.rootKey}" low="${reg.lowKey}" high="${reg.highKey}" low-fade="${reg.keyFadeIn ?? 0}" high-fade="${reg.keyFadeOut ?? 0}" tune="${tuneSt}" track="${trackVal}"/>
      <velocity low="${reg.lowVel}" high="${reg.highVel}" low-fade="${reg.velFadeIn ?? 0}" high-fade="${reg.velFadeOut ?? 0}"/>
      <loop mode="${loopModeStr}" start="${loopStart.toFixed(3)}" stop="${loopStop.toFixed(3)}" fade="${loopFadeFrac.toFixed(4)}"/>
    </sample>`);
      }

      const bitwigXml = `<?xml version="1.0" encoding="UTF-8"?>
<multisample name="${cleanBankName}" version="1.0">
  <generator name="ABDNeuModMakr" version="1.2.0"/>
  <category>${session.detectedInstrumentCategory || 'Synthesizer'}</category>
  <creator>${author}</creator>
  <description>${description} (License: ${license})</description>
  <keywords>
    <keyword>multisample</keyword>
  </keywords>
  <group name="Default" color="d92e24"/>
  <layer name="Default">
${sampleXmlLines.join('\n')}
  </layer>
</multisample>
`;

      const zipEntries: ZipEntryInput[] = [
        {
          path: 'multisample.xml',
          data: textEncoder.encode(bitwigXml),
        },
      ];

      for (const [, ps] of processedSamplesMap) {
        zipEntries.push({
          path: `Samples/${ps.cleanName}`,
          data: new Uint8Array(ps.wavBuffer),
        });
      }

      outData = createZipArchive(zipEntries);
      totalFiles = zipEntries.length;
      break;
    }

    case 'nki': {
      const zoneXmlLines: string[] = [];

      for (const reg of validRegions) {
        const ps = processedSamplesMap.get(reg.sampleName);
        if (!ps) continue;

        zoneXmlLines.push(
          `        <zone id="${reg.id}" sample="Samples/${ps.cleanName}" rootKey="${reg.rootKey}" lowKey="${reg.lowKey}" highKey="${reg.highKey}" lowVel="${reg.lowVel}" highVel="${reg.highVel}" tune="${reg.detuneCents}" volume="${reg.volumeDb.toFixed(1)}" pan="${reg.pan}" loopMode="${reg.loopMode}" loopStart="${Math.round(reg.loopStart)}" loopEnd="${Math.round(reg.loopEnd)}" sampleStart="${Math.round(reg.sampleStartFrame ?? 0)}" sampleEnd="${Math.round(reg.sampleEndFrame ?? ps.processedChannels[0].length)}"/>`
        );
      }

      const kontaktXml = `<?xml version="1.0" encoding="UTF-8"?>
<kontakt-instrument version="5.8.1">
  <header name="${cleanBankName}" author="${author}" license="${license}" comment="${description}"/>
  <groups>
    <group id="0" name="MainGroup" volume="0.0" pan="0.0">
      <zones>
${zoneXmlLines.join('\n')}
      </zones>
    </group>
  </groups>
</kontakt-instrument>
`;

      const zipEntries: ZipEntryInput[] = [
        {
          path: `${cleanBankName}.nki.xml`,
          data: textEncoder.encode(kontaktXml),
        },
      ];

      for (const [, ps] of processedSamplesMap) {
        zipEntries.push({
          path: `Samples/${ps.cleanName}`,
          data: new Uint8Array(ps.wavBuffer),
        });
      }

      outData = createZipArchive(zipEntries);
      totalFiles = zipEntries.length;
      break;
    }

    case 'vstpreset': {
      // Steinberg HALion program preset (.vstpreset.xml + Samples/ in ZIP) — Upgraded Fase 32.3
      const zoneXmlLines: string[] = [];

      for (const reg of validRegions) {
        const ps = processedSamplesMap.get(reg.sampleName);
        if (!ps) continue;

        const startFrame = Math.round(reg.sampleStartFrame ?? 0);
        const endFrame =
          reg.sampleEndFrame && reg.sampleEndFrame > startFrame
            ? Math.round(reg.sampleEndFrame)
            : ps.processedChannels[0].length;

        zoneXmlLines.push(
          `        <zone name="${cleanFilename(reg.sampleName)}" file="Samples/${ps.cleanName}" keyLow="${reg.lowKey}" keyHigh="${reg.highKey}" rootKey="${reg.rootKey}" velLow="${reg.lowVel}" velHigh="${reg.highVel}" keyFadeIn="${reg.keyFadeIn ?? 0}" keyFadeOut="${reg.keyFadeOut ?? 0}" velFadeIn="${reg.velFadeIn ?? 0}" velFadeOut="${reg.velFadeOut ?? 0}" tune="${reg.detuneCents}" gain="${reg.volumeDb.toFixed(1)}" pan="${reg.pan}" keytrack="${reg.pitchKeytrack ?? 100}" sampleStart="${startFrame}" sampleEnd="${endFrame}" reverse="${Boolean(reg.reversed)}" loop="${reg.loopMode !== 'no_loop' && reg.loopMode !== 'one_shot'}" loopMode="${reg.loopMode}" loopStart="${Math.round(reg.loopStart)}" loopEnd="${Math.round(reg.loopEnd)}" loopCrossfadeMs="${reg.loopCrossfadeMs ?? 0}" muteGroup="${reg.muteGroup ?? 0}" trigger="${reg.trigger ?? 'attack'}"${reg.keyswitchNote !== undefined ? ` keyswitchNote="${reg.keyswitchNote}"` : ''}/>`
        );
      }

      const env = session.articulation?.ampEnv;
      const flt = session.articulation?.filter;
      const envXml = env
        ? `  <amp-envelope attack="${(env.attackSec ?? 0.005).toFixed(3)}" decay="${(env.decaySec ?? 0.25).toFixed(3)}" sustain="${(env.sustainLevel ?? 1).toFixed(3)}" release="${(env.releaseSec ?? 0.2).toFixed(3)}"/>\n`
        : '';
      const fltXml = flt
        ? `  <filter enabled="${Boolean(flt.enabled)}" type="${flt.type}" poles="${flt.poles ?? 4}" cutoff="${Math.round(flt.cutoffHz)}" resonance="${(flt.resonanceDb ?? 0).toFixed(1)}" envDepth="${Math.round(flt.envToFilterCents ?? 0)}" keytrack="${Math.round(flt.keytrackCents ?? 0)}"/>\n`
        : '';

      const halionXml = `<?xml version="1.0" encoding="UTF-8"?>
<HALionProgram name="${cleanBankName}" version="7.0">
  <author>${author}</author>
  <license>${license}</license>
${envXml}${fltXml}  <element name="Layer 1">
    <zone-list>
${zoneXmlLines.join('\n')}
    </zone-list>
  </element>
</HALionProgram>
`;

      const zipEntries: ZipEntryInput[] = [
        {
          path: `${cleanBankName}.vstpreset.xml`,
          data: textEncoder.encode(halionXml),
        },
      ];

      for (const [, ps] of processedSamplesMap) {
        zipEntries.push({
          path: `Samples/${ps.cleanName}`,
          data: new Uint8Array(ps.wavBuffer),
        });
      }

      outData = createZipArchive(zipEntries);
      totalFiles = zipEntries.length;
      break;
    }

    case 'mpc_xpm':
    case 'mpc_xpn': {
      const isDrum =
        session.processConfig.keyMappingMode === 'drum' ||
        (validRegions.length > 0 && validRegions.every((r) => r.pitchKeytrack === 0 && r.lowKey === r.highKey));
      const mpcType: MpcProgramType = isDrum ? 'Drum' : 'Keygroup';

      const mpcSourceRegions: MpcSourceRegion[] = [];
      for (const reg of validRegions) {
        const ps = processedSamplesMap.get(reg.sampleName);
        if (!ps) continue;
        const hasLoop = reg.loopMode !== 'no_loop' && reg.loopEnd > reg.loopStart;
        const totalFrames = ps.processedChannels[0]?.length ?? 0;
        mpcSourceRegions.push({
          sampleName: ps.cleanName,
          lowKey: reg.lowKey,
          highKey: reg.highKey,
          rootKey: reg.rootKey,
          lowVel: reg.lowVel,
          highVel: reg.highVel,
          volumeDb: reg.volumeDb,
          pan: 0.5 + Math.max(-50, Math.min(50, reg.pan)) / 100,
          tuneCents: reg.detuneCents,
          loopStart: hasLoop ? Math.round(reg.loopStart) : 0,
          loopEnd: hasLoop ? Math.round(reg.loopEnd) : totalFrames,
          loopEnabled: hasLoop,
          sampleFrames: reg.sampleEndFrame && reg.sampleEndFrame > 0 ? Math.round(reg.sampleEndFrame) : totalFrames,
          release: reg.trigger === 'release',
          seqPosition: reg.seqPosition,
        });
      }

      const instruments = regionsToMpcInstruments(mpcSourceRegions, mpcType);
      const xpmXml = writeMpcXpm({
        name: bankName,
        type: mpcType,
        instruments,
      });

      const zipEntries: ZipEntryInput[] = [];
      if (options.format === 'mpc_xpn') {
        const expId = `com.abdsynths.${cleanBankName.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'bank'}`;
        const expXml = buildExpansionXml({
          identifier: expId,
          title: bankName,
          manufacturer: author,
          version: session.processConfig.extendedMetadata?.version || '1.0.0',
          type: isDrum ? 'drum' : 'instrument',
          description,
        });
        zipEntries.push({
          path: 'Expansion.xml',
          data: textEncoder.encode(expXml),
        });
      }

      zipEntries.push({
        path: `${cleanBankName}.xpm`,
        data: textEncoder.encode(xpmXml),
      });

      for (const [, ps] of processedSamplesMap) {
        zipEntries.push({
          path: ps.cleanName,
          data: new Uint8Array(ps.wavBuffer),
        });
      }

      outData = createZipArchive(zipEntries);
      totalFiles = zipEntries.length;
      break;
    }

    case 'ableton_adv': {
      const advRegions = validRegions.map((reg) => {
        const ps = processedSamplesMap.get(reg.sampleName)!;
        return {
          ...reg,
          cleanFileName: ps.cleanName,
          totalFrames: ps.processedChannels[0]?.length ?? 0,
        };
      });
      const advXml = buildAbletonAdvXml({
        presetName: bankName,
        regions: advRegions,
        ampEnv: session.articulation?.ampEnv,
        filter: session.articulation?.filter,
        pitchEnv: session.articulation?.pitchEnv,
      });
      const advGzip = packAbletonAdvGzip(advXml);
      const cleanFolder = bankName.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim() || 'AbletonSampler';
      const zipEntries: ZipEntryInput[] = [
        {
          path: `${cleanBankName}.adv`,
          data: advGzip,
        },
      ];
      for (const [, ps] of processedSamplesMap) {
        zipEntries.push({
          path: `Samples/Imported/${cleanFolder}/${ps.cleanName}`,
          data: new Uint8Array(ps.wavBuffer),
        });
      }
      outData = createZipArchive(zipEntries);
      totalFiles = zipEntries.length;
      break;
    }

    case 'exs24': {
      const exsRegions = validRegions.map((reg) => {
        const ps = processedSamplesMap.get(reg.sampleName)!;
        return {
          ...reg,
          cleanFileName: ps.cleanName,
          totalFrames: ps.processedChannels[0]?.length ?? 0,
          sampleRate: ps.sampleRate,
          bitDepth: options.resolution === 'pcm16' ? 16 : 24,
          channels: ps.processedChannels.length,
          byteLength: ps.wavBuffer.byteLength,
        };
      });
      const exsBin = buildExs24Binary({
        presetName: bankName,
        regions: exsRegions,
        ampEnv: session.articulation?.ampEnv,
        filter: session.articulation?.filter,
        polyphony: session.articulation?.polyphony,
        pitchBendUpSt: session.articulation?.pitchBendUpSt,
        pitchBendDownSt: session.articulation?.pitchBendDownSt,
      });
      const zipEntries: ZipEntryInput[] = [
        {
          path: `${cleanBankName}.exs`,
          data: exsBin,
        },
      ];
      for (const [, ps] of processedSamplesMap) {
        zipEntries.push({
          path: `Samples/${ps.cleanName}`,
          data: new Uint8Array(ps.wavBuffer),
        });
      }
      outData = createZipArchive(zipEntries);
      totalFiles = zipEntries.length;
      break;
    }

    case 'tal_sampler': {
      const talRegions = validRegions.map((reg) => {
        const ps = processedSamplesMap.get(reg.sampleName)!;
        return {
          ...reg,
          cleanFileName: ps.cleanName,
          totalFrames: ps.processedChannels[0]?.length ?? 0,
        };
      });
      const talXml = buildTalSamplerXml({
        presetName: bankName,
        regions: talRegions,
        ampEnv: session.articulation?.ampEnv,
        filter: session.articulation?.filter,
        pitchEnv: session.articulation?.pitchEnv,
        polyphony: session.articulation?.polyphony,
        pitchBendRangeSt: session.articulation?.pitchBendUpSt,
      });
      const zipEntries: ZipEntryInput[] = [
        {
          path: `${cleanBankName}.talsmpl`,
          data: textEncoder.encode(talXml),
        },
      ];
      for (const [, ps] of processedSamplesMap) {
        zipEntries.push({
          path: `Samples/${ps.cleanName}`,
          data: new Uint8Array(ps.wavBuffer),
        });
      }
      outData = createZipArchive(zipEntries);
      totalFiles = zipEntries.length;
      break;
    }

    case 'tx16wx': {
      const txRegions = validRegions.map((reg) => {
        const ps = processedSamplesMap.get(reg.sampleName)!;
        return {
          ...reg,
          cleanFileName: ps.cleanName,
          totalFrames: ps.processedChannels[0]?.length ?? 0,
        };
      });
      const txXml = buildTx16WxProgramXml({
        presetName: bankName,
        author,
        regions: txRegions,
        ampEnv: session.articulation?.ampEnv,
        filter: session.articulation?.filter,
        pitchEnv: session.articulation?.pitchEnv,
        polyphony: session.articulation?.polyphony,
      });
      const zipEntries: ZipEntryInput[] = [
        {
          path: `${cleanBankName}.txprog`,
          data: textEncoder.encode(txXml),
        },
      ];
      for (const [, ps] of processedSamplesMap) {
        zipEntries.push({
          path: `Samples/${ps.cleanName}`,
          data: new Uint8Array(ps.wavBuffer),
        });
      }
      outData = createZipArchive(zipEntries);
      totalFiles = zipEntries.length;
      break;
    }

    case 'korg_kmp': {
      const korgRegions = validRegions.map((reg) => {
        const ps = processedSamplesMap.get(reg.sampleName)!;
        return {
          ...reg,
          pcm16Mono: ps.pcm16Mono,
          sampleRate: ps.sampleRate,
        };
      });
      const pkg = buildKorgKmpPackage({
        presetName: bankName,
        regions: korgRegions,
      });
      const zipEntries: ZipEntryInput[] = [
        { path: pkg.kscFileName, data: textEncoder.encode(pkg.kscText) },
        { path: pkg.kmpFileName, data: pkg.kmpData },
        ...pkg.ksfFiles.map((kf) => ({ path: kf.fileName, data: kf.data })),
      ];
      outData = createZipArchive(zipEntries);
      totalFiles = zipEntries.length;
      break;
    }

    case 'dls': {
      const dlsRegions = validRegions.map((reg) => {
        const ps = processedSamplesMap.get(reg.sampleName)!;
        return {
          ...reg,
          pcm16Mono: ps.pcm16Mono,
          sampleRate: ps.sampleRate,
        };
      });
      outData = buildDlsBinary({
        bankName,
        author,
        copyright: license,
        comment: description,
        regions: dlsRegions,
        ampEnv: session.articulation?.ampEnv,
        filter: session.articulation?.filter,
        pitchEnv: session.articulation?.pitchEnv,
      });
      totalFiles = 1;
      break;
    }

    case 'music1010': {
      const sampleMap = new Map<string, ArrayBuffer>();
      for (const [name, ps] of processedSamplesMap.entries()) {
        sampleMap.set(name, ps.wavBuffer);
      }
      const inst = sessionToUniversalSamplerInstrument(session, sampleMap);
      outData = exportMusic1010Zip(inst, sampleMap);
      totalFiles = validRegions.length + 1;
      break;
    }

    case 'deluge': {
      const sampleMap = new Map<string, ArrayBuffer>();
      for (const [name, ps] of processedSamplesMap.entries()) {
        sampleMap.set(name, ps.wavBuffer);
      }
      const inst = sessionToUniversalSamplerInstrument(session, sampleMap);
      outData = exportDelugeZip(inst, sampleMap);
      totalFiles = validRegions.length + 1;
      break;
    }

    case 'renoise': {
      const sampleMap = new Map<string, ArrayBuffer>();
      for (const [name, ps] of processedSamplesMap.entries()) {
        sampleMap.set(name, ps.wavBuffer);
      }
      const inst = sessionToUniversalSamplerInstrument(session, sampleMap);
      outData = exportRenoiseXrni(inst, sampleMap);
      totalFiles = validRegions.length + 1;
      break;
    }

    case 'bliss': {
      const sampleMap = new Map<string, ArrayBuffer>();
      for (const [name, ps] of processedSamplesMap.entries()) {
        sampleMap.set(name, ps.wavBuffer);
      }
      const inst = sessionToUniversalSamplerInstrument(session, sampleMap);
      outData = exportBlissZip(inst, sampleMap);
      totalFiles = validRegions.length + 1;
      break;
    }

    case 'polyend_pti': {
      const sampleMap = new Map<string, ArrayBuffer>();
      for (const [name, ps] of processedSamplesMap.entries()) {
        sampleMap.set(name, ps.wavBuffer);
      }
      const inst = sessionToUniversalSamplerInstrument(session, sampleMap);
      outData = exportPolyendTrackerPti(inst, sampleMap);
      outFilename = `${cleanBankName}.pti`;
      mimeType = 'application/octet-stream';
      totalFiles = 1;
      break;
    }

    case 'sample_chain': {
      const chainRegions = validRegions.map((r) => {
        const ps = processedSamplesMap.get(r.sampleName)!;
        return {
          ...r,
          audioChannels: ps.processedChannels,
          sampleRate: ps.sampleRate,
        };
      });

      const resTag = options.resolution === 'pcm16' ? 'pcm16' : 'pcm24';
      const chainResult = buildLinearSampleChainWav(chainRegions, resTag, options.chainGapSamples ?? 0);

      if (options.layout === 'folder_samples') {
        const zipEntries: ZipEntryInput[] = [
          {
            path: `${cleanBankName}_chain.wav`,
            data: new Uint8Array(chainResult.wavBuffer),
          },
          {
            path: `${cleanBankName}_slices.txt`,
            data: textEncoder.encode(chainResult.slicesText),
          },
        ];
        outFilename = `${cleanBankName}_chain.zip`;
        mimeType = 'application/zip';
        outData = createZipArchive(zipEntries);
        totalFiles = 2;
      } else {
        outFilename = `${cleanBankName}_chain.wav`;
        mimeType = 'audio/wav';
        outData = new Uint8Array(chainResult.wavBuffer);
        totalFiles = 1;
      }
      break;
    }
  }

  return {
    filename: outFilename,
    mimeType,
    data: outData,
    report,
    stats: {
      totalFiles,
      totalBytes: outData.byteLength,
      totalDurationSec: totalRawDurationSec,
    },
  };
}
