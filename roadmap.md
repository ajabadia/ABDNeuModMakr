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

## Fase 16 — Utilidad Universal de Exportación Multi-Formato desde File (Bancos e Instrumentos Raw) [COMPLETADA]

**Objetivo**: Exportar la colección de zonas, mapeos y muestras originales (material *raw* antes de análisis/procesamiento de resíntesis) a los principales estándares de la industria del sampling y samplers virtuales/hardware.

### 16.1 Integración en Interfaz de Usuario
- [x] Nuevo acceso en el menú principal: `File -> Export Sampler / Multi-Format Bank...` (`Ctrl+Shift+E`).
- [x] Diálogo de configuración con múltiples opciones (`RawSamplerExportModal.ts`):
  - Selección de formato de salida: SF2, SFZ, Decent Sampler, Bitwig Multisample, Kontakt XML, HALion vstpreset, Sample Chain.
  - Selección de resolución y sample rate de audio (conservar original o remuestrear a 16-bit/24-bit PCM y 44.1k/48k/96k).
  - Normalización opcional (Off, 0 dBFS Peak, -0.3 dBFS True-Peak) y retención de metadatos/licencia.
  - Opciones de estructura de carpetas (monolítico incrustado vs paquete ZIP con subcarpeta `Samples/`).
- [x] **Compuerta de Preflight y Notificación de Incompatibilidades Técnicas** (`rawSamplerPreflight.ts`):
  - Análisis técnico en tiempo real contra los límites del formato de destino:
    - Resolución > 16-bit en SF2 -> clamp y dither TPDF con aviso interactivo.
    - Curvas DAHDSR de 6 etapas -> adaptación a ADSR estándar sumando delay/hold al ataque.
    - Bucles complejos (ping-pong / micro-crossfades) -> adaptación a forward loop continuo.
    - Muestras ausentes en memoria -> detección y bloqueo preventivo del botón de exportación.
    - Sample rates dispares en Sample Chain -> remuestreo y unificación automática.
  - Panel visual de estado (`ALL SPECIFICATIONS COMPATIBLE` / `ADAPTATIONS REQUIRED` / `INCOMPATIBILITIES DETECTED`) con lista detallada de advertencias, mitigaciones y botón de parada/cancelación voluntaria.

### 16.2 Formatos de Destino Soportados (Muestras Originales Intactas)
*Nota*: La exportación opera exclusivamente sobre la materia prima original (muestras WAV/AIFF directas, zonas `lowKey..highKey`, `lowVel..highVel`, `rootKey`, afinación, volumen, paneo y rangos de loop `L-START`/`L-END`), **sin pasar por los transformadores espectrales Scape/Sphere de Neuron**.

1. **SoundFont 2 (`.sf2`)** (`soundfont2Writer.ts`):
   - Generador binario RIFF `sfbk` con bloques `INFO` (versión 2.04, EMU8000, banco, autor, licencia, software), `sdta` (banco de muestras PCM16 contiguo con 46 muestras de relleno anti-click) y `pdta` (jerarquía PHDR/PBAG/PMOD/PGEN -> INST/IBAG/IMOD/IGEN -> SHDR con cabeceras de muestra y bucle).
2. **SFZ Format (`.sfz` + carpeta de samples en `.zip`)**:
   - Archivo de definición en texto plano estándar compatible con Cakewalk/Plogue Sforzando/LinuxSampler.
   - Declaración de encabezados `<control>`, `<global>`, `<group>` y `<region>` con rutas relativas a las muestras, puntos de loop, rangos de teclas, velocidades, desafinación y envolventes.
3. **Decent Sampler (`.dspreset` + carpeta `Samples/` en `.zip`)**:
   - Formato XML nativo de Decent Sampler con controles UI de Attack, Release, Tone y Volume, mapeo de samples, volumen, afinación y bucles.
4. **Bitwig Studio Multisample (`.multisample`)**:
   - Paquete multisample `.multisample` (archivo zip estándar con `multisample.xml` y carpeta `Samples/`) directamente importable en Bitwig Studio.
5. **Native Instruments Kontakt (`.nki.zip` con XML estructurado)**:
   - Parche de instrumento Kontakt estructurado con zonas y mapeo de grupos basado en las especificaciones técnicas disponibles.
6. **Steinberg HALion (`.vstpreset.zip` con XML de programa)**:
   - Estructura de programa HALion y capas de zona para el sampler de Steinberg con mapeo de articulación.
7. **Cadena Lineal de Muestras Concatenadas (`.wav` Sample Chain / Key Map)** (`sampleChainWriter.ts`):
   - Archivo de audio continuo lineal de 24-bit o 16-bit PCM con todos los tonos/muestras concatenados secuencialmente.
   - Incrustación de marcas de división RIFF `cue ` y etiquetas `LIST adtl` con subbloques `labl` para samplers hardware (Elektron Octatrack, Roland SP-404 MKII, Korg electribe, OP-1/OP-Z).
   - Generación de índice y mapa de marcas (`_slices.txt`).

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
- [x] **Reubicación UX de Edición de Metadatos/Tags al Modal de Configuración Global (Model Configuration)** [COMPLETADA]:
  - En `ProcessPanel.ts`: Mostrar un resumen visual compacto en modo solo-lectura (chips/etiquetas de Autor, Versión, Licencia y Tags libres, solo si existen) con un botón interactivo `[ ✏ Edit ]`.
  - En el Modal de configuración global (`ModelConfigModal.ts`): Pestaña dedicada `Metadata & Tags (SoundFont & Provenance)` donde se aloja el editor completo de todos los campos de autoría, enlaces, descripciones y tags personalizados (`customAttributes`), liberando espacio vertical en el panel de procesado y garantizando una experiencia limpia.

---

## Fase 18 — Utilidad Inteligente de Troceado (Audio Chopper / Slicer) y Auto-Mapeo Multicapa por Tono y Volumen [COMPLETADA]

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
5. **Control de Solapamiento y Preflight de Exportación con Aviso al Usuario**:
   - Modo por defecto: Partición disjunta y contigua 0..127 sin solapamientos de notas ni velocidades.
   - Opción conmutable de solapamiento: Permitir solape de rangos para crossfading de zonas y velocity switching.
   - **Preflight & Parámetros Incompatibles**: Si el formato de exportación seleccionado (e.g. Classic Hartmann `.model`) no admite algún parámetro de los slices (e.g. más de 2 capas de velocidad por nota, solapamiento 2D o nombres largos), el sistema ajustará automáticamente al valor soportado más próximo, pero **avisará primero al usuario mediante un diálogo interactivo** con el desglose exacto de ajustes para que pueda decidir si continuar o parar y reconfigurar manualmente.
6. **Interactive Slicer con MIDI Drag-and-Drop**:
   - Vista en forma de onda interactiva (similar a la lupa del Editor de Loops) con marcadores de transitorios arrastrables.
   - Mapeo directo de rebanadas a teclas consecutivas (o GM Drum Map).
   - Generador en memoria de archivo Standard MIDI (`.mid` Type 0) con el patrón rítmico original del loop rebanado.
   - Botón arrastrable (`Draggable MIDI Badge`) que permite arrastrar directamente el patrón MIDI al DAW (Ableton, FL Studio, Logic, Reaper, Cubase) para disparar los slices con el timing del audio original.
7. **Arquitectura Transversal Reutilizable**:
   - Los submódulos de auto-detección tonal y re-distribución equidistante de zonas son utilidades independientes del Core, aplicables a cualquier sesión o lote de importación, no restringidas únicamente al chopper.
8. **Punto de Entrada Unificado de Importación Inteligente (Universal Smart Import desde Menú File / Edit)** [COMPLETADO]:
   - Las entradas fragmentadas del menú `File` (`Import Audio Files`, `Import SoundFont / SFZ`, etc.) se han reorganizado bajo una única entrada principal **Universal Smart Import (Ctrl+I)** con las opciones individuales reagrupadas en un submenú **Advanced Import**.
   - Auto-detección del formato de archivo por firma binaria y cabecera:
     - `.sf2` / `.sfz`: conversor nativo SoundFont/SFZ con mapeo de capas de velocidad y envolventes.
     - `.dspreset`, `.nki`, `.vstpreset`, `.multisample`: parsers Fase 18.8 (Decent Sampler, Kontakt XML, HALion, Bitwig).
     - `.rx2`, `.rex`, `.rcy`, audio con `cue`/markers: abre el Audio Chopper con puntos de corte pre-cargados.
     - `.wav`, `.aif` múltiples o carpeta: importación directa de muestras o lote por nombre Hartmann.
     - `.zip`: desempaqueta y auto-detecta el formato del contenido.
   - Motor de Preflight interactivo (`importPreflight.ts`) con checkboxes de adaptación (extend zones to 0..127, adapt velocity layers, switch to Extended Mode).
   - Entrada duplicada en menú `Edit` (Ctrl+I) para coherencia de acceso rápido.

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

---

## Fase 20 — Autocarátula Asistida por IA (Model Cover Artwork Generator) [COMPLETADA]

**Objetivo**: Generar automáticamente portadas y carátulas de alta estética para modelos sonoros (`cover.webp` en la capa `05_extended_model` de la Cápsula del Tiempo) asistidas por IA, basadas en la identidad tímbrica, nombre extendido, autor y metadatos acústicos del instrumento.

### 20.1 Estrategia Multi-Motor: Procedural Espectral, Companion Bridge y Cloud API (BYOK)
- [x] **Generador Procedural Acústico Espectral (100% Offline, Instantáneo y Sin Coste)**:
  - Motor matemático en Canvas (`ProceduralAcousticArtwork.ts` con fallback headless deterministic RIFF WebP) que sintetiza arte abstracto de 512×512 derivado de los armónicos F0, anillos acústicos, oscilogramas y los 10 Parameter Sets (0..9).
- [x] **Local Companion Bridge (Python 7860)**:
  - Endpoint `POST /api/generate-artwork` en `bridge/server.py` para renderizado procedural acelerado y preparado para diffusers locales.
- [x] **Cloud API (BYOK - Bring Your Own Key Privado en Navegador)**:
  - Operación con privacidad absoluta y coste de servidor 0 para la plataforma (almacenamiento en `localStorage`).
  - **Google Gemini (AI Studio / Imagen 3)**: Endpoint `imagen-3.0-generate-002:predict` para generación de imágenes de alta fidelidad.
  - **OpenAI (DALL-E 3)**: Integración en `CloudByokClient` y endpoint `v1/images/generations` con formato `b64_json`.
  - **Hugging Face Inference API**: Checkpoints serverless de difusión acelerada (FLUX.1-schnell).
  - **Replicate**: Inferencia mediante predicciones de FLUX / SDXL.

### 20.2 Flujo de Usuario, Diálogo Interactivo y Optimización
- [x] **Modal Interactivo Dedicado (`AiCoverGeneratorModal.ts`)**:
  - Invocable desde la pestaña *Cover Artwork* de `ModelConfigModal.ts`, desde la tarjeta de portada de `ProcessPanel.ts` y desde el menú superior `Model -> Generate Cover Artwork with AI (Fase 20)...`.
  - Vista previa en tiempo real 512×512 con insignia de dimensiones y peso WebP.
  - Asistente de Prompting Acústico (`buildAcousticArtworkPrompt`) con 6 estilos pre-diseñados (Cyberpunk Synthesizer, 1980s Analog Hardware, Minimalist Bauhaus Vector, Studio Hi-Fi Audiophile, Organic Acoustic Watercolor, Neural Latent Space) y campo de edición manual.
  - Acciones: `[ Accept & Apply as Model Cover ]`, `[ Download WebP ]` y `[ Regenerate ]`.
- [x] **Conversión y Empaquetado**:
  - Recorte centrado automático (aspect ratio 1:1) y compresión a formato `.webp` optimizado (512×512).
  - Inserción directa en `ProcessConfig.coverArtwork` y en la Cápsula del Tiempo (`05_extended_model/cover.webp`).
- [x] **Suite de Verificación Automatizada**:
  - Tests unitarios en `tests/phase20_artwork.test.ts` (prompts en 6 estilos, generación procedural 512x512 RIFF WebP, integración con bridge local, gestión de BYOK y empaquetado en Time Capsule).

---

## Fase 21 — Diagnóstico de Salud del Sistema y Onboarding Interactivo (Config Health Modal) [COMPLETADA]

**Objetivo**: Guiar al usuario en el primer arranque y verificar de forma proactiva la configuración del entorno (rutas físicas de librerías, estado del servidor Companion Bridge local y credenciales de IA Cloud BYOK), señalando qué elementos faltan y restringiendo de forma segura las funciones que dependan de ellos hasta su configuración.

### 21.1 Diagnóstico Integral de Subsistemas
- [x] **Comprobación Automática en Arranque (`configHealth.ts`)**:
  - Detección de configuración obligatoria (*Mandatory*): ruta base de la librería local NeuronDB (`NeuronDB/Models`), ruta de destino AxionikDB y conectividad con el almacenamiento persistente IndexedDB.
  - Detección de configuración opcional (*Optional*): conectividad con el Companion Bridge local (`http://127.0.0.1:7860`) y claves privadas de API (OpenAI, Gemini, Claude, OpenRouter, Hugging Face, Replicate).
  - Cálculo de índice de salud global (`status: 'healthy' | 'warning' | 'error'`).
- [x] **Modal Interactivo de Diagnóstico y Onboarding (`ConfigHealthModal.ts`)**:
  - Desglose visual por tarjetas con estado (Configurado, No Configurado, Sin Conexión).
  - Enlaces directos `[ Configure... ]` que abren la pestaña exacta de ajustes (`SettingsModal` o `ModelConfigModal`) para resolver cada elemento sin fricción.
  - Opción de supresión de alerta en próximos arranques con almacenamiento persistente en `localStorage`.
- [x] **Indicadores Visuales Globales y Puertas de Acceso**:
  - Punto dinámico de estado en el icono de rueda dentada de la barra de navegación (verde/ámbar/rojo según el diagnóstico).
  - Acceso directo en el menú superior: `Help -> System Configuration Health...`.
  - Compuerta de funciones (`isFeatureGated`): desactivación preventiva de exportación directa a AxionikDB si falta la ruta, y fallback a procedural en carátulas si no hay claves ni bridge.

---

## Fase 22 — Suite de Funcionalidades Avanzadas de Sampler Profesional (Estándar Kontakt / HALion / Falcon) [PLANIFICADA]

**Objetivo**: Dotar a ABDNeuModMakr y al motor ABDAxionikVS de las capacidades de expresión, articulación y gestión acústica que distinguen a los samplers insignia de la industria.

### 22.1 Matriz de Funcionalidades
| Funcionalidad | Descripción e Interés | Prioridad |
| :--- | :--- | :--- |
| **Round-Robin (Alternancia de Muestras)** | Disparar tomas alternas (`Take 1`, `Take 2`, etc.) en ciclos ordenados, aleatorios o de true-neighbor para la misma nota/velocidad, eliminando el efecto "ametralladora" en baterías, guitarras y cuerdas. | **Alta** |
| **Release Triggers / Key-Off** | Muestras que se disparan al soltar la tecla (el apagador de un piano, ruido de trastes en guitarra o golpe mecánico de llaves de órgano). | **Media-Alta** |
| **Auto-Mapping por Expresión Regular (Filename Regex)** | Al arrastrar 50+ archivos `.wav` sueltos (ej. `Violin_C3_mf_rr1.wav`), reconocer automáticamente la nota, velocidad y capa round-robin por el nombre del archivo y ubicarlos en la celda correspondiente al instante. | **Alta** |
| **Interactive Slicer con MIDI Drag-and-Drop** | Detección de transitorios en un loop rítmico, corte en rodajas a teclas cromáticas consecutivas y botón arrastrable para transferir el archivo MIDI generado directamente a la pista del DAW. | **Alta** |
| **Matriz de Modulación MIDI (Mod Matrix)** | Enrutar Rueda de Modulación (CC1), Expresión (CC11), Aftertouch o Velocidad al corte de filtro, volumen, pitch o longitud de loop. | **Media** |
| **Soporte de Microtuning / Escalas Scala (`.scl`)** | Importación de tablas de afinación alternativas (temperamento mesotónico, cuartos de tono, microtonalismo oriental). | **Media-Baja** |

### 22.2 Integración en Formatos de Exportación
- En **formato Moderno (`.nmmodel`) y Cápsula del Tiempo**: Se preservan como metadatos nativos de primera clase.
- En **formato Clásico Hartmann (`.model`)**: Dado que el hardware Neuron original no dispone de round-robin ni release triggers nativos, el preflight exportará la capa primaria y avisará con un diálogo interactivo al usuario antes de proceder a la adaptación.

---

## Fase 23 — Organización Jerárquica de Bancos y Sublibrerías de Modelos Extendidos [COMPLETADA]

**Objetivo**: Permitir una organización modular y escalable de grandes colecciones sonoras mediante subbancos y sublibrerías diferenciadas en disco, con reordenación interactiva y flujos de destino guiados para exportación y procesado por lotes.

### 23.1 Arquitectura de Carpetas y Sublibrerías
- **Estructura Modular en Disco**: Cada sublibrería / subbanco dispondrá de su propio directorio físico (`/banks/<SublibraryName>/...`).
- **Subcarpeta Raíz por Defecto (`Default`)**: Todo el contenido inicial o sin categorización explícita residirá de forma segura y retrocompatible en la subcarpeta `Default`.
- **Destino Interactivo a lo Largo de la Aplicación**:
  - Al generar o guardar un modelo individual (`Save Model / Export`), preguntar al usuario en qué sublibrería desea almacenarlo.
  - En la ventana de configuración del modelo (`Model Configuration`), selector desplegable interactivo para asignar el subbanco al que pertenece el modelo en modo extendido y el número de orden que ocupa dentro de él (sin atarse al límite de 11 caracteres ni al número de slot hardware del modo clásico).
  - En el **Procesador por Lotes (Batch Processor)**, selector de sublibrería de destino para depositar los modelos resultantes de la extracción o conversión masiva.

### 23.2 Gestión Segura de Sublibrerías
- **Creación de Sublibrerías**: Diálogo interactivo para crear una nueva sublibrería con nombre, descripción y orden de visualización.
- **Borrado con Regla de Seguridad Estricta**: Impedir terminantemente el borrado de una sublibrería que contenga modelos. El usuario deberá mover o eliminar primero todos sus modelos para poder dar de baja la sublibrería (evita pérdida accidental de datos).
- **Mover Modelos entre Sublibrerías**: Capacidad para transferir uno o múltiples modelos de una sublibrería a otra con actualización automática de enlaces y rutas relativas.

### 23.3 Sistema de Ordenación Dinámica y Recalculada
- **Orden Manual Jerárquico**:
  - Ordenación de sublibrerías entre sí.
  - Ordenación de modelos dentro de cada sublibrería.
  - Métodos de reordenación interactivos: arrastrar y soltar (drag & drop), botones de subir/bajar (`Move Up` / `Move Down`) o asignación de posición ordinal (`#Index`).
- **Recálculo Dinámico de Posiciones**: El índice de orden no será un campo fijo o fragmentado; el sistema reajustará y reindexará automáticamente las posiciones contiguas al mover o insertar elementos.
- **Visualización y Filtros**: Posibilidad de alternar en todo momento entre el orden manual de usuario, ordenación alfabética (A-Z / Z-A), fecha de modificación o filtrado en tiempo real por búsqueda y etiquetas.

---

## Fase 24 — Segmentación y Corte Semántico de Audio con IA (AI Semantic Slicing) [COMPLETADA]

**Objetivo**: Integrar modelos neuronales de análisis y segmentación semántica de audio para el troceado inteligente de muestras complejas (vocales, frases habladas, loops polifónicos, baterías densas), siguiendo escrupulosamente los estándares de IA establecidos en la aplicación:
- **Arquitectura Local-First**: Inferencia mediante ONNX Runtime Web / WebAudio Worker local, con fallback al Companion Bridge Python local (`aiBridgeEndpoint`) si se requiere mayor precisión o modelos más pesados.
- **Filosofía No Destructiva**: La IA propone los puntos de corte, etiquetas fonéticas/instrumentales y zonas candidatas, pero el usuario mantiene el control total para arrastrar marcadores, ajustar en el Cut Point Magnifier (±256 smp) y forzar cruces por cero.
- **Desactivable / Opcional**: El usuario puede alternar en cualquier momento entre algoritmos DSP deterministas (SuperFlux, OpenVPI Silence Valley, Grid) y la asistencia por IA con un solo clic.

### 24.1 Implementación y Capacidades Completadas
- **Vocal & Speech Phoneme/Word Alignment (Whisper-tiny via Bridge)**:
  - Endpoint `POST /api/align-phonemes` en `bridge/server.py` y cliente tipado `bridgeClient.alignPhonemes(buffer)` en `src/core/bridge/BridgeClient.ts`.
  - Detección de comienzos exactos de palabras y sílabas con fallback DSP acústico de formantes de energía y envolvente temporal cuando no hay entorno PyTorch pesado.
  - Integración en `AudioSlicerEngine.ts` mediante `buildSlicesFromPhoneticWords` y parámetro opcional `phoneticWords` en `SlicerOptions`.
- **Separación de Stems Pre-Troceado (Demucs via Bridge)**:
  - Endpoint `POST /api/separate-stems` en `bridge/server.py` y cliente tipado `bridgeClient.separateStems(buffer, options)` en `src/core/bridge/BridgeClient.ts`.
  - Capacidad para aislar `vocals`, `instrumental`, `drums` y `bass` antes del troceado, con fallback DSP Mid/Side estereofónico de alta fidelidad.
- **Integración Visual en Audio Chopper Modal (`AudioChopperModal.ts`)**:
  - Botón `#btn-chopper-whisper-align` ("AI Vocal Align"): invoca Whisper-tiny y actualiza las rebanadas etiquetándolas como `Vocal: "word" (ms)`.
  - Botón `#btn-chopper-demucs-split` ("Separate Stems"): abre submodal interactivo para elegir qué stems aislar y cargar el stem aislado directamente en el Chopper para segmentar.
- **Verificación Automatizada**:
  - Suite de pruebas unificada `tests/phase24_semantic_slicing.test.ts` añadida al runner unificado `run_all.ts` (19/19 suites PASS).

### 24.2 Gestión de VRAM en Companion Bridge (Single-Active Heavy Model con Auto-Offload)
- **Aislamiento de Carga en VRAM (Tope Estricto de 1 Modelo Pesado Activo)**:
  - Para evitar caídas por CUDA Out-Of-Memory (OOM) en tarjetas gráficas estándar de 8 GB o 6 GB (ej. RTX 3060/3070/4060), el Companion Bridge nunca mantendrá dos modelos pesados en VRAM al mismo tiempo (ej. AudioSR 5.8 GB + SD-Turbo 1.6 GB + Demucs 1.5 GB sumarían casi 10 GB).
  - Antes de cargar un nuevo modelo pesado en GPU, se descarga automáticamente el modelo anterior mediante `del model` / `model.to('cpu')`, ejecutando recolección de basura `gc.collect()` y vaciado explícito de tensores con `torch.cuda.empty_cache()`.
- **Desacoplamiento de Modelos Ligeros a CPU / ONNX Runtime**:
  - Modelos ligeros auxiliares (`Whisper-tiny` 39 MB, `Basic Pitch` 1 MB, `DeepFilterNet3` 8 MB) se ejecutan preferentemente en hilos ONNX Runtime / CPU SIMD para no disputar memoria VRAM con los transformadores y difusores pesados.

---

## Fase 25 — Procesador por Lotes para AutoSlicer / Audio Chopper (Batch AutoSlicer) [COMPLETADA]

**Objetivo**: Integrar la tecnología de troceado automático y mapeo multicapa dentro del motor de procesamiento por lotes (`BatchProcessorModal.ts` y `FolderBatchExtractor.ts`), permitiendo procesar masivamente carpetas completas de loops rítmicos, frases vocales y archivos ReCycle (`.rx2` / `.rex` / WAV) de forma 100% desatendida y plenamente integrada en el resto de flujos batch de la aplicación.

### 25.1 Capacidades y Flujo en Lote Integrado
- **Detección Automática de Loops y Rebanadas en Lote**:
  - El extractor de carpetas inspecciona recursivamente la entrada y clasifica los archivos según contengan marcas CUE, cabeceras ReCycle o transitorios rítmicos de alta densidad.
- **Perfiles de Troceado Masivo Configurables**:
  - **Batch Slicer -> Drum Kits (GM Drum Map)**: Convierte cada loop rítmico en un kit percusivo asignado a C1..B2 con hasta 128 zonas por modelo.
  - **Batch Slicer -> Chromatic Equidistant Maps**: Trocea frases melódicas o vocales, detecta la nota raíz de cada fragmento y distribuye zonas contiguas 0..127 sin huecos.
  - **Batch ReCycle / CUE Converter**: Procesa masivamente archivos `.rx2`, `.rex` o audio con pistas CUE, extrayendo los slices a muestras independientes o generando directamente el paquete `.nmmodel` / Cápsula del Tiempo por cada archivo.
- **Exportación Masiva de Patrones MIDI**:
  - Generación automática de archivos `.mid` Type 0 con el groove original por cada loop procesado, empaquetados junto a los parches en el archivo maestro ZIP o exportados a la librería local `AxionikDB`.

### 25.2 Arquitectura de Pipeline por Fases Homogéneas (*Batch-by-Stage Staging & Memory Safety*)
- **Pipelining por Fases en lugar de Bucle por Archivo (Anti-Throttling)**:
  - En lugar de ejecutar todas las etapas por cada archivo secuencialmente (lo que provocaría cargar y descargar pesos de varios gigabytes N veces a través del bus PCIe, saturando la VRAM y ralentizando el lote), la cola de procesamiento por lotes reorganiza automáticamente el trabajo en **etapas homogéneas por modelo**:
    1. **Fase 1 — Separación de Stems (HTDemucs)**: Carga Demucs una sola vez en VRAM -> Procesa la separación de pistas vocales/rítmicas de todo el lote -> Descarga Demucs y vacía VRAM (`empty_cache`).
    2. **Fase 2 — Segmentación y Alineación Fonética (Whisper-tiny)**: Procesa en cola la detección de palabras y sílabas de todas las pistas vocales identificadas en el lote.
    3. **Fase 3 — Troceado y Mapeo DSP**: Troceado determinista, micro-ajuste a cruces por cero y generación de zonas MIDI.
    4. **Fase 4 — Super-Resolución / BWE (AudioSR)**: Carga AudioSR una sola vez en VRAM si está activada la extensión de ancho de banda -> Procesa el lote completo -> Descarga AudioSR y vacía VRAM.
    5. **Fase 5 — Síntesis de Carátulas (SD-Turbo)**: Carga difusión una sola vez -> Genera secuencialmente todas las carátulas 512×512 requeridas para los modelos del lote -> Descarga de VRAM.
- **Garantía de Consumo Máximo de Hardware**:
  - El techo de memoria VRAM en todo momento queda acotado al tamaño del modelo individual más pesado (`AudioSR` ~6.2 GB), permitiendo que lotes masivos de cientos de archivos se ejecuten con estabilidad garantizada y sin cuelgues ni fragmentación en hardware de gama media (8 GB VRAM).

---

## Fase 26 — Descompresión de Audio REX2 (.rx2) en Companion Bridge y Emparejamiento Automático [COMPLETADA]

**Objetivo**: Resolver la limitación de decodificación en navegador de archivos ReCycle 2.0 (`.rx2`) cuyo bloque de audio `SDAT` emplea compresión propietaria de Reason Studios, permitiendo su uso integral (audio + slices) tanto en el Audio Chopper como en la importación directa.

### 26.1 Arquitectura de Decodificación Dual y Fallback (Vercel-Ready)
- [x] **Motor Nativo en TypeScript Puro (`DwopDecompressor.ts`)**:
  - Algoritmo de descompresión DWOP adaptativo de 5 estados portado a TypeScript puro (`src/core/dsp/DwopDecompressor.ts`).
  - Funciona 100% en el cliente dentro del navegador (cero llamadas de red, cero dependencias backend, listo para Vercel).
  - Integrado de forma preferente en `AudioChopperModal.ts` y en `rawSamplerParsers.ts`.
- [x] **Descompresión Asistida vía Companion Bridge (`POST /api/decode-rx2`)**:
  - Servidor local Python (`bridge/dwop_decompress.py` en puerto 7860) como motor de respaldo opcional.
  - Endpoint `POST /api/decode-rx2` recibiendo Base64 y retornando WAV PCM limpio de 16/24-bit.
  - Capacidad `'decode-rx2'` reportada en `/api/health`.
  - Método `decodeRx2Audio(rx2Buffer, filename)` en `BridgeClient.ts`.
- [x] **Universal Smart Import con Detección REX2**:
  - `rawSamplerParsers.ts` (`parseRex2Sampler`) procesa archivos `.rx2`, `.rex` y `.rcy` extrayendo slices y generando regiones de teclado.
  - `UniversalImportModal.ts` decodifica de forma transparente con el bridge en segundo plano o asiste en la apertura en Audio Chopper.
- [x] **Asistente de Emparejamiento en Navegador (Modo Desconectado)**:
  - Si el Companion Bridge está apagado, `showRx2PairingAssistantModal` muestra una ventana interactiva con tres opciones:
    1. Emparejar con un archivo de audio WAV/AIFF existente conservando los cortes `SLCE` originales.
    2. Comprobar conexión con el Companion Bridge y reintentar la descompresión automática al instante.
    3. Inspección en modo de previsualización acústica sintética sin requerir audio.
- [x] **Batería de Pruebas Automatizadas**:
  - `tests/phase26_rex2_decode.test.ts` valida la descompresión DWOP de 58.623 frames en mono 44.1 kHz 24-bit, mapeo cromático de cortes, reporte de preflight y alertas en modo desconectado. Integrado en `tests/run_all.ts`.

---

## Fase 27 — Ampliación de Proveedores BYOK (Claude, OpenRouter, ChatGPT) y Estandarización UI en Pills [COMPLETADA]

**Objetivo**: Ampliar la conectividad Cloud BYOK en navegador a los principales modelos de lenguaje y razonamiento para el análisis de timbre, sugerencia de articulaciones y prompting acústico avanzado, unificando la interfaz de selección según los estándares de diseño del proyecto.

### 27.1 Proveedores y Motores de Texto / Visión
- [x] **Conectores Directos en `CloudByokClient`**:
  - [x] **Anthropic Claude**: Endpoint `v1/messages` (Claude 3.5 Sonnet / Haiku) con headers `x-api-key`, `anthropic-version: 2023-06-01` y `dangerously-allow-browser: true` para análisis tímbrico profundo, descriptores acústicos y notas de programa de presets.
  - [x] **OpenRouter**: Acceso unificado multi-modelo a través de endpoint compatible OpenAI (`api/v1/chat/completions`) con cabeceras `HTTP-Referer` y `X-Title` para acceso a FLUX, Claude y GPT.
  - [x] **OpenAI (ChatGPT / GPT-4o)**: Generación estructurada de metadatos, tags acústicos y sugerencias de asignación tímbrica vía `v1/chat/completions`.
  - [x] **Soporte Universal Adicional**: Conectores LLM en navegador para Google Gemini (`generateContent`), Groq LPU, DeepSeek (`deepseek-chat`) y Mistral AI.
  - [x] **Métodos de Alto Nivel de Dominio**: `generateAcousticTimbreDescription(...)` y `generatePresetTagsAndNotes(...)` con fallbacks gracefully en fallos de red.
- [x] **Normalización de Interfaz (Pills UI)**:
  - [x] Píldoras estandarizadas en paneles de IA (`.btn-style-pill`, `.btn-provider-pill`, `.byok-provider-opt`) con badges de capacidades (`AudioSR GPU`, `Serverless`, `Multimodal`, `GPT-4o & DALL-E`, `Sonnet & Haiku`, `Multi-Model`, etc.).
  - [x] Acción rápida de enriquecimiento con LLM en `AiCoverGeneratorModal.ts` (`#btn-enhance-prompt-llm`) que integra `enhancePromptWithByokLlm(...)` para enriquecer prompts acústicos con metáforas sensoriales tímbricas.
- [x] **Catálogo Modular del Companion Bridge**:
  - [x] Reorganización del catálogo de modelos locales conforme a la especificación estándar de `ABDShared/Docs/architecture/MODULAR_PACKAGES_STANDARD.md` para empaquetado y pre-descarga desacoplada con campos `package` (`@abdsynths/*`), `category`, `runtime`, `min_vram_mb` y versión `1.0.0` en `/api/models`.
- [x] **Batería de Pruebas Automatizadas**:
  - [x] `tests/phase27_byok_text.test.ts` (6/6 verificaciones) integrado en `tests/run_all.ts` (18/18 suites PASS).

---

## Fase 28 — Estudio en Profundidad de Decent Sampler y Compatibilidad de Librerías Kontakt (Encriptadas vs Sin Encriptar) [COMPLETADA]

**Objetivo**: Realizar un análisis exhaustivo de paridad del ecosistema Decent Sampler (`.dspreset`) y explorar la viabilidad técnica, límites criptográficos y arquitecturas de extracción para librerías de Native Instruments Kontakt (`.nki`, contenedores monolíticos `.nksn`/`.nkx` y compresión de audio `.ncw`).

### 28.1 Auditoría y Extensión de Paridad de Decent Sampler (`.dspreset`)
- **Análisis de la Especificación Completa del Formato**:
  - Evaluación frente a los repositorios de referencia (`DecentSamples/DecentSampler-Sample-Library-Examples` y `J0rgeSerran0/SF2ToDSConverter`).
  - **Mapeo Avanzado de Articulaciones**:
    - Round-Robin multinivel: atributos `<group seqMode="round_robin"|"random"|"true_random">` y `<sample seqPosition="N">`.
    - Triggers dinámicos: `<group trigger="attack"|"release"|"first"|"legato">` con control `pitchKeyTrack="0"` para muestras de apagadores de tecla (key-off dampers) y ruidos mecánicos.
    - Curvas de atenuación de release: `releaseDecay` (duración de nota sostenida versus volumen de apagador).
  - **Estructura de Controles de Interfaz Gráfica (`<ui>`)**:
    - Verificación de generadores de knobs, sliders, menús de selección de microfonía/articulación y etiquetas de visualización en presets exportados.
  - **Efectos y Rutas de Modulación (`<effects>`, `<modulators>`)**:
    - Filtros paso-bajo/alto modelados, reverbs convolutivas con respuestas impulsionales (IR), delay estéreo, chorus y generadores de envolvente DAHDSR / LFO.

### 28.2 Estudio de Viabilidad: Librerías Kontakt Estándar (Sin Encriptar vs Encriptadas)
- **Librerías Kontakt Sin Encriptar (Standard / Open NKI)**:
  - **Estado actual**: NeuModMakr ya detecta y procesa definiciones estructuradas XML y esquemas abiertos de Kontakt (`parseKontaktNki`).
  - **Objetivo de extensión**:
    - Integrar parser binario para versiones anteriores de Kontakt (v1 a v4) basado en flujos zlib y estructuras de fragmentos (`nkitool`).
    - Decodificación del formato de audio comprimido sin pérdidas de Native Instruments **NCW (Native Compressed Wave)**: adaptación o llamada al algoritmo de descompresión DPCM / mid-side (especificación `monomadic/ncw`) para convertir automáticamente muestras `.ncw` a WAV PCM utilizables por el motor de síntesis.
- **Librerías Kontakt Encriptadas / Propietarias (Protected / Encrypted NI Containers)**:
  - **Diagnóstico Criptográfico**:
    - Las librerías comerciales "Kontakt Player" (con licencia de Native Instruments) emplean contenedores propietarios encriptados mediante claves asimétricas RSA/AES ligadas a la activación por hardware y al Native Access / Service Center.
    - La carga directa de patches encriptados de terceros sin la clave privada de Native Instruments es legal y técnicamente inviable por ingeniería inversa directa de solo software.
  - **Estrategia Práctica y Amigable en NeuModMakr**:
    - **Detección temprana en Preflight**: Al arrastrar un archivo `.nki` o contenedor con firmas encriptadas (`\x2A\x47\x24\x4E` o bloques protegidos), el importador no crashea ni se cuelga; emite de inmediato un diagnóstico informativo detallando que la librería está cifrada por DRM de Native Instruments.
    - **Pasarela de Conversión y Exportación Recomendada**: Guía integrada para el usuario sobre cómo convertir presets a través de Kontakt estándar (ej. guardar como "Patch + Samples" no comprimidos o exportar mapas SFZ / WAV con utilidades del ecosistema) para su ingesta inmediata en NeuModMakr.

---

## Fase 29 — Equivalencia Transparente de Contenedores .ZIP como Carpeta e Importación Inteligente Polimórfica Mixta con Triaje Batch [PLANIFICADA]

**Objetivo**: Tratar cualquier archivo `.zip` depositado en la aplicación con total equivalencia a una carpeta física en disco, permitiendo la ingesta desatendida o guiada de colecciones complejas. Implementar un motor de descubrimiento recursivo capaz de explorar carpetas o archivos comprimidos heterogéneos con múltiples formatos, instrumentos y presets entremezclados, clasificando lo que hay y presentando una compuerta interactiva de triaje previo que informe detalladamente al usuario y le permita seleccionar qué procesar por lotes.

### 29.1 Equivalencia Transparente .ZIP = Carpeta (Virtual Zip Filesystem)
- **Tratamiento Unificado de Entrada**:
  - Toda función de importación (arrastrar a la ventana, selector de archivos, importación universal, batch processor) aceptará indistintamente un directorio del sistema de archivos o un archivo `.zip`.
  - Desempaquetado virtual en memoria / streaming mediante `ZipArchive.ts`, exponiendo un árbol de rutas virtuales normalizadas (`virtual_fs`) sin necesidad de descompresión física previa en el disco duro del usuario.
  - Soporte para ZIPs anidados (ZIP que contiene dentro otros ZIPs, presets o SoundFonts empaquetados).

### 29.2 Descubrimiento Polimórfico de Contenidos Mixtos (Multi-Asset Discovery Engine)
- **Inspección Recursiva Multiformato**:
  - Escaneo en profundidad de todas las ramas del árbol de directorios (físico o virtual dentro de un `.zip`), identificando simultáneamente:
    - Bancos y Presets SoundFont 2 (`.sf2`).
    - Instrumentos SFZ (`.sfz` con sus muestras asociadas).
    - Presets de Decent Sampler (`.dspreset`).
    - Patches de Native Instruments Kontakt (`.nki`).
    - Multisamples de Bitwig (`.multisample`).
    - Loops rebanados ReCycle (`.rx2`, `.rex`, `.rcy`).
    - Cadenas de audio lineal con marcadores CUE / sample-chains (`.wav`).
    - Carpetas de muestras sueltas agrupadas por instrumento, afinación o prefijo.
- **Diferenciación y Aislamiento de Entidades**:
  - Detección de colisiones y límites de instrumento: separar de forma limpia cuándo dos carpetas pertenecen a instrumentos distintos aunque compartan nombres de notas o directorios raíz.

### 29.3 Compuerta Preflight de Triaje y Selección Batch Interactiva
- **Detección de Casos Múltiples**:
  - Si el árbol de entrada contiene un único instrumento o preset homogéneo, se ofrece la importación directa a la sesión activa.
  - Si se detecta **más de un caso** (ej. varios presets SF2, combinación de un `.dspreset` y carpetas de WAVs, o múltiples librerías mezcladas):
    - **Aviso y Diagnóstico Previo**: La aplicación detiene el procesamiento automático y despliega un diálogo modal de triaje claro e interactivo.
    - **Desglose Estructurado**: Muestra una tabla jerárquica con todo lo detectado (Tipo de formato, Nombre de instrumento/preset, Número de muestras, Cobertura estimada, Tamaño en disco y Ruta relativa).
    - **Control Granular del Usuario**: Checkboxes individuales y por grupo ("Seleccionar todo", "Deseleccionar todo", "Filtrar por formato") para que el usuario decida con exactitud qué elementos desea convertir y cuáles ignorar.
    - **Derivación al Procesador por Lotes**: Los elementos aprobados por el usuario se inyectan directamente en la cola del `BatchProcessor` con su perfil de destino y configuración de síntesis (Classic / Extended) preconfigurada.

---

## Fase 30 — Detector de Silencio, Suelo de Ruido y Huella de Ruido (Noise Print) con Limpieza DSP/IA [PLANIFICADA]

**Estado actual (auditoría 2026-11-02)**: solo existe una compuerta RMS de silencio dentro de `AudioSlicerEngine.ts` (`silenceThresholdDb`, `isSilence`), usada exclusivamente para descartar trozos al trocear. No hay recorte de silencios en muestras, ni estimación de suelo de ruido, ni captura de huella de ruido, ni reducción de ruido. La "supresión de suelo de ruido" de `AcousticIntelligence.ts` actúa sobre parciales del análisis armónico, no sobre el audio.

### 30.1 Detector y Recorte de Silencio (`SilenceDetector.ts`)
- Detección de silencio inicial/final y huecos internos con umbral relativo al suelo de ruido medido (no fijo), tiempo mínimo de silencio y retención (hold).
- Recorte automático con pre-roll configurable (protege ataques suaves) y micro-fundido de salida en el corte.
- Ajuste a cruce por cero y reajuste de `loopStart`/`loopEnd`, zonas y marcadores tras recortar.
- Modo informe (solo detecta y marca) frente a modo destructivo, con deshacer.

### 30.2 Estimación del Suelo de Ruido (`NoiseFloorAnalyzer.ts`)
- RMS por tramos + percentil bajo (p5-p10) de energía para el nivel de suelo en dBFS por canal.
- Suelo espectral por bandas (STFT, mínimos estadísticos / minimum statistics) para distinguir hiss, hum (50/60 Hz y armónicos) y ruido de banda ancha.
- Métricas: SNR estimada, tipo de ruido dominante, picos tonales de zumbido.

### 30.3 Huella de Ruido (Noise Print) y Reducción
- Captura automática de huella desde tramos de silencio detectados (o selección manual del usuario).
- Reducción DSP: puerta espectral / sustracción espectral con suavizado temporal, notch adaptativo para hum, control de cantidad para evitar artefactos "musicales".
- Opción IA vía Companion Bridge (p. ej. DeepFilterNet / RNNoise / modelos de denoise) cuando esté disponible, con fallback DSP en navegador.

### 30.4 Integración con los Procesos IA de Mejora de Calidad
- Exportar la huella y el suelo de ruido como metadatos (`noiseProfile`: nivel dBFS, espectro por bandas, tramos de silencio) para que upsampling/restauración/regeneración los descarten en lugar de reforzarlos.
- Excluir tramos de silencio/ruido del análisis espectral clásico y de la búsqueda de loops.

### 30.5 Batch y UI
- Paso opcional "Limpieza" en el Batch Processor (detectar, recortar, reducir) con informe previo por archivo.
- Visualización en la forma de onda: zonas de silencio sombreadas y línea de suelo de ruido.
- Tests unitarios con señales sintéticas (tono + ruido blanco a SNR conocida, hum 50 Hz, silencios con cola de reverb).

---

## Fase 31 — Importación/Exportación Akai MPC (`.xpm` Keygroup/Drum, `.xpn` Expansion) [COMPLETADA]

**Implementado (2026-11-02)** en `src/formats/MpcXpmFormat.ts`, `src/core/dsp/SliceFileParser.ts`, `vendor/@abdsynths/shared/Code/NeuronFormats/ZipArchive.ts` y `src/core/export/rawSamplerExporter.ts` (implementación propia; especificación obtenida de 52 `.xpm` y 10 `.xpn` reales de `_RESOURCES/samplers/akai mpc` y contrastada con ConvertWithMoss, LGPL-3.0, solo como referencia):
- [x] Lector MPC 1.x / 2.x XML (Keygroup y Drum) y MPC 3.x GZIP+JSON (`.xpm`, `.xty`, `.xtd`); expansiones `.xpn` (ZIP) integradas en `parseUniversalSampler`; `.xpm`/`.xty`/`.xtd` + WAV hermanos seleccionados juntos en la importación universal.
- [x] **Slices de MPC 3 integrados en nuestro Slicer (Filosofía DRY)**:
  - `SliceFileParser.ts` (`parseWavSliceCues`) lee el chunk RIFF `"atem"` JSON de Akai MPC incrustado en los WAV (`Num slices`, `Slice 0..N` con `Start` y `End`), además de `cue ` estándar, por lo que cualquier WAV troceado de MPC funciona directamente en el `AudioChopperModal` y en el `Batch AutoSlicer`.
  - Helper compartido `sliceDecodedAudioToWav()` en `rawSamplerParsers.ts`, reutilizado por `parseSampleChainAudio`, `parseRex2Sampler` y `mpcProgramToPreset`. Cuando un kit MPC referencia `sliceIndex` o rangos `sampleStart`/`sampleEnd` sobre un WAV compartido, recorta cada slice y activa `isSliceChain: true` (habilitando el botón *"Open in Audio Chopper"*).
- [x] Escritor `.xpm` (128 instrumentos x 4 capas), agrupación automática de regiones en keygroups con desbordamiento a keygroups solapados, round-robin (ZonePlay ciclo) y release (TriggerMode note-off); generador de `Expansion.xml`.
- [x] **Selector interactivo de programa (`MultiInstrumentModal`) para contenedores multiprograma y directorios multi-instrumento**:
  - `MultiInstrumentModal.ts` extendido para `.xpn` / `.zip` multiprograma (`listZipSamplerPrograms` + `selectedProgramPath` en `rawSamplerParsers.ts` y `UniversalImportModal.ts`).
  - Deducción de múltiples instrumentos al leer un directorio de muestras (`extractInstrumentPrefix` / `extractFolderFilesToCandidates` + agrupación semántica por IA `extractFolderFilesToCandidatesWithAi` / `CloudByokClient.groupSampleFilenamesIntoInstruments` y botón *"AI Group by Name"* en `MultiInstrumentModal.ts`).
- [x] **Rendimiento ZIP (Indexado perezoso + Inflate optimizado)**:
  - `indexZipArchive(zipBytes)` y `extractZipEntry(zipBytes, entry)` en `ZipArchive.ts` junto con tabla Huffman plana `Int32Array` y registro de 32 bits en `inflateRaw`. Listar los programas de un `.xpn` de 231 MB ahora solo lee el Central Directory y los XML de programa (~ms) sin descomprimir los WAV, y al cargar un programa solo descomprime los WAV referenciados por ese programa.
- [x] **Exportación MPC en `RawSamplerExportModal` y `rawSamplerExporter`**:
  - Formatos `mpc_xpm` (`.xpm` + carpeta de muestras en ZIP) y `mpc_xpn` (paquete de expansión `.xpn` con `Expansion.xml` + `.xpm` + WAVs) con preflight (`mpc-4layer-spill`, aviso `ping_pong`) y botones dedicados en `RawSamplerExportModal.ts`.
- [x] Tests: `tests/phase31_mpc_xpm.test.ts` (17/17 PASS, incluyendo los 52 `.xpm` reales, pistas `.xtd`/`.xty` MPC3, troceado real del chunk `"atem"`, selector multiprograma `.xpn`, deducción de carpeta multi-instrumento, indexado ZIP perezoso y round-trip `mpc_xpm`/`mpc_xpn`).

**Notas para Fase 32**:
- Formatos MPC heredados presentes en el corpus (`.PGM` de MPC 1000/2500 y `.AKP` de Akai S5000/S6000; proyectos `.xpj`) y escritura MPC 3 JSON se abordan dentro de la Fase 32.

**Auditoría de `kontakt2mpce-main` (2026-11-02)**: el repositorio no sirve como especificación (código esqueleto `NotImplementedError`, ejemplos XPM declarados "conceptuales").

---

## Fase 32 — Análisis de ConvertWithMoss: Paridad Total de Formatos de Entrada/Salida y Mejora de los Existentes [EN CURSO — Bloque 1 Completado]

**Referencia**: `D:\desarrollos\ABDSynths\_RESOURCES\convertidores\ConvertWithMoss-main` (Jürgen Moßgraber, **LGPL-3.0**). Se usa solo como referencia de formato: implementación propia (clean-room) en TypeScript, verificada con archivos reales; sin traducir su código Java. Atribución en `README.md` y en el diálogo About (`Navbar.ts`).

**Objetivo**: soportar como entrada y salida todos los formatos que cubre ConvertWithMoss, y revisar los que ya tenemos para corregir carencias.

### 32.1 Matriz de Formatos (auditoría inicial)
Por cada formato registrar: lectura/escritura en ConvertWithMoss, estado en NeuModMakr, prioridad, archivos reales de prueba disponibles y viabilidad (texto/XML, binario documentado, imagen de disco, cifrado).

| Grupo | Formatos en ConvertWithMoss | Estado en NeuModMakr |
|---|---|---|
| Estándar | SF2, SFZ, DLS, WAV (multisample por nombre) | **COMPLETADO**: SF2/SFZ/WAV con paridad Fase 32.3; DLS Nivel 2 entrada/salida (Fase 32.4 Bloque 1) |
| Samplers de software | Decent Sampler, Kontakt (+ NI container/monolitos), Maschine, EXS24 (Logic Sampler), Bitwig Multisample, Ableton Sampler/Simpler, TAL Sampler, TX16Wx, DirectWave, Omnisphere, Renoise, Reason NN-XT (`sxt`), Isla, Bliss, Polyend, Korg Multisample (KMP/KSF) | **COMPLETADO Bloque 1**: DS, Bitwig `.multisample`, HALion `.vstpreset`, Ableton `.adv`, Logic EXS24 `.exs`, TAL-Sampler `.talsmpl`, TX16Wx `.txprog`, Korg `.KMP/.KSF/.KSC` (entrada/salida) y Kontakt/NCW; resto en Bloques 2-4 |
| Akai | MPC moderno (XPM/XPN y pista JSON MPC 3), MPC60/1000/2000, S900/S1000/S3000 (AKP), MESA, imágenes de disco | MPC XPM/XPN/MPC3 en Fase 31; resto en Bloque 3 |
| Hardware clásico | E-mu (Emax, Emulator I-IV, EmulatorX), Ensoniq (EPS/ASR, Mirage), Kurzweil (K/PC3), Roland (S-1xx/5xx/7xx, MV8000, MC-707, SP-404mk2, Zen-Core), Yamaha (YSFC), Waldorf (qpat), Synclavier, CMI3, Casio, Sequential Prophet X, Elektron, Disting, 1010music (Blackbox, Bento), Teenage Engineering OP-XY, Synthstrom, Soundbox, Groove Synthesis, ISO | Bloques 2-4 |

### 32.2 Arquitectura Común [COMPLETADA]
- [x] Capa intermedia única (`UniversalSamplerInstrument` en `ABDShared/Code/SamplerFormats/UniversalSamplerModel.ts`): todos los lectores producen `ExtendedRegion[]` + articulación + metadatos; todos los escritores parten de ese modelo.
- [x] Registro declarativo de formatos (`FORMAT_CAPABILITIES_REGISTRY`, 16 formatos activos) con detección por extensión y firma binaria, capacidades declaradas y avisos de pérdida (`evaluateFormatFidelity`).
- [ ] Lector de imágenes de disco (Akai, E-mu, Roland, Ensoniq) como módulo separado (Bloque 3).
- [x] Integración con el triaje batch de la Fase 29 y la exportación multiformato de la Fase 16 (`RawSamplerExportModal.ts`, `UniversalImportModal.ts`).

### 32.3 Mejora de los Formatos Existentes [COMPLETADA]
- [x] **SFZ (`SfzParser.ts` + escritor en `RawSamplerExporter.ts`)**: lectura y escritura de `offset`/`end` (`sampleStartFrame`/`sampleEndFrame`), `direction=reverse`, `xf_keycurve`/`xf_velcurve` + `xfin_lokey`/`xfout_hikey`/`xfin_lovel`/`xfout_hivel`, `group`/`off_by` (`muteGroup`), `sw_lokey`/`sw_hikey`/`sw_last` (`keyswitchNote`), filtro con `fil_type` (polos `1 | 2 | 4 | 6`), `fileg_*` + `fileg_depth`, y envolvente de tono `pitcheg_*` + `pitcheg_depth`.
- [x] **SoundFont 2 (`Sf2Parser.ts` + `soundfont2Writer.ts`)**: lectura y escritura de generadores `startAddrsOffset`/`startAddrsCoarseOffset`, `endAddrsOffset`/`endAddrsCoarseOffset`, `scaleTuning` (`pitchKeytrack`), `exclusiveClass` (Gen 57 <-> `muteGroup`), `modEnvToFilterFc` / `modEnvToPitch` y `loops[]`.
- [x] **Decent Sampler (`DecentSamplerParser.ts`, `rawSamplerParsers.ts`, `RawSamplerExporter.ts`)**: lectura y escritura de `start`/`end`, `loopCrossfade` (en frames), `seqMode`/`seqLength`/`seqPosition`, `silencedByTags`/`tags` (`muteGroup`), `trigger` y filtro `<effect type="lowpass">`.
- [x] **Bitwig `.multisample` (`rawSamplerParsers.ts`, `RawSamplerExporter.ts`)**: soporte para el esquema oficial con sub-elementos `<key low="..." high="..." root="..." tune="..." track="..." fade-in="..." fade-out="..."/>`, `<velocity low="..." high="..." fade-in="..." fade-out="..."/>` y `<loop mode="..." start="..." stop="..." fade="..."/>` además de atributos planos, `sample-start`, `sample-stop`, `reverse` y `zone-logic="round-robin"`.
- [x] **Steinberg HALion `.vstpreset` (`rawSamplerParsers.ts`, `RawSamplerExporter.ts`)**: lectura y escritura de `SampleStart`, `SampleEnd`, `Reverse`, `KeyCrossfadeLow`/`High`, `VelCrossfadeLow`/`High`, `MuteGroup`, `KeySwitchNote`, `Cutoff`/`Resonance`/`FilterType` y `Ampeg*`.

### 32.4 Orden de Implementación Propuesto
1. [x] **Bloque 1 — Formatos XML/Texto y Binarios Estándar de Alto Uso [COMPLETADO]** (en `ABDShared/Code/SamplerFormats/`):
   - **Ableton Sampler / Simpler (`.adv`)** (`AbletonAdvFormat.ts`): descompresión GZIP (`0x1F 0x8B` vía `inflateRaw`) y empaquetado GZIP RFC 1952 en TypeScript puro, soporte `<MultiSampler>` y `<OriginalSimpler>`, `<MultiSamplePart>`, `KeyRange`/`VelocityRange` con `CrossfadeMin`/`CrossfadeMax`, ley de volumen `Volume = 2^(dB/6)`, `SustainLoop`, `SimplerFilter` (12/24 dB + envolvente bipolar) y `SimplerAuxEnvelope` (Pitch Env).
   - **Apple Logic EXS24 / Sampler (`.exs`)** (`Exs24Format.ts`): lector de cabeceras secuenciales de 84 bytes en Big-Endian (`"SOBT"`/`"SOBJ"`) y Little-Endian (`"TBOS"`/`"JBOS"`), bloques Instrument (`0x00`), Zone (`0x01`), Group (`0x02`), Sample (`0x03`) y Parameters (`0x04`), y escritor binario canónico `"SOBT"`.
   - **TAL-Sampler (`.talsmpl`)** (`TalSamplerFormat.ts`): lector/escritor XML `<tal><programs><program>` con `<samplelayer0..3>`, curvas no lineales (`0.7843 = 0 dB`, `7.2 * v^4` para A/H/R, `37.1 * v^3.75` para Decay), filtro auto-oscilante y `<modmatrix>`.
   - **CWITEC TX16Wx (`.txprog`)** (`Tx16WxFormat.ts`): lector/escritor XML `<tx:program>` con `<tx:wave>`, múltiples `<tx:loop>`, `<tx:soundshape>` (`<tx:aeg>`, `<tx:env1>`, `<tx:env2>`, `<tx:filter1>`, `<tx:modulation>`), `<tx:group>` y `<tx:region>` (`<tx:bounds>`, `<tx:fade>`).
   - **Korg Trinity/Triton/M3/Pa (`.KMP` + `.KSF` + `.KSC`)** (`KorgKmpKsfFormat.ts`): lector/escritor binario Big-Endian de chunks `MSP1`, `MNO1`, `RLP1` (18B/zona), `RLP2`, `SMP1` (32B), `SNO1`, `SMD1` (12B + PCM16 BE) y script `.KSC`.
   - **MMA Downloadable Sounds Level 2 (`.dls`)** (`DlsFormat.ts`): lector/escritor binario Little-Endian RIFF `"DLS "` con `colh`, `ptbl`, `LIST('lins')`, `insh`, `LIST('lrgn')` -> `LIST('rgn2')` (`rgnh`, `wsmp`, `wlnk`), `LIST('lar2')` -> `art2` (bloques de conexión de 12B en timecents/pitch-cents/mB) y `LIST('wvpl')`.
   - **Decodificación Universal de Muestras de Audio [COMPLETADO]** (`UniversalAudioDecoder.ts` + `WavAiffDecoder.ts`): decodificador y codificador FLAC (`fLaC`, RFC 9639) nativo en TS puro con `VORBIS_COMMENT` y chunk `smpl`, decodificador Apple CoreAudio CAF (`.caf`), AIFF/AIFC con compresión Little-Endian `sowt`, Float32/64, IMA4 ADPCM, uLaw, aLaw, y transcodificador asíncrono WebAudio para MP3, OGG, M4A, Opus.
   - Verificado con `tests/phase32_formats_block1.test.ts` (14/14 PASS).
2. [ ] **Bloque 2 — Hardware Moderno SD / Trackers / XML [EN CURSO]**:
   - **Sub-bloque 2A (Modernos SD / Trackers / XML)**:
     - [ ] **1010music Blackbox / Tangerine** (`preset.xml` + muestras en subcarpetas con `<session>`, `<cell>`, `<params>`).
     - [ ] **Synthstrom Deluge** (`SYNTHS/*.XML` / `KITS/*.XML` con `<sound>`, `<osc1>`, `<zone>`, `<envelope1/2>`, `<filter>`).
     - [ ] **Renoise Instrument** (`.xrni` — archivo ZIP con `Instrument.xml` + muestras en `SampleData/`).
     - [ ] **discoDSP Bliss** (`.zbp` — archivo ZIP con `program.xml` + muestras FLAC/WAV).
     - [ ] **Polyend Tracker / Play** (`.pti` — cabecera binaria `TI` + 372 bytes de bloque de parámetros + PCM16 44.1kHz).
   - **Sub-bloque 2B (Hardware Moderno Adicional)**:
     - [ ] **Waldorf Quantum / Iridium** (`.qpat`).
     - [ ] **Elektron Tonverk / Digitakt / Octatrack** (`.tvpst`, `.ot`).
     - [ ] **Teenage Engineering OP-XY / OP-Field** (JSON + RIFF patches).
     - [ ] **Expert Sleepers Disting EX** (multisample SD maps).
     - [ ] **Isla Instruments S2400** (`.s24` / kits).
     - [ ] **Groove Synthesis 3rd Wave** (`.3wv`).
     - [ ] **Sequential Prophet X** (`.pxi`).
     - [ ] **Roland SP-404MKII / MC-707 / Zen-Core** (`.svz` / kits).
3. [ ] **Bloque 3 — Formatos Binarios Clásicos e Imágenes de Disco**:
   - [ ] **Akai S5000/S6000/Z4/Z8** (`.AKP` RIFF `APRG` + WAVs).
   - [ ] **Akai MPC Clásico** (`.PGM` / `.SND` para MPC1000/2000/2500).
   - [ ] **Akai S1000 / S3000 / S900 / MESA** (`.s3p`, binarios de disco).
   - [ ] **Korg Multisample Moderno** (`.korgmultisample` para Kronos/Nautilus/WaveState).
   - [ ] **Yamaha Montage / MODX / Motif** (`.ysfc` — `.x7u`/`.x8u`/`.y2u`).
   - [ ] **Kurzweil K2000 / K2500 / K2600** (`.krz` / `.k25`).
   - [ ] **E-MU Emulator II / III / IV / Emax / EmulatorX** (`.exb`).
   - [ ] **Ensoniq Mirage / EPS / ASR-10** (`.efe`, `.efa`).
   - [ ] **Roland S-50 / S-550 / S-760 / MV-8000** (`.out`, `.mv0`).
   - [ ] **Casio FZ-1 / FZ-10M** (`.fzv`, `.fzf`).
   - [ ] **Fairlight CMI IIx/III** (`cmi3`) y **Synclavier II**.
   - [ ] **Lector de imágenes de disco e ISO** (`iso`).
4. [ ] **Bloque 4 — Samplers de Software Adicionales**:
   - [ ] **Reason NN-XT** (`.sxt` IFF).
   - [ ] **Image-Line FL Studio DirectWave** (`.dwp` monolítico con FLAC).
   - [ ] **Audiomodern Soundbox** (`.sbx`).
   - [ ] **Spectrasonics Omnisphere** (`.omnisphere` multisample).
   - [ ] **NI Maschine** (`.mxgrp`) y contenedores NI `.nicnt`.

### 32.5 Verificación
- Corpus de archivos reales por formato en `_RESOURCES`, tests de lectura y de ida y vuelta (leer, escribir, releer) con comparación de zonas, capas y loops.
- Informe de diferencias frente a la salida de ConvertWithMoss para los mismos archivos.

---

## Fase 33 — Estudio de Capacidades del Modelo Canónico frente a ConvertWithMoss, Capa de Abstracción Universal de Parámetros y Migración a `@abdsynths/shared` (`ABDShared`) [COMPLETADA]

**Objetivo**: Auditar el modelo intermedio de ConvertWithMoss (`IMultisampleSource`, `IInstrumentSource`, `IGroup`, `ISampleZone`, `IFilter`, `IEnvelope`, `IEnvelopeModulator`, `IPitchModulator`, `IMetadata`) frente a nuestro modelo (`ExtendedRegion`, `SynthArticulationConfig`, `ExtendedModelMetadata`) para garantizar que NeuModMakr soporta todas las características expresivas de esos formatos mediante una capa de abstracción y mapeo bidireccional de parámetros, y evaluar la extracción de los lectores, escritores y transformadores a `@abdsynths/shared` (`ABDShared`) para su reutilización en otros sintetizadores y herramientas de ABDSynths (p. ej. `ABDAxionikVS`).

### 33.1 Auditoría y Ampliación de Características de Sampler/Síntesis (`ExtendedRegion` & `SynthArticulationConfig`) [COMPLETADA]
Implementado en `ABDShared/Code/SamplerFormats/SamplerTypes.ts`, `ABDShared/Code/SamplerFormats/ExtendedAdapter.ts`, `src/core/types.ts` y `src/core/sessionSchema.ts`, cubriendo todos los parámetros de `de/mossgrabers/convertwithmoss/core/model/`:
- [x] **Recorte y Reproducción de Muestra (`ISampleZone`)**:
  - `sampleStartFrame` / `sampleEndFrame` (offset de inicio y fin de reproducción dentro del WAV sin recortar destructivamente), inversión (`reversed`), `pitchKeytrack` continuo (0..100%), `playLogic` (`'always' | 'round_robin' | 'random' | 'velocity'`), `velToVolumeDepth` (-1..+1) y `velToPitchCents`.
- [x] **Bucles Múltiples y Modos (`ISampleLoop` / `SampleLoopDescriptor`)**:
  - Lista de bucles por zona (`loops?: SampleLoopDescriptor[]`), tipos (`no_loop`, `loop_continuous`, `loop_sustain`, `ping_pong`, `loop_backward`, `one_shot`), `startFrame`, `endFrame`, `crossfadeFrames`, `crossfadeCurve` y `maxRepeats`.
- [x] **Fundidos Cruzados (`Crossfade`)**:
  - Curvas y anchos de fundido de nota (`keyFadeIn`/`keyFadeOut`, `keyFadeCurve`) y de velocidad (`velFadeIn`/`velFadeOut`, `velFadeCurve`).
- [x] **Envolventes y Curvas (`IEnvelope` / `IEnvelopeModulator` / `IPitchModulator`)**:
  - Tiempos `delay`, `attack`, `hold`, `decay`, `release`, niveles `startLevel`, `holdLevel`, `sustain`, `endLevel`, pendientes/curvas (`attackSlope`, `decaySlope`, `releaseSlope`: `linear | exponential | logarithmic`) y `velocityModDepth`.
  - Tres envolventes independientes por zona o articulación global: **Amplitud** (`ampEnv` / `ampEnvOverride`), **Filtro** (`filterEnv` / `filterEnvOverride` con `envDepthCents` bipolar) y **Pitch/Tono** (`PitchEnvelopeConfig`: `pitchEnv` / `pitchEnvOverride` con `depthCents` y `velocitySensitivity`).
- [x] **Filtros (`IFilter` / `RegionFilterConfig`)**:
  - Tipos (`lpf`, `hpf`, `bpf`, `brf`, `notch`), número de polos (`poles: 1 | 2 | 3 | 4 | 6 | 8`), `cutoffHz`, `resonance`, `keytracking`, `velToCutoffCents` y `envDepthCents`.
- [x] **Grupos, Articulaciones y Exclusión (`IGroup`)**:
  - `groupId`, `groupName`, conmutación por tecla (`keyswitchNote`), grupos de exclusión mutua (`muteGroup` 1..32, ej. hi-hat cerrado/abierto en MPC/SFZ/Kontakt), `polyphony` (1..128), `voiceMode` (`poly | mono | legato`) y `glideTimeSec`.
- [x] **Expresividad Hardware (MPCe / MPE / Aftertouch / PitchBend)**:
  - Rango de `pitchBendUpSt` / `pitchBendDownSt` y rutas de modulación tipadas.

### 33.2 Capa de Abstracción Universal y Compatibilidad con los Contratos de Parámetros de `ABDShared` (`MidiTranslationEngine` / Diccionario de Datos) [COMPLETADA]
Implementado en `ABDShared/Contracts/sampler_voice_parameter_spec.json`, `ABDShared/Contracts/parameter_dictionary.schema.json`, `ABDShared/Contracts/MidiTranslationEngine.ts`, `ABDShared/Docs/specs/COMMON_DATA_DICTIONARY_AND_INTEGRATION.md` y `ABDShared/Code/SamplerFormats/UniversalSamplerModel.ts`:
- [x] **Nivel 1 — Diccionario Común de Parámetros de Voz de Sampler (`sampler_voice_parameter_spec.json` + `MidiTranslationEngine.ts` v2.0)**:
  - 41 parámetros canónicos (`Global`, `AmpEnv`, `Filter`, `FilterEnv`, `PitchEnv`, `LFO`, `Zone`, `Loop`) con curvas invertibles (`Linear`, `Exp`, `Pow`, `Switch`) y unidades físicas (`Hz`, `s`, `dB`, `cents`, `%`, `st`, `frames`, `ms`).
  - Funciones `extractNormalizedDictionaryParams()` y `applyNormalizedDictionaryParams()` en `UniversalSamplerModel.ts` que proyectan cualquier región/articulación a valores normalizados `[0..1]` y de vuelta a unidades físicas DSP.
- [x] **Nivel 2 — Matriz de Modulación (`UniversalSamplerModRoute`)**:
  - Rutas compatibles con `ABDShared/Contracts/modulation_matrix.schema.json`.
- [x] **Nivel 3 — Grafo Estructural (`UniversalSamplerInstrument` / `UniversalSamplerGroup`)**:
  - Conversores bidireccionales sin pérdida `sessionToUniversalSamplerInstrument()`, `universalSamplerInstrumentToSessionPatch()`, `nativeImportResultToUniversalInstrument()`, `universalInstrumentToNativeImportResult()`, `parsedSamplerPresetToUniversalInstrument()`, `universalInstrumentToParsedSamplerPreset()`, `parseUniversalSamplerInstrument()` y `exportUniversalSamplerInstrument()`.
- [x] **Registro Declarativo de Capacidades por Formato (`FORMAT_CAPABILITIES_REGISTRY` + `evaluateFormatFidelity()`)**:
  - Perfiles declarativos para `legacy-neuron`, `modern-neural`, `sfz`, `sf2`, `dspreset`, `nki`, `mpc_xpm`, `mpc_xpn`, `multisample` y `vstpreset`, con evaluación automática de avisos de adaptación/pérdida (`FormatAdaptationNotice[]`).

### 33.3 Migración a `@abdsynths/shared/formats/sampler` (`ABDShared/Code/SamplerFormats`) [COMPLETADA]
- [x] **Núcleo centralizado en `ABDShared/Code/SamplerFormats/`** (exportado como `@abdsynths/shared/formats/sampler` y sincronizado a `vendor/@abdsynths/shared` mediante `npm run vendor:sync`):
  - `SamplerTypes.ts`, `SamplerUtils.ts`, `ExtendedAdapter.ts`, `UniversalSamplerModel.ts`.
  - Codecs de audio y slicers puros: `WavAiffDecoder.ts` (en `NeuronFormats` con soporte PCM 24-bit/96kHz y `smpl` loops), `SliceFileParser.ts` (`cue `, `MARK`, `atem`, `.ot`, `.rx2`), `DwopDecompressor.ts` (REX2 DWOP), `KontaktParser.ts` (con decodificador NCW).
  - Lectores y escritores de formatos: `Sf2Parser.ts`, `soundfont2Writer.ts`, `SfzParser.ts`, `DecentSamplerParser.ts`, `KontaktParser.ts`, `MpcXpmFormat.ts`, `sampleChainWriter.ts`, `rawSamplerTypes.ts`, `rawSamplerPreflight.ts`, `rawSamplerParsers.ts`, `RawSamplerExporter.ts`.
- [x] **Re-exportación limpia en `ABDNeuModMakr`**:
  - Todos los módulos locales en `src/formats/`, `src/core/sampler/`, `src/core/export/`, `src/core/import/rawSamplerParsers.ts`, `src/core/extendedAdapter.ts` y `src/core/dsp/{WavDecoder,SliceFileParser,DwopDecompressor}.ts` re-exportan desde `@abdsynths/shared/formats/sampler` y `@abdsynths/shared/formats/neuron` como única fuente de verdad.

---

## Revisión pendiente — NeuronDB Bank Browser (capturas aportadas, no tocar ahora) [PLANIFICADA]

**Situación**: el usuario aportó 7 capturas del panel `NEURONDB BANK BROWSER` (visto en `localhost:5320`) sin pedir un cambio concreto. Se deja esta tarea al final del roadmap para revisarla cuando se llegue aquí; es muy posible que para entonces ya no haga falta porque la UI ya habrá evolucionado o el BankDrawer/BankManager ya cubrirá lo necesario.

**Lo que muestran las capturas (resumen para la revisión futura)**:
- Panel lateral `NEURONDB BANK BROWSER` con buscador `Search models or presets by name, slot (#000), set...`.
- Pestañas `MODELS (000..511) [341]` vs `SOUND PRESETS [354]`, y variantes `GENERATED MODELS 16` / `LIBRARY 341`.
- Filtros por categoría de preset (`All (354)`, `ATTACK PADS (56)`, `SOLO (26)`, `SHOWCASE (21)`, `PADS (37)`, etc.) y por set de modelo (`0: General (179/106)`, `1: Strings`, `2/3: Plucked`, `4/7: Pads`, `8: Loops (45/2)`, `Pending (181)`, etc.).
- Tarjetas de preset con `#slot`, nombre, `Uses Model #NNN`, `445 params`, badge de categoría y botón `Load Sound`.
- Tarjetas de modelo con `#slot`, nombre, `N Zones`, `Lvl N`, tag de set (`Default Set`, `Carpet Shop`) y botón `Load`.
- Controles `ASSIGN TARGET: Resynator 1 (R1)` / `Resynator 2 (R2)` y `TARGET: RESYNATOR 2 (R2)`.
- Contadores `26 / 354 PRESETS`, `181 / 341 IN LIBRARY`, `341 MODELS`.
- **Consigna**: no tocar nada de esto ahora. Al llegar a esta tarea, decidir si hace falta algún ajuste en BankDrawer/BankManager o si se cierra sin cambios.





