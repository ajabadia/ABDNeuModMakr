// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Raw Multi-Format Sampler Exporter (Fase 16)
//
// Exports raw samples and zone/region mappings (unaltered by
// Scape/Sphere resynthesis) to industry standard sampler formats:
// - SoundFont 2.04 (.sf2 binary RIFF sfbk)
// - SFZ Format (.sfz + Samples/ folder packaged as .zip)
// - Decent Sampler (.dspreset + Samples/ folder packaged as .zip)
// - Bitwig Studio Multisample (.multisample zip package)
// - Native Instruments Kontakt (.nki.zip with XML definition)
// - Steinberg HALion (.vstpreset.zip with XML definition)
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

    // Apply normalization
    channels = normalizeChannels(channels, options.normalization);

    // Prepare 16-bit PCM mono for SF2
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

    // Determine target bit depth WAV
    const isPcm16 = options.resolution === 'pcm16' || options.format === 'sf2';
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

  // Filter out regions without audio
  const validRegions = regions.filter((r) => processedSamplesMap.has(r.sampleName));

  let outFilename = `${cleanBankName}${meta.extension}`;
  let mimeType = meta.mimeType;
  let outData: Uint8Array;
  let totalFiles = 1;

  // ── 2. Format-Specific Generation ───────────────────────
  switch (options.format) {
    case 'sf2': {
      // SoundFont 2.04 binary RIFF
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
        loopMode: (r.loopMode === 'loop_continuous' ? 'loop_continuous' : 'no_loop') as 'loop_continuous' | 'no_loop',
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
      // SFZ text + Samples/ in ZIP
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
        '',
      ];

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
        if (reg.pan !== 0) sfzLines.push(`pan=${Math.round(reg.pan * 2)}`); // -50..+50 -> -100..+100
        if (reg.pitchKeytrack !== 100) sfzLines.push(`pitch_keytrack=${reg.pitchKeytrack}`);

        if (reg.loopMode !== 'no_loop' && reg.loopEnd > reg.loopStart) {
          sfzLines.push('loop_mode=loop_continuous');
          sfzLines.push(`loop_start=${Math.round(reg.loopStart)}`);
          sfzLines.push(`loop_end=${Math.round(reg.loopEnd)}`);
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
      // Decent Sampler XML + Samples/ in ZIP
      const sampleXmlLines: string[] = [];

      for (const reg of validRegions) {
        const ps = processedSamplesMap.get(reg.sampleName);
        if (!ps) continue;

        const hasLoop = reg.loopMode !== 'no_loop' && reg.loopEnd > reg.loopStart;
        const loopStart = hasLoop ? Math.round(reg.loopStart) : 0;
        const loopEnd = hasLoop ? Math.round(reg.loopEnd) : ps.processedChannels[0].length - 1;
        const panNorm = (reg.pan / 50).toFixed(2);
        const volNorm = reg.volumeDb !== 0 ? `${reg.volumeDb.toFixed(1)}dB` : '0dB';
        const tuning = (reg.detuneCents / 100).toFixed(2);

        sampleXmlLines.push(
          `      <sample path="Samples/${ps.cleanName}" rootNote="${reg.rootKey}" loNote="${reg.lowKey}" hiNote="${reg.highKey}" loVel="${reg.lowVel}" hiVel="${reg.highVel}" tuning="${tuning}" volume="${volNorm}" pan="${panNorm}" loopEnabled="${hasLoop ? 'true' : 'false'}" loopStart="${loopStart}" loopEnd="${loopEnd}"/>`
        );
      }

      const dsXml = `<?xml version="1.0" encoding="UTF-8"?>
<DecentSampler minVersion="1.0.0">
  <!-- Generated by ABDNeuModMakr v1.2 Raw Sampler Exporter -->
  <!-- Bank: ${cleanBankName} | Author: ${author} | License: ${license} -->
  <ui width="812" height="375" layoutMode="relative" bgMode="top_left">
    <tab name="main">
      <labeled-knob x="200" y="75" width="90" textSize="16" textColor="AAFFFFFF"
        trackForegroundColor="CC00F0FF" trackBackgroundColor="66222222"
        label="Attack" type="float" minValue="0.0" maxValue="4.0" value="0.01">
        <binding type="amp" level="instrument" position="0" parameter="ENV_ATTACK"/>
      </labeled-knob>
      <labeled-knob x="320" y="75" width="90" textSize="16" textColor="AAFFFFFF"
        trackForegroundColor="CC00F0FF" trackBackgroundColor="66222222"
        label="Release" type="float" minValue="0.0" maxValue="8.0" value="0.3">
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
  <groups attack="0.01" decay="0.1" sustain="1.0" release="0.3" volume="0dB">
    <group>
${sampleXmlLines.join('\n')}
    </group>
  </groups>
  <effects>
    <effect type="lowpass" frequency="20000.0"/>
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
      // Bitwig Studio Multisample package (multisample.xml + Samples/ in ZIP)
      const sampleXmlLines: string[] = [];

      for (const reg of validRegions) {
        const ps = processedSamplesMap.get(reg.sampleName);
        if (!ps) continue;

        const hasLoop = reg.loopMode !== 'no_loop' && reg.loopEnd > reg.loopStart;
        const loopStart = hasLoop ? Math.round(reg.loopStart) : 0;
        const loopEnd = hasLoop ? Math.round(reg.loopEnd) : ps.processedChannels[0].length - 1;

        sampleXmlLines.push(
          `      <sample file="Samples/${ps.cleanName}" root="${reg.rootKey}" low="${reg.lowKey}" high="${reg.highKey}" low-vel="${reg.lowVel}" high-vel="${reg.highVel}" tune="${reg.detuneCents}" gain="${reg.volumeDb.toFixed(1)}" pan="${(reg.pan / 50).toFixed(2)}" loop="${hasLoop ? 'true' : 'false'}" loop-start="${loopStart}" loop-end="${loopEnd}"/>`
        );
      }

      const bitwigXml = `<?xml version="1.0" encoding="UTF-8"?>
<multisample version="1.0">
  <generator name="ABDNeuModMakr" version="1.2.0"/>
  <category>Synthesizer</category>
  <creator>${author}</creator>
  <comment>${description} (License: ${license})</comment>
  <groups>
    <group name="Default">
${sampleXmlLines.join('\n')}
    </group>
  </groups>
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
      // Kontakt structured definition (.nki.xml + Samples/ in ZIP)
      const zoneXmlLines: string[] = [];

      for (const reg of validRegions) {
        const ps = processedSamplesMap.get(reg.sampleName);
        if (!ps) continue;

        zoneXmlLines.push(
          `        <zone id="${reg.id}" sample="Samples/${ps.cleanName}" rootKey="${reg.rootKey}" lowKey="${reg.lowKey}" highKey="${reg.highKey}" lowVel="${reg.lowVel}" highVel="${reg.highVel}" tune="${reg.detuneCents}" volume="${reg.volumeDb.toFixed(1)}" pan="${reg.pan}" loopMode="${reg.loopMode}" loopStart="${Math.round(reg.loopStart)}" loopEnd="${Math.round(reg.loopEnd)}"/>`
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
      // Steinberg HALion program preset (.vstpreset.xml + Samples/ in ZIP)
      const zoneXmlLines: string[] = [];

      for (const reg of validRegions) {
        const ps = processedSamplesMap.get(reg.sampleName);
        if (!ps) continue;

        zoneXmlLines.push(
          `        <zone name="${cleanFilename(reg.sampleName)}" file="Samples/${ps.cleanName}" keyLow="${reg.lowKey}" keyHigh="${reg.highKey}" rootKey="${reg.rootKey}" velLow="${reg.lowVel}" velHigh="${reg.highVel}" tune="${reg.detuneCents}" gain="${reg.volumeDb.toFixed(1)}" pan="${reg.pan}" loop="${reg.loopMode !== 'no_loop'}" loopStart="${Math.round(reg.loopStart)}" loopEnd="${Math.round(reg.loopEnd)}"/>`
        );
      }

      const halionXml = `<?xml version="1.0" encoding="UTF-8"?>
<HALionProgram name="${cleanBankName}" version="7.0">
  <author>${author}</author>
  <license>${license}</license>
  <element name="Layer 1">
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

      // MPC expects WAVs in the same directory as the .xpm
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

    case 'sample_chain': {
      // Concatenated linear sample chain WAV with RIFF cue markers
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
        // Zip with WAV + Slice Documentation Map
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
        // Monolithic .wav with embedded markers
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
