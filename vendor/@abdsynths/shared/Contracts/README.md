# @abdsynths/contracts

Contratos normativos de datos, esquemas JSON, especificaciones SysEx y perfiles de hardware para toda la suite **ABDSynths**.

- **Fuente Única de Verdad (SSOT):** Centraliza todos los parámetros, tablas de modulación, límites de bytes y esquemas de validación.
- **Cero dependencias:** No requiere C++, JUCE, DOM ni librerías externas.
- **Ligero:** ~60 KB comprimido (~440 KB desempaquetado).
- **Consumo universal:** Funciona con Node.js, navegadores, validadores CLI y suites de tests.

---

## Instalación

### En el Monorepo ABDSynths (`pnpm workspace`)
```json
{
  "dependencies": {
    "@abdsynths/contracts": "workspace:*"
  }
}
```

### Como dependencia Git autónoma desde GitHub
```json
{
  "dependencies": {
    "@abdsynths/contracts": "github:ajabadia/ABDShared#path:Contracts"
  }
}
```

### Desde GitHub Packages (npm registry)
```json
{
  "dependencies": {
    "@abdsynths/contracts": "^1.0.0"
  }
}
```

---

## Uso Rápido

### Carga dinámica de contratos y esquemas
```javascript
import { listContracts, listSchemas, getContract } from '@abdsynths/contracts';

// 1. Listar todos los modelos disponibles
const allModels = listContracts();
// ['casio_cz101.json', 'korg_ms2000.json', 'roland_juno106.json', ...]

// 2. Obtener la especificación de un sintetizador
const ms2000 = getContract('korg_ms2000');
console.log(ms2000.model, ms2000.sysex);

// 3. Obtener un esquema JSON de validación
const hwProfileSchema = getContract('hardware_profile.schema.json');
```

### Importación estática directa por subruta (JSON ESM)
```javascript
import cz101Spec from '@abdsynths/contracts/casio_cz101.json' with { type: 'json' };
```

---

## Verificación y Tests
```bash
npm test
```
