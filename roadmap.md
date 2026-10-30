# ABDNeuModMakr — Roadmap

> Plan de desarrollo por fases. Cada fase es funcional por si misma.

---

## Fase 0 — Shell UI [COMPLETADA]

**Objetivo**: Interfaz completa conectada a datos mock, arrancable con `start.bat`.

- [x] Todos los componentes UI (Navbar, ZoneRibbon, ZoneInspector, ProcessPanel, KeyboardStrip, ProcessModal, TelemetryDrawer, BankDrawer)
- [x] CoreService interface + MockCore
- [x] Domain types (Zone, Session, ProcessConfig, etc.)
- [x] Integracion con `@abdsynths/shared` (tokens, SynthNavBar, iconos)
- [x] Vite dev server en puerto 8388
- [x] start.bat funcional
- [x] README, .gitignore

---

## Fase 1 — Pipeline de Audio TypeScript [COMPLETADA]

**Objetivo**: Analisis espectral real de archivos WAV y AIFF, sin dependencias externas.

### 1.1 Decodificador WAV & AIFF (`src/core/dsp/WavDecoder.ts`)
- [x] Parser de cabeceras RIFF/WAVE (`fmt `, `data`, `smpl`) y FORM/AIFF (`COMM` IEEE 80-bit float, `SSND`, `INST`)
- [x] Soporte PCM: 8, 16, 24, 32 bits + IEEE float 32/64 + `WAVE_FORMAT_EXTENSIBLE`
- [x] Soporte mono y estereo (downmix a mono `(L + R) * 0.5` para analisis)
- [x] Validacion de sample rate y bit depth + generador WAV PCM16 de prueba multi-parcial (`synthesizeDemoWav`)

### 1.2 Motor STFT (`src/core/dsp/FftEngine.ts`)
- [x] Implementacion FFT radix-2 Cooley-Tukey en TypeScript puro (sin dependencias)
- [x] Ventanas: Blackman-Harris 4-term (default 8192), Hanning, Blackman, Hamming
- [x] Parametros configurables: frame size (2048/4096/8192), hop size, overlap
- [x] Output: magnitud + fase por bin de frecuencia y `performFrequencyOnlyForwardTransform` compatible con JUCE

### 1.3 Peak-Picking armonico & Clustering (`src/core/dsp/SpectralAnalyzer.ts`, `LayerClustering.ts`, `GridIndicator.ts`)
- [x] Deteccion de F0 hibrida: HPS refinado (k=2..4 + escalera de octava debil) + ajuste Least-Squares de 2 pasadas
- [x] Peak-picking armonico (64 parciales) con interpolacion parabolica sub-bin en log-magnitud
- [x] Deteccion de sub-rejilla entrelazada (`f0/2` impares) y puerta de plegado de octava (`kOctaveFoldCents = 50`)
- [x] Clustering de trazas temporales en hasta 4 capas (`propia` / `entrelazada` / envolvente por descriptores o coseno)

### 1.4 Generador de tramas Scape/Sphere (`src/core/dsp/ScapeSphereGenerator.ts`)
- [x] Mapeo de complejidad `1..10` a `recDepth` autentico de `MODELmaker.exe` (`[1, 4, 8, 12, 16, 24, 32, 42, 54, 64]`)
- [x] Serializacion binaria autentica Neuron `.scape` (`csAN` + `mnAN` + `fdAN` + curva `int16`) y `.sphere` (`psAN` + `mnAN` + `fdAN` + tramas de 6568 B con banco de 1024 parciales `uint16`)
- [x] Generador de `map.script` (`create map` / `add mapentry`) y JSON `.neuronikmodel` v2/v2.1
- [x] Resintesis aditiva de verificacion (`resynthesizeModelToPcm`) y playback con Web Audio API

### 1.5 Web Workers (`src/core/worker/analysisWorker.ts`, `src/core/dsp/PipelineRunner.ts`)
- [x] Worker thread para el pipeline multi-zona completo (no bloquea UI) con fallback en hilo principal
- [x] Protocolo de mensajes tipado: `start`, `progress`, `result`, `error`, `cancel`
- [x] Integracion con `ProcessProgress` events de `CoreService` y suite de tests (`tests/phase1_pipeline.test.ts`)

---

## Fase 2 — Formatos Binarios y Arquitectura Dual-Target (`.model` Legacy + `.neuronikmodel` Modern) [COMPLETADA]

**Objetivo**: Soportar tanto el ecosistema clasico del Hartmann Neuron / `NeuronVS` (`legacy-neuron`) como el formato extendido de alta resolucion para la reinterpretacion moderna del sintetizador (`modern-neural`), segun lo documentado en `DOCS/ARCHITECTURE_DUAL_TARGET.md` y `DOCS/NASANALYSIS_DECOMPILATION.md`.

### 2.1 Fase 2A — Lectores y Empaquetado Estructural
- [x] Especificacion verificada de `.scape` (`csAN` + `mnAN` + `fdAN`), `.sphere` (`psAN` + `mnAN` + `fdAN` + frames `step = 16 + nb*paso*4 + 6152`), `map.script`, `MName` y los 20 mapas `mnAN` por `parameterSet` (`0..9`) en `DOCS/NEURON_MM_SPEC.md`
- [x] Selector de perfil de salida en `ProcessConfig`: `targetFormat: 'dual' | 'legacy-neuron' | 'modern-neural'`
- [x] **Reader binario `.model`** (`ModelFormat.ts`): importar archivos `.scape`, `.sphere`, `map.script` y `MName` para inspeccion, audicion y conversion a `.neuronikmodel`
- [x] **Reader/Writer de `.sound`** (`SoundFormat.ts`): esquema completo de 445 parametros (`sound.script`), migracion v1 `BlenderAmount`, clamping `FUN_100014c0` y `sound.stickrec`
- [x] Tests de ida y vuelta (round-trip): `write -> read -> compare` sobre modelos reales de `NeuronDB` (`511.model` "sinew" y `000.sound` "Symbiont") en `tests/phase2_formats.test.ts`

### 2.2 Fase 2B — Descompilacion 100% y Calibracion de `NASAnalysis.dll` (REA / Ghidra 12.1.4)
- [x] Desensamblado completo de `FUN_10009cf0` (`analyseSample_core`), `FUN_10003e60` (`createScapeFile`), `FUN_100038f0` (`createSphereFile`) y `FUN_10007e00` (`computePhaseVocoderPartials`) documentado en `DOCS/NASANALYSIS_DECOMPILATION.md`
- [x] Mapeo exacto de `FUN_100028e0` y `FUN_10001880` (`mnAN` y `fdAN` para los 10 `parameterSet`), `paso = 2^(floor(log2(recDepth - 1)) + 1)`, `nb = 61` (`r3 == 0`) vs `nb = 25` (`r3 != 0`) y frecuencias del Phase Vocoder en unidades de `0.5 Hz`

### 2.3 Fase 2C — Puente y Formato Extendido para el Nuevo Sintetizador (`modern-neural`)
- [x] Conversor directo `convertLegacyModelToModern` (`.model` legacy -> `.neuronikmodel` v2.1 JSON con preservacion de zonas, tramas y parciales)

---

## Fase 3 — Gestion de Archivos, Empaquetado ZIP/Directorio y Persistencia [COMPLETADA]

**Objetivo**: Flujo completo de importacion por lotes (`Import Samples` vs `Import by Name`), auto-mapeo de zonas, exportacion lista para CompactFlash/`NeuronDB` y persistencia local.

- [x] Importacion real de archivos WAV/AIFF mediante file picker y Drag & Drop sobre `ZoneInspector` (`Sample A` / `Sample B`) y menu `Import Samples (Ctrl+I)` (chunks `INST` / `smpl` + fallback de pitch por autocorrelacion)
- [x] **Auto-asignacion inteligente de zonas por nombre de archivo (`Import by Name`, `Ctrl+N`)**: soporte fiel para la convencion Hartmann `name_rootkey_lowkey[_v1|_v2]` y `_high` (`parseSampleFilenameByName`), fusion de capas de velocidad (`v1`/`v2`) y particion contigua `0..127`
- [x] **Importador de modelos `.model` / `.zip` existentes desde la UI (`importModelFiles`)**: abrir archivos de `<NNN>.model/` o paquetes `.zip` de `NeuronDB` para reconstruir sus zonas en el `ZoneRibbon`, resintetizar sus `.sphere`/`.scape` a WAV PCM16 reproducible y convertirlos a `.neuronikmodel` v2.1
- [x] **Empaquetador PKZIP (`ZipArchive.ts` + `buildModelExportZip`) `<NNN>.model/` y `<NNN>.sound/`**: descarga directa desde el menu `File -> Transfer / Export Model (.zip)... (Ctrl+T)` y desde `BankDrawer` de la estructura completa (`000001.scape`, `000001.sphere`, `map.script`, `MName`, `sound.script`, `sound.stickrec` y `Modern/<NNN>_<Name>.neuronikmodel`)
- [x] **Persistencia de sesion en `localStorage` y exportacion/apertura `.nmsession.json` (`Ctrl+S` / `Ctrl+O`)**: auto-guardado del proyecto activo y biblioteca de modelos generados
- [x] Suite de verificacion completa en `tests/phase3_files.test.ts`

---

## Fase 4 — Visualizacion Espectral y Preview [COMPLETADA]

**Objetivo**: Feedback visual y auditivo del analisis.

- [x] Canvas 2D: espectrograma 2D (`37x96` STFT Blackman-Harris) del sample seleccionado (`src/ui/SpectralView.ts`)
- [x] Overlay interactivo de los 64 parciales armonicos detectados sobre el espectrograma, coloreados por capa clusterizada (`Layer 0`, `Layer 1`, `Layer 2`)
- [x] Visualizacion de la reconstruccion (`WAVEFORM A/B` split view: envolvente original vs resintesis aditiva multi-capa + comparativa RMS dB, y `64 PARTIALS` con overlay FFT en tiempo real)
- [x] Playback de preview con Web Audio API (`A: Original` y `B: Resynthesis` con pitch-tracking al `KeyboardStrip` y boton `Stop`)
- [x] Indicadores de nivel (`dBFS` meter a 60fps) y espectro en tiempo real (`AnalyserNode` de 2048 puntos)
- [x] Suite de verificacion completa en `tests/phase4_spectral.test.ts`

---

## Fase 5 — UX Avanzada [COMPLETADA]

**Objetivo**: Calidad de produccion en la experiencia de usuario.

- [x] Undo/Redo stack (`undoStack` / `redoStack` de hasta 50 snapshots en `WebAudioPipeline.ts` con coalescencia automatica de 450 ms al arrastrar sliders)
- [x] Atajos de teclado completos (`Ctrl+Z`, `Ctrl+Y` / `Ctrl+Shift+Z`, `Ctrl+S`, `Ctrl+O`, `Ctrl+I`, `Ctrl+N`, `Ctrl+P`, `Ctrl+T`, `Ctrl+B`, `Ctrl+L`, `Insert`, `Delete`, `Space`)
- [x] Botones de Undo/Redo con tooltips dinamicos en `Navbar` y acciones en el menu `Edit`
- [x] Division rapida en `ZoneRibbon` mediante `Double-Click` o `Alt+Click` sobre el punto exacto de la zona
- [x] Validacion en tiempo real sin perdida de foco en `ProcessPanel` y `ZoneInspector` (contador `11` chars para hardware legacy `MName` vs `32` chars para `modern-neural`, rango de slot `0..511`, indicador de `stickModes` / `recDepth`, y boton de **Auto-Reparacion en 1 clic (`autoRepairCoverage`)** para huecos/solapes en `0..127`)
- [x] Suite de verificacion completa en `tests/phase5_ux.test.ts`

---

## Fase 5B — Convergencia Visual y Grafica con `ABDShared` (`@abdsynths/shared`) [COMPLETADA]

**Objetivo**: Unificar visualizadores graficos y hojas de estilo con la biblioteca comun `@abdsynths/shared`.

- [x] Reutilizar `SpectrumPlotter` (pestana `LOG CURVE`) y `createAboutDialog` en `SpectralView.ts` y `Navbar.ts`.
- [x] Normalizacion de CSS: asegurar el uso estricto de design tokens de `@abdsynths/shared/styles/tokens.css` sin colores hardcodeados.
- [x] Tabla multi-zona canonica de 9 columnas (`ZoneTableModel`: `Zone`, `Low Key`, `Root Key`, `High Key`, `Low Vel`, `High Vel`, `Detune`, `Volume`, `Pan`) con octavas y rangos canonicos (`0 C-2 .. 127 G8`).

---

# Evolucion Next-Gen (Fases 6 a 14)

---

## Fase 6 — Creacion Dual (Clasica vs Extendida) e Importacion Universal a Formato Nativo [COMPLETADA]

### 6.1 Modo de Creacion Conmutable (`Classic Creation` vs `Extended Creation`)
- [x] Conmutacion libre entre Creacion Clasica y Creacion Extendida.
- [x] Mapa 2D libre de regiones (`Key x Velocity`) con tamanios independientes.
- [x] Crossfades en Altura y Velocidad (`keyFadeIn/Out`, `velFadeIn/Out`).
- [x] Modos de Loop (`no_loop`, `loop_continuous`, `loop_sustain`, `ping_pong`, `loop_backward`, `one_shot`).
- [x] Seguimiento de Teclado (`pitchKeytrack`: 0% a 100%).
- [x] Modos de Disparo (`trigger: attack | release | first | legato`) y secuencias Round-Robin.
- [x] Mapeo controlado y aislado hacia `sound.script` (`ABDAxionikVS`) hacia `R1AmpEnv*`, `Filter*` y `LFO*`, manteniendo en `0` las modulaciones no deseadas hacia Scape/Sphere.

### 6.2 Importador de `.sf2` (SoundFont 2) y `.sfz` a Definicion Nativa
- [x] Parser binario nativo de `.sf2` (`Sf2Parser.ts`) con selector de presets y union inteligente de pares estereo L/R en WAVs estereo reales.
- [x] Parser nativo de `.sfz` (`SfzParser.ts`).
- [x] Captura de envolventes DAHDSR, filtros y LFOs con opcion de bake sobre la onda.
- [x] Conversion inmediata a formato propio y descarte del archivo de origen externo.

### 6.3 Compilador / Adaptador de Extendido -> Clasico en Exportacion
- [x] Particionado automatico de columnas contiguas 0..127 sin huecos.
- [x] Compensacion exacta de volumen entre velocidades escalando directamente magnitudes espectrales (`10^(deltaDb / 20)`).
- [x] Reduccion de N velocidades a las 2 franjas clasicas (`1..63` y `64..127`).

---

## Fase 7 — Autodeteccion Inteligente y Motor Clasico Mejorado (`Classic Enhanced`) [COMPLETADA]

- [x] Detector hibrido de pitch F0 (YIN/MPM en tiempo + HPS/Least-Squares en frecuencia) con indice de armonicidad y detector percusivo/ruido.
- [x] Extractor de descriptores acusticos (`extractAcousticDescriptors`) y clasificador automatico de Tipo de Instrumento y Parameter Set (0..9) (`classifyAcousticSample`).
- [x] Motor espectral clasico mejorado (`applyEnhancedSpectralModel`): separacion HPSS, suavizado de trayectorias y supresion de piso de ruido en parciales superiores.
- [x] Comparador de audicion A / B / C (`Original` vs `Legacy DSP` vs `Enhanced DSP`) con metrica objetiva de calidad (*Quality Score*).

---

## Fase 8 — Estandar de Audio Maestro (`Master Wave Format`), Expansion de Loops y Regeneracion [COMPLETADA]

- [x] Definicion del Estandar Maestro: **24-bit PCM / 96.000 Hz** con dithering TPDF y marcas de loop en chunk `smpl`.
- [x] Espacializacion nativa: Mono, Estereo (2.0) y Quad Surround (4.0), con reduccion limpia en fase a Mono 44.1 kHz para el binario clasico.
- [x] Tres vias de promocion: Conversion Directa, Mejora DSP Moderna (BWE hasta 42 kHz) y Puente IA.
- [x] Ampliacion inteligente de loops cortos a 3-6s con modulacion organica de fase y recalculo automatico de puntos de cruce por cero (`NCC`).
- [x] Regeneracion desde la libreria original `NeuronDB` (.scape + .sphere -> WAV maestro con splines Catmull-Rom).

---

## Fase 9 — Contenedor Multiformato ("Capsula del Tiempo") e `IndexedDB` [COMPLETADA]

- [x] Estructura de 5 capas: `01_raw_source`, `02_legacy_original`, `03_enhanced_audio`, `04_classic_enhanced`, `05_extended_model`.
- [x] Metadatos de procedencia (`manifest.json` y `provenance.json`) y regla de linaje estricto ("Cero Efecto Fotocopia").
- [x] Persistencia de activos binarios pesados en `IndexedDB` (`NeuronAssetStore.ts`) con cache en memoria y fallback en tests.

---

## Fase 10 — Arquitectura de IA Hibrida, Despliegue en Vercel, PWA y Skins [COMPLETADA]

**Objetivo**: Maxima accesibilidad en la nube para usuarios estandar y maxima potencia local para usuarios con hardware avanzado.

### 10.1 Despliegue Vercel SPA y Vendorizado Sincronizado
- [x] `vendor:sync` automatizado para compilar en Vercel de forma autocontenida sin dependencias externas fuera del repo.
- [x] `vercel.json` optimizado con politicas de cache inmutables para assets y cabeceras de seguridad.
- [x] Despliegue publico activo en [https://abd-neumodmakr.vercel.app/](https://abd-neumodmakr.vercel.app/).

### 10.2 PWA / Offline (Desktop Instalable)
- [x] Service Worker (`sw.js`) y `manifest.webmanifest` para funcionamiento 100% desconectado.
- [x] Instalacion como app de escritorio desde el menu `Help -> Install Desktop App (PWA)...`.

### 10.3 Companion Bridge Local (Python 7860 & GPU Local)
- [x] Servidor ligero en `bridge/server.py` compatible con CPU o GPU dedicada (CUDA / MPS).
- [x] Integracion en `start.bat`: verificacion de puerto 7860 y arranque automatico en segundo plano minimizado.
- [x] Descargador transparente multihilo de checkpoints en disco (`GET /api/models`, `POST /api/models/download`, `GET /api/models/progress`) para AudioSR (~2.5GB), HTDemucs (~150MB) y BasicPitch (~15MB).

### 10.4 Motor de Serie en el Navegador (WebGPU + WebAssembly SIMD)
- [x] Inferencia neuronal directa en el cliente [`WebNeuralEngine.ts`](src/core/ai/WebNeuralEngine.ts):
  - Deteccion de WebGPU (`navigator.gpu` con Direct3D12/Vulkan, validado en NVIDIA RTX 3070 8GB).
  - Fallback a WASM SIMD y fallback matematico DSP.
  - Cero dependencias de servidor, cero coste y 100% privado en cliente.
  - Utilizado en deteccion de F0, clasificador de timbres y detector de ventanas de sostenido para auto-loop.

### 10.5 Cloud AI (BYOK - Bring Your Own Key)
- [x] Cliente [`CloudByokClient.ts`](src/core/ai/CloudByokClient.ts) para modelos cloud opcionales sin servidor intermedio.
- [x] Almacenamiento estricto de claves API en `localStorage` del cliente. Jamas se transmiten a servidores propios.
- [x] Soporte para Replicate (AudioSR / MusicGen), Hugging Face (Inference Endpoints) y Google Gemini.
- [x] Comprobador de conexion en tiempo real y selector de visibilidad de clave.

### 10.6 Dirty Tracking & Hash Caching
- [x] Huella digital de audio por hash FNV-1a / SHA-256 (`computeAudioBufferHash`).
- [x] Si el audio no ha cambiado, la reutilizacion de 24b/96k en `NeuronAssetStore` es instantanea (0 ms).
- [x] Proteccion de loops manuales: preserva los puntos fijados a mano por el usuario al re-promover.

### 10.7 Sistema de Skins de Hardware Dual-Mode (6 Familias x Claro/Oscuro)
- [x] 6 familias de sintetizadores: Hartmann Neuron, Access Virus Snow, AudioLab, Korg MS2000, Hartmann Advanced, Casio CZ-101.
- [x] Variantes reales Clara y Oscura para cada una.
- [x] Tema canónico por defecto: **Hartmann Neuron Claro** (`neuron-light`).
- [x] Conmutador sol/luna directo en el HUD y persistencia de tema en `localStorage`.
- [x] Politica estricta de **Cero Emojis** en toda la interfaz (iconos monocromos SVG).

### 10.8 Modal Unificado de Configuracion General & Gestion de Modelos (`SettingsModal.ts`)
- [x] Icono de rueda dentada en el extremo derecho del Navbar (`ICONS.settings` / atajo `Ctrl+,`).
- [x] Unificacion de ajustes generales: Hardware Skin (6 familias), modo Claro/Oscuro, Modo Clasico vs Extendido (con garantia bidireccional no destructiva) y rutas de libreria local con escaneo Bridge.
- [x] Consolidacion de las matrices de IA: WebGPU/WASM, Cloud BYOK y Companion Bridge en un unico dialogo modular coherente.
- [x] Gestion de espacio en disco: accion para **Desinstalar / Borrar modelos neuronales** de disco para liberar gigabytes de almacenamiento cuando no se necesiten.
- [x] Editor de URLs / Mirrors de descarga por modelo: permite personalizar la URL de pesos (por si cambian los repositorios o se usan checkpoints propios fine-tuneados) con opcion de restablecer la URL oficial en un clic.
- [x] Animacion de spinner de descarga y estados de carga en tiempo real sin falsos bloqueos.

---

## Fase 11 — Procesado del Modo Extendido, Arquitectura AxionikDB y Nuevos Resynators (`ABDAxionikVS`) [EN CURSO / ESPECIFICADA]

**Objetivo**: Integración total entre ABDNeuModMakr y el sintetizador de nueva generación ABDAxionikVS mediante el repositorio canónico `AxionikDB`.

### 11.1 Repositorio y Banco Avanzado: `AxionikDB` [COMPLETADA]
- [x] Carpeta canónica `AxionikDB` en disco, separada físicamente de la clásica `NeuronDB` para no contaminar el hardware original de 2002.
- [x] Estructura de paquete autocontenida por modelo basada en la Cápsula del Tiempo:
  ```
  AxionikDB/
  ├── Models/
  │   └── <model-slug>/
  │       ├── manifest.json            (Metadatos completos, linaje, etiquetas acústicas)
  │       ├── cover.webp               (Carátula 512x512)
  │       ├── 04_classic_enhanced/     (MName, map.script, .scape, .sphere, sound.script)
  │       └── 05_extended_model/       (model.nmmodel, extended_map.json, 2D regions)
  └── Presets/
      └── <preset-name>.axpreset       (Presets de articulación global del sintetizador)
  ```
- [x] **Liberación del yugo de ranura (0..511)**: El identificador principal pasa a ser el **Slug Semántico** del modelo (`slugifyModelName`, `createUniqueModelSlug`). La ranura numérica `000..511` solo se genera de forma virtual si se exporta a hardware clásico.
- [x] **Sincronización de carpetas y "Guardar como..." (`Save As...`)**:
  - Opción directa `Salvar en AxionikDB` y `Salvar en AxionikDB como...` para duplicar modelos de forma no destructiva y experimentar con diferentes parámetros o carátulas.
  - Sincronización automática del nombre de la subcarpeta del banco si el usuario renombra el modelo consolidado.
- [x] **Doble Denominación de Modelo (Dual-Naming: Classic 11-char vs Expanded Unrestricted)**:
  - **Modo Clásico**: `modelName` limitado estrictamente a 11 caracteres ASCII (limitación física del hardware Hartmann Neuron 2002 para archivos `MName` y visualización LCD).
  - **Modo Extendido**: `expandedName` sin limitación arbitraria de caracteres para presets modernos y el ecosistema `ABDAxionikVS`, manteniendo en paralelo un `modelName` de 11 caracteres para retrocompatibilidad hacia la capa clásica `04_classic_enhanced`.

### 11.2 Catálogo Ampliado de Instrumentos y Clasificación IA [COMPLETADA]
- [x] Taxonomía moderna de 14 categorías ricas de sonido para el clasificador acústico de IA (WebGPU, WASM y Bridge):
  1. `Vocal & Choir` -> Mapeo clásico: Set 5 (Winds & Voice)
  2. `Drums & Percussion Kit` -> Mapeo clásico: Set 8 (Drums & Perc)
  3. `Orchestral & Strings` -> Mapeo clásico: Set 1 (Strings)
  4. `Keyboards & Acoustic Pianos` -> Mapeo clásico: Set 2 (Keyboards)
  5. `Electric Pianos & Tines` -> Mapeo clásico: Set 2 (Keyboards)
  6. `Bass & Low End` -> Mapeo clásico: Set 4 (Bass)
  7. `Plucked & Ethnic / World` -> Mapeo clásico: Set 3 (Plucked)
  8. `Brass & Horns` -> Mapeo clásico: Set 1 (Winds & Brass)
  9. `Woodwinds & Reeds` -> Mapeo clásico: Set 1 (Winds & Brass)
  10. `Mallets & Chromatic Perc` -> Mapeo clásico: Set 7 (Mallets & Bells)
  11. `Pads & Atmospheres` -> Mapeo clásico: Set 6 (Pads & Textures)
  12. `Synth Leads & Solos` -> Mapeo clásico: Set 0 (Synth & Neutral)
  13. `SFX, Drones & Cinematic` -> Mapeo clásico: Set 9 (SFX & Experimental)
  14. `Arpeggiated & Sequences` -> Mapeo clásico: Set 8 (Loop Factory)
- [x] Los 10 Parameter Sets clásicos de Hartmann (0..9) se calculan automáticamente para retrocompatibilidad hacia la capa `04_classic_enhanced`.

### 11.3 BankManager en Modo Avanzado (Opción A: Pestañas Unificadas) [COMPLETADA]
- [x] En Modo Clásico: El BankManager solo muestra los modelos de `NeuronDB`.
- [x] En Modo Avanzado: El BankManager desbloquea dos pestañas superiores (`AxionikDB` y `NeuronDB`), permitiendo cargar modelos clásicos para extenderlos y guardarlos en `AxionikDB`.

### 11.4 Motor Espectral de Alta Definición y Resynators [EN CURSO]
- [ ] Formato Espectral de Alta Definicion (>64 parciales, >16 tramas).
- [ ] Separacion de formantes y pitch para Formant Shifting en tiempo real.
- [ ] Campos de morphing 2D/3D y espacio latente (Autoencoder / VAE).
- [ ] Modelos Surround reales (Quad 4.0 / 5.1) con Scape frontal y Sphere envolvente.
- [ ] Disparo hibrido de transitorios PCM reales fundidos en fase con el cuerpo.

---

## Fase 12 — Procesamiento por Lotes (`Batch Processor`) [COMPLETADA]

**Objetivo**: Procesamiento desatendido por lotes sobre colecciones completas de `NeuronDB`, archivos multi-preset SoundFont (`.sf2`), librerías de carpetas de muestras (`.wav`/`.aiff`) y definiciones `.sfz`.

### 12.1 Fuentes de Entrada Soportadas en Lote
- [x] **SoundFont 2 Multi-Preset**: Detección de todos los presets del SF2, extrayendo cada uno como un modelo candidato independiente con mapeo automático de zonas key/vel (`Sf2BatchExtractor.ts`).
- [x] **Carpetas de Muestras / Instrument Packs**: Procesamiento de directorios con subcarpetas donde cada subcarpeta define un modelo (`FolderBatchExtractor.ts`), o agrupación por prefijo de instrumento.
- [x] **NeuronDB Clásico Completo**: Migración y re-análisis en lote de bancos históricos `000.model`..`511.model` para generar Cápsulas del Tiempo de 5 capas.

### 12.2 Motor de Cola Desatendida & Tolerancia a Fallos
- [x] Cola FIFO asíncrona no bloqueante (`BatchQueue.ts`) con procesamiento secuencial desatendido y liberación de memoria por modelo.
- [x] Aislamiento de errores: Un archivo corrupto o con sample-rate no estándar no detiene el lote; se registra en el log y el procesador salta al siguiente modelo.
- [x] Controles de ejecución: Iniciar, Pausar, Reanudar, Cancelar e Indicador de progreso global (`Modelo N de Total`, tiempo estimado restante, porcentaje global e individual).

### 12.3 Configuración de Lote, Preflight & Destinos de Salida
- [x] **Herencia de Configuración Activa**: El lote hereda la configuración activa de la sesión (algoritmo DSP Clásico/Mejorado, Modo de Trabajo Clásico/Extendido, Motor IA activo WebWorker/CUDA Bridge, formato destino).
- [x] **Inspección Preflight Obligatoria**: Resumen detallado previo al arranque que desglosa **qué va a hacer**, **cómo lo va a hacer**, qué motor IA/DSP empleará y **sobre qué ficheros** operará (`preflight.ts`).
- [x] **Destinos**: Exportación a archivo maestro PKZIP (`.zip`) con todas las Cápsulas del Tiempo o sincronización directa a la librería local `AxionikDB` vía Companion Bridge.
- [x] **UI y Atajos**: Modal interactivo de 4 pasos (`BatchProcessorModal.ts`), botón de acceso directo en Navbar y atajo de teclado `Ctrl+Shift+B`. Suite de tests automatizada (`phase12_batch.test.ts`) integrada en el ejecutor continuo `run_all.ts`.

---

## Fase 13 — Editor Visual Interactivo de Loops (`Waveform Loop Editor`) [COMPLETADA]

- [x] Canvas de forma de onda con zoom horizontal continuo (1x a 32x) y marcadores arrastrables `L-START`, `L-END` y rampa de crossfade.
- [x] Lupa de empalme de cruce por cero (*Zero-Crossing Magnifier*) con curvas fantasma de continuacion y snap automatico.
- [x] Motor auto-loop multi-algoritmo (`pitch_periodic`, `ncc_zc`, `min_seam_energy`, `equal_power_xfade`).
- [x] Soporte para bucles Ping-Pong y Reverse.
- [x] Audicion interactiva por fila con envolvente DAHDSR, volumen, paneo y desafinacion.

---

## Fase 14 — Portada / Artwork del Modelo en Formato `.webp` [COMPLETADA]

- [x] Carga de imagen de portada para modelos extendidos en `ProcessPanel.ts` y tarjetas de `BankDrawer.ts`.
- [x] Conversion y optimizacion automatica en cliente a `cover.webp` (512x512 centrado).
- [x] Modal de inspeccion en alta definicion con metadatos tecnicos.
- [x] Empaquetado en la capa `05_extended_model/cover.webp` de la Capsula del Tiempo.

---

## Fase 15 — Testing, CI/CD y Verificacion de Calidad [COMPLETADA / EN MANTENIMIENTO]

- [x] Suite de tests automatizados de 8 fases (`npx tsx tests/run_all.ts` 100% pasando).
- [x] Verificacion estricta de tipos (`npm run test:types` 0 errores).
- [x] Build de produccion optimizado (`npm run build` en <1s).
- [x] CI/CD y despliegue continuo en Vercel vinculado a la rama `master`.

---

## Fase 16 — Utilidad Universal de Exportación Multi-Formato desde File (Bancos e Instrumentos Raw) [PLANIFICADA]

**Objetivo**: Exportar la colección de zonas, mapeos y muestras originales (material *raw* antes de análisis/procesamiento de resíntesis) a los principales estándares de la industria del sampling y samplers virtuales/hardware.

### 16.1 Integración en Interfaz de Usuario
- [ ] Nuevo acceso en el menú principal: `File -> Export Sampler / Multi-Format Bank...` (con atajo y selector de perfiles).
- [ ] Diálogo de configuración con múltiples opciones (similar a Save As / Export):
  - Selección de formato de salida.
  - Selección de resolución y sample rate de audio (conservar original o remuestrear a 44.1k/48k/96k).
  - Normalización opcional y retención de metadatos/licencia.
  - Opciones de estructura de carpetas (monolítico incrustado vs parche con subcarpeta `Samples/`).

### 16.2 Formatos de Destino Soportados (Muestras Originales Intactas)
*Nota*: La exportación opera exclusivamente sobre la materia prima original (muestras WAV/AIFF directas, zonas `lowKey..highKey`, `lowVel..highVel`, `rootKey`, afinación, volumen, paneo y rangos de loop `L-START`/`L-END`), **sin pasar por los transformadores espectrales Scape/Sphere de Neuron**.

1. **SoundFont 2 (`.sf2`)**:
   - Generador binario RIFF `sfbk` con bloques `INFO` (nombre de preset, autor, licencia, software), `sdta` (banco de muestras PCM16 contiguo con padding) y `pdta` (jerarquía PHDR/PBAG/PMOD/PGEN -> IHDR/IBAG/IMOD/IGEN -> SHDR con cabeceras de muestra y bucle).
2. **SFZ Format (`.sfz` + carpeta de samples)**:
   - Archivo de definición en texto plano estándar compatible con Cakewalk/Plogue/LinuxSampler/Sforzando.
   - Declaración de encabezados `<control>`, `<global>`, `<group>` y `<region>` con rutas relativas a las muestras, puntos de loop, rangos de teclas y velocidades.
3. **Native Instruments Kontakt (`.nki` - ej. Kontakt 5)**:
   - Parche de instrumento Kontakt o formato estructurado con zonas y mapeo de grupos basado en las especificaciones técnicas disponibles de parches monolíticos/desempaquetados.
4. **Steinberg HALion (`.vstpreset` / `.fxp`)**:
   - Estructura de programa y capas de zona para el sampler de Steinberg con mapeo de articulación.
5. **IK Multimedia SampleTank**:
   - Definición de instrumento de librería SampleTank con metadatos asociados.
6. **Otros formatos abiertos con especificación técnica documentada**:
   - Decent Sampler (`.dspreset` basado en XML).
   - Bitwig Studio Multisample (`.multisample`).
7. **Cadena Lineal de Muestras Concatenadas (WAV / AIFF "Sample Chain / Key Map")**:
   - Exportación de un único archivo de audio lineal continuo (`.wav` o `.aiff`) con todos los tonos/muestras ordenados y pegados secuencialmente uno detrás de otro.
   - Incrustación de marcas de división/cue points o regiones RIFF/smpl para samplers hardware y grooves (Elektron Octatrack, Roland SP-404, Korg electribe, OP-1/OP-Z).

---

## Fase 17 — Evolución Conjunta con ABDAxionikVS (Metadatos Ricos y Doble Nomenclatura) [COMPLETADA EN CLIENTE]

- [x] **Doble Nomenclatura de Modelos Totalmente Independiente**:
  - `modelName`: Nombre estricto clásico de 11 caracteres ASCII (hardware Hartmann Neuron 2002 / `MName` legacy).
  - `expandedName`: Nombre sin restricción de longitud de caracteres para el modo extendido y presets de `ABDAxionikVS`.
  - Conmutación no destructiva bidireccional: Escribir un nombre extendido largo (ej. 50 caracteres) y alternar a Modo Clásico muestra el nombre clásico de 11 caracteres; al regresar a Modo Extendido el nombre extendido permanece 100% íntegro e inalterado.
  - Inicialización consistente: Al crear una sesión o importar muestras, ambos nombres se inicializan con el valor base apropiado.
- [x] **Metadatos Ricos y Atributos Libres (`ExtendedModelMetadata`)**:
  - Proveniencia y origen: URL de procedencia del SoundFont/muestra (`sourceUrl`) con botón de apertura web, formato original (`sourceFormat`), preset de origen (`sourcePresetName`).
  - Licencia y autoría: Autor/diseñador sonoro (`author`), librería/distribuidor (`vendor`), versión semántica (`version`, ej. "1.0.0"), tipo de licencia (`license`, ej. "CC-BY 4.0", "CC0", "Comercial") y descripción técnica/acústica (`description`).
  - Atributos libres definidos por el usuario: pares de metadatos `customAttributes: [{ tag: string, value: string }]` con editor dinámico interactivo en la tarjeta de `ProcessPanel.ts` (`+ Add Tag` y eliminación individual).
  - Validación y persistencia en esquema de sesión (`sessionSchema.ts`) y empaquetado transparente en la Cápsula del Tiempo (`manifest.json` y `05_extended_model/extended_map.json`).

---

## Fase 18 — Utilidad Inteligente de Troceado (Audio Chopper / Slicer) y Auto-Mapeo Multicapa por Tono y Volumen [PLANIFICADA]

**Objetivo**: Segmentar archivos de audio continuos (WAV/AIFF) en rebanadas individuales (slices) y distribuirlos de forma inteligente en zonas de teclado y capas de velocidad, con lógica especializada para percusión o instrumentos cromáticos.

### 18.1 Flujo Modular Desacoplado en Etapas
1. **Limpieza y Trimming de Silencios (*Silence Stripping*)**:
   - Detección de umbral dinámico RMS para eliminar espacios vacíos al inicio, entre tomas y al final de las muestras.
   - Snapping automático del inicio y final de corte en puntos exactos de cruce por cero (zero-crossing) para prevenir chasquidos.
2. **Rebanado / Detección de Transitorios (*Chopping / Slicing*)**:
   - Detección de transitorios basada en flujo espectral (Spectral Flux), densidad de onsets o tracking neural (Spotify Basic Pitch).
   - Generación de marcadores de slice editables interactivamente.
3. **Clasificación del Tipo de Material (Drums vs Cromático)**:
   - **Modo Ritmos / Percusión (Drums)**:
     - Clasificación asistida por algoritmos o IA del tipo de golpe (Kick, Snare, Hi-Hat cerrado/abierto, Toms, Platos, Percusión).
     - Asignación y distribución automática siguiendo la norma universal **General MIDI (GM Drum Map)** (ej. Kick en C1/36, Snare en D1/38, Closed Hat en F#1/42, etc.).
   - **Modo Tonal / Cromático (Instrument / Melodic)**:
     - Detección automática de F0 y nota raíz (root key) de cada fragmento.
     - Reparto inteligente equidistante sobre el keybed: colocación de la nota raíz en el centro exacto de su rango (`rootKey` centrado entre `lowKey` y `highKey`), calculando las fronteras intermedias equidistantes entre notas consecutivas según las mejores prácticas de la industria de samplers profesionales.
4. **Distribución Multicapa por Volumen / Dinámica (Velocity Layers)**:
   - Medición de amplitud de pico y energía RMS de cada slice correspondiente a un mismo tono o elemento percusivo.
   - Asignación a capas de velocidad ordenadas (ej. suave 1..42, medio 43..85, fuerte 86..127).
5. **Control de Solapamiento Configurable (*Overlap Policy*)**:
   - Modo por defecto: Partición disjunta y contigua 0..127 sin solapamientos de notas ni velocidades.
   - Opción conmutable de solapamiento: Permitir solape de rangos para crossfading de zonas y velocity switching.
   - Validación de compatibilidad contra el perfil de exportación activo (e.g. limitación clásica vs libertad extendida).
6. **Arquitectura Transversal Reutilizable**:
   - Los submódulos de auto-detección tonal y re-distribución equidistante de zonas son utilidades independientes del Core, aplicables a cualquier sesión o lote de importación, no restringidas únicamente al chopper.

---

## Fase 19 — Modo Rompler Puro en ABDAxionikVS (Reproducción de Audio Crudo / Raw Multisample) [PLANIFICADA]

**Objetivo**: Permitir que el sintetizador software `ABDAxionikVS` opere como un rompler tradicional de alta definición, cargando y reproduciendo directamente la materia prima sin procesar de la capa `01_raw_source` (o `03_enhanced_audio` en 24-bit/96kHz).

### 19.1 Características y Aprovechamiento del Sistema
- **Reproducción Directa PCM de Alta Fidelidad**: Carga de multisamples con mapeos de zonas key/vel intactos, prescindiendo opcionalmente de los transformadores Scape/Sphere.
- **Herencia Integral del Motor de Síntesis**:
  - Filtros multimodo modelados analógicamente, distorsión no lineal y generadores DAHDSR ultra-rápidos.
  - Reproducción de bucles continuos y ping-pong perfeccionados con el editor de loops y lupa de cruce por cero de NeuModMakr.
  - Interpolación polifónica sinc de alta calidad sin artefactos de aliasing.
- **Capas Híbridas Rompler + Resíntesis Neuronal**: Posibilidad de apilar o hacer morphing entre una capa de audio muestreado crudo (ataque rápido y natural) y una capa aditiva de resíntesis neuronal Hartmann (cuerpo mutante y modelado espectral continuo).


