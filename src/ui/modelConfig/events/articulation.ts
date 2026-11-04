// ─────────────────────────────────────────────────────────
// Model Configuration — Tab 2 event binding (playback, surface lab, Resinator preview).
// ─────────────────────────────────────────────────────────

import { DEFAULT_UNIFIED_SURFACE_CONFIG, type UnifiedSurfaceUiConfig } from '../../../core/types';
import { toast } from '../../notify';
import type { ModelConfigEventContext } from '../types';

export function bindArticulationEvents(ctx: ModelConfigEventContext): void {
    if (!ctx.element) return;
    const config = ctx.handlers.getConfig();
    const cp = config.commonPlayback ?? {
      loopMode: 'no_loop',
      pitchKeytrack: 100,
      trigger: 'attack',
      fadeCurve: 'equal-power',
    };

    const selLoop = ctx.element.querySelector<HTMLSelectElement>('#sel-cfg-loop-mode');
    selLoop?.addEventListener('change', () => {
      cp.loopMode = selLoop.value as any;
      config.commonPlayback = { ...cp };
      ctx.handlers.onConfigChange({ ...config });
    });

    const selTrigger = ctx.element.querySelector<HTMLSelectElement>('#sel-cfg-trigger');
    selTrigger?.addEventListener('change', () => {
      cp.trigger = selTrigger.value as any;
      config.commonPlayback = { ...cp };
      ctx.handlers.onConfigChange({ ...config });
    });

    const selFade = ctx.element.querySelector<HTMLSelectElement>('#sel-cfg-fade-curve');
    selFade?.addEventListener('change', () => {
      cp.fadeCurve = selFade.value as any;
      config.commonPlayback = { ...cp };
      ctx.handlers.onConfigChange({ ...config });
    });

    const inpKeytrack = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-keytrack');
    const valKeytrack = ctx.element.querySelector<HTMLElement>('#val-cfg-keytrack');
    inpKeytrack?.addEventListener('input', () => {
      const val = parseInt(inpKeytrack.value, 10);
      cp.pitchKeytrack = val;
      if (valKeytrack) valKeytrack.textContent = `${val}%`;
      config.commonPlayback = { ...cp };
      ctx.handlers.onConfigChange({ ...config });
    });

    // Fase 39: Unified Spectral Surface & Resinator Sonic Matter Lab controls
    const surf: UnifiedSurfaceUiConfig = {
      ...DEFAULT_UNIFIED_SURFACE_CONFIG,
      ...config.unifiedSurfaceConfig,
    };

    const chkOutliers = ctx.element.querySelector<HTMLInputElement>('#chk-cfg-surf-outliers');
    chkOutliers?.addEventListener('change', () => {
      surf.includeOutliers = chkOutliers.checked;
      config.unifiedSurfaceConfig = { ...surf };
      ctx.handlers.onConfigChange({ ...config });
    });

    const chkTransient = ctx.element.querySelector<HTMLInputElement>('#chk-cfg-surf-transient');
    chkTransient?.addEventListener('change', () => {
      surf.preserveHybridTransients = chkTransient.checked;
      config.unifiedSurfaceConfig = { ...surf };
      ctx.handlers.onConfigChange({ ...config });
    });

    const inpAttackShorten = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-surf-attack-shorten');
    const valAttackShorten = ctx.element.querySelector<HTMLElement>('#val-cfg-surf-attack-shorten');
    inpAttackShorten?.addEventListener('input', () => {
      const pct = parseInt(inpAttackShorten.value, 10) || 0;
      surf.attackShorten01 = pct / 100;
      if (valAttackShorten) valAttackShorten.textContent = `${pct}%`;
      config.unifiedSurfaceConfig = { ...surf };
      ctx.handlers.onConfigChange({ ...config });
    });

    const inpReleaseExtend = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-surf-release-extend');
    const valReleaseExtend = ctx.element.querySelector<HTMLElement>('#val-cfg-surf-release-extend');
    inpReleaseExtend?.addEventListener('input', () => {
      const sec = parseFloat(inpReleaseExtend.value) || 0;
      surf.releaseExtendSec = sec;
      if (valReleaseExtend) valReleaseExtend.textContent = `+${sec.toFixed(1)} s`;
      config.unifiedSurfaceConfig = { ...surf };
      ctx.handlers.onConfigChange({ ...config });
    });

    const inpFormantLock = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-surf-formant-lock');
    const valFormantLock = ctx.element.querySelector<HTMLElement>('#val-cfg-surf-formant-lock');
    inpFormantLock?.addEventListener('input', () => {
      const pct = parseInt(inpFormantLock.value, 10) || 0;
      surf.formantLock01 = pct / 100;
      if (valFormantLock) valFormantLock.textContent = `${pct}%`;
      config.unifiedSurfaceConfig = { ...surf };
      ctx.handlers.onConfigChange({ ...config });
    });

    const inpInharm = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-surf-inharm');
    const valInharm = ctx.element.querySelector<HTMLElement>('#val-cfg-surf-inharm');
    inpInharm?.addEventListener('input', () => {
      const permil = parseInt(inpInharm.value, 10) || 0;
      surf.inharmonicityB = permil / 1000;
      if (valInharm) valInharm.textContent = `${permil.toFixed(1)} ‰`;
      config.unifiedSurfaceConfig = { ...surf };
      ctx.handlers.onConfigChange({ ...config });
    });

    const inpParity = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-surf-parity');
    const valParity = ctx.element.querySelector<HTMLElement>('#val-cfg-surf-parity');
    inpParity?.addEventListener('input', () => {
      const pct = parseInt(inpParity.value, 10) || 0;
      surf.parity = pct / 100;
      if (valParity) valParity.textContent = `${pct}%`;
      config.unifiedSurfaceConfig = { ...surf };
      ctx.handlers.onConfigChange({ ...config });
    });

    const inpResidual = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-surf-residual');
    const valResidual = ctx.element.querySelector<HTMLElement>('#val-cfg-surf-residual');
    inpResidual?.addEventListener('input', () => {
      const pct = parseInt(inpResidual.value, 10) || 0;
      surf.residualMix = pct / 100;
      if (valResidual) valResidual.textContent = `${pct}%`;
      config.unifiedSurfaceConfig = { ...surf };
      ctx.handlers.onConfigChange({ ...config });
    });

    // Fase 39.4: Tempo-Sync controls for Resinator v2 contract
    const ensureTempoSync = () => {
      if (!surf.tempoSync) {
        surf.tempoSync = {
          enabled: false,
          sourceBpm: 120,
          targetBpm: 120,
          barCount: 2,
          timeSignature: [4, 4],
          grooveMode: 'free',
        };
      }
      return surf.tempoSync;
    };

    const chkTempoSync = ctx.element.querySelector<HTMLInputElement>('#chk-cfg-surf-temposync');
    chkTempoSync?.addEventListener('change', () => {
      const ts = ensureTempoSync();
      ts.enabled = chkTempoSync.checked;
      config.unifiedSurfaceConfig = { ...surf, tempoSync: { ...ts } };
      ctx.handlers.onConfigChange({ ...config });
      ctx.rerender();
    });

    const inpSourceBpm = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-surf-source-bpm');
    const valSourceBpm = ctx.element.querySelector<HTMLElement>('#val-cfg-surf-source-bpm');
    inpSourceBpm?.addEventListener('change', () => {
      const ts = ensureTempoSync();
      const bpm = Math.max(20, Math.min(300, parseFloat(inpSourceBpm.value) || 120));
      ts.sourceBpm = bpm;
      if (valSourceBpm) valSourceBpm.textContent = `${bpm} BPM`;
      config.unifiedSurfaceConfig = { ...surf, tempoSync: { ...ts } };
      ctx.handlers.onConfigChange({ ...config });
    });

    const inpBarCount = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-surf-bar-count');
    const valBars = ctx.element.querySelector<HTMLElement>('#val-cfg-surf-bars');
    inpBarCount?.addEventListener('change', () => {
      const ts = ensureTempoSync();
      const bars = Math.max(1, Math.min(64, parseInt(inpBarCount.value, 10) || 2));
      ts.barCount = bars;
      if (valBars) valBars.textContent = `${bars} compases (4/4)`;
      config.unifiedSurfaceConfig = { ...surf, tempoSync: { ...ts } };
      ctx.handlers.onConfigChange({ ...config });
    });

    const selGrooveMode = ctx.element.querySelector<HTMLSelectElement>('#sel-cfg-surf-groove-mode');
    selGrooveMode?.addEventListener('change', () => {
      const ts = ensureTempoSync();
      ts.grooveMode = selGrooveMode.value as 'free' | 'rex_loop' | 'melodic_phrase' | 'sliced_kit';
      config.unifiedSurfaceConfig = { ...surf, tempoSync: { ...ts } };
      ctx.handlers.onConfigChange({ ...config });
    });

    // Quick Lab Preset Buttons
    ctx.element.querySelectorAll<HTMLButtonElement>('.btn-surf-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-preset');
        if (preset === 'faithful') {
          Object.assign(surf, DEFAULT_UNIFIED_SURFACE_CONFIG);
          toast('Preset aplicado: Fiel al Original (Escudo anti-intrusos y bloqueo de formantes activos)', 'info');
        } else if (preset === 'chimera') {
          surf.includeOutliers = true;
          surf.topologyMode = 'melodic_surface';
          surf.formantLock01 = 0.5;
          toast('Preset aplicado: Quimera Morph (Interpolación entre distintos instrumentos activada)', 'info');
        } else if (preset === 'instant-pluck') {
          surf.attackShorten01 = 1.0;
          surf.preserveHybridTransients = false;
          toast('Preset aplicado: Pad -> Ataque Inmediato (Salto al pico espectral 100%)', 'info');
        } else if (preset === 'infinite-tail') {
          surf.releaseExtendSec = 5.0;
          toast('Preset aplicado: Cola Espectral Extendida (+5.0 s con caída física de agudos)', 'info');
        } else if (preset === 'crystal-bell') {
          surf.inharmonicityB = 0.025;
          surf.parity = -0.6;
          surf.releaseExtendSec = Math.max(surf.releaseExtendSec ?? 0, 2.5);
          toast('Preset aplicado: Campana / Cristal Metálico (Inarmonicidad B=25‰, Paridad impar)', 'info');
        } else if (preset === 'ddsp-ghost') {
          surf.residualMix = 0.85;
          surf.preserveHybridTransients = false;
          toast('Preset aplicado: Fantasma de Aire DDSP (85% residuo estocástico afinado)', 'info');
        }
        config.unifiedSurfaceConfig = { ...surf };
        ctx.handlers.onConfigChange({ ...config });
        ctx.rerender();
      });
    });

    // Live Resinator v2 Preview controls (ABDShared::NeuronResynatorV2)
    const selResNote = ctx.element.querySelector<HTMLSelectElement>('#sel-cfg-resv2-note');
    selResNote?.addEventListener('change', () => {
      ctx.preview.midiNote = parseInt(selResNote.value, 10) || 60;
    });
    const inpResVel = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-resv2-vel');
    inpResVel?.addEventListener('change', () => {
      ctx.preview.velocity = Math.max(1, Math.min(127, parseInt(inpResVel.value, 10) || 100));
    });
    const inpResHostBpm = ctx.element.querySelector<HTMLInputElement>('#inp-cfg-resv2-host-bpm');
    inpResHostBpm?.addEventListener('change', () => {
      ctx.preview.hostBpm = Math.max(20, Math.min(300, parseFloat(inpResHostBpm.value) || 120));
    });

    ctx.element.querySelector<HTMLButtonElement>('#btn-cfg-resv2-play')?.addEventListener('click', () => {
      ctx.audition(surf, false);
    });
    ctx.element.querySelector<HTMLButtonElement>('#btn-cfg-resv2-compare-faithful')?.addEventListener('click', () => {
      ctx.audition(DEFAULT_UNIFIED_SURFACE_CONFIG, true);
    });
    ctx.element.querySelector<HTMLButtonElement>('#btn-cfg-resv2-stop')?.addEventListener('click', () => {
      ctx.stopPreview();
    });
}
