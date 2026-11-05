// ─────────────────────────────────────────────────────────
// BatchProcessorModal — batchDiscoverView (Fase 42.5)
// Funciones extraidas verbatim de `src/ui/BatchProcessorModal.ts`.
// `modal` es el nucleo estructural (`BatchModalCore`).
// ─────────────────────────────────────────────────────────

import { getAppLocale } from '../../core/i18n.ts';
import { ICONS } from '../icons.ts';
import { escAttr, escHtml } from '../escape.ts';
import type { KeyMappingMode } from '../../core/types.ts';
import { buildPipelineChecklistRows } from '../../core/dsp/PipelineConditioningSteps.ts';
import type { PipelineStepDescriptor } from '../../core/dsp/PipelineConditioningSteps.ts';
import { cloudByokClient } from '../../core/ai/CloudByokClient.ts';
import { bridgeClient } from '../../core/bridge/BridgeClient.ts';
import type { BatchModalCore } from './batchModalCore.ts';


  // ── Step 1: Discovery ──────────────────────────────────

export function renderDiscoverStep(modal: BatchModalCore): string {
    const isEs = getAppLocale() === 'es';
    const isBridgeOnline = bridgeClient.isConnected();
    const defaultScanPath = modal.localScanPath;
    const isSlicer = modal.activeConfig.ingestionMode === 'slicer';

    return `
      <div class="nmm-batch-discover-pane">
        <!-- Ingestion Mode Selector -->
        <div class="nmm-batch-card batch-pane-head">
          <div class="triage-toolbar">
            <div class="triage-toolbar-left">
              <strong class="batch-pane-title">${isEs ? 'Estrategia de Ingesta:' : 'Ingestion Strategy:'}</strong>
              <span class="nmm-batch-hint batch-pane-hint">
                ${isSlicer ? (isEs ? 'Tratar cada bucle de audio como un kit/modelo individual, autodetectar cortes e incluir patrón MIDI.' : 'Treat each audio loop as an individual kit/model, auto-detect slices and bundle groove MIDI.') : isEs ? 'Agrupar múltiples archivos de muestras en modelos de instrumentos multizona.' : 'Group multiple sample files into multi-zone instrument models.'}
              </span>
            </div>
            <div class="footer-right">
              <button type="button" class="btn ${!isSlicer ? 'btn-primary' : 'btn-outline'}" id="btn-batch-mode-multisample">
                ${isEs ? 'Instrumentos Multimuestra' : 'Multisample Instruments'}
              </button>
              <button type="button" class="btn ${isSlicer ? 'btn-primary' : 'btn-outline'}" id="btn-batch-mode-slicer">
                ${ICONS.scissors} ${isEs ? 'AutoSlicer por Lotes (Bucles y Ritmos)' : 'Batch AutoSlicer (Loops & Beats)'}
              </button>
            </div>
          </div>

          <div class="batch-slicer-row">
            <div class="batch-field ${!isSlicer ? 'is-conditioned-disabled' : ''}">
              <label for="sel-batch-slicer-profile">
                ${isEs ? 'Perfil de Corte:' : 'Slicing Profile:'}
                ${!isSlicer ? `<span class="cond-reason-badge">${isEs ? 'SOLO AUTOSLICER' : 'AUTOSLICER ONLY'}</span>` : ''}
              </label>
              <select id="sel-batch-slicer-profile" class="form-control" ${!isSlicer ? `disabled title="${isEs ? 'Solo disponible en modo Batch AutoSlicer' : 'Only available in Batch AutoSlicer mode'}"` : ''}>
                <option value="drums" ${modal.activeConfig.slicerProfile === 'drums' ? 'selected' : ''}>${isEs ? 'Batería (Mapa General MIDI C1..B2)' : 'Drums (General MIDI C1..B2 Map)'}</option>
                <option value="chromatic" ${modal.activeConfig.slicerProfile === 'chromatic' ? 'selected' : ''}>${isEs ? 'Cromático (Tono F0 + Equidistante 0..127)' : 'Chromatic (F0 Pitch + Equidistant 0..127)'}</option>
                <option value="vocals" ${modal.activeConfig.slicerProfile === 'vocals' ? 'selected' : ''}>${isEs ? 'Voces y Frases (Valles de Silencio)' : 'Vocals & Phrases (Silence Valleys)'}</option>
                <option value="grid" ${modal.activeConfig.slicerProfile === 'grid' ? 'selected' : ''}>${isEs ? 'Rejilla Musical (División 1/16)' : 'Musical Grid (1/16 Beat Division)'}</option>
              </select>
            </div>

            <label class="batch-check ${!isSlicer ? 'is-conditioned-disabled' : ''}">
              <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-batch-export-midi" ${modal.activeConfig.exportMidiPattern !== false ? 'checked' : ''} ${!isSlicer ? 'disabled' : ''} />
              <span>${isEs ? 'Generar e Incluir Patrón Groove MIDI (.mid)' : 'Generate & Bundle Groove MIDI Pattern (.mid)'} ${!isSlicer ? `<span class="cond-reason-badge">${isEs ? 'SOLO AUTOSLICER' : 'AUTOSLICER ONLY'}</span>` : ''}</span>
            </label>

            <label class="batch-check" title="${isEs ? 'Agrupa el trabajo por etapas (1. Ingesta -> 2. Separación -> 3. Denoise -> 4. Super-Resolución/Clasificación -> 5. Síntesis Espectral) sobre todo el lote de una vez para no cargar y descargar modelos IA/DSP en cada archivo' : 'Groups work by stage across the entire batch so AI/DSP models stay warm in memory instead of loading/unloading per file'}">
              <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-batch-stage-grouped" ${modal.activeConfig.executionOrder !== 'per-job' ? 'checked' : ''} />
              <span>${isEs ? 'Cola por Fases (Modelo IA/DSP caliente en memoria)' : 'Stage-Grouped Queue (Keep AI/DSP model warm in memory)'}</span>
            </label>

            <label class="batch-check ${modal.activeConfig.executionOrder === 'per-job' ? 'is-conditioned-disabled' : ''}">
              <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-batch-vram-safety" ${modal.activeConfig.stagePipelineVramSafety !== false ? 'checked' : ''} ${modal.activeConfig.executionOrder === 'per-job' ? 'disabled' : ''} />
              <span title="${isEs ? 'Libera memoria CUDA entre etapas del pipeline para evitar falta de VRAM en gráficas de 6/8 GB' : 'Flushes CUDA memory between pipeline stages to prevent GPU OOM on 6/8 GB cards'}">${isEs ? 'Vaciado Seguro de VRAM por Etapa' : 'VRAM Stage Safety Flush'} ${modal.activeConfig.executionOrder === 'per-job' ? `<span class="cond-reason-badge">${isEs ? 'REQUIERE COLA POR FASES' : 'REQUIRES STAGE QUEUE'}</span>` : ''}</span>
            </label>
          </div>
        </div>

        <div class="nmm-batch-card">
          <h3>${isEs ? 'Seleccionar Material de Origen' : 'Select Source Material'}</h3>
          <p class="nmm-batch-hint">
            ${
              isSlicer
                ? isEs
                  ? 'Convierte en lote bucles de batería, pistas vocales o archivos ReCycle (.rx2/.rex/.rcy) en kits de modelos troceados independientes.'
                  : 'Batch convert drum loops, vocal tracks, or ReCycle (.rx2/.rex/.rcy) files into independent sliced model kits.'
                : isEs
                  ? 'Convierte bancos de samplers multiformato (.sf2, .sfz, .dspreset, .nki, .vstpreset, .multisample, .adv, .exs, .talsmpl, .txprog, .kmp, .dls, .xpm), imágenes de disco hardware (.iso, .img, .dsk, .efe), modelos Hartmann Neuron (.model, .neuronikmodel, .scape/.sphere), archivos .zip o carpetas de audio en una sola pasada desatendida.'
                  : 'Convert multi-format sampler banks (.sf2, .sfz, .dspreset, .nki, .vstpreset, .multisample, .adv, .exs, .talsmpl, .txprog, .kmp, .dls, .xpm), hardware disk images (.iso, .img, .dsk, .efe), Hartmann Neuron models (.model, .neuronikmodel, .scape/.sphere), .zip archives, or multi-folder audio packs in a single unattended pass.'
            }
          </p>

          <div class="nmm-batch-dropzone" id="batch-dropzone">
            <div class="nmm-batch-dropzone-icon">${ICONS.upload}</div>
            <div class="nmm-batch-dropzone-text">
              ${
                isSlicer
                  ? isEs
                    ? 'Arrastra y suelta <strong>bucles de audio (.wav, .aif, .flac, .mp3, .ogg, .rx2, .rex, .zip)</strong> o carpetas de bucles aquí'
                    : 'Drag & drop <strong>audio loops (.wav, .aif, .flac, .mp3, .ogg, .rx2, .rex, .zip)</strong> or loop folders here'
                  : isEs
                    ? 'Arrastra y suelta <strong>.sf2, .sfz, .dspreset, .nki, .exs, .xpm, .adv, .vstpreset, .multisample, .kmp, .dls, .model, .iso/.img/.dsk, .zip</strong> o carpetas de audio aquí'
                    : 'Drag & drop <strong>.sf2, .sfz, .dspreset, .nki, .exs, .xpm, .adv, .vstpreset, .multisample, .kmp, .dls, .model, .iso/.img/.dsk, .zip</strong>, or audio folders here'
              }
            </div>
            <div class="nmm-batch-dropzone-sub">${isEs ? 'o usa los botones inferiores' : 'or use the buttons below'}</div>
            
            <div class="nmm-batch-dropzone-actions">
              ${
                !isSlicer
                  ? `
              <label class="btn btn-primary">
                ${ICONS.folder} ${isEs ? 'Elegir Bancos, Presets, Discos o ZIP (.sf2, .sfz, .nki, .exs, .xpm, .model, .iso, .zip...)' : 'Select Banks, Presets, Disks or ZIP (.sf2, .sfz, .nki, .exs, .xpm, .model, .iso, .zip...)'}
                <input type="file" id="input-batch-sf2" accept=".model,.neuronikmodel,.nmmodel,.scape,.sphere,.nmpack,.script,.sf2,.sfz,.nki,.vstpreset,.dspreset,.multisample,.adv,.exs,.talsmpl,.txprog,.kmp,.ksf,.dls,.xpm,.xty,.xtd,.xpn,.pgm,.akp,.s3p,.sxt,.dwp,.krz,.k25,.k26,.x7u,.x8u,.x3a,.iso,.img,.dsk,.out,.hda,.efe,.ede,.rx2,.rex,.rcy,.cue,.wav,.aif,.aiff,.aifc,.flac,.mp3,.ogg,.oga,.m4a,.aac,.opus,.webm,.caf,.ncw,.zip" multiple class="is-hidden-file" />
              </label>
              `
                  : `
              <label class="btn btn-primary">
                ${ICONS.scissors} ${isEs ? 'Elegir Bucles (.wav, .flac, .mp3, .ogg, .rx2, .rex, .zip)' : 'Select Loops (.wav, .flac, .mp3, .ogg, .rx2, .rex, .zip)'}
                <input type="file" id="input-batch-loops" accept=".wav,.aif,.aiff,.aifc,.flac,.mp3,.ogg,.oga,.m4a,.aac,.opus,.webm,.caf,.ncw,.rx2,.rex,.rcy,.cue,.zip" multiple class="is-hidden-file" />
              </label>
              `
              }

              <label class="btn btn-outline">
                ${isEs ? `Seleccionar Carpeta ${isSlicer ? 'de Bucles' : 'Multiformato / Audio'}` : `Select ${isSlicer ? 'Loops Folder' : 'Multi-Format / Audio Folder'}`}
                <input type="file" id="input-batch-folder" webkitdirectory directory multiple class="is-hidden-file" />
              </label>
            </div>
          </div>
        </div>

        <div class="nmm-batch-card ${!isBridgeOnline ? 'is-conditioned-disabled' : ''}">
          <h3>${isEs ? 'Escáner de Disco Local Companion Bridge' : 'Companion Bridge Local Disk Scanner'} ${!isBridgeOnline ? `<span class="cond-reason-badge">${isEs ? 'BRIDGE DESCONECTADO (7860)' : 'BRIDGE OFFLINE (7860)'}</span>` : ''}</h3>
          <p class="nmm-batch-hint">
            ${isEs ? 'Escanea carpetas locales de gran capacidad sin cargar gigabytes de audio crudo en la memoria del navegador.' : 'Scan high-capacity local disk folders without loading gigabytes of raw audio into browser memory.'}
          </p>
          <div class="nmm-batch-scan-row">
            <input type="text" id="input-batch-scan-path" class="form-control" value="${escAttr(defaultScanPath)}" placeholder="C:\\path\\to\\soundfonts" />
            <button type="button" class="btn btn-outline" id="btn-batch-browse-disk" title="${isEs ? 'Navegar por el sistema de archivos para seleccionar la carpeta a escanear' : 'Browse filesystem to select the folder to scan'}">
              ${ICONS.folder} ${isEs ? 'Examinar...' : 'Browse...'}
            </button>
            <button type="button" class="btn btn-primary" id="btn-batch-scan-disk" ${!isBridgeOnline ? 'disabled' : ''}>
              ${ICONS.search} ${modal.isScanningLocal ? (isEs ? 'Escaneando...' : 'Scanning...') : isEs ? 'Escanear Carpeta' : 'Scan Folder'}
            </button>
          </div>
          ${!isBridgeOnline ? `<div class="nmm-alert-subtle">${isEs ? 'Companion Bridge está desconectado. Inicia el servicio bridge en <code>127.0.0.1:7860</code> para escanear rutas de disco local directamente.' : 'Companion Bridge is offline. Start the bridge daemon on <code>127.0.0.1:7860</code> to scan local disk paths directly.'}</div>` : ''}
        </div>
      </div>
    `;
  }


  // ── Step 2: Preflight Summary ──────────────────────────

export function renderEngineBadgeHtml(modal: BatchModalCore, row: PipelineStepDescriptor): string {
    const b = row.engineBadge;
    const iconSvg =
      b.iconKey === 'sparkle'
        ? ICONS.sparkle
        : b.iconKey === 'ai'
          ? ICONS.ai
          : b.iconKey === 'cloud'
            ? ICONS.cloud
            : b.iconKey === 'alert'
              ? ICONS.alert
              : b.iconKey === 'lock'
                ? ICONS.lock
                : ICONS.cpu;

    const batchQueuePill =
      !modal.isSingleSessionMode &&
      modal.activeConfig.executionOrder !== 'per-job' &&
      b.isBatchStageGroupedLocalAi
        ? `<span class="engine-badge-queue-pill" title="En proceso Batch, este modelo IA se mantiene caliente en VRAM y procesa todas las muestras del lote de forma consecutiva antes de pasar al siguiente paso">${ICONS.zap} COLA IA SEGUIDA</span>`
        : '';

    return `
      <div class="pipeline-engine-badge ${escAttr(b.cssClass)}" title="${escAttr(b.tooltip)}">
        <span class="engine-badge-icon">${iconSvg}</span>
        <span class="engine-badge-label">${escHtml(b.shortLabel)}</span>
        <span class="engine-badge-sep">·</span>
        <span class="engine-badge-model">${escHtml(b.modelOrEngineName)}</span>
        ${batchQueuePill}
      </div>
    `;
  }


export function renderPipelineChecklistCard(modal: BatchModalCore): string {
    const currentProc = modal.context.getCurrentProcessConfig();
    const session = modal.context.getActiveSession?.() ?? null;
    const srcInspect = modal.context.inspectProcessSources?.();
    const hasLegacyOnly = Boolean(
      modal.isSingleSessionMode &&
        srcInspect &&
        srcInspect.importedSources.length > 0 &&
        srcInspect.newAudioSources.length === 0
    );
    const keyMode: KeyMappingMode = modal.isSingleSessionMode
      ? (currentProc.keyMappingMode ?? 'chromatic')
      : modal.activeConfig.ingestionMode === 'slicer' && modal.activeConfig.slicerProfile === 'drums'
        ? 'drum'
        : (currentProc.keyMappingMode ?? 'chromatic');

    const sampleNames = modal.isSingleSessionMode
      ? (modal.context.getLoadedSampleNames?.() ?? [])
      : modal.candidates
          .filter((c) => modal.selectedCandidateIds.has(c.id))
          .flatMap((c) => c.files.map((f) => f.name));

    const byokCfg = cloudByokClient.getConfig();
    const firstCloudProvider = cloudByokClient.getFirstAvailableTextProvider();
    const hasCloudImageProvider = Boolean(
      byokCfg.geminiApiKey?.trim() ||
        byokCfg.openaiApiKey?.trim() ||
        byokCfg.openrouterApiKey?.trim() ||
        byokCfg.huggingfaceToken?.trim() ||
        byokCfg.replicateToken?.trim() ||
        byokCfg.claudeApiKey?.trim()
    );
    let cloudImageProviderName = 'Cloud BYOK';
    if (byokCfg.geminiApiKey?.trim()) cloudImageProviderName = 'Google Imagen 3 (Gemini)';
    else if (byokCfg.openaiApiKey?.trim()) cloudImageProviderName = 'OpenAI DALL-E 3';
    else if (byokCfg.openrouterApiKey?.trim()) cloudImageProviderName = 'OpenRouter FLUX.1';
    else if (byokCfg.huggingfaceToken?.trim()) cloudImageProviderName = 'HuggingFace FLUX.1';
    else if (byokCfg.replicateToken?.trim()) cloudImageProviderName = 'Replicate FLUX.1';
    else if (byokCfg.claudeApiKey?.trim()) cloudImageProviderName = 'Anthropic Claude SVG';

    const covErrs = modal.isSingleSessionMode && modal.context.validateCoverage ? modal.context.validateCoverage() : [];

    const rows = buildPipelineChecklistRows({
      workingMode: modal.context.getCurrentWorkingMode(),
      keyMappingMode: keyMode,
      isBatchMode: !modal.isSingleSessionMode,
      totalModelsCount: Math.max(1, modal.selectedCandidateIds.size),
      totalSamplesCount: sampleNames.length,
      hasLegacyClassicOnlySources: hasLegacyOnly,
      hasUncoveredMidiKeys: covErrs.length > 0,
      hasExistingCoverArtwork: Boolean(session?.processConfig.coverArtwork),
      sampleNames,
      sampleProcessingFlags: session?.sampleProcessingFlags,
      aiConfig: currentProc.aiConfig,
      dspAlgorithm: currentProc.dspAlgorithm || 'legacy',
      currentSelection: modal.checklistSelection,
      engineCtx: {
        aiConfig: currentProc.aiConfig,
        isBridgeConnected: bridgeClient.isConnected(),
        installedBridgeModelIds: modal.downloadedModelIds,
        isCloudReady: hasCloudImageProvider || Boolean(firstCloudProvider),
        cloudProviderLabel: hasCloudImageProvider ? cloudImageProviderName : firstCloudProvider,
        dspAlgorithm: currentProc.dspAlgorithm || 'legacy',
      },
    });

    const phases: Array<{ phase: 0 | 1 | 2 | 3; rows: PipelineStepDescriptor[] }> = [
      { phase: 0, rows: rows.filter((r) => r.phase === 0) },
      { phase: 1, rows: rows.filter((r) => r.phase === 1) },
      { phase: 2, rows: rows.filter((r) => r.phase === 2) },
      { phase: 3, rows: rows.filter((r) => r.phase === 3) },
    ];

    const phaseHtml = phases
      .map((p) => {
        const title = p.rows[0]?.phaseTitle ?? `FASE ${p.phase}`;
        const itemsHtml = p.rows
          .map((row) => {
            const stateClass = !row.enabled
              ? 'is-disabled'
              : row.mandatory
                ? 'is-mandatory'
                : row.checked
                  ? 'is-checked'
                  : '';
            return `
              <div class="pipeline-step-row ${stateClass}">
                <div class="pipeline-step-check-col">
                  ${
                    row.mandatory
                      ? `<span class="pipeline-mandatory-lock" title="Paso obligatorio para garantizar la integridad del modelo">${ICONS.lock}</span>`
                      : `<input type="checkbox" class="articulation-checkbox switch--sm chk-pipeline-step" data-step-id="${escAttr(row.id)}" ${row.checked ? 'checked' : ''} ${!row.enabled ? 'disabled' : ''} />`
                  }
                </div>
                <div class="pipeline-step-main-col">
                  <div class="pipeline-step-header-line">
                    <span class="pipeline-step-num">#${row.stepNumber}</span>
                    <strong class="pipeline-step-title">${escHtml(row.title)}</strong>
                    ${
                      row.conditionBadge
                        ? `<span class="pipeline-cond-badge ${row.mandatory ? 'is-mandatory' : !row.enabled ? 'is-disabled' : ''}">${escHtml(row.conditionBadge)}</span>`
                        : ''
                    }
                    ${
                      row.sampleLedgerBadge
                        ? `<span class="pipeline-ledger-badge" title="Estado de marcas por muestra (Sample Processing Ledger)">${ICONS.check} ${escHtml(row.sampleLedgerBadge)}</span>`
                        : ''
                    }
                  </div>
                  <p class="pipeline-step-desc">${escHtml(row.description)}</p>
                </div>
                <div class="pipeline-step-engine-col">
                  ${renderEngineBadgeHtml(modal, row)}
                </div>
              </div>
            `;
          })
          .join('');

        return `
          <div class="pipeline-phase-block">
            <div class="pipeline-phase-header">${escHtml(title)}</div>
            <div class="pipeline-phase-list">${itemsHtml}</div>
          </div>
        `;
      })
      .join('');

    const isEs = getAppLocale() === 'es';
    const isDrum = keyMode === 'drum';

    return `
      <div class="nmm-batch-card pipeline-checklist-card">
        <div class="pipeline-checklist-top">
          <div>
            <h3>${isEs ? 'Pipeline de Procesos y Motores de Ejecución (15 Pasos en Orden Canónico)' : 'Process Pipeline & Execution Engines (15 Steps in Canonical Order)'}</h3>
            <p class="nmm-batch-hint">
              ${isEs ? `Selecciona los procesos a ejecutar. Los pasos con candado (${ICONS.lock}) son obligatorios para el modo activo (<strong>${modal.context.getCurrentWorkingMode().toUpperCase()} · ${isDrum ? 'DRUM MAP' : 'CHROMATIC'}</strong>). Cada etiqueta muestra si el paso correrá con <strong>DSP Determinista</strong>, <strong>IA Local GPU</strong>, <strong>IA Cloud BYOK</strong> o <strong>Resinator 2 HD</strong>.` : `Select the processes to execute. Locked steps (${ICONS.lock}) are mandatory for the active mode (<strong>${modal.context.getCurrentWorkingMode().toUpperCase()} · ${isDrum ? 'DRUM MAP' : 'CHROMATIC'}</strong>). Each badge shows whether the step runs with <strong>Deterministic DSP</strong>, <strong>Local GPU AI</strong>, <strong>Cloud BYOK AI</strong>, or <strong>Resinator 2 HD</strong>.`}
            </p>
          </div>
          <div class="pipeline-checklist-actions">
            <button type="button" class="btn btn-outline btn--sm" id="btn-checklist-recommended">
              ${isEs ? 'Recomendados' : 'Recommended'}
            </button>
            <button type="button" class="btn btn-outline btn--sm" id="btn-checklist-all-audio">
              ${isEs ? 'Activar Todo Audio Pre-DSP' : 'Enable All Pre-DSP Audio'}
            </button>
            <button type="button" class="btn btn-ghost btn--sm" id="btn-checklist-open-ai-settings">
              ${ICONS.sparkle} ${isEs ? 'Configurar IA (8 Etapas)' : 'Configure AI (8 Stages)'}
            </button>
          </div>
        </div>

        <div class="pipeline-checklist-options-bar">
          <label class="batch-check">
            <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-skip-already-processed" ${modal.checklistSelection.skipAlreadyProcessedSamples !== false ? 'checked' : ''} />
            <span>${isEs ? 'Omitir procesos en muestras que ya tengan esa marca aplicada (Sample Processing Ledger)' : 'Skip processes on samples that already have that ledger flag applied (Sample Processing Ledger)'}</span>
          </label>
          ${
            isDrum
              ? `
          <label class="batch-check">
            <input type="checkbox" class="articulation-checkbox switch--sm" id="chk-normalize-group-drums" ${modal.checklistSelection.normalizeGroupRelativeForDrums !== false ? 'checked' : ''} />
            <span>${isEs ? 'Normalización relativa de grupo en Drum Maps (conservar mezcla entre bombo, caja y charles)' : 'Group-relative normalization in Drum Maps (preserve mix balance across kick, snare, and hi-hats)'}</span>
          </label>
          `
              : ''
          }
        </div>

        <div class="pipeline-phases-container">
          ${phaseHtml}
        </div>
      </div>
    `;
  }
