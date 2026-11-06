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
import type { ExtendedRegion, UnifiedSurfaceUiConfig } from '../core/types';
import {
  buildAxionikExpandedModel,
  type ExpandedSpectralSource,
} from '../core/expandedModelWriter';
import { renderResynatorWasm } from '../core/dsp/ResynatorV2Wasm';
import { midiNoteToHz } from '../core/dsp/WavDecoder';
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

  /** Reproduce un par estéreo en el contexto de preescucha, sustituyendo lo que hubiera. */
  private playStereoBuffer(left: Float32Array, right: Float32Array, sampleRate: number): void {
    if (!this.previewAudioCtx) return;
    this.stopResynatorV2Preview();
    const audioBuf = this.previewAudioCtx.createBuffer(2, left.length, sampleRate);
    audioBuf.copyToChannel(new Float32Array(left), 0);
    audioBuf.copyToChannel(new Float32Array(right), 1);
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
    const sampleRate = this.previewAudioCtx.sampleRate;
    const velocity01 = Math.min(1, Math.max(0, this.preview.velocity / 127));

    try {
      // Sesión real: el documento se construye de la zona inspeccionada y lo
      // renderiza el MOTOR (WASM). Lo que suena es el motor, sin espejos.
      if (!isNeutralCompare && this.handlers.getSessionResynatorV2Stereo) {
        const realStereo = await this.handlers.getSessionResynatorV2Stereo(
          this.preview.midiNote,
          this.preview.velocity,
          this.preview.hostBpm
        );
        if (realStereo && realStereo.left.length > 0) {
          this.playStereoBuffer(realStereo.left, realStereo.right, realStereo.sampleRate);
          toast(
            `Resinator v2 (Motor): Nota ${this.preview.midiNote} · Vel ${this.preview.velocity} · B=${((surfCfg.inharmonicityB ?? 0) * 1000).toFixed(1)}‰ · Paridad=${Math.round((surfCfg.parity ?? 0) * 100)}%`,
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

      // Calibración neutral: los mismos 4 nodos sintéticos C3/C5 × suave/fuerte
      // alimentan al MOTOR a través del writer. Los sliders del laboratorio
      // viajan en `unifiedSurfaceConfig` hasta los shapers del documento.
      const sourceOf = (model: AxionikSpectralModel): ExpandedSpectralSource => {
        const frames = model.frames;
        const at = (f: number): AxionikSpectralModel['frames'][number] =>
          frames[Math.min(Math.max(0, f), frames.length - 1)];
        return {
          frameCount: model.frameCount,
          frameSpanHz: 50,
          gridFixed: true,
          ampsOf: (f) => Float32Array.from(at(f).amps),
          offsetsOf: (f) => Float32Array.from(at(f).offsets),
          f0At: (f) => at(f).f0Hz ?? 220,
          isLayered: () => false,
          layerCount: 0,
          numFramesOf: () => 0,
          ampsOfLayer: () => new Float32Array(0),
          offsetsOfLayer: () => new Float32Array(0),
          f0AtLayer: () => 0,
          layerNameAt: () => '',
          layerWeightAt: () => 0,
          frameWeightAt: () => 0,
        };
      };
      const neutralRegion = (
        id: string,
        sampleName: string,
        lowKey: number,
        highKey: number,
        rootKey: number,
        lowVel: number,
        highVel: number
      ): ExtendedRegion => ({
        id,
        sampleName,
        lowKey,
        highKey,
        rootKey,
        lowVel,
        highVel,
        detune: 0,
        volume: 0,
        pan: 0,
        pitchKeytrack: 100,
        trigger: 'attack',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'equal-power',
        loopMode: 'loop_continuous',
        loopStart: 0,
        loopEnd: 0,
        loopCrossfadeMs: 5,
        sampleRate,
      });
      const doc = buildAxionikExpandedModel({
        slot: 0,
        modelName: 'NeutralLab',
        expandedName: 'Neutral Lab',
        processConfig: { ...this.handlers.getConfig(), unifiedSurfaceConfig: surfCfg },
        spectral: sourceOf(c3Loud),
        spectralBySample: {
          'c3_p.wav': sourceOf(c3Soft),
          'c3_f.wav': sourceOf(c3Loud),
          'c5_p.wav': sourceOf(c5Soft),
          'c5_f.wav': sourceOf(c5Loud),
        },
        regions: [
          neutralRegion('c3_p', 'c3_p.wav', 0, 59, 48, 1, 64),
          neutralRegion('c3_f', 'c3_f.wav', 0, 59, 48, 65, 127),
          neutralRegion('c5_p', 'c5_p.wav', 60, 127, 72, 1, 64),
          neutralRegion('c5_f', 'c5_f.wav', 60, 127, 72, 65, 127),
        ],
        populateAdvancedSpectralExtensions: true,
        buildUnifiedSurface: true,
      });
      const totalDurSec = Math.min(8.0, Math.max(0.35, 1.6 + (surfCfg.releaseExtendSec ?? 0) * 0.6));
      const out = await renderResynatorWasm({
        modelJson: JSON.stringify(doc),
        midiNote: this.preview.midiNote,
        velocity01,
        seconds: totalDurSec,
        sampleRate,
      });
      this.playStereoBuffer(out.stereoL, out.stereoR, sampleRate);
      const hz = midiNoteToHz(this.preview.midiNote).toFixed(1);
      toast(
        isNeutralCompare
          ? `Preescucha Neutral (Motor): Nota ${this.preview.midiNote} (${hz} Hz) · Vel ${this.preview.velocity}`
          : `Resinator v2 (Motor): Nota ${this.preview.midiNote} (${hz} Hz) · B=${((surfCfg.inharmonicityB ?? 0) * 1000).toFixed(1)}‰ · Paridad=${Math.round((surfCfg.parity ?? 0) * 100)}%`,
        'info'
      );
    } catch (err) {
      // Sin espejo al que caer: si el motor no está disponible, se dice en voz alta.
      toast(
        `Motor Resynator v2 no disponible: ${err instanceof Error ? err.message : String(err)}`,
        'error'
      );
    }
  }
}
