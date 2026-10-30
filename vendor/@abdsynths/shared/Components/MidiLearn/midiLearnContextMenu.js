/**
 * ABDShared — midiLearnContextMenu.js
 * =========================================================================
 * Canonical UI Controller for MIDI Learn indicators, hover tooltips,
 * and right-click context menus across all ABDSynths controls:
 * - Knob (.abd-knob)
 * - RotaryLedKnob (.abd-rotary-led)
 * - Wheel (.kbd-wheel-wrapper)
 * - Slider (.abd-slider)
 * - TrajectoryStick2D (.stick-card / .vector-pad-wrapper, supporting independent X and Y axes)
 * - Any element annotated with `data-param-index` or `data-midi-learn-index`.
 *
 * Visual Indicators:
 * 1. Resting state: discrete glowing dot (`.abd-midi-learn-dot`) in the top-right corner
 *    of any mapped control, plus a rich hover tooltip showing all assigned CCs/NRPNs.
 * 2. Listening state: pulsing accent ring (`.is-midi-learning`) while waiting for hardware movement.
 * 3. Global Overlay state (`body.abd-midi-learn-overlay`): displays direct CC badges on every
 *    mapped control and allows single-click learning.
 *
 * Zero emojis — uses strictly monochrome SVGs from CONTROL_ICONS in ABDShared.
 */

import { CONTROL_ICONS } from '../icons.js';
import { formatMidiSourceBadge, formatMidiMappingSummary } from './midiLearnStore.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Attaches universal MIDI Learn DOM delegation, context menu, and visual dot indicators.
 *
 * @param {object} options
 * @param {ReturnType<import('./midiLearnStore.js').createMidiLearnStore>} options.store
 * @param {HTMLElement} [options.root=document.body]
 * @param {Function} [options.getParamMeta] (paramIndex) => { name, group, key, min, max }
 * @param {Function} [options.onOpenDrawer] (focusParamIndex) => void
 */
export function attachMidiLearnUI(options = {}) {
  const {
    store,
    root = typeof document !== 'undefined' ? document.body : null,
    getParamMeta = (idx) => ({ name: `Parameter #${idx}`, group: 'Synth', key: `param_${idx}` }),
    onOpenDrawer = null,
  } = options;

  if (!store || !root || typeof document === 'undefined') {
    return { refresh: () => {}, destroy: () => {} };
  }

  // Create singleton context menu element
  const menuEl = document.createElement('div');
  menuEl.className = 'abd-midi-context-menu';
  menuEl.setAttribute('role', 'menu');
  menuEl.style.display = 'none';
  document.body.appendChild(menuEl);

  // Create singleton floating hover tooltip
  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'abd-midi-tooltip';
  tooltipEl.style.display = 'none';
  document.body.appendChild(tooltipEl);

  let menuOpen = false;

  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    menuEl.style.display = 'none';
    menuEl.innerHTML = '';
  }

  function hideTooltip() {
    tooltipEl.style.display = 'none';
  }

  /**
   * Resolves MIDI learn target metadata from a DOM node.
   * Supports 1D controls (`data-param-index`) and 2D Trajectory Sticks (`data-param-x` + `data-param-y`).
   */
  function resolveTargetsFromElement(targetEl) {
    if (!targetEl || !(targetEl instanceof HTMLElement)) return null;
    const node = targetEl.closest('[data-param-index], [data-param-x], [data-midi-learn-index], [data-param]');
    if (!node) return null;

    // 2D Stick with X and Y axes
    if (node.hasAttribute('data-param-x') && node.hasAttribute('data-param-y')) {
      const idxX = parseInt(node.getAttribute('data-param-x') || '-1', 10);
      const idxY = parseInt(node.getAttribute('data-param-y') || '-1', 10);
      const result = [];
      if (Number.isFinite(idxX) && idxX >= 0) {
        const metaX = getParamMeta(idxX) || {};
        result.push({
          index: idxX,
          key: metaX.key || `param_${idxX}`,
          label: `${metaX.name || `Stick X [#${idxX}]`} (Axis X)`,
          axis: 'X',
          element: node,
        });
      }
      if (Number.isFinite(idxY) && idxY >= 0) {
        const metaY = getParamMeta(idxY) || {};
        result.push({
          index: idxY,
          key: metaY.key || `param_${idxY}`,
          label: `${metaY.name || `Stick Y [#${idxY}]`} (Axis Y)`,
          axis: 'Y',
          element: node,
        });
      }
      return result.length > 0 ? { is2D: true, node, targets: result } : null;
    }

    // Standard 1D control
    const rawAttr =
      node.getAttribute('data-param-index') ??
      node.getAttribute('data-midi-learn-index') ??
      node.getAttribute('data-param');
    const idx = parseInt(rawAttr || '-1', 10);
    if (!Number.isFinite(idx) || idx < 0) return null;
    const meta = getParamMeta(idx) || {};
    return {
      is2D: false,
      node,
      targets: [
        {
          index: idx,
          key: meta.key || `param_${idx}`,
          label: meta.name || `Param #${idx}`,
          group: meta.group || '',
          element: node,
        },
      ],
    };
  }

  /**
   * Synchronizes `.has-midi-learn`, `.is-midi-learning`, and `.abd-midi-learn-dot` badges
   * across all annotated controls in the DOM.
   */
  function refreshDecorations() {
    if (typeof document === 'undefined') return;
    const state = store.getState();

    document.body.classList.toggle('abd-midi-learn-overlay', Boolean(state.globalOverlayActive));

    const nodes = root.querySelectorAll('[data-param-index], [data-param-x], [data-midi-learn-index], [data-param]');
    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const resolved = resolveTargetsFromElement(node);
      if (!resolved) return;

      const allMappings = [];
      let isWaiting = false;

      for (const t of resolved.targets) {
        const found = store.getMappingsForTarget(t.index, t.key);
        for (const m of found) {
          allMappings.push({ mapping: m, axis: t.axis || '' });
        }
        if (state.isLearning && state.learningTargetIndex === t.index) {
          isWaiting = true;
        }
      }

      const hasMapping = allMappings.length > 0;
      node.classList.toggle('has-midi-learn', hasMapping);
      node.classList.toggle('is-midi-learning', isWaiting);

      // Ensure indicator dot / badge container exists inside the control (or its parent if void element like <input>)
      const indicatorHost = (node.tagName === 'INPUT' || node.tagName === 'SELECT')
        ? (node.parentElement || node)
        : node;
      let badgeEl = indicatorHost.querySelector(':scope > .abd-midi-learn-indicator');
      if (!hasMapping && !isWaiting && !state.globalOverlayActive) {
        if (badgeEl) badgeEl.remove();
        return;
      }

      if (!badgeEl) {
        badgeEl = document.createElement('span');
        badgeEl.className = 'abd-midi-learn-indicator';
        // Make sure parent has relative positioning so absolute indicator sits cleanly in corner
        const computedPos = window.getComputedStyle(indicatorHost).position;
        if (computedPos === 'static') {
          indicatorHost.style.position = 'relative';
        }
        indicatorHost.appendChild(badgeEl);
      }

      if (isWaiting) {
        const sec = state.learnRemainingSeconds > 0 ? `${state.learnRemainingSeconds}s` : 'LEARN...';
        const sig = `wait:${sec}`;
        if (badgeEl.getAttribute('data-render-sig') !== sig) {
          badgeEl.setAttribute('data-render-sig', sig);
          badgeEl.className = 'abd-midi-learn-indicator is-waiting';
          badgeEl.innerHTML = `<span class="abd-midi-learn-clock">${CONTROL_ICONS.clock || CONTROL_ICONS.target}</span><span>${sec}</span>`;
        }
      } else if (hasMapping) {
        const primaryBadge = formatMidiSourceBadge(allMappings[0].mapping);
        const suffix = allMappings.length > 1 ? ` +${allMappings.length - 1}` : '';
        const text = state.globalOverlayActive ? `${primaryBadge}${suffix}` : '';
        const sig = `map:${primaryBadge}${suffix}:${state.globalOverlayActive ? 1 : 0}`;
        if (badgeEl.getAttribute('data-render-sig') !== sig) {
          badgeEl.setAttribute('data-render-sig', sig);
          badgeEl.className = 'abd-midi-learn-indicator is-mapped';
          badgeEl.setAttribute('data-midi-badge', `${primaryBadge}${suffix}`);
          badgeEl.textContent = text;
        }
      } else if (state.globalOverlayActive) {
        const sig = 'hint:MIDI';
        if (badgeEl.getAttribute('data-render-sig') !== sig) {
          badgeEl.setAttribute('data-render-sig', sig);
          badgeEl.className = 'abd-midi-learn-indicator is-unmapped-hint';
          badgeEl.textContent = 'MIDI';
        }
      }
    });
  }

  /**
   * Opens the right-click context menu for a resolved control.
   */
  function openContextMenu(clientX, clientY, resolved) {
    hideTooltip();
    const state = store.getState();

    let html = '';
    const countdownSuffix = state.learnRemainingSeconds > 0 ? ` (${state.learnRemainingSeconds}s)` : '';
    if (state.isLearning && !resolved.targets.some((t) => t.index === state.learningTargetIndex)) {
      html += `
        <button type="button" class="abd-midi-menu__item is-active-learn" data-cmd="cancel-learn">
          <span class="abd-midi-menu__item-icon">${CONTROL_ICONS.clock || CONTROL_ICONS.close}</span>
          <span>Cancel Active MIDI Learn Wait${countdownSuffix} (Esc)</span>
        </button>
        <div class="abd-midi-menu__sep"></div>
      `;
    }
    for (const target of resolved.targets) {
      const targetMappings = store.getMappingsForTarget(target.index, target.key);
      const isCurrentlyLearningThis = state.isLearning && state.learningTargetIndex === target.index;

      html += `
        <div class="abd-midi-menu__header">
          <span class="abd-midi-menu__icon">${CONTROL_ICONS.midiDin}</span>
          <div class="abd-midi-menu__title-col">
            <span class="abd-midi-menu__title">${escapeHtml(target.label)}</span>
            <span class="abd-midi-menu__subtitle">Param [${target.index}]${targetMappings.length ? ` · ${targetMappings.length} mapped` : ''}</span>
          </div>
        </div>
      `;

      if (isCurrentlyLearningThis) {
        html += `
          <button type="button" class="abd-midi-menu__item is-active-learn" data-cmd="cancel-learn">
            <span class="abd-midi-menu__item-icon">${CONTROL_ICONS.clock || CONTROL_ICONS.close}</span>
            <span>Cancel Waiting for MIDI${countdownSuffix} (Esc)</span>
          </button>
        `;
      } else {
        const primaryLabel = targetMappings.length > 0
          ? `Learn MIDI (Replace ${formatMidiSourceBadge(targetMappings[0])})`
          : 'Learn MIDI Assignment...';

        html += `
          <button type="button" class="abd-midi-menu__item" data-cmd="learn-replace" data-idx="${target.index}" data-key="${escapeHtml(target.key)}">
            <span class="abd-midi-menu__item-icon">${CONTROL_ICONS.target}</span>
            <span>${escapeHtml(primaryLabel)}</span>
          </button>
        `;

        if (targetMappings.length > 0) {
          html += `
            <button type="button" class="abd-midi-menu__item" data-cmd="learn-add" data-idx="${target.index}" data-key="${escapeHtml(target.key)}">
              <span class="abd-midi-menu__item-icon">${CONTROL_ICONS.plus}</span>
              <span>Add Another Controller (N:1)...</span>
            </button>
          `;
        }
      }

      if (targetMappings.length > 0) {
        html += `<div class="abd-midi-menu__sep"></div>`;
        for (const m of targetMappings) {
          const summary = formatMidiMappingSummary(m);
          // Count if this source is also controlling other parameters (Macro 1:N)
          const sharedCount = store.getMappingsForSource(m.sourceType, m.number, m.channel).length;
          const macroTag = sharedCount > 1 ? ` <span class="abd-midi-menu__macro-tag">Macro ×${sharedCount}</span>` : '';

          html += `
            <div class="abd-midi-menu__binding-row">
              <span class="abd-midi-menu__binding-text">${escapeHtml(summary)}${macroTag}</span>
              <button type="button" class="abd-midi-menu__unlearn-btn" data-cmd="remove-id" data-id="${escapeHtml(m.id)}" title="Unlearn this controller">
                ${CONTROL_ICONS.trash}
              </button>
            </div>
          `;
        }

        if (targetMappings.length > 1) {
          html += `
            <button type="button" class="abd-midi-menu__item is-danger" data-cmd="unbind-all" data-idx="${target.index}" data-key="${escapeHtml(target.key)}">
              <span class="abd-midi-menu__item-icon">${CONTROL_ICONS.trash}</span>
              <span>Unlearn All (${targetMappings.length})</span>
            </button>
          `;
        }
      }

      if (resolved.targets.length > 1 && target !== resolved.targets[resolved.targets.length - 1]) {
        html += `<div class="abd-midi-menu__sep"></div>`;
      }
    }

    if (typeof onOpenDrawer === 'function') {
      const firstIdx = resolved.targets[0]?.index ?? -1;
      html += `
        <div class="abd-midi-menu__sep"></div>
        <button type="button" class="abd-midi-menu__item" data-cmd="open-drawer" data-idx="${firstIdx}">
          <span class="abd-midi-menu__item-icon">${CONTROL_ICONS.sliders}</span>
          <span>Open MIDI Learn &amp; CC Map Drawer...</span>
        </button>
      `;
    }

    menuEl.innerHTML = html;
    menuEl.style.display = 'flex';
    menuOpen = true;

    // Position within viewport bounds
    const rect = menuEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(clientX, vw - rect.width - 12));
    const top = Math.max(8, Math.min(clientY, vh - rect.height - 12));
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
  }

  function onContextMenu(e) {
    const resolved = resolveTargetsFromElement(e.target);
    if (!resolved) return;
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e.clientX, e.clientY, resolved);
  }

  function onPointerOver(e) {
    if (menuOpen) return;
    const resolved = resolveTargetsFromElement(e.target);
    if (!resolved) {
      hideTooltip();
      return;
    }

    const state = store.getState();
    const lines = [];

    for (const t of resolved.targets) {
      if (state.isLearning && state.learningTargetIndex === t.index) {
        const secTxt = state.learnRemainingSeconds > 0 ? ` (${state.learnRemainingSeconds}s)` : '';
        lines.push(`<div class="abd-midi-tooltip__line is-learning">${CONTROL_ICONS.clock || ''} <span>${escapeHtml(t.label)}: Waiting for MIDI CC / NRPN...${secTxt}</span></div>`);
      }
      const list = store.getMappingsForTarget(t.index, t.key);
      for (const m of list) {
        const prefix = resolved.is2D ? `${t.axis}: ` : '';
        lines.push(`<div class="abd-midi-tooltip__line"><strong>${escapeHtml(prefix + formatMidiSourceBadge(m))}</strong> · ${escapeHtml(formatMidiMappingSummary(m))}</div>`);
      }
    }

    if (lines.length === 0) {
      hideTooltip();
      return;
    }

    tooltipEl.innerHTML = `
      <div class="abd-midi-tooltip__head">${CONTROL_ICONS.midiDin} <span>MIDI LEARN ASSIGNED</span></div>
      ${lines.join('')}
    `;
    tooltipEl.style.display = 'flex';

    const nodeRect = resolved.node.getBoundingClientRect();
    const ttRect = tooltipEl.getBoundingClientRect();
    const left = Math.max(6, Math.min(nodeRect.left + nodeRect.width / 2 - ttRect.width / 2, window.innerWidth - ttRect.width - 8));
    const top = nodeRect.top - ttRect.height - 6 >= 4 ? nodeRect.top - ttRect.height - 6 : nodeRect.bottom + 6;
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  }

  function onPointerOut(e) {
    const related = e.relatedTarget;
    if (related instanceof HTMLElement && related.closest('[data-param-index], [data-param-x], [data-midi-learn-index], [data-param]')) {
      return;
    }
    hideTooltip();
  }

  function onMenuClick(e) {
    const btn = e.target instanceof HTMLElement ? e.target.closest('[data-cmd]') : null;
    if (!btn) return;
    e.stopPropagation();

    const cmd = btn.getAttribute('data-cmd');
    const idx = parseInt(btn.getAttribute('data-idx') || '-1', 10);
    const key = btn.getAttribute('data-key') || '';
    const id = btn.getAttribute('data-id') || '';

    if (cmd === 'learn-replace' && idx >= 0) {
      store.startLearning(idx, key, 'replace');
    } else if (cmd === 'learn-add' && idx >= 0) {
      store.startLearning(idx, key, 'add');
    } else if (cmd === 'cancel-learn') {
      store.cancelLearning();
    } else if (cmd === 'remove-id' && id) {
      store.removeMapping(id);
    } else if (cmd === 'unbind-all' && idx >= 0) {
      store.unbindTarget(idx, key);
    } else if (cmd === 'open-drawer') {
      onOpenDrawer?.(idx >= 0 ? idx : undefined);
    }

    closeMenu();
  }

  function onGlobalPointerDown(e) {
    const targetEl = e.target instanceof HTMLElement ? e.target : null;
    if (menuOpen && (!targetEl || !menuEl.contains(targetEl))) {
      closeMenu();
    }
    // If a control is waiting for MIDI Learn and the user left-clicks anywhere on the UI
    // (except on the context menu itself or on a "Learn" trigger button inside the drawer),
    // automatically release the MIDI Learn wait state.
    if (e.button === 0 && store.getState().isLearning) {
      const isInsideMenu = targetEl && menuEl.contains(targetEl);
      const isLearnTrigger = targetEl && targetEl.closest('#btn-ml-quick-learn, .ml-row-relearn, [data-cmd^="learn-"]');
      if (!isInsideMenu && !isLearnTrigger) {
        store.cancelLearning();
      }
    }
  }

  function onGlobalKeyDown(e) {
    if (e.key === 'Escape') {
      if (menuOpen) {
        closeMenu();
      } else if (store.getState().isLearning) {
        store.cancelLearning();
      }
    }
  }

  root.addEventListener('contextmenu', onContextMenu);
  root.addEventListener('pointerover', onPointerOver);
  root.addEventListener('pointerout', onPointerOut);
  menuEl.addEventListener('click', onMenuClick);
  window.addEventListener('pointerdown', onGlobalPointerDown, true);
  window.addEventListener('keydown', onGlobalKeyDown);

  const unsubscribe = store.subscribe(() => {
    refreshDecorations();
  });

  // Observe DOM mutations so dynamically opened drawers (EffectsDrawer, ResynatorDrawer, etc.)
  // immediately receive their MIDI Learn dots and badges without triggering self-mutation loops
  let mutationObserver = null;
  if (typeof MutationObserver !== 'undefined') {
    const isIndicatorNode = (n) =>
      n instanceof HTMLElement &&
      (n.classList.contains('abd-midi-learn-indicator') || Boolean(n.closest('.abd-midi-learn-indicator')));

    mutationObserver = new MutationObserver((mutations) => {
      const hasRelevantMutation = mutations.some((m) => {
        if (m.type === 'attributes') {
          return !isIndicatorNode(m.target);
        }
        if (isIndicatorNode(m.target)) return false;
        for (const n of m.addedNodes) {
          if (!isIndicatorNode(n)) return true;
        }
        for (const n of m.removedNodes) {
          if (!isIndicatorNode(n)) return true;
        }
        return false;
      });
      if (hasRelevantMutation) {
        refreshDecorations();
      }
    });
    mutationObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-param-index', 'data-param-x', 'data-param-y', 'data-midi-learn-index', 'data-param'],
    });
  }

  refreshDecorations();

  return {
    refresh: refreshDecorations,
    closeMenu,
    destroy() {
      unsubscribe();
      mutationObserver?.disconnect();
      root.removeEventListener('contextmenu', onContextMenu);
      root.removeEventListener('pointerover', onPointerOver);
      root.removeEventListener('pointerout', onPointerOut);
      menuEl.removeEventListener('click', onMenuClick);
      window.removeEventListener('pointerdown', onGlobalPointerDown, true);
      window.removeEventListener('keydown', onGlobalKeyDown);
      menuEl.remove();
      tooltipEl.remove();
    },
  };
}
