// ─────────────────────────────────────────────────────────
// Model Configuration — Tab 1 event binding (identity, mode, engine, surface).
// ─────────────────────────────────────────────────────────

import {
  DEFAULT_UNIFIED_SURFACE_CONFIG,
  type DspAlgorithmMode,
  type TargetFormat,
  type WorkingMode,
} from '../../../core/types';
import { promptDialog, toast } from '../../notify';
import type { ModelConfigEventContext } from '../types';

export function bindGeneralEvents(ctx: ModelConfigEventContext): void {
    if (!ctx.element) return;
    const config = ctx.handlers.getConfig();

    // Classic model name (max 11 chars)
    const inpName = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-model-name');
    const nameCounter = ctx.element.querySelector<HTMLElement>('#val-cfg-name-counter');
    inpName?.addEventListener('input', () => {
      const val = inpName.value.slice(0, 11);
      config.modelName = val;
      if (!config.expandedName) {
        config.expandedName = val;
      }
      if (nameCounter) nameCounter.textContent = `${val.length}/11 chars`;
      ctx.handlers.onConfigChange({ ...config });
    });

    // Extended model name (unrestricted length)
    const inpExpanded = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-expanded-name');
    const expCounter = ctx.element.querySelector<HTMLElement>('#val-cfg-expanded-counter');
    inpExpanded?.addEventListener('input', () => {
      const val = inpExpanded.value;
      config.expandedName = val;
      if ((config.workingMode ?? 'classic') === 'extended') {
        config.modelName = val.trim().slice(0, 11) || config.modelName || 'Model';
      }
      if (expCounter) expCounter.textContent = `${val.length} chars (No limit)`;
      ctx.handlers.onConfigChange({ ...config });
    });

    // Model slot (0..511)
    const inpSlot = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-model-slot');
    const slotBadge = ctx.element.querySelector<HTMLElement>('#val-cfg-slot-badge');
    inpSlot?.addEventListener('input', () => {
      const num = parseInt(inpSlot.value, 10);
      if (!isNaN(num) && num >= 0 && num <= 511) {
        config.modelNumber = num;
        if (slotBadge) slotBadge.textContent = `#${String(num).padStart(3, '0')}`;
        ctx.handlers.onConfigChange({ ...config });
      }
    });

    // Sub-library assignment (Fase 23)
    const selSub = ctx.element.querySelector<HTMLSelectElement>('#sel-cfg-sublibrary');
    selSub?.addEventListener('change', () => {
      config.sublibrary = selSub.value;
      ctx.handlers.onConfigChange({ ...config });
    });

    // Sub-library ordinal index (Fase 23)
    const inpOrdinal = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-sublib-ordinal');
    const valOrdinal = ctx.element.querySelector<HTMLElement>('#val-cfg-sublib-ordinal');
    inpOrdinal?.addEventListener('input', () => {
      const ord = parseInt(inpOrdinal.value, 10);
      if (!isNaN(ord) && ord > 0) {
        config.sublibraryOrdinal = ord;
        if (valOrdinal) valOrdinal.textContent = `#${ord}`;
        ctx.handlers.onConfigChange({ ...config });
      }
    });

    // New Sub-library creation button (Fase 23)
    ctx.element.querySelector('#btn-cfg-new-sublibrary')?.addEventListener('click', async () => {
      const entered = await promptDialog('Enter new Sub-library name:', '', {
        title: 'New Sub-library',
        confirmLabel: 'Create',
        placeholder: 'Sub-library name',
      });
      if (!entered || !entered.trim()) return;
      const clean = entered.trim();
      try {
        await ctx.handlers.onCreateSublibrary?.(clean);
        config.sublibrary = clean;
        ctx.handlers.onConfigChange({ ...config });
        ctx.rerender();
        toast(`Created sub-library "${clean}"`, 'success');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Error creating sub-library: ${msg}`, 'error');
      }
    });

    // Working mode radio
    ctx.element.querySelectorAll<HTMLInputElement>('input[name="cfg-working-mode"]').forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) {
          const mode = r.value as WorkingMode;
          config.workingMode = mode;
          if (mode === 'classic') {
            if (config.targetFormat === 'modern-neural') config.targetFormat = 'dual';
            config.dspAlgorithm = 'legacy';
          } else {
            if (config.targetFormat === 'legacy-neuron') config.targetFormat = 'dual';
            config.dspAlgorithm = 'enhanced';
          }
          ctx.handlers.onConfigChange({ ...config });
          ctx.rerender();
          toast(
            `Switched Working Mode: ${mode === 'classic' ? 'Classic (1:1 Hardware)' : 'Extended (HD Multi-Layer)'}`,
            'info'
          );
        }
      });
    });

    // Target format
    ctx.element.querySelectorAll<HTMLButtonElement>('.btn-target-format').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fmt = btn.getAttribute('data-fmt') as TargetFormat;
        if (fmt) {
          config.targetFormat = fmt;
          ctx.handlers.onConfigChange({ ...config });
          ctx.rerender();
        }
      });
    });

    // DSP Algorithm
    ctx.element.querySelectorAll<HTMLButtonElement>('.btn-dsp-algorithm').forEach((btn) => {
      btn.addEventListener('click', () => {
        const alg = btn.getAttribute('data-alg') as DspAlgorithmMode;
        if (alg) {
          config.dspAlgorithm = alg;
          ctx.handlers.onConfigChange({ ...config });
          ctx.rerender();
        }
      });
    });

    // Complexity (1..10)
    ctx.element.querySelectorAll<HTMLButtonElement>('.btn-complexity').forEach((btn) => {
      btn.addEventListener('click', () => {
        const comp = parseInt(btn.getAttribute('data-complexity') || '8', 10);
        config.complexity = comp;
        ctx.handlers.onConfigChange({ ...config });
        ctx.rerender();
      });
    });

    // Parameter Set (0..9)
    ctx.element.querySelectorAll<HTMLButtonElement>('.btn-param-set').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ps = parseInt(btn.getAttribute('data-param-set') || '0', 10);
        config.parameterSet = ps;
        ctx.handlers.onConfigChange({ ...config });
        ctx.rerender();
      });
    });

    // Unified Surface Resolution Strategy & Topology (Fase 39)
    const selResStrategy = ctx.element.querySelector<HTMLSelectElement>('#sel-cfg-surf-res-strategy');
    selResStrategy?.addEventListener('change', () => {
      config.unifiedSurfaceConfig = {
        ...DEFAULT_UNIFIED_SURFACE_CONFIG,
        ...config.unifiedSurfaceConfig,
        resolutionStrategy: selResStrategy.value as 'auto' | 'manual',
      };
      ctx.handlers.onConfigChange({ ...config });
      ctx.rerender();
    });

    const selTopology = ctx.element.querySelector<HTMLSelectElement>('#sel-cfg-surf-topology');
    selTopology?.addEventListener('change', () => {
      config.unifiedSurfaceConfig = {
        ...DEFAULT_UNIFIED_SURFACE_CONFIG,
        ...config.unifiedSurfaceConfig,
        topologyMode: selTopology.value as 'auto' | 'melodic_surface' | 'drum_kit_surface',
      };
      ctx.handlers.onConfigChange({ ...config });
    });
}
