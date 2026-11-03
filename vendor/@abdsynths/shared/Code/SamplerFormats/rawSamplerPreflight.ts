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

export const SAMPLER_FORMAT_METADATA: Record<
  RawSamplerFormat,
  { title: string; description: string; extension: string; mimeType: string }
> = {
  sf2: {
    title: 'SoundFont 2 (.sf2)',
    description: 'Estándar binario RIFF sfbk autocontenido (v2.04) compatible con SoundFont hardware y software.',
    extension: '.sf2',
    mimeType: 'audio/x-soundfont',
  },
  sfz: {
    title: 'SFZ Format (.sfz + Samples)',
    description: 'Definición de texto plano estándar compatible con Plogue Sforzando, Cakewalk y LinuxSampler.',
    extension: '.sfz.zip',
    mimeType: 'application/zip',
  },
  dspreset: {
    title: 'Decent Sampler (.dspreset + Samples)',
    description: 'Formato XML abierto moderno con soporte de GUI para el sampler virtual Decent Sampler.',
    extension: '.dspreset.zip',
    mimeType: 'application/zip',
  },
  multisample: {
    title: 'Bitwig Studio Multisample (.multisample)',
    description: 'Paquete multisample nativo de Bitwig Studio con metadatos XML y muestras de audio.',
    extension: '.multisample',
    mimeType: 'application/zip',
  },
  nki: {
    title: 'Native Instruments Kontakt (.nki XML)',
    description: 'Definición estructurada de instrumento Kontakt con mapeo de grupos y zonas.',
    extension: '.nki.zip',
    mimeType: 'application/zip',
  },
  vstpreset: {
    title: 'Steinberg HALion (.vstpreset)',
    description: 'Preset estructurado XML/VST3 de programa HALion con capas de zona.',
    extension: '.vstpreset.zip',
    mimeType: 'application/zip',
  },
  mpc_xpm: {
    title: 'Akai MPC Keygroup / Drum Program (.xpm + WAV)',
    description: 'Programa nativo Akai MPC 2.x / 3.x (<MPCVObject> XML, 128 instrumentos x 4 capas) con WAVs hermanos listos para MPC Live/One/X/Key y MPC Software.',
    extension: '.xpm.zip',
    mimeType: 'application/zip',
  },
  mpc_xpn: {
    title: 'Akai MPC Expansion Pack (.xpn)',
    description: 'Paquete de expansión instalable para Akai MPC Software y hardware autónomo (Expansion.xml + programa .xpm + muestras WAV).',
    extension: '.xpn',
    mimeType: 'application/zip',
  },
  ableton_adv: {
    title: 'Ableton Sampler / Simpler (.adv + Samples)',
    description: 'Preset nativo de Ableton Live (<MultiSampler> GZIP XML) con muestras en Samples/Imported/.',
    extension: '.adv.zip',
    mimeType: 'application/zip',
  },
  exs24: {
    title: 'Apple Logic EXS24 / Sampler (.exs + Samples)',
    description: 'Instrumento binario EXS24 / Logic Pro Sampler (bloques SOBT/TBOS) con zonas, grupos, filtros y muestras WAV.',
    extension: '.exs.zip',
    mimeType: 'application/zip',
  },
  tal_sampler: {
    title: 'TAL-Sampler (.talsmpl + Samples)',
    description: 'Preset XML de Togu Audio Line TAL-Sampler (hasta 4 capas estéreo, envolventes y filtro modelado).',
    extension: '.talsmpl.zip',
    mimeType: 'application/zip',
  },
  tx16wx: {
    title: 'CWITEC TX16Wx Software Sampler (.txprog + Samples)',
    description: 'Programa XML de CWITEC TX16Wx 3.0 con waves, loops, soundshapes (AEG/Filter/Env) y grupos con crossfade.',
    extension: '.txprog.zip',
    mimeType: 'application/zip',
  },
  korg_kmp: {
    title: 'Korg Trinity / Triton / M3 / Pa (.KMP + .KSF)',
    description: 'Multisample hardware Korg Big-Endian (.KMP + muestras .KSF de 16-bit y script .KSC).',
    extension: '.kmp.zip',
    mimeType: 'application/zip',
  },
  dls: {
    title: 'MMA Downloadable Sounds Level 2 (.dls)',
    description: 'Banco binario autocontenido RIFF "DLS " (Level 1/2) con regiones, bloques de articulación (lart/lar2) y wave pool.',
    extension: '.dls',
    mimeType: 'audio/x-dls',
  },
  akai_disk: {
    title: 'Akai S-Series Disk Image (.iso, .img, .dsk)',
    description: 'Imagen de disco SCSI CD-ROM o disquete 3.5" (Gotek FlashFloppy) de samplers Akai S900/S950/S1000/S1100/S2000/S3000 con particiones y volúmenes.',
    extension: '.iso',
    mimeType: 'application/octet-stream',
  },
  emu_disk: {
    title: 'E-mu EOS / EIII Disk Image (.iso, .img, .hda, .e4b, .esi)',
    description: 'Imagen de disco del sistema de archivos EMU3 y bancos nativos de samplers E-mu Emulator III, EIIIX, ESI-32/4000 y serie Emulator IV (EOS).',
    extension: '.iso',
    mimeType: 'application/octet-stream',
  },
  roland_disk: {
    title: 'Roland S-7xx Disk Image (.iso, .img, .out)',
    description: 'Imagen de CD-ROM o disco duro SCSI para samplers Roland S-770, S-750, S-760 y SP-700 con patches, partials y clusters de audio.',
    extension: '.iso',
    mimeType: 'application/octet-stream',
  },
  ensoniq_disk: {
    title: 'Ensoniq EPS / ASR Disk Image (.img, .dsk, .efe, .ede)',
    description: 'Imagen de disquete o disco SCSI y ficheros de instrumento para Ensoniq EPS, EPS-16 Plus y ASR-10.',
    extension: '.img',
    mimeType: 'application/octet-stream',
  },
  yamaha_disk: {
    title: 'Yamaha A-Series SFS Disk Image (.iso, .img, .hda)',
    description: 'Imagen de disco Sampler File System (SFS) y contenedores YSFC para samplers Yamaha A3000, A4000 y A5000.',
    extension: '.iso',
    mimeType: 'application/octet-stream',
  },
  music1010: {
    title: '1010music Blackbox / Tangerine (preset.xml)',
    description: 'Preset XML multi-sample y drum cells para hardware 1010music Blackbox y Nanobox Tangerine.',
    extension: '.zip',
    mimeType: 'application/zip',
  },
  deluge: {
    title: 'Synthstrom Deluge (SYNTHS/*.XML)',
    description: 'Preset XML de sintetizador o kit para tarjeta SD de Synthstrom Deluge con sampleRanges y filtros 12/24dB.',
    extension: '.zip',
    mimeType: 'application/zip',
  },
  renoise: {
    title: 'Renoise Instrument (.xrni)',
    description: 'Instrumento completo de Renoise con Instrument.xml y muestras en formato FLAC en SampleData/.',
    extension: '.xrni',
    mimeType: 'application/zip',
  },
  bliss: {
    title: 'discoDSP Bliss (.zbp)',
    description: 'Archivo de banco o programa ZIP para discoDSP Bliss con program.xml y muestras FLAC.',
    extension: '.zbp',
    mimeType: 'application/zip',
  },
  polyend_pti: {
    title: 'Polyend Tracker / Play (.pti)',
    description: 'Instrumento binario para Polyend Tracker y Play (cabecera TI + parámetros + audio PCM16 44.1kHz).',
    extension: '.pti',
    mimeType: 'application/octet-stream',
  },
  waldorf_qpat: {
    title: 'Waldorf Quantum / Iridium (.qpat)',
    description: 'Contenedor de patch y mapa de muestras para sintetizadores Waldorf Quantum e Iridium.',
    extension: '.zip',
    mimeType: 'application/zip',
  },
  opxy: {
    title: 'Teenage Engineering OP-XY (.preset)',
    description: 'Paquete de preset multisampler para Teenage Engineering OP-XY (patch.json + muestras WAV).',
    extension: '.zip',
    mimeType: 'application/zip',
  },
  tonverk: {
    title: 'Elektron Tonverk (.tvpst / elmulti)',
    description: 'Preset de instrumento o multi-sample para sintetizador/groovebox Elektron Tonverk.',
    extension: '.zip',
    mimeType: 'application/zip',
  },
  disting_ex: {
    title: 'Expert Sleepers Disting EX (.dexpreset)',
    description: 'Preset de multisample para módulo eurorack Expert Sleepers Disting EX (archivo DEXBPRST + WAVs).',
    extension: '.zip',
    mimeType: 'application/zip',
  },
  prophet_x: {
    title: 'Sequential Prophet X / XL (.grp)',
    description: 'Grupo multisample para sintetizadores híbridos Sequential Prophet X y Prophet XL (mapa TSV de 15 columnas + muestras a 48 kHz).',
    extension: '.zip',
    mimeType: 'application/zip',
  },
  isla_s2400: {
    title: 'Isla Instruments S2400 (.kit / .s24)',
    description: 'Kit y configuración de pistas TLV para el sampler/groovebox Isla Instruments S2400 con muestras WAV.',
    extension: '.zip',
    mimeType: 'application/zip',
  },
  korg_modern: {
    title: 'Korg Modern Multisample (.korgmultisample)',
    description: 'Multisample moderno Korg para Kronos, Nautilus, wavestate y modwave con zonas y enlaces a muestras WAV.',
    extension: '.zip',
    mimeType: 'application/zip',
  },
  third_wave: {
    title: 'Groove Synthesis 3rd Wave (.3wv)',
    description: 'Programa multisample binario (3WV) para el sintetizador wavetable/multisample Groove Synthesis 3rd Wave.',
    extension: '.zip',
    mimeType: 'application/zip',
  },
  zencore: {
    title: 'Roland Zen-Core / SP-404MKII / MC-707 (.svz)',
    description: 'Contenedor de tonos y zonas de tecla SVZ para instrumentos Roland Zen-Core, SP-404MKII y MC-707.',
    extension: '.zip',
    mimeType: 'application/zip',
  },
  akai_akp: {
    title: 'Akai S5000 / S6000 / Z4 / Z8 (.akp + WAV)',
    description: 'Programa nativo RIFF APRG (.akp) con keygroups, envolventes y muestras WAV para samplers Akai S5000, S6000, Z4 y Z8.',
    extension: '.akp.zip',
    mimeType: 'application/zip',
  },
  mpc_classic: {
    title: 'Akai MPC Classic (.pgm / .snd / Gotek)',
    description: 'Programa clásico Akai MPC60, MPC2000, MPC2000XL, MPC1000 y MPC2500 (.pgm + muestras .snd / WAV).',
    extension: '.pgm.zip',
    mimeType: 'application/zip',
  },
  kurzweil: {
    title: 'Kurzweil K2000 / K2500 / K2600 / PC3 (.krz)',
    description: 'Archivo monolítico PRAM (.krz / .k25 / .k26) con objetos Program, Keymap y muestras PCM16 Big-Endian para sintetizadores Kurzweil V.A.S.T.',
    extension: '.krz',
    mimeType: 'application/octet-stream',
  },
  casio_fz: {
    title: 'Casio FZ-1 / FZ-10M / FZ-20M (.fzv / .fzf)',
    description: 'Volcado de voz o banco completo (.fzv / .fzf) con síntesis DCF/DCA y audio PCM de 16 bits para samplers Casio serie FZ.',
    extension: '.fzv',
    mimeType: 'application/octet-stream',
  },
  yamaha_ysfc: {
    title: 'Yamaha Motif / Montage / MODX (.x7u / .x8u / .x3a)',
    description: 'Contenedor Yamaha YSFC con bloques de metadatos de ondas (WVM1) y datos de audio (WVD1) para Motif XF, MOXF, Montage y MODX.',
    extension: '.x7u',
    mimeType: 'application/octet-stream',
  },
  synclavier: {
    title: 'New England Digital Synclavier II / V (.synx / .sflc)',
    description: 'Timbre multiparcial y muestras para Synclavier II, Arturia Synclavier V y Synclavier Regen.',
    extension: '.zip',
    mimeType: 'application/zip',
  },
  fairlight_cmi: {
    title: 'Fairlight CMI IIx / III (.cmi / .cmi3 / .vc)',
    description: 'Instrumento y tabla de voces para Fairlight CMI Series IIx (8-bit) y Series III (16-bit).',
    extension: '.zip',
    mimeType: 'application/zip',
  },
  akai_mesa: {
    title: 'Akai MESA / MESA II (.s3p / .p)',
    description: 'Programa de edición remota S3000/S1000 en formato Akai MESA (.s3p) con keygroups y muestras.',
    extension: '.zip',
    mimeType: 'application/zip',
  },
  reason_nnxt: {
    title: 'Reason Studios NN-XT (.sxt + WAV)',
    description: 'Patch de sampler avanzado NN-XT de Reason (contenedor IFF FORM PTCH con tabla BODY de zonas y muestras WAV).',
    extension: '.sxt.zip',
    mimeType: 'application/zip',
  },
  directwave: {
    title: 'Image-Line FL Studio DirectWave (.dwp + WAV)',
    description: 'Programa multisample DirectWave (.dwp binario DwPr) con zonas, bucles y muestras para FL Studio.',
    extension: '.dwp.zip',
    mimeType: 'application/zip',
  },
  soundbox: {
    title: 'Audiomodern Soundbox (.sbpack / .sbx)',
    description: 'Paquete de instrumento multicapa XML/ZIP para el motor de síntesis por muestras Audiomodern Soundbox.',
    extension: '.sbpack',
    mimeType: 'application/zip',
  },
  omnisphere: {
    title: 'Spectrasonics Omnisphere STEAM (.zmap / .prt_omn)',
    description: 'Esquema XML multisample para el motor STEAM de Spectrasonics Omnisphere con zonas y muestras WAV.',
    extension: '.zip',
    mimeType: 'application/zip',
  },
  ni_maschine: {
    title: 'Native Instruments Maschine (.mxsnd / .mxgrp)',
    description: 'Sonido o grupo con módulo Sampler y metadatos Native Instruments para Maschine 2 / Maschine+.',
    extension: '.zip',
    mimeType: 'application/zip',
  },
  sample_chain: {
    title: 'Sample Chain Lineal con Cue Markers (.wav)',
    description: 'Audio continuo concatenado con marcas RIFF cue/smpl para Octatrack, SP-404, electribe y OP-1.',
    extension: '.wav',
    mimeType: 'audio/wav',
  },
  neuron_bank: {
    title: 'Hartmann Neuron / Neuronik Bank (.model / .neuronikmodel)',
    description: 'Banco o modelo espectral Hartmann Neuron (MName, map.script, .scape/.sphere) y contenedor extendido Neuronik (.neuronikmodel / .nmmodel).',
    extension: '.zip',
    mimeType: 'application/zip',
  },
};

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
  sampleBufferProvider: (sampleName: string) => ArrayBuffer | undefined
): RawSamplerPreflightReport {
  const regions = extractUniformSamplerRegions(session);
  const issues: PreflightIssue[] = [];

  const meta = SAMPLER_FORMAT_METADATA[options.format] ?? {
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
    issues.push({
      id: 'missing-audio-buffers',
      category: 'missing_audio',
      severity: missingSampleCount === sampleNames.length ? 'incompatibility' : 'warning',
      title: 'Muestras de Audio no Encontradas en Memoria',
      description: `${missingSampleCount} de ${sampleNames.length} muestras referenciadas no tienen buffer cargado: ${missingNames.slice(0, 3).join(', ')}${missingNames.length > 3 ? '...' : ''}.`,
      adaptation: 'Las zonas sin audio serán omitidas en la compilación del banco.',
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
      title: 'Resolución de Audio Mayor a 16-bit',
      description: `El formato ${meta.title} requiere PCM entero de 16 bits. ${count24Bit} muestras superan esta resolución o son Float32.`,
      adaptation: 'Conversión automática a 16-bit PCM para preservar el rango dinámico.',
      affectedCount: count24Bit,
    });
  } else if (options.resolution === 'pcm16' && count24Bit > 0) {
    issues.push({
      id: 'export-pcm16-requested',
      category: 'bit_depth',
      severity: 'info',
      title: 'Conversión Solicitada a 16-bit PCM',
      description: `${count24Bit} muestras serán remuestreadas a 16-bit PCM de acuerdo a la preferencia seleccionada.`,
      adaptation: 'Cuantización lineal a 16 bits con dither TPDF.',
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
      title: `Remuestreo Uniforme a ${options.sampleRate} Hz`,
      description: `Todas las muestras serán remuestreadas a ${options.sampleRate} Hz para consistencia total en el sampler de destino.`,
      adaptation: `Interpolación polinómica de alta precisión a ${options.sampleRate} Hz.`,
      affectedCount: sampleNames.length,
    });
  } else if (sampleRates.size > 1 && options.format === 'sample_chain') {
    issues.push({
      id: 'sample-chain-mixed-rates',
      category: 'sample_rate',
      severity: 'warning',
      title: 'Sample Rates Dispares en Cadena Lineal',
      description: `Las muestras tienen frecuencias de muestreo dispares (${Array.from(sampleRates).join(', ')} Hz), lo que provocaría cambios de afinación en una cadena continua.`,
      adaptation: `Las muestras se unificarán automáticamente a la tasa más alta (${Math.max(...sampleRates)} Hz) al concatenar.`,
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
      title: 'Canales Surround (>2 Canales) Detectados',
      description: `${countMultiChannel} muestras contienen más de 2 canales (Surround 4.0 / Multicanal).`,
      adaptation: 'Los canales traseros y frontales se mezclarán a un par estéreo compatible (L+R).',
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
      title: `Bucles Ping-Pong no Soportados en ${meta.title}`,
      description: `${pingPongLoops} regiones tienen bucle en modo Ping-Pong o Reverse, no soportado nativamente en el formato destino.`,
      adaptation: 'Conversión automática a bucle continuo forward tradicional (loop_continuous).',
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
        title: 'Adaptación de Capas (>4 Capas por Rango)',
        description: `${spilledGroups} rangos de teclado superan 4 capas de velocidad o Round-Robin.`,
        adaptation:
          options.format === 'tal_sampler'
            ? 'Distribución en los 4 samplelayers de TAL-Sampler.'
            : 'División automática sin pérdida en Keygroups solapados adicionales dentro de los 128 slots del programa MPC.',
        affectedCount: spilledGroups,
      });
    }
  }

  if ((options.format === 'sf2' || options.format === 'sample_chain' || options.format === 'korg_kmp' || options.format === 'dls') && complexXfades > 0) {
    issues.push({
      id: 'loop-crossfade-limitation',
      category: 'loop',
      severity: 'info',
      title: 'Micro-Crossfades de Bucle en Sampler Destino',
      description: `${complexXfades} regiones utilizan crossfade en bucle. En ${meta.title} los puntos de loop son posiciones fijas de muestra.`,
      adaptation: 'Se incrustan los puntos de bucle exactos calculados para corte por cruce por cero.',
      affectedCount: complexXfades,
    });
  }

  if (outOfBoundsLoops > 0) {
    issues.push({
      id: 'loop-bounds-clamped',
      category: 'loop',
      severity: 'warning',
      title: 'Puntos de Bucle Fuera de los Límites de Audio',
      description: `${outOfBoundsLoops} regiones tienen el punto final de loop (loopEnd) más allá del final de la muestra de audio.`,
      adaptation: 'Ajuste (clamp) automático del loopEnd al último sample disponible.',
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
      title: 'Adaptación de Envolvente DAHDSR de 6 Etapas a ADSR Estándar',
      description: `${complexEnvelopes} regiones configuran etapas Delay o Hold no soportadas directamente por el generador del sampler.`,
      adaptation: 'Suma matemática de etapas Delay y Hold dentro del tiempo de Attack para preservar la curva acústica.',
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
      title: `Cobertura de Teclado Parcial (${coveredKeys.size}/128 Notas Mapeadas)`,
      description: 'El instrumento no cubre el rango MIDI completo de 0 a 127. Las notas sin asignar quedarán en silencio.',
      adaptation: 'Mapeo natural conservado sin transposición artificial.',
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
