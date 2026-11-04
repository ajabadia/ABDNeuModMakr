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
  return [
    {
      id: 'time-capsule',
      title: 'Para tocar en AxionikVS → Cápsula del Tiempo',
      targetSubtitle: 'Cápsula del Tiempo (.zip de 5 capas) y librería AxionikDB',
      badge: 'Cápsula del Tiempo',
      description:
        'Empaqueta el instrumento completo sin pérdida generacional: fuente original (01), modelo clásico Hartmann (04), Master Wave 96 kHz (03) y modelo extendido v2 (05) con portada WebP.',
      primaryActionLabel: `Exportar ${TIME_CAPSULE_ES_LABEL}`,
      secondaryActions: [
        { id: 'axionikdb', label: 'Guardar en AxionikDB' },
        { id: 'time-capsule-as', label: 'Guardar Cápsula Como…' },
      ],
    },
    {
      id: 'other-samplers',
      title: 'Para otros samplers → Kontakt / Decent / SFZ…',
      targetSubtitle: 'SoundFont 2, SFZ, Decent Sampler, Kontakt, MPC, EXS24, Ableton, HALion, Bitwig, Akai, Roland…',
      badge: '35 formatos · Multi-Export',
      description:
        'Convierte las zonas, capas de velocidad, puntos de bucle y muestras actuales a uno o múltiples formatos nativos de sampler hardware o software simultáneamente con revisión preflight automática.',
      primaryActionLabel: 'Elegir formato(s) de sampler…',
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
      title: 'Solo audio → WAV / AIFF',
      targetSubtitle: 'Muestra individual AIFF canónica (44.1 kHz / 16-bit) o cadena WAV con marcadores Cue',
      badge: 'WAV · AIFF',
      description:
        'Extrae únicamente el audio limpio: descarga la zona activa como archivo AIFF listo para hardware clásico o genera una cadena lineal WAV con marcadores RIFF Cue (Octatrack / SP-404).',
      primaryActionLabel: 'Exportar zona activa (AIFF)',
      secondaryActions: [
        { id: 'wav-chain', label: 'Cadena WAV (Cue Markers)', samplerFormat: 'sample_chain' },
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
  const isExtended = ctx.workingMode === 'extended';
  const rawName = isExtended
    ? ctx.expandedName?.trim() || ctx.modelName.trim()
    : ctx.modelName.trim();
  const displayName = rawName || 'Init Model';
  const slotLabel = `#${String(ctx.slot).padStart(3, '0')}`;
  const modeLabel = isExtended ? 'Extended (Regiones 2D)' : 'Classic (1:1 Hardware)';
  const count = isExtended ? Math.max(ctx.regionCount, ctx.zoneCount) : ctx.zoneCount;
  const zonesLabel = isExtended
    ? `${count} ${count === 1 ? 'región' : 'regiones'}`
    : `${count} ${count === 1 ? 'zona' : 'zonas'}`;
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
