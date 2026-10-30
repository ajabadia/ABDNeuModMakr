/**
 * @file AboutDialog.js
 * @brief Modal de diálogo "About..." universal para la suite ABDSynths.
 * 
 * Proporciona:
 * - Identidad del sintetizador (nombre, subtítulo, descripción, build).
 * - Integración reactiva con el backend C++ ABDShared::AutoUpdater (vía WebView2).
 * - Fallback automático para modo Web/WASM (consulta a GitHub Releases API).
 * - Accesibilidad completa con contrato de foco e inert (OverlayFocus).
 */

import { createOverlayFocus } from '../OverlayFocus/index.js';

/**
 * @typedef {Object} AboutDialogOptions
 * @property {string} [id='abd-about-dialog'] ID del elemento modal en el DOM.
 * @property {string} appName Nombre del sintetizador (ej. 'ABD CZ-101', 'ABD MS2000').
 * @property {string} [subtitle='Phase Distortion Synthesizer — Native / Web']
 * @property {string} [description='Authentic DSP hardware emulator and modern expanded engine.']
 * @property {string} [version='1.0.0']
 * @property {string|number} [buildNumber]
 * @property {string} [repo='ajabadia/ABDSynths'] Repositorio de GitHub para release checks.
 * @property {string} [manualUrl] URL del manual o repositorio.
 * @property {Function} [getJuceBackend] Función que devuelve el backend JUCE si existe.
 * @property {Function} [onClose] Callback ejecutado al cerrar el modal.
 */

export class AboutDialog {
  constructor(options = {}) {
    this.options = {
      id: 'abd-about-dialog',
      appName: 'ABDAudioLab',
      category: 'ABD SYNTHS • HARDWARE PROFILING LAB',
      subtitle: 'Universal Hardware Profiling & DSP Synthesis Suite',
      description: 'Audio DSP Synthesizer Suite by ABD.',
      details: 'DSP Engine: Farina Sine Sweep • Wiener-Hammerstein LNL • SIMD Splines • NAM / RTNeural',
      copyright: '© 2026 ABD Synths',
      version: '2.1.0',
      buildNumber: '',
      buildDate: '',
      imageSrc: '',
      statusText: 'All Systems Nominal',
      repo: 'ajabadia/ABDSynths',
      manualUrl: 'https://github.com/ajabadia/ABDSynths',
      getJuceBackend: () => {
        if (typeof window !== 'undefined') {
          return window.getJuceBackend ? window.getJuceBackend() : ((window.__JUCE__ && window.__JUCE__.backend) || (window.Juce && window.Juce.backend));
        }
        return null;
      },
      ...options
    };

    this.rootEl = null;
    this.boxEl = null;
    this.statusEl = null;
    this.actionEl = null;
    this.downloadBtn = null;
    this.versionTextEl = null;
    this.focusContract = null;
    this.isChecking = false;

    this._mount();
    this._wireListeners();
  }

  _mount() {
    let existing = document.getElementById(this.options.id);
    if (existing) {
      this.rootEl = existing;
    } else {
      this.rootEl = document.createElement('div');
      this.rootEl.id = this.options.id;
      this.rootEl.className = 'modal-overlay abd-about-overlay';
      this.rootEl.setAttribute('role', 'dialog');
      this.rootEl.setAttribute('aria-modal', 'true');
      this.rootEl.setAttribute('aria-label', `About ${this.options.appName}`);
      this.rootEl.hidden = true;
      document.body.appendChild(this.rootEl);
    }

    const buildStr = this.options.buildNumber ? `Build ${this.options.buildNumber}` : '';
    const dateStr = this.options.buildDate ? `(${this.options.buildDate})` : '';
    const buildFull = [buildStr, dateStr].filter(Boolean).join(' ');
    const fullVer = this.options.version.startsWith('v') ? this.options.version : `v${this.options.version}`;
    const verLine = buildFull ? `${fullVer} • ${buildFull}` : fullVer;

    if (this.options.imageSrc) {
      // Diseño split con imagen de laboratorio analógico y tarjeta técnica (estilo SoundId / ABDAudioLab)
      this.rootEl.innerHTML = `
        <div class="modal-box abd-about-box abd-about-split">
          <div class="abd-about-media">
            <img src="${this.options.imageSrc}" alt="${this._escape(this.options.appName)}" class="abd-about-img" />
            <button type="button" class="abd-btn-about-close-icon abd-btn-about-close" aria-label="Cerrar diálogo" title="Cerrar">✕</button>
          </div>
          <div class="abd-about-content">
            ${this.options.category ? `<div class="abd-about-category">${this._escape(this.options.category)}</div>` : ''}
            <h3 class="abd-about-title">${this._escape(this.options.appName)}</h3>
            <p class="modal-sub abd-about-sub">${this._escape(this.options.subtitle)}</p>
            <p class="abd-about-version-line abd-about-version">${this._escape(verLine)}</p>
            ${this.options.details ? `<p class="abd-about-details">${this._escape(this.options.details)}</p>` : ''}
            <p class="abd-about-copyright">${this._escape(this.options.copyright)}</p>
            
            <div class="abd-about-footer-row">
              <button type="button" class="btn btn-sm abd-btn-check-updates">Check for Updates...</button>
              <span class="abd-about-status">${this._escape(this.options.statusText)}</span>
              <div class="abd-about-action" hidden>
                <a class="btn-glow btn-sm btn-update-avail abd-btn-download-update" href="#" target="_blank" rel="noopener noreferrer">DOWNLOAD UPDATE</a>
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      // Diseño modal estándar centrado (retrocompatible con sintetizadores individuales)
      this.rootEl.innerHTML = `
        <div class="modal-box abd-about-box">
          <h3 class="abd-about-title">${this._escape(this.options.appName)}</h3>
          <p class="modal-sub abd-about-sub">${this._escape(this.options.subtitle)}</p>
          <p class="abd-about-desc">${this._escape(this.options.description)}</p>
          <p class="abd-about-build">${buildStr}</p>
          
          <div class="about-update-section abd-about-update-section">
            <div class="about-update-row">
              <span class="about-update-label">Version:</span>
              <span class="about-update-val abd-about-version">${fullVer}</span>
              <button type="button" class="btn-glow btn-sm abd-btn-check-updates">CHECK FOR UPDATES</button>
            </div>
            <div class="about-update-status abd-about-status"></div>
            <div class="about-update-action abd-about-action" hidden>
              <a class="btn-glow btn-sm btn-update-avail abd-btn-download-update" href="#" target="_blank" rel="noopener noreferrer">DOWNLOAD UPDATE</a>
            </div>
          </div>

          <button type="button" class="btn-glow abd-btn-about-close">CLOSE</button>
        </div>
      `;
    }

    this.boxEl = this.rootEl.querySelector('.abd-about-box');
    this.statusEl = this.rootEl.querySelector('.abd-about-status');
    this.actionEl = this.rootEl.querySelector('.abd-about-action');
    this.downloadBtn = this.rootEl.querySelector('.abd-btn-download-update');
    this.versionTextEl = this.rootEl.querySelector('.abd-about-version');

    this.focusContract = createOverlayFocus({
      root: this.rootEl,
      body: this.boxEl,
      isClosed: () => this.rootEl.hidden,
      onEscape: () => this.close()
    });
    this.focusContract.attach();
    this.focusContract.setInert();
  }

  _wireListeners() {
    const closeBtns = this.rootEl.querySelectorAll('.abd-btn-about-close');
    closeBtns.forEach(btn => btn.addEventListener('click', () => this.close()));

    this.rootEl.addEventListener('click', (e) => {
      if (e.target === this.rootEl) this.close();
    });

    const checkBtn = this.rootEl.querySelector('.abd-btn-check-updates');
    checkBtn?.addEventListener('click', () => this.checkForUpdates());

    const backend = this.options.getJuceBackend?.();
    if (backend && typeof backend.addEventListener === 'function') {
      backend.addEventListener('updateCheckResult', (data) => {
        this.renderUpdateResult(data);
      });
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('updateCheckResult', (e) => {
        if (e.detail) this.renderUpdateResult(e.detail);
      });
    }
  }

  open(triggerEl = null) {
    if (triggerEl && this.focusContract) {
      this.focusContract.rememberTrigger(triggerEl);
    }
    this.rootEl.hidden = false;
    this.rootEl.classList.add('active', 'is-active');
    this.focusContract?.releaseInert();
    this.focusContract?.focusFirst();
    this.queryUpdateStatus();
  }

  close() {
    this.rootEl.classList.remove('active', 'is-active');
    this.rootEl.hidden = true;
    this.focusContract?.restoreFocus();
    this.focusContract?.setInert();
    if (typeof this.options.onClose === 'function') {
      this.options.onClose();
    }
  }

  queryUpdateStatus() {
    const backend = this.options.getJuceBackend?.();
    if (backend && typeof backend.getUpdateStatus === 'function') {
      try {
        const res = backend.getUpdateStatus();
        if (res && typeof res.then === 'function') {
          res.then(data => this.renderUpdateResult(data)).catch(() => {});
        } else if (res) {
          this.renderUpdateResult(res);
        }
      } catch (err) { /* ignore */ }
    }
  }

  checkForUpdates() {
    if (this.isChecking) return;
    this.isChecking = true;

    if (this.statusEl) {
      this.statusEl.className = 'about-update-status abd-about-status warning';
      this.statusEl.textContent = 'Checking for updates...';
    }
    if (this.actionEl) this.actionEl.hidden = true;

    const backend = this.options.getJuceBackend?.();
    if (backend && (typeof backend.checkForUpdates === 'function' || typeof backend.emitEvent === 'function')) {
      if (typeof backend.checkForUpdates === 'function') {
        backend.checkForUpdates();
      } else {
        backend.emitEvent('checkForUpdates', {});
      }
      setTimeout(() => { this.isChecking = false; }, 2000);
    } else {
      const apiUrl = `https://api.github.com/repos/${this.options.repo}/releases/latest`;
      fetch(apiUrl, { headers: { Accept: 'application/vnd.github.v3+json' } })
        .then(res => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
        .then(rel => {
          this.isChecking = false;
          const remoteTag = rel.tag_name || this.options.version;
          const isNewer = this._isNewerVersion(remoteTag, this.options.version);
          this.renderUpdateResult({
            currentVersion: this.options.version,
            latestVersion: remoteTag,
            isUpdateAvailable: isNewer,
            downloadUrl: rel.html_url || `https://github.com/${this.options.repo}/releases`
          });
        })
        .catch(() => {
          this.isChecking = false;
          this.renderUpdateResult({
            currentVersion: this.options.version,
            latestVersion: this.options.version,
            isUpdateAvailable: false
          });
        });
    }
  }

  renderUpdateResult(data) {
    if (!this.statusEl) return;
    const curVer = (data && data.currentVersion) || this.options.version;
    if (this.versionTextEl) {
      this.versionTextEl.textContent = curVer.startsWith('v') ? curVer : `v${curVer}`;
    }

    if (data && data.isUpdateAvailable) {
      this.statusEl.className = 'about-update-status abd-about-status success';
      this.statusEl.textContent = `New version available: ${data.latestVersion || 'latest'}`;
      if (this.actionEl && this.downloadBtn) {
        this.actionEl.hidden = false;
        this.downloadBtn.textContent = `DOWNLOAD ${data.latestVersion || 'UPDATE'}`;
        this.downloadBtn.href = data.downloadUrl || `https://github.com/${this.options.repo}/releases/latest`;
        this.downloadBtn.onclick = (e) => {
          const backend = this.options.getJuceBackend?.();
          if (backend && typeof backend.openBrowserUrl === 'function') {
            e.preventDefault();
            backend.openBrowserUrl(this.downloadBtn.href);
          } else if (backend && typeof backend.emitEvent === 'function') {
            backend.emitEvent('openBrowserUrl', this.downloadBtn.href);
          }
        };
      }
    } else {
      this.statusEl.className = 'about-update-status abd-about-status';
      this.statusEl.textContent = 'You are running the latest version.';
      if (this.actionEl) this.actionEl.hidden = true;
    }
  }

  _isNewerVersion(remote, local) {
    const parse = (v) => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const r = parse(remote);
    const l = parse(local);
    const len = Math.max(r.length, l.length);
    for (let i = 0; i < len; i++) {
      const rv = r[i] || 0;
      const lv = l[i] || 0;
      if (rv !== lv) return rv > lv;
    }
    return false;
  }

  _escape(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  destroy() {
    if (this.focusContract) {
      this.focusContract.detach();
    }
    if (this.rootEl && this.rootEl.parentNode) {
      this.rootEl.parentNode.removeChild(this.rootEl);
    }
  }
}

export function createAboutDialog(options) {
  return new AboutDialog(options);
}
