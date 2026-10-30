/**
 * @file studioTopology.js
 * @brief Componente interactivo universal de interconexión y topología de estudio (ABDShared).
 * @details Provee renderizado vectorial SVG de cables Bézier con física catenaria por gravedad,
 *          tarjetas de hardware y puertos con soporte para arrastre libre y persistencia de posiciones.
 *          Basado fielmente en el motor oficial de ABDStudioTopology.
 * @author ABDSynths
 * @date 2026
 */

const CABLE_PHYSICS = {
  BASE_SAG: 85,
  SAG_FACTOR: 0.22,
  MAX_SAG: 260,
  STROKE_WIDTH: 4,
  PLUG_RADIUS: 5,
  SPREAD: 16
};

const SIGNAL_COLORS = {
  audioOut: '#f59e0b', // Ámbar (Audio Probe/Stimulus)
  audioIn:  '#10b981', // Verde esmeralda (Audio Return)
  midiOut:  '#a855f7', // Púrpura (MIDI Out)
  midiIn:   '#06b6d4'  // Cian (MIDI In)
};

const STORAGE_KEY = 'abd_studio_topology_positions_v3';

export class StudioTopology {
  /**
   * @param {HTMLElement|string} mountElement Contenedor donde se montará la topología
   * @param {object} initialData Datos iniciales { target, devices, connections }
   */
  constructor(mountElement, initialData = {}) {
    this.container = typeof mountElement === 'string' ? document.querySelector(mountElement) : mountElement;
    if (!this.container) return;

    this.data = {
      target: null,
      devices: [],
      connections: [],
      ...initialData
    };

    this.nodePositions = new Map();
    this.activeDrag = null;
    this.lastMode = null;
    this.lastWidth = null;

    this._setupDom();
    this._attachResize();

    if (this.data.target || (this.data.devices && this.data.devices.length > 0)) {
      this.render();
    }
  }

  _setupDom() {
    this.container.innerHTML = `
      <div class="studio-topology-container" id="canvas-container">
        <!-- Barra de Cabecera -->
        <div class="header-bar">
          <div class="header-title-area">
            <div class="header-title">
              <svg class="header-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22v-5"/>
                <path d="M9 8V2"/>
                <path d="M15 2v6"/>
                <path d="M18 8v5a6 6 0 0 1-12 0V8z"/>
              </svg>
              <span>Studio Environment &amp; Connections</span>
            </div>
          </div>
          <div class="header-legend">
            <div class="legend-item"><div class="legend-dot audio-out"></div><span>Audio Out (Probe)</span></div>
            <div class="legend-item"><div class="legend-dot audio-in"></div><span>Audio In (Return)</span></div>
            <div class="legend-item"><div class="legend-dot midi-out"></div><span>MIDI Out</span></div>
            <div class="legend-item"><div class="legend-dot midi-in"></div><span>MIDI In</span></div>
          </div>
        </div>

        <!-- Capa SVG de Cables Físicos -->
        <svg id="cables-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="cable-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="#000000" flood-opacity="0.5"/>
            </filter>
          </defs>
          <g id="cables-group"></g>
          <g id="plugs-group"></g>
        </svg>

        <!-- Capa de Nodos HTML Arrastrables -->
        <div class="nodes-layer" id="nodes-layer"></div>
      </div>
    `;

    this.canvasContainer = this.container.querySelector('#canvas-container');
    this.nodesLayer = this.container.querySelector('#nodes-layer');
    this.cablesGroup = this.container.querySelector('#cables-group');
    this.plugsGroup = this.container.querySelector('#plugs-group');
  }

  _attachResize() {
    this._resizeHandler = () => {
      if (this.data && (this.data.target || (this.data.devices && this.data.devices.length > 0))) {
        const curW = this.canvasContainer ? this.canvasContainer.clientWidth : 0;
        const curMode = curW < 560 ? 'compact' : 'desktop';
        if (this.lastMode !== null && (this.lastMode !== curMode || Math.abs(curW - (this.lastWidth || curW)) > 60)) {
          this.nodePositions.clear();
        }
        this.render();
      }
    };
    window.addEventListener('resize', this._resizeHandler);
  }

  _clampNodePosition(id, pos, containerW, containerH) {
    const w = Math.max(containerW || 0, 520);
    const h = Math.max(containerH || 0, 480);
    const isNarrow = w < 560;
    const isTarget = (id === 'target');
    const halfW = isTarget ? (isNarrow ? 98 : 118) : (isNarrow ? 82 : 95);
    const halfH = isTarget ? (isNarrow ? 85 : 100) : (isNarrow ? 65 : 78);
    const margin = 12;
    const headerOffset = isNarrow ? 76 : 56;

    const minX = halfW + margin;
    const maxX = Math.max(minX + 10, w - halfW - margin);
    if (maxX > minX) {
      pos.x = Math.max(minX, Math.min(maxX, pos.x));
    } else {
      pos.x = w / 2;
    }

    const minY = headerOffset + halfH;
    const maxY = Math.max(minY + 10, h - halfH - margin);
    pos.y = Math.max(minY, Math.min(maxY, pos.y));
    return pos;
  }

  destroy() {
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }

  update(newData) {
    if (!newData) return;
    this.data = { ...this.data, ...newData };
    this.render();
  }

  render() {
    if (!this.canvasContainer || !this.nodesLayer) return;
    this.nodesLayer.innerHTML = '';

    const width = Math.max(this.canvasContainer.clientWidth || 0, 680);
    const isNarrow = width < 560;
    const curMode = isNarrow ? 'compact' : 'desktop';

    if (this.lastMode !== null && this.lastMode !== curMode) {
      this.nodePositions.clear();
    }
    this.lastMode = curMode;
    this.lastWidth = width;

    if (isNarrow) {
      this.canvasContainer.style.minHeight = '600px';
    } else {
      this.canvasContainer.style.minHeight = '';
    }

    const height = Math.max(this.canvasContainer.clientHeight || 0, isNarrow ? 600 : 480);
    const centerX = width / 2;
    const headerOffset = isNarrow ? 76 : 56;

    const isValidCoord = (pt) => (
      pt && typeof pt.x === 'number' && typeof pt.y === 'number' &&
      !isNaN(pt.x) && !isNaN(pt.y) && pt.x > 40 && pt.y > 50 && pt.x < width - 30 && pt.y < height - 30
    );

    let savedPositions = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed[curMode]) {
          savedPositions = parsed[curMode];
        }
      }
    } catch (_) {}

    const devices = this.data.devices || [];
    const connectedDevs = devices.filter(d => d.assigned);
    const unassignedDevs = devices.filter(d => !d.assigned);

    if (isNarrow) {
      // --- NARROW / COMPACT LAYOUT (Vertical Cascade) ---
      // Tier 1: Connected audio interfaces
      connectedDevs.forEach((dev, idx) => {
        if (!this.nodePositions.has(dev.id)) {
          const p = { x: centerX, y: headerOffset + 65 + idx * 135 };
          this.nodePositions.set(dev.id, this._clampNodePosition(dev.id, p, width, height));
        }
      });

      // Tier 2: Target
      if (this.data.target && !this.nodePositions.has('target')) {
        const targetBaseY = headerOffset + 65 + (connectedDevs.length > 0 ? connectedDevs.length * 135 + 40 : 0) + 20;
        const p = { x: centerX, y: targetBaseY };
        this.nodePositions.set('target', this._clampNodePosition('target', p, width, height));
      }

      // Tier 3: Unassigned / MIDI devices
      const targetPos = this.nodePositions.get('target');
      const targetY = targetPos ? targetPos.y : 320;
      unassignedDevs.forEach((dev, idx) => {
        if (!this.nodePositions.has(dev.id)) {
          const p = { x: centerX, y: targetY + 165 + idx * 135 };
          this.nodePositions.set(dev.id, this._clampNodePosition(dev.id, p, width, height));
        }
      });
    } else {
      // --- DESKTOP / WIDE LAYOUT (Balanced 2D Topology) ---
      // 1. Target in center
      if (this.data.target && !this.nodePositions.has('target')) {
        if (isValidCoord(savedPositions['target'])) {
          const p = { x: savedPositions['target'].x, y: savedPositions['target'].y };
          this.nodePositions.set('target', this._clampNodePosition('target', p, width, height));
        } else {
          const p = { x: centerX, y: height * 0.46 };
          this.nodePositions.set('target', this._clampNodePosition('target', p, width, height));
        }
      }

      // 2. Connected devices on left flank
      const connectedSlots = [
        { x: width * 0.22, y: height * 0.42 },
        { x: width * 0.22, y: height * 0.72 },
        { x: width * 0.18, y: height * 0.22 }
      ];
      connectedDevs.forEach((dev, idx) => {
        if (!this.nodePositions.has(dev.id)) {
          if (isValidCoord(savedPositions[dev.id])) {
            const p = { x: savedPositions[dev.id].x, y: savedPositions[dev.id].y };
            this.nodePositions.set(dev.id, this._clampNodePosition(dev.id, p, width, height));
          } else {
            const slot = connectedSlots[idx % connectedSlots.length];
            const p = { x: slot.x, y: slot.y };
            this.nodePositions.set(dev.id, this._clampNodePosition(dev.id, p, width, height));
          }
        }
      });

      // 3. Unassigned / MIDI devices on right flank
      const unassignedSlots = [
        { x: width * 0.78, y: height * 0.42 },
        { x: width * 0.78, y: height * 0.72 },
        { x: width * 0.50, y: height * 0.82 }
      ];
      unassignedDevs.forEach((dev, idx) => {
        if (!this.nodePositions.has(dev.id)) {
          if (isValidCoord(savedPositions[dev.id])) {
            const p = { x: savedPositions[dev.id].x, y: savedPositions[dev.id].y };
            this.nodePositions.set(dev.id, this._clampNodePosition(dev.id, p, width, height));
          } else {
            const slot = unassignedSlots[idx % unassignedSlots.length];
            const p = { x: slot.x, y: slot.y };
            this.nodePositions.set(dev.id, this._clampNodePosition(dev.id, p, width, height));
          }
        }
      });
    }

    // Relaxation Pass (resolución de colisiones)
    const allNodeKeys = Array.from(this.nodePositions.keys());
    const minSeparationX = isNarrow ? 0 : 210;
    const minSeparationY = 175;

    for (let iter = 0; iter < 8; ++iter) {
      for (let i = 0; i < allNodeKeys.length; ++i) {
        for (let j = i + 1; j < allNodeKeys.length; ++j) {
          const idA = allNodeKeys[i];
          const idB = allNodeKeys[j];
          const posA = this.nodePositions.get(idA);
          const posB = this.nodePositions.get(idB);
          if (!posA || !posB) continue;

          const dx = posB.x - posA.x;
          const dy = posB.y - posA.y;
          const absX = Math.abs(dx);
          const absY = Math.abs(dy);

          if (isNarrow) {
            if (absY < minSeparationY) {
              const overlapY = minSeparationY - absY;
              const signY = dy >= 0 ? 1 : -1;
              if (idA === 'target') {
                posB.y += signY * overlapY;
              } else if (idB === 'target') {
                posA.y -= signY * overlapY;
              } else {
                posA.y -= signY * overlapY * 0.5;
                posB.y += signY * overlapY * 0.5;
              }
            }
          } else {
            if (absX < minSeparationX && absY < minSeparationY) {
              const overlapX = minSeparationX - absX;
              const overlapY = minSeparationY - absY;
              const shiftFactor = 0.5;
              const signX = (dx > 0 || (dx === 0 && i < j)) ? 1 : -1;
              const signY = (dy > 0 || (dy === 0 && i < j)) ? 1 : -1;

              if (idA === 'target') {
                posB.x += signX * overlapX;
                posB.y += signY * overlapY;
              } else if (idB === 'target') {
                posA.x -= signX * overlapX;
                posA.y -= signY * overlapY;
              } else {
                posA.x -= signX * overlapX * shiftFactor;
                posA.y -= signY * overlapY * shiftFactor;
                posB.x += signX * overlapX * shiftFactor;
                posB.y += signY * overlapY * shiftFactor;
              }
            }
          }
        }
      }
    }

    // Clamp strictly within canvas boundaries post-relaxation
    allNodeKeys.forEach(key => {
      const p = this.nodePositions.get(key);
      if (p) {
        this._clampNodePosition(key, p, width, height);
      }
    });

    // Renderizar nodos
    if (this.data.target) {
      this._renderNode('target', this.data.target, true);
    }
    connectedDevs.forEach(dev => this._renderNode(dev.id, dev, false));
    unassignedDevs.forEach(dev => this._renderNode(dev.id, dev, false));

    requestAnimationFrame(() => {
      this.updateCables();
    });
  }

  _renderNode(id, dev, isTarget) {
    const pos = this.nodePositions.get(id);
    if (!pos) return;

    const nodeEl = document.createElement('div');
    nodeEl.id = `node-${id}`;
    nodeEl.className = `device-node ${isTarget ? 'target-hero' : 'interface-node'} ${!isTarget && !dev.assigned ? 'unassigned' : ''}`;
    nodeEl.style.left = `${pos.x}px`;
    nodeEl.style.top = `${pos.y}px`;

    // Badge
    const badge = document.createElement('div');
    badge.className = `node-badge ${isTarget ? 'target-badge' : (dev.assigned ? 'connected' : 'unassigned-badge')}`;
    badge.textContent = isTarget ? 'MEASUREMENT TARGET' : (dev.assigned ? 'CONNECTED' : 'UNASSIGNED');
    nodeEl.appendChild(badge);

    // Imagen
    const imgContainer = document.createElement('div');
    imgContainer.className = 'node-image-container';
    const img = document.createElement('img');
    img.className = `node-image ${dev.themeClass || ''}`.trim();
    img.src = dev.image || '';
    img.alt = dev.name || 'Device';
    img.onerror = () => {
      img.style.display = 'none';
      imgContainer.innerHTML = `<div style="display:flex; align-items:center; justify-content:center; width:100%; height:100%; color:var(--color-text-dim, #94a3b8); font-size:10px; font-weight:700; text-transform:uppercase;">${isTarget ? 'HARDWARE TARGET' : 'AUDIO / MIDI I/O'}</div>`;
    };
    imgContainer.appendChild(img);
    nodeEl.appendChild(imgContainer);

    // Título y categoría
    const title = document.createElement('div');
    title.className = 'node-title';
    title.textContent = dev.name;
    title.title = dev.name;
    nodeEl.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'node-subtitle';
    subtitle.textContent = dev.details || dev.category || (isTarget ? 'Hardware Under Test' : 'Audio / MIDI I/O');
    nodeEl.appendChild(subtitle);

    // Conectores Jacks
    const jacks = document.createElement('div');
    jacks.className = 'node-jacks';

    if (dev.ports && Array.isArray(dev.ports) && dev.ports.length > 0) {
      dev.ports.forEach(port => {
        const jackEl = document.createElement('div');
        const typeClass = (port.type || 'audio-out').replace(/([A-Z])/g, '-$1').toLowerCase();
        jackEl.className = `jack-point ${typeClass} ${port.connected ? 'active' : ''}`;
        jackEl.title = `${port.name || port.id} (${port.type})`;
        jackEl.id = `jack-${id}-${port.id}`;
        jacks.appendChild(jackEl);
      });
    } else {
      const jackTypes = [];
      if (dev.hasAudio !== false) {
        jackTypes.push({ type: 'audioOut', title: 'Audio Out' });
        jackTypes.push({ type: 'audioIn',  title: 'Audio In' });
      }
      if (dev.hasMidi !== false) {
        jackTypes.push({ type: 'midiOut',  title: 'MIDI Out' });
        jackTypes.push({ type: 'midiIn',   title: 'MIDI In' });
      }

      jackTypes.forEach(j => {
        const jackEl = document.createElement('div');
        jackEl.className = `jack-point ${j.type.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
        jackEl.title = j.title;
        jackEl.id = `jack-${id}-${j.type}`;
        jacks.appendChild(jackEl);
      });
    }

    nodeEl.appendChild(jacks);

    // Drag & Drop con Pointer Events y Pointer Capture
    nodeEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.activeDrag = {
        id,
        startX: e.clientX,
        startY: e.clientY,
        origNodeX: pos.x,
        origNodeY: pos.y
      };
      nodeEl.classList.add('dragging');
      nodeEl.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });

    nodeEl.addEventListener('pointermove', (e) => {
      if (!this.activeDrag || this.activeDrag.id !== id) return;
      const dx = e.clientX - this.activeDrag.startX;
      const dy = e.clientY - this.activeDrag.startY;

      const containerW = this.canvasContainer.clientWidth || 720;
      const containerH = this.canvasContainer.clientHeight || 480;

      const rawPos = {
        x: this.activeDrag.origNodeX + dx,
        y: this.activeDrag.origNodeY + dy
      };
      const clamped = this._clampNodePosition(id, rawPos, containerW, containerH);

      pos.x = clamped.x;
      pos.y = clamped.y;
      nodeEl.style.left = `${clamped.x}px`;
      nodeEl.style.top = `${clamped.y}px`;

      this.updateCables();
    });

    const endDrag = (e) => {
      if (this.activeDrag && this.activeDrag.id === id) {
        nodeEl.classList.remove('dragging');
        try { nodeEl.releasePointerCapture(e.pointerId); } catch (_) {}
        this.activeDrag = null;

        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          const current = raw ? JSON.parse(raw) : {};
          const isNarrowDrag = (this.canvasContainer ? this.canvasContainer.clientWidth : 720) < 560;
          const modeKey = isNarrowDrag ? 'compact' : 'desktop';
          if (!current[modeKey]) current[modeKey] = {};
          current[modeKey][id] = { x: pos.x, y: pos.y };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
        } catch (_) {}
      }
    };

    nodeEl.addEventListener('pointerup', endDrag);
    nodeEl.addEventListener('pointercancel', endDrag);

    this.nodesLayer.appendChild(nodeEl);
  }

  computeBundleSpread(x1, y1, x2, y2, position, groupSize) {
    if (groupSize <= 1) return { x: 0, y: 0 };
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const offset = (position - (groupSize - 1) / 2) * CABLE_PHYSICS.SPREAD;
    return { x: nx * offset, y: ny * offset };
  }

  calculateCablePath(x1, y1, x2, y2, position, groupSize) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);

    const sag = Math.min(CABLE_PHYSICS.BASE_SAG + dist * CABLE_PHYSICS.SAG_FACTOR, CABLE_PHYSICS.MAX_SAG);
    const spread = this.computeBundleSpread(x1, y1, x2, y2, position, groupSize);
    const vertDrop = Math.max(30, sag * 0.45);

    const cx1 = x1 + spread.x;
    const cy1 = y1 + vertDrop + sag * 0.7 + spread.y;
    const cx2 = x2 + spread.x;
    const cy2 = y2 + vertDrop + sag * 0.7 + spread.y;

    return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
  }

  updateCables() {
    if (!this.cablesGroup || !this.plugsGroup || !this.canvasContainer) return;

    this.cablesGroup.innerHTML = '';
    this.plugsGroup.innerHTML = '';

    const connections = this.data.connections || [];
    const containerRect = this.canvasContainer.getBoundingClientRect();

    const pairGroups = new Map();
    connections.forEach((conn, idx) => {
      const pairKey = [conn.from, conn.to].sort().join('<->');
      if (!pairGroups.has(pairKey)) pairGroups.set(pairKey, []);
      pairGroups.get(pairKey).push({ conn, idx });
    });

    pairGroups.forEach((group) => {
      const groupSize = group.length;

      group.forEach(({ conn }, posInGroup) => {
        const pFrom = this.nodePositions.get(conn.from);
        const pTo = this.nodePositions.get(conn.to);
        if (!pFrom || !pTo) return;

        const jackFromEl = (conn.fromPort ? this.canvasContainer.querySelector(`#jack-${conn.from}-${conn.fromPort}`) : null)
                        || this.canvasContainer.querySelector(`#jack-${conn.from}-${conn.type}`);
        const jackToEl   = (conn.toPort ? this.canvasContainer.querySelector(`#jack-${conn.to}-${conn.toPort}`) : null)
                        || this.canvasContainer.querySelector(`#jack-${conn.to}-${conn.type}`);

        let x1 = pFrom.x, y1 = pFrom.y + 40;
        let x2 = pTo.x,   y2 = pTo.y + 40;

        if (jackFromEl) {
          const r = jackFromEl.getBoundingClientRect();
          x1 = r.left - containerRect.left + r.width / 2;
          y1 = r.top - containerRect.top + r.height / 2;
          jackFromEl.classList.add('active');
        }
        if (jackToEl) {
          const r = jackToEl.getBoundingClientRect();
          x2 = r.left - containerRect.left + r.width / 2;
          y2 = r.top - containerRect.top + r.height / 2;
          jackToEl.classList.add('active');
        }

        const pathD = this.calculateCablePath(x1, y1, x2, y2, posInGroup, groupSize);
        const color = SIGNAL_COLORS[conn.type] || '#38bdf8';

        // 1. Path del Cable
        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('d', pathD);
        pathEl.setAttribute('class', 'patch-cable pulse-anim');
        pathEl.setAttribute('stroke', color);
        pathEl.setAttribute('filter', 'url(#cable-shadow)');
        this.cablesGroup.appendChild(pathEl);

        // 2. Plugs / Jacks
        [{ x: x1, y: y1 }, { x: x2, y: y2 }].forEach(pt => {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', pt.x);
          circle.setAttribute('cy', pt.y);
          circle.setAttribute('r', CABLE_PHYSICS.PLUG_RADIUS);
          circle.setAttribute('class', 'cable-plug');
          circle.setAttribute('stroke', color);
          this.plugsGroup.appendChild(circle);
        });
      });
    });
  }
}
