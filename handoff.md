Ã¯Â»Â¿# ABDNeuModMakr - Handoff

> Estado del proyecto a **2026-11-01**. Lee este archivo al inicio de cualquier conversacion nueva para obtener contexto completo.

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
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ index.html
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ package.json
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ tsconfig.json
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ vite.config.ts
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ start.bat                   <- Lanzador maestro: arranca Bridge en background + Vite
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ run_bridge.bat              <- Lanzador independiente del servidor Python
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ .gitignore
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ README.md                   <- Documentacion principal de arquitectura y uso
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ roadmap.md                  <- Estado de fases y plan maestro
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ handoff.md                  <- Documento de traspaso y contexto de sesion
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ bridge/
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ server.py               <- Companion Bridge local (FastAPI / PyTorch CUDA)
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ README.md               <- Especificacion de endpoints y arranque
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ DOCS/
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ NEURON_MM_SPEC.md       <- Especificacion de ingenieria inversa Neuron original
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ ARCHITECTURE_DUAL_TARGET.md <- Diseno Dual-Target (legacy-neuron vs modern-neural)
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ NASANALYSIS_DECOMPILATION.md <- Descompilacion completa de NASAnalysis.dll (Ghidra REA)
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ NEXTGEN_ARCHITECTURE_AND_SPEC.md <- Especificacion maestra de fases avanzadas
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ tests/
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ run_all.ts              <- Runner unificado de pruebas
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ phase1_pipeline.test.ts <- Tests de pipeline DSP y FFT
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ phase2_formats.test.ts  <- Tests de formatos binarios .scape, .sphere, .sound
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ phase3_files.test.ts    <- Tests de empaquetado ZIP y sesiones
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ phase4_spectral.test.ts <- Tests de analizador espectral 2D y parciales
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ phase5_ux.test.ts       <- Tests de Undo/Redo y atajos
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ phase6_units.test.ts    <- Tests de SF2, SFZ, MasterWave, Time Capsule y Cloud BYOK
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ phase13_loop_editor.test.ts <- Tests del editor visual interactivo de loops
Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ src/
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ main.ts                 <- Orquestacion de eventos y ciclo de vida de la aplicacion
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ style.css               <- Master stylesheet responsivo con container queries y tokens
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ core/
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ CoreService.ts      <- Contrato abstracto UI <-> Engine
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ types.ts            <- Definiciones de dominio (Zone, Region, Session, Model)
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ WebAudioPipeline.ts <- Implementacion principal de CoreService
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ MockCore.ts         <- Mock de referencia
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ extendedAdapter.ts  <- Compilador bidireccional Classic <-> Extended
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ sessionSchema.ts    <- Esquema y validacion de sesiones .nmsession
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ bridge/
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ BridgeClient.ts     <- Cliente HTTP/SSE para Companion Bridge local (7860) y escaneo de disco
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ ai/
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ WebNeuralEngine.ts  <- Deteccion WebGPU / SIMD y andamiaje de conectividad
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ CloudByokClient.ts  <- Cliente BYOK para inferencia serverless en la nube (Replicate/HF/Gemini)
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ cache/
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ HashCache.ts        <- Dirty tracking y cache por huella SHA-256
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ storage/
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ NeuronAssetStore.ts <- Almacenamiento binario IndexedDB
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ dsp/
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ WavDecoder.ts           <- Decodificador/Codificador WAV/AIFF PCM 16/24/32 y Float
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ FftEngine.ts            <- FFT Radix-2 Cooley-Tukey + ventanas + STFT
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ SpectralAnalyzer.ts     <- Detector F0 + 64 parciales + sub-rejilla
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ LayerClustering.ts      <- Agrupamiento espectral en hasta 4 capas
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ GridIndicator.ts        <- Metricas de residuo y calidad espectral
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ ScapeSphereGenerator.ts <- Serializacion binaria .scape y .sphere
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ AcousticIntelligence.ts <- Detector YIN/MPM y clasificador de 10 Parameter Sets
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ MasterWaveEnhancer.ts   <- Upsampling 24b/96k, expansion de loops y surround
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ PipelineRunner.ts       <- Coordinador DSP multi-zona
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ worker/
Ã¢ÂÂ   Ã¢ÂÂ       Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ analysisWorker.ts       <- Web Worker no bloqueante para analisis espectral
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ formats/
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ ModelFormat.ts      <- Parser/Writer .scape, .sphere, map.script, MName, ModelNames
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ SoundFormat.ts      <- Parser/Writer sound.script (445 params) y sound.stickrec
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ ZipArchive.ts       <- Lector/Escritor PKZIP puro sin dependencias externas
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Sf2Parser.ts        <- Parser SoundFont 2 con fusion automatica de pares estereo
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ SfzParser.ts        <- Parser de definiciones SFZ y mapeo de opcodes
Ã¢ÂÂ   Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ coverArtwork.ts     <- Procesador Canvas WebP 512x512 para artwork de modelos
Ã¢ÂÂ   Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ ui/
Ã¢ÂÂ       Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Navbar.ts               <- Barra de navegacion con selector de skin y pills de estado
Ã¢ÂÂ       Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ ZoneRibbon.ts           <- Cinta visual de zonas del teclado MIDI 0..127
Ã¢ÂÂ       Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ ZoneInspector.ts        <- Editor de zona/region con pestanas General y Extended
Ã¢ÂÂ       Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ WaveformLoopEditor.ts   <- Editor visual interactivo de bucles con zoom y snap ZC
Ã¢ÂÂ       Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ SpectralView.ts         <- Monitor espectral 2D, parciales y comparacion A/B/C
Ã¢ÂÂ       Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ ProcessPanel.ts         <- Panel de parametros de modelo y exportacion
Ã¢ÂÂ       Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ KeyboardStrip.ts        <- Teclado de piano virtual interactivo
Ã¢ÂÂ       Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ ProcessModal.ts         <- Dialogo de progreso de resintesis y descarga de modelos
Ã¢ÂÂ       Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ TelemetryDrawer.ts      <- Panel de auditoria de cobertura y diagnostico
Ã¢ÂÂ       Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ BankDrawer.ts           <- Biblioteca de modelos, presets y exportacion
Ã¢ÂÂ       Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ icons.ts                <- Libreria SVG vectorial (currentColor, zero emojis)
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
  - [x] Parser SF2 (`Sf2Parser.ts`) con emparejamiento estÃÂ©reo automatico, captura de envolventes DAHDSR, filtro y LFO.
  - [x] Parser SFZ (`SfzParser.ts`) y compilador de reduccion a formato clasico con compensacion de ganancia.
- [x] **Fase 7 -- Inteligencia acustica y Classic Enhanced**:
  - [x] Detector F0 YIN/MPM en dominio temporal + ajuste Least-Squares espectral.
  - [x] Descriptores acusticos (ataque, inarmonicidad B, centroide, flatness, ZCR, armonicidad).
  - [x] Clasificacion automatica de Tipo de Instrumento y seleccion de los 10 Parameter Sets oficiales (0..9).
  - [x] Algoritmo `Classic Enhanced` con supresion de ruido y comparador de audicion A/B/C.
- [x] **Fase 8 -- Master Wave 24-bit / 96 kHz, expansion de loops y surround**:
  - [x] Estandar maestro de audio a 24-bit PCM / 96.000 Hz en `WavDecoder.ts` y `MasterWaveEnhancer.ts`.
  - [x] Expansion inteligente de loops cortos con desenrollado organico y busqueda de cruce por cero optimo.
  - [x] Espacializacion estÃÂ©reo / quad surround y downmixing determinista.
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
- [x] **Fase 15 -- Arquitectura de Inferencia HÃÂ­brida de 3 Niveles y Dirty Tracking**:
  - [x] Nivel 1: `WebNeuralEngine` con detecciÃÂ³n WebGPU y andamiaje de fallbacks WASM SIMD en cliente.
  - [x] Nivel 2: `CloudByokClient` con Bring-Your-Own-Key directo a proveedores y claves solo en `localStorage`.
  - [x] Nivel 3: `BridgeClient` conectado al Companion Bridge local (`http://127.0.0.1:7860`) con descarga en background de modelos neuronales pesados y acceso directo a disco.
  - [x] Dirty Tracking y Hash Caching con SHA-256 (`HashCache.ts`) para evitar reprocesamientos innecesarios.

- [x] **Fase 11 -- Arquitectura AxionikDB, Slugs SemÃÂ¡nticos y BankManager Extendido**:
  - [x] Repositorio fÃÂ­sico `AxionikDB` con almacenamiento de CÃÂ¡psulas del Tiempo de 5 capas.
  - [x] Identificadores de modelo por **Slug SemÃÂ¡ntico** (`slugifyModelName`, `createUniqueModelSlug`) liberando el yugo del lÃÂ­mite 0..511.
  - [x] PestaÃÂ±as duales en `BankDrawer.ts` (`AxionikDB` y `NeuronDB`) con selecciÃÂ³n de ranura y duplicaciÃÂ³n "Guardar como...".
  - [x] TaxonomÃÂ­a ampliada de 14 categorÃÂ­as acÃÂºsticas con mapeo automÃÂ¡tico retrocompatible a los 10 Parameter Sets oficiales de Hartmann.
- [x] **Seguridad, Robustez de ImportaciÃÂ³n y EstandarizaciÃÂ³n (`DOCS/SECURITY_STANDARDS.md`)**:
  - [x] SanitizaciÃÂ³n estricta de metadatos (`escHtml`, `escAttr`) en todos los puntos de inyecciÃÂ³n de nombres (`NeuronDbModal`, `BankDrawer`, `ProcessPanel`, `ZoneInspector`, etc.).
  - [x] Topes de contenciÃÂ³n anti-bombas y DoS: `MAX_ZIP_ENTRIES` (2000), `MAX_ZIP_ENTRY_BYTES` (100MB), `MAX_ZIP_TOTAL_BYTES` (300MB), `MAX_SF2_PRESETS` (512), `MAX_SF2_SHDRS` (10000), `MAX_SFZ_TEXT_BYTES` (2MB).
  - [x] CorrecciÃÂ³n de clasificaciÃÂ³n heurÃÂ­stica 14-categorÃÂ­as en `Sf2Parser.ts` para evitar solapes de nombres (e.g. SaxofÃÂ³n BarÃÂ­tono clasificado como viento en lugar de coro).
  - [x] Suite de pruebas `phase7_import_robustness.test.ts` con runner continuo `run_all.ts` ejecutando 9 suites sin abortar ante primer fallo.
- [x] **Rendimiento Real y GestiÃÂ³n de Memoria**:
  - [x] PrevenciÃÂ³n de fugas de `AudioNode` con desconexiÃÂ³n estricta en `source.onended` y `stopAudition()`.
  - [x] Purgado y recolecciÃÂ³n de basura de buffers de audio huÃÂ©rfanos (`pruneOrphanBuffers()`) tras undo/redo y cambio de sesiÃÂ³n.
  - [x] OptimizaciÃÂ³n de resÃÂ­ntesis aditiva (`resynthesizeModelToPcm`) mediante cachÃÂ© de tramas y envolvimiento de fase en radianes.
  - [x] Monitor de cuota de almacenamiento en navegador (`navigator.storage.estimate()`) con aviso al superar el 80%.
- [x] **Fase 12 Ã¢ÂÂ Procesador por Lotes (`Batch Processor`)**:
  - [x] Extractor multi-preset de SoundFonts 2 (`Sf2BatchExtractor.ts`) con extracciÃÂ³n desglosada por bancos/presets.
  - [x] Extractor de carpetas de muestras (`FolderBatchExtractor.ts`) por estructura de directorios y prefijos de instrumento.
  - [x] InspecciÃÂ³n Preflight obligatoria previa al arranque (`preflight.ts`) con desglose de quÃÂ© va a hacer, cÃÂ³mo lo va a hacer (heredando configuraciÃÂ³n activa de IA, DSP clÃÂ¡sico/mejorado y modo de trabajo) y quÃÂ© ficheros se procesarÃÂ¡n.
  - [x] Cola secuencial asÃÂ­ncrona (`BatchQueue.ts`) tolerante a fallos (errores individuales no abortan el lote), con controles de inicio, pausa, reanudaciÃÂ³n y cancelaciÃÂ³n.
  - [x] Destino dual: ExportaciÃÂ³n a paquete maestro PKZIP o sincronizaciÃÂ³n directa con `AxionikDB` vÃÂ­a Companion Bridge.
  - [x] Interfaz de usuario (`BatchProcessorModal.ts`), botÃÂ³n en Navbar y atajo de teclado `Ctrl+Shift+B`.
  - [x] Suite de pruebas automatizadas `phase12_batch.test.ts` con 11/11 suites pasando en el runner continuo `run_all.ts`.

- [x] **Fase 16 Ã¢ÂÂ Utilidad Universal de ExportaciÃÂ³n Multi-Formato Raw (`RawSamplerExporter.ts`)**:
  - [x] ExportaciÃÂ³n pura de muestras y mapeos intactos (`01_raw_source`) sin resÃÂ­ntesis Scape/Sphere.
  - [x] 7 formatos: SoundFont 2 (`.sf2` RIFF sfbk binario), SFZ Format (`.sfz.zip`), Decent Sampler (`.dspreset.zip`), Bitwig Studio Multisample (`.multisample`), Kontakt (`.nki.zip`), HALion (`.vstpreset.zip`), y Linear Sample Chains con RIFF `cue ` markers (`.wav`).
  - [x] Compuerta de Preflight interactiva (`rawSamplerPreflight.ts`) con clamps automÃÂ¡ticos (16-bit PCM en SF2, ADSR, loops) y modal dedicado (`RawSamplerExportModal.ts` con atajo `Ctrl+Shift+E`).
- [x] **Fase 17 Ã¢ÂÂ EvoluciÃÂ³n Conjunta con ABDAxionikVS (Metadatos Ricos y Doble Nomenclatura)**:
  - [x] Doble denominaciÃÂ³n bidireccional no destructiva: `modelName` (11 caracteres clÃÂ¡sicos) vs `expandedName` (ilimitado moderno).
  - [x] Metadatos ricos de procedencia, licencia, autorÃÂ­a y tags libres (`customAttributes`).
  - [x] ReubicaciÃÂ³n UX de ediciÃÂ³n completa a la pestaÃÂ±a *Metadata & Tags* de `ModelConfigModal.ts` con visor compacto en `ProcessPanel.ts`.
- [x] **Fase 18 Ã¢ÂÂ Troceador de Audio Interactivo (Audio Chopper / AutoSlicer Core)**:
  - [x] Algoritmos SuperFlux (transitorios) y OpenVPI Silence Valley (vocal/frases) con trimming de silencio dinÃÂ¡mico.
  - [x] ManipulaciÃÂ³n interactiva en forma de onda, lupa de ajuste fino de cortes (ÃÂ±256 samples), micro-nudge (ÃÂ±1 sample) y snap a cruce por cero (0-X).
  - [x] InserciÃÂ³n de cortes manuales, menÃÂº contextual de borrado y silenciamiento/muteo individual de rebanadas con preservaciÃÂ³n ante cambios de sensibilidad.
  - [x] Mapeo automÃÂ¡tico a GM Drum Map (C1..B2) y Modo CromÃÂ¡tico equidistante continuo 0..127 sin huecos.
  - [x] Parser recursivo IFF para archivos ReCycle 2.0 y 1.x (`.rx2`, `.rex`, `.rcy`), pistas CUE/Audacity y bloques WAV `cue `/`smpl`.
  - [x] Generador de patrones Standard MIDI (`.mid` Type 0) con timing original y botÃÂ³n arrastrable al DAW.
- [x] **Fase 18.8 - Universal Smart Import (Multi-Format Sampler Import + Preflight)**:
  - [x] Parsers nativos: Decent Sampler (`.dspreset`), Kontakt XML (`.nki` sin encriptar + deteccion de NI encriptado), HALion (`.vstpreset`), Bitwig (`.multisample`), Sample Chains (audio lineal con grid slicing).
  - [x] Dispatcher universal `parseUniversalSampler()` con auto-deteccion por cabecera binaria y extension.
  - [x] Motor Preflight (`importPreflight.ts`): huecos de teclado, solapamientos, capas de velocidad incompatibles, audio faltante; adaptaciones automaticas.
  - [x] Modal UI `UniversalImportModal.ts` con zona drag-drop, vista Preflight interactiva y checkboxes de adaptacion.
  - [x] Menu File reorganizado: `Universal Smart Import (Ctrl+I)` entrada principal; opciones individuales en submenu `Advanced Import`. Entrada duplicada en Edit.
  - [x] Suite de tests `phase18_universal_import.test.ts` (8/8 PASS).
- [x] **Fase 20 Ã¢ÂÂ AutocarÃÂ¡tula Asistida por IA (Model Cover Artwork Generator)**:
  - [x] GeneraciÃÂ³n de carÃÂ¡tulas cuadradas 512ÃÂ512 en formato WebP con 6 estilos artÃÂ­sticos pre-diseÃÂ±ados.
  - [x] 3 vÃÂ­as de generaciÃÂ³n: Procedural Espectral (100% offline y gratis), Companion Bridge local (FastAPI 7860), y Cloud BYOK para 9 proveedores (Gemini, DALL-E 3, Claude, OpenRouter, DeepSeek, Groq, Mistral, HuggingFace FLUX, Replicate).
  - [x] ExtracciÃÂ³n semÃÂ¡ntica de motivos acÃÂºsticos instrumentales (`extractAcousticInstrumentMotif`) a partir de nombres de modelo y muestras.
  - [x] IntegraciÃÂ³n en `ProcessConfig.coverArtwork` y empaquetado en la capa `05_extended_model/cover.webp` de la CÃÂ¡psula del Tiempo.
- [x] **Fase 21 Ã¢ÂÂ DiagnÃÂ³stico de Salud del Sistema y Onboarding (`ConfigHealthModal.ts`)**:
  - [x] ComprobaciÃÂ³n automÃÂ¡tica de entorno en arranque: librerÃÂ­as locales (NeuronDB/AxionikDB), Companion Bridge local (7860) y claves BYOK.
  - [x] DistinciÃÂ³n visual entre elementos obligatorios y opcionales con enlaces directos para resolver cada uno.
  - [x] Indicador de salud dinamico en barra de navegacion y compuertas de seguridad (`isFeatureGated`).
- [x] **Fase 26 - Descompresion de Audio REX2 (.rx2) Dual (TypeScript Puro + Companion Bridge)**:
  - [x] Motor nativo en TypeScript puro (`src/core/dsp/DwopDecompressor.ts`): descompresor DWOP adaptativo de 5 estados 100% en el navegador del cliente (cero backend, cero latencia de red, listo para Vercel).
  - [x] Implementacion en Python (`bridge/dwop_decompress.py`) y endpoint `POST /api/decode-rx2` en el Companion Bridge como motor opcional de respaldo. (`bridge/dwop_decompress.py`) del descompresor del flujo de audio DWOP con predictor adaptativo de 5 estados (mono y estereo).
  - [x] Endpoint `POST /api/decode-rx2` en el Companion Bridge (puerto 7860) con respuesta JSON que incluye buffer PCM WAV limpio en Base64, metadatos y frames decodificados.
  - [x] Anuncio de capacidad 'decode-rx2' en el endpoint `/api/health`.
  - [x] Metodo `decodeRx2Audio(rx2Buffer, filename)` en `BridgeClient.ts` con conversion binaria Base64 automatica.
  - [x] Integracion en `AudioChopperModal.ts`: decodificacion automatica transparente de archivos `.rx2`, `.rex` y `.rcy` abriendo el audio real con sus cortes originales.
  - [x] Asistente de Emparejamiento REX2 (`showRx2PairingAssistantModal`): ventana interactiva en modo desconectado con 3 opciones (emparejar con WAV/AIFF existente, reintentar conexion con el bridge, o previsualizacion con impulsos acusticos sinteticos).
  - [x] Integracion en Universal Smart Import (`rawSamplerParsers.ts` y `UniversalImportModal.ts`) con generacion de regiones cortadas y preflight adaptativo.
  - [x] Suite de pruebas automatizadas `tests/phase26_rex2_decode.test.ts` anadida al runner unificado (17/17 suites PASS).
- [x] **Fase 27 - Ampliacion de Proveedores BYOK (Claude, OpenRouter, ChatGPT) y Estandarizacion UI en Pills**:
  - [x] Conectores directos de texto y razonamiento en `CloudByokClient`:
    - Anthropic Claude (`v1/messages` con `claude-3-5-haiku-20241022`, headers `dangerously-allow-browser: true`).
    - OpenRouter (gateway multi-modelo OpenAI-compatible con atribucion de cabeceras).
    - OpenAI ChatGPT (`v1/chat/completions` con `gpt-4o-mini`).
    - Gemini (`generateContent`), Groq LPU, DeepSeek (`deepseek-chat`) y Mistral AI.
  - [x] Metodos de dominio acustico de alto nivel:
    - `generateAcousticTimbreDescription(...)` para analisis timbrico y descriptores sonoros de presets.
    - `generatePresetTagsAndNotes(...)` para etiquetado semantico.
    - `enhancePromptWithByokLlm(...)` para enriquecimiento de prompts de artwork con metaforas sensoriales.
  - [x] Estandarizacion visual en Pills:
    - Selector de proveedores en `SettingsModal.ts` redisenado con chips/pills interactivas, badges de especialidad (`AudioSR GPU`, `Serverless`, `Multimodal`, `GPT-4o & DALL-E`, `Sonnet & Haiku`, `Multi-Model`, etc.) y estado seleccionado coherente con los tokens del sistema.
    - Boton rapido de enriquecimiento con LLM (`#btn-enhance-prompt-llm`) en `AiCoverGeneratorModal.ts`.
  - [x] Catalogo modular del Companion Bridge:
    - Actualizacion de `MODEL_REGISTRY` en `bridge/server.py` y `BridgeModelInfo` en `BridgeClient.ts` conforme a `MODULAR_PACKAGES_STANDARD.md` con campos `package` (`@abdsynths/*`), `category`, `runtime`, `min_vram_mb` y version de estandar modular `1.0.0` en `/api/models`.
  - [x] Suite de pruebas automatizadas `tests/phase27_byok_text.test.ts` (6/6 verificaciones) anadida al runner unificado (18/18 suites PASS).
- [x] **Fase 24 — Segmentacion y Corte Semantico de Audio con IA (AI Semantic Slicing & Stem Separation)**:
  - [x] Alineacion fonetica vocal con Whisper-tiny: endpoint `POST /api/align-phonemes` en `bridge/server.py`, cliente `bridgeClient.alignPhonemes()` y deteccion de limites foneticos/silabicos.
  - [x] Separacion de stems previa al corte con Demucs: endpoint `POST /api/separate-stems` en `bridge/server.py`, cliente `bridgeClient.separateStems()` para aislar voz, base ritmica, bajo e instrumental con fallback DSP Mid/Side de alta fidelidad.
  - [x] Integracion en `AudioSlicerEngine.ts`: mapeo fonetico `buildSlicesFromPhoneticWords` y soporte de `phoneticWords` en `sliceAudioBuffer`.
  - [x] Interfaz interactiva en `AudioChopperModal.ts`: botones de pildora `#btn-chopper-whisper-align` y `#btn-chopper-demucs-split`, con dialogo interactivo de stems y carga inmediata al lienzo de corte.
  - [x] Politica de gestion de memoria: documentada politica `Single-Active Heavy Model con Auto-Offload` y pipeline `Batch-by-Stage Staging` para salvaguarda de VRAM.
  - [x] Suite de pruebas automatizadas `tests/phase24_semantic_slicing.test.ts` anadida al runner unificado (19/19 suites PASS).

---

## 5. Que FALTA por hacer (Siguientes Fases y Tareas Pendientes)

### 5.1 Tareas Inmediatas de Frontend & Preparacion de Muestras
1. **Fase 25 — Procesador por Lotes para AutoSlicer / Audio Chopper (Batch AutoSlicer)**:
   - Integrar la deteccion y corte automatico en el Batch Processor (`BatchProcessorModal.ts`).
   - Permitir procesar carpetas completas de loops ritmicos, frases vocales y archivos de rebanadas (`.rx2`/`.rex`/`.cue`) de forma 100% desatendida, generando modelos de bateria GM Drum Map, cromaticos equidistantes o volcando archivos MIDI asociados.
   - **Arquitectura de Pipeline por Fases Homogeneas (Batch-by-Stage / Memory Safety)**: Reordenar la cola del lote por modelos IA para cargar un modelo pesado a la vez en VRAM (Fase Demucs -> Fase Whisper -> Fase DSP Slicing -> Fase AudioSR -> Fase SD-Turbo), liberando VRAM con `torch.cuda.empty_cache()` entre etapas y garantizando ejecucion masiva sin desbordar GPUs de 8 GB VRAM.

### 5.2 Formatos de Sampler Avanzados y Compatibilidad Kontakt / Decent Sampler
2. **Fase 28 — Estudio en Profundidad de Decent Sampler y Compatibilidad de Librerias Kontakt (Encriptadas vs Sin Encriptar)**:
   - **Paridad integral con `.dspreset`**: Round-Robin multinivel (`seqMode="round_robin"|"random"`), Release Triggers con `pitchKeyTrack="0"`, `releaseDecay`, controles UI, filtros y efectos.
   - **Kontakt sin encriptar**: parser binario legado (v1..v4) y descompresion de audio `.ncw` a WAV PCM.
   - **Kontakt encriptado**: deteccion temprana en Preflight de contenedores monoliticos cifrados por DRM de Native Instruments con diagnostico explicativo y vias de conversion.
3. **Fase 22 — Suite de Funcionalidades Avanzadas de Sampler Profesional (Estandar Kontakt / HALion / Falcon)**:
   - Round-Robin (alternancia de muestras para evitar efecto ametralladora).
   - Release Triggers / Key-Off (muestras disparadas al soltar tecla: apagadores, ruidos de traste).
   - Auto-Mapping por expresiones regulares en nombres de fichero (ej. `Violin_C3_mf_rr1.wav`).
   - Matriz de Modulacion MIDI (CC1, CC11, Aftertouch).
   - Soporte de Microtuning / Escalas Scala (`.scl`).

### 5.3 Organizacion, IA Semantica y Sintesis en Tiempo Real
4. **Fase 23 — Organizacion Jerarquica de Bancos y Sublibrerias de Modelos Extendidos**:
   - Sublibrerias fisicas en disco bajo `/banks/<SublibraryName>/...`.
   - Asignacion de modelos a subbancos en el dialogo de configuracion y en el Batch Processor.
   - Regla de seguridad estricta para impedir borrado de sublibrerias que contengan modelos.
   - Reordenacion manual jerarquica con recalculo dinamico de posiciones.
5. **Fase 24 — Segmentacion y Corte Semantico de Audio con IA (AI Semantic Slicing)**:
   - Modelos ligeros de alineacion fonetica (vocal/speech) para cortar por palabras o silabas naturales (OpenAI Whisper-tiny).
   - Separacion de stems pre-troceado (vocal vs base ritmica con Demucs via Bridge).
   - **Single-Active Heavy Model con Auto-Offload**: Politica en el Companion Bridge para no superar 1 modelo pesado en VRAM simultaneamente (descarga automatica a CPU o liberacion con `gc.collect()` y `torch.cuda.empty_cache()`). Desacoplamiento de Whisper-tiny a CPU/ONNX Runtime.
6. **Fase 11.4 & Fase 19 — Motor de Sintesis en Tiempo Real ABDAxionikVS (C++ / JUCE 9)**:
   - Motor software de reproduccion en tiempo real en plugin VST3/CLAP/AU.
   - **Modo Rompler Puro (Fase 19)**: Reproduccion directa de audio PCM de la capa `01_raw_source` (o `03_enhanced_audio` en 24b/96k) sin procesar por Scape/Sphere, con filtros analogicos modelados y capas hibridas Rompler + Resintesis Neuronal.
   - Resynators con morphing vectorial 2D en joysticks Scape/Sphere.
   - Modos de salida Surround 4.0 / 5.1.
7. **Revision final — NeuronDB Bank Browser**:
   - Revision del panel de navegacion de librerias segun las capturas historicas de localhost:5320 para confirmar si se requieren ajustes o si la UI actual de BankDrawer/BankManager ya lo cubre de forma superior.

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
