/**
 * @file hardwareRoutingDiagram.js
 * @brief Componente gráfico vectorial SVG universal para visualización de topología y conexionado físico.
 * @details Promovido a ABDShared para su reutilización en ABDAudioLab, bancos de prueba y herramientas de calibración.
 * @author ABDSynths
 * @date 2026
 */

export class HardwareRoutingDiagram {
  /**
   * @param {HTMLElement|string} container Elemento o selector donde montar el componente.
   * @param {object} options Opciones de configuración
   * @param {string} [options.interfaceName='Focusrite USB ASIO'] Nombre de la interfaz de audio.
   * @param {string} [options.targetName='BOSS DS-1 Distortion'] Nombre del hardware target.
   * @param {string} [options.targetType='Pedal Analógico'] Subtítulo o categoría del target.
   * @param {string} [options.sendPort='OUT 1'] Puerto de salida de excitación.
   * @param {string} [options.returnPort='IN 1'] Puerto de entrada de captura.
   * @param {boolean} [options.showMidi=false] Mostrar cables de automatización MIDI.
   * @param {boolean} [options.animated=true] Animación de flujo en cables.
   * @param {function} [options.onVerify] Callback al pulsar verificación de continuidad.
   */
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.options = {
      interfaceName: 'Focusrite USB ASIO',
      targetName: 'BOSS DS-1 Distortion',
      targetType: 'Pedal Analógico',
      sendPort: 'OUT 1',
      returnPort: 'IN 1',
      showMidi: false,
      animated: true,
      ...options
    };

    this.element = null;
    this._mount();
  }

  _mount() {
    this.element = document.createElement('div');
    this.element.className = 'hardware-routing-diagram-container';
    this.element.style.width = '100%';
    this.element.style.maxWidth = '100%';
    this.element.style.overflow = 'hidden';
    this.render();

    if (this.container) {
      this.container.appendChild(this.element);
    }
  }

  /**
   * Actualiza el dispositivo target o parámetros de conexión dinámicamente.
   */
  update(newOptions = {}) {
    this.options = { ...this.options, ...newOptions };
    this.render();
  }

  render() {
    const {
      interfaceName,
      targetName,
      targetType,
      sendPort,
      returnPort,
      showMidi,
      animated
    } = this.options;

    const strokeDash = animated ? 'stroke-dasharray="5,3"' : '';

    this.element.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px; width:100%;">
        <svg viewBox="0 0 540 220" style="width:100%; height:200px; background:#070b10; border-radius:8px; border:1px solid #1a2636; box-shadow: inset 0 2px 10px rgba(0,0,0,0.5);">
          <!-- Defs para marcadores de flecha -->
          <defs>
            <marker id="arrowOrange" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#ff9100" />
            </marker>
            <marker id="arrowGreen" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#00e676" />
            </marker>
          </defs>

          <!-- Interfaz de Audio -->
          <rect x="20" y="35" width="135" height="150" rx="8" fill="#0d141e" stroke="#00c3ff" stroke-width="1.5"/>
          <text x="87" y="58" fill="#00c3ff" font-size="11" font-weight="700" text-anchor="middle" letter-spacing="0.5">AUDIO INTERFACE</text>
          <text x="87" y="74" fill="#64748b" font-size="9" text-anchor="middle">${interfaceName}</text>
          
          <!-- Jack Out -->
          <rect x="125" y="90" width="20" height="14" rx="3" fill="#ff9100"/>
          <text x="115" y="101" fill="#cbd5e1" font-size="9" font-weight="600" text-anchor="end">${sendPort}</text>
          
          <!-- Jack In -->
          <rect x="125" y="132" width="20" height="14" rx="3" fill="#00e676"/>
          <text x="115" y="143" fill="#cbd5e1" font-size="9" font-weight="600" text-anchor="end">${returnPort}</text>

          <!-- Target Hardware -->
          <rect x="365" y="35" width="155" height="150" rx="8" fill="#0d141e" stroke="#00e676" stroke-width="1.5"/>
          <text x="442" y="58" fill="#00e676" font-size="11" font-weight="700" text-anchor="middle" letter-spacing="0.5">TARGET HARDWARE</text>
          <text x="442" y="74" fill="#cbd5e1" font-size="10" font-weight="600" text-anchor="middle">${targetName}</text>
          <text x="442" y="88" fill="#64748b" font-size="8.5" text-anchor="middle">${targetType}</text>
          
          <!-- Jack In Target -->
          <rect x="375" y="90" width="20" height="14" rx="3" fill="#ff9100"/>
          <text x="405" y="101" fill="#cbd5e1" font-size="9" font-weight="600">INPUT</text>
          
          <!-- Jack Out Target -->
          <rect x="375" y="132" width="20" height="14" rx="3" fill="#00e676"/>
          <text x="405" y="143" fill="#cbd5e1" font-size="9" font-weight="600">OUTPUT</text>

          <!-- Cable Excitación (Send) -->
          <path d="M 145 97 C 225 97, 295 97, 375 97" fill="none" stroke="#ff9100" stroke-width="2.5" ${strokeDash} marker-end="url(#arrowOrange)"/>
          <text x="260" y="89" fill="#ff9100" font-size="9" font-weight="700" text-anchor="middle">Señal Excitación (Send)</text>

          <!-- Cable Retorno (Return) -->
          <path d="M 375 139 C 295 139, 225 139, 145 139" fill="none" stroke="#00e676" stroke-width="2.5" marker-end="url(#arrowGreen)"/>
          <text x="260" y="155" fill="#00e676" font-size="9" font-weight="700" text-anchor="middle">Captura de Respuesta (Return)</text>

          ${showMidi ? `
            <path d="M 145 168 C 225 168, 295 168, 375 168" fill="none" stroke="#a855f7" stroke-width="2" stroke-dasharray="3,3"/>
            <text x="260" y="180" fill="#a855f7" font-size="8.5" font-weight="600" text-anchor="middle">Control MIDI Automatizado</text>
          ` : ''}
        </svg>

        <div style="display:flex; justify-content:space-between; align-items:center; background:var(--color-panel-surface-elevated, #0d141e); padding:8px 14px; border-radius:6px; border:1px solid var(--color-panel-border, #1a2636);">
          <span style="font-size:11px; color:var(--color-text-main, #cbd5e1); display:flex; align-items:center; gap:6px; font-weight:500;">
            <span style="width:8px; height:8px; border-radius:50%; background:var(--color-accent, #00e676); box-shadow:0 0 6px var(--color-accent, #00e676);"></span>
            Topología balanceada directa lista para calibración de loopback
          </span>
          <button id="btnVerifyRouting" class="btn btn-sm btn-primary" style="padding:4px 10px; font-size:11px;">
            Verificar Continuidad
          </button>
        </div>
      </div>
    `;

    const btn = this.element.querySelector('#btnVerifyRouting');
    if (btn) {
      btn.addEventListener('click', () => {
        btn.textContent = '✓ Señal Verificada';
        btn.classList.add('active');
        if (typeof this.options.onVerify === 'function') {
          this.options.onVerify();
        }
      });
    }
  }

  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}
