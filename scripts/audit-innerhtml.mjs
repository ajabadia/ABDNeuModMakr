#!/usr/bin/env node
// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — innerHTML interpolation audit (SECURITY_STANDARDS §2.2)
//
// Lists every ${...} hole DIRECTLY inside an `innerHTML = `...``
// template literal that is NOT wrapped in escHtml()/escAttr() and is NOT
// on the safe-pattern allowlist below. Nested template literals inside a
// hole are skipped (their own innerHTML assignment, if any, is audited
// where it occurs).
//
// Exit 0 = clean. Keep in sync with scripts/security-grep.mjs.
// ─────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A hole is safe without esc*() when it matches one of these.
const SAFE_HOLE = [
  /^ICONS\.[A-Za-z0-9_]+$/,
  /^[a-zA-Z_$][\w$]*$/, // bare boolean / class-field / identifier
  /^\d+(\.\d+)?$/,
  /^'[^']*'$/,
  /^"[^"]*"$/,
  /^`[^`]*`$/,
  /^[a-zA-Z_$][\w$]*\.(toFixed|toString|toLocaleString|padStart|toUpperCase|toLowerCase)\([^`]*\)$/,
  /^Math\.[A-Za-z]+\([^`]*\)$/,
  /^String\([^`]*\)$/,
  /^midiToNoteName\([^`]*\)$/,
  /^midiNoteToString\([^`]*\)$/,
  /^formatRegionModeBadge\([^`]*\)$/,
  /^formatGmDrumLabel\([^`]*\)$/,
  /^formatByteSize\([^`]*\)$/,
  /^detuneToString\([^`]*\)$/,
  /^volumeToLongString\([^`]*\)$/,
  /^panToString\([^`]*\)$/,
  /^basenameOf\([^`]*\)$/,
  /^tApp\([^`]*\)$/,
  /^[a-zA-Z_$][\w$]*\.(lowVel|highVel|lowKey|highKey|rootKey|width|height|length|status|percent|bpm|count|index|slot|zoneCount|parameterSet|complexity|id|sampleRate|startOctave|octaveCount|notesPerOctave|gateDurationMs|maxReleaseMs|velocityLayers|bitDepth|latencyMs|calibratedLatencyMs|calibratedLatencySamples|targetBpm|seamQualityPercent|durationSec|totalFrames|activePartials|layerCount|detectedF0Hz|gridResidualCents|byteSize|bitsPerSample|numChannels|loopStart|loopEnd|usage|limit|progress|size_mb|downloaded_bytes|total_bytes|speed_mbps)$/,
];

const isSafeHole = (expr) => SAFE_HOLE.some((re) => re.test(expr));

// Tokenizer over a template body: yields top-level ${...} holes with
// correct handling of nested templates, quotes, escapes and ${} nesting.
function* topLevelHoles(body) {
  let i = 0;
  const n = body.length;
  while (i < n) {
    if (body[i] === '$' && body[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      let quote = null;
      let tplDepth = 0;
      while (j < n && depth > 0) {
        const c = body[j];
        const prev = body[j - 1];
        if (quote) {
          if (c === quote && prev !== '\\') quote = null;
        } else if (c === "'" || c === '"') {
          quote = c;
        } else if (c === '`') {
          // nested template: skip balanced
          let k = j + 1;
          let q2 = null;
          let nest = 0;
          while (k < n) {
            const d = body[k];
            const p2 = body[k - 1];
            if (q2) {
              if (d === q2 && p2 !== '\\') q2 = null;
            } else if (d === "'" || d === '"') {
              q2 = d;
            } else if (d === '`' && nest === 0) {
              break;
            } else if (d === '$' && body[k + 1] === '{') {
              nest++;
              k++;
            } else if (d === '}' && nest > 0) {
              nest--;
            }
            k++;
          }
          j = k; // j points at closing backtick (or n)
        } else if (c === '$' && body[j + 1] === '{') {
          depth++;
          j++;
        } else if (c === '}') {
          depth--;
        }
        j++;
      }
      yield body.slice(i + 2, j - 1).trim();
      i = j;
    } else {
      i++;
    }
  }
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__pycache__') continue;
      out.push(...walk(full));
    } else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// Find `innerHTML = `...`` spans with a correct backtick matcher.
function* innerHTMLTemplates(src) {
  const re = /\.innerHTML\s*\+?=\s*`/g;
  let m;
  while ((m = re.exec(src))) {
    let j = re.lastIndex;
    while (j < src.length) {
      if (src[j] === '`' && src[j - 1] !== '\\') break;
      if (src[j] === '$' && src[j + 1] === '{') {
        // skip nested ${} at scan level: jump balanced
        let depth = 1;
        j += 2;
        let quote = null;
        while (j < src.length && depth > 0) {
          const c = src[j];
          const prev = src[j - 1];
          if (quote) {
            if (c === quote && prev !== '\\') quote = null;
          } else if (c === "'" || c === '"') {
            quote = c;
          } else if (c === '$' && src[j + 1] === '{') {
            depth++;
            j++;
          } else if (c === '}') {
            depth--;
          }
          j++;
        }
        continue;
      }
      j++;
    }
    const line = src.slice(0, m.index).split('\n').length;
    yield { body: src.slice(re.lastIndex, j), line };
    re.lastIndex = j + 1;
  }
}

let suspects = 0;
for (const file of walk(path.join(root, 'src'))) {
  const src = readFileSync(file, 'utf8');
  for (const { body, line } of innerHTMLTemplates(src)) {
    for (const hole of topLevelHoles(body)) {
      if (/esc(Html|Attr|Text)\s*\(/.test(hole)) continue;
      if (isSafeHole(hole)) continue;
      suspects++;
      const rel = path.relative(root, file).replace(/\\/g, '/');
      console.log(`${rel}:${line}  →  ${hole.slice(0, 160)}`);
    }
  }
}
if (suspects > 0) {
  console.error(
    `\ninnerHTML audit: ${suspects} unescaped top-level interpolation(s). Wrap in escHtml()/escAttr() or justify.`
  );
  process.exit(1);
}
console.log('innerHTML audit OK (§2.2): no unescaped interpolations in innerHTML templates.');
