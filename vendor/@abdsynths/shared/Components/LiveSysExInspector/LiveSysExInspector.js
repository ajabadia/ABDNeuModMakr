/**
 * LiveSysExInspector — Inspector reactivo de tramas MIDI SysEx en vivo.
 * =========================================================================
 * Componente transversal y desacoplable para la suite de sintetizadores ABD
 * (ABDCZ101, ABDMS2000, ABDEep, Mz950, etc.).
 *
 * Características:
 *  - Reactivo al Edit Buffer activo / volcado SysEx.
 *  - Resaltado micro-animado de mutaciones byte a byte (pulse highlight).
 *  - Comparación diferencial Diff A/B con conteo de discrepancias.
 *  - Exportación directa de archivo binario .syx.
 *  - Copia rápida al portapapeles (Hex string o Array literal).
 *  - Desglose semántico de cabecera MIDI (Manufacturer, Device ID, Model, EOX).
 *  - Soporte flotante (arrastrable / desacoplable) o incrustado en contenedor.
 */

/**
 * Convierte un byte a su representación hexadecimal de dos caracteres en mayúsculas.
 * @param {number} byte
 * @returns {string}
 */
export function toHexByte(byte) {
  return (byte & 0xff).toString(16).padStart(2, '0').toUpperCase();
}

/**
 * Decodifica metadatos básicos de una cabecera SysEx estándar.
 * @param {Uint8Array} buf
 * @returns {object}
 */
export function decodeSysExHeader(buf) {
  if (!buf || buf.length < 2 || buf[0] !== 0xf0) {
    return { valid: false, manufacturer: 'Unknown', deviceId: null, model: null };
  }

  let mfgId = 'Unknown';
  let deviceId = null;
  let model = null;

  // Fabricantes comunes de sintetizadores clásicos
  if (buf[1] === 0x44) {
    mfgId = 'Casio (0x44)';
    if (buf.length >= 5 && buf[2] === 0x01 && buf[4] === 0x70) {
      model = 'CZ-Series';
    }
  } else if (buf[1] === 0x42) {
    mfgId = 'Korg (0x42)';
    if (buf.length >= 4 && (buf[3] === 0x58 || (buf.length >= 5 && buf[4] === 0x58))) {
      model = 'MS2000';
    }
  } else if (buf[1] === 0x41) {
    mfgId = 'Roland (0x41)';
  } else if (buf[1] === 0x43) {
    mfgId = 'Yamaha (0x43)';
  } else if (buf[1] === 0x00 && buf.length >= 4 && buf[2] === 0x20 && buf[3] === 0x32) {
    mfgId = 'Behringer (0x00 0x20 0x32)';
    model = 'DeepMind';
  } else if (buf[1] === 0x00 && buf.length >= 4 && buf[2] === 0x20 && buf[3] === 0x50) {
    mfgId = 'Hartmann GmbH (0x00 0x20 0x50)';
    model = buf.length >= 5 && buf[4] === 0x01 ? 'Neuron / NeuronVS' : 'Neuron';
    if (buf.length >= 6) {
      deviceId = `0x${toHexByte(buf[5])}`;
    }
  }

  if (!deviceId && buf.length >= 3) {
    deviceId = `0x${toHexByte(buf[2])}`;
  }

  return {
    valid: true,
    manufacturer: mfgId,
    deviceId,
    model,
    size: buf.length,
    hasEox: buf[buf.length - 1] === 0xf7,
  };
}

export class LiveSysExInspector {
  /**
   * @param {object} options
   * @param {HTMLElement} [options.container]    Contenedor donde incrustarse.
   * @param {string}      [options.title]        Título superior.
   * @param {string}      [options.subtitle]     Subtítulo descriptivo opcional.
   * @param {boolean}     [options.floating]     Si se monta como ventana flotante.
   * @param {number}      [options.bytesPerRow]  Bytes por fila en la vista hex (8 o 16, default 16).
   * @param {Uint8Array}  [options.initialBuffer] Buffer inicial.
   * @param {Function}    [options.onExport]     Callback al exportar (blob, filename).
   * @param {Function}    [options.onClose]      Callback al cerrar u ocultar.
   * @param {Function}    [options.onOpen]       Callback al abrir o mostrar.
   */
  constructor(options = {}) {
    this.options = {
      title: 'Live SysEx Inspector',
      subtitle: '',
      floating: false,
      bytesPerRow: 16,
      ...options,
    };

    this.container = options.container || null;
    this.buffer = options.initialBuffer ? new Uint8Array(options.initialBuffer) : new Uint8Array(0);
    this.prevBuffer = options.initialBuffer ? new Uint8Array(options.initialBuffer) : null;
    this.snapshotA = null;
    this.diffMode = false;
    this.mutatedIndices = new Set();
    this.mutationTimeout = null;
    this.feedbackTimeout = null;
    this.isMinimized = false;
    this.isDestroyed = false;

    // Elementos DOM
    this.rootEl = null;
    this.headerEl = null;
    this.metaEl = null;
    this.bodyEl = null;
    this.footerEl = null;
    this.feedbackEl = null;
    this.sizeBadgeEl = null;
    this.diffBadgeEl = null;
    this.diffBtnEl = null;

    // Estado arrastre (si es floating)
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onWindowResize = this._onWindowResize.bind(this);
    this._dragState = null;

    // Soporte para ventana externa desacoplada (multimonitor)
    this.isDetached = false;
    this.externalWindow = null;
    this._originalParent = null;
    this._originalNextSibling = null;
    this.popoutBtnEl = null;

    this._buildDOM();

    if (this.container) {
      this.mount(this.container);
    } else if (this.options.floating && typeof document !== 'undefined') {
      this.mount(document.body);
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('resize', this._onWindowResize);
    }
  }

  /**
   * Construye la estructura de elementos HTML y listeners internos.
   */
  _buildDOM() {
    if (typeof document === 'undefined') return;

    this.rootEl = document.createElement('div');
    this.rootEl.className = 'sysex-inspector';
    this.rootEl.setAttribute('role', 'region');
    this.rootEl.setAttribute('aria-label', this.options.title || 'Live SysEx Inspector');
    if (this.options.floating) {
      this.rootEl.classList.add('sysex-inspector--floating');
    }

    // --- Header ---
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'sysex-inspector__header';

    const titleArea = document.createElement('div');
    titleArea.className = 'sysex-inspector__title-area';

    const iconBadge = document.createElement('span');
    iconBadge.className = 'sysex-inspector__tag';
    iconBadge.textContent = 'SYS/EX';

    const titleText = document.createElement('span');
    titleText.className = 'sysex-inspector__title';
    titleText.textContent = this.options.title;

    const liveBadge = document.createElement('span');
    liveBadge.className = 'sysex-inspector__badge sysex-inspector__badge--live';
    liveBadge.textContent = 'LIVE';

    this.sizeBadgeEl = document.createElement('span');
    this.sizeBadgeEl.className = 'sysex-inspector__badge sysex-inspector__badge--size';
    this.sizeBadgeEl.textContent = '0 B';

    this.diffBadgeEl = document.createElement('span');
    this.diffBadgeEl.className = 'sysex-inspector__badge sysex-inspector__badge--diff';
    this.diffBadgeEl.style.display = 'none';

    titleArea.appendChild(iconBadge);
    titleArea.appendChild(titleText);
    titleArea.appendChild(liveBadge);
    titleArea.appendChild(this.sizeBadgeEl);
    titleArea.appendChild(this.diffBadgeEl);

    // Acciones de cabecera
    const actions = document.createElement('div');
    actions.className = 'sysex-inspector__actions';

    const snapABtn = document.createElement('button');
    snapABtn.type = 'button';
    snapABtn.className = 'sysex-inspector__btn';
    snapABtn.textContent = 'Snap A';
    snapABtn.title = 'Capturar estado actual como Snapshot de referencia A';
    snapABtn.addEventListener('click', () => this.captureSnapshotA());

    this.diffBtnEl = document.createElement('button');
    this.diffBtnEl.type = 'button';
    this.diffBtnEl.className = 'sysex-inspector__btn';
    this.diffBtnEl.textContent = 'Diff A/B';
    this.diffBtnEl.title = 'Alternar visualización de diferencias con Snapshot A';
    this.diffBtnEl.addEventListener('click', () => this.toggleDiff());

    const copyHexBtn = document.createElement('button');
    copyHexBtn.type = 'button';
    copyHexBtn.className = 'sysex-inspector__btn';
    copyHexBtn.textContent = 'Copy Hex';
    copyHexBtn.addEventListener('click', () => this.copyHex());

    const copyArrBtn = document.createElement('button');
    copyArrBtn.type = 'button';
    copyArrBtn.className = 'sysex-inspector__btn';
    copyArrBtn.textContent = 'Copy Array';
    copyArrBtn.addEventListener('click', () => this.copyArray());

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'sysex-inspector__btn';
    exportBtn.textContent = 'Export .syx';
    exportBtn.addEventListener('click', () => this.exportSyx());

    actions.appendChild(snapABtn);
    actions.appendChild(this.diffBtnEl);
    actions.appendChild(copyHexBtn);
    actions.appendChild(copyArrBtn);
    actions.appendChild(exportBtn);

    if (this.options.floating) {
      this.popoutBtnEl = document.createElement('button');
      this.popoutBtnEl.type = 'button';
      this.popoutBtnEl.className = 'sysex-inspector__btn sysex-inspector__btn--icon sysex-inspector__btn--popout';
      this.popoutBtnEl.innerHTML = '&#x29C9;'; // ⧉
      this.popoutBtnEl.title = 'Abrir en ventana externa / Desacoplar a otra pantalla';
      this.popoutBtnEl.addEventListener('click', () => this.togglePopout());

      const minBtn = document.createElement('button');
      minBtn.type = 'button';
      minBtn.className = 'sysex-inspector__btn sysex-inspector__btn--icon';
      minBtn.innerHTML = '&minus;';
      minBtn.title = 'Minimizar / Restaurar';
      minBtn.addEventListener('click', () => this.toggleMinimize());

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'sysex-inspector__btn sysex-inspector__btn--icon sysex-inspector__btn--close';
      closeBtn.innerHTML = '&times;';
      closeBtn.title = 'Cerrar (Esc)';
      closeBtn.addEventListener('click', () => {
        this.hide();
      });

      actions.appendChild(this.popoutBtnEl);
      actions.appendChild(minBtn);
      actions.appendChild(closeBtn);

      this.headerEl.addEventListener('pointerdown', this._onPointerDown);
    }

    this.headerEl.appendChild(titleArea);
    this.headerEl.appendChild(actions);

    // --- Meta Bar (Cabecera decodificada) ---
    this.metaEl = document.createElement('div');
    this.metaEl.className = 'sysex-inspector__meta-bar';

    // --- Body (Rejilla Hex) ---
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'sysex-inspector__body';

    // --- Footer ---
    this.footerEl = document.createElement('div');
    this.footerEl.className = 'sysex-inspector__footer';

    const infoText = document.createElement('span');
    infoText.textContent = 'Byte mutators emit visual pulse on mutation.';

    this.feedbackEl = document.createElement('span');
    this.feedbackEl.className = 'sysex-inspector__feedback';

    this.footerEl.appendChild(infoText);
    this.footerEl.appendChild(this.feedbackEl);

    this.rootEl.appendChild(this.headerEl);
    this.rootEl.appendChild(this.metaEl);
    this.rootEl.appendChild(this.bodyEl);
    this.rootEl.appendChild(this.footerEl);

    this.render();
  }

  /**
   * Arrastre flotante acotado con control estricto de colisión contra bordes del viewport.
   */
  _onPointerDown(e) {
    if (e.target.closest('button') || this.isDetached) return;
    const rect = this.rootEl.getBoundingClientRect();
    this._dragState = {
      startX: e.clientX,
      startY: e.clientY,
      initialLeft: rect.left,
      initialTop: rect.top,
      width: rect.width,
      height: rect.height,
    };
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
  }

  _onPointerMove(e) {
    if (!this._dragState || this.isDetached) return;
    const dx = e.clientX - this._dragState.startX;
    const dy = e.clientY - this._dragState.startY;
    const winWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const winHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
    const rectW = this._dragState.width || this.rootEl.offsetWidth || 720;
    const rectH = this._dragState.height || this.rootEl.offsetHeight || 420;

    // Control estricto de colisión: nunca permitir que ninguna parte del inspector quede semioculta o fuera de la pantalla
    const margin = 8;
    const maxLeft = Math.max(margin, winWidth - rectW - margin);
    const maxTop = Math.max(margin, winHeight - rectH - margin);
    const newLeft = Math.max(margin, Math.min(maxLeft, this._dragState.initialLeft + dx));
    const newTop = Math.max(margin, Math.min(maxTop, this._dragState.initialTop + dy));

    this.rootEl.style.left = `${newLeft}px`;
    this.rootEl.style.top = `${newTop}px`;
    this.rootEl.style.right = 'auto';
    this.rootEl.style.bottom = 'auto';
    this.rootEl.style.transform = 'none';
  }

  _onPointerUp() {
    this._dragState = null;
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
  }

  /**
   * Asegura que el modal permanezca 100% visible dentro del viewport al cambiar el tamaño de ventana.
   */
  _clampToViewport() {
    if (!this.rootEl || !this.options.floating || !this.isOpen() || this.isDetached) return;
    const winWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const winHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
    const rect = this.rootEl.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, winWidth - rect.width - margin);
    const maxTop = Math.max(margin, winHeight - rect.height - margin);

    if (this.rootEl.style.transform === 'none' || this.rootEl.style.left) {
      const curLeft = rect.left;
      const curTop = rect.top;
      const clampedLeft = Math.max(margin, Math.min(maxLeft, curLeft));
      const clampedTop = Math.max(margin, Math.min(maxTop, curTop));

      if (clampedLeft !== curLeft || clampedTop !== curTop) {
        this.rootEl.style.left = `${clampedLeft}px`;
        this.rootEl.style.top = `${clampedTop}px`;
        this.rootEl.style.transform = 'none';
      }
    }
  }

  _onWindowResize() {
    this._clampToViewport();
  }

  /**
   * Alterna entre modo flotante interno y ventana externa desacoplada.
   * @returns {this}
   */
  togglePopout() {
    return this.isDetached ? this.dock() : this.popout();
  }

  /**
   * Desacopla el inspector a una ventana externa nativa (ideal para multimonitor).
   * @returns {this}
   */
  popout() {
    if (this.isDetached || typeof window === 'undefined') return this;
    const screenW = window.screen && window.screen.availWidth ? window.screen.availWidth : 1920;
    const screenH = window.screen && window.screen.availHeight ? window.screen.availHeight : 1080;
    const popWidth = Math.min(960, Math.max(760, screenW - 100));
    const popHeight = Math.min(680, Math.max(500, screenH - 120));
    const left = (window.screenX || 0) + Math.max(20, Math.round(((window.outerWidth || 1000) - popWidth) / 2));
    const top = (window.screenY || 0) + Math.max(20, Math.round(((window.outerHeight || 700) - popHeight) / 2));

    let extWindow = null;
    try {
      extWindow = window.open(
        '',
        `ABDSysExPopout_${Date.now()}`,
        `width=${popWidth},height=${popHeight},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`
      );
    } catch (_) {
      this.showFeedback('No se pudo abrir ventana emergente');
      return this;
    }

    if (!extWindow) {
      this.showFeedback('Ventana emergente bloqueada por el navegador');
      return this;
    }

    this.externalWindow = extWindow;
    this.isDetached = true;

    const extDoc = extWindow.document;
    extDoc.title = `${this.options.title || 'Live SysEx Inspector'} — Ventana Externa`;

    extDoc.head.innerHTML = `
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${this.options.title || 'Live SysEx Inspector'}</title>
      <style>
        html, body {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
          background: #0d1117;
          color: #e2e8f0;
          overflow: auto;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
      </style>
    `;

    // Clonar hojas de estilo del documento anfitrión para paridad visual idéntica
    const styleNodes = document.querySelectorAll('link[rel="stylesheet"], style');
    styleNodes.forEach((node) => {
      try {
        extDoc.head.appendChild(node.cloneNode(true));
      } catch (_) {}
    });

    // Guardar referencia al padre original para recolocación al acoplar
    this._originalParent = this.rootEl.parentNode;
    this._originalNextSibling = this.rootEl.nextSibling;

    // Adaptar estilos a modo desacoplado en ventana externa
    this.rootEl.classList.add('sysex-inspector--detached');
    if (this.popoutBtnEl) {
      this.popoutBtnEl.innerHTML = '&#x2913;'; // ⤓
      this.popoutBtnEl.title = 'Reincorporar al sintetizador (Dock)';
    }

    extDoc.body.appendChild(this.rootEl);

    extWindow.addEventListener('beforeunload', () => {
      if (this.isDetached) {
        this.dock();
      }
    });

    this.showFeedback('Desacoplado a ventana externa');
    return this;
  }

  /**
   * Reincorpora el inspector al sintetizador y cierra la ventana externa.
   * @returns {this}
   */
  dock() {
    if (!this.isDetached) return this;
    this.isDetached = false;

    if (this.externalWindow && !this.externalWindow.closed) {
      try {
        this.externalWindow.close();
      } catch (_) {}
    }
    this.externalWindow = null;

    this.rootEl.classList.remove('sysex-inspector--detached');
    if (this.popoutBtnEl) {
      this.popoutBtnEl.innerHTML = '&#x29C9;'; // ⧉
      this.popoutBtnEl.title = 'Abrir en ventana externa / Desacoplar a otra pantalla';
    }

    if (this._originalParent) {
      if (this._originalNextSibling && this._originalNextSibling.parentNode === this._originalParent) {
        this._originalParent.insertBefore(this.rootEl, this._originalNextSibling);
      } else {
        this._originalParent.appendChild(this.rootEl);
      }
    } else if (typeof document !== 'undefined') {
      document.body.appendChild(this.rootEl);
    }

    this._clampToViewport();
    this.showFeedback('Reincorporado al sintetizador');
    return this;
  }

  /**
   * Listener de teclado para cierre rápido con tecla Escape
   */
  _onKeyDown(e) {
    if (e.key === 'Escape' && this.isOpen()) {
      e.stopPropagation();
      this.hide();
    }
  }

  /**
   * Muestra el inspector y dispara el evento onOpen si está configurado.
   * @returns {this}
   */
  show() {
    if (this.isDestroyed || !this.rootEl) return this;
    this.rootEl.style.display = 'flex';
    this.rootEl.classList.remove('is-hidden');
    this._clampToViewport();
    if (typeof this.options.onOpen === 'function') {
      this.options.onOpen();
    }
    return this;
  }

  /**
   * Oculta el inspector sin destruirlo y dispara onClose si está configurado.
   * @returns {this}
   */
  hide() {
    if (this.isDestroyed || !this.rootEl) return this;
    if (this.isDetached) {
      this.dock();
    }
    this.rootEl.style.display = 'none';
    this.rootEl.classList.add('is-hidden');
    if (typeof this.options.onClose === 'function') {
      this.options.onClose();
    }
    return this;
  }

  /**
   * Alterna entre visible y oculto.
   * @returns {this}
   */
  toggle() {
    return this.isOpen() ? this.hide() : this.show();
  }

  /**
   * Retorna true si el inspector está actualmente visible en pantalla.
   * @returns {boolean}
   */
  isOpen() {
    if (this.isDestroyed || !this.rootEl) return false;
    return this.rootEl.style.display !== 'none' && !this.rootEl.classList.contains('is-hidden');
  }

  /**
   * Alias de conveniencia para updateBuffer.
   * @param {Uint8Array|Array<number>} newBuffer
   * @returns {this}
   */
  setBuffer(newBuffer) {
    this.updateBuffer(newBuffer);
    return this;
  }

  /**
   * Retorna una copia del buffer de bytes actual.
   * @returns {Uint8Array}
   */
  getBuffer() {
    return new Uint8Array(this.buffer);
  }

  /**
   * Monta el inspector en un contenedor del DOM.
   * @param {HTMLElement} target
   * @returns {this}
   */
  mount(target) {
    if (!target || !this.rootEl) return this;
    this.container = target;
    target.appendChild(this.rootEl);
    return this;
  }

  /**
   * Alterna estado minimizado.
   */
  toggleMinimize() {
    this.isMinimized = !this.isMinimized;
    if (this.metaEl) this.metaEl.style.display = this.isMinimized ? 'none' : 'flex';
    if (this.bodyEl) this.bodyEl.style.display = this.isMinimized ? 'none' : 'block';
    if (this.footerEl) this.footerEl.style.display = this.isMinimized ? 'none' : 'flex';
  }

  /**
   * Muestra un mensaje temporal de feedback en el footer.
   * @param {string} msg
   */
  showFeedback(msg) {
    if (!this.feedbackEl) return;
    this.feedbackEl.textContent = msg;
    this.feedbackEl.classList.add('sysex-inspector__feedback--visible');
    clearTimeout(this.feedbackTimeout);
    this.feedbackTimeout = setTimeout(() => {
      this.feedbackEl.classList.remove('sysex-inspector__feedback--visible');
    }, 2000);
  }

  /**
   * Actualiza el buffer de bytes y calcula mutaciones respecto al estado anterior.
   * @param {Uint8Array|Array<number>} newBuffer
   */
  updateBuffer(newBuffer) {
    if (this.isDestroyed) return;
    const incoming = new Uint8Array(newBuffer || 0);

    // Detección de mutaciones byte a byte
    this.mutatedIndices.clear();
    if (this.prevBuffer && this.prevBuffer.length === incoming.length) {
      for (let i = 0; i < incoming.length; ++i) {
        if (incoming[i] !== this.prevBuffer[i]) {
          this.mutatedIndices.add(i);
        }
      }
    }

    this.prevBuffer = new Uint8Array(incoming);
    this.buffer = incoming;

    this.render();

    // Limpieza de animación tras 800ms
    if (this.mutatedIndices.size > 0) {
      clearTimeout(this.mutationTimeout);
      this.mutationTimeout = setTimeout(() => {
        this.mutatedIndices.clear();
        this._clearMutationClasses();
      }, 800);
    }
  }

  /**
   * Quita las clases CSS de mutación activa sin re-renderizar todo el DOM.
   */
  _clearMutationClasses() {
    if (!this.bodyEl) return;
    const mutatedEls = this.bodyEl.querySelectorAll('.sysex-byte--mutated');
    mutatedEls.forEach((el) => el.classList.remove('sysex-byte--mutated'));
  }

  /**
   * Fija el buffer actual como Snapshot A para comparación Diff.
   */
  captureSnapshotA() {
    this.snapshotA = new Uint8Array(this.buffer);
    this.diffMode = true;
    if (this.diffBtnEl) this.diffBtnEl.classList.add('sysex-inspector__btn--active');
    this.showFeedback('Snapshot A capturado');
    this.render();
  }

  /**
   * Alterna el modo de comparación diferencial.
   * @param {boolean} [forcedState]
   */
  toggleDiff(forcedState) {
    this.diffMode = typeof forcedState === 'boolean' ? forcedState : !this.diffMode;
    if (this.diffBtnEl) {
      this.diffBtnEl.classList.toggle('sysex-inspector__btn--active', this.diffMode);
    }
    this.render();
  }

  /**
   * Copia la trama en formato hexadecimal legible.
   */
  copyHex() {
    if (!this.buffer.length) return;
    const hex = Array.from(this.buffer)
      .map((b) => toHexByte(b))
      .join(' ');
    this._writeClipboard(hex, 'Hex copiado al portapapeles');
  }

  /**
   * Copia la trama como array literal [0xF0, 0x44, ...].
   */
  copyArray() {
    if (!this.buffer.length) return;
    const arr = `[${Array.from(this.buffer)
      .map((b) => `0x${toHexByte(b)}`)
      .join(', ')}]`;
    this._writeClipboard(arr, 'Array literal copiado');
  }

  _writeClipboard(text, successMsg) {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => this.showFeedback(successMsg),
        () => this._fallbackCopy(text, successMsg),
      );
    } else {
      this._fallbackCopy(text, successMsg);
    }
  }

  _fallbackCopy(text, successMsg) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      this.showFeedback(successMsg);
    } catch {
      this.showFeedback('Error al copiar');
    }
  }

  /**
   * Exporta el buffer como archivo binario `.syx`.
   * @param {string} [filename]
   */
  exportSyx(filename = 'preset.syx') {
    if (!this.buffer.length) {
      this.showFeedback('Buffer vacío');
      return;
    }
    const blob = new Blob([this.buffer], { type: 'application/octet-stream' });
    if (typeof this.options.onExport === 'function') {
      this.options.onExport(blob, filename);
    } else if (typeof document !== 'undefined') {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    this.showFeedback(`Exportado ${filename}`);
  }

  /**
   * Re-renderiza la interfaz completa.
   */
  render() {
    if (!this.rootEl || typeof document === 'undefined') return;

    const len = this.buffer.length;
    if (this.sizeBadgeEl) {
      this.sizeBadgeEl.textContent = `${len} B`;
    }

    // Decodificar cabecera
    const header = decodeSysExHeader(this.buffer);
    if (this.metaEl) {
      this.metaEl.innerHTML = '';
      if (header.valid) {
        this.metaEl.innerHTML = `
          <div class="sysex-inspector__meta-item"><span class="sysex-inspector__meta-label">Mfg:</span> <span class="sysex-inspector__meta-val">${header.manufacturer}</span></div>
          <div class="sysex-inspector__meta-item"><span class="sysex-inspector__meta-label">Dev:</span> <span class="sysex-inspector__meta-val">${header.deviceId || '--'}</span></div>
          ${header.model ? `<div class="sysex-inspector__meta-item"><span class="sysex-inspector__meta-label">Model:</span> <span class="sysex-inspector__meta-val">${header.model}</span></div>` : ''}
          <div class="sysex-inspector__meta-item"><span class="sysex-inspector__meta-label">EOX:</span> <span class="sysex-inspector__meta-val">${header.hasEox ? 'F7 (OK)' : 'Missing'}</span></div>
        `;
      } else {
        this.metaEl.innerHTML = `<span class="sysex-inspector__meta-label">Trama no reconocida o vacía</span>`;
      }
    }

    // Conteo y representación Diff
    let diffCount = 0;
    if (this.diffMode && this.snapshotA) {
      const maxCmp = Math.max(len, this.snapshotA.length);
      for (let i = 0; i < maxCmp; ++i) {
        if (i >= len || i >= this.snapshotA.length || this.buffer[i] !== this.snapshotA[i]) {
          diffCount++;
        }
      }
      if (this.diffBadgeEl) {
        this.diffBadgeEl.textContent = `Δ ${diffCount} B`;
        this.diffBadgeEl.style.display = 'inline-flex';
      }
    } else if (this.diffBadgeEl) {
      this.diffBadgeEl.style.display = 'none';
    }

    // Renderizar tabla Hex/ASCII
    if (!this.bodyEl) return;
    this.bodyEl.innerHTML = '';

    if (len === 0) {
      const empty = document.createElement('div');
      empty.style.color = 'var(--sysex-text-muted)';
      empty.style.padding = '20px';
      empty.style.textAlign = 'center';
      empty.textContent = 'Búfer SysEx vacío — mueve un parámetro para inspeccionar datos en vivo.';
      this.bodyEl.appendChild(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'sysex-table';

    const bpr = this.options.bytesPerRow;
    for (let offset = 0; offset < len; offset += bpr) {
      const row = document.createElement('tr');
      row.className = 'sysex-row';

      // Columna de Offset
      const tdOffset = document.createElement('td');
      tdOffset.className = 'sysex-offset';
      tdOffset.textContent = offset.toString(16).padStart(4, '0').toUpperCase();
      row.appendChild(tdOffset);

      // Columna de Hex Bytes
      const tdHex = document.createElement('td');
      tdHex.className = 'sysex-hex-col';

      let asciiChunk = '';

      for (let i = 0; i < bpr; ++i) {
        const byteIdx = offset + i;
        if (byteIdx < len) {
          const val = this.buffer[byteIdx];
          const span = document.createElement('span');
          span.className = 'sysex-byte';
          span.textContent = toHexByte(val);
          span.dataset.offset = byteIdx;

          // Badges semánticos
          if (byteIdx === 0 && val === 0xf0) span.classList.add('sysex-byte--sof');
          else if (byteIdx === len - 1 && val === 0xf7) span.classList.add('sysex-byte--eof');
          else if (byteIdx === 1) span.classList.add('sysex-byte--mfg');

          // Mutación en vivo
          if (this.mutatedIndices.has(byteIdx)) {
            span.classList.add('sysex-byte--mutated');
          }

          // Diferencia respecto a Snapshot A
          if (this.diffMode && this.snapshotA) {
            const valA = this.snapshotA[byteIdx];
            if (valA !== undefined && val !== valA) {
              span.classList.add('sysex-byte--diff');
              span.title = `Offset ${byteIdx}: A (0x${toHexByte(valA)}) → B (0x${toHexByte(val)})`;
            }
          }

          tdHex.appendChild(span);

          // Carácter ASCII (32 a 126 imprimibles)
          asciiChunk += val >= 32 && val <= 126 ? String.fromCharCode(val) : '.';
        } else {
          // Relleno visual
          const emptySpan = document.createElement('span');
          emptySpan.className = 'sysex-byte';
          emptySpan.style.opacity = '0';
          emptySpan.textContent = '  ';
          tdHex.appendChild(emptySpan);
        }
      }
      row.appendChild(tdHex);

      // Columna ASCII
      const tdAscii = document.createElement('td');
      tdAscii.className = 'sysex-ascii-col';
      tdAscii.textContent = asciiChunk;
      row.appendChild(tdAscii);

      table.appendChild(row);
    }

    this.bodyEl.appendChild(table);
  }

  /**
   * Destruye el componente y limpia event listeners y timers.
   */
  destroy() {
    this.isDestroyed = true;
    if (this.isDetached) {
      this.dock();
    }
    clearTimeout(this.mutationTimeout);
    clearTimeout(this.feedbackTimeout);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this._onPointerMove);
      window.removeEventListener('pointerup', this._onPointerUp);
      window.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('resize', this._onWindowResize);
    }
    if (this.rootEl && this.rootEl.parentNode) {
      this.rootEl.parentNode.removeChild(this.rootEl);
    }
    this.rootEl = null;
  }
}

/**
 * Función factory helper para instanciación concisa.
 * @param {object} options
 * @returns {LiveSysExInspector}
 */
export function createLiveSysExInspector(options = {}) {
  return new LiveSysExInspector(options);
}
