// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Preflight Inspection Engine (Fase 16)
//
// Evaluates session zones, audio buffers, sample rates, loop points,
// and articulation envelopes against destination sampler specifications.
// ─────────────────────────────────────────────────────────

import type { Session } from '../types.ts';
import { decodeWav, type DecodedWav } from '../dsp/WavDecoder.ts';
import type {
  PreflightIssue,
  RawExportOptions,
  RawSamplerFormat,
  RawSamplerPreflightReport,
  UniformSamplerRegion,
} from './rawSamplerTypes.ts';
import { syncExtendedRegionsFromClassicZones } from '../extendedAdapter.ts';

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
    description: 'Preset estructurado XML/FXP de programa HALion con capas de zona.',
    extension: '.vstpreset.zip',
    mimeType: 'application/zip',
  },
  sample_chain: {
    title: 'Sample Chain Lineal con Cue Markers (.wav)',
    description: 'Audio continuo concatenado con marcas RIFF cue/smpl para Octatrack, SP-404, electribe y OP-1.',
    extension: '.wav',
    mimeType: 'audio/wav',
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
      ampEnvelope: reg.ampEnvOverride ?? session.articulation?.ampEnv,
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
    ampEnvelope: session.articulation?.ampEnv,
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

  if (options.format === 'sf2' && count24Bit > 0) {
    issues.push({
      id: 'sf2-bitdepth-clamp',
      category: 'bit_depth',
      severity: 'warning',
      title: 'Resolución de Audio Mayor a 16-bit (Límite SoundFont 2.04)',
      description: `La norma SoundFont 2.04 solo admite PCM entero de 16 bits. ${count24Bit} muestras superan esta resolución o son Float32.`,
      adaptation: 'Conversión automática a 16-bit PCM con dithering TPDF para preservar rango dinámico sin distorsión de cuantización.',
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

  if (options.format === 'sf2' && pingPongLoops > 0) {
    issues.push({
      id: 'sf2-pingpong-adaptation',
      category: 'loop',
      severity: 'warning',
      title: 'Bucles Ping-Pong no Soportados en SoundFont 2',
      description: `${pingPongLoops} regiones tienen bucle en modo Ping-Pong o Reverse, incompatible con el estándar SF2 2.04.`,
      adaptation: 'Conversión automática a bucle continuo forward tradicional (loop_continuous).',
      affectedCount: pingPongLoops,
    });
  }

  if ((options.format === 'sf2' || options.format === 'sample_chain') && complexXfades > 0) {
    issues.push({
      id: 'loop-crossfade-limitation',
      category: 'loop',
      severity: 'info',
      title: 'Micro-Crossfades de Bucle en Sampler Destino',
      description: `${complexXfades} regiones utilizan crossfade en bucle. En SF2 los puntos de loop son posiciones fijas de muestra sin fundido en tiempo real.`,
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
