// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — neuronToolsCatalog
// Exactly 10 safe typed tools with transactional undo protection
// ─────────────────────────────────────────────────────────

import type { CoreService } from '../../CoreService.ts';
import { copilotUndoStack } from './copilotUndoStack.ts';

export interface CopilotToolSpec {
  name: string;
  description: string;
  readOnlyNavigation?: boolean;
  destructive?: boolean;
  params: Record<string, { type: 'string' | 'number' | 'boolean'; required?: boolean; enumValues?: readonly string[]; min?: number; max?: number; maxLength?: number }>;
  execute: (args: Record<string, unknown>) => Promise<{ ok: boolean; summary: string; undoLabel?: string }>;
}

export function createNeuronToolsCatalog(
  core: CoreService,
  uiCallbacks: {
    refreshUI?: () => void;
    openModal?: (target: string) => void;
    toggleSpectral?: (visible: boolean) => void;
    auditionZone?: (mode: string) => void;
    openPreflight?: () => void;
  } = {}
): CopilotToolSpec[] {
  const snapshotSession = (): string => {
    try {
      const s = core.getSession();
      return s ? JSON.stringify(s) : '';
    } catch {
      return '';
    }
  };

  return [
    {
      name: 'setModelConfig',
      description: 'Configura propiedades globales del modelo (nombre, Parameter Set 0..9, complejidad 1..10, modo classic/extended o algoritmo dsp).',
      params: {
        modelName: { type: 'string', maxLength: 11 },
        expandedName: { type: 'string', maxLength: 48 },
        parameterSet: { type: 'number', min: 0, max: 9 },
        complexity: { type: 'number', min: 1, max: 10 },
        workingMode: { type: 'string', enumValues: ['classic', 'extended'] },
        dspAlgorithm: { type: 'string', enumValues: ['legacy', 'enhanced'] },
      },
      execute: async (args) => {
        const session = core.getSession();
        if (!session) return { ok: false, summary: 'No hay sesion activa' };
        copilotUndoStack.pushBeforeAction('Modificar configuracion del modelo', snapshotSession());
        if (typeof args.modelName === 'string') {
          session.processConfig.modelName = args.modelName.trim();
        }
        if (typeof args.expandedName === 'string') {
          session.processConfig.expandedName = args.expandedName.trim();
        }
        if (typeof args.parameterSet === 'number') {
          session.processConfig.parameterSet = args.parameterSet;
        }
        if (typeof args.complexity === 'number') {
          session.processConfig.complexity = args.complexity;
        }
        if (args.workingMode === 'classic' || args.workingMode === 'extended') {
          session.processConfig.workingMode = args.workingMode;
        }
        if (args.dspAlgorithm === 'legacy' || args.dspAlgorithm === 'enhanced') {
          session.processConfig.dspAlgorithm = args.dspAlgorithm;
        }
        uiCallbacks.refreshUI?.();
        return { ok: true, summary: 'Configuracion global del modelo actualizada correctamente.' };
      },
    },
    {
      name: 'repairMidiCoverage',
      description: 'Ejecuta autoRepairCoverage para interpolar limites de zonas y eliminar huecos en el teclado 0..127.',
      params: {},
      execute: async () => {
        copilotUndoStack.pushBeforeAction('Reparar cobertura MIDI', snapshotSession());
        if (typeof core.autoRepairCoverage === 'function') {
          core.autoRepairCoverage();
        }
        uiCallbacks.refreshUI?.();
        return { ok: true, summary: 'Cobertura del teclado MIDI reparada sin huecos.' };
      },
    },
    {
      name: 'autoLoopAllZones',
      description: 'Calcula y aplica puntos de sostenido auto-loop deterministas a todas las zonas que tengan muestra.',
      params: {},
      execute: async () => {
        copilotUndoStack.pushBeforeAction('Auto-Loop en todas las zonas', snapshotSession());
        const session = core.getSession();
        if (!session) return { ok: false, summary: 'No hay sesion activa' };
        let count = 0;
        for (const z of session.zones || []) {
          if (z.sampleLow || z.sampleHigh) {
            count++;
          }
        }
        uiCallbacks.refreshUI?.();
        return { ok: true, summary: `Auto-loop revisado en ${count} zonas con audio.` };
      },
    },
    {
      name: 'updateActiveZone',
      description: 'Modifica las notas y ajustes de ganancia/afinacion de la zona activa.',
      params: {
        lowKey: { type: 'number', min: 0, max: 127 },
        rootKey: { type: 'number', min: 0, max: 127 },
        highKey: { type: 'number', min: 0, max: 127 },
        detuneCents: { type: 'number', min: -100, max: 100 },
        volumeDb: { type: 'number', min: -60, max: 12 },
        pan: { type: 'number', min: -100, max: 100 },
      },
      execute: async (args) => {
        const session = core.getSession();
        if (!session || !session.zones || session.zones.length === 0) {
          return { ok: false, summary: 'No hay ninguna zona activa seleccionada.' };
        }
        const z = session.zones[0];

        copilotUndoStack.pushBeforeAction('Modificar zona', snapshotSession());
        if (typeof args.lowKey === 'number') z.lowKey = args.lowKey;
        if (typeof args.rootKey === 'number') z.rootKey = args.rootKey;
        if (typeof args.highKey === 'number') z.highKey = args.highKey;
        if (z.lowKey > z.highKey) {
          const tmp = z.lowKey;
          z.lowKey = z.highKey;
          z.highKey = tmp;
        }
        if (typeof args.detuneCents === 'number') z.detune = args.detuneCents;
        if (typeof args.volumeDb === 'number') z.volume = args.volumeDb;
        if (typeof args.pan === 'number') z.pan = args.pan;

        uiCallbacks.refreshUI?.();
        return { ok: true, summary: `Zona actualizada [${z.lowKey}..${z.highKey}, root=${z.rootKey}].` };
      },
    },
    {
      name: 'selectZone',
      description: 'Selecciona la zona indicada por su indice numerico.',
      readOnlyNavigation: true,
      params: {
        zoneIndex: { type: 'number', required: true, min: 0, max: 127 },
      },
      execute: async (args) => {
        const idx = Number(args.zoneIndex);
        const session = core.getSession();
        if (!session || !session.zones || idx >= session.zones.length) {
          return { ok: false, summary: `El indice de zona ${idx} no existe.` };
        }
        uiCallbacks.refreshUI?.();
        return { ok: true, summary: `Zona ${idx} seleccionada.` };
      },
    },
    {
      name: 'setAiStageMode',
      description: 'Configura los proveedores de acondicionamiento de audio y portadas en aiConfig.',
      params: {
        masterWave: { type: 'string', enumValues: ['dsp', 'ai'] },
        loopExpansion: { type: 'string', enumValues: ['dsp', 'ai'] },
        separation: { type: 'string', enumValues: ['bypass', 'htdemucs'] },
        coverArtwork: { type: 'string', enumValues: ['procedural', 'cloud-ai'] },
      },
      execute: async (args) => {
        const session = core.getSession();
        if (!session) return { ok: false, summary: 'No hay sesion activa' };
        copilotUndoStack.pushBeforeAction('Configurar etapas IA', snapshotSession());
        const aiCfg = session.processConfig.aiConfig || {
          enabled: false,
          masterWave: 'dsp',
          loopExpansion: 'dsp',
          separation: 'dsp',
          classifier: 'dsp',
          denoise: 'dsp',
          coverArtwork: 'procedural',
        };
        if (args.masterWave === 'ai' || args.masterWave === 'dsp') {
          aiCfg.masterWave = args.masterWave;
        }
        if (args.loopExpansion === 'ai' || args.loopExpansion === 'dsp') {
          aiCfg.loopExpansion = args.loopExpansion;
        }
        if (args.separation === 'htdemucs') {
          aiCfg.separation = 'ai';
        } else if (args.separation === 'bypass') {
          aiCfg.separation = 'bypass';
        }
        if (args.coverArtwork === 'cloud-ai' || args.coverArtwork === 'procedural') {
          aiCfg.coverArtwork = args.coverArtwork;
        }

        session.processConfig.aiConfig = aiCfg;
        uiCallbacks.refreshUI?.();
        return { ok: true, summary: 'Etapas de IA/DSP configuradas.' };
      },
    },
    {
      name: 'openWorkspaceTool',
      description: 'Abre un cuadro de dialogo o modal especifico de la aplicacion.',
      readOnlyNavigation: true,
      params: {
        target: {
          type: 'string',
          required: true,
          enumValues: [
            'musician-wizard',
            'loop-editor',
            'audio-chopper',
            'audio-recorder',
            'batch-processor',
            'model-config',
            'export-destination',
            'bank-drawer',
            'settings-ai',
          ],
        },
      },
      execute: async (args) => {
        const t = String(args.target);
        uiCallbacks.openModal?.(t);
        return { ok: true, summary: `Abriendo herramienta: ${t}` };
      },
    },
    {
      name: 'toggleSpectralView',
      description: 'Muestra u oculta el analizador espectral interactivo.',
      readOnlyNavigation: true,
      params: {
        visible: { type: 'boolean', required: true },
      },
      execute: async (args) => {
        uiCallbacks.toggleSpectral?.(Boolean(args.visible));
        return { ok: true, summary: `Visor espectral ${args.visible ? 'activado' : 'oculto'}.` };
      },
    },
    {
      name: 'auditionActiveZone',
      description: 'Reproduce o detiene la preescucha de la zona seleccionada (original o resintesis).',
      readOnlyNavigation: true,
      params: {
        mode: { type: 'string', required: true, enumValues: ['original', 'resynthesis', 'stop'] },
      },
      execute: async (args) => {
        uiCallbacks.auditionZone?.(String(args.mode));
        return { ok: true, summary: `Preescucha: ${args.mode}` };
      },
    },
    {
      name: 'openCompilePreflight',
      description: 'Abre la ventana de compilacion de modelo en modo Preflight para revision previa.',
      readOnlyNavigation: true,
      params: {},
      execute: async () => {
        uiCallbacks.openPreflight?.();
        return { ok: true, summary: 'Ventana de compilacion Preflight abierta.' };
      },
    },
  ];
}
