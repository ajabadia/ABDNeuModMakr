/**
 * @file aboutDialog.js
 * @brief Modal de diálogo "About..." universal para la suite ABDSynths (bilingüe EN / ES).
 * 
 * Proporciona:
 * - Identidad del sintetizador (nombre, subtítulo, descripción, build).
 * - Integración reactiva con el backend C++ ABDShared::AutoUpdater (vía WebView2).
 * - Fallback automático para modo Web/WASM (consulta a GitHub Releases API).
 * - Accesibilidad completa con contrato de foco e inert (overlayFocus.js).
 * - Internacionalización reactiva (EN / ES) sincronizada con `abdsynths.locale` y `abd:locale-change`.
 */

import { createOverlayFocus } from './overlayFocus.js';
import { SHARED_EN } from './I18n/locales/en.js';
import { SHARED_ES } from './I18n/locales/es.js';

function resolveAboutLocale(explicitLocale) {
  if (explicitLocale === 'es' || explicitLocale === 'en') return explicitLocale;
  try {
    if (typeof localStorage !== 'undefined') {
      const saved =
        localStorage.getItem('abdsynths.locale') ||
        localStorage.getItem('abd_locale') ||
        localStorage.getItem('neumodmakr.locale');
      if (saved === 'es' || saved === 'en') return saved;
    }
    if (typeof document !== 'undefined' && document.documentElement?.lang) {
      const docLang = document.documentElement.lang.slice(0, 2).toLowerCase();
      if (docLang === 'es' || docLang === 'en') return docLang;
    }
  } catch {
    // Ignore storage errors
  }
  return 'en';
}

/**
 * @typedef {Object} AboutDialogOptions
 * @property {string} [id='abd-about-dialog'] ID del elemento modal en el DOM.
 * @property {string} appName Nombre del sintetizador (ej. 'ABD CZ-101', 'ABD MS2000').
 * @property {string} [subtitle='Phase Distortion Synthesizer — Native / Web']
 * @property {string} [subtitleEs] Subtítulo opcional en español.
 * @property {string} [description='Authentic DSP hardware emulator and modern expanded engine.']
 * @property {string} [descriptionEs] Descripción opcional en español.
 * @property {string} [version='1.0.0']
 * @property {string|number} [buildNumber]
 * @property {string} [repo='ajabadia/ABDSynths'] Repositorio de GitHub para release checks.
 * @property {string} [manualUrl] URL del manual o repositorio.
 * @property {string} [locale] Idioma inicial opcional ('en' | 'es').
 * @property {Function} [getJuceBackend] Función que devuelve el backend JUCE si existe.
 * @property {Function} [onClose] Callback ejecutado al cerrar el modal.
 */

export class AboutDialog {
  constructor(options = {}) {
    this.options = {
      id: 'abd-about-dialog',
      appName: 'ABDSynth',
      subtitle: 'Virtual Instrument Synthesizer',
      subtitleEs: 'Sintetizador de Instrumento Virtual',
      description: 'Audio DSP Synthesizer Suite by ABD.',
      descriptionEs: 'Suite de Sintetizadores DSP de Audio por ABD.',
      version: '1.0.0',
      buildNumber: '',
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
    this.lastUpdateData = null;
    this._boundOnLocaleChange = (e) => {
      const nextLocale = e?.detail?.locale;
      this.setLocale(nextLocale);
    };

    this._mount();
    this._wireListeners();
  }

  _getDict() {
    const lang = resolveAboutLocale(this.options.locale);
    return lang === 'es' ? SHARED_ES.aboutDialog : SHARED_EN.aboutDialog;
  }

  _isEs() {
    return resolveAboutLocale(this.options.locale) === 'es';
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

    const dict = this._getDict();
    const isEs = this._isEs();
    const subtitle = isEs && this.options.subtitleEs ? this.options.subtitleEs : this.options.subtitle;
    const description = isEs && this.options.descriptionEs ? this.options.descriptionEs : this.options.description;
    const buildStr = this.options.buildNumber ? `${dict.buildPrefix}${this.options.buildNumber}` : '';
    const fullVer = this.options.version.startsWith('v') ? this.options.version : `v${this.options.version}`;

    this.rootEl.innerHTML = `
      <div class="modal-box abd-about-box">
        <h3 class="abd-about-title">${this._escape(this.options.appName)}</h3>
        <p class="modal-sub abd-about-sub">${this._escape(subtitle)}</p>
        <p class="abd-about-desc">${this._escape(description)}</p>
        <p class="abd-about-build">${this._escape(buildStr)}</p>
        
        <div class="about-update-section abd-about-update-section">
          <div class="about-update-row">
            <span class="about-update-label">${this._escape(dict.versionLabel)}</span>
            <span class="about-update-val abd-about-version">${fullVer}</span>
            <button type="button" class="btn-glow btn-sm abd-btn-check-updates">${this._escape(dict.checkForUpdates)}</button>
          </div>
          <div class="about-update-status abd-about-status"></div>
          <div class="about-update-action abd-about-action" hidden>
            <a class="btn-glow btn-sm btn-update-avail abd-btn-download-update" href="#" target="_blank" rel="noopener noreferrer">${this._escape(dict.downloadUpdate)}</a>
          </div>
        </div>

        <button type="button" class="btn-glow abd-btn-about-close">${this._escape(dict.close)}</button>
      </div>
    `;

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

  setLocale(locale) {
    if (locale === 'es' || locale === 'en') {
      this.options.locale = locale;
    } else {
      delete this.options.locale;
    }
    if (!this.rootEl) return;
    const dict = this._getDict();
    const isEs = this._isEs();
    const subEl = this.rootEl.querySelector('.abd-about-sub');
    const descEl = this.rootEl.querySelector('.abd-about-desc');
    const buildEl = this.rootEl.querySelector('.abd-about-build');
    const verLabelEl = this.rootEl.querySelector('.about-update-label');
    const checkBtn = this.rootEl.querySelector('.abd-btn-check-updates');
    const closeBtn = this.rootEl.querySelector('.abd-btn-about-close');

    if (subEl) subEl.textContent = isEs && this.options.subtitleEs ? this.options.subtitleEs : this.options.subtitle;
    if (descEl) descEl.textContent = isEs && this.options.descriptionEs ? this.options.descriptionEs : this.options.description;
    if (buildEl) buildEl.textContent = this.options.buildNumber ? `${dict.buildPrefix}${this.options.buildNumber}` : '';
    if (verLabelEl) verLabelEl.textContent = dict.versionLabel;
    if (checkBtn) checkBtn.textContent = dict.checkForUpdates;
    if (closeBtn) closeBtn.textContent = dict.close;

    if (this.isChecking && this.statusEl) {
      this.statusEl.textContent = dict.checkingUpdates;
    } else if (this.lastUpdateData) {
      this.renderUpdateResult(this.lastUpdateData);
    }
  }

  _wireListeners() {
    const closeBtn = this.rootEl.querySelector('.abd-btn-about-close');
    closeBtn?.addEventListener('click', () => this.close());

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
      window.addEventListener('abd:locale-change', this._boundOnLocaleChange);
    }
  }

  open(triggerEl = null) {
    this.setLocale(this.options.locale);
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
    const dict = this._getDict();

    if (this.statusEl) {
      this.statusEl.className = 'about-update-status abd-about-status warning';
      this.statusEl.textContent = dict.checkingUpdates;
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
      // Fallback HTTP en navegador / Web
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
    this.lastUpdateData = data;
    if (!this.statusEl) return;
    const dict = this._getDict();
    const curVer = (data && data.currentVersion) || this.options.version;
    if (this.versionTextEl) {
      this.versionTextEl.textContent = curVer.startsWith('v') ? curVer : `v${curVer}`;
    }

    if (data && data.isUpdateAvailable) {
      const latestVer = data.latestVersion || 'latest';
      this.statusEl.className = 'about-update-status abd-about-status success';
      this.statusEl.textContent = dict.newVersionAvailable.replace('{version}', latestVer);
      if (this.actionEl && this.downloadBtn) {
        this.actionEl.hidden = false;
        this.downloadBtn.textContent = dict.downloadVersion.replace('{version}', latestVer);
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
      this.statusEl.textContent = dict.upToDate;
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
    if (typeof window !== 'undefined') {
      window.removeEventListener('abd:locale-change', this._boundOnLocaleChange);
    }
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
