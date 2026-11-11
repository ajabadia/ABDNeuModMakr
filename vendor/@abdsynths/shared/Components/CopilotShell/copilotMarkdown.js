// ─────────────────────────────────────────────────────────
// ABDShared — Safe Copilot Markdown Renderer
// Strict HTML sanitization + [[target:ID|Label]] spot chips
// ─────────────────────────────────────────────────────────

export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escAttr(str) {
  return escHtml(str);
}

/**
 * Renderiza markdown seguro libre de XSS (cero <script>, cero eventos inline).
 * Admite negritas (**texto**), código inline (`código`), enlaces ([label](url)),
 * bloques de código, listas (- item) y marcadores interactivos [[target:TARGET_ID|Etiqueta]] o [spot:TARGET_ID|Etiqueta].
 */
export function renderSafeCopilotMarkdown(rawText) {
  if (!rawText) return '';

  // 1. Escapar todo el texto de entrada como primer paso absoluto
  let escaped = escHtml(rawText);

  // 2. Extraer y convertir bloques de código ```lang ... ```
  escaped = escaped.replace(/```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/g, (_m, code) => {
    return `<pre class="abd-copilot-code-block"><code>${code.trim()}</code></pre>`;
  });

  // 3. Código inline `...`
  escaped = escaped.replace(/`([^`]+)`/g, '<code class="abd-copilot-code-inline">$1</code>');

  // 4. Negritas **...**
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // 5. Cursivas *...*
  escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // 6. Chips interactivos de Spotlight: [[target:TARGET_ID|Etiqueta]] o [spot:TARGET_ID|Etiqueta]
  escaped = escaped.replace(/\[\[target:([a-zA-Z0-9_-]{1,64})\|([^\]]+)\]\]/g, (_m, targetId, label) => {
    return `<button type="button" class="abd-copilot-spot-chip" data-spot-target="${targetId}">${label.trim()}</button>`;
  });
  escaped = escaped.replace(/\[spot:([a-zA-Z0-9_-]{1,64})\|([^\]]+)\]/g, (_m, targetId, label) => {
    return `<button type="button" class="abd-copilot-spot-chip" data-spot-target="${targetId}">${label.trim()}</button>`;
  });

  // 7. Enlaces seguros [label](https://...)
  escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s'")]+)\)/g, (_m, text, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text.trim()}</a>`;
  });

  // 8. Listas de items con guión
  const lines = escaped.split('\n');
  const result = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      if (!inList) {
        result.push('<ul class="abd-copilot-list">');
        inList = true;
      }
      result.push(`<li>${trimmed.slice(2)}</li>`);
    } else {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      if (trimmed.length > 0) {
        result.push(`<p>${trimmed}</p>`);
      }
    }
  }
  if (inList) {
    result.push('</ul>');
  }

  return result.join('\n');
}
