import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const contractsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(contractsDir);

export default defineConfig({
  resolve: {
    // `Code/MidiKeyboard/src/parameterLookup.js` importa `@abdsynths/shared/contracts/...`.
    // En local eso resuelve por un symlink manual en node_modules/@abdsynths/shared y
    // por el filesystem insensible a mayusculas (la carpeta real es `Contracts`); en
    // CI no existe ni el symlink ni esa indulgencia. Se resuelve aqui, de forma
    // explicita y portable, sin tocar el import del consumidor.
    alias: [
      { find: '@abdsynths/shared/contracts', replacement: contractsDir },
      { find: '@abdsynths/shared', replacement: repoRoot },
    ],
  },
  test: {
    // Los tests de este paquete validan datos puros (JSON + fs): no necesitan DOM.
    // Sin config propia heredan el `environment: 'jsdom'` de la raiz, y este paquete
    // no declara jsdom.
    environment: 'node',
  },
});
