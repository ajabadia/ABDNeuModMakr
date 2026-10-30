# Estándares de Seguridad ABDSynths — Todos los proyectos

> **Ámbito:** todo software ABDSynths (web, bridge local, formatos, plugins JUCE/C++).
> **Origen:** auditoría 2026-10-30 de ABDNeuModMakr (XSS, SSRF, traversal, DoS ZIP/sesión).
> **Dónde vive este documento:** canónico en `DOCS/SECURITY_STANDARDS.md` de cada proyecto; espejo en `ABDShared/docs/SECURITY_STANDARDS.md` vía `vendorSync` (no se versiona dentro de `vendor/`).
> **No encajaba en ningún doc existente** (`ARCHITECTURE_DUAL_TARGET`, `NEURON_MM_SPEC`, `NEXTGEN_ARCHITECTURE…` son arquitectura/DSP, no seguridad) → se crea documento nuevo.

---

## 1. Principios

1. **Validar en la frontera, escapar en la salida.** Todo payload externo (`.nmsession.json`, `localStorage`, ZIP/SF2/SFZ/WAV, `manifest.json`, respuestas del bridge) se valida con schema estricto antes de usarse; todo string que llegue a `innerHTML`/atributo/SQL/ruta se escapa o rechaza.
2. **Allowlist, nunca denylist.** URLs, rutas, MIME, extensiones y protocolos solo pasan si están en lista explícita.
3. **El cliente es atacante.** `localStorage`/`IndexedDB` se tratan como entrada no confiable (pueden editarse en DevTools).
4. **El bridge local es servidor.** Aunque escuche en `127.0.0.1`, cualquier web puede llamarlo por CORS → requiere auth + origen estricto + canonización de rutas.
5. **Presupuesto de recursos.** Todo parser tiene caps de tamaño/nº entradas/tiempo probados en `phase7_import_robustness`.

## 2. Frontend (XSS / inyección)

- [ ] **S2.1** Nunca `eval`, `new Function`, `setTimeout(string)`, `document.write`. Verificado con grep en CI.
- [ ] **S2.2** Todo `innerHTML` con datos externos usa `escHtml/escAttr` de `src/ui/escape.ts`. Texto puro → `textContent`.
- [ ] **S2.3** `escAttr` NO basta para URLs. `<img src>` / `<a href>` / `fetch` solo aceptan: `data:image/webp;base64,`, `data:image/png;base64,`, `blob:`, `https:` explícito. Rechazar `javascript:`, `data:text/html`, `data:image/svg+xml`.
- [ ] **S2.4** Nombres/archivos (`file.name`, `sampleLow`, `modelName`, `originalName`) con longitud máxima y charset `^[\w\-. /\\()\[\]áéíóúñü ]+$`, sin `<>"'&`.
- [ ] **S2.5** Claves API (BYOK) solo en `localStorage`, `input type="password"`, jamás en logs/URL/telemetría.

## 3. Sesión / persistencia (nuestro P0.2 ampliado)

Basado en `src/core/sessionSchema.ts`:

- [ ] **S3.1** Un único `validateSessionPayload` por tipo (sesión, bank, manifest). `restoreBank()` hoy hace `JSON.parse` directo → debe validar igual.
- [ ] **S3.2** Cotras obligatorias:

| campo | límite |
|---|---|
| `id` | 1..128, `^[A-Za-z0-9-_]+$` |
| `name/modelName` | 1..64 (11 en `legacy-neuron`) |
| `sampleLow/High/sampleName` | ≤256, sin `..` ni absoluto |
| `originalName` | ≤128 |
| `webpDataUrl` | `data:image/webp;base64,` + `length ≤ 700_000` (~512 KB) |
| `aiBridgeEndpoint` | ver S4.1 |
| `zones/extendedRegions` | ≤128 / ≤256 |

- [ ] **S3.3** `byteLength/width/height` se recalculan, nunca se confía en el declarado. `width/height 1..2048`.
- [ ] **S3.4** `JSON.parse` siempre en `try`, error genérico al usuario (sin volcar payload).

## 4. SSRF / red

- [ ] **S4.1** `aiBridgeEndpoint`, `BridgeClient.url`, `models/url` validan con `new URL()`: solo `http:/https:`, longitud ≤500, bloquean `169.254.0.0/16`, `10/8`, `172.16/12`, `192.168/16`, `0.0.0.0`, `*.local`, salvo `127.0.0.1:7860` explícito configurado por el usuario.
- [ ] **S4.2** `fetch` a IA con `AbortController` (ya existe: 900 ms health / 4500 ms enhance) + `Content-Length` máximo.
- [ ] **S4.3** `models/url` del bridge: solo `https:` a `huggingface.co`, `github.com`, `raw.githubusercontent.com`, `dl.fbaipublicfiles.com` o allowlist explícita. Sin esto, `urllib.request.urlopen(url)` es SSRF servidor.

## 5. Bridge Python (`bridge/server.py`)

- [ ] **S5.1** CORS: sustituir `*` por origen explícito (`http://localhost:8388`, dominio Vercel). Sin `*` con escritura.
- [ ] **S5.2** Auth mínima: token generado al arrancar (`secrets.tokenUrl`) exigido en cabecera para `POST /fs/*`, `/models/*`, `/enhance`.
- [ ] **S5.3** Antitraversal en `scan`, `save/duplicate/rename`: `abspath` + `commonpath(library_path)`; `slug` solo `^[a-z0-9][a-z0-9-_]{0,63}$`; `rel_path` rechaza `..`, absoluto, `~`, `\\`.
- [ ] **S5.4** Límites: `Content-Length ≤ 150 MB` (ya existe en `/enhance`), `files ≤ 128`, `file ≤ 50 MB`, respuestas `scan` topadas a 500 (ya existe).
- [ ] **S5.5** `log_message` y `X-Text-Prompt` no deben loguear secretos.

## 6. Archivos / formatos (DoS y Zip-Slip)

- [ ] **S6.1** Mantener caps actuales y testearlos en `phase7`: ZIP `2000 entradas / 100 MB por entrada / 300 MB total`, SFZ `2 MB / tope regiones`, SF2 `MAX_SF2_PRESETS ≤ 512` con `safeRecordCount`, WAV rechaza magia/truncado, import `50 MB × 128 ficheros`.
- [ ] **S6.2** Zip-Slip: rechazar entradas con `..`, ruta absoluta, `\\`, o que tras `normalize` escapen de su capa (`01_raw_source/`, …). `isMacOsJunkZipPath` se mantiene.
- [ ] **S6.3** `manifest.json`/`provenance.json` dentro del ZIP se validan (`magic === 'NEURONMM_TIMECAPSULE'`, `schemaVersion === '1.0'`), resto se ignora.
- [ ] **S6.4** `cover.webp` se revalida con `isWebpBytes` + `parseWebpDimensions`, nunca se confía en `coverArtworkMeta` del ZIP.

## 7. Service Worker / build

- [ ] **S7.1** `sw.js` solo cachea `GET` mismo-origen, nunca `POST` ni respuestas con `Authorization`. Versionar `CACHE_NAME`.
- [ ] **S7.2** `vite.config.ts server.fs.allow` mínimo en dev; nunca `['..','../..']` en prod.

## 8. Checklist de aceptación por PR

Todo PR que toque IO externo debe marcar:

- [ ] `npm test` en verde (incluye `phase7_import_robustness`).
- [ ] Grep limpio: `eval\(|new Function|document\.write|<script` en `src/`, `__import__|pickle\.loads|yaml\.load|shell=True|os\.system` en `bridge/`.
- [ ] Nuevo campo de sesión/bank → añadido a `S3.2` + test de rechazo.
- [ ] Nueva ruta bridge → auth + traversal test con `../../`.
- [ ] Nuevo `innerHTML` → `escHtml/escAttr` + test XSS de `phase7` ampliado.

## 9. Tests de regresión a mantener

`tests/phase7_import_robustness.test.ts` es la referencia cross-proyecto. Todo proyecto debe tener su equivalente que pruebe: WAV truncado, SF2 `subSize` absurdo <2 s, ZIP bomba (entry/total caps), SFZ oversize + tope regiones, `escHtml/escAttr` neutralizan `"><img onerror>`, SSRF (`aiBridgeEndpoint=http://169.254.169.254/` rechazado), `webpDataUrl` >700 kB rechazado, `rel_path=../../evil` rechazado.

---

*Espejo sugerido:* copiar este fichero a `ABDShared/docs/SECURITY_STANDARDS.md` (fuera de `vendor/`, para que `vendorSync` pueda distribuirlo sin pisarlo).
