// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Vendor Sync Script
//
// Synchronizes required assets and source modules from local
// sibling repositories (ABDShared & MidiKeyboard) into `vendor/@abdsynths/`
// so that ABDNeuModMakr is 100% self-contained for Vercel and CI/CD builds.
// ─────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const VENDOR_DIR = path.resolve(ROOT_DIR, 'vendor/@abdsynths');

const SHARED_SRC =
  process.env.ABD_SHARED_DIR || path.resolve(ROOT_DIR, '../ABDShared');
const MIDI_KEYB_SRC =
  process.env.ABD_MIDI_KEYB_DIR ||
  path.resolve(ROOT_DIR, '../ABDSharedCode/MidiKeyboard');

function copyRecursiveSync(src, dest, ignoreFilter = () => false) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (ignoreFilter(src)) return;
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'tests') {
        continue;
      }
      copyRecursiveSync(
        path.join(src, entry),
        path.join(dest, entry),
        ignoreFilter
      );
    }
  } else {
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.copyFileSync(src, dest);
  }
}

export function syncVendor() {
  console.log('🔄 Sincronizando módulos de @abdsynths a vendor/ ...');

  if (!fs.existsSync(SHARED_SRC)) {
    console.error(`❌ No se encontró la ruta de ABDShared: ${SHARED_SRC}`);
    process.exit(1);
  }
  if (!fs.existsSync(MIDI_KEYB_SRC)) {
    console.error(`❌ No se encontró la ruta de MidiKeyboard: ${MIDI_KEYB_SRC}`);
    process.exit(1);
  }

  const targetShared = path.join(VENDOR_DIR, 'shared');
  const targetMidiKeyb = path.join(VENDOR_DIR, 'midi-keyb');

  if (fs.existsSync(targetShared)) {
    fs.rmSync(targetShared, { recursive: true, force: true });
  }
  if (fs.existsSync(targetMidiKeyb)) {
    fs.rmSync(targetMidiKeyb, { recursive: true, force: true });
  }
  fs.mkdirSync(targetShared, { recursive: true });
  fs.mkdirSync(targetMidiKeyb, { recursive: true });

  // 1. Sync ABDShared
  console.log(`📦 Copiando @abdsynths/shared desde ${SHARED_SRC} ...`);
  const sharedItems = [
    'Components',
    'Contracts',
    'Utils',
    'package.json',
  ];
  for (const item of sharedItems) {
    const s = path.join(SHARED_SRC, item);
    const d = path.join(targetShared, item);
    copyRecursiveSync(s, d);
  }

  // Copy only relevant Assets (styles, themes, icons, fonts, UI assets)
  const assetSubfolders = ['styles', 'themes', 'icons', 'fonts', 'assets'];
  for (const sub of assetSubfolders) {
    const s = path.join(SHARED_SRC, 'Assets', sub);
    const d = path.join(targetShared, 'Assets', sub);
    copyRecursiveSync(s, d);
  }

  // Copy needed Code folders from ABDShared
  const codeItems = [
    'NeuronFormats',
    'visualizers',
    path.join('DspCore', 'NeuronAnalysis'),
  ];
  for (const cItem of codeItems) {
    const s = path.join(SHARED_SRC, 'Code', cItem);
    const d = path.join(targetShared, 'Code', cItem);
    copyRecursiveSync(s, d);
  }

  // Clean shared package.json if needed
  const sharedPkgPath = path.join(targetShared, 'package.json');
  if (fs.existsSync(sharedPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(sharedPkgPath, 'utf8'));
    delete pkg.devDependencies;
    delete pkg.scripts;
    fs.writeFileSync(sharedPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }

  // 2. Sync MidiKeyboard
  console.log(`📦 Copiando @abdsynths/midi-keyb desde ${MIDI_KEYB_SRC} ...`);
  copyRecursiveSync(path.join(MIDI_KEYB_SRC, 'src'), path.join(targetMidiKeyb, 'src'));
  copyRecursiveSync(
    path.join(MIDI_KEYB_SRC, 'package.json'),
    path.join(targetMidiKeyb, 'package.json')
  );

  // Patch midi-keyb package.json to reference local vendor shared
  const keybPkgPath = path.join(targetMidiKeyb, 'package.json');
  if (fs.existsSync(keybPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(keybPkgPath, 'utf8'));
    pkg.dependencies = {
      "@abdsynths/shared": "file:../shared"
    };
    delete pkg.devDependencies;
    delete pkg.scripts;
    fs.writeFileSync(keybPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }

  console.log('✅ Vendorizado completado con éxito en vendor/@abdsynths/');
}

// Run directly if invoked as main
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncVendor();
}
