# 🗺️ ABDNeuModMakr — Roadmap

> Plan de desarrollo por fases. Cada fase es funcional por sí misma.

---

## Fase 0 — Shell UI ✅ COMPLETADA

**Objetivo**: Interfaz completa conectada a datos mock, arrancable con `start.bat`.

- [x] Todos los componentes UI (Navbar, ZoneRibbon, ZoneInspector, ProcessPanel, KeyboardStrip, ProcessModal, TelemetryDrawer, BankDrawer)
- [x] CoreService interface + MockCore
- [x] Domain types (Zone, Session, ProcessConfig, etc.)
- [x] Integración con `@abdsynths/shared` (tokens, SynthNavBar, iconos)
- [x] Vite dev server en puerto 8388
- [x] start.bat funcional
- [x] README, .gitignore

---

## Fase 1 — Pipeline de Audio TypeScript ✅ COMPLETADA

**Objetivo**: Análisis espectral real de archivos WAV y AIFF, sin dependencias externas.

### 1.1 Decodificador WAV & AIFF (`src/core/dsp/WavDecoder.ts`)
- [x] Parser de cabeceras RIFF/WAVE (`fmt `, `data`, `smpl`) y FORM/AIFF (`COMM` IEEE 80-bit float, `SSND`, `INST`)
- [x] Soporte PCM: 8, 16, 24, 32 bits + IEEE float 32/64 + `WAVE_FORMAT_EXTENSIBLE`
- [x] Soporte mono y estéreo (downmix a mono `(L + R) * 0.5` para análisis)
- [x] Validación de sample rate y bit depth + generador WAV PCM16 de prueba multi-parcial (`synthesizeDemoWav`)

### 1.2 Motor STFT (`src/core/dsp/FftEngine.ts`)
- [x] Implementación FFT radix-2 Cooley-Tukey en TypeScript puro (sin dependencias)
- [x] Ventanas: Blackman-Harris 4-term (default 8192), Hanning, Blackman, Hamming
- [x] Parámetros configurables: frame size (2048/4096/8192), hop size, overlap
- [x] Output: magnitud + fase por bin de frecuencia y `performFrequencyOnlyForwardTransform` compatible con JUCE

### 1.3 Peak-Picking armónico & Clustering (`src/core/dsp/SpectralAnalyzer.ts`, `LayerClustering.ts`, `GridIndicator.ts`)
- [x] Detección de F0 híbrida: HPS refinado (k=2..4 + escalera de octava débil) + ajuste Least-Squares de 2 pasadas
- [x] Peak-picking armónico (64 parciales) con interpolación parabólica sub-bin en log-magnitud
- [x] Detección de sub-rejilla entrelazada (`f0/2` impares) y puerta de plegado de octava (`kOctaveFoldCents = 50`)
- [x] Clustering de trazas temporales en hasta 4 capas (`propia` / `entrelazada` / envolvente por descriptores o coseno)

### 1.4 Generador de tramas Scape/Sphere (`src/core/dsp/ScapeSphereGenerator.ts`)
- [x] Mapeo de complejidad `1..10` a `recDepth` auténtico de `MODELmaker.exe` (`[1, 4, 8, 12, 16, 24, 32, 42, 54, 64]`)
- [x] Serialización binaria auténtica Neuron `.scape` (`csAN` + `mnAN` + `fdAN` + curva `int16`) y `.sphere` (`psAN` + `mnAN` + `fdAN` + tramas de 6568 B con banco de 1024 parciales `uint16`)
- [x] Generador de `map.script` (`create map` / `add mapentry`) y JSON `.neuronikmodel` v2/v2.1
- [x] Resíntesis aditiva de verificación (`resynthesizeModelToPcm`) y playback con Web Audio API

### 1.5 Web Workers (`src/core/worker/analysisWorker.ts`, `src/core/dsp/PipelineRunner.ts`)
- [x] Worker thread para el pipeline multi-zona completo (no bloquea UI) con fallback en hilo principal
- [x] Protocolo de mensajes tipado: `start`, `progress`, `result`, `error`, `cancel`
- [x] Integración con `ProcessProgress` events de `CoreService` y suite de tests (`tests/phase1_pipeline.test.ts`)

### Entregable
`src/core/WebAudioPipeline.ts` — implementación real de `CoreService` que reemplaza `MockCore` en `src/main.ts`.

---

## Fase 2 — Formatos Binarios y Arquitectura Dual-Target (`.model` Legacy + `.neuronikmodel` Modern) ✅ COMPLETADA

**Objetivo**: Soportar tanto el ecosistema clásico del Hartmann Neuron / `NeuronVS` (`legacy-neuron`) como el formato extendido de alta resolución para la reinterpretación moderna del sintetizador (`modern-neural`), según lo documentado en `DOCS/ARCHITECTURE_DUAL_TARGET.md` y `DOCS/NASANALYSIS_DECOMPILATION.md`.

### 2.1 Fase 2A — Lectores y Empaquetado Estructural
- [x] Especificación verificada de `.scape` (`csAN` + `mnAN` + `fdAN`), `.sphere` (`psAN` + `mnAN` + `fdAN` + frames `step = 16 + nb*paso*4 + 6152`), `map.script`, `MName` y los 20 mapas `mnAN` por `parameterSet` (`0..9`) en `DOCS/NEURON_MM_SPEC.md`
- [x] Selector de perfil de salida en `ProcessConfig`: `targetFormat: 'dual' | 'legacy-neuron' | 'modern-neural'`
- [x] **Reader binario `.model`** (`ModelFormat.ts`): importar archivos `.scape`, `.sphere`, `map.script` y `MName` para inspección, audición y conversión a `.neuronikmodel`
- [x] **Reader/Writer de `.sound`** (`SoundFormat.ts`): esquema completo de 445 parámetros (`sound.script`), migración v1 `BlenderAmount`, clamping `FUN_100014c0` y `sound.stickrec`
- [x] Tests de ida y vuelta (round-trip): `write → read → compare` sobre modelos reales de `NeuronDB` (`511.model` "sinew" y `000.sound` "Symbiont") en `tests/phase2_formats.test.ts`

### 2.2 Fase 2B — Descompilación 100% y Calibración de `NASAnalysis.dll` (REA / Ghidra 12.1.4)
- [x] Desensamblado completo de `FUN_10009cf0` (`analyseSample_core`), `FUN_10003e60` (`createScapeFile`), `FUN_100038f0` (`createSphereFile`) y `FUN_10007e00` (`computePhaseVocoderPartials`) documentado en `DOCS/NASANALYSIS_DECOMPILATION.md`
- [x] Mapeo exacto de `FUN_100028e0` y `FUN_10001880` (`mnAN` y `fdAN` para los 10 `parameterSet`), `paso = 2^(floor(log2(recDepth - 1)) + 1)`, `nb = 61` (`r3 == 0`) vs `nb = 25` (`r3 != 0`) y frecuencias del Phase Vocoder en unidades de `0.5 Hz`

### 2.3 Fase 2C — Puente y Formato Extendido para el Nuevo Sintetizador (`modern-neural`)
- [x] Conversor directo `convertLegacyModelToModern` (`.model` legacy → `.neuronikmodel` v2.1 JSON con preservación de zonas, tramas y parciales)

---

## Fase 3 — Gestión de Archivos, Empaquetado ZIP/Directorio y Persistencia ✅ COMPLETADA

**Objetivo**: Flujo completo de importación por lotes (`Import Samples` vs `Import by Name`), auto-mapeo de zonas, exportación lista para CompactFlash/`NeuronDB` y persistencia local.

- [x] Importación real de archivos WAV/AIFF mediante file picker y Drag & Drop sobre `ZoneInspector` (`Sample A` / `Sample B`) y menú `Import Samples (Ctrl+I)` (chunks `INST` / `smpl` + fallback de pitch por autocorrelación)
- [x] **Auto-asignación inteligente de zonas por nombre de archivo (`Import by Name`, `Ctrl+N`)**: soporte fiel para la convención Hartmann `name_rootkey_lowkey[_v1|_v2]` y `_high` (`parseSampleFilenameByName`), fusión de capas de velocidad (`v1`/`v2`) y partición contigua `0..127`
- [x] **Importador de modelos `.model` / `.zip` existentes desde la UI (`importModelFiles`)**: abrir archivos de `<NNN>.model/` o paquetes `.zip` de `NeuronDB` para reconstruir sus zonas en el `ZoneRibbon`, resintetizar sus `.sphere`/`.scape` a WAV PCM16 reproducible y convertirlos a `.neuronikmodel` v2.1
- [x] **Empaquetador PKZIP (`ZipArchive.ts` + `buildModelExportZip`) `<NNN>.model/` y `<NNN>.sound/`**: descarga directa desde el menú `File -> Transfer / Export Model (.zip)... (Ctrl+T)` y desde `BankDrawer` de la estructura completa (`000001.scape`, `000001.sphere`, `map.script`, `MName`, `sound.script`, `sound.stickrec` y `Modern/<NNN>_<Name>.neuronikmodel`)
- [x] **Persistencia de sesión en `localStorage` y exportación/apertura `.nmsession.json` (`Ctrl+S` / `Ctrl+O`)**: auto-guardado del proyecto activo y biblioteca de modelos generados
- [x] Suite de verificación completa en `tests/phase3_files.test.ts`

### Entregable
Flujo completo de extremo a extremo: arrastrar muestras o modelos existentes → auto-mapear zonas → procesar → audicionar → exportar paquete `.zip` Dual-Target (`.model` + `.sound` + `.neuronikmodel`).

---

## Fase 4 — Visualización Espectral y Preview ✅ COMPLETADA

**Objetivo**: Feedback visual y auditivo del análisis.

- [x] Canvas 2D: espectrograma 2D (`37x96` STFT Blackman-Harris) del sample seleccionado (`src/ui/SpectralView.ts`)
- [x] Overlay interactivo de los 64 parciales armónicos detectados sobre el espectrograma, coloreados por capa clusterizada (`Layer 0`, `Layer 1`, `Layer 2`)
- [x] Visualización de la reconstrucción (`WAVEFORM A/B` split view: envolvente original vs resíntesis aditiva multi-capa + comparativa RMS dB, y `64 PARTIALS` con overlay FFT en tiempo real)
- [x] Playback de preview con Web Audio API (`A: Original` y `B: Resynthesis` con pitch-tracking al `KeyboardStrip` y botón `Stop`)
- [x] Indicadores de nivel (`dBFS` meter a 60fps) y espectro en tiempo real (`AnalyserNode` de 2048 puntos)
- [x] Suite de verificación completa en `tests/phase4_spectral.test.ts`

### Entregable
`src/ui/SpectralView.ts`, integrado bajo `ZoneInspector` y sincronizado con `KeyboardStrip` y `ProcessPanel`.

---

## Fase 5 — UX Avanzada ✅ COMPLETADA

**Objetivo**: Calidad de producción en la experiencia de usuario.

- [x] Undo/Redo stack (`undoStack` / `redoStack` de hasta 50 snapshots en `WebAudioPipeline.ts` con coalescencia automática de 450 ms al arrastrar sliders)
- [x] Atajos de teclado completos (`Ctrl+Z` Undo, `Ctrl+Y` / `Ctrl+Shift+Z` Redo, `Ctrl+S` Save, `Ctrl+O` Open, `Ctrl+I` Import Samples, `Ctrl+N` Import by Name, `Ctrl+P` / `Ctrl+Enter` Process, `Ctrl+T` Transfer ZIP, `Ctrl+B` Bank, `Ctrl+L` Logs, `Insert` Split Zone, `Delete` / `Backspace` Remove Zone, `ArrowLeft` / `ArrowRight` seleccionar zona, `Space` Play/Stop A/B preview)
- [x] Botones de Undo/Redo con tooltips dinámicos en `Navbar` y acciones en el menú `Edit`
- [x] División rápida en `ZoneRibbon` mediante `Double-Click` o `Alt+Click` sobre el punto exacto de la zona
- [x] Validación en tiempo real sin pérdida de foco en `ProcessPanel` y `ZoneInspector` (contador `11` chars para hardware legacy `MName` vs `32` chars para `modern-neural`, rango de slot `0..511`, indicador de `stickModes` / `recDepth`, y botón de **Auto-Reparación en 1 clic (`autoRepairCoverage`)** para huecos/solapes en `0..127`)
- [x] Suite de verificación completa en `tests/phase5_ux.test.ts`

---

## Fase 5B — Convergencia Visual y Gráfica con `ABDShared` (`@abdsynths/shared`) ✅ COMPLETADA

**Objetivo**: Unificar visualizadores gráficos y hojas de estilo con la biblioteca común `@abdsynths/shared` (`D:\desarrollos\ABDSynths\ABDShared`).

- [x] **Componentes gráficos y visualizadores en `ABDShared`**:
  - [x] Auditar qué visualizadores / gráficas existen ya en `ABDShared` (`SpectrumPlotter`, `VuMeter`, `createAboutDialog`, `BaseRenderer`) y reutilizar `SpectrumPlotter` (pestaña `LOG CURVE`) y `createAboutDialog` en `SpectralView.ts` y `Navbar.ts`.
  - [ ] Evaluar en una fase posterior qué gráficos específicos de `ABDNeuModMakr` (espectrograma 2D con trazas de parciales por capa, comparador de ondas A/B, barras de 64 parciales) conviene extraer y promover a `@abdsynths/shared` cuando se inicie `ABDNeural` / `NEURONiK`.
- [x] **Auditoría y normalización de CSS frente a `ABDShared`**:
  - [x] Revisar `src/style.css` para asegurar el uso estricto de los design tokens de `@abdsynths/shared/styles/tokens.css`.
  - [x] Eliminar el 100% de colores hardcodeados (`#hex`, `rgb()`, `rgba()`) tanto en `src/style.css` como en el renderizado Canvas de `SpectralView.ts` (`resolveThemeToken` sobre variables CSS del tema).
  - [x] Consolidar estilos atomizados o duplicados y añadir la tabla multi-zona canónica de 9 columnas (`ZoneTableModel`: `Zone`, `Low Key`, `Root Key`, `High Key`, `Low Vel`, `High Vel`, `Detune`, `Volume`, `Pan`) con octavas y rangos canónicos (`0 C-2 .. 127 G8`).

---

## Fase 6 — WASM / C++ (Opcional)

**Objetivo**: Aceleración nativa para batch processing.

- [ ] Compilar el core C++ existente (si hay) a WASM con Emscripten
- [ ] O reimplementar FFT/peak-picking en C++20 portable
- [ ] Interfaz wasm-bindgen → `WasmCore` implementando `CoreService`
- [ ] CLI standalone para procesamiento por lotes (Node.js + WASM)
- [ ] Benchmarks: TypeScript vs WASM en diferentes tamaños de sample

---

## Fase 7 — Testing y CI/CD

**Objetivo**: Garantizar calidad y estabilidad.

- [ ] Tests unitarios: WAV decoder, FFT, peak-picker, format writers
- [ ] Tests de integración: pipeline completo (WAV → .model)
- [ ] Tests E2E con Playwright: flujo completo de UI
- [ ] GitHub Actions: build + test en push/PR
- [ ] Lint (ESLint) + format (Prettier)
- [ ] Lighthouse CI para performance web

---

## Fase 8 — Distribución

**Objetivo**: Publicar como aplicación standalone.

- [ ] Build de producción optimizado (Vite build)
- [ ] Empaquetado Electron o WebView2 (opcional, para distribución desktop)
- [ ] Generación de instalador Windows (NSIS o similar)
- [ ] Landing page del proyecto
- [ ] Documentación de usuario (guía paso a paso)

---

## Prioridades técnicas transversales

| Prioridad | Descripción |
|---|---|
| 🔴 Alta | Pipeline de audio TS (Fase 1) — es el corazón de la app |
| 🔴 Alta | Formatos .model/.sound (Fase 2) — sin esto no hay output útil |
| 🟡 Media | Gestión de archivos (Fase 3) — para flujo real de trabajo |
| 🟡 Media | Visualización espectral (Fase 4) — feedback esencial |
| 🟢 Baja | WASM (Fase 6) — optimización, no bloqueante |
| 🟢 Baja | Distribución (Fase 8) — cuando todo lo demás funcione |
