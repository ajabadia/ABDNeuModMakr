// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Model Configuration & Properties Modal
// Dedicated multi-tab dialog for configuring all model-level
// settings (General & Engine, Articulation & Playback,
// Extended Metadata & Tags, and Cover Artwork).
//
// The dialog shell lives here; each tab's markup and event
// wiring lives in ./modelConfig/* (one module per tab).
// ─────────────────────────────────────────────────────────

import { getAppLocale, onAppLocaleChange } from '../core/i18n';
import { ICONS } from './icons';
import { createModalFocusTrap, type FocusTrap } from './modalFocusTrap';
import { toast } from './notify';
import {
  bindArticulationEvents,
  bindArtworkEvents,
  bindGeneralEvents,
  bindMetadataEvents,
} from './modelConfig/events';
import { renderArticulationTab } from './modelConfig/tabArticulation';
import { renderArtworkTab } from './modelConfig/tabArtwork';
import { renderGeneralTab } from './modelConfig/tabGeneral';
import { renderMetadataTab } from './modelConfig/tabMetadata';
import type {
  ModelConfigEventContext,
  ModelConfigModalHandlers,
  ModelConfigPreviewState,
  ModelConfigTab,
  ModelConfigTabContext,
  ModelConfigTagEditorState,
} from './modelConfig/types';
import type { UnifiedSurfaceUiConfig } from '../core/types';
import {
  buildUnifiedSpectralSurface,
  evaluateUnifiedSpectralSurface,
} from '../core/dsp/UnifiedSpectralSurface';
import { synthesizeResynatorV2Preview } from '@abdsynths/shared/dsp/neuron-analysis';
import type { AxionikSpectralModel } from '@abdsynths/shared/contracts/axionikExpandedModel';

export type { ModelConfigModalHandlers, ModelConfigTab } from './modelConfig/types';

export class ModelConfigModal {
  private backdropEl: HTMLElement | null = null;
  private focusTrap: FocusTrap | null = null;
  private activeTab: ModelConfigTab = 'general';
  private handlers: ModelConfigModalHandlers;
  /** Tag editor state, shared by reference with the metadata tab. */
  private readonly tags: ModelConfigTagEditorState = { selectedKey: 'custom', customKey: '' };
  /** Resinator v2 audition parameters, shared by reference with the articulation tab. */
  private readonly preview: ModelConfigPreviewState = { midiNote: 60, velocity: 100, hostBpm: 120 };
  private previewAudioCtx: AudioContext | null = null;
  private previewSourceNode: AudioBufferSourceNode | null = null;

  constructor(handlers: ModelConfigModalHandlers) {
    this.handlers = handlers;
    onAppLocaleChange(() => {
      if (this.backdropEl) {
        this.render();
      }
    });
  }

  public open(tab: ModelConfigTab = 'general'): void {
    this.activeTab = tab;
    this.render();
  }

  public close(): void {
    this.stopResynatorV2Preview();
    if (this.focusTrap) {
      this.focusTrap.deactivate();
      this.focusTrap = null;
    }
    if (this.backdropEl) {
      this.backdropEl.remove();
      this.backdropEl = null;
    }
  }

  public isOpen(): boolean {
    return Boolean(this.backdropEl);
  }

  public updateConfig(): void {
    if (this.backdropEl) {
      this.render();
    }
  }

  private tabContext(): ModelConfigTabContext {
    return { handlers: this.handlers, preview: this.preview, tags: this.tags };
  }

  private eventContext(): ModelConfigEventContext {
    return {
      ...this.tabContext(),
      element: this.backdropEl as HTMLElement,
      rerender: () => this.render(),
      audition: (surf: UnifiedSurfaceUiConfig, neutralCompare: boolean) => {
        void this.auditionResynatorV2Lab(surf, neutralCompare);
      },
      stopPreview: () => this.stopResynatorV2Preview(),
    };
  }

  private render(): void {
    const isEs = getAppLocale() === 'es';
    const config = this.handlers.getConfig();
    const isExtended = (config.workingMode ?? 'classic') === 'extended';

    if (!this.backdropEl) {
      this.backdropEl = document.createElement('div');
      this.backdropEl.className = 'nmm-modal-backdrop model-config-backdrop';
      document.body.appendChild(this.backdropEl);

      this.backdropEl.addEventListener('click', (e) => {
        if (e.target === this.backdropEl) this.close();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.backdropEl) this.close();
      });
    }

    let tabBodyHtml = '';
    if (this.activeTab === 'general') {
      tabBodyHtml = renderGeneralTab(this.tabContext(), config);
    } else if (this.activeTab === 'articulation') {
      tabBodyHtml = renderArticulationTab(this.tabContext(), config);
    } else if (this.activeTab === 'metadata') {
      tabBodyHtml = renderMetadataTab(this.tabContext(), config);
    } else if (this.activeTab === 'artwork') {
      tabBodyHtml = renderArtworkTab(config);
    }

    const tagCount = config.extendedMetadata?.customAttributes?.length ?? 0;

    this.backdropEl.innerHTML = `
      <div class="nmm-modal-window model-config-window" role="dialog" aria-modal="true" aria-labelledby="model-config-title">
        <header class="nmm-modal-header">
          <div class="nmm-modal-header-title">
            <span class="nmm-modal-header-icon">${ICONS.sliders}</span>
            <h2 id="model-config-title">${isEs ? 'Configuración del Modelo' : 'Model Configuration'}</h2>
            <span class="panel-badge ${isExtended ? 'badge-ai-on' : 'badge-muted'}">
              ${isExtended ? (isEs ? 'MODO EXTENDED (HD)' : 'EXTENDED MODE (HD)') : (isEs ? 'HARDWARE CLÁSICO 1:1' : 'CLASSIC 1:1 HARDWARE')}
            </span>
          </div>
          <button type="button" class="nmm-modal-close" aria-label="${isEs ? 'Cerrar' : 'Close'}" id="btn-model-config-close">
            ${ICONS.close}
          </button>
        </header>

        <!-- Navigation Tabs -->
        <nav class="model-config-tabs-nav" aria-label="${isEs ? 'Secciones de Configuración del Modelo' : 'Model Configuration Sections'}">
          <button type="button" class="model-tab-btn ${this.activeTab === 'general' ? 'is-active' : ''}" data-tab="general">
            <span class="tab-icon">${ICONS.cpu}</span>
            <div class="tab-label">
              <span class="tab-title">${isEs ? 'Modo y Motor' : 'Mode &amp; Engine'}</span>
              <span class="tab-sub">${isEs ? 'Neuron 2002 / HD Multicapa' : 'Neuron 2002 / HD Multi-Layer'}</span>
            </div>
          </button>
          <button type="button" class="model-tab-btn ${this.activeTab === 'articulation' ? 'is-active' : ''} ${!isExtended ? 'is-mode-conditioned' : ''}" data-tab="articulation" title="${!isExtended ? (isEs ? 'Opciones exclusivas del Modo Extended (HD)' : 'Exclusive options for Extended Mode (HD)') : (isEs ? 'Reproducción, Articulación y Laboratorio Resinator' : 'Playback, Articulation & Resinator Lab')}">
            <span class="tab-icon">${ICONS.piano}</span>
            <div class="tab-label">
              <span class="tab-title">${isEs ? 'Reproducción y Articulación' : 'Playback &amp; Articulation'} ${!isExtended ? '<span class="cond-reason-badge is-extended-only">EXTENDED</span>' : ''}</span>
              <span class="tab-sub">${isEs ? 'Glide, Bend y Estándar 24/96' : 'Glide, Bend &amp; Standard 24/96'}</span>
            </div>
          </button>
          <button type="button" class="model-tab-btn ${this.activeTab === 'metadata' ? 'is-active' : ''} ${!isExtended ? 'is-mode-conditioned' : ''}" data-tab="metadata" title="${!isExtended ? (isEs ? 'Opciones exclusivas del Modo Extended (HD)' : 'Exclusive options for Extended Mode (HD)') : (isEs ? 'Metadatos y Etiquetas de Procedencia' : 'Metadata & Provenance Tags')}">
            <span class="tab-icon">${ICONS.database}</span>
            <div class="tab-label">
              <span class="tab-title">${isEs ? 'Metadatos y Etiquetas' : 'Metadata &amp; Tags'} ${!isExtended ? '<span class="cond-reason-badge is-extended-only">EXTENDED</span>' : ''}</span>
              <span class="tab-sub">${tagCount > 0 ? (isEs ? `${tagCount} Etiquetas Definidas` : `${tagCount} Tags Defined`) : (isEs ? 'SoundFont y Procedencia' : 'SoundFont &amp; Provenance')}</span>
            </div>
          </button>
          <button type="button" class="model-tab-btn ${this.activeTab === 'artwork' ? 'is-active' : ''} ${!isExtended ? 'is-mode-conditioned' : ''}" data-tab="artwork" title="${!isExtended ? (isEs ? 'Opciones exclusivas del Modo Extended (HD)' : 'Exclusive options for Extended Mode (HD)') : (isEs ? 'Portada WebP 512×512' : '512×512 WebP Cover Artwork')}">
            <span class="tab-icon">${ICONS.palette}</span>
            <div class="tab-label">
              <span class="tab-title">${isEs ? 'Portada' : 'Cover Artwork'} ${!isExtended ? '<span class="cond-reason-badge is-extended-only">EXTENDED</span>' : ''}</span>
              <span class="tab-sub">${config.coverArtwork ? (isEs ? 'WebP 512×512 Adjunta' : '512×512 WebP Attached') : (isEs ? 'Sin Imagen de Portada' : 'No Cover Image')}</span>
            </div>
          </button>
        </nav>

        <div class="nmm-modal-body nmm-modal-body-fill">
          ${tabBodyHtml}
        </div>
      </div>
    `;

    if (!this.focusTrap && this.backdropEl) {
      this.focusTrap = createModalFocusTrap(this.backdropEl, {
        onEscape: () => this.close(),
        initialFocusSelector: '#btn-model-config-close',
      });
      this.focusTrap.activate();
    }

    this.bindEvents();
  }

  private bindEvents(): void {
    if (!this.backdropEl) return;
    const ctx = this.eventContext();

    this.backdropEl
      .querySelector('#btn-model-config-close')
      ?.addEventListener('click', () => this.close());

    this.backdropEl.querySelectorAll<HTMLButtonElement>('.model-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab') as ModelConfigTab;
        if (tab && tab !== this.activeTab) {
          this.activeTab = tab;
          this.render();
        }
      });
    });

    if (this.activeTab === 'general') {
      bindGeneralEvents(ctx);
    } else if (this.activeTab === 'articulation') {
      bindArticulationEvents(ctx);
    } else if (this.activeTab === 'metadata') {
      bindMetadataEvents(ctx);
    } else if (this.activeTab === 'artwork') {
      bindArtworkEvents(ctx);
    }
  }

  private stopResynatorV2Preview(): void {
    if (this.previewSourceNode) {
      try {
        this.previewSourceNode.stop();
        this.previewSourceNode.disconnect();
      } catch {
        // Ignore if already stopped
      }
      this.previewSourceNode = null;
    }
  }

  private async auditionResynatorV2Lab(
    surfCfg: UnifiedSurfaceUiConfig,
    isNeutralCompare: boolean
  ): Promise<void> {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return;
    this.stopResynatorV2Preview();

    if (!this.previewAudioCtx) {
      this.previewAudioCtx = new AudioContext();
    }
    if (this.previewAudioCtx.state === 'suspended') {
      await this.previewAudioCtx.resume();
    }

    // If the user has an active session with loaded/inspected zone(s) and is not doing neutral synthetic calibration,
    // synthesize directly from the real zone's spectral model + PCM attack transient!
    if (!isNeutralCompare && this.handlers.getSessionResynatorV2Stereo) {
      const realStereo = this.handlers.getSessionResynatorV2Stereo(
        this.preview.midiNote,
        this.preview.velocity,
        this.preview.hostBpm
      );
      if (realStereo && realStereo.left.length > 0) {
        const audioBuf = this.previewAudioCtx.createBuffer(
          2,
          realStereo.left.length,
          realStereo.sampleRate
        );
        audioBuf.copyToChannel(new Float32Array(realStereo.left), 0);
        audioBuf.copyToChannel(new Float32Array(realStereo.right), 1);

        const src = this.previewAudioCtx.createBufferSource();
        src.buffer = audioBuf;
        src.connect(this.previewAudioCtx.destination);
        src.onended = () => {
          if (this.previewSourceNode === src) {
            this.previewSourceNode = null;
          }
        };
        this.previewSourceNode = src;
        src.start();

        toast(
          `Resinator v2 (Muestra Real): Nota ${this.preview.midiNote} · Vel ${this.preview.velocity} · B=${((surfCfg.inharmonicityB ?? 0) * 1000).toFixed(1)}‰ · Paridad=${Math.round((surfCfg.parity ?? 0) * 100)}%`,
          'info'
        );
        return;
      }
    }

    // Fallback: Build calibration nodes at C3 (48, soft/loud) and C5 (72, soft/loud) to demonstrate 2D Pitch × Velocity interpolation
    const makeNodeModel = (f0Hz: number, brightFactor: number): AxionikSpectralModel => {
      const partialCount = 64;
      const frameCount = 32;
      const frames = [];
      for (let t = 0; t < frameCount; t++) {
        const normT = t / (frameCount - 1);
        const attackEnv = Math.min(1, t / 5);
        const decayEnv = Math.exp(-normT * 1.4);
        const env = attackEnv * decayEnv;
        const amps: number[] = [];
        const offsets: number[] = [];
        const bandwidths: number[] = [];
        for (let k = 0; k < partialCount; k++) {
          const n = k + 1;
          const roll = Math.pow(n, -1.15 / brightFactor);
          amps.push((0.45 / partialCount) * 8 * roll * env);
          offsets.push(0);
          bandwidths.push(0.015 * Math.min(1, n / 32));
        }
        const formantEnvelopeDb: number[] = [];
        const residualBandsDb: number[] = [];
        for (let b = 0; b < 24; b++) {
          const dist = Math.abs(b - 7);
          formantEnvelopeDb.push(-6 - dist * 1.8);
          residualBandsDb.push(-48 - Math.abs(b - 14) * 1.2);
        }
        frames.push({
          amps,
          offsets,
          bandwidths,
          formantEnvelopeDb,
          residualBandsDb,
          f0Hz,
          timeSec: normT * 1.6,
          spatialQuad: [0.75, 0.75, 0.35, 0.35] as [number, number, number, number],
        });
      }
      return { partialCount, frameCount, frames };
    };

    const c3Soft = makeNodeModel(130.81, 0.75);
    const c3Loud = makeNodeModel(130.81, 1.35);
    const c5Soft = makeNodeModel(523.25, 0.8);
    const c5Loud = makeNodeModel(523.25, 1.4);

    const surface = buildUnifiedSpectralSurface({
      regions: [
        { id: 'c3_p', sampleRef: 'c3_p.wav', lowKey: 0, highKey: 59, rootKey: 48, lowVel: 1, highVel: 64 },
        { id: 'c3_f', sampleRef: 'c3_f.wav', lowKey: 0, highKey: 59, rootKey: 48, lowVel: 65, highVel: 127 },
        { id: 'c5_p', sampleRef: 'c5_p.wav', lowKey: 60, highKey: 127, rootKey: 72, lowVel: 1, highVel: 64 },
        { id: 'c5_f', sampleRef: 'c5_f.wav', lowKey: 60, highKey: 127, rootKey: 72, lowVel: 65, highVel: 127 },
      ],
      primarySpectral: c3Loud,
      spectralBySample: {
        'c3_p.wav': c3Soft,
        'c3_f.wav': c3Loud,
        'c5_p.wav': c5Soft,
        'c5_f.wav': c5Loud,
      },
      tempoSync: surfCfg.tempoSync,
    });

    const evaluated = evaluateUnifiedSpectralSurface(surface, {
      midiNote: this.preview.midiNote,
      velocity: this.preview.velocity,
      attackShorten01: surfCfg.attackShorten01 ?? 0,
      releaseExtendSec: surfCfg.releaseExtendSec ?? 0,
      formantLock01: surfCfg.formantLock01 ?? 1,
      includeOutliers: surfCfg.includeOutliers ?? false,
      hostBpm: this.preview.hostBpm,
    });

    const baseDurSec = 1.6 * (evaluated.tempoScaleFactor ? 1 / evaluated.tempoScaleFactor : 1);
    const totalDurSec = Math.min(8.0, Math.max(0.35, baseDurSec + (surfCfg.releaseExtendSec ?? 0) * 0.6));

    const synthOut = synthesizeResynatorV2Preview({
      frames: evaluated.frames,
      targetF0Hz: evaluated.targetF0Hz,
      partialCount: evaluated.partialCount,
      startFrameIndex: evaluated.startFrameIndex,
      sustainStartFrame: evaluated.sustainStartFrame,
      sustainEndFrame: evaluated.sustainEndFrame,
      sustainBehavior: evaluated.sustainBehavior,
      modulation: evaluated.modulation,
      shapers: {
        inharmonicityB: surfCfg.inharmonicityB ?? 0,
        parity: surfCfg.parity ?? 0,
        residualMix: surfCfg.residualMix ?? 0.15,
        formantPreserve: surfCfg.formantLock01 ?? 1,
        spatialSpread: 0.6,
      },
      durationSec: totalDurSec,
      sampleRate: this.previewAudioCtx.sampleRate,
    });

    const audioBuf = this.previewAudioCtx.createBuffer(
      2,
      synthOut.stereoL.length,
      synthOut.sampleRate
    );
    audioBuf.copyToChannel(new Float32Array(synthOut.stereoL), 0);
    audioBuf.copyToChannel(new Float32Array(synthOut.stereoR), 1);

    const src = this.previewAudioCtx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(this.previewAudioCtx.destination);
    src.onended = () => {
      if (this.previewSourceNode === src) {
        this.previewSourceNode = null;
      }
    };
    this.previewSourceNode = src;
    src.start();

    toast(
      isNeutralCompare
        ? `Preescucha Neutral (A/B): Nota ${this.preview.midiNote} (${evaluated.targetF0Hz} Hz) · Vel ${this.preview.velocity}`
        : `Resinator v2 Activo: Nota ${this.preview.midiNote} (${evaluated.targetF0Hz} Hz) · B=${((surfCfg.inharmonicityB ?? 0) * 1000).toFixed(1)}‰ · Paridad=${Math.round((surfCfg.parity ?? 0) * 100)}% · TempoScale=${(evaluated.tempoScaleFactor ?? 1).toFixed(2)}x`,
      'info'
    );
  }
}
