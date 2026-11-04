// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Export by Destination Catalog & Router (Fase 35.2)
//
// Pure, DOM-free catalog and action dispatcher for the musician-first
// export hub ("Exportar por destino"):
//   1. Para tocar en AxionikVS → Cápsula del Tiempo (.zip 5 capas / AxionikDB)
//   2. Para otros samplers → Kontakt / Decent / SFZ / SF2 / MPC / EXS24…
//   3. Solo audio → WAV / AIFF (muestra de zona activa o cadena WAV con Cue)
//
// Zero new exporters: delegates 100% to existing handlers (`onExportModel`,
// `onExportModelAs`, `onSaveToAxionikDb`, `onExportSampler`, `onExportZoneAiff`).
// ─────────────────────────────────────────────────────────

import type { RawSamplerFormat } from '../core/export/rawSamplerTypes.ts';
import { getAppLocale } from '../core/i18n.ts';
import type { WorkingMode } from '../core/types.ts';

export type ExportDestinationId = 'time-capsule' | 'other-samplers' | 'raw-audio';

/** Canonical product name replacing generic "Export ZIP" / "Save Model Pack (.zip)". */
export const TIME_CAPSULE_CANONICAL_LABEL = 'Time Capsule (.zip)';
export const TIME_CAPSULE_ES_LABEL = 'Cápsula del Tiempo (.zip)';

export interface ExportDestinationQuickAction {
  id: string;
  label: string;
  primary?: boolean;
  samplerFormat?: RawSamplerFormat;
}

export interface ExportDestinationCard {
  id: ExportDestinationId;
  title: string;
  targetSubtitle: string;
  badge: string;
  description: string;
  primaryActionLabel: string;
  secondaryActions: ExportDestinationQuickAction[];
}

export interface ExportSessionContext {
  modelName: string;
  expandedName?: string;
  slot: number;
  workingMode?: WorkingMode;
  zoneCount: number;
  regionCount: number;
  hasActiveZoneSample: boolean;
}

/** Static O(1) lookup table mapping secondary quick-action IDs to their target RawSamplerFormat. */
const QUICK_SAMPLER_FORMAT_BY_ACTION: Readonly<Record<string, RawSamplerFormat>> = {
  'fmt-sf2': 'sf2',
  'fmt-sfz': 'sfz',
  'fmt-dspreset': 'dspreset',
  'fmt-nki': 'nki',
  'fmt-mpc': 'mpc_xpm',
  'fmt-exs24': 'exs24',
  'wav-chain': 'sample_chain',
};

export interface ExportDestinationCallbacks {
  onExportTimeCapsule: () => void | Promise<void>;
  onExportTimeCapsuleAs?: () => void | Promise<void>;
  onSaveToAxionikDb?: () => void | Promise<void>;
  onExportSampler: (initialFormat?: RawSamplerFormat) => void;
  onExportZoneAiff: () => void;
}

/**
 * Returns the 3 canonical destination cards for Fase 35.2.
 */
export function buildExportDestinationCards(): ExportDestinationCard[] {
  const isEs = getAppLocale() === 'es';
  return [
    {
      id: 'time-capsule',
      title: isEs
        ? 'Para tocar en AxionikVS → Cápsula del Tiempo'
        : 'Play in AxionikVS → Time Capsule',
      targetSubtitle: isEs
        ? 'Cápsula del Tiempo (.zip de 5 capas) y librería AxionikDB'
        : 'Time Capsule (5-layer .zip) and AxionikDB library',
      badge: isEs ? 'Cápsula del Tiempo' : 'Time Capsule',
      description: isEs
        ? 'Empaqueta el instrumento completo sin pérdida generacional: fuente original (01), modelo clásico Hartmann (04), Master Wave 96 kHz (03) y modelo extendido v2 (05) con portada WebP.'
        : 'Packages the complete instrument with zero generation loss: raw source (01), classic Hartmann model (04), 96 kHz Master Wave (03), and extended v2 model (05) with WebP cover.',
      primaryActionLabel: isEs
        ? `Exportar ${TIME_CAPSULE_ES_LABEL}`
        : `Export ${TIME_CAPSULE_CANONICAL_LABEL}`,
      secondaryActions: [
        { id: 'axionikdb', label: isEs ? 'Guardar en AxionikDB' : 'Save to AxionikDB' },
        { id: 'time-capsule-as', label: isEs ? 'Guardar Cápsula Como…' : 'Save Capsule As…' },
      ],
    },
    {
      id: 'other-samplers',
      title: isEs
        ? 'Para otros samplers → Kontakt / Decent / SFZ…'
        : 'Other Samplers → Kontakt / Decent / SFZ…',
      targetSubtitle:
        'SoundFont 2, SFZ, Decent Sampler, Kontakt, MPC, EXS24, Ableton, HALion, Bitwig, Akai, Roland…',
      badge: isEs ? '35 formatos · Multi-Export' : '35 formats · Multi-Export',
      description: isEs
        ? 'Convierte las zonas, capas de velocidad, puntos de bucle y muestras actuales a uno o múltiples formatos nativos de sampler hardware o software simultáneamente con revisión preflight automática.'
        : 'Converts current zones, velocity layers, loop points, and samples into one or multiple native hardware/software sampler formats simultaneously with automatic preflight review.',
      primaryActionLabel: isEs ? 'Elegir formato(s) de sampler…' : 'Choose sampler format(s)…',
      secondaryActions: [
        { id: 'fmt-sf2', label: 'SF2', samplerFormat: 'sf2' },
        { id: 'fmt-sfz', label: 'SFZ', samplerFormat: 'sfz' },
        { id: 'fmt-dspreset', label: 'Decent Sampler', samplerFormat: 'dspreset' },
        { id: 'fmt-nki', label: 'Kontakt (.nki)', samplerFormat: 'nki' },
        { id: 'fmt-mpc', label: 'Akai MPC (.xpm)', samplerFormat: 'mpc_xpm' },
        { id: 'fmt-exs24', label: 'Logic EXS24', samplerFormat: 'exs24' },
      ],
    },
    {
      id: 'raw-audio',
      title: isEs ? 'Solo audio → WAV / AIFF' : 'Raw Audio → WAV / AIFF',
      targetSubtitle: isEs
        ? 'Muestra individual AIFF canónica (44.1 kHz / 16-bit) o cadena WAV con marcadores Cue'
        : 'Canonical single AIFF sample (44.1 kHz / 16-bit) or linear WAV chain with Cue markers',
      badge: 'WAV · AIFF',
      description: isEs
        ? 'Extrae únicamente el audio limpio: descarga la zona activa como archivo AIFF listo para hardware clásico o genera una cadena lineal WAV con marcadores RIFF Cue (Octatrack / SP-404).'
        : 'Extracts clean audio only: download the active zone as a classic hardware-ready AIFF file or build a linear WAV sample chain with RIFF Cue markers (Octatrack / SP-404).',
      primaryActionLabel: isEs ? 'Exportar zona activa (AIFF)' : 'Export active zone (AIFF)',
      secondaryActions: [
        {
          id: 'wav-chain',
          label: isEs ? 'Cadena WAV (Cue Markers)' : 'WAV Chain (Cue Markers)',
          samplerFormat: 'sample_chain',
        },
      ],
    },
  ];
}

/**
 * Formats a concise human-readable summary of the current session for the export header.
 */
export function resolveExportDestinationSummary(ctx: ExportSessionContext): {
  displayName: string;
  slotLabel: string;
  modeLabel: string;
  zonesLabel: string;
} {
  const isEs = getAppLocale() === 'es';
  const isExtended = ctx.workingMode === 'extended';
  const rawName = isExtended
    ? ctx.expandedName?.trim() || ctx.modelName.trim()
    : ctx.modelName.trim();
  const displayName = rawName || 'Init Model';
  const slotLabel = `#${String(ctx.slot).padStart(3, '0')}`;
  const modeLabel = isExtended
    ? (isEs ? 'Extended (Regiones 2D)' : 'Extended (2D Regions)')
    : 'Classic (1:1 Hardware)';
  const count = isExtended ? Math.max(ctx.regionCount, ctx.zoneCount) : ctx.zoneCount;
  const zonesLabel = isExtended
    ? `${count} ${count === 1 ? (isEs ? 'región' : 'region') : (isEs ? 'regiones' : 'regions')}`
    : `${count} ${count === 1 ? (isEs ? 'zona' : 'zone') : (isEs ? 'zonas' : 'zones')}`;
  return { displayName, slotLabel, modeLabel, zonesLabel };
}

/**
 * Dispatches either the primary destination action or a secondary quick-action
 * to the existing application export handlers without duplicating any exporter logic.
 */
export async function triggerExportDestinationAction(
  destinationId: ExportDestinationId,
  callbacks: ExportDestinationCallbacks,
  secondaryActionId?: string
): Promise<void> {
  if (destinationId === 'time-capsule') {
    if (secondaryActionId === 'axionikdb' && callbacks.onSaveToAxionikDb) {
      await callbacks.onSaveToAxionikDb();
      return;
    }
    if (secondaryActionId === 'time-capsule-as' && callbacks.onExportTimeCapsuleAs) {
      await callbacks.onExportTimeCapsuleAs();
      return;
    }
    await callbacks.onExportTimeCapsule();
    return;
  }

  if (destinationId === 'other-samplers') {
    const format = secondaryActionId ? QUICK_SAMPLER_FORMAT_BY_ACTION[secondaryActionId] : undefined;
    callbacks.onExportSampler(format);
    return;
  }

  if (destinationId === 'raw-audio') {
    if (secondaryActionId === 'wav-chain') {
      callbacks.onExportSampler(QUICK_SAMPLER_FORMAT_BY_ACTION['wav-chain']);
      return;
    }
    callbacks.onExportZoneAiff();
  }
}
