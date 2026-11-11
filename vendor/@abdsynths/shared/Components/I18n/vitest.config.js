import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Config propia a proposito: sin ella vitest sube hasta el
    // `vitest.config.js` de la raiz (environment jsdom + import de 'vitest/config'
    // resuelto contra la raiz), y en CI la raiz no tiene node_modules: el paso
    // moria con ERR_MODULE_NOT_FOUND antes de ejecutar un test.
    // Los tests de i18n son logica pura de modulos, sin DOM.
    environment: 'node',
  },
});
