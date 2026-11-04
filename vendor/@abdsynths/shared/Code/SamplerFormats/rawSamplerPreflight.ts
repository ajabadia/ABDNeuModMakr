// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Preflight Inspection Engine (Fase 16 + Fase 32.3/32.4)
//
// Evaluates session zones, audio buffers, sample rates, loop points,
// and articulation envelopes against destination sampler specifications.
// ─────────────────────────────────────────────────────────

import type { SamplerSessionLike as Session } from './SamplerTypes.ts';
import { decodeWav, type DecodedWav } from '../NeuronFormats/index.ts';
import type {
  PreflightIssue,
  RawExportOptions,
  RawSamplerFormat,
  RawSamplerPreflightReport,
  UniformSamplerRegion,
} from './rawSamplerTypes.ts';
import { syncExtendedRegionsFromClassicZones } from './ExtendedAdapter.ts';

export type SharedLocale = 'es' | 'en';

/**
 * Resolves the active locale ('es' | 'en') from explicit argument, localStorage, or document.documentElement.lang.
 * Defaults to 'es' when unset to preserve deterministic backward compatibility in headless tests.
 */
export function resolveSharedLocale(explicitLocale?: SharedLocale): SharedLocale {
  if (explicitLocale === 'en' || explicitLocale === 'es') return explicitLocale;
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      const saved =
        globalThis.localStorage.getItem('abdsynths.locale') ||
        globalThis.localStorage.getItem('abd_locale') ||
        globalThis.localStorage.getItem('neumodmakr.locale');
      if (saved === 'en' || saved === 'es') return saved;
    }
    if (typeof document !== 'undefined' && document.documentElement?.lang) {
      const docLang = document.documentElement.lang.slice(0, 2).toLowerCase();
      if (docLang === 'en' || docLang === 'es') return docLang;
    }
  } catch {
    // Ignore storage/DOM access errors
  }
  return 'es';
}

export interface SamplerFormatMetaEntry {
  title: string;
  description: string;
  descriptionEs?: string;
  descriptionEn?: string;
  extension: string;
  mimeType: string;
}

function defineFormatMeta(entry: {
  title: string;
  descriptionEs: string;
  descriptionEn: string;
  extension: string;
  mimeType: string;
}): SamplerFormatMetaEntry {
  return {
    title: entry.title,
    descriptionEs: entry.descriptionEs,
    descriptionEn: entry.descriptionEn,
    get description(): string {
      return resolveSharedLocale() === 'es' ? entry.descriptionEs : entry.descriptionEn;
    },
    extension: entry.extension,
    mimeType: entry.mimeType,
  };
}

export const SAMPLER_FORMAT_METADATA: Record<RawSamplerFormat, SamplerFormatMetaEntry> = {
  sf2: defineFormatMeta({
    title: 'SoundFont 2 (.sf2)',
    descriptionEs: 'Estándar binario RIFF sfbk autocontenido (v2.04) compatible con SoundFont hardware y software.',
    descriptionEn: 'Self-contained RIFF sfbk binary standard (v2.04) compatible with hardware and software SoundFont synths.',
    extension: '.sf2',
    mimeType: 'audio/x-soundfont',
  }),
  sfz: defineFormatMeta({
    title: 'SFZ Format (.sfz + Samples)',
    descriptionEs: 'Definición de texto plano estándar compatible con Plogue Sforzando, Cakewalk y LinuxSampler.',
    descriptionEn: 'Standard plain-text instrument definition compatible with Plogue Sforzando, Cakewalk, and LinuxSampler.',
    extension: '.sfz.zip',
    mimeType: 'application/zip',
  }),
  dspreset: defineFormatMeta({
    title: 'Decent Sampler (.dspreset + Samples)',
    descriptionEs: 'Formato XML abierto moderno con soporte de GUI para el sampler virtual Decent Sampler.',
    descriptionEn: 'Modern open XML format with custom GUI support for the Decent Sampler virtual instrument.',
    extension: '.dspreset.zip',
    mimeType: 'application/zip',
  }),
  multisample: defineFormatMeta({
    title: 'Bitwig Studio Multisample (.multisample)',
    descriptionEs: 'Paquete multisample nativo de Bitwig Studio con metadatos XML y muestras de audio.',
    descriptionEn: 'Native Bitwig Studio multisample package containing XML metadata and audio samples.',
    extension: '.multisample',
    mimeType: 'application/zip',
  }),
  nki: defineFormatMeta({
    title: 'Native Instruments Kontakt (.nki XML)',
    descriptionEs: 'Definición estructurada de instrumento Kontakt con mapeo de grupos y zonas.',
    descriptionEn: 'Structured Kontakt instrument definition with group and zone mapping.',
    extension: '.nki.zip',
    mimeType: 'application/zip',
  }),
  vstpreset: defineFormatMeta({
    title: 'Steinberg HALion (.vstpreset)',
    descriptionEs: 'Preset estructurado XML/VST3 de programa HALion con capas de zona.',
    descriptionEn: 'Structured XML/VST3 HALion program preset with zone layers.',
    extension: '.vstpreset.zip',
    mimeType: 'application/zip',
  }),
  mpc_xpm: defineFormatMeta({
    title: 'Akai MPC Keygroup / Drum Program (.xpm + WAV)',
    descriptionEs: 'Programa nativo Akai MPC 2.x / 3.x (<MPCVObject> XML, 128 instrumentos x 4 capas) con WAVs hermanos listos para MPC Live/One/X/Key y MPC Software.',
    descriptionEn: 'Native Akai MPC 2.x / 3.x program (<MPCVObject> XML, 128 instruments x 4 layers) with sibling WAVs ready for MPC Live/One/X/Key and MPC Software.',
    extension: '.xpm.zip',
    mimeType: 'application/zip',
  }),
  mpc_xpn: defineFormatMeta({
    title: 'Akai MPC Expansion Pack (.xpn)',
    descriptionEs: 'Paquete de expansión instalable para Akai MPC Software y hardware autónomo (Expansion.xml + programa .xpm + muestras WAV).',
    descriptionEn: 'Installable expansion pack for Akai MPC Software and standalone hardware (Expansion.xml + .xpm program + WAV samples).',
    extension: '.xpn',
    mimeType: 'application/zip',
  }),
  ableton_adv: defineFormatMeta({
    title: 'Ableton Sampler / Simpler (.adv + Samples)',
    descriptionEs: 'Preset nativo de Ableton Live (<MultiSampler> GZIP XML) con muestras en Samples/Imported/.',
    descriptionEn: 'Native Ableton Live preset (<MultiSampler> GZIP XML) with samples in Samples/Imported/.',
    extension: '.adv.zip',
    mimeType: 'application/zip',
  }),
  exs24: defineFormatMeta({
    title: 'Apple Logic EXS24 / Sampler (.exs + Samples)',
    descriptionEs: 'Instrumento binario EXS24 / Logic Pro Sampler (bloques SOBT/TBOS) con zonas, grupos, filtros y muestras WAV.',
    descriptionEn: 'Binary EXS24 / Logic Pro Sampler instrument (SOBT/TBOS blocks) with zones, groups, filters, and WAV samples.',
    extension: '.exs.zip',
    mimeType: 'application/zip',
  }),
  tal_sampler: defineFormatMeta({
    title: 'TAL-Sampler (.talsmpl + Samples)',
    descriptionEs: 'Preset XML de Togu Audio Line TAL-Sampler (hasta 4 capas estéreo, envolventes y filtro modelado).',
    descriptionEn: 'Togu Audio Line TAL-Sampler XML preset (up to 4 stereo layers, envelopes, and modeled filter).',
    extension: '.talsmpl.zip',
    mimeType: 'application/zip',
  }),
  tx16wx: defineFormatMeta({
    title: 'CWITEC TX16Wx Software Sampler (.txprog + Samples)',
    descriptionEs: 'Programa XML de CWITEC TX16Wx 3.0 con waves, loops, soundshapes (AEG/Filter/Env) y grupos con crossfade.',
    descriptionEn: 'CWITEC TX16Wx 3.0 XML program with waves, loops, soundshapes (AEG/Filter/Env), and crossfaded groups.',
    extension: '.txprog.zip',
    mimeType: 'application/zip',
  }),
  korg_kmp: defineFormatMeta({
    title: 'Korg Trinity / Triton / M3 / Pa (.KMP + .KSF)',
    descriptionEs: 'Multisample hardware Korg Big-Endian (.KMP + muestras .KSF de 16-bit y script .KSC).',
    descriptionEn: 'Big-Endian Korg hardware multisample (.KMP + 16-bit .KSF samples and .KSC script).',
    extension: '.kmp.zip',
    mimeType: 'application/zip',
  }),
  dls: defineFormatMeta({
    title: 'MMA Downloadable Sounds Level 2 (.dls)',
    descriptionEs: 'Banco binario autocontenido RIFF "DLS " (Level 1/2) con regiones, bloques de articulación (lart/lar2) y wave pool.',
    descriptionEn: 'Self-contained RIFF "DLS " binary bank (Level 1/2) with regions, articulation blocks (lart/lar2), and wave pool.',
    extension: '.dls',
    mimeType: 'audio/x-dls',
  }),
  akai_disk: defineFormatMeta({
    title: 'Akai S-Series Disk Image (.iso, .img, .dsk)',
    descriptionEs: 'Imagen de disco SCSI CD-ROM o disquete 3.5" (Gotek FlashFloppy) de samplers Akai S900/S950/S1000/S1100/S2000/S3000 con particiones y volúmenes.',
    descriptionEn: 'SCSI CD-ROM or 3.5" floppy disk image (Gotek FlashFloppy) for Akai S900/S950/S1000/S1100/S2000/S3000 samplers with partitions and volumes.',
    extension: '.iso',
    mimeType: 'application/octet-stream',
  }),
  emu_disk: defineFormatMeta({
    title: 'E-mu EOS / EIII Disk Image (.iso, .img, .hda, .e4b, .esi)',
    descriptionEs: 'Imagen de disco del sistema de archivos EMU3 y bancos nativos de samplers E-mu Emulator III, EIIIX, ESI-32/4000 y serie Emulator IV (EOS).',
    descriptionEn: 'EMU3 filesystem disk image and native banks for E-mu Emulator III, EIIIX, ESI-32/4000, and Emulator IV (EOS) series samplers.',
    extension: '.iso',
    mimeType: 'application/octet-stream',
  }),
  roland_disk: defineFormatMeta({
    title: 'Roland S-7xx Disk Image (.iso, .img, .out)',
    descriptionEs: 'Imagen de CD-ROM o disco duro SCSI para samplers Roland S-770, S-750, S-760 y SP-700 con patches, partials y clusters de audio.',
    descriptionEn: 'SCSI CD-ROM or hard disk image for Roland S-770, S-750, S-760, and SP-700 samplers with patches, partials, and audio clusters.',
    extension: '.iso',
    mimeType: 'application/octet-stream',
  }),
  ensoniq_disk: defineFormatMeta({
    title: 'Ensoniq EPS / ASR Disk Image (.img, .dsk, .efe, .ede)',
    descriptionEs: 'Imagen de disquete o disco SCSI y ficheros de instrumento para Ensoniq EPS, EPS-16 Plus y ASR-10.',
    descriptionEn: 'Floppy or SCSI disk image and instrument files for Ensoniq EPS, EPS-16 Plus, and ASR-10.',
    extension: '.img',
    mimeType: 'application/octet-stream',
  }),
  yamaha_disk: defineFormatMeta({
    title: 'Yamaha A-Series SFS Disk Image (.iso, .img, .hda)',
    descriptionEs: 'Imagen de disco Sampler File System (SFS) y contenedores YSFC para samplers Yamaha A3000, A4000 y A5000.',
    descriptionEn: 'Sampler File System (SFS) disk image and YSFC containers for Yamaha A3000, A4000, and A5000 samplers.',
    extension: '.iso',
    mimeType: 'application/octet-stream',
  }),
  music1010: defineFormatMeta({
    title: '1010music Blackbox / Tangerine (preset.xml)',
    descriptionEs: 'Preset XML multi-sample y drum cells para hardware 1010music Blackbox y Nanobox Tangerine.',
    descriptionEn: 'Multi-sample and drum cell XML preset for 1010music Blackbox and Nanobox Tangerine hardware.',
    extension: '.zip',
    mimeType: 'application/zip',
  }),
  deluge: defineFormatMeta({
    title: 'Synthstrom Deluge (SYNTHS/*.XML)',
    descriptionEs: 'Preset XML de sintetizador o kit para tarjeta SD de Synthstrom Deluge con sampleRanges y filtros 12/24dB.',
    descriptionEn: 'Synth or kit XML preset for Synthstrom Deluge SD card with sampleRanges and 12/24dB filters.',
    extension: '.zip',
    mimeType: 'application/zip',
  }),
  renoise: defineFormatMeta({
    title: 'Renoise Instrument (.xrni)',
    descriptionEs: 'Instrumento completo de Renoise con Instrument.xml y muestras en formato FLAC en SampleData/.',
    descriptionEn: 'Complete Renoise instrument with Instrument.xml and FLAC samples in SampleData/.',
    extension: '.xrni',
    mimeType: 'application/zip',
  }),
  bliss: defineFormatMeta({
    title: 'discoDSP Bliss (.zbp)',
    descriptionEs: 'Archivo de banco o programa ZIP para discoDSP Bliss con program.xml y muestras FLAC.',
    descriptionEn: 'ZIP bank or program file for discoDSP Bliss with program.xml and FLAC samples.',
    extension: '.zbp',
    mimeType: 'application/zip',
  }),
  polyend_pti: defineFormatMeta({
    title: 'Polyend Tracker / Play (.pti)',
    descriptionEs: 'Instrumento binario para Polyend Tracker y Play (cabecera TI + parámetros + audio PCM16 44.1kHz).',
    descriptionEn: 'Binary instrument for Polyend Tracker and Play (TI header + parameters + 44.1kHz PCM16 audio).',
    extension: '.pti',
    mimeType: 'application/octet-stream',
  }),
  waldorf_qpat: defineFormatMeta({
    title: 'Waldorf Quantum / Iridium (.qpat)',
    descriptionEs: 'Contenedor de patch y mapa de muestras para sintetizadores Waldorf Quantum e Iridium.',
    descriptionEn: 'Patch container and sample map for Waldorf Quantum and Iridium synthesizers.',
    extension: '.zip',
    mimeType: 'application/zip',
  }),
  opxy: defineFormatMeta({
    title: 'Teenage Engineering OP-XY (.preset)',
    descriptionEs: 'Paquete de preset multisampler para Teenage Engineering OP-XY (patch.json + muestras WAV).',
    descriptionEn: 'Multisampler preset package for Teenage Engineering OP-XY (patch.json + WAV samples).',
    extension: '.zip',
    mimeType: 'application/zip',
  }),
  tonverk: defineFormatMeta({
    title: 'Elektron Tonverk (.tvpst / elmulti)',
    descriptionEs: 'Preset de instrumento o multi-sample para sintetizador/groovebox Elektron Tonverk.',
    descriptionEn: 'Instrument or multi-sample preset for Elektron Tonverk synthesizer/groovebox.',
    extension: '.zip',
    mimeType: 'application/zip',
  }),
  disting_ex: defineFormatMeta({
    title: 'Expert Sleepers Disting EX (.dexpreset)',
    descriptionEs: 'Preset de multisample para módulo eurorack Expert Sleepers Disting EX (archivo DEXBPRST + WAVs).',
    descriptionEn: 'Multisample preset for Expert Sleepers Disting EX eurorack module (DEXBPRST file + WAVs).',
    extension: '.zip',
    mimeType: 'application/zip',
  }),
  prophet_x: defineFormatMeta({
    title: 'Sequential Prophet X / XL (.grp)',
    descriptionEs: 'Grupo multisample para sintetizadores híbridos Sequential Prophet X y Prophet XL (mapa TSV de 15 columnas + muestras a 48 kHz).',
    descriptionEn: 'Multisample group for Sequential Prophet X and Prophet XL hybrid synthesizers (15-column TSV map + 48 kHz samples).',
    extension: '.zip',
    mimeType: 'application/zip',
  }),
  isla_s2400: defineFormatMeta({
    title: 'Isla Instruments S2400 (.kit / .s24)',
    descriptionEs: 'Kit y configuración de pistas TLV para el sampler/groovebox Isla Instruments S2400 con muestras WAV.',
    descriptionEn: 'Kit and TLV track configuration for Isla Instruments S2400 sampler/groovebox with WAV samples.',
    extension: '.zip',
    mimeType: 'application/zip',
  }),
  korg_modern: defineFormatMeta({
    title: 'Korg Modern Multisample (.korgmultisample)',
    descriptionEs: 'Multisample moderno Korg para Kronos, Nautilus, wavestate y modwave con zonas y enlaces a muestras WAV.',
    descriptionEn: 'Modern Korg multisample for Kronos, Nautilus, wavestate, and modwave with zones and WAV sample links.',
    extension: '.zip',
    mimeType: 'application/zip',
  }),
  third_wave: defineFormatMeta({
    title: 'Groove Synthesis 3rd Wave (.3wv)',
    descriptionEs: 'Programa multisample binario (3WV) para el sintetizador wavetable/multisample Groove Synthesis 3rd Wave.',
    descriptionEn: 'Binary multisample program (3WV) for Groove Synthesis 3rd Wave wavetable/multisample synthesizer.',
    extension: '.zip',
    mimeType: 'application/zip',
  }),
  zencore: defineFormatMeta({
    title: 'Roland Zen-Core / SP-404MKII / MC-707 (.svz)',
    descriptionEs: 'Contenedor de tonos y zonas de tecla SVZ para instrumentos Roland Zen-Core, SP-404MKII y MC-707.',
    descriptionEn: 'SVZ tone and key-zone container for Roland Zen-Core, SP-404MKII, and MC-707 instruments.',
    extension: '.zip',
    mimeType: 'application/zip',
  }),
  akai_akp: defineFormatMeta({
    title: 'Akai S5000 / S6000 / Z4 / Z8 (.akp + WAV)',
    descriptionEs: 'Programa nativo RIFF APRG (.akp) con keygroups, envolventes y muestras WAV para samplers Akai S5000, S6000, Z4 y Z8.',
    descriptionEn: 'Native RIFF APRG (.akp) program with keygroups, envelopes, and WAV samples for Akai S5000, S6000, Z4, and Z8 samplers.',
    extension: '.akp.zip',
    mimeType: 'application/zip',
  }),
  mpc_classic: defineFormatMeta({
    title: 'Akai MPC Classic (.pgm / .snd / Gotek)',
    descriptionEs: 'Programa clásico Akai MPC60, MPC2000, MPC2000XL, MPC1000 y MPC2500 (.pgm + muestras .snd / WAV).',
    descriptionEn: 'Classic Akai MPC60, MPC2000, MPC2000XL, MPC1000, and MPC2500 program (.pgm + .snd / WAV samples).',
    extension: '.pgm.zip',
    mimeType: 'application/zip',
  }),
  kurzweil: defineFormatMeta({
    title: 'Kurzweil K2000 / K2500 / K2600 / PC3 (.krz)',
    descriptionEs: 'Archivo monolítico PRAM (.krz / .k25 / .k26) con objetos Program, Keymap y muestras PCM16 Big-Endian para sintetizadores Kurzweil V.A.S.T.',
    descriptionEn: 'Monolithic PRAM file (.krz / .k25 / .k26) with Program, Keymap objects, and Big-Endian PCM16 samples for Kurzweil V.A.S.T. synthesizers.',
    extension: '.krz',
    mimeType: 'application/octet-stream',
  }),
  casio_fz: defineFormatMeta({
    title: 'Casio FZ-1 / FZ-10M / FZ-20M (.fzv / .fzf)',
    descriptionEs: 'Volcado de voz o banco completo (.fzv / .fzf) con síntesis DCF/DCA y audio PCM de 16 bits para samplers Casio serie FZ.',
    descriptionEn: 'Voice or full bank dump (.fzv / .fzf) with DCF/DCA synthesis and 16-bit PCM audio for Casio FZ-series samplers.',
    extension: '.fzv',
    mimeType: 'application/octet-stream',
  }),
  yamaha_ysfc: defineFormatMeta({
    title: 'Yamaha Motif / Montage / MODX (.x7u / .x8u / .x3a)',
    descriptionEs: 'Contenedor Yamaha YSFC con bloques de metadatos de ondas (WVM1) y datos de audio (WVD1) para Motif XF, MOXF, Montage y MODX.',
    descriptionEn: 'Yamaha YSFC container with waveform metadata (WVM1) and audio data (WVD1) blocks for Motif XF, MOXF, Montage, and MODX.',
    extension: '.x7u',
    mimeType: 'application/octet-stream',
  }),
  synclavier: defineFormatMeta({
    title: 'New England Digital Synclavier II / V (.synx / .sflc)',
    descriptionEs: 'Timbre multiparcial y muestras para Synclavier II, Arturia Synclavier V y Synclavier Regen.',
    descriptionEn: 'Multi-partial timbre and samples for Synclavier II, Arturia Synclavier V, and Synclavier Regen.',
    extension: '.zip',
    mimeType: 'application/zip',
  }),
  fairlight_cmi: defineFormatMeta({
    title: 'Fairlight CMI IIx / III (.cmi / .cmi3 / .vc)',
    descriptionEs: 'Instrumento y tabla de voces para Fairlight CMI Series IIx (8-bit) y Series III (16-bit).',
    descriptionEn: 'Instrument and voice table for Fairlight CMI Series IIx (8-bit) and Series III (16-bit).',
    extension: '.zip',
    mimeType: 'application/zip',
  }),
  akai_mesa: defineFormatMeta({
    title: 'Akai MESA / MESA II (.s3p / .p)',
    descriptionEs: 'Programa de edición remota S3000/S1000 en formato Akai MESA (.s3p) con keygroups y muestras.',
    descriptionEn: 'Remote editing S3000/S1000 program in Akai MESA (.s3p) format with keygroups and samples.',
    extension: '.zip',
    mimeType: 'application/zip',
  }),
  reason_nnxt: defineFormatMeta({
    title: 'Reason Studios NN-XT (.sxt + WAV)',
    descriptionEs: 'Patch de sampler avanzado NN-XT de Reason (contenedor IFF FORM PTCH con tabla BODY de zonas y muestras WAV).',
    descriptionEn: 'Reason NN-XT Advanced Sampler patch (IFF FORM PTCH container with zone BODY table and WAV samples).',
    extension: '.sxt.zip',
    mimeType: 'application/zip',
  }),
  directwave: defineFormatMeta({
    title: 'Image-Line FL Studio DirectWave (.dwp + WAV)',
    descriptionEs: 'Programa multisample DirectWave (.dwp binario DwPr) con zonas, bucles y muestras para FL Studio.',
    descriptionEn: 'DirectWave multisample program (binary DwPr .dwp) with zones, loops, and samples for FL Studio.',
    extension: '.dwp.zip',
    mimeType: 'application/zip',
  }),
  soundbox: defineFormatMeta({
    title: 'Audiomodern Soundbox (.sbpack / .sbx)',
    descriptionEs: 'Paquete de instrumento multicapa XML/ZIP para el motor de síntesis por muestras Audiomodern Soundbox.',
    descriptionEn: 'Multi-layer XML/ZIP instrument pack for the Audiomodern Soundbox sample synthesis engine.',
    extension: '.sbpack',
    mimeType: 'application/zip',
  }),
  omnisphere: defineFormatMeta({
    title: 'Spectrasonics Omnisphere STEAM (.zmap / .prt_omn)',
    descriptionEs: 'Esquema XML multisample para el motor STEAM de Spectrasonics Omnisphere con zonas y muestras WAV.',
    descriptionEn: 'Multisample XML schema for Spectrasonics Omnisphere STEAM engine with zones and WAV samples.',
    extension: '.zip',
    mimeType: 'application/zip',
  }),
  ni_maschine: defineFormatMeta({
    title: 'Native Instruments Maschine (.mxsnd / .mxgrp)',
    descriptionEs: 'Sonido o grupo con módulo Sampler y metadatos Native Instruments para Maschine 2 / Maschine+.',
    descriptionEn: 'Sound or group with Sampler module and Native Instruments metadata for Maschine 2 / Maschine+.',
    extension: '.zip',
    mimeType: 'application/zip',
  }),
  sample_chain: defineFormatMeta({
    title: 'Sample Chain Lineal con Cue Markers (.wav)',
    descriptionEs: 'Audio continuo concatenado con marcas RIFF cue/smpl para Octatrack, SP-404, electribe y OP-1.',
    descriptionEn: 'Concatenated continuous audio with RIFF cue/smpl markers for Octatrack, SP-404, electribe, and OP-1.',
    extension: '.wav',
    mimeType: 'audio/wav',
  }),
  neuron_bank: defineFormatMeta({
    title: 'Hartmann Neuron / Neuronik Bank (.model / .neuronikmodel)',
    descriptionEs: 'Banco o modelo espectral Hartmann Neuron (MName, map.script, .scape/.sphere) y contenedor extendido Neuronik (.neuronikmodel / .nmmodel).',
    descriptionEn: 'Hartmann Neuron spectral bank or model (MName, map.script, .scape/.sphere) and extended Neuronik container (.neuronikmodel / .nmmodel).',
    extension: '.zip',
    mimeType: 'application/zip',
  }),
};

export function getSamplerFormatMetadata(format: RawSamplerFormat, locale?: SharedLocale): SamplerFormatMetaEntry {
  const base = SAMPLER_FORMAT_METADATA[format];
  if (!base || !locale) return base;
  const resolved = resolveSharedLocale(locale);
  return {
    ...base,
    description: resolved === 'es' ? (base.descriptionEs ?? base.description) : (base.descriptionEn ?? base.description),
  };
}

/**
 * Extracts uniform sampler regions from session, handling both classic zones
 * and extended multi-layer 2D regions.
 */
export function extractUniformSamplerRegions(session: Session): UniformSamplerRegion[] {
  if (session.extendedRegions && session.extendedRegions.length > 0) {
    return session.extendedRegions.map((reg) => ({
      id: reg.id,
      sampleName: reg.sampleName,
      lowKey: reg.lowKey,
      highKey: reg.highKey,
      rootKey: reg.rootKey,
      lowVel: reg.lowVel,
      highVel: reg.highVel,
      detuneCents: reg.detune,
      volumeDb: reg.volume,
      pan: reg.pan,
      pitchKeytrack: reg.pitchKeytrack ?? 100,
      loopMode: reg.loopMode ?? 'no_loop',
      loopStart: reg.loopStart ?? 0,
      loopEnd: reg.loopEnd ?? 0,
      loopCrossfadeMs: reg.loopCrossfadeMs ?? 0,
      crossfadeCurve: reg.fadeCurve,
      keyFadeIn: reg.keyFadeIn ?? 0,
      keyFadeOut: reg.keyFadeOut ?? 0,
      velFadeIn: reg.velFadeIn ?? 0,
      velFadeOut: reg.velFadeOut ?? 0,
      loops: reg.loops,
      ampEnvelope: reg.ampEnvOverride ?? session.articulation?.ampEnv,
      filterConfig: reg.filterOverride ?? session.articulation?.filter,
      pitchEnvelope: reg.pitchEnvOverride ?? session.articulation?.pitchEnv,
      trigger: reg.trigger,
      playLogic: reg.playLogic,
      seqPosition: reg.seqPosition,
      seqLength: reg.seqLength,
      sampleStartFrame: reg.sampleStartFrame,
      sampleEndFrame: reg.sampleEndFrame,
      reversed: reg.reversed,
      groupId: reg.groupId,
      groupName: reg.groupName,
      muteGroup: reg.muteGroup,
      keyswitchNote: reg.keyswitchNote,
      velToVolumeDepth: reg.velToVolumeDepth,
      velToPitchCents: reg.velToPitchCents,
    }));
  }

  // Convert classic zones to uniform regions
  const converted = syncExtendedRegionsFromClassicZones(session.zones);
  return converted.map((reg) => ({
    id: reg.id,
    sampleName: reg.sampleName,
    lowKey: reg.lowKey,
    highKey: reg.highKey,
    rootKey: reg.rootKey,
    lowVel: reg.lowVel,
    highVel: reg.highVel,
    detuneCents: reg.detune,
    volumeDb: reg.volume,
    pan: reg.pan,
    pitchKeytrack: 100,
    loopMode: reg.loopMode ?? 'no_loop',
    loopStart: reg.loopStart ?? 0,
    loopEnd: reg.loopEnd ?? 0,
    loopCrossfadeMs: 0,
    crossfadeCurve: 'equal-power',
    keyFadeIn: 0,
    keyFadeOut: 0,
    velFadeIn: 0,
    velFadeOut: 0,
    ampEnvelope: session.articulation?.ampEnv,
    filterConfig: session.articulation?.filter,
    pitchEnvelope: session.articulation?.pitchEnv,
    trigger: 'attack',
  }));
}

/**
 * Inspects the current session and sample audio buffers to identify technical
 * incompatibilities or adjustments required by the target sampler format.
 */
export function analyzeRawSamplerPreflight(
  session: Session,
  options: RawExportOptions,
  sampleBufferProvider: (sampleName: string) => ArrayBuffer | undefined,
  locale?: SharedLocale
): RawSamplerPreflightReport {
  const isEs = resolveSharedLocale(locale) === 'es';
  const regions = extractUniformSamplerRegions(session);
  const issues: PreflightIssue[] = [];

  const meta = getSamplerFormatMetadata(options.format, locale) ?? {
    title: options.format,
    description: '',
    extension: '',
    mimeType: '',
  };

  const sampleNames = Array.from(new Set(regions.map((r) => r.sampleName).filter(Boolean)));
  const decodedMap = new Map<string, DecodedWav>();

  let missingSampleCount = 0;
  const missingNames: string[] = [];

  for (const sName of sampleNames) {
    const raw = sampleBufferProvider(sName);
    if (!raw || raw.byteLength === 0) {
      missingSampleCount++;
      missingNames.push(sName);
    } else {
      try {
        const decoded = decodeWav(raw);
        decodedMap.set(sName, decoded);
      } catch {
        // Ignored or invalid format
      }
    }
  }

  // 1. Missing Audio Buffers Check
  if (missingSampleCount > 0) {
    const samplePreview = `${missingNames.slice(0, 3).join(', ')}${missingNames.length > 3 ? '...' : ''}`;
    issues.push({
      id: 'missing-audio-buffers',
      category: 'missing_audio',
      severity: missingSampleCount === sampleNames.length ? 'incompatibility' : 'warning',
      title: isEs ? 'Muestras de Audio no Encontradas en Memoria' : 'Audio Samples Not Found in Memory',
      description: isEs
        ? `${missingSampleCount} de ${sampleNames.length} muestras referenciadas no tienen buffer cargado: ${samplePreview}.`
        : `${missingSampleCount} of ${sampleNames.length} referenced samples have no loaded buffer: ${samplePreview}.`,
      adaptation: isEs
        ? 'Las zonas sin audio serán omitidas en la compilación del banco.'
        : 'Zones without audio will be omitted during bank compilation.',
      affectedCount: missingSampleCount,
    });
  }

  // 2. Bit Depth Compatibility Check
  let count24Bit = 0;
  for (const [, dec] of decodedMap) {
    if (dec.bitsPerSample > 16 || dec.formatTag === 'ieee-float') {
      count24Bit++;
    }
  }

  if ((options.format === 'sf2' || options.format === 'korg_kmp' || options.format === 'dls') && count24Bit > 0) {
    issues.push({
      id: 'sf2-bitdepth-clamp',
      category: 'bit_depth',
      severity: 'warning',
      title: isEs ? 'Resolución de Audio Mayor a 16-bit' : 'Audio Bit Depth Higher Than 16-bit',
      description: isEs
        ? `El formato ${meta.title} requiere PCM entero de 16 bits. ${count24Bit} muestras superan esta resolución o son Float32.`
        : `Format ${meta.title} requires 16-bit integer PCM. ${count24Bit} samples exceed this resolution or are Float32.`,
      adaptation: isEs
        ? 'Conversión automática a 16-bit PCM para preservar el rango dinámico.'
        : 'Automatic conversion to 16-bit PCM preserving dynamic range.',
      affectedCount: count24Bit,
    });
  } else if (options.resolution === 'pcm16' && count24Bit > 0) {
    issues.push({
      id: 'export-pcm16-requested',
      category: 'bit_depth',
      severity: 'info',
      title: isEs ? 'Conversión Solicitada a 16-bit PCM' : 'Requested Conversion to 16-bit PCM',
      description: isEs
        ? `${count24Bit} muestras serán remuestreadas a 16-bit PCM de acuerdo a la preferencia seleccionada.`
        : `${count24Bit} samples will be converted to 16-bit PCM according to the selected preference.`,
      adaptation: isEs
        ? 'Cuantización lineal a 16 bits con dither TPDF.'
        : '16-bit linear quantization with TPDF dither.',
      affectedCount: count24Bit,
    });
  }

  // 3. Sample Rate Check
  const sampleRates = new Set<number>();
  for (const [, dec] of decodedMap) {
    sampleRates.add(dec.sampleRate);
  }

  if (options.sampleRate !== 'original') {
    issues.push({
      id: 'sample-rate-resample',
      category: 'sample_rate',
      severity: 'info',
      title: isEs ? `Remuestreo Uniforme a ${options.sampleRate} Hz` : `Uniform Resampling to ${options.sampleRate} Hz`,
      description: isEs
        ? `Todas las muestras serán remuestreadas a ${options.sampleRate} Hz para consistencia total en el sampler de destino.`
        : `All samples will be resampled to ${options.sampleRate} Hz for full consistency in the target sampler.`,
      adaptation: isEs
        ? `Interpolación polinómica de alta precisión a ${options.sampleRate} Hz.`
        : `High-precision polynomial interpolation to ${options.sampleRate} Hz.`,
      affectedCount: sampleNames.length,
    });
  } else if (sampleRates.size > 1 && options.format === 'sample_chain') {
    const rateList = Array.from(sampleRates).join(', ');
    const maxRate = Math.max(...sampleRates);
    issues.push({
      id: 'sample-chain-mixed-rates',
      category: 'sample_rate',
      severity: 'warning',
      title: isEs ? 'Sample Rates Dispares en Cadena Lineal' : 'Mixed Sample Rates in Linear Sample Chain',
      description: isEs
        ? `Las muestras tienen frecuencias de muestreo dispares (${rateList} Hz), lo que provocaría cambios de afinación en una cadena continua.`
        : `Samples have mixed sample rates (${rateList} Hz), which would cause pitch shifts in a continuous sample chain.`,
      adaptation: isEs
        ? `Las muestras se unificarán automáticamente a la tasa más alta (${maxRate} Hz) al concatenar.`
        : `Samples will be automatically unified to the highest rate (${maxRate} Hz) when concatenating.`,
      affectedCount: sampleNames.length,
    });
  }

  // 4. Multi-channel / Quad Surround Check
  let countMultiChannel = 0;
  for (const [, dec] of decodedMap) {
    if (dec.numChannels > 2) {
      countMultiChannel++;
    }
  }
  if (countMultiChannel > 0) {
    issues.push({
      id: 'multichannel-adaptation',
      category: 'channels',
      severity: 'warning',
      title: isEs ? 'Canales Surround (>2 Canales) Detectados' : 'Surround Channels (>2 Channels) Detected',
      description: isEs
        ? `${countMultiChannel} muestras contienen más de 2 canales (Surround 4.0 / Multicanal).`
        : `${countMultiChannel} samples contain more than 2 channels (Surround 4.0 / Multichannel).`,
      adaptation: isEs
        ? 'Los canales traseros y frontales se mezclarán a un par estéreo compatible (L+R).'
        : 'Front and rear channels will be downmixed into a compatible stereo pair (L+R).',
      affectedCount: countMultiChannel,
    });
  }

  // 5. Loop Mode & Crossfade Check
  let pingPongLoops = 0;
  let complexXfades = 0;
  let outOfBoundsLoops = 0;

  for (const reg of regions) {
    if (reg.loopMode === 'ping_pong' || reg.loopMode === 'loop_backward') {
      pingPongLoops++;
    }
    if (reg.loopCrossfadeMs > 0) {
      complexXfades++;
    }
    const dec = decodedMap.get(reg.sampleName);
    if (dec && reg.loopMode !== 'no_loop' && reg.loopEnd > dec.numSamples) {
      outOfBoundsLoops++;
    }
  }

  if (
    (options.format === 'sf2' ||
      options.format === 'mpc_xpm' ||
      options.format === 'mpc_xpn' ||
      options.format === 'korg_kmp' ||
      options.format === 'dls') &&
    pingPongLoops > 0
  ) {
    issues.push({
      id: 'sf2-pingpong-adaptation',
      category: 'loop',
      severity: 'warning',
      title: isEs
        ? `Bucles Ping-Pong no Soportados en ${meta.title}`
        : `Ping-Pong Loops Not Supported in ${meta.title}`,
      description: isEs
        ? `${pingPongLoops} regiones tienen bucle en modo Ping-Pong o Reverse, no soportado nativamente en el formato destino.`
        : `${pingPongLoops} regions use Ping-Pong or Reverse loop mode, which is not natively supported by the target format.`,
      adaptation: isEs
        ? 'Conversión automática a bucle continuo forward tradicional (loop_continuous).'
        : 'Automatic conversion to standard continuous forward loop (loop_continuous).',
      affectedCount: pingPongLoops,
    });
  }

  // MPC / TAL 4-layer per instrument spill check
  if (options.format === 'mpc_xpm' || options.format === 'mpc_xpn' || options.format === 'tal_sampler') {
    const byKeySpan = new Map<string, number>();
    for (const reg of regions) {
      const k = `${reg.lowKey}:${reg.highKey}`;
      byKeySpan.set(k, (byKeySpan.get(k) ?? 0) + 1);
    }
    let spilledGroups = 0;
    for (const count of byKeySpan.values()) {
      if (count > 4) spilledGroups++;
    }
    if (spilledGroups > 0) {
      issues.push({
        id: 'mpc-4layer-spill',
        category: 'velocity_layers',
        severity: 'info',
        title: isEs ? 'Adaptación de Capas (>4 Capas por Rango)' : 'Layer Adaptation (>4 Layers per Key Span)',
        description: isEs
          ? `${spilledGroups} rangos de teclado superan 4 capas de velocidad o Round-Robin.`
          : `${spilledGroups} key spans exceed 4 velocity or Round-Robin layers.`,
        adaptation:
          options.format === 'tal_sampler'
            ? isEs
              ? 'Distribución en los 4 samplelayers de TAL-Sampler.'
              : 'Distributed across the 4 TAL-Sampler sample layers.'
            : isEs
              ? 'División automática sin pérdida en Keygroups solapados adicionales dentro de los 128 slots del programa MPC.'
              : 'Lossless automatic split into additional overlapping Keygroups within the 128 MPC program slots.',
        affectedCount: spilledGroups,
      });
    }
  }

  if ((options.format === 'sf2' || options.format === 'sample_chain' || options.format === 'korg_kmp' || options.format === 'dls') && complexXfades > 0) {
    issues.push({
      id: 'loop-crossfade-limitation',
      category: 'loop',
      severity: 'info',
      title: isEs ? 'Micro-Crossfades de Bucle en Sampler Destino' : 'Loop Micro-Crossfades in Target Sampler',
      description: isEs
        ? `${complexXfades} regiones utilizan crossfade en bucle. En ${meta.title} los puntos de loop son posiciones fijas de muestra.`
        : `${complexXfades} regions use loop crossfades. In ${meta.title}, loop points are fixed sample positions.`,
      adaptation: isEs
        ? 'Se incrustan los puntos de bucle exactos calculados para corte por cruce por cero.'
        : 'Exact zero-crossing loop points are embedded directly.',
      affectedCount: complexXfades,
    });
  }

  if (outOfBoundsLoops > 0) {
    issues.push({
      id: 'loop-bounds-clamped',
      category: 'loop',
      severity: 'warning',
      title: isEs ? 'Puntos de Bucle Fuera de los Límites de Audio' : 'Loop Points Outside Audio Bounds',
      description: isEs
        ? `${outOfBoundsLoops} regiones tienen el punto final de loop (loopEnd) más allá del final de la muestra de audio.`
        : `${outOfBoundsLoops} regions have their loop end point (loopEnd) beyond the end of the audio sample.`,
      adaptation: isEs
        ? 'Ajuste (clamp) automático del loopEnd al último sample disponible.'
        : 'Automatic clamping of loopEnd to the last available sample frame.',
      affectedCount: outOfBoundsLoops,
    });
  }

  // 6. Envelope Adaptation Check (DAHDSR -> ADSR)
  let complexEnvelopes = 0;
  for (const reg of regions) {
    const env = reg.ampEnvelope;
    if (env && ((env.delaySec ?? 0) > 0 || (env.holdSec ?? 0) > 0)) {
      complexEnvelopes++;
    }
  }

  if (complexEnvelopes > 0 && (options.format === 'sf2' || options.format === 'sfz' || options.format === 'dspreset')) {
    issues.push({
      id: 'envelope-dahdsr-adaptation',
      category: 'envelope',
      severity: 'info',
      title: isEs
        ? 'Adaptación de Envolvente DAHDSR de 6 Etapas a ADSR Estándar'
        : '6-Stage DAHDSR Envelope Adaptation to Standard ADSR',
      description: isEs
        ? `${complexEnvelopes} regiones configuran etapas Delay o Hold no soportadas directamente por el generador del sampler.`
        : `${complexEnvelopes} regions configure Delay or Hold stages not directly supported by the target sampler generator.`,
      adaptation: isEs
        ? 'Suma matemática de etapas Delay y Hold dentro del tiempo de Attack para preservar la curva acústica.'
        : 'Mathematical folding of Delay and Hold stages into Attack time to preserve the acoustic contour.',
      affectedCount: complexEnvelopes,
    });
  }

  // 7. Keybed Coverage Check
  const coveredKeys = new Set<number>();
  for (const reg of regions) {
    for (let k = reg.lowKey; k <= reg.highKey; k++) {
      coveredKeys.add(k);
    }
  }
  if (coveredKeys.size < 128 && options.format !== 'sample_chain') {
    issues.push({
      id: 'keybed-partial-coverage',
      category: 'coverage',
      severity: 'info',
      title: isEs
        ? `Cobertura de Teclado Parcial (${coveredKeys.size}/128 Notas Mapeadas)`
        : `Partial Keybed Coverage (${coveredKeys.size}/128 Mapped Notes)`,
      description: isEs
        ? 'El instrumento no cubre el rango MIDI completo de 0 a 127. Las notas sin asignar quedarán en silencio.'
        : 'The instrument does not cover the full MIDI range 0 to 127. Unassigned notes will remain silent.',
      adaptation: isEs
        ? 'Mapeo natural conservado sin transposición artificial.'
        : 'Natural mapping preserved without artificial pitch stretching.',
      affectedCount: 128 - coveredKeys.size,
    });
  }

  // Count summaries
  let infoCount = 0;
  let warningCount = 0;
  let incompatibilityCount = 0;

  for (const iss of issues) {
    if (iss.severity === 'info') infoCount++;
    else if (iss.severity === 'warning') warningCount++;
    else if (iss.severity === 'incompatibility') incompatibilityCount++;
  }

  const canExport = regions.length > 0 && (sampleNames.length === 0 || missingSampleCount < sampleNames.length);

  return {
    targetFormat: options.format,
    formatTitle: meta.title,
    formatDescription: meta.description,
    totalRegions: regions.length,
    totalSamples: sampleNames.length,
    canExport,
    issues,
    summary: {
      infoCount,
      warningCount,
      incompatibilityCount,
    },
  };
}
