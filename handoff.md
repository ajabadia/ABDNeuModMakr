ï»¿# ABDNeuModMakr - Handoff

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
âââ index.html
âââ package.json
âââ tsconfig.json
âââ vite.config.ts
âââ start.bat                   <- Lanzador maestro: arranca Bridge en background + Vite
âââ run_bridge.bat              <- Lanzador independiente del servidor Python
âââ .gitignore
âââ README.md                   <- Documentacion principal de arquitectura y uso
âââ roadmap.md                  <- Estado de fases y plan maestro
âââ handoff.md                  <- Documento de traspaso y contexto de sesion
âââ bridge/
â   âââ server.py               <- Companion Bridge local (FastAPI / PyTorch CUDA)
â   âââ README.md               <- Especificacion de endpoints y arranque
âââ DOCS/
â   âââ NEURON_MM_SPEC.md       <- Especificacion de ingenieria inversa Neuron original
â   âââ ARCHITECTURE_DUAL_TARGET.md <- Diseno Dual-Target (legacy-neuron vs modern-neural)
â   âââ NASANALYSIS_DECOMPILATION.md <- Descompilacion completa de NASAnalysis.dll (Ghidra REA)
â   âââ NEXTGEN_ARCHITECTURE_AND_SPEC.md <- Especificacion maestra de fases avanzadas
âââ tests/
â   âââ run_all.ts              <- Runner unificado de pruebas
â   âââ phase1_pipeline.test.ts <- Tests de pipeline DSP y FFT
â   âââ phase2_formats.test.ts  <- Tests de formatos binarios .scape, .sphere, .sound
â   âââ phase3_files.test.ts    <- Tests de empaquetado ZIP y sesiones
â   âââ phase4_spectral.test.ts <- Tests de analizador espectral 2D y parciales
â   âââ phase5_ux.test.ts       <- Tests de Undo/Redo y atajos
â   âââ phase6_units.test.ts    <- Tests de SF2, SFZ, MasterWave, Time Capsule y Cloud BYOK
â   âââ phase13_loop_editor.test.ts <- Tests del editor visual interactivo de loops
âââ src/
â   âââ main.ts                 <- Orquestacion de eventos y ciclo de vida de la aplicacion
â   âââ style.css               <- Master stylesheet responsivo con container queries y tokens
â   âââ core/
â   â   âââ CoreService.ts      <- Contrato abstracto UI <-> Engine
â   â   âââ types.ts            <- Definiciones de dominio (Zone, Region, Session, Model)
â   â   âââ WebAudioPipeline.ts <- Implementacion principal de CoreService
â   â   âââ MockCore.ts         <- Mock de referencia
â   â   âââ extendedAdapter.ts  <- Compilador bidireccional Classic <-> Extended
â   â   âââ sessionSchema.ts    <- Esquema y validacion de sesiones .nmsession
â   â   âââ bridge/
â   â   â   âââ BridgeClient.ts     <- Cliente HTTP/SSE para Companion Bridge local (7860) y escaneo de disco
â   â   âââ ai/
â   â   â   âââ WebNeuralEngine.ts  <- Deteccion WebGPU / SIMD y andamiaje de conectividad
â   â   â   âââ CloudByokClient.ts  <- Cliente BYOK para inferencia serverless en la nube (Replicate/HF/Gemini)
â   â   âââ cache/
â   â   â   âââ HashCache.ts        <- Dirty tracking y cache por huella SHA-256
â   â   âââ storage/
â   â   â   âââ NeuronAssetStore.ts <- Almacenamiento binario IndexedDB
â   â   âââ dsp/
â   â   â   âââ WavDecoder.ts           <- Decodificador/Codificador WAV/AIFF PCM 16/24/32 y Float
â   â   â   âââ FftEngine.ts            <- FFT Radix-2 Cooley-Tukey + ventanas + STFT
â   â   â   âââ SpectralAnalyzer.ts     <- Detector F0 + 64 parciales + sub-rejilla
â   â   â   âââ LayerClustering.ts      <- Agrupamiento espectral en hasta 4 capas
â   â   â   âââ GridIndicator.ts        <- Metricas de residuo y calidad espectral
â   â   â   âââ ScapeSphereGenerator.ts <- Serializacion binaria .scape y .sphere
â   â   â   âââ AcousticIntelligence.ts <- Detector YIN/MPM y clasificador de 10 Parameter Sets
â   â   â   âââ MasterWaveEnhancer.ts   <- Upsampling 24b/96k, expansion de loops y surround
â   â   â   âââ PipelineRunner.ts       <- Coordinador DSP multi-zona
â   â   âââ worker/
â   â       âââ analysisWorker.ts       <- Web Worker no bloqueante para analisis espectral
â   âââ formats/
â   â   âââ ModelFormat.ts      <- Parser/Writer .scape, .sphere, map.script, MName, ModelNames
â   â   âââ SoundFormat.ts      <- Parser/Writer sound.script (445 params) y sound.stickrec
â   â   âââ ZipArchive.ts       <- Lector/Escritor PKZIP puro sin dependencias externas
â   â   âââ Sf2Parser.ts        <- Parser SoundFont 2 con fusion automatica de pares estereo
â   â   âââ SfzParser.ts        <- Parser de definiciones SFZ y mapeo de opcodes
â   â   âââ coverArtwork.ts     <- Procesador Canvas WebP 512x512 para artwork de modelos
â   âââ ui/
â       âââ Navbar.ts               <- Barra de navegacion con selector de skin y pills de estado
â       âââ ZoneRibbon.ts           <- Cinta visual de zonas del teclado MIDI 0..127
â       âââ ZoneInspector.ts        <- Editor de zona/region con pestanas General y Extended
â       âââ WaveformLoopEditor.ts   <- Editor visual interactivo de bucles con zoom y snap ZC
â       âââ SpectralView.ts         <- Monitor espectral 2D, parciales y comparacion A/B/C
â       âââ ProcessPanel.ts         <- Panel de parametros de modelo y exportacion
â       âââ KeyboardStrip.ts        <- Teclado de piano virtual interactivo
â       âââ ProcessModal.ts         <- Dialogo de progreso de resintesis y descarga de modelos
â       âââ TelemetryDrawer.ts      <- Panel de auditoria de cobertura y diagnostico
â       âââ BankDrawer.ts           <- Biblioteca de modelos, presets y exportacion
â       âââ icons.ts                <- Libreria SVG vectorial (currentColor, zero emojis)
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
  - [x] Parser SF2 (`Sf2Parser.ts`) con emparejamiento estÃ©reo automatico, captura de envolventes DAHDSR, filtro y LFO.
  - [x] Parser SFZ (`SfzParser.ts`) y compilador de reduccion a formato clasico con compensacion de ganancia.
- [x] **Fase 7 -- Inteligencia acustica y Classic Enhanced**:
  - [x] Detector F0 YIN/MPM en dominio temporal + ajuste Least-Squares espectral.
  - [x] Descriptores acusticos (ataque, inarmonicidad B, centroide, flatness, ZCR, armonicidad).
  - [x] Clasificacion automatica de Tipo de Instrumento y seleccion de los 10 Parameter Sets oficiales (0..9).
  - [x] Algoritmo `Classic Enhanced` con supresion de ruido y comparador de audicion A/B/C.
- [x] **Fase 8 -- Master Wave 24-bit / 96 kHz, expansion de loops y surround**:
  - [x] Estandar maestro de audio a 24-bit PCM / 96.000 Hz en `WavDecoder.ts` y `MasterWaveEnhancer.ts`.
  - [x] Expansion inteligente de loops cortos con desenrollado organico y busqueda de cruce por cero optimo.
  - [x] Espacializacion estÃ©reo / quad surround y downmixing determinista.
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
- [x] **Fase 15 -- Arquitectura de Inferencia HÃ­brida de 3 Niveles y Dirty Tracking**:
  - [x] Nivel 1: `WebNeuralEngine` con detecciÃ³n WebGPU y andamiaje de fallbacks WASM SIMD en cliente.
  - [x] Nivel 2: `CloudByokClient` con Bring-Your-Own-Key directo a proveedores y claves solo en `localStorage`.
  - [x] Nivel 3: `BridgeClient` conectado al Companion Bridge local (`http://127.0.0.1:7860`) con descarga en background de modelos neuronales pesados y acceso directo a disco.
  - [x] Dirty Tracking y Hash Caching con SHA-256 (`HashCache.ts`) para evitar reprocesamientos innecesarios.

- [x] **Fase 11 -- Arquitectura AxionikDB, Slugs SemÃ¡nticos y BankManager Extendido**:
  - [x] Repositorio fÃ­sico `AxionikDB` con almacenamiento de CÃ¡psulas del Tiempo de 5 capas.
  - [x] Identificadores de modelo por **Slug SemÃ¡ntico** (`slugifyModelName`, `createUniqueModelSlug`) liberando el yugo del lÃ­mite 0..511.
  - [x] PestaÃ±as duales en `BankDrawer.ts` (`AxionikDB` y `NeuronDB`) con selecciÃ³n de ranura y duplicaciÃ³n "Guardar como...".
  - [x] TaxonomÃ­a ampliada de 14 categorÃ­as acÃºsticas con mapeo automÃ¡tico retrocompatible a los 10 Parameter Sets oficiales de Hartmann.
- [x] **Seguridad, Robustez de ImportaciÃ³n y EstandarizaciÃ³n (`DOCS/SECURITY_STANDARDS.md`)**:
  - [x] SanitizaciÃ³n estricta de metadatos (`escHtml`, `escAttr`) en todos los puntos de inyecciÃ³n de nombres (`NeuronDbModal`, `BankDrawer`, `ProcessPanel`, `ZoneInspector`, etc.).
  - [x] Topes de contenciÃ³n anti-bombas y DoS: `MAX_ZIP_ENTRIES` (2000), `MAX_ZIP_ENTRY_BYTES` (100MB), `MAX_ZIP_TOTAL_BYTES` (300MB), `MAX_SF2_PRESETS` (512), `MAX_SF2_SHDRS` (10000), `MAX_SFZ_TEXT_BYTES` (2MB).
  - [x] CorrecciÃ³n de clasificaciÃ³n heurÃ­stica 14-categorÃ­as en `Sf2Parser.ts` para evitar solapes de nombres (e.g. SaxofÃ³n BarÃ­tono clasificado como viento en lugar de coro).
  - [x] Suite de pruebas `phase7_import_robustness.test.ts` con runner continuo `run_all.ts` ejecutando 9 suites sin abortar ante primer fallo.
- [x] **Rendimiento Real y GestiÃ³n de Memoria**:
  - [x] PrevenciÃ³n de fugas de `AudioNode` con desconexiÃ³n estricta en `source.onended` y `stopAudition()`.
  - [x] Purgado y recolecciÃ³n de basura de buffers de audio huÃ©rfanos (`pruneOrphanBuffers()`) tras undo/redo y cambio de sesiÃ³n.
  - [x] OptimizaciÃ³n de resÃ­ntesis aditiva (`resynthesizeModelToPcm`) mediante cachÃ© de tramas y envolvimiento de fase en radianes.
  - [x] Monitor de cuota de almacenamiento en navegador (`navigator.storage.estimate()`) con aviso al superar el 80%.
- [x] **Fase 12 â Procesador por Lotes (`Batch Processor`)**:
  - [x] Extractor multi-preset de SoundFonts 2 (`Sf2BatchExtractor.ts`) con extracciÃ³n desglosada por bancos/presets.
  - [x] Extractor de carpetas de muestras (`FolderBatchExtractor.ts`) por estructura de directorios y prefijos de instrumento.
  - [x] InspecciÃ³n Preflight obligatoria previa al arranque (`preflight.ts`) con desglose de quÃ© va a hacer, cÃ³mo lo va a hacer (heredando configuraciÃ³n activa de IA, DSP clÃ¡sico/mejorado y modo de trabajo) y quÃ© ficheros se procesarÃ¡n.
  - [x] Cola secuencial asÃ­ncrona (`BatchQueue.ts`) tolerante a fallos (errores individuales no abortan el lote), con controles de inicio, pausa, reanudaciÃ³n y cancelaciÃ³n.
  - [x] Destino dual: ExportaciÃ³n a paquete maestro PKZIP o sincronizaciÃ³n directa con `AxionikDB` vÃ­a Companion Bridge.
  - [x] Interfaz de usuario (`BatchProcessorModal.ts`), botÃ³n en Navbar y atajo de teclado `Ctrl+Shift+B`.
  - [x] Suite de pruebas automatizadas `phase12_batch.test.ts` con 11/11 suites pasando en el runner continuo `run_all.ts`.

- [x] **Fase 16 â Utilidad Universal de ExportaciÃ³n Multi-Formato Raw (`RawSamplerExporter.ts`)**:
  - [x] ExportaciÃ³n pura de muestras y mapeos intactos (`01_raw_source`) sin resÃ­ntesis Scape/Sphere.
  - [x] 7 formatos: SoundFont 2 (`.sf2` RIFF sfbk binario), SFZ Format (`.sfz.zip`), Decent Sampler (`.dspreset.zip`), Bitwig Studio Multisample (`.multisample`), Kontakt (`.nki.zip`), HALion (`.vstpreset.zip`), y Linear Sample Chains con RIFF `cue ` markers (`.wav`).
  - [x] Compuerta de Preflight interactiva (`rawSamplerPreflight.ts`) con clamps automÃ¡ticos (16-bit PCM en SF2, ADSR, loops) y modal dedicado (`RawSamplerExportModal.ts` con atajo `Ctrl+Shift+E`).
- [x] **Fase 17 â EvoluciÃ³n Conjunta con ABDAxionikVS (Metadatos Ricos y Doble Nomenclatura)**:
  - [x] Doble denominaciÃ³n bidireccional no destructiva: `modelName` (11 caracteres clÃ¡sicos) vs `expandedName` (ilimitado moderno).
  - [x] Metadatos ricos de procedencia, licencia, autorÃ­a y tags libres (`customAttributes`).
  - [x] ReubicaciÃ³n UX de ediciÃ³n completa a la pestaÃ±a *Metadata & Tags* de `ModelConfigModal.ts` con visor compacto en `ProcessPanel.ts`.
- [x] **Fase 18 â Troceador de Audio Interactivo (Audio Chopper / AutoSlicer Core)**:
  - [x] Algoritmos SuperFlux (transitorios) y OpenVPI Silence Valley (vocal/frases) con trimming de silencio dinÃ¡mico.
  - [x] ManipulaciÃ³n interactiva en forma de onda, lupa de ajuste fino de cortes (Â±256 samples), micro-nudge (Â±1 sample) y snap a cruce por cero (0-X).
  - [x] InserciÃ³n de cortes manuales, menÃº contextual de borrado y silenciamiento/muteo individual de rebanadas con preservaciÃ³n ante cambios de sensibilidad.
  - [x] Mapeo automÃ¡tico a GM Drum Map (C1..B2) y Modo CromÃ¡tico equidistante continuo 0..127 sin huecos.
  - [x] Parser recursivo IFF para archivos ReCycle 2.0 y 1.x (`.rx2`, `.rex`, `.rcy`), pistas CUE/Audacity y bloques WAV `cue `/`smpl`.
  - [x] Generador de patrones Standard MIDI (`.mid` Type 0) con timing original y botÃ³n arrastrable al DAW.
- [x] **Fase 18.8 - Universal Smart Import (Multi-Format Sampler Import + Preflight)**:
  - [x] Parsers nativos: Decent Sampler (`.dspreset`), Kontakt XML (`.nki` sin encriptar + deteccion de NI encriptado), HALion (`.vstpreset`), Bitwig (`.multisample`), Sample Chains (audio lineal con grid slicing).
  - [x] Dispatcher universal `parseUniversalSampler()` con auto-deteccion por cabecera binaria y extension.
  - [x] Motor Preflight (`importPreflight.ts`): huecos de teclado, solapamientos, capas de velocidad incompatibles, audio faltante; adaptaciones automaticas.
  - [x] Modal UI `UniversalImportModal.ts` con zona drag-drop, vista Preflight interactiva y checkboxes de adaptacion.
  - [x] Menu File reorganizado: `Universal Smart Import (Ctrl+I)` entrada principal; opciones individuales en submenu `Advanced Import`. Entrada duplicada en Edit.
  - [x] Suite de tests `phase18_universal_import.test.ts` (8/8 PASS).
- [x] **Fase 20 â AutocarÃ¡tula Asistida por IA (Model Cover Artwork Generator)**:
  - [x] GeneraciÃ³n de carÃ¡tulas cuadradas 512Ã512 en formato WebP con 6 estilos artÃ­sticos pre-diseÃ±ados.
  - [x] 3 vÃ­as de generaciÃ³n: Procedural Espectral (100% offline y gratis), Companion Bridge local (FastAPI 7860), y Cloud BYOK para 9 proveedores (Gemini, DALL-E 3, Claude, OpenRouter, DeepSeek, Groq, Mistral, HuggingFace FLUX, Replicate).
  - [x] ExtracciÃ³n semÃ¡ntica de motivos acÃºsticos instrumentales (`extractAcousticInstrumentMotif`) a partir de nombres de modelo y muestras.
  - [x] IntegraciÃ³n en `ProcessConfig.coverArtwork` y empaquetado en la capa `05_extended_model/cover.webp` de la CÃ¡psula del Tiempo.
- [x] **Fase 21 â DiagnÃ³stico de Salud del Sistema y Onboarding (`ConfigHealthModal.ts`)**:
  - [x] ComprobaciÃ³n automÃ¡tica de entorno en arranque: librerÃ­as locales (NeuronDB/AxionikDB), Companion Bridge local (7860) y claves BYOK.
  - [x] DistinciÃ³n visual entre elementos obligatorios y opcionales con enlaces directos para resolver cada uno.
  - [x] Indicador de salud dinamico en barra de navegacion y compuertas de seguridad (`isFeatureGated`).
- [x] **Fase 26 - Descompresion de Audio REX2 (.rx2) en Companion Bridge y Emparejamiento Automatico**:
  - [x] Implementacion en Python puro (`bridge/dwop_decompress.py`) del descompresor del flujo de audio DWOP con predictor adaptativo de 5 estados (mono y estereo).
  - [x] Endpoint `POST /api/decode-rx2` en el Companion Bridge (puerto 7860) con respuesta JSON que incluye buffer PCM WAV limpio en Base64, metadatos y frames decodificados.
  - [x] Anuncio de capacidad 'decode-rx2' en el endpoint `/api/health`.
  - [x] Metodo `decodeRx2Audio(rx2Buffer, filename)` en `BridgeClient.ts` con conversion binaria Base64 automatica.
  - [x] Integracion en `AudioChopperModal.ts`: decodificacion automatica transparente de archivos `.rx2`, `.rex` y `.rcy` abriendo el audio real con sus cortes originales.
  - [x] Asistente de Emparejamiento REX2 (`showRx2PairingAssistantModal`): ventana interactiva en modo desconectado con 3 opciones (emparejar con WAV/AIFF existente, reintentar conexion con el bridge, o previsualizacion con impulsos acusticos sinteticos).
  - [x] Integracion en Universal Smart Import (`rawSamplerParsers.ts` y `UniversalImportModal.ts`) con generacion de regiones cortadas y preflight adaptativo.
  - [x] Suite de pruebas automatizadas `tests/phase26_rex2_decode.test.ts` anadida al runner unificado (17/17 suites PASS).

---

## 5. Que FALTA por hacer (Siguientes Fases y Tareas Pendientes)

### 5.1 Tareas Inmediatas de Frontend & PreparaciÃ³n de Muestras
1. **Fase 25 â Procesador por Lotes para AutoSlicer / Audio Chopper (Batch AutoSlicer)**:
   - Integrar la detecciÃ³n y corte automÃ¡tico en el Batch Processor (`BatchProcessorModal.ts`).
   - Permitir procesar carpetas completas de loops rÃ­tmicos, frases vocales y archivos de rebanadas (`.rx2`/`.rex`/`.cue`) de forma 100% desatendida, generando modelos de baterÃ­a GM Drum Map, cromÃ¡ticos equidistantes o volcando archivos MIDI asociados.
2. **Fase 27 â AmpliaciÃ³n de Proveedores BYOK (Claude, OpenRouter, ChatGPT) y EstandarizaciÃ³n UI en Pills**:
   - Integrar endpoints de chat/razonamiento en `CloudByokClient` para enriquecimiento de prompts y anÃ¡lisis acÃºstico.
   - Sustituir selectores desplegables por el componente estÃ¡ndar de Pills en los diÃ¡logos de IA.
   - ActualizaciÃ³n del catÃ¡logo local del Companion Bridge segÃºn la especificaciÃ³n modular de `ABDShared/Docs/architecture/MODULAR_PACKAGES_STANDARD.md`.

### 5.2 Funcionalidades Avanzadas de Sampler e IntegraciÃ³n de Sintetizador
4. **Fase 22 â Suite de Funcionalidades Avanzadas de Sampler Profesional (EstÃ¡ndar Kontakt / HALion / Falcon)**:
   - Round-Robin (alternancia de muestras para evitar efecto ametralladora).
   - Release Triggers / Key-Off (muestras disparadas al soltar tecla: apagadores, ruidos de traste).
   - Auto-Mapping por expresiones regulares en nombres de fichero (ej. `Violin_C3_mf_rr1.wav`).
   - Matriz de ModulaciÃ³n MIDI (CC1, CC11, Aftertouch).
   - Soporte de Microtuning / Escalas Scala (`.scl`).
5. **Fase 23 â OrganizaciÃ³n JerÃ¡rquica de Bancos y SublibrerÃ­as de Modelos Extendidos**:
   - SublibrerÃ­as fÃ­sicas en disco bajo `/banks/<SublibraryName>/...`.
   - AsignaciÃ³n de modelos a subbancos en el diÃ¡logo de configuraciÃ³n y en el Batch Processor.
   - Regla de seguridad estricta para impedir borrado de sublibrerÃ­as que contengan modelos.
   - ReordenaciÃ³n manual jerÃ¡rquica con recÃ¡lculo dinÃ¡mico de posiciones.
6. **Fase 24 â SegmentaciÃ³n y Corte SemÃ¡ntico de Audio con IA (AI Semantic Slicing)**:
   - Modelos ligeros de alineaciÃ³n fonÃ©tica (vocal/speech) para cortar por palabras o sÃ­labas naturales.
   - SeparaciÃ³n de stems pre-troceado (vocal vs base rÃ­tmica con Demucs vÃ­a Bridge).
7. **Fase 11.4 & Fase 19 â Motor de SÃ­ntesis en Tiempo Real ABDAxionikVS (C++ / JUCE 9)**:
   - Motor software de reproducciÃ³n en tiempo real en plugin VST3/CLAP/AU.
   - **Modo Rompler Puro (Fase 19)**: ReproducciÃ³n directa de audio PCM de la capa `01_raw_source` (o `03_enhanced_audio` en 24b/96k) sin procesar por Scape/Sphere, con filtros analÃ³gicos modelados y capas hÃ­bridas Rompler + ResÃ­ntesis Neuronal.
   - Resynators con morphing vectorial 2D en joysticks Scape/Sphere.
   - Modos de salida Surround 4.0 / 5.1.
8. **Fase 28 - Estudio en Profundidad de Decent Sampler y Compatibilidad de Librerias Kontakt (Encriptadas vs Sin Encriptar)**:
   - Paridad integral con `.dspreset` (Round-Robin multinivel, Release Triggers con pitchKeyTrack="0", releaseDecay, controles UI, filtros y efectos).
   - Kontakt sin encriptar: parser binario legado (v1..v4) y descompresion de audio `.ncw` a WAV PCM.
   - Kontakt encriptado: deteccion temprana en Preflight de contenedores monoliticos cifrados por DRM de Native Instruments con diagnostico explicativo y vias de conversion.
9. **Revision final - NeuronDB Bank Browser**:
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
