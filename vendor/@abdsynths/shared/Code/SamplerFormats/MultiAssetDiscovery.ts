// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Multi-Asset Discovery Engine (Fase 29)
//
// Recursively discovers heterogeneous sampler instruments, multisample
// packs, SoundFonts, and loose sample groups from a VirtualZipFs or directory.
// ─────────────────────────────────────────────────────────

import { VirtualZipFs, type VirtualFileEntry } from './VirtualZipFs.ts';
import { isSupportedAudioFileName } from '../NeuronFormats/UniversalAudioDecoder.ts';
import { listSf2Presets } from './Sf2Parser.ts';

const BARE_NOTE_OR_LAYER_RE =
  /^(?:[A-Ga-g][#b]?-?[0-9]|0?\d{1,3}|v[0-9]+|vl[0-9]+|vel[0-9]+|velocity[0-9]+|rr[0-9]+|layer[0-9]+|low|high|soft|loud)$/i;

export function extractInstrumentPrefix(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').trim();
  if (!base) return 'Instrument';

  const rawTokens = base.split(/[_\-\s]+/).filter(Boolean);
  if (rawTokens.length === 0) return 'Instrument';

  let endIdx = rawTokens.length;
  while (endIdx > 0 && BARE_NOTE_OR_LAYER_RE.test(rawTokens[endIdx - 1])) {
    endIdx--;
  }

  let startIdx = 0;
  if (endIdx - startIdx > 1 && /^\d{1,3}$/.test(rawTokens[0])) {
    startIdx = 1;
  }

  const kept = rawTokens.slice(startIdx, endIdx);
  if (kept.length === 0 || kept.every((t) => BARE_NOTE_OR_LAYER_RE.test(t))) {
    return 'Instrument';
  }

  return kept.join(' ').trim() || 'Instrument';
}

export type DiscoveredAssetFormat =
  | 'sf2'
  | 'sfz'
  | 'dspreset'
  | 'nki'
  | 'vstpreset'
  | 'multisample'
  | 'ableton_adv'
  | 'exs24'
  | 'tal_sampler'
  | 'tx16wx'
  | 'korg_kmp'
  | 'dls'
  | 'mpc_xpm'
  | 'mpc_classic'
  | 'akai_mesa'
  | 'akai_akp'
  | 'reason_nnxt'
  | 'directwave'
  | 'soundbox'
  | 'omnisphere'
  | 'ni_maschine'
  | 'kurzweil'
  | 'yamaha_ysfc'
  | 'casio_fz'
  | 'synclavier'
  | 'fairlight_cmi'
  | 'neuron_bank'
  | 'sample_pack'
  | 'loop_slice';

export interface DiscoveredSamplerItem {
  id: string;
  name: string;
  format: DiscoveredAssetFormat;
  formatLabel: string;
  primaryFilePath: string;
  companionFilePaths: string[];
  sampleCount: number;
  totalSizeBytes: number;
  detail: string;
  /** Specific sub-preset index within container (e.g. SF2 bank/preset or Akai program index) */
  subIndex?: number;
  bank?: number;
  presetNumber?: number;
}

export interface MultiAssetDiscoveryReport {
  items: DiscoveredSamplerItem[];
  totalSamples: number;
  totalSizeBytes: number;
  formatBreakdown: Record<string, number>;
}

function cleanNameFromPath(path: string): string {
  const base = path.split('/').pop() || path;
  return base.replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ').trim();
}

/**
 * Discovers all sampler assets in a VirtualZipFs.
 */
export async function discoverSamplerAssets(
  vfs: VirtualZipFs,
  rootOriginName = 'Source'
): Promise<MultiAssetDiscoveryReport> {
  const allFiles = vfs.listFiles();
  const items: DiscoveredSamplerItem[] = [];

  const audioFiles: VirtualFileEntry[] = [];
  const handledFiles = new Set<string>();

  // Separate definition files and audio files
  for (const f of allFiles) {
    const lower = f.name.toLowerCase();
    if (isSupportedAudioFileName(lower)) {
      audioFiles.push(f);
    }
  }

  // 1. SoundFont 2 (.sf2)
  for (const f of allFiles) {
    if (f.name.toLowerCase().endsWith('.sf2')) {
      handledFiles.add(f.path);
      try {
        const sf2Bytes = await Promise.resolve(f.getData());
        const presets = listSf2Presets(sf2Bytes.buffer as ArrayBuffer);
        if (presets.length === 0) {
          items.push({
            id: f.path,
            name: cleanNameFromPath(f.path),
            format: 'sf2',
            formatLabel: 'SoundFont 2',
            primaryFilePath: f.path,
            companionFilePaths: [],
            sampleCount: 0,
            totalSizeBytes: f.size,
            detail: 'SoundFont 2 Bank',
          });
        } else {
          for (const p of presets) {
            items.push({
              id: `${f.path}::${p.index}`,
              name: p.name || `${cleanNameFromPath(f.path)} #${p.presetNumber}`,
              format: 'sf2',
              formatLabel: 'SoundFont 2',
              primaryFilePath: f.path,
              companionFilePaths: [],
              sampleCount: p.regionCount || 0,
              totalSizeBytes: f.size,
              detail: `SF2 Bank ${p.bank} : Prog ${p.presetNumber}`,
              subIndex: p.index,
              bank: p.bank,
              presetNumber: p.presetNumber,
            });
          }
        }
      } catch {
        items.push({
          id: f.path,
          name: cleanNameFromPath(f.path),
          format: 'sf2',
          formatLabel: 'SoundFont 2',
          primaryFilePath: f.path,
          companionFilePaths: [],
          sampleCount: 1,
          totalSizeBytes: f.size,
          detail: 'SoundFont 2 Archive',
        });
      }
    }
  }

  // Helper to find companion samples in the same directory or child directories
  const getCompanionSamplesForDef = (defPath: string): string[] => {
    const parts = defPath.split('/');
    const dir = parts.length > 1 ? parts.slice(0, parts.length - 1).join('/') : '';
    const prefix = dir ? `${dir}/` : '';
    const matched: string[] = [];
    for (const af of audioFiles) {
      if (dir === '' || af.path.startsWith(prefix)) {
        matched.push(af.path);
      }
    }
    return matched;
  };

  // 1b. Hartmann Neuron / Neuronik Banks & Models (.model, .nmpack, .neuronikmodel, .nmmodel, MName, map.script, .scape, .sphere)
  const neuronDirs = new Map<string, VirtualFileEntry[]>();
  for (const f of allFiles) {
    if (handledFiles.has(f.path)) continue;
    const lower = f.name.toLowerCase();
    // Standalone .neuronikmodel / .nmmodel / .model / .nmpack file
    if (/\.(neuronikmodel|nmmodel|model|nmpack)$/i.test(lower)) {
      handledFiles.add(f.path);
      const companions = getCompanionSamplesForDef(f.path);
      for (const c of companions) handledFiles.add(c);
      items.push({
        id: f.path,
        name: cleanNameFromPath(f.path),
        format: 'neuron_bank',
        formatLabel: 'Hartmann Neuron / Neuronik',
        primaryFilePath: f.path,
        companionFilePaths: companions,
        sampleCount: Math.max(1, companions.length),
        totalSizeBytes: f.size + companions.reduce((acc, c) => acc + (vfs.getFile(c)?.size || 0), 0),
        detail: `Hartmann / Neuronik Model (${companions.length > 0 ? `${companions.length} companion audio` : 'self-contained'})`,
      });
      continue;
    }
    // Directory-based Hartmann Neuron model (MName, map.script, .scape, .sphere)
    if (
      lower === 'mname' ||
      lower === 'map.script' ||
      lower.endsWith('.scape') ||
      lower.endsWith('.sphere')
    ) {
      const parts = f.path.split('/');
      const dir = parts.length > 1 ? parts.slice(0, parts.length - 1).join('/') : '';
      const grp = neuronDirs.get(dir) ?? [];
      grp.push(f);
      neuronDirs.set(dir, grp);
    }
  }

  for (const [dir, nFiles] of neuronDirs.entries()) {
    for (const nf of nFiles) handledFiles.add(nf.path);
    // Also claim any sibling audio files in the same model directory
    const prefix = dir ? `${dir}/` : '';
    const dirCompanions: VirtualFileEntry[] = [...nFiles];
    for (const af of audioFiles) {
      if (handledFiles.has(af.path)) continue;
      const afDir = af.path.includes('/') ? af.path.slice(0, af.path.lastIndexOf('/')) : '';
      if (afDir === dir || (dir !== '' && af.path.startsWith(prefix))) {
        handledFiles.add(af.path);
        dirCompanions.push(af);
      }
    }

    const mnameFile = nFiles.find((nf) => nf.name.toLowerCase() === 'mname');
    const mapScriptFile = nFiles.find((nf) => nf.name.toLowerCase() === 'map.script');
    const scapeCount = nFiles.filter((nf) => nf.name.toLowerCase().endsWith('.scape')).length;
    const primaryEntry = mnameFile ?? mapScriptFile ?? nFiles[0];

    let displayName = dir ? cleanNameFromPath(dir) : cleanNameFromPath(primaryEntry.path);
    if (mnameFile) {
      try {
        const rawBytes = await Promise.resolve(mnameFile.getData());
        const txt = new TextDecoder('latin1').decode(rawBytes).replace(/\0+/g, '').trim();
        if (txt) displayName = txt;
      } catch {
        // fallback to directory name
      }
    }

    const totalBytes = dirCompanions.reduce((acc, cf) => acc + cf.size, 0);
    const companionPaths = dirCompanions
      .map((cf) => cf.path)
      .filter((p) => p !== primaryEntry.path);

    items.push({
      id: `neuron_bank_${dir || primaryEntry.path}`,
      name: displayName || 'Hartmann Neuron Model',
      format: 'neuron_bank',
      formatLabel: 'Hartmann Neuron / Neuronik',
      primaryFilePath: primaryEntry.path,
      companionFilePaths: companionPaths,
      sampleCount: Math.max(1, scapeCount || dirCompanions.length),
      totalSizeBytes: totalBytes,
      detail: `Hartmann Neuron Bank (${scapeCount > 0 ? `${scapeCount} scape/sphere` : `${dirCompanions.length} files`})`,
    });
  }

  // 2. Specialized Sampler definitions
  const DEF_SPECS: Array<{
    extRegex: RegExp;
    format: DiscoveredAssetFormat;
    label: string;
  }> = [
    { extRegex: /\.sfz$/i, format: 'sfz', label: 'SFZ Instrument' },
    { extRegex: /\.dspreset$/i, format: 'dspreset', label: 'Decent Sampler' },
    { extRegex: /\.nki(\.xml)?$/i, format: 'nki', label: 'Kontakt Patch' },
    { extRegex: /\.vstpreset(\.xml)?$/i, format: 'vstpreset', label: 'HALion VST Preset' },
    { extRegex: /\.(multisample|multisample\.xml)$/i, format: 'multisample', label: 'Bitwig Multisample' },
    { extRegex: /\.adv$/i, format: 'ableton_adv', label: 'Ableton Sampler/Simpler' },
    { extRegex: /\.exs$/i, format: 'exs24', label: 'Logic EXS24' },
    { extRegex: /\.talsmpl$/i, format: 'tal_sampler', label: 'TAL-Sampler' },
    { extRegex: /\.txprog$/i, format: 'tx16wx', label: 'CWITEC TX16Wx' },
    { extRegex: /\.kmp$/i, format: 'korg_kmp', label: 'Korg Multisample' },
    { extRegex: /\.dls$/i, format: 'dls', label: 'Downloadable Sounds (DLS)' },
    { extRegex: /\.(xpm|xty|xtd)$/i, format: 'mpc_xpm', label: 'Akai MPC Modern' },
    { extRegex: /\.(pgm|set)$/i, format: 'mpc_classic', label: 'Akai MPC Classic' },
    { extRegex: /\.s3p$/i, format: 'akai_mesa', label: 'Akai MESA' },
    { extRegex: /\.akp$/i, format: 'akai_akp', label: 'Akai S5000/S6000' },
    { extRegex: /\.sxt$/i, format: 'reason_nnxt', label: 'Reason NN-XT' },
    { extRegex: /\.dwp$/i, format: 'directwave', label: 'DirectWave' },
    { extRegex: /\.(sbpack|sbx)$/i, format: 'soundbox', label: 'Soundbox Pack' },
    { extRegex: /\.(zmap|prt_omn)$/i, format: 'omnisphere', label: 'Omnisphere' },
    { extRegex: /\.(mxsnd|mxgrp|nicnt)$/i, format: 'ni_maschine', label: 'NI Maschine' },
    { extRegex: /\.(krz|k25|k26)$/i, format: 'kurzweil', label: 'Kurzweil' },
    { extRegex: /\.(x7u|x8u|x3a)$/i, format: 'yamaha_ysfc', label: 'Yamaha Motif/Montage' },
    { extRegex: /\.(fzv|fzf)$/i, format: 'casio_fz', label: 'Casio FZ' },
    { extRegex: /\.(synx)$/i, format: 'synclavier', label: 'Synclavier' },
    { extRegex: /\.(cmi|cmi3|vc)$/i, format: 'fairlight_cmi', label: 'Fairlight CMI' },
  ];

  for (const f of allFiles) {
    if (handledFiles.has(f.path)) continue;
    for (const spec of DEF_SPECS) {
      if (spec.extRegex.test(f.name)) {
        handledFiles.add(f.path);
        const companions = getCompanionSamplesForDef(f.path);
        for (const c of companions) handledFiles.add(c);
        items.push({
          id: f.path,
          name: cleanNameFromPath(f.path),
          format: spec.format,
          formatLabel: spec.label,
          primaryFilePath: f.path,
          companionFilePaths: companions,
          sampleCount: companions.length || 1,
          totalSizeBytes: f.size + companions.reduce((acc, c) => acc + (vfs.getFile(c)?.size || 0), 0),
          detail: `${spec.label} (${companions.length} audio files)`,
        });
        break;
      }
    }
  }

  // 3. Loops / Slice files (.rx2, .rex)
  for (const f of audioFiles) {
    if (handledFiles.has(f.path)) continue;
    const lower = f.name.toLowerCase();
    if (lower.endsWith('.rx2') || lower.endsWith('.rex') || lower.endsWith('.rcy')) {
      handledFiles.add(f.path);
      items.push({
        id: f.path,
        name: cleanNameFromPath(f.path),
        format: 'loop_slice',
        formatLabel: 'ReCycle Loop',
        primaryFilePath: f.path,
        companionFilePaths: [],
        sampleCount: 1,
        totalSizeBytes: f.size,
        detail: 'Sliced audio loop',
      });
    }
  }

  // 4. Remaining unhandled audio files: group by subfolder or instrument name prefix
  const remainingAudio = audioFiles.filter((af) => !handledFiles.has(af.path));
  if (remainingAudio.length > 0) {
    // Group first by folder
    const folderGroups = new Map<string, VirtualFileEntry[]>();
    for (const af of remainingAudio) {
      const parts = af.path.split('/');
      const dir = parts.length > 1 ? parts.slice(0, parts.length - 1).join('/') : '';
      const list = folderGroups.get(dir) || [];
      list.push(af);
      folderGroups.set(dir, list);
    }

    for (const [dir, filesInDir] of folderGroups.entries()) {
      // Within each directory, sub-group by instrument prefix (e.g. Piano_C1.wav, Strings_C3.wav)
      const prefixGroups = new Map<string, VirtualFileEntry[]>();
      for (const f of filesInDir) {
        const prefix = extractInstrumentPrefix(f.name);
        const list = prefixGroups.get(prefix) || [];
        list.push(f);
        prefixGroups.set(prefix, list);
      }

      for (const [prefix, groupedFiles] of prefixGroups.entries()) {
        const groupName = dir ? (prefix !== 'Instrument' ? `${prefix} (${dir})` : dir) : prefix;
        const totalSize = groupedFiles.reduce((acc, gf) => acc + gf.size, 0);
        items.push({
          id: `sample_pack_${dir ? dir + '_' : ''}${prefix}`,
          name: groupName,
          format: 'sample_pack',
          formatLabel: 'Sample Directory',
          primaryFilePath: groupedFiles[0].path,
          companionFilePaths: groupedFiles.map((gf) => gf.path),
          sampleCount: groupedFiles.length,
          totalSizeBytes: totalSize,
          detail: `Multisample Pack (${groupedFiles.length} samples)`,
        });
      }
    }
  }

  // Calculate totals
  let totalSamples = 0;
  let totalSizeBytes = 0;
  const formatBreakdown: Record<string, number> = {};

  for (const it of items) {
    totalSamples += it.sampleCount;
    totalSizeBytes += it.totalSizeBytes;
    formatBreakdown[it.formatLabel] = (formatBreakdown[it.formatLabel] || 0) + 1;
  }

  return {
    items,
    totalSamples,
    totalSizeBytes,
    formatBreakdown,
  };
}
