import type { SettingsModalContext } from './types';
import { DEFAULT_AXIONIK_DB_PATH, DEFAULT_BANK_PATH, DEFAULT_NEURON_DB_PATH, STORAGE_KEY_AXIONIK_DB_PATH, STORAGE_KEY_BANK_PATH, STORAGE_KEY_NEURON_DB_PATH } from './constants';
import { ICONS } from '../icons';
import { bridgeClient } from '../../core/bridge/BridgeClient';
import { getAppLocale, setAppLocale, tApp } from '../../core/i18n';
import { browseFilesystemFolder } from '../folderPicker';
import { escAttr } from '../escape';
import { escHtml } from '../escape';
import { toast } from '../notify';

export function renderGeneralTab(ctx: SettingsModalContext): string {
  const curFamily = ctx.handlers.getCurrentThemeFamily?.() ?? 'neuron';
  const curMode = ctx.handlers.getCurrentThemeMode?.() ?? 'light';
  const curLocale = ctx.handlers.getCurrentLocale?.() ?? getAppLocale();
  const es = curLocale === 'es';
  const savedAxionikDbPath = localStorage.getItem(STORAGE_KEY_AXIONIK_DB_PATH) || DEFAULT_AXIONIK_DB_PATH;
  const savedNeuronDbPath = localStorage.getItem(STORAGE_KEY_NEURON_DB_PATH) || DEFAULT_NEURON_DB_PATH;
  const savedBankPath = localStorage.getItem(STORAGE_KEY_BANK_PATH) || DEFAULT_BANK_PATH;
  const isBridgeOnline = bridgeClient.isConnected();

  const skinFamilies = [
    { id: 'neuron', name: 'Hartmann Neuron', desc: es ? 'Hardware original (2002), knobs grises y pantalla OLED azul' : 'Original hardware (2002), gray knobs and blue OLED display' },
    { id: 'virus-snow', name: 'Access Virus Snow', desc: es ? 'Estética de módulo de escritorio blanco (2008)' : 'Pristine white desktop module aesthetics (2008)' },
    { id: 'audiolab', name: 'AudioLab Precision', desc: es ? 'Laboratorio clínico de inspección de audio de alto contraste' : 'Clinical high-contrast audio inspection lab' },
    { id: 'ms2000', name: 'Korg MS2000', desc: es ? 'Panel retro azul petróleo de modelado analógico' : 'Retro teal analog-modeling physical synthesizer panel' },
    { id: 'advanced', name: 'Hartmann Advanced', desc: es ? 'Edición especial expandida con acentos ámbar cálidos' : 'Expanded special edition with warm amber accents' },
    { id: 'cz101', name: 'Casio CZ-101', desc: es ? 'Panel clásico de distorsión de fase (1984)' : 'Classic phase-distortion synthesizer panel (1984)' },
  ];

  return `
    <div class="settings-general-container">
      <!-- 1. Appearance & Hardware Skin -->
      <div class="settings-section-card">
        <div class="settings-card-header">
          <h4>${ICONS.palette} ${es ? 'Skin de Sintetizador Hardware y Tema' : 'Hardware Synthesizer Skin &amp; Theme'}</h4>
          <span class="text-muted">${es ? 'Personaliza la estética de la aplicación inspirada en hardware legendario.' : 'Personalize the application aesthetic inspired by legendary hardware.'}</span>
        </div>
        <div class="settings-skins-grid">
          ${skinFamilies
            .map(
              (s) => `
            <label class="settings-skin-opt ${curFamily === s.id ? 'is-selected' : ''}" title="${escAttr(s.desc)}">
              <input type="radio" name="opt-theme-family" value="${s.id}" ${curFamily === s.id ? 'checked' : ''} />
              <div class="skin-opt-body">
                <strong>${escHtml(s.name)}</strong>
              </div>
            </label>
          `
            )
            .join('')}
        </div>

        <div class="settings-appearance-mode-row">
          <span class="settings-sublabel">${es ? 'Modo de Apariencia:' : 'Appearance Mode:'}</span>
          <div class="mode-pill-toggle">
            <button type="button" class="btn btn-sm ${curMode === 'light' ? 'btn-primary' : 'btn-outline'}" id="btn-set-mode-light">
              ${ICONS.sun} ${es ? 'Modo Claro' : 'Light Mode'}
            </button>
            <button type="button" class="btn btn-sm ${curMode === 'dark' ? 'btn-primary' : 'btn-outline'}" id="btn-set-mode-dark">
              ${ICONS.moon} ${es ? 'Modo Oscuro' : 'Dark Mode'}
            </button>
          </div>
        </div>

        <div class="settings-appearance-mode-row">
          <span class="settings-sublabel">${escHtml(tApp('settings.languageSublabel'))}</span>
          <div class="mode-pill-toggle" role="group" aria-label="Interface Language">
            <button type="button" class="btn btn-sm ${curLocale === 'es' ? 'btn-primary' : 'btn-outline'}" id="btn-set-lang-es" aria-pressed="${curLocale === 'es'}">
              ${ICONS.flagEs} Español (ES)
            </button>
            <button type="button" class="btn btn-sm ${curLocale === 'en' ? 'btn-primary' : 'btn-outline'}" id="btn-set-lang-en" aria-pressed="${curLocale === 'en'}">
              ${ICONS.flagEn} English (EN)
            </button>
          </div>
        </div>
      </div>

      <!-- 2. Local Library Folders -->
      <div class="settings-section-card">
        <div class="settings-card-header">
          <h4>${ICONS.folder} ${es ? 'Carpetas de Librería Local (AxionikDB, NeuronDB y Muestras)' : 'Local Library Folders (AxionikDB, NeuronDB &amp; Samples)'}</h4>
          <span class="text-muted">${es ? 'Configura las rutas a tus librerías locales para sincronizar con el Companion Bridge.' : 'Configure paths to your local libraries to synchronize with the Companion Bridge.'}</span>
        </div>

        <div class="settings-libraries-container">
          <!-- 1. AxionikDB (Advanced Mode) -->
          <div class="card card--tight library-path-card">
            <div class="library-path-header">
              <strong>${es ? 'Librería AxionikDB (Avanzado / Cápsula del Tiempo)' : 'AxionikDB Library (Advanced / Time-Capsule)'} <span class="cond-reason-badge is-extended-only">${es ? 'MODO EXTENDIDO' : 'EXTENDED MODE'}</span></strong>
              <span class="text-muted">${es ? 'Modelos con slugs semánticos y Cápsulas del Tiempo autocontenidas (<code>manifest.json</code> + <code>cover.webp</code>).' : 'Models with semantic slugs and self-contained Time Capsules (<code>manifest.json</code> + <code>cover.webp</code>).'}</span>
            </div>
            <div class="bank-path-input-wrap">
              <input type="text" id="input-axionikdb-path" class="form-control" value="${escAttr(savedAxionikDbPath)}" placeholder="${escAttr(DEFAULT_AXIONIK_DB_PATH)}" />
              <button type="button" class="btn btn-outline" id="btn-browse-axionikdb-dir" title="${es ? 'Navegar por el sistema de archivos para seleccionar la carpeta AxionikDB' : 'Browse filesystem to select the AxionikDB folder'}">
                ${ICONS.folder} ${es ? 'Examinar...' : 'Browse...'}
              </button>
              <button type="button" class="btn btn-primary" id="btn-scan-axionikdb-dir" ${isBridgeOnline ? '' : `disabled title="${es ? 'Requiere Companion Bridge activo (bridge/server.py)' : 'Requires active Companion Bridge (bridge/server.py)'}"`}>
                ${ICONS.search} ${ctx.state.isScanningAxionik ? (es ? 'Escaneando...' : 'Scanning...') : (es ? 'Escanear AxionikDB' : 'Scan AxionikDB')} ${!isBridgeOnline ? `<span class="cond-reason-badge">${es ? 'BRIDGE DESCONECTADO' : 'BRIDGE OFFLINE'}</span>` : ''}
              </button>
            </div>
          </div>

          <!-- 2. NeuronDB (Classic Mode) -->
          <div class="card card--tight stack-gap library-path-card">
            <div class="library-path-header">
              <strong>${es ? 'Librería NeuronDB (Clásico / Hartmann 000..511)' : 'NeuronDB Library (Classic / Hartmann 000..511)'} <span class="cond-reason-badge is-classic-only">${es ? 'MODO CLÁSICO' : 'CLASSIC MODE'}</span></strong>
              <span class="text-muted">${es ? 'Bancos compatibles con hardware Hartmann Neuron y software clásico.' : 'Banks compatible with Hartmann Neuron hardware &amp; classic software.'}</span>
            </div>
            <div class="bank-path-input-wrap">
              <input type="text" id="input-neurondb-path" class="form-control" value="${escAttr(savedNeuronDbPath)}" placeholder="${escAttr(DEFAULT_NEURON_DB_PATH)}" />
              <button type="button" class="btn btn-outline" id="btn-browse-neurondb-dir" title="${es ? 'Navegar por el sistema de archivos para seleccionar la carpeta NeuronDB' : 'Browse filesystem to select the NeuronDB folder'}">
                ${ICONS.folder} ${es ? 'Examinar...' : 'Browse...'}
              </button>
              <button type="button" class="btn btn-outline" id="btn-scan-neurondb-dir" ${isBridgeOnline ? '' : `disabled title="${es ? 'Requiere Companion Bridge activo (bridge/server.py)' : 'Requires active Companion Bridge (bridge/server.py)'}"`}>
                ${ICONS.search} ${ctx.state.isScanningNeuronDb ? (es ? 'Escaneando...' : 'Scanning...') : (es ? 'Escanear NeuronDB' : 'Scan NeuronDB')} ${!isBridgeOnline ? `<span class="cond-reason-badge">${es ? 'BRIDGE DESCONECTADO' : 'BRIDGE OFFLINE'}</span>` : ''}
              </button>
            </div>
          </div>

          <!-- 3. SoundFonts / Raw Samples -->
          <div class="card card--tight stack-gap library-path-card">
            <div class="library-path-header">
              <strong>${es ? 'Colección de SoundFonts y Muestras Raw' : 'SoundFonts &amp; Raw Sample Collection'}</strong>
              <span class="text-muted">${es ? 'Fuentes de audio acústicas (.sf2, .sfz, .wav) para importación directa.' : 'Acoustic audio sources (.sf2, .sfz, .wav) for direct sample import.'}</span>
            </div>
            <div class="bank-path-input-wrap">
              <input type="text" id="input-bank-path" class="form-control" value="${escAttr(savedBankPath)}" placeholder="${escAttr(DEFAULT_BANK_PATH)}" />
              <button type="button" class="btn btn-outline" id="btn-browse-bank-dir" title="${es ? 'Navegar por el sistema de archivos para seleccionar la carpeta de muestras / SoundFonts' : 'Browse filesystem to select the samples / SoundFonts folder'}">
                ${ICONS.folder} ${es ? 'Examinar...' : 'Browse...'}
              </button>
              <button type="button" class="btn btn-outline" id="btn-scan-bank-dir" ${isBridgeOnline ? '' : `disabled title="${es ? 'Requiere Companion Bridge activo (bridge/server.py)' : 'Requires active Companion Bridge (bridge/server.py)'}"`}>
                ${ICONS.search} ${ctx.state.isScanning ? (es ? 'Escaneando...' : 'Scanning...') : (es ? 'Escanear Muestras' : 'Scan Samples')} ${!isBridgeOnline ? `<span class="cond-reason-badge">${es ? 'BRIDGE DESCONECTADO' : 'BRIDGE OFFLINE'}</span>` : ''}
              </button>
            </div>
          </div>

          ${
            !isBridgeOnline
              ? `<p class="bank-bridge-offline-hint text-muted cfg-gap-top">
                  ${es ? 'Para escanear directorios locales sin restricciones del navegador, inicia el Companion Bridge (<code>bridge/server.py</code>).' : 'To scan local directories without browser sandbox restrictions, launch the Companion Bridge (<code>bridge/server.py</code>).'}
                </p>`
              : ''
          }
        </div>

        <!-- Scan Results Area -->
        <div id="settings-scan-results-wrap" class="settings-scan-results-wrap">
          ${buildScanResultsHtml(ctx)}
        </div>
      </div>

      <!-- 4. Storage Quota & Offline Persistence -->
      <div class="settings-section-card">
        <div class="settings-card-header">
          <h4>${ICONS.database} ${es ? 'Almacenamiento Offline y Cuota IndexedDB' : 'Offline Storage &amp; IndexedDB Quota'}</h4>
          <span class="text-muted">${es ? 'Almacenamiento persistente del navegador para buffers de audio, cápsulas del tiempo y modelos.' : 'Persistent browser storage for audio buffers, time capsules, and models.'}</span>
        </div>
        <div class="settings-storage-row">
          ${
            ctx.state.storageEstimate
              ? `
            <div class="storage-estimate-box ${ctx.state.storageEstimate.percent > 80 ? 'is-warning' : ''}">
              <div class="storage-text">
                <strong>${es ? 'Almacenamiento IndexedDB:' : 'IndexedDB Storage:'}</strong>
                <span>${(ctx.state.storageEstimate.usage / (1024 * 1024)).toFixed(1)} MB ${es ? 'usados de' : 'used of'} ${(ctx.state.storageEstimate.quota / (1024 * 1024 * 1024)).toFixed(1)} GB ${es ? 'disponibles' : 'available'} (${ctx.state.storageEstimate.percent}%)</span>
              </div>
              ${
                ctx.state.storageEstimate.percent > 80
                  ? `<span class="panel-badge badge-warning">${es ? 'Uso Alto (>80%)' : 'High Storage Usage (>80%)'}</span>`
                  : `<span class="panel-badge badge-success">${es ? 'Almacenamiento Óptimo' : 'Storage Healthy'}</span>`
              }
            </div>
          `
              : `
            <div class="storage-estimate-box">
              <span class="text-muted">${es ? 'Estimación de cuota disponible en sesiones estándar de navegador.' : 'Storage quota estimation available in standard browser sessions.'}</span>
            </div>
          `
          }
        </div>
      </div>
    </div>
  `;
}

export function buildScanResultsHtml(ctx: SettingsModalContext): string {
  if (ctx.state.axionikScanResults && ctx.state.axionikScanResults.length > 0) {
    return `
      <div class="scan-summary-card">
        <div class="scan-summary-header">
          <strong>Models detected in AxionikDB:</strong>
          <span class="panel-badge badge-success">${ctx.state.axionikScanResults.length} models</span>
        </div>
        <div class="scan-files-list">
          ${ctx.state.axionikScanResults
            .slice(0, 30)
            .map(
              (m) => `
            <div class="scan-file-row">
              <span class="scan-file-name"><strong>${escHtml(m.name)}</strong> <small class="text-muted">(${escHtml(m.slug)})</small></span>
              <span class="scan-file-size text-muted">${escHtml(m.category)} &bull; Set ${m.parameterSet} &bull; ${m.zoneCount} zones</span>
              <span class="scan-file-ext">${m.hasCover ? 'Cover OK' : 'No cover'}</span>
            </div>
          `
            )
            .join('')}
          ${
            ctx.state.axionikScanResults.length > 30
              ? `<div class="scan-more text-muted">+${ctx.state.axionikScanResults.length - 30} additional models available in Bank Browser.</div>`
              : ''
          }
        </div>
      </div>
    `;
  }

  if (ctx.state.neuronDbScanResults) {
    return `
      <div class="scan-summary-card">
        <div class="scan-summary-header">
          <strong>Files found in NeuronDB (<code>${escHtml(ctx.state.neuronDbScanResults.scanned_path)}</code>):</strong>
          <span class="panel-badge badge-success">${ctx.state.neuronDbScanResults.total_files} files</span>
        </div>
        <div class="scan-files-list">
          ${ctx.state.neuronDbScanResults.files
            .slice(0, 30)
            .map(
              (f) => `
            <div class="scan-file-row">
              <span class="scan-file-name">${escHtml(f.name)}</span>
              <span class="scan-file-size text-muted">${Math.round(f.size / 1024)} KB</span>
              <span class="scan-file-ext">${escHtml(f.ext)}</span>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;
  }

  if (!ctx.state.scanResults) return '';
  return `
    <div class="scan-summary-card">
      <div class="scan-summary-header">
        <strong>Files found in <code>${escHtml(ctx.state.scanResults.scanned_path)}</code>:</strong>
        <span class="panel-badge badge-success">${ctx.state.scanResults.total_files} files</span>
      </div>
      <div class="scan-files-list">
        ${ctx.state.scanResults.files
          .slice(0, 30)
          .map(
            (f) => `
          <div class="scan-file-row">
            <span class="scan-file-name">${escHtml(f.name)}</span>
            <span class="scan-file-size text-muted">${Math.round(f.size / 1024)} KB</span>
            <span class="scan-file-ext">${escHtml(f.ext)}</span>
          </div>
        `
          )
          .join('')}
        ${
          ctx.state.scanResults.total_files > 30
            ? `<div class="scan-more text-muted">+${ctx.state.scanResults.total_files - 30} additional files available in Bank Browser.</div>`
            : ''
        }
      </div>
    </div>
  `;
}

export function bindGeneralTabEvents(ctx: SettingsModalContext): void {
  if (!ctx.state.backdropEl) return;

  // Theme family radio
  ctx.state.backdropEl.querySelectorAll<HTMLInputElement>('input[name="opt-theme-family"]').forEach((r) => {
    r.addEventListener('change', () => {
      if (r.checked) {
        ctx.handlers.onSelectThemeFamily(r.value);
        ctx.rerender();
      }
    });
  });

  // Appearance mode pills
  ctx.state.backdropEl.querySelector('#btn-set-mode-light')?.addEventListener('click', () => {
    ctx.handlers.onSetThemeMode('light');
    ctx.rerender();
  });
  ctx.state.backdropEl.querySelector('#btn-set-mode-dark')?.addEventListener('click', () => {
    ctx.handlers.onSetThemeMode('dark');
    ctx.rerender();
  });

  // Language / Idioma pills (ES / EN, synchronized with @abdsynths/shared/i18n)
  ctx.state.backdropEl.querySelector('#btn-set-lang-es')?.addEventListener('click', () => {
    setAppLocale('es');
    ctx.handlers.onSetLocale?.('es');
    ctx.rerender();
    toast(tApp('settings.langChangedToast'), 'info');
  });
  ctx.state.backdropEl.querySelector('#btn-set-lang-en')?.addEventListener('click', () => {
    setAppLocale('en');
    ctx.handlers.onSetLocale?.('en');
    ctx.rerender();
    toast(tApp('settings.langChangedToast'), 'info');
  });

  // AxionikDB path browse & scan
  const axionikPathInput = ctx.state.backdropEl.querySelector<HTMLInputElement>('#input-axionikdb-path');
  axionikPathInput?.addEventListener('change', () => {
    localStorage.setItem(STORAGE_KEY_AXIONIK_DB_PATH, axionikPathInput.value.trim());
  });
  ctx.state.backdropEl.querySelector('#btn-browse-axionikdb-dir')?.addEventListener('click', async () => {
    const picked = await browseFilesystemFolder({
      initialPath: axionikPathInput?.value.trim() || DEFAULT_AXIONIK_DB_PATH,
      title: 'Seleccionar carpeta AxionikDB Library',
    });
    if (picked && axionikPathInput) {
      axionikPathInput.value = picked;
      localStorage.setItem(STORAGE_KEY_AXIONIK_DB_PATH, picked);
      toast(`Carpeta AxionikDB seleccionada: ${picked}`, 'info');
    }
  });
  ctx.state.backdropEl.querySelector('#btn-scan-axionikdb-dir')?.addEventListener('click', async () => {
    const p = axionikPathInput?.value.trim() || DEFAULT_AXIONIK_DB_PATH;
    localStorage.setItem(STORAGE_KEY_AXIONIK_DB_PATH, p);
    ctx.state.isScanningAxionik = true;
    ctx.rerender();
    try {
      ctx.state.axionikScanResults = await bridgeClient.scanAxionikDb(p);
      toast(`AxionikDB scanned: ${ctx.state.axionikScanResults.length} models found`, 'success');
    } catch (err) {
      toast(`Error scanning AxionikDB: ${String(err)}`, 'error');
    } finally {
      ctx.state.isScanningAxionik = false;
      ctx.rerender();
    }
  });

  // NeuronDB path browse & scan
  const neuronDbPathInput = ctx.state.backdropEl.querySelector<HTMLInputElement>('#input-neurondb-path');
  neuronDbPathInput?.addEventListener('change', () => {
    localStorage.setItem(STORAGE_KEY_NEURON_DB_PATH, neuronDbPathInput.value.trim());
  });
  ctx.state.backdropEl.querySelector('#btn-browse-neurondb-dir')?.addEventListener('click', async () => {
    const picked = await browseFilesystemFolder({
      initialPath: neuronDbPathInput?.value.trim() || DEFAULT_NEURON_DB_PATH,
      title: 'Seleccionar carpeta NeuronDB Library',
    });
    if (picked && neuronDbPathInput) {
      neuronDbPathInput.value = picked;
      localStorage.setItem(STORAGE_KEY_NEURON_DB_PATH, picked);
      toast(`Carpeta NeuronDB seleccionada: ${picked}`, 'info');
    }
  });
  ctx.state.backdropEl.querySelector('#btn-scan-neurondb-dir')?.addEventListener('click', async () => {
    const p = neuronDbPathInput?.value.trim() || DEFAULT_NEURON_DB_PATH;
    localStorage.setItem(STORAGE_KEY_NEURON_DB_PATH, p);
    ctx.state.isScanningNeuronDb = true;
    ctx.rerender();
    try {
      ctx.state.neuronDbScanResults = await bridgeClient.scanLocalFiles(p);
      toast(`NeuronDB scanned: ${ctx.state.neuronDbScanResults.total_files} files found`, 'success');
    } catch (err) {
      toast(`Error scanning NeuronDB: ${String(err)}`, 'error');
    } finally {
      ctx.state.isScanningNeuronDb = false;
      ctx.rerender();
    }
  });

  // Soundfonts / Raw Bank path browse & scan
  const pathInput = ctx.state.backdropEl.querySelector<HTMLInputElement>('#input-bank-path');
  pathInput?.addEventListener('change', () => {
    localStorage.setItem(STORAGE_KEY_BANK_PATH, pathInput.value.trim());
  });
  ctx.state.backdropEl.querySelector('#btn-browse-bank-dir')?.addEventListener('click', async () => {
    const picked = await browseFilesystemFolder({
      initialPath: pathInput?.value.trim() || DEFAULT_BANK_PATH,
      title: 'Seleccionar carpeta de SoundFonts y Muestras',
    });
    if (picked && pathInput) {
      pathInput.value = picked;
      localStorage.setItem(STORAGE_KEY_BANK_PATH, picked);
      toast(`Carpeta de muestras seleccionada: ${picked}`, 'info');
    }
  });

  ctx.state.backdropEl.querySelector('#btn-scan-bank-dir')?.addEventListener('click', async () => {
    const p = pathInput?.value.trim() || DEFAULT_BANK_PATH;
    localStorage.setItem(STORAGE_KEY_BANK_PATH, p);
    ctx.state.isScanning = true;
    ctx.rerender();
    try {
      ctx.state.scanResults = await bridgeClient.scanLocalFiles(p);
      toast(`Scan complete: ${ctx.state.scanResults.total_files} files found`, 'success');
    } catch (err) {
      toast(`Error scanning directory: ${String(err)}`, 'error');
    } finally {
      ctx.state.isScanning = false;
      ctx.rerender();
    }
  });
}
