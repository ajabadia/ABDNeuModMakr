# @abdsynths/i18n

Motor universal reactivo de internacionalización (i18n) en **2 capas** para la suite **ABDSynths**.

- **Cero dependencias externas:** JavaScript ESM puro (navegador, Node.js, Web Workers, Electron).
- **Ultraligero:** < 25 KB desempaquetado.
- **Arquitectura en 2 capas:**
  - **Capa 1 (Core):** Vocabulario común y transversal (`common`, `navbar`, `settings`, `calibration`, `hardwareDumps`, `midiLearn`).
  - **Capa 2 (Sintetizador / App):** Diccionario propio y específico fusionado limpiamente sobre el core mediante `createSynthI18n()`.
- **Enlace declarativo al DOM:** Soporte nativo para atributos `data-i18n`, `data-i18n-title`, `data-i18n-placeholder`.
- **Persistencia unificada:** Clave estándar `abdsynths.locale` en `localStorage`.

---

## Instalación

### En el Monorepo ABDSynths (`pnpm workspace`)
```json
{
  "dependencies": {
    "@abdsynths/i18n": "workspace:*"
  }
}
```

### Como dependencia Git autónoma desde GitHub
```json
{
  "dependencies": {
    "@abdsynths/i18n": "github:ajabadia/ABDShared#path:Components/I18n"
  }
}
```

### Desde GitHub Packages (npm registry)
```json
{
  "dependencies": {
    "@abdsynths/i18n": "^1.0.0"
  }
}
```

---

## Uso Rápido

```typescript
import { createSynthI18n, SHARED_EN, SHARED_ES, deepMergeLocales } from '@abdsynths/i18n';

// 1. Definir diccionarios propios (Capa 2)
const mySynthEn = {
  myModule: { title: 'Oscillator Section' }
};

const mySynthEs = {
  myModule: { title: 'Sección de Osciladores' }
};

// 2. Instanciar el motor reactivo
export const i18n = createSynthI18n({
  locales: {
    en: mySynthEn,
    es: mySynthEs,
  },
  defaultLocale: 'en',
  storageKey: 'abdsynths.locale',
  detectBrowserLocale: false, // Opcional: fija 'en' sin inferir por navegador
});

export const { t, setLocale, getLocale, onLocaleChange, applyI18n } = i18n;
```

---

## Verificación y Tests
```bash
npm test
```
