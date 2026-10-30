# ABDNeuModMakr - Handoff

> Estado del proyecto a **2026-10-30**. Lee este archivo al inicio de cualquier conversacion nueva para obtener contexto completo.

---

## 1. Que es ABDNeuModMakr

Reinterpretacion moderna del **Hartmann Neuron MODELmaker v1.2** como aplicacion web autonoma (no plugin DAW). Analiza muestras de audio, particiona el teclado MIDI 0..127 en zonas y genera modelos multidimensionales compatibles tanto con el hardware Neuron original como con el sintetizador software ABDAxionikVS.

### Decision arquitectonica clave: "Separado y Web"

- **Autonomo**: Frontend estatico ejecutable tanto en navegador (Vercel SPA / PWA) como en local (Vite).
- **Pipeline Hibrido**:
  1. TypeScript nativo con Web Workers y Web Audio API para DSP determinista de tiempo real.
  2. Motor de Inteligencia Artificial de 3 niveles: WebGPU/WASM en cliente, Cloud BYOK (Replicate/Hugging Face/Gemini) y Local Companion Bridge (PyTorch/CUDA en GPU local).
- La interfaz de usuario se comunica **exclusivamente** a traves de la interfaz `CoreService` -- desacoplamiento total entre UI y motores de computacion.

---

## 2. Stack tecnologico

| Capa | Tecnologia | Notas |
|---|---|---|
| Build tool | **Vite 8.3** | Puerto fijo `8388`, `strictPort: true` |
| Lenguaje | **TypeScript 6.0** | Strict, `erasableSyntaxOnly` |
| Diseno | `@abdsynths/shared` (workspace pnpm) | `tokens.css`, 6 familias de skins hardware (claro/oscuro), `SynthNavBar` |
| Iconos | SVG vectoriales en `ABDShared/Assets/icons` | Politica estricta: Zero Emojis, `currentColor` |
| Motor IA Cliente | **WebGPU + WebAssembly SIMD** | Aceleracion directa en navegador con fallback a DSP matematico |
| Cloud BYOK | Fetch directo a APIs de inferencia | Claves almacenadas exclusivamente en `localStorage` del cliente |
| Companion Bridge | Python 3.10+ / FastAPI | Servidor local `http://127.0.0.1:7860` con aceleracion CUDA/MPS |
| Persistencia | `IndexedDB` (`NeuronAssetStore`) + `localStorage` | Audio 24b/96k en IndexedDB; preferencias ligeras en localStorage |
| Monorepo | `pnpm-workspace.yaml` en `D:\desarrollos\ABDSynths` | `ABDShared` como `@abdsynths/shared` con sincronizador `npm run vendor:sync` |

---

## 3. Estructura actual del proyecto

```
ABDNeuModMakr/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── start.bat                   <- Lanzador maestro: arranca Bridge en background + Vite
├── run_bridge.bat              <- Lanzador independiente del servidor Python
├── .gitignore
├── README.md                   <- Documentacion principal de arquitectura y uso
├── roadmap.md                  <- Estado de fases y plan maestro
├── handoff.md                  <- Documento de traspaso y contexto de sesion
├── bridge/
│   ├── server.py               <- Companion Bridge local (FastAPI / PyTorch CUDA)
│   └── README.md               <- Especificacion de endpoints y arranque
├── DOCS/
│   ├── NEURON_MM_SPEC.md       <- Especificacion de ingenieria inversa Neuron original
│   ├── ARCHITECTURE_DUAL_TARGET.md <- Diseno Dual-Target (legacy-neuron vs modern-neural)
│   ├── NASANALYSIS_DECOMPILATION.md <- Descompilacion completa de NASAnalysis.dll (Ghidra REA)
│   └── NEXTGEN_ARCHITECTURE_AND_SPEC.md <- Especificacion maestra de fases avanzadas
├── tests/
│   ├── run_all.ts              <- Runner unificado de pruebas
│   ├── phase1_pipeline.test.ts <- Tests de pipeline DSP y FFT
│   ├── phase2_formats.test.ts  <- Tests de formatos binarios .scape, .sphere, .sound
│   ├── phase3_files.test.ts    <- Tests de empaquetado ZIP y sesiones
│   ├── phase4_spectral.test.ts <- Tests de analizador espectral 2D y parciales
│   ├── phase5_ux.test.ts       <- Tests de Undo/Redo y atajos
│   ├── phase6_units.test.ts    <- Tests de SF2, SFZ, MasterWave, Time Capsule y Cloud BYOK
│   └── phase13_loop_editor.test.ts <- Tests del editor visual interactivo de loops
├── src/
│   ├── main.ts                 <- Orquestacion de eventos y ciclo de vida de la aplicacion
│   ├── style.css               <- Master stylesheet responsivo con container queries y tokens
│   ├── core/
│   │   ├── CoreService.ts      <- Contrato abstracto UI <-> Engine
│   │   ├── types.ts            <- Definiciones de dominio (Zone, Region, Session, Model)
│   │   ├── WebAudioPipeline.ts <- Implementacion principal de CoreService
│   │   ├── MockCore.ts         <- Mock de referencia
│   │   ├── extendedAdapter.ts  <- Compilador bidireccional Classic <-> Extended
│   │   ├── sessionSchema.ts    <- Esquema y validacion de sesiones .nmsession
│   │   ├── bridge/
│   │   │   └── BridgeClient.ts     <- Cliente HTTP/SSE para Companion Bridge local (7860) y escaneo de disco
│   │   ├── ai/
│   │   │   ├── WebNeuralEngine.ts  <- Deteccion WebGPU / SIMD y andamiaje de conectividad
│   │   │   └── CloudByokClient.ts  <- Cliente BYOK para inferencia serverless en la nube (Replicate/HF/Gemini)
│   │   ├── cache/
│   │   │   └── HashCache.ts        <- Dirty tracking y cache por huella SHA-256
│   │   ├── storage/
│   │   │   └── NeuronAssetStore.ts <- Almacenamiento binario IndexedDB
│   │   ├── dsp/
│   │   │   ├── WavDecoder.ts           <- Decodificador/Codificador WAV/AIFF PCM 16/24/32 y Float
│   │   │   ├── FftEngine.ts            <- FFT Radix-2 Cooley-Tukey + ventanas + STFT
│   │   │   ├── SpectralAnalyzer.ts     <- Detector F0 + 64 parciales + sub-rejilla
│   │   │   ├── LayerClustering.ts      <- Agrupamiento espectral en hasta 4 capas
│   │   │   ├── GridIndicator.ts        <- Metricas de residuo y calidad espectral
│   │   │   ├── ScapeSphereGenerator.ts <- Serializacion binaria .scape y .sphere
│   │   │   ├── AcousticIntelligence.ts <- Detector YIN/MPM y clasificador de 10 Parameter Sets
│   │   │   ├── MasterWaveEnhancer.ts   <- Upsampling 24b/96k, expansion de loops y surround
│   │   │   └── PipelineRunner.ts       <- Coordinador DSP multi-zona
│   │   └── worker/
│   │       └── analysisWorker.ts       <- Web Worker no bloqueante para analisis espectral
│   ├── formats/
│   │   ├── ModelFormat.ts      <- Parser/Writer .scape, .sphere, map.script, MName, ModelNames
│   │   ├── SoundFormat.ts      <- Parser/Writer sound.script (445 params) y sound.stickrec
│   │   ├── ZipArchive.ts       <- Lector/Escritor PKZIP puro sin dependencias externas
│   │   ├── Sf2Parser.ts        <- Parser SoundFont 2 con fusion automatica de pares estereo
│   │   ├── SfzParser.ts        <- Parser de definiciones SFZ y mapeo de opcodes
│   │   └── coverArtwork.ts     <- Procesador Canvas WebP 512x512 para artwork de modelos
│   └── ui/
│       ├── Navbar.ts               <- Barra de navegacion con selector de skin y pills de estado
│       ├── ZoneRibbon.ts           <- Cinta visual de zonas del teclado MIDI 0..127
│       ├── ZoneInspector.ts        <- Editor de zona/region con pestanas General y Extended
│       ├── WaveformLoopEditor.ts   <- Editor visual interactivo de bucles con zoom y snap ZC
│       ├── SpectralView.ts         <- Monitor espectral 2D, parciales y comparacion A/B/C
│       ├── ProcessPanel.ts         <- Panel de parametros de modelo y exportacion
│       ├── KeyboardStrip.ts        <- Teclado de piano virtual interactivo
│       ├── ProcessModal.ts         <- Dialogo de progreso de resintesis y descarga de modelos
│       ├── TelemetryDrawer.ts      <- Panel de auditoria de cobertura y diagnostico
│       ├── BankDrawer.ts           <- Biblioteca de modelos, presets y exportacion
│       └── icons.ts                <- Libreria SVG vectorial (currentColor, zero emojis)
```

---

## 4. Que ESTA hecho

- [x] **Arquitectura y UI**:
  - [x] 11 componentes de interfaz conectados reactivamente a `WebAudioPipeline`.
  - [x] Selector dual de skins de hardware con modo claro y oscuro para 6 familias: Hartmann Neuron (`neuron-light` por defecto, `neuron-dark`), Moog Voyager, Roland Jupiter-8, Sequential Prophet-5, Oberheim OB-Xa y Korg MS-2000.
  - [x] Politica estricta de Cero Emojis en toda la aplicacion y documentacion.
- [x] **Fase 1 -- Pipeline de audio TypeScript (`WebAudioPipeline`)**:
  - [x] Decodificador WAV/AIFF nativo, FFT Radix-2 Cooley-Tukey, detector F0 HPS + Least-Squares.
  - [x] Peak-picking de 64 parciales, sub-rejilla entrelazada f0/2 y clustering de 4 capas.
  - [x] Serializacion binaria `.scape` (`csAN`) y `.sphere` (`psAN`) con banco aditivo Phase Vocoder.
  - [x] Web Worker no bloqueante (`analysisWorker.ts`) y resintesis aditiva de verificacion.
- [x] **Fase 2 -- Formatos binarios `.model` y `.sound` + Descompilacion NASAnalysis.dll**:
  - [x] Descompilacion al 100% de `NASAnalysis.dll` con REA/Ghidra 12.1.4 (constantes, direccionamiento y algoritmos).
  - [x] Lector/Escritor de `map.script` (1027 lineas canonicas), `MName`, `ModelNames` y `SoundNames`.
  - [x] Esquema completo de 445 parametros de `sound.script`, clamping `FUN_100014c0` y `sound.stickrec`.
- [x] **Fase 3 -- Gestion de archivos, empaquetado PKZIP y sesiones**:
  - [x] Lector/Escritor PKZIP puro (`ZipArchive.ts`) sin dependencias externas.
  - [x] `Import by Name` (`Ctrl+N`) con division inteligente de notas y velocidades vs `Import Samples` (`Ctrl+I`).
  - [x] Importacion directa de `.model` / `.zip` con resintesis a PCM reproducible y sesiones `.nmsession.json`.
- [x] **Fase 4 -- Monitor Espectral 2D y comparador A/B**:
  - [x] Espectrograma STFT 37x96 en Canvas 2D con overlay de parciales por capa.
  - [x] Comparacion de audicion A (original) vs B (resintesis) con vumetro dBFS en tiempo real.
- [x] **Fase 5 -- UX avanzada y atajos**:
  - [x] Pila Undo/Redo con coalescencia automatica de sliders (450 ms).
  - [x] Auto-reparacion de cobertura MIDI 0..127 (`autoRepairCoverage()`) en un solo clic.
- [x] **Fase 6 -- Modo Dual Classic / Extended e importadores SF2 / SFZ**:
  - [x] Conmutacion libre `workingMode: 'classic' | 'extended'` con adaptacion automatica bidireccional.
  - [x] Parser SF2 (`Sf2Parser.ts`) con emparejamiento estéreo automatico, captura de envolventes DAHDSR, filtro y LFO.
  - [x] Parser SFZ (`SfzParser.ts`) y compilador de reduccion a formato clasico con compensacion de ganancia.
- [x] **Fase 7 -- Inteligencia acustica y Classic Enhanced**:
  - [x] Detector F0 YIN/MPM en dominio temporal + ajuste Least-Squares espectral.
  - [x] Descriptores acusticos (ataque, inarmonicidad B, centroide, flatness, ZCR, armonicidad).
  - [x] Clasificacion automatica de Tipo de Instrumento y seleccion de los 10 Parameter Sets oficiales (0..9).
  - [x] Algoritmo `Classic Enhanced` con supresion de ruido y comparador de audicion A/B/C.
- [x] **Fase 8 -- Master Wave 24-bit / 96 kHz, expansion de loops y surround**:
  - [x] Estandar maestro de audio a 24-bit PCM / 96.000 Hz en `WavDecoder.ts` y `MasterWaveEnhancer.ts`.
  - [x] Expansion inteligente de loops cortos con desenrollado organico y busqueda de cruce por cero optimo.
  - [x] Espacializacion estéreo / quad surround y downmixing determinista.
- [x] **Fase 9 -- Capsula del tiempo de 5 capas (`.nmpack` / ZIP unificado)**:
  - [x] Estructura multiformato: `01_raw_source`, `02_legacy_original`, `03_enhanced_audio`, `04_classic_enhanced`, `05_extended_model` y `provenance.json` anti-degradacion acumulativa.
  - [x] Almacenamiento binario persistente en `IndexedDB` (`NeuronAssetStore`).
- [x] **Fase 10 -- Despliegue en la nube, PWA y Companion Bridge**:
  - [x] Despliegue como Single Page Application en Vercel (`https://abd-neumodmakr.vercel.app/`).
  - [x] Manifiesto PWA y Service Worker para uso completo sin conexion.
  - [x] Script `vendor:sync` para sincronizar dependencias de `@abdsynths/shared` sin rutas externas rotas en CI.
- [x] **Fase 13 -- Waveform Loop Editor**:
  - [x] Editor visual en Canvas con zoom continuo (1x a 32x) y marcadores arrastrables `L-START`, `L-END` y crossfade.
  - [x] Ajuste automatico a cruces por cero (Snap to Zero-Crossing) y lupa de empalme con curva fantasma.
  - [x] 4 algoritmos de autoloop: `pitch_periodic`, `ncc_zc`, `min_seam_energy` y `equal_power_xfade`.
  - [x] Modos de bucle `ping_pong` y `loop_backward`, mas audicion unificada por fila (`.btn-row-play`).
- [x] **Fase 14 -- Portada / Artwork del Modelo (`cover.webp`)**:
  - [x] Normalizacion a WebP 512x512 via Canvas con recorte centrado.
  - [x] Dialogo modal de inspeccion en alta definicion y empaquetado en la capa `05_extended_model`.
- [x] **Fase 15 -- Arquitectura de Inferencia Híbrida de 3 Niveles y Dirty Tracking**:
  - [x] Nivel 1: `WebNeuralEngine` con detección WebGPU y andamiaje de fallbacks WASM SIMD en cliente.
  - [x] Nivel 2: `CloudByokClient` con Bring-Your-Own-Key directo a proveedores y claves solo en `localStorage`.
  - [x] Nivel 3: `BridgeClient` conectado al Companion Bridge local (`http://127.0.0.1:7860`) con descarga en background de modelos neuronales pesados y acceso directo a disco.
  - [x] Dirty Tracking y Hash Caching con SHA-256 (`HashCache.ts`) para evitar reprocesamientos innecesarios.

- [x] **Fase 11 -- Arquitectura AxionikDB, Slugs Semánticos y BankManager Extendido**:
  - [x] Repositorio físico `AxionikDB` con almacenamiento de Cápsulas del Tiempo de 5 capas.
  - [x] Identificadores de modelo por **Slug Semántico** (`slugifyModelName`, `createUniqueModelSlug`) liberando el yugo del límite 0..511.
  - [x] Pestañas duales en `BankDrawer.ts` (`AxionikDB` y `NeuronDB`) con selección de ranura y duplicación "Guardar como...".
  - [x] Taxonomía ampliada de 14 categorías acústicas con mapeo automático retrocompatible a los 10 Parameter Sets oficiales de Hartmann.
- [x] **Seguridad, Robustez de Importación y Estandarización (`DOCS/SECURITY_STANDARDS.md`)**:
  - [x] Sanitización estricta de metadatos (`escHtml`, `escAttr`) en todos los puntos de inyección de nombres (`NeuronDbModal`, `BankDrawer`, `ProcessPanel`, `ZoneInspector`, etc.).
  - [x] Topes de contención anti-bombas y DoS: `MAX_ZIP_ENTRIES` (2000), `MAX_ZIP_ENTRY_BYTES` (100MB), `MAX_ZIP_TOTAL_BYTES` (300MB), `MAX_SF2_PRESETS` (512), `MAX_SF2_SHDRS` (10000), `MAX_SFZ_TEXT_BYTES` (2MB).
  - [x] Corrección de clasificación heurística 14-categorías en `Sf2Parser.ts` para evitar solapes de nombres (e.g. Saxofón Barítono clasificado como viento en lugar de coro).
  - [x] Suite de pruebas `phase7_import_robustness.test.ts` con runner continuo `run_all.ts` ejecutando 9 suites sin abortar ante primer fallo.
- [x] **Rendimiento Real y Gestión de Memoria**:
  - [x] Prevención de fugas de `AudioNode` con desconexión estricta en `source.onended` y `stopAudition()`.
  - [x] Purgado y recolección de basura de buffers de audio huérfanos (`pruneOrphanBuffers()`) tras undo/redo y cambio de sesión.
  - [x] Optimización de resíntesis aditiva (`resynthesizeModelToPcm`) mediante caché de tramas y envolvimiento de fase en radianes.
  - [x] Monitor de cuota de almacenamiento en navegador (`navigator.storage.estimate()`) con aviso al superar el 80%.

---

## 5. Que FALTA por hacer (Siguientes Fases)

### 5.1 Fase 12 -- Procesador por Lotes (`Batch Processor`) [EN ESPECIFICACIÓN / DESARROLLO]
- [ ] Conversión en lote de SoundFonts multi-preset (`.sf2` -> múltiples modelos).
- [ ] Ingesta y generación desatendida desde carpetas de muestras (`.wav`/`.aiff`) y definiciones `.sfz`.
- [ ] Migración en bloque de bancos `NeuronDB` hacia `AxionikDB` con generación de Cápsulas del Tiempo.
- [ ] Cola FIFO tolerante a fallos con telemetría en tiempo real y reporte consolidado.

### 5.2 ABDAxionikVS -- Sintetizador C++ / JUCE 9 (Fase 11.4)
- [ ] Implementar el motor sintetizador software de reproduccion en tiempo real.
- [ ] Resynators con morphing vectorial 2D continuo en joysticks Scape/Sphere.
- [ ] Disparo hibrido de transitorios PCM de micro-ataque fundidos con el cuerpo aditivo.
- [ ] Modos de salida Surround 4.0 / 5.1 e interpolacion matricial multi-modelo.

### 5.3 Pruebas End-to-End
- [ ] Suite de pruebas automatizadas con Playwright para verificacion de flujos de interfaz completos.

---

## 6. Convenciones y reglas del proyecto

1. **Toda logica DSP pasa por `CoreService`** -- la UI nunca manipula directamente buffers crudos de audio.
2. **Zero Emojis estricto** -- Prohibido el uso de emojis tanto en la interfaz grafica como en la documentacion tecnica. Solo iconos SVG vectoriales `currentColor`.
3. **Tema por defecto**: Hartmann Neuron Claro (`neuron-light`).
4. **Privacidad BYOK**: Las claves API del usuario se guardan unicamente en el `localStorage` del navegador. Jamas se transmiten a servidores intermediarios propios.
5. **Colores y tipografia**: Siempre derivados de `@abdsynths/shared/styles/tokens.css` y las paletas tematicas.
6. **TypeScript strict**: Sin `any`, sin variables no utilizadas (prefijo `_`).
7. **Vite puerto fijo `8388`** con `strictPort: true`.
8. **Companion Bridge puerto `7860`** en `127.0.0.1`.
9. **start.bat** auto-arranca el Bridge en segundo plano si Python esta disponible y limpia procesos huerfanos.
