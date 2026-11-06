# Estándares de Seguridad ABDSynths — Todos los proyectos

> **Ámbito:** todo software ABDSynths (web, bridge local, formatos, plugins JUCE/C++).
> **Origen:** auditoría 2026-10-30 de ABDNeuModMakr (XSS, SSRF, traversal, DoS ZIP/sesión).
> **Verificación 2026-11-06:** auditoría completa control por control contra el código + corrección de 7 hallazgos + `tests/security_hardening.test.ts` ampliado a 12 checks (incl. bridge en vivo). Casillas marcadas = verificado con evidencia citada.
> **Red-team 2026-11-06 (segunda oleada):** ataque adversarial real — 2 vulnerabilidades nuevas encontradas y cerradas (bypass SSRF por IPv6, contrabando en `manifest.json`), batería XSS/SSRF/traversal contra parsers, ataques vivos al bridge y PoC en navegador (XSS buscador + envenenamiento de `localStorage`, ambos neutros). Suite ampliada a 15 checks.
> **Red-team 2026-11-06 (tercera oleada):** 2 hallazgos más, ambos reales y cerrados — **bomba ZIP** (299 KB → 300 MB de RAM medidos; ahora tope por cabecera, rechazo en 63 ms) y **diálogo nativo del SO disparable por CSRF** (`<img src="...browse_folder">` sin token), más endurecimiento de la citación PowerShell. Suite ampliada a 17 checks.
> **Red-team 2026-11-06 (cuarta oleada, decodificadores de audio):** 2 hallazgos más, ambos reales y medidos — **bomba SF2** (344 bytes → **RSS 83→656 MB**; `smpl/subSize` + `shdr.end` u32 sin acotar → `new Float32Array(100M)`) y **bomba CAF** (168 bytes → intento de reserva de GB + RangeError garantizado; `framesPerPacket` multiplicador u32 + `numChannels` sin tope). WAV/AIFF/FLAC verificados acotados por bytes reales. Compuertas en `src/core/dsp/WavDecoder.ts` (único punto de paso: todo el `src` importa de ahí) y `src/formats/Sf2Parser.ts`; SF2/CAF legítimos verificados por el mismo camino. Suite ampliada a 19 checks.
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

- [x] **S2.1** Nunca `eval`, `new Function`, `setTimeout(string)`, `document.write`, `<script` literal en `src/`. Verificado por `scripts/security-grep.mjs` (`npm run lint:security`, en `verify`/CI) — 2026-11-06: añadidas reglas `setTimeout(string)` y `<script` (§8); gate verde.
- [x] **S2.2** Todo `innerHTML` con datos externos usa `escHtml/escAttr` de `src/ui/escape.ts`. Texto puro → `textContent`. Auditoría 2026-11-06 (111 sitios): `notify` usa `textContent`; vendor `bankCard.js` escapa (`escAttr/escText`); `NeuronDbModal/ZoneInspector/chopper/recorder` escapan nombres de fichero/muestra. **Corregido 2026-11-06:** `filterQuery` sin escapar en 3 `emptyMsg` de `BankDrawer.ts` (XSS reflejado vía buscador) → `escHtml`; `providerKeyStatus.message`, `bankName/license/meta` (`RawSamplerExportModal`, antes `replace(/"/g)` manual) y `err` (`TelemetryDrawer`) → `escHtml/escAttr`. Ayuda manual: `scripts/audit-innerhtml.mjs` (no en gate: el patrón compone HTML ya escapado en helpers).
- [x] **S2.3** `escAttr` NO basta para URLs. `<img src>` solo con `webpDataUrl` validado en carga (`validateWebpDataUrl`: prefijo + ≤700 kB) o `isSafeCoverDataUrl` (bank). **Corregido 2026-11-06:** `sourceUrl` llegaba sin validar a `<a href>` (`zoneTemplates.ts:1167`, stored-XSS vía `.nmsession`/SFZ) → nuevo `validateSourceUrl` (solo `http(s)`, ≤500 chars, rechaza `javascript:/data:/ftp:`) aplicado en `sessionSchema` + compuerta de render `^https?://`. **Red-team: contrabando en `manifest.json`** — `modelImportService` copiaba `masterWaveConfig.aiBridgeEndpoint` y `coverArtwork` del ZIP a la sesión viva sin pasar por schema → nuevo `sanitizeImportedProcessConfig` (misma frontera, fail-safe). Test 14 + PoC en navegador (localStorage envenenado → registros rechazados, app intacta). `fetch` solo contra URLs constantes o `validateBridgeUrl`.
- [x] **S2.4** Nombres/archivos con longitud máxima y charset (`^[\w\-. /\\()\[\]áéíóúñü ]+$`, sin `<>`). Verificado 2026-11-06: `isSafeSampleName` exigido en frontera de sesión (`sampleLow/High`, `extendedRegions[].sampleName`) y render con `escHtml/escAttr` (`basenameOf`); `modelName` (≤64/11) y `originalName` (≤128) validados en schema; `isSafeBankRecord` rechaza `<>`.
- [x] **S2.5** Claves solo en `localStorage` (`STORAGE_KEY_BYOK`), inputs `type="password"` con toggle (`tabCloud.ts`, `tabBridge.ts`), sin `console.*` con claves (verificado por grep) y sin envío a servidores propios (fetch directo al proveedor).

## 3. Sesión / persistencia (nuestro P0.2 ampliado)

Basado en `src/core/sessionSchema.ts`:

- [x] **S3.1** `parseSessionJson` valida sesión completa. `restoreBank()` filtra con `isSafeBankRecord` (slot 0..511, nombre ≤64 sin `<>`, cover allowlist). **Corregido 2026-11-06:** `restoreSublibraries()` solo comprobaba `typeof name` → nuevo `isSafeSublibraryName` (mismo charset que `SUBLIBRARY_RE` del bridge + anti-`..`).
- [x] **S3.2** Cotas obligatorias (verificadas 2026-11-06 en `sessionSchema.ts`, coinciden con el código):

| campo | límite |
|---|---|
| `id` | 1..128, `^[A-Za-z0-9-_]+$` |
| `name/modelName` | 1..64 (11 en `legacy-neuron`) |
| `sampleLow/High/sampleName` | ≤256, sin `..` ni absoluto |
| `originalName` | ≤128 |
| `webpDataUrl` | `data:image/webp;base64,` + `length ≤ 700_000` (~512 KB) |
| `aiBridgeEndpoint` | ver S4.1 |
| `zones/extendedRegions` | ≤128 / ≤256 |

- [x] **S3.3** `byteLength` se recalcula/clampa (≤1 MB), `width/height` del cover vienen de `parseWebpDimensions` (bytes reales) o del schema validado; `parseWebpDimensions` devuelve 512 por defecto ante bytes inválidos (fail-closed en dimensiones).
- [x] **S3.4** `JSON.parse` en `try` en sesión/bank/sublibraries/manifest/provenance; `fieldError` genérico sin volcar payload (verificado por inspección 2026-11-06).

## 4. SSRF / red

- [x] **S4.1** `validateAiBridgeEndpoint` y `validateBridgeUrl`: solo `http(s)`, ≤500, sin credenciales en URL, bloqueo de rangos privados/link-local salvo loopback. **Red-team: bypass real por IPv6** (`::ffff:10.0.0.1`, `fe80::/10`, `fc00::/7`, `::` pasaban como "públicos") → nuevo `src/core/security/ssrf.ts` (`isBlockedHostname`: mapea `::ffff:` a IPv4 y aplica los mismos rangos, fail-closed) usado por ambas fronteras. Decimal/hex/octal (`2130706433`) ya los normaliza WHATWG a `127.0.0.1`. Cubierto por test 13 (9 vectores IPv6 + loopback/público intactos).
- [x] **S4.2** `AbortController` en bridge (`bridgeAudio/Library/Models`, `MasterWaveEnhancer`). **Corregido 2026-11-06:** `CloudByokClient` hacía ~15 `fetch` sin timeout (un proveedor colgado congelaba la UI) → nuevo `fetchWithTimeout(url, init, 30 s)` en todos + `safeErrorSnippet` (errores truncados a 300 chars). Test 10 (aborto ante cuelgue + truncado).
- [x] **S4.3** `is_allowed_custom_url`: solo `https:` a `huggingface.co`, `github.com`, `raw.githubusercontent.com`, `dl.fbaipublicfiles.com` (verificado por inspección 2026-11-06; `urlopen` con timeout 7–30 s).

## 5. Bridge Python (`bridge/server.py`)

- [x] **S5.1** CORS allowlist (`ALLOWED_ORIGINS`: localhost/127.0.0.1:8388+7860, Vercel prod) + `Vary: Origin`; sin `*` (verificado 2026-11-06).
- [x] **S5.6** **Corregido 2026-11-06 (red-team, ola 2):** `/api/fs/browse_folder` abría un diálogo **nativo del SO** sin token y por `GET` — una web hostil lo disparaba con `<img src="http://127.0.0.1:7860/api/fs/browse_folder">`, sin CORS ni preflight (efecto lateral remoto + DoS de 120 s de diálogo modal). Ahora `require_auth()` en `GET` y `POST` (test 17). Además el fallback PowerShell interpolaba `title`/`start_dir` en comillas dobles, donde `` ` `` y `$(...)` **expanden** → se citan en comillas simples PowerShell con `''` duplicada (S5.5, sin ejecución posible).
- [x] **S5.2** Defensa en capas (verificado 2026-11-06, test 12 en vivo): token `X-Bridge-Token` generado al arrancar (`secrets.token_hex(16)`), exigido en `POST /fs/*`, `/models/*`, `/enhance`, etc. cuando se fija `ABD_BRIDGE_TOKEN` (UX documentada en Settings); **NUEVO default-on:** `check_post_origin` → `403` ante `Origin` no allowlistado (mata el blind-CSRF de webs maliciosas aunque no haya token; `curl`/sin-Origin siguen pasando); preflight anuncia `X-Bridge-Token` (**corregido:** faltaba en `Allow-Headers` y el token opt-in no viajaba desde el navegador).
- [x] **S5.3** `safe_join` (`abspath`+prefijo), `is_safe_slug`, `is_safe_sublibrary`, `is_safe_rel_path` (anti-`..`/absoluto/`~`/`\\`/`\0`) aplicados en `save/move/duplicate/rename/delete` (verificado por inspección 2026-11-06; `library_path` arbitrario es intencional: equivale al file-picker, protegido por S5.2).
- [x] **S5.4** **Corregido 2026-11-06:** solo `/enhance` topaba el cuerpo; `decode-rx2/separate-stems/align-phonemes` leían `Content-Length` sin cota (DoS de memoria) → cap global `MAX_POST_BODY_BYTES = 150 MB` con `413` antes de leer + `files ≤ 128`, `file ≤ 50 MB`, `scan` topado a 500. Verificado en vivo (test 12c).
- [x] **S5.5** `log_message` solo registra método/ruta/estado; el `token` de `/enhance` y las BYOK nunca se loguean (verificado por grep 2026-11-06); `X-Text-Prompt` es texto del usuario, no credencial.

## 6. Archivos / formatos (DoS y Zip-Slip)

- [x] **S6.1** Caps testeados en `phase7` (`MAX_ZIP_ENTRIES`, `MAX_SFZ_TEXT_BYTES/REGIONS`, `MAX_SF2_PRESETS` con `safeRecordCount`, WAV magia/truncado) + `MAX_IMPORT_FILE_BYTES 50 MB × 128` (`modelImportService`, test `phase0`). **Corregido 2026-11-06 (red-team, ola 2) — bomba ZIP real:** los topes del vendor (5000 entradas / **800 MB por entrada** / 1 GB total) permitían que **299 KB** en disco forzaran `new Uint8Array(300MB)` en `inflateRaw` → medido: **RSS 83 → 685 MB** en 1,4 s (y la bomba cabe en un email). Nueva compuerta de proyecto en `src/formats/ZipArchive.ts`: `APP_MAX_ZIP_ENTRIES 2000`, `APP_MAX_ZIP_ENTRY_BYTES 100 MB`, `APP_MAX_ZIP_TOTAL_BYTES 300 MB`, verificada **solo con la cabecera central** (sin inflar) por `assertZipIndexWithinCaps`; aplicada en `parseZipArchiveCapped` (`timeCapsule`, `triageOps`, `batchQueueOps`) y en `neuronBankImporter`. También rechaza la evasión por descriptor-bit (method 8 con datos y 0 bytes declarados, que esquivaba el tope). Medido post-fix: rechazo en **63 ms**, RSS plano (65→67 MB). Test 16a–16d.
- [x] **S6.2** `isUnsafeZipPath` en `extractTimeCapsuleFromFiles` (anti-`..`/absoluto/`\0`/>512 chars) + `isUnsafeZipPath` del vendor; junk macOS (`__MACOSX/`, `._*`, `.DS_Store`) ignorado. Test 6 + phase7.
- [x] **S6.3** `magic === 'NEURONMM_TIMECAPSULE'` y `provenance.schemaVersion === '1.0'` exigidos; resto se ignora sin lanzar (verificado por inspección + test 6).
- [x] **S6.4** **Corregido 2026-11-06:** el `cover.webp` del ZIP se adoptaba sin comprobar magia → compuerta `isWebpBytes` en `extractTimeCapsuleFromFiles` (test 11: bytes falsos rechazados, RIFF/WEBP adoptado). `parseWebpDimensions` fail-closed en dimensiones.
- [x] **S6.5** **Corregido 2026-11-06 (red-team, ola 4):** DoS de memoria en decodificadores — **SF2**: `smpl/subSize` + `shdr.end` (u32 sin acotar) → 344 bytes forzaban `new Float32Array(100M)` (medido: RSS 83→656 MB). **CAF**: `framesPerPacket` (multiplicador u32) + `numChannels` (sin tope) → 168 bytes pedían GB. WAV/AIFF/FLAC verificados acotados por bytes reales. Compuertas de proyecto (vendor intacto): `assertSf2SampleBoundsSafe` + `importSf2PresetToNativeCapped` (`src/formats/Sf2Parser.ts`, registro terminal exento, +64 de tolerancia EOS) y `assertCafDescSafe` + `decodeWav/decodeAiff/decodeCaf/decodeFlac/transcode…` capados (`src/core/dsp/WavDecoder.ts`, único punto de paso de todo `src`); topes: 32 canales, 128 M frames, 512 M muestras totales. Test 19a–19f (bombas reales + legítimos por el mismo camino).

## 7. Service Worker / build

- [x] **S7.1** `sw.js` solo `GET` mismo-origen (navegación Network-First, `/assets/` Cache-First, resto SWR), sin `Authorization` en la app; `CACHE_NAME` versionado (`v1.2.0`) con purga de viejas. Verificado por inspección 2026-11-06.
- [x] **S7.2** `server.fs.allow = [repo root]` (solo dev); proxy `/api/proxy/replicate` solo en dev. Verificado 2026-11-06.

## 8. Checklist de aceptación por PR

Todo PR que toque IO externo debe marcar:

- [x] `npm test` en verde (incluye `phase7_import_robustness` + `security_hardening` 12/12).
- [x] Grep limpio vía `scripts/security-grep.mjs`: `eval\(|new Function|document\.write|setTimeout(string)|<script|@ts-ignore` en `src/`, `shell=True|os\.system|pickle\.loads|yaml\.load` en `bridge/`.
- [x] Nuevo campo de sesión/bank → añadido a `S3.2` + test de rechazo (práctica aplicada: `sourceUrl` + `validateSourceUrl` + test 7/8).
- [x] Nueva ruta bridge → auth + traversal test con `../../` (práctica aplicada: `check_post_origin` + cap 150 MB + test 12 en vivo).
- [x] Nuevo `innerHTML` → `escHtml/escAttr` + test XSS (práctica aplicada: `filterQuery`/mensajes/bankName + tests 7–11; ayuda: `scripts/audit-innerhtml.mjs`).

## 9. Tests de regresión a mantener

`tests/phase7_import_robustness.test.ts` es la referencia cross-proyecto, complementada por `tests/security_hardening.test.ts` (19/19 2026-11-06: SSRF IPv4+IPv6, cotas cover/sesión, traversal, cover allowlist, Bridge URL, `sourceUrl`, sublibraries, `fetchWithTimeout`, cover ZIP, manifest smuggling, **bomba ZIP real (299 KB → 300 MB, rechazo por cabecera en 63 ms)**, **diálogo nativo sin token**, **bombas SF2 (344 B → 656 MB RSS) y CAF (168 B → 500M frames) rechazadas por cabecera**, y bridge en vivo 403/413/preflight/CSRF/traversal/slug/URL/401). Todo proyecto debe tener su equivalente que pruebe: WAV truncado, SF2 `subSize` absurdo <2 s, ZIP bomba (entry/total caps), SFZ oversize + tope regiones, `escHtml/escAttr` neutralizan `"><img onerror>`, SSRF (`aiBridgeEndpoint=http://169.254.169.254/` y `http://[::ffff:10.0.0.1]/` rechazados), `webpDataUrl` >700 kB rechazado, `rel_path=../../evil` rechazado.

---

*Espejo sugerido:* copiar este fichero a `ABDShared/docs/SECURITY_STANDARDS.md` (fuera de `vendor/`, para que `vendorSync` pueda distribuirlo sin pisarlo).
