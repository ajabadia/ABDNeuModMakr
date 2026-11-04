#!/usr/bin/env node
// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Security grep gate (DOCS/SECURITY_STANDARDS §2.1 y §8)
//
// Verifica automáticamente los patrones prohibidos del estándar de
// seguridad. Se ejecuta en `npm run lint:security` y en CI.
// Sale con código 1 si encuentra cualquier coincidencia.
// ─────────────────────────────────────────────────────────

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {{ name: string, dirs: string[], exts: string[], rules: { re: RegExp, label: string }[] }[]} */
const TARGETS = [
  {
    name: 'src (TypeScript)',
    dirs: ['src'],
    exts: ['.ts'],
    rules: [
      { re: /\beval\s*\(/, label: 'eval()' },
      { re: /new Function\s*\(/, label: 'new Function()' },
      { re: /document\.write\s*\(/, label: 'document.write()' },
      { re: /@ts-ignore/, label: '@ts-ignore (usar tipado real)' },
    ],
  },
  {
    name: 'bridge (Python)',
    dirs: ['bridge'],
    exts: ['.py'],
    rules: [
      { re: /\bshell\s*=\s*True/, label: 'shell=True' },
      { re: /\bos\.system\s*\(/, label: 'os.system()' },
      { re: /\bpickle\.loads\s*\(/, label: 'pickle.loads()' },
      { re: /\byaml\.load\s*\(/, label: 'yaml.load() sin Loader seguro' },
    ],
  },
];

/** @param {string} dir @param {string[]} exts @returns {string[]} */
function walk(dir, exts) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__pycache__') continue;
      out.push(...walk(full, exts));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

let violations = 0;

for (const target of TARGETS) {
  for (const relDir of target.dirs) {
    const absDir = path.join(root, relDir);
    let files = [];
    try {
      files = walk(absDir, target.exts);
    } catch {
      continue;
    }
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, idx) => {
        for (const rule of target.rules) {
          if (rule.re.test(line)) {
            violations++;
            const rel = path.relative(root, file).replace(/\\/g, '/');
            console.error(`${rel}:${idx + 1}  ${rule.label}  →  ${line.trim().slice(0, 120)}`);
          }
        }
      });
    }
  }
}

if (violations > 0) {
  console.error(`\nSecurity grep gate FAILED: ${violations} violación(es) de DOCS/SECURITY_STANDARDS.md §2.1.`);
  process.exit(1);
}

console.log('Security grep gate OK (S2.1): sin eval/new Function/document.write/@ts-ignore en src, sin shell=True/os.system/pickle/yaml.load en bridge.');
