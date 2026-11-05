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

### 11.4 Motor Espectral de Alta Definición y Resynators [COMPLETADA]
- [x] Formato Espectral de Alta Definicion (>64 parciales, >16 tramas) especificado y serializado en `axionik-expanded.json` (`partialCount` / `frameCount` parametrizados).
- [x] Separacion de formantes y pitch para Formant Shifting en tiempo real (`pitchTrackHz` + `formantProfileSt` persistidos en v2).
- [x] Campos de morphing 2D/3D y espacio latente (`morphSpace` + `latentRef` en contrato v2).
- [x] Modelos Surround reales (Quad 4.0 / 5.1) con Scape frontal y Sphere envolvente (salida dual según hardware: discreta Quad/`5.1` si el host abre bus multicanal, o Pseudo-Surround estéreo en hosts `2.0` y WASM).
- [x] Disparo hibrido de transitorios PCM reales fundidos en fase con el cuerpo (`hybrid-transient` en `requiredCaps` + bloque `hybridTransient: { durationMs, crossfadeMs, gainDb, onsetFrame, spliceFrameIndex }` por región + fases `phases[]` e instante `timeSec` en la trama de enganche; reproducción DSP en Fase B de AxionikVS).

### 11.5 Motor Dual, Formato Axionik v2 y Blindaje del Modo Expanded [COMPLETADA]

**Decisión registrada**: un solo código C++ con tres variantes compiladas vía CMake siguiendo el patrón `ABDJUNiO601` (`classic` congelado, `classic-enhanced` con filtros/FX mejorados en cadena independiente, y `expanded` con nuevos Resynators 100 % propios consumiendo v2). Rompler como producto, no (descartado). El modo expanded de `ABDAxionikVS` se alimenta del contrato v2 (`05_extended_model/axionik-expanded.json`), y este apartado fija qué debe cumplir el motor y qué porta el formato. Si el formato no puede con el motor, se cambia el formato (codificación, forma y algoritmos, deterministas e IA), nunca al revés.

#### 11.5.1 Arquitectura de doble/triple motor
- [x] **Motor clásico congelado bit a bit**: la ruta `04_classic_enhanced` es referencia y test dorado; no recibe parámetros nuevos jamás. Lo desconocido futuro la ignora por construcción (verificado en test `11.8`).
- [x] **Ruta expanded nueva** en `ABDAxionikVS` que consume exclusivamente la capa `05_extended_model`. Nada de expanded contamina el clásico.
- [x] **El raw como fuente, no como producto**: la capa `01_raw_source` solo entra al expanded como transitorios PCM híbridos fundidos con cuerpo de resonador (punto 11.4). No hay modo rompler puro.
- [x] **Presets con motor mínimo declarado**: cada preset expanded fija `engineMin` + `requiredCaps`; el preflight valida contra el perfil de capacidades del motor destino.

#### 11.5.2 Inventario "lo mejor hasta hoy" que el expanded debe aprovechar
- [x] **Determinista**: NAS `legacy` + `enhanced` (separación HPSS transitorio/estacionario, pitch YIN/MPM + HPS, suavizado de trayectorias), frames Scape/Sphere + resíntesis a PCM, MasterWave determinista (loop por zero-crossing, expansión de short-loop, espacial hasta quad, 96 kHz, downmix), slicer (flujo espectral/onsets), loop editor multi-algoritmo, `qualityScore`, descriptores acústicos + taxonomía de 14 categorías.
- [x] **IA**: interfaz de proveedores (`audiosr`, `htdemucs`, `bigvgan`, `outpaint-loop`), `WebNeuralEngine`, Cloud BYOK, clasificador WebGPU/WASM/bridge. Toda mejora IA aplicada queda registrada como proveniencia en el preset (`aiChain`: qué modelo, sobre qué capa).
- [x] **Filtros y efectos nuevos** en la ruta expanded (previsto del lado AxionikVS): viajan como bloques `filters[]` / `fxChain[]` tipados y puenteables, no como parámetros sueltos del clásico.

#### 11.5.3 Huecos del formato v1 que obligan al v2 (auditoría resuelta en v2.0.0)
- [x] `model.nmmodel` fija **64 parciales en código** (`frameToJson` itera `i < 64`): el espectral HD (>64 parciales, >16 tramas) no cabe. El v2 parametriza `partialCount` / `frameCount`.
- [x] La **separación formante/pitch** no se persiste en ningún fichero: el v2 la guarda (`formantProfileSt` + `pitchTrackHz`).
- [x] El **espacio de morphing 2D/3D y la referencia latente** (VAE) no tienen sitio: el v2 añade `morphSpace` + `latentRef` opaco con dimensiones.
- [x] **Filtros/FX del expanded y Resynators v2** no tienen sitio: el v2 los añade namespaced (`resynators.v2.*`), ignorables por motores viejos.
- [x] Ningún fichero declara **qué motor necesita**: el v2 añade `engineMin` + `requiredCaps`.

#### 11.5.4 Regla de compatibilidad motor <-> formato
- [x] Todo lo que el motor produce tiene sitio en el formato; si no, se revisa la codificación del formato, no se recorta el motor.
- [x] Preflight también hacia Axionik (patrón Fase 16): si el destino no cubre los `requiredCaps`, adaptar o bloquear con aviso, nunca corromper en silencio.
- [x] Contrato único versionado en `ABDShared` (`contracts/axionikExpandedModel` v2.0.0, SSOT): precede al DSP; NeuModMakr ya puede escribirlo y preflightearlo mientras AxionikVS implementa la reproducción.

#### 11.5.5 Writer v2 + preflight Axionik (implementado)
- [x] Writer `src/core/expandedModelWriter.ts` (`buildAxionikExpandedModel`): documento v2 desde datos de cápsula; espectral HD guiado por longitud real; `pitchTrackHz`/`formantProfileSt`, `morphSpace`/`latentRef`, filtros/FX expandidos, `aiChain` y `requiredCaps` derivadas.
- [x] Preflight `preflightExpandedModelForAxionik`: bloquea ante caps ausentes o `engineMin` superior; degradables como `adaptations` explícitas, nunca en silencio.
- [x] Cápsula: `expandedModelV2?` en `TimeCapsuleBuildInput` escribe `05_extended_model/axionik-expanded.json`; extractor simétrico (`expandedModelV2Json`). Sin v2, la cápsula es idéntica a la anterior.
- [x] Tests `tests/phase11_expanded_model.test.ts` registrados en `tests/run_all.ts`.

#### 11.5.6 Handoff a la Fase B de `ABDAxionikVS` (COMPLETADA 2026-11-04)
- [x] **Contrato y flujo de datos listos del lado Makr**: documento v2 escrito y preflighteado antes de que exista el DSP que lo reproduce; el preflight acepta el JSON tal cual sale de la cápsula (sin re-serializar) y bloquea ante caps ausentes o `engineMin` superior (`@abdsynths/shared/contracts/axionikExpandedModel.ts`).
- [x] **Perfil de capacidades del motor Axionik**: perfiles canónicos de los 3 modos/variantes CMake de `ABDAxionikVS` exportados en `ABDShared` (`AXIONIK_CLASSIC_ENGINE_PROFILE` = `classic`, `AXIONIK_PLUS_ENGINE_PROFILE` = `plus`, `AXIONIK_EXPANDED_ENGINE_PROFILE` = `expanded`, patrón `ABDJUNiO601`). Salida dual según hardware: discreta Quad/`5.1` si el host abre el bus (`spatialOutputMode: 'discrete-quad'`), o Pseudo-Surround estéreo (`spatialOutputMode: 'pseudo-surround-stereo'`, con adaptación explícita `spatial-downmix`). Validación estricta de formato por modo (`validateModelFormatForMode`): cada modo solo admite su propio formato de modelo y rechaza con aviso el resto.
- [x] **Consumo en Fase B (`ABDAxionikVS/Source/DSP/Extended/`)**: fuente primaria `05_extended_model/axionik-expanded.json` (`AxionikExpandedModel.h` + `AxionikExpandedSynthesizer.h`); `05_extended_model/model.nmmodel` (+ `extended_map.json`) como respaldo espectral v1 (`parseLegacyNmModelV1Json`). Ambas rutas con aislamiento estricto sin mezclarse jamás con `04_classic_enhanced/`.
- [x] **Preflight en el arranque/carga del motor C++ (`DspEngineFacade::loadExpandedModelFromJson` / `loadExpandedModelFolder`)**: carga el documento, ejecuta `preflightExpandedModelForAxionik` en C++20 puro, aplica `applyExpandedPreflightAdaptations` (bypass de filtros/FX/resynators desconocidos, truncado HD de `partialCount`/`frameCount`, `spatial-downmix` a Pseudo-Surround) o bloquea con aviso explícito (`ok == false`) sin cargar parcialmente en silencio.
- [x] **DoD de la fase**: tests automatizados en C++ (`DspEngineFacadeTests.cpp` Tests 9, 10 y 11: motor sin caps/modo incompatible bloqueado, motor `expanded` con adaptaciones aplicadas + síntesis Pseudo-Surround finita y aislamiento de capas Time-Capsule) y en TypeScript (`expandedModelWriter.test.ts` 30/30 PASS) con cero regresiones en `GoldenParityTest` (`--zones`, `--matrix`).
- [x] **Puente del modo clásico**: el extractor de cápsulas expone el v2 aparte y el set de parseo clásico queda idéntico con o sin el documento (tests 11.8 y 11.9); el importador de AxionikVS puede replicar esa selección sin tocar el parseo de `04_classic_enhanced/`.

#### 11.5.7 Frontera Arquitectónica Resynator vs. Sinte, Variantes CMake y Salida Dual (Acuerdos 2026-11-03)
- **Resynators 100 % propios y sin ataduras de retrocompatibilidad**:
  - Los nuevos Resynators del modo extendido son 100 % nuestros; no tienen por qué arrastrar limitaciones del formato Hartmann 2002 ni el embudo de un único espectro raíz. Cualquier librería o modelo externo pasa siempre por `ABDNeuModMakr` para convertirse a nuestro formato.
  - Por tanto, en el contrato v2 cada región/muestra puede portar o referenciar directamente su propio modelo espectral HD (`spectralBySample` / por región) y sus parámetros de empalme de transitorio híbrido (`hybridTransient`).
- **Patrón `ABDJUNiO601` para las 3 variantes del sinte**:
  - Mismo código fuente C++ en `ABDAxionikVS` con definición de compilación en `CMakeLists.txt` (`AXIONIK_TARGET_MODEL` 0..2 + `add_compile_definitions` + script `build_all_models.bat` que genera cada variante en su carpeta): `0 = classic` (100 % clásico), `1 = plus` (Resynator clásico con filtros y efectos mejorados), `2 = expanded` (nuevos Resynators v2 de `ABDAxionikVS` + nuevos filtros + más efectos). Cada modo/Resynator solo admite su propio formato de modelo compatible y rechaza (avisando) el resto. *(Nota: el aprovechamiento futuro de los nuevos Resynators en `ABDNeural` queda fuera del alcance actual.)*
- **Separación limpia entre Materia del Resynator y Cadena/Parámetros del Sinte**:
  - **Al Resynator (Modelo `.nmpack` / `axionik-expanded.json`)** pertenecen exclusivamente los datos acústicos/espectrales: análisis espectral HD por muestra/región, `pitchTrackHz`, `formantProfileSt`, `morphSpace` / `latentRef`, empalme del transitorio híbrido PCM y disposición espacial `Scape`/`Sphere`.
  - **Al Sinte (Dispatcher de Voces + Cadena de Audio independiente, como en `ABDJUNiO601`)** pertenecen los filtros y efectos (`filters[]`, `fxChain[]`, situados en la cadena de audio independiente del Resynator) y los parámetros expresivos de ejecución (`trigger: attack/release/first/legato`, `roundRobin`, curvas de crossfade `keyFade/velFade`, `pitchKeytrack`, envolventes DAHDSR y LFOs).
- **Salida Espacial Dual según Hardware (`Surround Discreto` + `Pseudo-Surround Estéreo`)**:
  - Ambas rutas conviven en tiempo de ejecución: si el host abre bus multicanal (`4.0` Quad / `5.1`), el motor saca los canales discretos; en hosts `2.0` y en navegador (WASM) aplica la reducción **Pseudo-Surround estéreo**. El documento v2 conserva siempre la información espacial completa.
- **Mejoras de Vanguardia Integradas en Contrato v2, DSP Determinista e IA (`11.11`–`11.13` en verde)**:
  - **Multimuestra real (`spectralBySample`)**: diccionario de espectros HD indexado por `sampleRef` para que cada muestra/región tenga sus propios parciales, formantes y residuo sin pasar por un único espectro raíz.
  - **Parciales con ancho de banda Loris (`bandwidths[]`), Residuo DDSP (`residualBandsDb[]`) y Envolvente Formántica 24-Bark (`formantEnvelopeDb[]`)**: calculados tanto de forma determinista (`expandedModelWriter.ts`) como mediante IA/WebGPU (`webNeuralEngine.estimateResonatorMatter`).
  - **Moldeadores de Materia Sónica tipados (`shapers: AxionikResonatorShapers`)**: `inharmonicityB`, `parity`, `entropyRoughness`, `spectralShiftHz`, `hfRollOffDbPerOct`, `formantShiftSt`, `formantPreserve`, `residualMix` y `spatialSpread`.
  - **IA condicionada por Huella de Ruido (`X-Noise-Profile`)**: propagada también en `MasterWaveEnhancer.ts` (`HttpAiBridgeProvider`) y registrada en `aiChain` (`denoise-ai`, `ddsp-harmonic-residual`, `vae-latent-encode`) para que el upsampling IA no amplifique ruido de fondo hacia los parciales altos (`65..256`).

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

## Fase 19 — Modo Rompler Puro en ABDAxionikVS (Reproducción de Audio Crudo / Raw Multisample) [DESCARTADA 2026-11-03]

**Objetivo**: Permitir que el sintetizador software `ABDAxionikVS` opere como un rompler tradicional de alta definición, cargando y reproduciendo directamente la materia prima sin procesar de la capa `01_raw_source` (o `03_enhanced_audio` en 24-bit/96kHz).

**Descarte 2026-11-03**: no se hace en `ABDAxionikVS`. Contradice el 11.5.1 (el raw solo entra al expanded como transitorio híbrido fundido con cuerpo de resonador; no hay modo rompler puro). Se conserva el contenido como registro de lo evaluado; si algún día hiciera falta reproducción directa de multisamples, se replantearía como herramienta o variante separada, no como modo del sinte.

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

## Fase 22 — Suite de Funcionalidades Avanzadas de Sampler Profesional (Estándar Kontakt / HALion / Falcon) [COMPLETADA]

**Objetivo**: Dotar a ABDNeuModMakr y al motor ABDAxionikVS de las capacidades de expresión, articulación y gestión acústica que distinguen a los samplers insignia de la industria.

### 22.1 Matriz de Funcionalidades
| Funcionalidad | Descripción e Interés | Estado |
| :--- | :--- | :--- |
| **Round-Robin (Alternancia de Muestras)** | Disparar tomas alternas (`Take 1`, `Take 2`, etc.) en ciclos ordenados (`cycle`), aleatorios sin repetición inmediata (`random`), o alternancia estricta para la misma nota/velocidad (`ArticulationEngine.ts`). | **COMPLETADO** |
| **Release Triggers / Key-Off** | Muestras que se disparan al soltar la tecla (el apagador de un piano, ruido de trastes en guitarra o golpe mecánico de llaves de órgano) con resolución dinámica en `noteMapping.ts` y audición en `src/main.ts`. | **COMPLETADO** |
| **Auto-Mapping por Expresión Regular (Filename Regex)** | Reconocimiento automático de nota raíz (`C3`, `F#2`), rangos de tecla (`C2-C3`), dinámicas de velocidad (`ppp`..`fff`, `v1`..`v4`, `1-127`), capas round-robin (`_rr1`, `take2`), etiquetas release (`_rel`, `keyoff`) y relleno contiguo de vecinos (`neighborSpread`). | **COMPLETADO** |
| **Interactive Slicer con MIDI Drag-and-Drop** | Detección de transitorios en un loop rítmico, corte en rodajas a teclas cromáticas consecutivas y botón arrastrable para transferir el archivo MIDI generado directamente a la pista del DAW (Fases 18 y 25). | **COMPLETADO** |
| **Matriz de Modulación MIDI (Mod Matrix)** | Enrutar Rueda de Modulación (CC1), Expresión (CC11), Aftertouch o Velocidad al corte de filtro, volumen, pitch o longitud de loop (`ModulationMatrix` en `ArticulationEngine.ts`). | **COMPLETADO** |
| **Soporte de Microtuning / Escalas Scala (`.scl`)** | Parser de archivos Scala `.scl` con razones racionales y cents decimales, generador de tablas de frecuencias absolutas y tabla de offsets relativos en cents frente a 12-TET (`ScalaMicrotuning.ts`). | **COMPLETADO** |

### 22.2 Integración en Formatos de Exportación
- [x] En **formato Moderno (`.nmmodel`), Axionik v2 y Cápsula del Tiempo**: Se preservan como metadatos nativos de primera clase.
- [x] En **formato Clásico Hartmann (`.model`)**: Dado que el hardware Neuron original no dispone de round-robin ni release triggers nativos, el preflight exportará la capa primaria y avisará con un diálogo interactivo al usuario antes de proceder a la adaptación.
- [x] Suite de pruebas automatizada `tests/phase22_advanced_sampler.test.ts` (8/8 tests 100% PASS).

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

## Fase 29 — Equivalencia Transparente de Contenedores .ZIP como Carpeta e Importación Inteligente Polimórfica Mixta con Triaje Batch [COMPLETADA]

**Objetivo**: Tratar cualquier archivo `.zip` depositado en la aplicación con total equivalencia a una carpeta física en disco, permitiendo la ingesta desatendida o guiada de colecciones complejas. Implementar un motor de descubrimiento recursivo capaz de explorar carpetas o archivos comprimidos heterogéneos con múltiples formatos, instrumentos y presets entremezclados, clasificando lo que hay y presentando una compuerta interactiva de triaje previo que informe detalladamente al usuario y le permita seleccionar qué procesar por lotes.

### 29.1 Equivalencia Transparente .ZIP = Carpeta (Virtual Zip Filesystem) [COMPLETADA]
- [x] **Tratamiento Unificado de Entrada**:
  - Toda función de importación acepta indistintamente un directorio del sistema de archivos o un archivo `.zip`.
  - Desempaquetado virtual en memoria mediante `VirtualZipFs.ts`, exponiendo un árbol de rutas virtuales normalizadas (`VirtualFileEntry[]`) sin necesidad de descompresión física en disco.
  - Soporte transparente para ZIPs anidados (archivos `.zip` o `.xpn` contenidos dentro de otros ZIPs).

### 29.2 Descubrimiento Polimórfico de Contenidos Mixtos (Multi-Asset Discovery Engine) [COMPLETADA]
- [x] **Inspección Recursiva Multiformato (`MultiAssetDiscovery.ts`)**:
  - Escaneo en profundidad del árbol virtual identificando de forma simultánea e independiente:
    - SoundFont 2 (`.sf2` con múltiples presets).
    - Instrumentos SFZ (`.sfz` y sus muestras asociadas).
    - Presets Decent Sampler (`.dspreset`).
    - Patches Native Instruments Kontakt (`.nki`).
    - Multisamples Bitwig (`.multisample`).
    - Loops ReCycle (`.rx2`, `.rex`, `.rcy`).
    - Cadenas y formatos modernos/clásicos (Ableton ADV, Logic EXS24, TAL-Sampler, TX16Wx, Korg KMP, Akai MPC/MESA/AKP, Reason NN-XT, DirectWave, Soundbox, Omnisphere, Maschine, etc.).
    - Carpetas de muestras sueltas agrupadas por instrumento, afinación o prefijo común.
- [x] **Diferenciación y Aislamiento de Entidades**: Aislamiento limpio de muestras compañeras por subdirectorio para evitar colisiones de notas entre instrumentos heterogéneos.

### 29.3 Compuerta Preflight de Triaje y Selección Batch Interactiva [COMPLETADA]
- [x] Diálogo modal interactivo `MultiAssetTriageModal.ts`:
  - Desglose jerárquico estructurado (formato, nombre de preset, recuento de muestras, tamaño en KB/MB y ruta).
  - Buscador en tiempo real y selector de filtro por formato.
  - Checkboxes individuales y masivos (Select All / Deselect All) con contador en vivo.
  - Carga individual en 1 clic hacia la sesión activa o derivación directa de la selección hacia el `BatchProcessorModal` (`loadCandidates`).
- [x] Suite de pruebas automatizada `tests/phase29_virtual_fs_triage.test.ts` (100% PASS, 33/33 suites maestras).

---

## Fase 30 — Detector de Silencio, Suelo de Ruido y Huella de Ruido (Noise Print) con Limpieza DSP/IA [COMPLETADA]

**Objetivo**: Detección y recorte de silencios iniciales/finales, medición de suelo de ruido, captura de huella de ruido (*Noise Print*) a partir de tramos seleccionados o automáticos, y limpieza de audio mediante puerta/sustracción espectral DSP y paso de huella al motor de IA para supresión en Companion Bridge.

### 30.1 Detector y Recorte de Silencio (`takeDsp.ts`) [COMPLETADA]
- [x] Detección de silencios iniciales, finales y huecos internos (`detectSilenceRanges`) con umbral configurable en dBFS, duración mínima y tiempo de retención (*hangover*) para proteger colas de reverb y notas fantasma.
- [x] Recorte automático de silencios en bordes (`trimSilence`) devolviendo métricas de milisegundos recortados y preservando la fase.

### 30.2 Estimación del Suelo de Ruido y Detección de Hum (`computeNoiseProfile`) [COMPLETADA]
- [x] Medición de RMS de suelo de ruido en dBFS sobre tramos de reposo.
- [x] Desglose espectral en bandas logarítmicas de 40 Hz a 18 kHz.
- [x] Detección de zumbido de red eléctrica (*Mains Hum*) a 50 Hz y 60 Hz mediante algoritmo Goertzel con precisión en dBFS.

### 30.3 Huella de Ruido (*Noise Print*) y Reducción Espectral DSP [COMPLETADA]
- [x] **Captura de Huella desde Región de Usuario (`captureNoisePrintFromRegion`)**:
  - Posibilidad de seleccionar interactivamente cualquier tramo o slice en el visor de audio (`AudioChopperModal.ts`, menú contextual de slice: *"Capture Noise Print from Slice"*) para fijar la huella de ruido de referencia.
- [x] **Reducción de Ruido Espectral (`reduceNoiseWithProfile`)**:
  - Sustracción espectral y puerta STFT adaptativa con suavizado de artefactos musicales (*musical noise reduction*), rodilla suave (*soft knee*) y protección de transitorios.
  - Filtro notch IIR adaptativo de 2º orden para supresión de zumbido a 50 Hz y 60 Hz sin degradar el cuerpo de la muestra.

### 30.4 Integración de Huella de Ruido con IA de Companion Bridge [COMPLETADA]
- [x] Pasarela de cabecera `X-Noise-Profile` en `BridgeClient.ts` y en el endpoint `/api/enhance` de `bridge/server.py`.
- [x] El motor de IA y DSP en Python recibe el perfil de ruido capturado (`levelDbfs`, `hum50HzDb`, `hum60HzDb`) y lo resta/ignora activamente durante el re-muestreo a 96 kHz, extensión armónica (BWE) y outpainting para evitar amplificar el ruido.
- [x] Suite de pruebas automatizada `tests/phase30_noise_print.test.ts` (100% PASS, 34/34 suites maestras).

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

## Fase 32 — Análisis de ConvertWithMoss: Paridad Total de Formatos de Entrada/Salida y Mejora de los Existentes [COMPLETADA]

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
- [x] Lector de imágenes de disco (Akai S-Series S900/S1000/S3000, E-mu Emulator III/EOS E4, Roland S-7xx, Ensoniq EPS/ASR y Yamaha A-Series en ABDShared/Code/SamplerFormats/).
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
2. [x] **Bloque 2 — Hardware Moderno SD / Trackers / Sintetizadores [COMPLETADO]**:
   - **Sub-bloque 2A (Modernos SD / Trackers / XML) [COMPLETADO]**:
     - [x] **1010music Blackbox / Tangerine** (`preset.xml` + muestras en subcarpetas con `<session>`, `<cell>`, `<params>`).
     - [x] **Synthstrom Deluge** (`SYNTHS/*.XML` / `KITS/*.XML` con `<sound>`, `<osc1>`, `<zone>`, `<envelope1/2>`, `<filter>`).
     - [x] **Renoise Instrument** (`.xrni` — archivo ZIP con `Instrument.xml` + muestras en `SampleData/` en formato FLAC).
     - [x] **discoDSP Bliss** (`.zbp` — archivo ZIP con `program.xml` + muestras FLAC/WAV).
     - [x] **Polyend Tracker / Play** (`.pti` — cabecera binaria `TI` + 372 bytes de bloque de parámetros + PCM16 44.1kHz).
     - Verificado con `tests/phase32_formats_block2a.test.ts` (6/6 PASS).
   - **Sub-bloque 2B (Hardware Moderno Adicional) [COMPLETADO]**:
     - [x] **Waldorf Quantum / Iridium** (`.qpat` — contenedor binario `0x0033ECB4`, tabla de parámetros y mapas de muestra tabulados con crossfade y bucles).
     - [x] **Elektron Tonverk / Digitakt** (`.tvpst` / `elmulti` con formato declarativo TOML `[[key-zones]]`, `[[key-zones.velocity-layers]]` y `[[key-zones.velocity-layers.sample-slots]]`).
     - [x] **Teenage Engineering OP-XY / OP-Field** (`patch.json` en `.preset` o `.zip` con estructura JSON para motor, envolventes, start/end y bucles).
     - [x] **Expert Sleepers Disting EX** (`.dexpreset` binario `DEXBPRST` con algoritmo 2 y convención de nombres `[Name]_[Note]_SW[key]_V[vel].wav`).
     - [x] **Sequential Prophet X / XL** (`.grp` con mapeo de 15 columnas TSV a 48 kHz y afinación por Hertz exacta).
     - [x] **Isla Instruments S2400** (`.kit` / `.s24` binario TLV con registros de campo `FIELD_*`, ganancia de pista, choke groups y modos de disparo).
     - [x] **Korg Modern Multisample** (`.korgmultisample` binario `0x00000001` para Kronos, Nautilus, WaveState y modwave).
     - [x] **Groove Synthesis 3rd Wave** (`.3wv` binario `3WV\0` con ranuras de programa y asignación de notas).
     - [x] **Roland SP-404MKII / MC-707 / Zen-Core** (`.svz` binario `SVZ\0` con descriptores de tono y zonas de tecla).
     - Verificado con `tests/phase32_formats_block2b.test.ts` (10/10 PASS).
3. [x] **Bloque 3 — Formatos Binarios Clásicos e Imágenes de Disco (CD/SCSI/Floppy/Gotek) [COMPLETADO]**:
   - [x] **Akai S-Series Vintage & MESA [COMPLETADO]**:
     - **Akai S900 / S950** (`.img`, `.dsk`, discos de 3.5" DD 720KB/HD 1.44MB para emuladores Gotek FlashFloppy y disqueteras físicas, descompresión por grupos de 10 muestras con bit-count variable de 12-bit).
     - **Akai S1000 / S1100 / S2000 / S3000** (`.iso`, `.img`, `.dsk`, imágenes de CD-ROM SCSI, discos duros y disquetes 3.5" Gotek).
       - Parser del sistema de archivos propietario Akai: tabla de particiones (bloques de 8192 bytes `AKAI_BLOCK_SIZE`), volúmenes, árbol de directorios con `AkaiDirEntry` ('P' programas, 'S' muestras, 'T' tomas).
       - Deserialización de programas Akai S1000/S3000 (`.p` / `.s3p` / MESA): cabecera de programa, keygroups de 4 zonas con split por tecla y velocidad, envolventes Akai de 4 tasas/4 niveles (`AkaiS1000Envelope`), filtros resonantes, tuning y bucles (`AkaiS1000SampleLoop`).
       - Extracción de audio Akai S1000/S3000 a WAV PCM16 (conversión Big/Little Endian y frecuencias Akai 22050/44100).
   - [x] **E-MU Emulator III / EOS Emulator IV [COMPLETADO]** (`.e4b`, `.esi`, `.iso`, `.img` con filesystem `EMU3` y bancos IFF FORM `E4B0` / `EMULATOR THREE`).
   - [x] **Roland S-7xx (S-770 / S-750 / S-760 / SP-700) [COMPLETADO]** (`.out`, `.img`, `.iso` con sector map Roland `770`, FAT y directorios de Patches, Partials y Samples).
   - [x] **Ensoniq EPS / EPS-16+ / ASR-10 [COMPLETADO]** (`.efe`, `.ede`, `.eda`, `.gkh`, `.img`, `.iso`, imágenes de disquete Gotek y SCSI con firma `5B` / sector map, cabeceras GKH y EFE).
   - [x] **Yamaha A3000 / A4000 / A5000 / YSFC [COMPLETADO]** (`.iso`, `.img`, `.hda`, `.hds`, `.x7u`, `.x7l`, `.x8l` con decodificación de sistemas SFS y YSFC).
   - [x] **Akai S5000 / S6000 / Z4 / Z8 [COMPLETADO]** (`.akp` RIFF `APRG` + WAVs de muestras en carpeta, lector y escritor con soporte para generaciones 1 y 3).
   - [x] **Akai MPC Clásico [COMPLETADO]** (`.pgm` / `.snd` para MPC60, MPC2000, MPC2000XL, MPC1000, MPC2500, imágenes de disco Gotek MPC2000 con cabecera bootsector `EB FE 90 4D 50 43 32 30 30 30` y descompresión 12-bit para MPC60).
   - [x] **Kurzweil K2000 / K2500 / K2600 / PC3 [COMPLETADO]** (`.krz`, `.k25`, `.k26` con contenedor `PRAM`, Programs 36, Keymaps 37, Samples 38 y extracción de audio lineal de 16 bits en Big-Endian).
   - [x] **Roland S-50 / S-550 / S-330 / W-30 [COMPLETADO]** (`.out`, `.img`, `.dsk` con sector map S5xx, 16 Patches, 32 Tones, bancos de onda A/B y descompresión de 12 bits).
   - [x] **Casio FZ-1 / FZ-10M [COMPLETADO]** (`.fzv`, `.fzf`, imágenes de floppy dump de 1.3 MB y volcados con bloques PCM lineal de 16 bits).
   - [x] **Yamaha Motif / Montage / MODX [COMPLETADO]** (`.x7u`, `.x8u`, `.x3a` con contenedor YSFC, metadatos `WVM1` y audio `WVD1`).
   - [x] **Synclavier II / Synclavier V / Regen [COMPLETADO]** (timbres multipartiales, algoritmo de desofuscación LCG de 64 bits para archivos `.sflc` y archivos de biblioteca de tarjeta SD y SYNX).
   - [x] **Fairlight CMI IIx/III [COMPLETADO]** (`.cmi`, `.cmi3`, `.vc`, `.co` con asignación de tabla de 128 zonas y audio PCM 16-bit Series III y 8-bit Series IIx).
   - [x] **Motor Universal de Imágenes de Disco e ISO [COMPLETADO]** (`IsoFormatIdentifier` unificado para detección automática de E-MU, Akai S-series, Roland, Ensoniq, Casio, Yamaha, ISO-9660 y Floppy Gotek RAW/HFE).
   - Verificado con `tests/phase32_formats_akai_disk.test.ts`, `tests/phase32_formats_vintage_disks.test.ts` y `tests/phase32_formats_block3.test.ts` (100% PASS).
4. [x] **Bloque 4 — Samplers de Software Adicionales, Akai MESA y Decodificadores de Audio [COMPLETADO]**:
     - [x] **Akai MESA / MESA II** (.s3p con desempaquetado de SysEx nibbles para programas S3000/S1000 y keygroups).
     - [x] **Reason NN-XT** (.sxt contenedor IFF FORM PTCH con chunks DESC, AUTH, PARM, CAT REFS y tabla BODY con zonas completas; lectura y escritura).
     - [x] **Image-Line FL Studio DirectWave** (.dwp formato de flujo de bloques DwPr con chunks 0x0066, 0x0067, 0x0003 y extracción de audio PCM16/FLAC; lectura y escritura).
     - [x] **Audiomodern Soundbox** (.sbpack, .sbx definiciones XML y paquetes ZIP con capas y categorías; lectura y exportación).
     - [x] **Spectrasonics Omnisphere** (.zmap, .prt_omn esquemas XML multisample de STEAM; lectura y exportación).
     - [x] **NI Maschine & NICNT** (.mxsnd, .mxgrp, .nicnt sonido/grupo con módulos Sampler y descriptores Native Instruments SNPID).
     - [x] **Formatos de Audio Ampliados**: Inclusión explícita de .mpa y .mp4 junto con .ogg, .flac, .caf, .m4a, .mp3 en UniversalAudioDecoder.ts.
     - Verificado con 	ests/phase32_formats_block4.test.ts (100% PASS).

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

---

## Fase 34 — Utilidad de Grabación, Clasificación Acústica y Limpieza DSP/IA de Audio (`Rec Recorder`) [COMPLETADA]

**Auditoría 2026-11-02** (petición: grabar audio, decidir si es cromático o drums, pasarlo por enhanced → autoslider → detector de notas → corte de silencios, con monitor, transporte play/pausa/ff/rw/stop vía MIDI de mesa, visor de onda + editor básico, normalizador, detectores de ruido/silencio/nota/tipo de drum, e inyección final a la zona central). Veredicto: **implementado y verificado end-to-end**. Arquitectura:

```
AudioRecorderModal (nuevo: captura + VuMeter/Spectrum + transporte)
  → classifyTake() (AcousticIntelligence: chromatic | drums)
  → enhance (MasterWaveEnhancer / PipelineRunner) → autoslice (AudioSlicerEngine)
  → silence trim (detector Fase 30) → normalize (nuevo, ver 34.5)
  → detectores: notas (YIN→hzToMidi) o drums (GM map) / ruido (Fase 30)
  → AudioChopperModal (revisar cortes, borrar zonas)
  → onInjectClassicZones / onInjectExtendedRegions → ZoneInspector/Ribbon
Transporte ⟵ MidiTransportService (Web MIDI nuevo + NOTE/MMC en midiLearnStore)
Modelos: RecordingSession/TransportBinding en ABDShared (Contracts), como CC/NRPN
```

### 34.1 Lo que ya se reutiliza sin cambios
- **Monitor**: `VuMeter` (`ABDShared/Components/vuMeter.js`): IN/OUT, dBFS −60..0, pico + clip, zero-allocation; más `SpectrumPlotter`, `ledLadder`, `peakLED`. Solo hay que alimentarlos desde el `AnalyserNode` de captura (nadie lo hace hoy).
- **Clasificación chromatic vs drums**: `AcousticIntelligence.ts` (`detectPitchYinMpm` + harmonicidad, detector percusivo/ruido, `classifyAcousticSample` 0..9) + `gmDrumMap.ts` + modos `drums`/`vocals`/cromático del chopper. Falta solo el `classifyTake()` router (harmonicity alta + f0 estable → cromático; densidad de transitorios alta + harmonicidad baja → drums).
- **Enhanced → autoslice → detectores**: `MasterWaveEnhancer` (+ puentes IA AudioSR/HTDemucs/BigVGAAN), `AudioSlicerEngine` (Spectral Flux, zero-crossing snap, silencios manuales, palabras fonéticas, import ReCycle), `detectPitchYinMpm` + `hzToMidiAndCents` + `estimateFundamentalPitchHz`, `analyzeDrumCollisions`, `WebNeuralEngine` (BYOK), botones Whisper-tiny y Demucs del chopper.
- **Onda + editor de cortes**: `AudioChopperModal.ts` YA es visor + `splitSliceAtFrame` (cortar) + `deleteSlice` (borrar) + `moveSliceBoundary` + lupa ±256 + snap a zero-crossing + silencios manuales. No construir editor nuevo: reutilizarlo como paso final.
- **Destino zonas**: `onInjectClassicZones` / `onInjectExtendedRegions` → `Zone` / `ExtendedRegion` (`src/core/types.ts`) → `ZoneInspector` + `ZoneRibbon`. Ruta abierta.

### 34.2 Piezas que YA están previstas en el roadmap (adelantar, no crear)
- **Fase 30 (PLANIFICADA) — Detector de Silencio, Suelo de Ruido y Huella de Ruido**: cubre exactamente "detector de silencios (con y sin IA)", "detector de señal de ruido" y limpieza DSP/IA. **Adelantar la Fase 30** desbloquea los pasos *silence trim* y *noise gate* del pipeline de grabación; el `noiseProfile` (nivel dBFS, espectro por bandas) debe exportarse como metadato para que el enhancer no refuerce el ruido al upsamplear.
- **Fase 22.1 (PLANIFICADA) — Mod Matrix / Release Triggers / Round-Robin**: cubre enrutado de CC1/Expresión/Aftertouch y triggers key-off. Extender su alcance con los bindings de transporte (play/stop/rec vía nota/CC) evita dos matrices MIDI paralelas.
- **Fase 16.1 (COMPLETADA) — `normalizeChannels` en `RawSamplerExporter`**: el primitivo DSP de normalización de pico (0 dBFS / −0.3 dBFS True-Peak) ya existe; solo hay que exponerlo como herramienta de edición (ver 34.5).
- **Fase 33 (COMPLETADA) — Capa de abstracción universal (`MidiTranslationEngine` + diccionario de parámetros)**: es el patrón a seguir para los modelos de grabación/transporte en `ABDShared/Contracts` (ver 34.4).

### 34.3 Huecos NO previstos: captura + transporte + entrada MIDI viva
- **Sin captura**: cero `getUserMedia` / `MediaRecorder` / `MediaStreamAudioSource` en `src`. Crear `AudioCaptureService` (`src/core/`): selector de dispositivo, `getUserMedia` → `MediaStreamAudioSourceNode`, grabación (MediaRecorder para takes largos o `AudioWorklet` con buffer circular para edición precisa) + `AnalyserNode` en paralelo para monitorización sin latencia.
- **Transporte a medias**: `AudioPreviewService` (`src/core/audioPreview.ts`) tiene play/stop de audición con `playbackRate`, pero **sin pausa, sin FF/RW, sin seek**. Crear `TransportService` con tracking de offset (pausa = stop + guardar offset; FF/RW = salto ±N s o jog por `playbackRate` temporal).
- **Sin MIDI en vivo**: no hay `requestMIDIAccess` en ningún sitio; hoy no entra MIDI en la web. Crear capa de entrada Web MIDI. `midiLearnStore.js` (ABDShared) solo modela `CC / NRPN / AFTERTOUCH / PITCH_BEND` (con curva, macros N:M y export JSON) — **sin NOTE, sin SysEx, sin MMC**. Las mesas (Mackie/HUI/genéricas) mandan transporte como Note/CC/Pitch Bend (encajarían añadiendo tipo `NOTE`), pero **MMC es SysEx universal (`F0 7F …`)** y exige un tipo nuevo `SYSEX_TRANSPORT` con matcher por plantilla de bytes; los mapeos de transporte evalúan a eventos discretos, no a 0..1 (extender `evaluateMidiMapping` + `formatMidiSourceBadge`).

### 34.4 Capa de abstracción de formatos/modelos en ABDShared (análoga a CC/NRPN)
- `RecordingSession` (dispositivo, formato, takes, clasificación chromatic/drums, `noiseProfile` de Fase 30) y `TransportBinding` (play/pause/stop/ff/rw/record ← fuente MIDI) como Contracts versionados, con conversores bidireccionales al estilo `sessionToUniversalSamplerInstrument()` (Fase 33.3).
- La utilidad vive en la app (`AudioRecorderModal`, `AudioCaptureService`, `TransportService`, `MidiTransportService`); los modelos y los tipos de fuente MIDI (`NOTE`, `SYSEX_TRANSPORT`) viven en `ABDShared`, igual que hoy CC/NRPN.

### 34.5 Editor: solo falta el normalizador dedicado
- `detectSilenceRanges()` (energía RMS + histéresis hangover) va en la **Fase 30 adelantada**, no aquí.
- Crear `normalizePeak/RMS + DC-blocker` en `LoopEditorTools.ts` reutilizando `normalizeChannels` de Fase 16 como núcleo, con preview no destructivo y deshacer (coherente con Fase 5 Undo/Redo).

### 34.6 Fases de implementación sugeridas
1. **Captura + monitor + transporte local** (sin MIDI): `AudioCaptureService`, `TransportService`, modal con `VuMeter`.
2. **Adelantar Fase 30** (DSP puro, testeable con vitest: tono + ruido a SNR conocida, hum 50 Hz, silencios con cola).
3. **Normalizador + router chromatic/drums** + cableado enhance→slicer→chopper→zonas.
4. **MIDI en vivo**: Web MIDI input + `NOTE`/`SYSEX_TRANSPORT` en `midiLearnStore` + bindings de mesa; modelos en `ABDShared`.

### 34.7 Adelanto ejecutado 2026-11-02 (base compartida en ABDShared)
- **DSP portable** `Code/DspCore/TakeDsp/takeDsp.ts` (cero deps, sin DOM): `normalizePeak` / `normalizeRms` (con tope `maxGainDb`) / `dcBlock` / `detectSilenceRanges` (RMS + hangover) / `trimSilence` / `computeNoiseProfile` (nivel + bandas log + hum 50/60 Hz) / `classifyTake` (router chromatic/drums). Export `@abdsynths/shared/dsp/take`. Cubre 34.5 y el núcleo portable de la Fase 30 (falta solo la validación metrológica con SNR conocida y la reducción IA, que siguen en Fase 30).
- **Contratos** `Contracts/recordingSession.ts` + `recording_session.schema.json` (patrón `MidiTranslationEngine`): `RecordingSession` / `RecordingTake` / `TransportBinding` / `TakeNoiseProfile`, versión `1.0.0`, factories + `isTransportAction`. Cubre 34.4 (modelos).
- **MIDI transporte** en `midiLearnStore.js`: `NOTE` (4) + `SYSEX_TRANSPORT` (5), `MMC_COMMAND_NAMES`, `parseMmcCommand()` (SysEx universal `F0 7F … 06 cmd F7`), `isDiscreteTriggerSourceType()`, badges `NOTE n` / `MMC PLAY…`; drawer con opciones Note + MMC Transport. Cubre la mitad Shared de 34.3 (falta el input Web MIDI vivo en la app).
- **Queda en la app** (no portable): `AudioCaptureService` (`getUserMedia`), `TransportService` (pausa/seek), `AudioRecorderModal`, capa Web MIDI input (`requestMIDIAccess` → `parseMmcCommand` → `handleIncomingMidi`), y cableado enhance→slicer→chopper→zonas.
- **IA a Shared (estudio, no movido)**: `WebNeuralEngine` solo depende de `DspMath` → portable tal cual como abstracción de provider (WebGPU/WASM/DSP); el núcleo YIN/descriptores/clasificador de `AcousticIntelligence.ts` es portable tras desacoplar imports de app (`Sf2Parser`, `GridIndicator`, `SpectralAnalyzer`, `ZoneRibbon` en el slicer). Migración propuesta: extraer a `Code/DspCore/NeuronAnalysis/takeClassification.ts` con re-export fino en la app, mismo patrón que `LayerClustering.ts`. `AudioSlicerEngine`/`MasterWaveEnhancer` no son portables hoy (dependen de UI/decoders de app).
- **Núcleo grabador en Shared (2026-11-02, decisión)**: el grabador NO se porta entero. `Code/DspCore/TakeDsp/recordingEngine.ts` implementa el núcleo portable (máquina de estados idle→monitoring→recording⇄paused, `pushSamples()`, medidores, `stopRecording()` con trim + pico + `TakeNoiseProfile` + clasificación opcional + WAV 16-bit, `handleTransportAction()` donde ff/rw devuelven `false`) sobre la interfaz inyectada `AudioInputSource` (patrón `WebNeuralEngine`). La captura (`getUserMedia`/JUCE) y el modal quedan en cada app. 9 tests nuevos.
- **Verificación**: `ABDShared` vitest 36 ficheros, 553 passed + 22 nuevos (takeDsp 8, midiTransport 5, recordingEngine 9), 1 skipped; `vendor:sync` ampliado con `DspCore/TakeDsp`; NeuModMakr 22/23 (fallo único `phase16_raw_export`: tag `<multisample name=…>` de Fase 32.3 vs aserción exacta del test — ajeno a esta tarea, pendiente del workstream 32.x).

### 34.8 Cierre de Grabador, Selección de Huella de Ruido y Limpieza DSP/IA (2026-11-03) [COMPLETADA]
- [x] **Decaimiento balístico de vúmetros (`recordingEngine.ts`)**: corrección de picos L/R congelados aplicando decaimiento balístico (`0.85` por bloque) en `pushSamples()` y extracción automática de descriptores acústicos (`extractTakeFeatures`: autocorrelación normalizada para `harmonicity01`/`f0Confidence01`, factor de cresta 10 ms para `transientDensity01` y ZCR + planitud geométrica/aritmética por bandas para `spectralFlatness01`) con `autoClassify` al detener la grabación.
- [x] **Perfilado inteligente de ruido en `stopRecording()`**: selección automática del segmento de silencio detectado más largo (`detectSilenceRanges`) antes del recorte para calcular `TakeNoiseProfile`, evitando contaminar la huella de ruido cuando el intérprete toca desde el instante $t=0$.
- [x] **Visor interactivo de forma de onda y selección manual de zona de ruido (`AudioRecorderModal.ts`)**:
  - Canvas `#rec-wave-canvas` con renderizado de picos min/max, sombreado automático de zonas de silencio detectadas y selección arrastrable con ratón (`[selectionStartFrame, selectionEndFrame]`) para acotar una región específica de ruido o editar la toma.
  - Botón **`Capture Noise Print`** sobre la región seleccionada (o auto-detectada) con badge diagnóstico en tiempo real (`Noise: -XX.X dBFS`, alerta de hum 50/60 Hz y sugerencia automática de limpieza).
- [x] **Cadena de limpieza DSP e IA condicionada por Noise Print**:
  - **`Trim Silence`**: recorte de silencios iniciales/finales con ajuste a cruce por cero.
  - **`DSP Denoise`**: sustracción espectral con puerta suave por bandas logarítmicas + filtro notch biquad adaptativo a 50/60 Hz (`NoiseReductionDsp.ts`, umbral calibrado a `levelDbfs - 3 dB`, $Q=8$).
  - **`Norm -1 dB + DC`**: eliminación de offset DC (`dcBlock`) + normalización de pico a $-1.0\text{ dBFS}$.
  - **`AI Enhance (Clean Noise)`**: envío de la toma junto con la huella de ruido capturada (`X-Noise-Profile` serializado en cabecera HTTP) a `bridgeClient.enhanceAudio` (96 kHz + pre-limpieza de la huella seleccionada), con fallback determinista local (`applyNoiseReductionDsp` + `MasterWaveEnhancer`) si el Bridge está offline.
  - **Pila `Undo` no destructiva por toma** e inyección directa tanto a `AudioChopperModal` como a la zona activa de la sesión (`onInjectTakeIntoSession`).
- [x] **Tests**: `tests/phase34_audio_recorder.test.ts` añadido a `tests/run_all.ts` y `ABDShared/tests/takeDsp.test.js` + `recordingEngine.test.js` ampliados (19/19 en verde).

---

## Fase 35 — Recorrido de Músico: de Audio a Instrumento (Revisión UX y Asistente Guiado) [COMPLETADA]

**Origen**: revisión de flujos de ingesta/procesado/exportación del 2026-11-03 desde el punto de vista de un músico (no ingeniero). Historia pretendida: "tengo un audio → la app lo entiende → me pide permiso solo para adaptar → lo corto y mapeo → suena en AxionikVS". Infraestructura conseguida ~70 %; narración pendiente. Regla de la fase: **cero DSP nuevo** — solo reordenar UI, fijar defaults y renombrar. Cada paso deja la app mejor aunque el siguiente no llegue nunca.

### 35.0 Paso 0 — Decisión del triaje (previo a todo)
- **En sencillo**: la Fase 29 prometió que al soltar una carpeta o ZIP con contenido mixto (audios + bancos + slices mezclados) aparece una pantalla intermedia que pregunta "he encontrado esto, ¿qué hago con cada cosa?". Esa pantalla se programó (`src/ui/MultiAssetTriageModal.ts`, 319 líneas) pero **nunca se conectó**: nada la abre (cero referencias en `src`). Hoy el contenido mixto no tiene puerta.
- **Lo que debía hacer**: listar lo descubierto, dejar incluir/excluir cada archivo y encaminar cada uno a su importador (audio→zonas/chopper, banco→modelos, slices→chopper con cortes precargados).
- **Opción A) Conectar**: cablearla en la ruta de descubrimiento de Universal Import / ZIP-como-carpeta. Implica revisar su diseño contra el pipeline actual, testearla y mantener una pantalla más. Beneficio: el flujo de packs de samples (que SON carpetas mixtas) funciona como se prometió.
- **Opción B) Eliminar**: borrar el fichero y retirar la promesa de la Fase 29. Implica que lo mixto sigue con el comportamiento actual (auto-encaminado sin elegir por archivo). Menos código, promesa retirada formalmente.
- **No hacer nada no es opción**: el código muerto se pudre (los imports derivan y deja de compilar en silencio), el roadmap miente y el asistente (35.5) no puede apoyarse en él.
- [x] Decisión del usuario (2026-11-03): **A) Conectar**, para carpeta y para zip (zip = carpeta). Implementado:
  - `src/app/triageGate.ts` (nuevo, puro y testeable): VFS sin copia sobre el contenido expandido, `shouldOpenTriageGate` (≥2 entidades y ≥2 formatos), resolución primario+compañeros sin duplicados, partición a batch (packs audio + SF2 autocontenido; resto se deriva a Universal Import con aviso).
  - Puerta en `importMixedFilesOrZip` (multi-archivo y zip), en `importFromWebkitFileList` (`<input webkitdirectory>`) y en `importFromDirectoryHandle` (`showDirectoryPicker`): el contenido genuinamente mixto abre `MultiAssetTriageModal`; los flujos de un solo formato conservan su vía rápida (SF2, modelo, audio puro).
  - `Load Single`: audio entra directo a sesión; SF2 se comporta como si se soltara ese archivo; `.sfz` carga directamente en sesión con sus audios compañeros resueltos; definiciones universales (`.dspreset`, `.exs`, `.xpm`, `.adv`, `.vstpreset`, `.multisample`, `.talsmpl`, `.txprog`, `.kmp`, `.dls`, `.nki`, `.rx2`) se parsean e inyectan directamente en la sesión (`parseTriageDefinitionItem`).
  - `Process Selected`: packs audio → `extractFolderFilesToCandidates`, SF2 → `extractSf2PresetsToCandidates`, y definiciones `.sfz` / `.dspreset` / samplers universales con audio compañero → `extractTriageDefinitionCandidates`, todo a `batchModal.loadCandidates` (`onOpenBatchProcessorWithCandidates`); solo lo genuinamente no parseable (p. ej. monolitos cifrados o definiciones sin muestras) se lista como omitido con aviso.
  - `MultiAssetTriageModal`: focus-trap + Escape como el resto de modales (era el único sin él).
  - Tests `tests/phase35_triage_gate.test.ts` (5/5 en verde; fase 29 sigue 33/33; `tsc` sin errores en `src/`).
  - Estandarización gráfica (2026-11-03, con el sistema de la suite de laboratorios): la triage adopta ventana 1100px/95%/92vh, cabecera `.nmm-modal-header` (icono + título humano + badge de formatos + cierre), 4 niveles (resumen → búsqueda/selección con `.val-pill` → tabla con scroll 200px → pie con Cerrar + Procesar), botones `btn-sm`, badges compartidos y cero colores literales (ya fusionado en `src/style.css`; pie canónico global). Título humano, sin coletilla de fase. `MultiInstrumentModal` convergida al mismo kit (ventana L 820px, resumen + búsqueda + tabla + pie compartidos, focus-trap + Escape/clic-fuera; su listener manual de Escape, con fuga, eliminado). Esqueleto canónico DRY en `style.css`: tallas XL/L/M, pie, `.modal-icon` y `.nmm-dropzone` unificada (Batch + Universal Import). Chopper/Loop sin inline (`.is-hidden-file`/`.is-hidden`).

### 35.1 Bancos Hartmann/Neuronik como un formato más — Implementado
- Los bancos legacy entran por **Importar**, no por el Bank Browser. El Browser organiza lo propio; no es puerta de entrada.
- [x] Añadir el banco a la lista de formatos de Universal Smart Import (detección por firma `csAN`/`psAN`/`MapVersionMajor`/`MName` y extensión `.model`/`.neuronikmodel`/`.nmmodel`/`.scape`/`.sphere`/`.zip` en `src/core/import/neuronBankImporter.ts` y chip de formatos en `UniversalImportModal.ts`).
- [x] Parser de banco como contenedor (igual que SF2: listar múltiples modelos en `NeuronDB` `.zip` mediante `listNeuronBankModels` → abrir `MultiInstrumentModal` → extraer modelo → zonas y WAVs resintetizados o de Cápsula del Tiempo con `parseNeuronBankOrModelToPreset`).
- [x] Adaptaciones de preflight del banco (nombres a 11 caracteres `INFO_CLASSIC_NAME_11_CHARS`, proyección de capas de velocidad a 2 y sugerencia de modo Extended) usando la puerta común de 35.3 (`fromImportPreflightReport` + `renderCommonPreflightGate`).
- [x] Decidir en la revisión del Bank Browser (`BankDrawer.ts`): solo gestiona y organiza modelos/sublibrerías generados o enlazados (`Refresh / Folder / Clear`), no importa archivos sueltos.

### 35.2 Exportar por destino (empezar aquí: lo más barato) — Implementado
- [x] Una pantalla con tarjetas de destino ("Para tocar en AxionikVS → Cápsula del Tiempo", "Para otros samplers → Kontakt/Decent/SFZ…", "Solo audio → WAV/AIFF") que llaman a los exportadores existentes (`onExportModel`, `exportSampler`, `exportZoneAiff`). Ningún exportador se reescribe. (`src/app/exportDestinations.ts`, `src/ui/ExportDestinationModal.ts` con esqueleto canónico DRY `nmm-modal-window nmm-modal-l` y accesos desde `File → Export Instrument (Choose Destination)...` `Ctrl+Shift+X`, `ProcessPanel` y `ProcessModal` al terminar el procesado).
- [x] Renombrar "Export ZIP" a su nombre real: la Cápsula del Tiempo debe aparecer con su nombre (`Export Time Capsule (.zip)...` en menú `File`, botón `Time Capsule` en tarjetas de `BankDrawer`, prompts y logs de `menuActions.ts`).

### 35.3 Idioma + puerta de preflight común — Implementado
- [x] Renombrar con el término técnico como subtítulo: "Revisión antes de importar" (Preflight), "Huella de ruido de esta grabación" (Noise Print), "Ajustar cortes al cruce por cero" (zc-snap), "Reconstructor de agudos" (BWE) (`MUSICIAN_TERMS` en `src/ui/preflightGateView.ts`, conectado en `UniversalImportModal`, `RawSamplerExportModal`, `BatchProcessorModal`, `AudioRecorderModal`, `AudioChopperModal`, `LoopEditorModal`, `SettingsModal`).
- [x] Unificar los tres preflights (importación, lote, exportación) en un único componente visual: qué voy a cambiar + [Continuar] [Ajustar]. La lógica ya existe (`importPreflight`, preflight de batch, `rawSamplerPreflight`) (`fromImportPreflightReport`, `fromBatchPreflightSummary`, `fromRawSamplerPreflightReport` + `renderCommonPreflightGate` en `src/ui/preflightGateView.ts`, verificado en `tests/phase35_preflight_gate.test.ts`).

### 35.4 Honestidad IA — Implementado
- [x] Indicador único de estado (`local / bridge / nube / sin conexión`) unificado en `resolveAiSystemStatus` (`src/core/ai/aiHonesty.ts`) y conectado en `Navbar.ts` (`#hud-ai-pill` / `#hud-ai-text` pasando `localProvider: webNeuralEngine.getDeviceStatus().activeProvider`) y `ProcessPanel.ts` (`#hud-card-ai` y rail colapsado).
- [x] Cada botón IA declara motor principal y alternativa determinista antes de actuar (`resolveAiActionDeclaration`), y pide confirmación explícita (`confirmDialog`) cuando el motor primario no está disponible — cero fallbacks silenciosos en `AudioRecorderModal.ts` (`BWE`), `AudioChopperModal.ts` (`BWE`, `Whisper-tiny`, `HTDemucs` con alternativa `separateStemsDspFallback`) y `AiCoverGeneratorModal.ts` (`Generate Artwork` y `Enhance Prompt`).

### 35.5 Asistente guiado (el grande, para el final) — Implementado
- [x] Modal nuevo en 4 pasos copiando el patrón `BatchModalStep` (descubrir → revisar → ejecutar → informe): 1 Material (Grabar / Importar) → 2 Limpiar → 3 Cortar y mapear ("¿batería o melodía?" con "detectar solo" por defecto vía clasificador cat-0..9) → 4 Generar y exportar (ProcessPanel simplificado + pantalla de 35.2). Los modales actuales pasan a "taller avanzado" (`src/core/wizard/musicianWizard.ts`, `src/ui/MusicianWizardModal.ts`, accesible desde `ProcessPanel`, `File` / `Model → Asistente Guiado de Músico (4 Pasos)...` y `Ctrl+Shift+W`).
- [x] Defaults de músico: trim con zero-cross activado (`trimSilence: true`, `snapZeroCrossing: true`), 2 capas en classic (`classicTwoVelocityLayers: true`), consentimiento siempre (`requireAiFallbackConsent: true`), y vía rápida directa al Paso 4 cuando el material del Paso 1 es un banco multipista ya mapeado. Verificado en `tests/phase35_musician_wizard.test.ts` (4/4).

### 35.6 Puentes de rescate cuando se carga un WAV multi-nota en un slot de zona (`ZoneInspector`) — Implementado
**Escenario**: El usuario carga un `.wav` directamente en el primer slot de zona (`sampleLow` / `sampleHigh` en `ZoneInspector`) y, al escucharlo, se da cuenta de que no es una nota suelta sino una grabación con **varias notas seguidas**.

- [x] **1. Botón directo en la tarjeta de muestra (`#btn-sample-card-wizard`, `"Limpiar y mapear"`)**:
  - Añadido en la cabecera de `#card-sample-low` (`src/ui/ZoneInspector.ts`, tanto en modo Classic como Extended).
  - Llama a `MusicianWizardModal.openWithZoneSample(zoneId, 'low', regionId)` (`src/ui/MusicianWizardModal.ts`), decodificando el `AudioBuffer` ya cargado en la ranura e inyectándolo directamente en el **Paso 2 (`Limpiar`) del Asistente Guiado** sin obligar a reimportar desde disco.
- [x] **2. AutoLoop en lote para todas las zonas (`#btn-autoloop-all-zones`, `"AutoLoop en todas las zonas"`)**:
  - Añadido en la barra de la tabla de zonas de `ZoneInspector.ts` (modos Classic y Extended).
  - Ejecuta `computeBatchAutoLoopForZones` (`src/core/dsp/LoopEditorTools.ts`), aplicando `findOptimalZeroCrossingLoop` (`zc-snap`) + análisis de costura (`computeLoopSeamAnalysis`) sobre la porción estacionaria de cada zona/región con audio y guardando todos los puntos de bucle en una sola acción.
- [x] **3. Re-exposición de promoción a Master Wave (`24-bit / 96 kHz`) en el cajón del inspector**:
  - Re-expuestos en el HTML de `renderDrawer()` (`src/ui/ZoneInspector.ts`) los botones `#btn-promote-zone-mw-reg` (Extended), `#btn-promote-zone-mw` (Classic) y `#btn-promote-all-mw` (`"Todas a 24-bit / 96 kHz"`), reconectando los listeners ya existentes con `MasterWaveEnhancer.ts` (exclusivamente en `ZoneInspector.ts`, sin duplicarlos en el Asistente).
- [x] **4. Reconciliación automática o con confirmación de cortes en `AudioChopperModal.ts` tras limpiar audio**:
  - Añadido `reconcileSlicesAfterAudioClean` (`src/ui/AudioChopperModal.ts`): cuando el usuario ejecuta `DSP Denoise` (`#btn-chopper-dsp-denoise`) o `AI Enhance (BWE)` (`#btn-chopper-ai-enhance`) *después* de haber calculado cortes:
    - Si los cortes eran automáticos (`!hasManualCuts()`), recalcula automáticamente `recomputeSlices(true)` sobre el audio recién limpio.
    - Si el usuario había editado cortes manualmente (`hasManualCuts()`), reescala los frames si cambió el `sampleRate` (p. ej. BWE a `96 kHz`) y pregunta con `confirmDialog` (*"La limpieza cambió el audio — ¿Recalcular cortes?"*) salvo que `manualCutsPolicy` ya esté fijada.

**Resumen de la tubería ideal de rescate desde el Slot #1**:
$$\text{WAV en Slot \#1} \xrightarrow{\text{1. Toma completa}} \mathbf{Limpiar\ (Noise\ Print + DC)} \xrightarrow{\text{2. Trocear y } F_0} \mathbf{Partir\ y\ Remapear\ (N\ zonas)} \xrightarrow{\text{3. Por cada zona}} \mathbf{AutoLoop + Master\ Wave\ (24\text{-}bit / 96\text{ kHz})}$$

### Orden de ejecución
35.0 → 35.2 → 35.3 → 35.4 → 35.1 (puede ir en paralelo a 35.2–35.4) → 35.5 → 35.6 (implementado).

---

## Fase 36 — Internacionalización (i18n) en `@abdsynths/shared` (`ABDShared`) y `ABDNeuModMakr` [COMPLETADA 100%]

**Objetivo**: Dotar a la aplicación y a la librería compartida `ABDShared` de un sistema de internacionalización (i18n) ligero, tipado y sin dependencias pesadas (por defecto `en` / `es`, extensible a más idiomas), unificando los textos hoy mezclados entre inglés y español.

### 36.1 Parte en `@abdsynths/shared` (`ABDShared`)
- [x] **Contrato y runtime ligero de `i18n` en `ABDShared`**:
  - Módulo compartido (`@abdsynths/shared/i18n`) con selector de locale activo (`getLocale`, `setLocale`, `onLocaleChange`), persistencia en `localStorage` (`abdsynths.locale` + `abd_locale`), detección de `navigator.language` y función `t(key, params?)` con fallback seguro a inglés/clave base.
  - Iconos vectoriales de banderas (`flag-es.svg`, `flag-en.svg`, `FLAG_ICONS` y `CONTROL_ICONS.flagEs`/`flagEn`) incorporados en `@abdsynths/shared/components` (`ABDShared/Assets/icons` y `ABDShared/Components/icons.js`).
- [x] **Internacionalización de componentes UI compartidos en `ABDShared/Components/`**:
  - `SynthNavBar` (menús bilingües `DEFAULT_NAVBAR_MENUS`, `getDefaultNavbarMenus(locale)`, `setLocale`, atajos y diálogos estándar).
  - `AboutDialog` (`createAboutDialog`: cabeceras de versión, compilación, estado de actualización y botones bilingües `EN` / `ES` reactivos a `abd:locale-change`).
  - `bank/bankShell.js`, `bank/bankCard.js`, `bank/bankChips.js`, `bank/bankCategories.js` (`BANK_CATEGORY_LABELS`, `getBankCategoryLabel(paramId, locale)`, `setFooterActionLabels`, `SHARED_EN.bank` / `SHARED_ES.bank`).
- [x] **Textos en español e inglés bilingües en `ABDShared` sincronizados con `vendor:sync`**:
  - `Code/SamplerFormats/rawSamplerPreflight.ts`:
    - `SAMPLER_FORMAT_METADATA` y `getSamplerFormatMetadata(format, locale?)`: descripciones bilingües (`descriptionEs` / `descriptionEn` + getter dinámico `description` según locale activo via `resolveSharedLocale`) de los 42 formatos de sampler.
    - `analyzeRawSamplerPreflight(session, options, sampleBufferProvider, locale?)`: títulos, `description` y `adaptation` bilingües (`es` / `en`) de todos los avisos de preflight de exportación (`missing-audio-buffers`, `sf2-bitdepth-clamp`, `export-pcm16-requested`, `sample-rate-resample`, `sample-chain-mixed-rates`, `multichannel-adaptation`, `sf2-pingpong-adaptation`, `mpc-4layer-spill`, `loop-crossfade-limitation`, `loop-bounds-clamped`, `envelope-dahdsr-adaptation`, `keybed-partial-coverage`).
  - `Code/DspCore/TakeDsp/autoSamplerDsp.ts` (Fase 37):
    - `analyzePilotNoteResponse`: resumen diagnóstico bilingüe `rationaleEs`, `rationaleEn` y `rationale` según locale activo, conectado con `AudioRecorderModal.ts`.

### 36.2 Parte en `ABDNeuModMakr` e Inventario Exhaustivo (`DOCS/I18N_STRING_INVENTORY.md`)
- [x] **Inventario automatizado completado (`DOCS/I18N_STRING_INVENTORY.md` + `scripts/i18n-inventory.mjs`)**:
  - **Alcance medido**: **1639 cadenas únicas en 116 ficheros de `src/`** (con `scripts/i18n-inventory.mjs` como regenerador referenciado al pie del documento).
  - **Estructura de cada entrada**: cadena actual (conservando `${...}` tal cual para marcar interpolaciones a parametrizar), idioma detectado (heurística documentada en cabecera), fichero y líneas (repeticiones idénticas fusionadas) y contexto (`toast`, `confirmDialog`, `html`, `attr:title/aria-label/placeholder/alt`, `textContent`, `prop:...`), más resúmenes por idioma/contexto/fichero.
  - **Datos clave para la implementación de Fase 36**:
    1. **Idioma base heterogéneo**: Inglés **1066**, Español **80**, Mixto **39**, Técnico/sin marcas **273**, Sin determinar **181**. Los menús y ajustes están en inglés (`"New Session (Reset)"`, `"Save..."`), mientras que los flujos de músico (wizard, autosampler, preflight) están en español $\rightarrow$ decidir locale base único o normalizar antes de extraer claves.
    2. **Interpolaciones y formato numérico (233 cadenas)**: contienen `${...}`, `.toFixed(...)` y unidades (`ms`, `dBFS`, `smp`) $\rightarrow$ requerirán formato tipo ICU con parámetros con nombre y formateo numérico por locale, no simple sustitución literal.
    3. **Cadenas mixtas y marcas fijas (39 cadenas)**: casi todas combinan marcas registradas + español (ej. `"Google Gemini API Key verificada correctamente"`) $\rightarrow$ las marcas no se traducen y las claves deben delimitar qué segmentos son invariables.
    4. **Dos semillas ya disponibles en el repositorio**:
       - El glosario `MUSICIAN_TERMS` (`src/ui/preflightGateView.ts:28`, usado en 8 ficheros) como primer catálogo de claves semánticas.
       - La infraestructura i18n compartida en `vendor/.../Components/I18n/i18n.js` como base de runtime a validar/evolucionar.
    5. **Limitaciones conocidas del extractor heurístico**: filtra código (`Promise<void>`, ternarias, hex, comentarios), pero las cadenas construidas por concatenación dinámica o interpolaciones puras (`${...}` de variables o `MUSICIAN_TERMS`) quedan en la categoría *sin determinar* y se revisarán al extraer claves.
- [x] **Selector de idioma con Banderas SVG en la Cabecera (`#nav-btn-lang`), Menú `View -> Language / Idioma`, `SettingsModal.ts` (`src/ui/settings/tabGeneral.ts`) y `ABDShared` (`src/core/i18n.ts`)**:
  - Puente `src/core/i18n.ts` (`getAppLocale`, `setAppLocale`, `onAppLocaleChange`, `tApp`, `isEs`) conectado a `createSynthI18n` (`@abdsynths/shared/i18n`) con persistencia sincronizada en `localStorage` (`abdsynths.locale`, `abd_locale`, `neumodmakr.locale`), actualización reactiva de `<html lang="...">` y evento global `abd:locale-change`.
  - Iconos vectoriales de banderas (`flag-es.svg`, `flag-en.svg`, `FLAG_ICONS` y `CONTROL_ICONS.flagEs`/`flagEn`) incorporados en `@abdsynths/shared` (`ABDShared/Assets/icons` y `ABDShared/Components/icons.js`) y en `src/ui/icons.ts` (`ICONS.flagEs`, `ICONS.flagEn`).
  - Botón conmutador de bandera (`#nav-btn-lang`) en la cabecera superior (`Navbar.ts`) junto a los iconos de tema (`#nav-btn-theme-mode` y `#nav-btn-theme`), submenú **`View -> Language / Idioma`** con banderas y marca activa (`✓`), y selector en píldoras **`Español (ES)` / `English (EN)`** (`#btn-set-lang-es`, `#btn-set-lang-en`) en `Settings -> General` (`src/ui/settings/tabGeneral.ts`).
- [x] **Internacionalización Reactiva Completa en 3 Capas en `ABDNeuModMakr` (ES $\leftrightarrow$ EN sin recargar página)**:
  - **Capa 1 — Shell Principal y Espacio de Trabajo**: `src/core/i18n.ts`, `src/core/ai/honesty/status.ts`, `Navbar.ts`, `ProcessPanel.ts`, `ZoneRibbon.ts`, `KeyboardStrip.ts`, `ZoneInspector.ts`, `src/ui/zoneInspector/tableRenderOps.ts`, `SpectralView.ts`, `BankDrawer.ts` y `TelemetryDrawer.ts`.
  - **Capa 2 — Ajustes, Configuración del Modelo y Cajón de Metadatos de Zona**: `SettingsModal.ts` (`src/ui/settings/tabGeneral.ts`, `tabWeb.ts`, `tabCloud.ts`, `tabBridge.ts`, `bridgeModels.ts`, `webPresets.ts`), `ModelConfigModal.ts` (`src/ui/modelConfig/tabGeneral.ts`, `tabArticulation.ts`, `tabMetadata.ts`, `tabArtwork.ts`) y `src/ui/zoneInspector/drawerRenderOps.ts`.
  - **Capa 3 — Modales Interactivos, Asistentes, Importación/Exportación y Talleres de Audio**: `exportDestinations.ts`, `ExportDestinationModal.ts`, `RawSamplerExportModal.ts`, `preflightGateView.ts` (`MUSICIAN_TERMS` dinámico), `ConfigHealthModal.ts`, `LoadingModal.ts`, `ProcessModal.ts`, `UniversalImportModal.ts`, `MultiAssetTriageModal.ts`, `MultiInstrumentModal.ts`, `NeuronDbModal.ts`, `AiCoverGeneratorModal.ts`, `MusicianWizardModal.ts`, `BatchProcessorModal.ts`, `LoopEditorModal.ts`, `AudioChopperModal.ts`, `src/ui/chopper/renderOps.ts` y `AudioRecorderModal.ts`.
- [x] **Puntos destacados en español/inglés unificados por subsistema**:
  1. `src/ui/preflightGateView.ts`:
     - Diccionario `MUSICIAN_TERMS` (`Revisión antes de importar (Preflight)`, `Revisión antes de procesar el lote (Preflight)`, `Revisión antes de exportar (Preflight)`, `Huella de ruido de esta grabación (Noise Print)`, `Ajustar cortes al cruce por cero (zc-snap)`, `Reconstructor de agudos (BWE)`).
     - Textos de `fromImportPreflightReport`, `fromRawSamplerPreflightReport`, `fromBatchPreflightSummary` y `renderCommonPreflightGate` (`"Qué voy a cambiar"`, `"Compatible al 100 %..."`, `"Listo para importar con adaptaciones automáticas"`, tarjetas de cambios y etiquetas de botones `Ajustar` / `Continuar`).
  2. `src/app/exportDestinations.ts` y `src/ui/ExportDestinationModal.ts`:
     - Constante `TIME_CAPSULE_ES_LABEL` (`Cápsula del Tiempo (.zip)`).
     - Tarjetas de destino (`"Para tocar en AxionikVS"`, `"Para otros samplers"`, `"Solo audio"`, subtítulos, descripciones, badges y `actionLabel`).
     - Cabecera, resumen de sesión, nota informativa y botones del pie (`Cerrar`, `Continuar`).
  3. `src/ui/UniversalImportModal.ts`:
     - Badge de cabecera (`IMPORTADOR UNIVERSAL`), estado de inspección (`Analizando estructura del banco y muestras de audio...`), título `"Ajustes de adaptación al importar"` y botones del pie (`Ajustar / Elegir otro archivo`, `Continuar e importar`).
  4. `src/ui/RawSamplerExportModal.ts`:
     - Cabecera (`Exportar Instrumento a Formato Sampler`), subtítulos de parámetros de audio (`Resolución (Bit Depth)`, `Frecuencia de Muestreo`, `Normalización de Pico`, `Disposición de Archivos`, `Autor / Creador`, `Licencia`) y estado de exportación (`Renderizando DSP y empaquetando archivo ZIP...`).
  5. `src/ui/BatchProcessorModal.ts`:
     - Indicador del paso 2 (`2. Revisión antes de procesar (Preflight)`) y botones del pie en preflight.
  6. `src/ui/MultiAssetTriageModal.ts` y `src/ui/MultiInstrumentModal.ts`:
     - Cabeceras (`Selección de archivos del paquete`, `Selección de instrumento del contenedor`), resúmenes, buscadores, cabeceras de tabla (`Incluir`, `Archivo`, `Tipo`, `Tamaño`, `Destino`, `Acción`), badges de tipo, notas al pie y botones (`Todo`, `Nada`, `Solo audio`, `Solo bancos`, `Cargar`, `Enviar al procesador por lotes`).
  7. `src/ui/ConfigHealthModal.ts` y `src/core/configHealth.ts`:
     - Títulos, descripciones, etiquetas de severidad (`Crítico`, `Advertencia`, `Óptimo`), resumen de salud y botones de acción (`Reparar`, `Abrir Ajustes`, `Cerrar`).
  8. `src/ui/AudioRecorderModal.ts`, `src/ui/AudioChopperModal.ts`, `src/ui/LoopEditorModal.ts` y `src/ui/SettingsModal.ts`:
     - Referencias visibles y tooltips de `MUSICIAN_TERMS` (`noisePrint`, `bwe`, `zcSnap`) y subtítulo en Stage 1 de `SettingsModal.ts`.
  9. `src/ui/Navbar.ts`:
     - Línea 413: `title` del botón de modo claro/oscuro (`'Cambiar a Modo Oscuro'` / `'Cambiar a Modo Claro'`).
  10. `src/ui/ProcessPanel.ts`:
     - Línea 492: badge `'IA ACTIVA'` en la tarjeta de estado de IA.
  11. `src/core/ai/WebNeuralEngine.ts`:
     - Líneas 96, 107, 115: `statusMessage` de inicialización (`'[WebGPU] Aceleracion GPU Activa'`, `'[WASM] WebAssembly SIMD Activo'`, `'[DSP] Modo DSP Local'`).
  12. `src/app/menuActions.ts`:
     - Textos del diálogo de confirmación en `checkExportPreflight` (`"El preflight del banco detectó N problema(s)..."`, `"Exportar de todos modos"`, `"Cancelar"`).
  13. `src/core/ai/aiHonesty.ts` y `src/ui/AiCoverGeneratorModal.ts` (Fase 35.4):
     - Textos de estado unificado (`IA: LOCAL / BRIDGE / NUBE / SIN CONEXIÓN`) y diálogos de consentimiento explícito de alternativa (`resolveAiActionDeclaration`).
  14. `src/core/import/importPreflight.ts` y `src/core/import/neuronBankImporter.ts` (Fase 35.1):
     - Aviso `INFO_CLASSIC_NAME_11_CHARS` y etiquetas de contenedor (`Cápsula del Tiempo (.zip)`).
  15. `src/core/wizard/musicianWizard.ts` y `src/ui/MusicianWizardModal.ts` (Fase 35.5):
     - Textos de los 4 pasos del Asistente Guiado (`1. Material`, `2. Limpiar`, `3. Cortar y mapear`, `4. Generar y exportar`), veredictos de clasificación (`Batería / Percusión`, `Melodía / Frase`, `Nota única / Instrumento cromático`) y botones de apertura de talleres avanzados.
  16. `src/ui/ZoneInspector.ts`, `src/ui/AudioChopperModal.ts`, `src/ui/LoopEditorModal.ts` y `src/main.ts` (Fase 35.6 — Puentes de Rescate):
     - `ZoneInspector.ts`: botones de rescate de slot (`Limpiar y mapear (Asistente)`, `AutoLoop en todas las zonas`, `Promover a Master Wave (96k)`).
     - `AudioChopperModal.ts`: diálogo de consentimiento al limpiar con cortes manuales (`"La limpieza modificó el audio, pero habías ajustado puntos de corte manualmente..."`, `"Recalcular cortes"`, `"Conservar mis cortes"`).
     - `LoopEditorModal.ts`: botón `AutoLoop en todas las zonas`.
     - `main.ts`: mensajes toast de `handleBatchAutoLoopAllZones` (`"AutoLoop aplicado en X/Y zona(s) con cruce por cero óptimo."`).
  17. `src/ui/AudioRecorderModal.ts`, `src/core/midi/WebMidiAutoSamplerService.ts` y `src/core/autoSampler/drumMapParser.ts` (Fase 37 — AutoSampler MIDI):
     - `AudioRecorderModal.ts`: píldoras de modo superior (`Grabación Directa de Audio` $\leftrightarrow$ `Direct Audio Recording`, `AutoSampler MIDI (Barrido)` $\leftrightarrow$ `MIDI AutoSampler (Sweep)`, `Teclado MIDI en Vivo` $\leftrightarrow$ `Live MIDI Keyboard`, `Caja de Ritmos (Drum Map)` $\leftrightarrow$ `Drum Machine (Hit Map)`), diálogo y botón de calibración de nota piloto (`Aplicar RTL medida (...) y parámetros sugeridos`, `Conservar solo RTL (...)`, `RTL aplicada: ...`), selector de curvas de velocidad (`Lineal (Equidistante)`, `Logarítmica / Exponencial (+ precisión en altos 85..127)`, `Comprimida (+ precisión en bajos 1..65)`, `Clásica Neuron (2 capas: 60 / 120)`, `Tabla Manual Editable`) y acciones de continuación/rescate (`Continuar desde donde se paró`, `Re-ejecutar Corte + AutoLoop`).
     - `WebMidiAutoSamplerService.ts`: cadenas de estado de `runMidiJitterSmokeTest` (`"Reloj Host (sin MIDI Out conectado)"`, `"Jitter medio ... ms"`).
     - `drumMapParser.ts`: guía técnica embebida `getDrumMapFormatSpecificationHelpText()`.

---

## Fase 37 — AutoSampler MIDI Integrado (Hardware / VST / Teclado en Vivo) con Avance por Silencio, Curvas de Velocidad, Onda en Vivo y Recuperación en `ABDShared` [COMPLETADA]

**Objetivo**: Evolucionar nuestro **Grabador de Audio (`AudioRecorderModal.ts`)**, nuestro **AutoSlicer (`AudioChopperModal.ts` / `AudioSlicerEngine.ts`)** y nuestro **AutoLoop (`LoopEditorTools.ts` / `LoopEditorModal.ts`)** existentes —sin crear pantallas aisladas ni duplicar motores— para ofrecer **dos funciones claras de grabación en el mismo estudio (`Grabación Directa de Audio` vs `Grabación AutoSampler MIDI`)**. Permite muestrear cualquier sintetizador hardware, plugin VST o caja de ritmos tanto mediante **barridos automáticos por WebMIDI** como **tocando libremente un teclado MIDI en vivo**, visualizando la onda desplazarse en tiempo real con zoom constante (sin achatarse), gestionando la cola post-`NoteOff` (por silencio dinámico o tiempo fijo), aplicando curvas o tablas manuales de velocidad, importando mapas de nombres de cajas de ritmos (`.txt`, `.json`, `.yaml`), permitiendo continuar grabaciones interrumpidas o re-parsear tomas ya grabadas, limpiando el ruido sobre la toma continua antes de cortar y calculando `AutoLoop` directamente sobre el tramo sostenido (`NoteOn..NoteOff`).

### 37.0 Estudio de Referencias y Decisiones Arquitectónicas Previas
- **Qué reutilizamos y mejoramos de lo que YA tenemos (Cero Islas)**:
  1. **Grabador (`AudioRecorderModal.ts` + `recordingEngine.ts` en `ABDShared`)**: en lugar de crear un modal aparte, el grabador actual pasa a tener **dos modos de operación en su cabecera** (`1. Grabación Directa de Audio` y `2. Grabación AutoSampler MIDI (Barrido automático | Teclado MIDI en vivo | Caja de Ritmos)`), reutilizando sus vúmetros L/R, selector de tarjeta de sonido, captura de `Noise Print`, botones `DSP Denoise` / `Norm -1 dB + DC` / `AI Enhance` y tabla `SESSION TAKES`.
  2. **Visor de onda y `AutoSlicer` (`AudioChopperModal.ts` + `AudioSlicerEngine.ts`)**: la representación de la onda con sus puntos de corte y regiones es la misma. Cuando una toma viene con `MidiAutoSampleManifest`, el `AutoSlicer` no adivina transitorios ni $F_0$ a ciegas, sino que usa `buildSlicesFromMidiManifest()` con las notas, velocidades, nombres y tiempos exactos grabados, permitiendo abrir la toma en el `AudioChopperModal` para ajustar cualquier marcador con la lupa `±256 smp` y `zc-snap`.
  3. **`AutoLoop` (`LoopEditorTools.ts` + `MasterWaveEnhancer.ts`)**: reutiliza `computeBatchAutoLoopForZones` y `findOptimalZeroCrossingLoop`, mejorándolos para aceptar la ventana `[noteOnFrame .. noteOffFrame]` del manifiesto MIDI y así buscar el bucle estacionario exclusivamente mientras la nota está pulsada (nunca en la cola de release).
- **Inspiración verificada de proyectos Open Source analizados**:
  - **`g-s-k/auto-sampler` (Rust `autosam` / `multirec`)**: separación entre el generador paramétrico de distribuciones (`octava inicial + nº de octavas + notas por octava + capas de velocidad`) y el motor de grabación, produciendo un manifiesto estructurado junto al audio.
  - **`wudpeker/autosimpler` (C++ / JUCE VST3)**: modo de **Captura Pasiva en Vivo (Live MIDI + Audio)** donde el usuario no programa un barrido, sino que toca su teclado MIDI (o lanza un clip desde el DAW) y el grabador empareja cada `[NoteOn .. NoteOff + cola]` con el audio para recortar y mapear las zonas automáticamente.
  - **`shinybit/autosampler2sfz.py`**: nomenclatura canónica de muestras (`<Idx>_<NombreGolpeONota>_<NotaMIDI>_v<Vel>_rr<N>.wav`) e inferencia automática de límites `lowKey..highKey` y `lowVel..highVel` contiguos sin huecos.
  - **`JasonHoku/ComfyUI-Ultimate-Auto-Sampler-Config-Grid-Testing-Suite`**: idea de interfaz de **Matriz X/Y interactiva (`Notas × Velocidades`)** donde cada celda muestra su estado (`Pendiente`, `Grabando`, `OK`, `Clip/Error`), permite audicionar esa nota con 1 clic o re-grabar una única celda sin repetir todo el barrido.
  - **`khiner/AutoSampler` (C++ / JUCE)**: compensación de deriva analógica por nota midiendo $F_0$ real en el tramo sostenido (`detuneCents` en `-50..+50`) y soporte de pedal de sustain (`CC 64`) en captura en vivo.

---

### Subfase 37.1 — Spike 0: Validación de Entrada/Salida WebMIDI (`navigator.requestMIDIAccess`)
- [x] **Servicio ligero `src/core/midi/WebMidiAutoSamplerService.ts`**:
  - Enumeración reactiva de puertos `MIDIOutput` (para disparar notas al sintetizador externo) y `MIDIInput` (para el modo en el que el músico toca su teclado MIDI en vivo) con escucha de `onstatechange` al conectar/desconectar cables USB-MIDI.
  - Prueba verificable (`runMidiJitterSmokeTest`): abrir un puerto `MIDIOutput` / `MIDIInput`, enviar/recibir 3 eventos `NoteOn` / `NoteOff` con marcas de tiempo de alta precisión (`performance.now()` $\leftrightarrow$ `AudioContext.currentTime`) y medir el jitter real antes de construir el secuenciador.

---

### Subfase 37.2 — Núcleo Matemático y Contratos en `@abdsynths/shared` (`ABDShared`) + `npm run vendor:sync`
- [x] **Condición estricta de pureza**:
  - Todo cambio en `@abdsynths/shared` se edita en el repositorio `d:\desarrollos\ABDSynths\ABDShared` y se sincroniza con `npm run vendor:sync` (nunca editando `vendor/` a mano). Solo entran funciones matemáticas puras (`Float32Array` + `sampleRate`), sin acoplos al reloj ni a dispositivos de `ABDAudioLab`.
- [x] **1. Portar desde `ABDAudioLab` a `@abdsynths/shared/dsp/take/autoSamplerDsp.ts`**:
  - **Detector en tiempo real de extinción de cola (`evaluateReleaseTailDecay`, basado en `LabAudioReceiver.cpp:223-249` y `ProfilingSequencer.cpp:668-694`)**:
    - Tras ocurrir `NoteOff` y superarse un tiempo mínimo de gracia (`gracePeriodMs`, ej. `150–250 ms`), analiza bloque a bloque si el nivel pico/RMS cae por debajo del umbral de silencio (`noiseProfile.levelDbfs + marginDb`, o umbral fijo `-60 / -80 dBFS`) durante `sustainedSilenceMs` consecutivos (`50–100 ms`).
    - Devuelve `{ tailFinished: boolean, approxTailEndFrame: number, peakDbfs: number, sustainedClipping: boolean }`.
  - **Medidor de latencia MIDI $\to$ Audio y correlación cruzada FFT (`measureMidiToAudioLatency` / `findSampleAccurateSyncOffset`, basado en `LabAudioReceiver.cpp:180-197` y `336-404`)**:
    - Calcula el retardo exacto en samples (`latencySamples`) entre el envío del `NoteOn` de la nota piloto y el ataque real en el `AudioBuffer` recibido, más detección de saturación sostenida (`> 700 samples` a `0 dBFS`) y sugerencia de ajuste de ganancia (`Auto-Trim` hacia `-3.0 dBFS`).
- [x] **2. Generador de Rejilla de Notas y Curvas/Tablas de Velocidad (`generateSweepSchedule` en `autoSamplerDsp.ts`)**:
  - **Eje de Notas (Teclado)**:
    - Parámetros pensados para músicos: **Octava desde la que se empieza** (`startOctave`, ej. `C0` a `C6`, o nota inicial exacta), **Número de octavas** (`octaveCount`, `1..8`) y **Número de notas por octava** (`notesPerOctave`: `1, 2, 3, 4, 6, 12` $\to$ pasos de `12, 6, 4, 3, 2, 1` semitonos).
    - Calcula automáticamente los límites `lowKey..highKey` centrando cada nota muestreada (`rootKey`) y extendiendo o acotando los extremos según elija el usuario (`0..127` completo o acotado al rango muestreado).
  - **Eje de Velocidades (`computeVelocityLayers`, `1..8` capas + `Round-Robin 1..4`)**:
    - **5 modos de distribución de velocidad**:
      1. **`linear` (Lineal)**: separación equidistante entre `minVel` y `maxVel`.
      2. **`logarithmic` / `high_precision` (Más precisión en números altos)**: concentra más capas en la zona `85..127` (donde los filtros low-pass y saturadores cambian drásticamente el timbre por velocidad).
      3. **`exponential` / `low_precision` (Más precisión en números bajos)**: concentra más capas en la zona `1..65` (ideal para pianos, cuerdas o pads suaves con mucho matiz en *pp/mp*).
      4. **`classic_neuron_2layer` (Clásico Hartmann 2 capas)**: `v1 = 60 (rango 1..63)` y `v2 = 120 (rango 64..127)`.
      5. **`manual_table` (Tabla de velocidades manual)**: el usuario introduce o edita directamente la tabla de velocidades exactas a disparar (ej. `[25, 55, 90, 112, 127]`) y sus rangos `lowVel..highVel`.
- [x] **3. Contrato compartido `MidiAutoSampleManifest` en `ABDShared/Contracts/recordingSession.ts`**:
  - Estructura serializable que viaja siempre unida a la grabación (en memoria en `SessionTake` y persistida dentro del propio `.wav` en un chunk RIFF `atem`/`cue `):
    - Metadatos globales: `mode: 'auto_sweep' | 'live_midi_capture' | 'drum_map'`, `sampleRate`, `latencySamples`, `noiseProfile`, `velocityCurve`, `releaseMode: 'auto_decay' | 'fixed_time'`, `createdAt`.
    - Lista de eventos `MidiCapturedNoteEvent[]`: `{ index, status: 'pending' | 'recording' | 'recorded' | 'failed', midiNote, velocity, velocityLayerIndex, roundRobinIndex, customName?, muteGroup?, lowKey, highKey, lowVel, highVel, noteOnFrame, noteOffFrame, tailEndFrame, loopStartFrame?, loopEndFrame?, isReleaseTrigger?, hasPolyphonicOverlap? }`.

---

### Subfase 37.3 — Importador de Mapas de Cajas de Ritmos (`.txt`, `.json`, `.yaml`) + Especificación Técnica para el Usuario
- [x] **Parser y validador universal `src/core/autoSampler/drumMapParser.ts`**:
  - Acepta archivos **`.txt` (o `.csv`/`.tsv`)**, **`.json`** y **`.yaml` / `.yml`** donde el usuario (o el manual de su caja de ritmos) define qué notas MIDI tienen sonido y cómo se llama cada golpe:
    - **`.txt` sencillo**: líneas `<Nota_MIDI_o_Nombre> : <Nombre_del_Golpe> [: choke=<1..32>] [: gate=<ms>] [: release=<ms>]` (aceptando `:`, `=`, `,` o tabulador como separador y `#` para comentarios).
    - **`.json` estructurado**: `{ name, channel?, defaultVelocities?, hits: [{ note: 36 | "C1", name: "Kick 808", muteGroup?: 1, gateMs?: 400, maxReleaseMs?: 2500, velocities?: [80, 127] }] }`.
    - **`.yaml` humano**: diccionario directo `notes: { 36: "Kick", 38: "Snare", 42: { name: "Closed Hat", muteGroup: 1 } }` o lista de objetos.
  - Incluye **plantillas rápidas preinstaladas**: `General MIDI (GM Standard)`, `Roland TR-808 / TR-909`, `Akai MPC Pads`, `Elektron Digitakt / Syntakt`.
  - Al activar un mapa de caja de ritmos:
    1. El barrido automático **solo dispara las notas listadas en el mapa** (sin perder tiempo en las notas vacías).
    2. Cada corte, zona y archivo WAV recibe el **nombre real del golpe** (`36_Kick_Sub_808.wav`) y su **`muteGroup` (`choke`)** automático (p. ej. el charles cerrado corta al charles abierto).
- [x] **Entrega de la información técnica al usuario dentro de la propia UI y en `DOCS/`**:
  - Botón **`[ ? Especificación de archivo / Descargar plantilla (.txt, .json, .yaml) ]`** integrado en el panel de AutoSampler que abre un cuadro de ayuda claro con ejemplos copiables de los 3 formatos y botones para descargar las plantillas listas para rellenar, además del documento `DOCS/AUTOSAMPLER_DRUM_MAP_SPEC.md`.

---

### Subfase 37.4 — Controlador de Sesión (`MidiAutoSampleSession.ts`) con los 3 Modos de Trabajo y Gestión del Release
- [x] **Módulo puro `src/core/autoSampler/MidiAutoSampleSession.ts` (desacoplado del DOM)**:
  1. **Modo 1 — Grabación Directa de Audio (`Direct Audio Recording`)**:
     - Grabación directa de audio como hasta ahora, pero beneficiándose del nuevo visor de onda en vivo con zoom constante (Subfase 37.5).
  2. **Modo 2 — Barrido Automático MIDI (`Auto-Sweep`)**:
     - Ejecuta automáticamente: **Pre-Roll de `1.0 s` en silencio** (`dcBlock` previo $\to$ captura de `Noise Print` `computeNoiseProfile`) $\to$ **Nota Piloto** (mide `latencySamples` y comprueba ausencia de clipping) $\to$ bucle automático por cada `(nota, velocidad, roundRobin)` del `generateSweepSchedule` o del mapa de batería.
  3. **Modo 3 — Captura en Vivo desde Teclado MIDI (`Live MIDI Capture`, el usuario no decide nada, solo toca)**:
     - El músico pulsa `REC` y toca libremente en su teclado controlador MIDI (o reproduce una pista MIDI desde su DAW):
     - Se captura cada `NoteOn (nota, velocidad, frame)` y `NoteOff (nota, frame)` en paralelo con el audio.
     - **Agrupación e inferencia automática al parar**:
       - Ordena las notas tocadas de grave a agudo y calcula automáticamente las fronteras contiguas `lowKey..highKey` (`0..127`).
       - Si el músico tocó varias veces la misma nota con distinta fuerza, las reparte automáticamente en **capas de velocidad (`lowVel..highVel`)**; si las tocó con velocidad similar, ofrece asignarlas como **Round-Robin (`seqPosition`)** o conservar la toma más limpia.
       - Si dos notas se solaparon accidentalmente en el tiempo (acorde), marca ese evento con `hasPolyphonicOverlap: true` y avisa visualmente.
- [x] **Política de apagado tras soltar la nota (`NoteOff` $\neq$ fin del sonido)**:
  - Tanto en Barrido Automático como en Teclado en Vivo, soltar la tecla (`NoteOff`) abre la fase de **captura de cola (`Release Tail`)** con 2 modos seleccionables:
    - **A) Auto-detección de extinción (`auto_decay` con tope `maxReleaseMs`)**: tras el `NoteOff`, sigue grabando la nota hasta que `evaluateReleaseTailDecay` confirma que el sonido cayó al suelo de ruido medido (o, en modo teclado en vivo, hasta un instante antes del siguiente `NoteOn` si el músico toca otra nota antes).
    - **B) Tiempo de Release definido (`fixed_time`)**: tras el `NoteOff`, graba exactamente durante `releaseDurationMs` (ej. `1500 ms`) antes de cerrar `tailEndFrame` y lanzar la siguiente nota.

---

### Subfase 37.5 — Visor de Onda en Vivo con Zoom Constante (Scrolling Waveform) + Integración UI Nativa
- [x] **Onda en vivo que avanza sin achatarse (`Scrolling Live Waveform` en `#rec-wave-canvas`)**:
  - Mejorar el visor de onda de [`AudioRecorderModal.ts`](file:///d:/desarrollos/ABDSynths/ABDNeuModMakr/src/ui/AudioRecorderModal.ts) para que funcione durante la grabación (tanto en **Grabación Directa de Audio** como en **AutoSampler MIDI**).
  - **Prohibido achatar/comprimir toda la toma en el ancho del canvas mientras graba**: el visor opera como una **ventana deslizante de escala fija** (`pixelsPerSecond` constante), seleccionable con píldoras de zoom (`2 s`, `5 s`, `10 s`, `30 s` visibles en pantalla, más botón `[Ver toma completa]` al detener).
  - Mientras la onda se desplaza de derecha a izquierda en tiempo real:
    - El músico aprecia con total nitidez los **ciclos de modulación (LFO, chorus, batidos de osciladores)** para comprobar si el tiempo de nota (`Gate`) es suficiente para lograr un buen bucle.
    - En modo AutoSampler se pintan en vivo las banderas verticales de cada **`NoteOn` (`C3 v100` / `Kick 808`)**, **`NoteOff` (inicio de release)** y **`Fin de cola`**.
- [x] **Integración visual 100 % nativa (Cero Islas)**:
  - Reutiliza estrictamente las tarjetas `.nmm-recorder-deck-card`, `.btn`, `.btn-xs`, `.btn-outline`, `.btn-accent`, `.val-pill`, `.nmm-recorder-console-grid` y `.nmm-modal-footer` de [`19-modal-canonical.css`](file:///d:/desarrollos/ABDSynths/ABDNeuModMakr/src/styles/19-modal-canonical.css).
  - Añade la **Matriz compacta `Notas × Velocidades` (`Grid View`)** que se ilumina celda a celda en vivo durante el barrido o mientras el usuario toca su teclado.

---

### Subfase 37.6 — Continuar Grabación Interrumpida, Recuperación de Parseo, Empalme con `AutoSlicer` y `AutoLoop`
- [x] **1. Utilidad de Continuar / Reanudar si se para la grabación (`Resume / Retry Pending & Failed Cells`)**:
  - Si el usuario detiene o pausa el barrido a mitad, puede pulsar **`[ Continuar desde donde se paró ]`** para grabar únicamente las celdas con `status: 'pending' | 'failed'`, concatenando el nuevo audio y actualizando el manifiesto sin repetir las notas ya grabadas.
  - Haciendo clic en cualquier celda de la matriz `Notas × Velocidades`, puede elegir **`[ Escuchar esta nota ]`** o **`[ Re-grabar solo esta nota/velocidad ]`** (`Shift+Click`).
- [x] **2. Recuperación total si falla el parseo o el corte después de grabar (`Non-Destructive Take & Manifest Rescue`)**:
  - En cuanto termina o se pausa la grabación, el archivo WAV continuo (`rawTake.wav`) con su `MidiAutoSampleManifest` adjunto se guarda **antes de cortar** en `SESSION TAKES` (y con los eventos serializados dentro del chunk RIFF `atem`/`cue ` del propio WAV).
  - Si falla el parseo posterior, si la latencia desplazó los cortes o si había un error en el archivo de nombres `.txt/.json/.yaml`, **jamás hay que volver a grabar el sintetizador**: desde la fila del take en `SESSION TAKES` el usuario dispone de **`[ Ajustar offset de latencia (± ms) ]`**, **`[ Cargar / Corregir mapa de nombres ]`**, **`[ Re-ejecutar corte por manifiesto ]`** o **`[ Abrir en AutoSlicer (AudioChopperModal) con los puntos de corte ]`**.
- [x] **3. Limpieza en Toma Continua + Empalme directo con nuestro `AutoSlicer` y nuestro `AutoLoop`**:
  - **Limpieza antes del corte**: aplica `dcBlock` + `reduceNoiseWithProfile` (con el `Noise Print` del Pre-Roll) sobre la grabación continua completa para evitar artefactos de ventana FFT en los ataques.
  - **Corte guiado por el Manifiesto (`buildSlicesFromMidiManifest` en `AudioSlicerEngine.ts`)**:
    - Refina cada ventana `[noteOnFrame .. tailEndFrame]` con `snapFrameToNearestZeroCrossing` (`zc-snap`) y `trimSilence` final.
    - Tanto en el visor del grabador como al pasar al `AudioChopperModal` se utiliza el **mismo componente de onda con marcadores de corte** (`NoteOn`, `NoteOff`, `TailEnd`).
  - **`AutoLoop` automático sobre el tramo sostenido (`NoteOn..NoteOff`)**:
    - Con el checkbox **`Calcular AutoLoop automáticamente`** activo, invoca nuestro motor [`computeBatchAutoLoopForZones`](file:///d:/desarrollos/ABDSynths/ABDNeuModMakr/src/core/dsp/LoopEditorTools.ts#L719-L747) acotando la búsqueda de cruce por cero al intervalo **`[noteOnFrame + margenAtaque .. noteOffFrame - margenRelease]`**, garantizando que el bucle nunca caiga dentro de la cola de release post-`NoteOff`.

---

### Subfase 37.7 — Asistencias de IA Honesta en el AutoSampler (con Alternativa Determinista, Fase 35.4)
- [x] **1. Nota Piloto Inteligente (`Smart Pre-Check`)**:
  - Botón **`[ Probar 1 nota y Autoconfigurar ]`**: lanza una nota de prueba, mide latencia RTL, suelo de ruido, tiempo real de extinción de cola tras `NoteOff` y diferencia espectral entre velocidad suave y fuerte, y propone automáticamente `gateDurationMs`, `maxReleaseMs` y la curva/número de velocidades ideal.
- [x] **2. Extractor IA de Mapas de Cajas de Ritmos desde Manuales**:
  - Cuadro para pegar texto desordenado copiado del manual PDF de una caja de ritmos o sinte $\to$ lo convierte en un mapa `.json` con notas, nombres y `muteGroup` (usando `CloudByokClient` LLM si está activo, o parser Regex determinista local con aviso transparente según 35.4).
- [x] **3. Clasificador Acústico de Golpes de Batería (`Drum Hit Auto-Labeler`)**:
  - Si se graba una caja de ritmos sin mapa de nombres, utiliza `AcousticIntelligence` para etiquetar cada golpe (`Kick`, `Snare`, `Closed Hat`, `Open Hat`, `Clap`, `Tom`, `Cymbal`) y sugerir el `muteGroup` de charles.
- [x] **4. Mejora Neuronal / BWE Opcional en Toma Continua**:
  - Integración con el botón `AI Enhance (BWE)` existente antes del corte, respetando los ataques marcados en el manifiesto y pidiendo confirmación explícita si el Bridge está desconectado.

---

### Orden de Ejecución de la Fase 37
`37.1 (Spike 0 WebMIDI)` $\to$ `37.2 (DSP puro + Curvas de Velocidad + Manifiesto en ABDShared + vendor:sync)` $\to$ `37.3 (Parser .txt/.json/.yaml de Cajas de Ritmos + Plantilla UI/DOCS)` $\to$ `37.5 (Onda en vivo con Zoom constante sin achatar en Grabación Directa de Audio y AutoSampler)` $\to$ `37.4 (Controlador de Barrido Automático + Teclado MIDI en Vivo + Cola Auto/Fija)` $\to$ `37.6 (Continuar grabación + Recuperación de parseo + Empalme con AutoSlicer y AutoLoop NoteOn..NoteOff)` $\to$ `37.7 (Asistencias IA Honesta + Suite de Tests phase37_autosampler.test.ts)`.

---

## Fase 38 — Accesibilidad de la Interfaz (a11y): Trampa de Foco, Nombres Accesibles, Foco Visible, Movimiento Reducido y Lector de Pantalla [COMPLETADA]
- [x] **Nombres accesibles en botones solo-icono**: `aria-label="Close"` en los 4 cierres que carecían de él (`btn-confirm-close`, `btn-rx2-pairing-close`, `btn-stem-close` en `AudioChopperModal.ts`; `btn-close-doc-modal` en `Navbar.ts`), igualando a los que ya lo tenían (`btn-chopper-close`, `btn-recorder-close`).
- [x] **Trampa de foco compartida (`createModalFocusTrap`) en los 3 modales que faltaban**:
  - `AudioChopperModal.ts`: trampa en `open()` / desactivación en `close()`; el `Escape` manual se elimina y su lógica (cerrar menú contextual antes que el modal) pasa al `onEscape` del trap.
  - Diálogos anidados del chopper (confirmación de cortes, asistente RX2, separación de stems: todos en `document.body`, fuera del backdrop): trampa propia + padre en pausa con reanudación al cerrar, para que `Tab` y `Escape` no fuguen ni cierren el modal padre por error.
  - `NeuronDbModal.ts`: trampa recreada en cada `open()` (el `closeHandler` captura el `onCancel` vigente); se eliminan los `Escape` manuales, incluyendo el listener de backdrop que se acumulaba en cada apertura.
  - `ProcessModal.ts`: sustituye su `onKeyDown` manual por el trap, conservando su lógica de `Escape` (cerrar solo si el proceso terminó; si no, cancelar).
  - `LoadingModal.ts` queda fuera a propósito: es un indicador `role="status"` sin elementos interactivos y no debe robar el foco.
- [x] **Foco visible y contraste (`00-base.css`, `10-settings-modal.css`, `15-modal-cover.css`, `16-modal-import.css`, `17-modal-health.css`)**:
  - Anillo de foco universal por teclado (`:focus-visible` con `outline: 2px solid var(--color-accent); outline-offset: 2px`) en todos los `.btn`, botones, pestañas, enlaces, inputs, selects, tarjetas `.ndb-card`, bloques `.ribbon-zone-block`, celdas `.nmm-as-cell`, formatos `.raw-format-btn`, píldoras y dropzones, además de `:focus-within` en contenedores compuestos (`.input-with-note`, `.input-with-prefix`).
  - Eliminación de colores literales residuales (`#22c55e`, `#eab308`, `#ef4444`, `#f87171`, `#a78bfa`, `#10b981`, `#f59e0b`, `#00f0ff`) sustituyéndolos por variables semánticas (`--color-success`, `--color-warning`, `--color-danger`, `--color-ai-bright`, `--color-accent`) que garantizan contraste AA tanto en temas oscuros como claros.
- [x] **`prefers-reduced-motion` (`00-base.css`)**:
  - Regla `@media (prefers-reduced-motion: reduce)` que desactiva las animaciones infinitas (`ai-icon-pulse`, `pulse-ready`, `neuralPulse`, `pulse-drag-over`, `nmm-recorder-blink`) y reduce transiciones y desplazamientos a instantáneos (`0.01ms`) cuando el sistema operativo solicita movimiento reducido.
- [x] **Anuncios para lector de pantalla en operaciones asíncronas (`notify.ts`, `LoadingModal.ts`, `00-base.css`)**:
  - Utilidad `.sr-only` y función exportada `announceToScreenReader(message, priority)` con regiones vivas dedicadas (`#a11y-live-polite` y `#a11y-live-assertive`, `aria-atomic="true"`).
  - Integración en `LoadingModal.show()` y `LoadingModal.setMessage()` (con *throttling* de `1.2 s` y `aria-busy="true"/"false"`) para narrar el progreso de operaciones largas (lotes, separación de stems, BWE, importación de bancos), así como roles `alert`/`status` en `toast()` y vinculación explícita `id="confirm-title"` / `id="prompt-title"` + `aria-describedby` en `confirmDialog` y `promptDialog`.
- [x] **Auditoría de navegación por teclado en superficies complejas**: rejillas (`Notas × Velocidades` en `AudioRecorderModal.ts` con `role="grid"` y navegación 2D `←/→/↑/↓/Home/End/Enter/Shift+Enter`), vistas grid/tabla con flechas (`ZoneRibbon.ts` con `←/→` y `Shift+←/→` para fronteras de semitono, `tableEventOps.ts` + `zoneTemplates.ts` con `↑/↓/Home/End/Espacio/Enter` y `bankShell.js`), canvas de onda (`AudioChopperModal.ts` / `a11yKeyboard.ts`, `LoopEditorModal.ts`) y deslizadores: orden de tabulación lógico y atajos documentados en `title`.
- [x] **Coordinación con Fase 36 (i18n)**: todos los `aria-label` y `title` de botones, pestañas, modales y controles responden dinámicamente al idioma activo (`ES` / `EN`) a través de las Capas 1, 2 y 3 de internacionalización.

---

## Fase 39 — Superficie Espectral Continua Unificada (`UnifiedSpectralSurface`), Cola por Fases del Batch Processor Multiformato y Denoise Triple [COMPLETADO]
- [x] **1. Compilador de Superficie Espectral Continua Unificada (`src/core/dsp/UnifiedSpectralSurface.ts` & `@abdsynths/shared/contracts/axionikExpandedModel.ts`)**:
  - Destila cualquier colección de zonas y capas de velocidad en un **único modelo continuo (`unifiedSurface`)** dentro de `05_extended_model/axionik-expanded.json` para el Resinator `ABDAxionikVS`:
  - **Detección automática de topología (`detectSurfaceTopology`)**:
    - `melodic_surface` (`Pitch 0..127 × Velocity 1..127 × Time`): pianos, sintes, cuerdas, bajos y percusión cromática/botellas afinadas (verificando progresión monotónica de $f_0$ con la tecla MIDI y similitud coseno de la envolvente de formantes en 24 bandas Bark). Basta con conocer los puntos de calibración `(Nota, Velocidad)` para cubrir de `0` a `127` sin huecos ni necesidad de estirar zonas.
    - `drum_kit_surface` (`Hit_Key → Velocity 1..127 × Time`): mapas de percusión (`drum_map`, `slicer drums`) o colecciones de objetos percusivos no afinados, aislando cada tecla MIDI pero interpolando continuamente sus capas de velocidad y aplicando variación estocástica en el residuo DDSP para eliminar el efecto metralleta (*machine-gun effect*).
  - **Resolución adaptativa según contenido (`resolveAdaptiveSurfaceResolution`)**:
    - Modo `auto` (escala entre `compact` $32\text{p}\times32\text{f}$, `standard` $64\text{p}\times48\text{f}$, `hd` $128\text{p}\times64\text{f}$ y `ultra-hd` $256\text{p}\times96\text{f}$ según riqueza armónica real por encima de $-78\text{ dB}$ y evolución temporal) y modo `manual` (`Complexity 1..10`).
  - **Alineación por hitos temporales (`warpFramesToCanonicalGrid`) y modulación de sintetizadores (`extractModulationProfile`)**:
    - Alinea `canonicalAttackPeakFrame` y `canonicalSustainStartFrame` en todos los nodos, permitiendo **acortar ataques lentos** (`attackShorten01` saltando al pico de plenitud espectral) y **alargar *releases* inexistentes o cortados en seco** (`releaseExtendSec` con caída física progresiva de agudos `hfDampingDbPerSec`).
    - Extrae la velocidad y profundidad de batimiento de osciladores desafinados (`modulationRateHz`, `modulationDepth`, `estimatedDetuneCents`) y contramodulación par/impar (`oddEvenModDepth` de PWM) para interpolar sin cancelaciones de fase ni aceleración de LFO por octava.
  - **Escudo contra muestras intrusas (`timbreCoherenceScore` & `isTimbralOutlier`)**:
    - Detecta muestras de otro instrumento coladas por error comparando cada nodo contra la mediana robusta de las 24 bandas Bark y la armocidad, excluyéndolas automáticamente del formante global del cuerpo (`globalBodyFormantDb`) y de la interpolación por defecto (`includeOutliers: false`), además de advertir en el Preflight (`WARN_INTRUDER_SAMPLE`).
- [x] **2. Gestor de Colas por Fases (`stage-grouped`) e Ingesta Multiformato en `BatchProcessorModal.ts` y `BatchQueue.ts`**:
  - Ejecución agrupada por etapas (`Stage 1/5: Ingesta/Slicing` $\to$ `Stage 2/5: Separación HTDemucs/DSP` $\to$ `Stage 3/5: Denoise DeepFilterNet/DSP` $\to$ `Stage 4/5: BWE AudioSR & Clasificación` $\to$ `Stage 5/5: Resíntesis STFT & Empaquetado`) manteniendo cada modelo IA caliente en memoria/VRAM para todo el lote y liberando caché una sola vez al cerrar cada etapa.
  - Ingesta multiformato unificada en `BatchProcessorModal.ts` (con soporte drag-and-drop en `#batch-dropzone` y `.articulation-checkbox.switch--sm`): `.sf2`, `.sfz`, `.dspreset`, `.nki`, `.vstpreset`, `.multisample`, `.adv`, `.exs`, `.talsmpl`, `.txprog`, `.kmp`, `.dls`, `.xpm`, `.xpn`, `.model`, `.nmmodel`, `.scape`, `.sphere`, `.iso`, `.img`, `.dsk`, `.zip`, `.rx2`, `.rex` y todos los formatos de audio.
- [x] **3. Denoise Triple (Algorítmico, Huella de Ruido e IA con `DeepFilterNet 3`) y Normalización en Grabador y AutoSlicer**:
  - `AudioChopperModal.ts`: normalización pura a `-1.0 dBFS` (`normalizePeakPcm`), detección de silencios con inyección de cortes en `mute` (`injectSilenceCutBoundaries`) para excluirlos de la matriz de zonas y doble botón de reproducción (`Play WAV` completo vs `Play Slice`).
  - `AudioRecorderModal.ts` y `aiHonesty.ts` (`'recorder-ai-denoise'`): barra de post-procesado en los 4 modos del grabador con `Normalizar (-1 dBFS)`, `Detectar Ruido` y 3 modos de Denoise (`Denoise Algorítmico`, `Denoise Huella`, `Denoise IA`), verificando antes de ejecutar `Denoise IA` si la Etapa 5 (`DeepFilterNet 3`) está habilitada con el Bridge conectado o si existe una API Key de LLM potente en Cloud BYOK.
- [x] **4. AutoSlicer de Doble Modo (`One-Shot Extractor` vs `REX / Groove Loop`), Extracción de Melodías (BPM + Notas + `.mid`), Conformador Elástico de Tempo y Contrato `tempoSync` para Resinator v2 (`AudioSlicerEngine.ts`, `AudioChopperModal.ts`, `ModelConfigModal.ts`, `UnifiedSpectralSurface.ts`)**:
  - **Dos modos macro de flujo en `AudioChopperModal.ts` (`SlicerWorkflowMode`)**:
    1. **`one_shot_extractor` (*Cortar y Mapear One-Shots*)**: para grabaciones nota a nota (cromáticas o caja de ritmos golpe a golpe). Deshabilita condicionalmente (`<fieldset class="conditioned-fieldset" disabled>` + `.is-conditioned-disabled` + `.cond-reason-badge`) los controles de BPM/Compases/Target BPM y los botones de bucle/MIDI, manteniendo el cálculo de `detectedBpm` en segundo plano.
    2. **`rex_groove_loop` (*Bucle Rítmico / Melodía REX*)**: habilita el estimador conjunto de BPM y compases (`estimateLoopBpmAndBars` por cuantización IOI + rejilla de duración total), el conformador elástico de tempo (`conformLoopToTargetBpm` bloqueando los primeros $25\text{ ms}$ de ataque transitorio de cada golpe/nota), la audición en vivo `Play @ Target BPM`, la exportación de partitura `.mid @ Target BPM` y la inyección `Inyectar Loop Continuo (Target BPM)`.
  - **Soporte para cortar melodías/riffs grabados, extraer su BPM y ejecutarlos vía MIDI (`chromatic` + `rex_groove_loop`)**:
    - `detectMelodicPitchChangeBoundaries` añade cortes en cambios de tono ligados (*legato* $> 78\text{ cents}$) además de los transitorios de amplitud SuperFlux.
    - `buildSlicesFromBoundaries` agrupa notas repetidas de la melodía por `rootKey` única (apilándolas como capas de velocidad / Round-Robin sin colisionar rangos `lowKey..highKey`) mientras conserva el orden cronológico en `slices` para que `buildMidiFileBuffer` exporte la **melodía exacta nota a nota** en el archivo `.mid`.
  - **Contrato `AxionikSurfaceTempoSync` (`tempoSync`) para el Resinator v2 de `ABDAxionikVS`**:
    - Persistido en `@abdsynths/shared/contracts/axionikExpandedModel.ts` (`05_extended_model/axionik-expanded.json`), `UnifiedSpectralSurface.ts` (`evaluateUnifiedSpectralSurface` con escalado temporal `sourceBpm / hostBpm` sin alterar $f_0$ ni formantes Bark), `expandedModelWriter.ts`, configurable en `ModelConfigModal.ts` (*Sincronización de Tempo / Bucle REX*) y consumido en tiempo real por `AxionikExpandedSynthesizer.h` en `ABDAxionikVS` (Fase B completada).

---

## Fase 40 — Exportación Simultánea Multi-Formato (35 Samplers), Navegación de Contenedores Anidados/Joliet, Control de Tempo (`< BPM >`) y Recuperación del Banco [COMPLETADA]
- [x] **1. Soporte Bidireccional de 35 Formatos de Sampler y Exportación Simultánea Multi-Formato (`RawSamplerExporter.ts`, `RawSamplerExportModal.ts`, `README.md`)**:
  - Ampliación del motor de importación/exportación a **35 formatos de samplers clásicos, workstation y modernos**: SoundFont 2 (`.sf2`), SFZ v2 (`.sfz`), Decent Sampler (`.dspreset`), Native Instruments Kontakt (`.nki` + `.ncw`), Steinberg HALion (`.fxp`/`.fxb`/`.vstpreset`), Apple Logic EXS24 (`.exs`), Ableton Live Simpler (`.adv`), Bitwig Studio (`.multisample`), TAL-Sampler (`.talsmpl`), TX16Wx (`.txprog`), Korg KMP/KSC/PCG (`.kmp`/`.ksc`/`.pcg`), DLS Level 2 (`.dls`), Akai MPC Keygroup (`.xpm`/`.xpn`), Akai S1000/S3000 (`.p`/`.s`/`.iso`), Akai S5000/S6000/Z4/Z8 (`.akp`), Akai S900/S950, E-mu EIII/ESI/Emax II (`EMU3`), E-mu EOS/E4/Proteus X/Emulator X (`.e4b`/`.exb`), Roland S-50/S-550/S-330/W-30, Roland S-760/S-750/S-770, Roland XV-5080/Fantom/ZEN-Core (`.svd`/`.svz`), Yamaha TX16W, Yamaha A3000/A4000/A5000, Yamaha Motif/Montage/MODX (`YSFC`), Ensoniq EPS/ASR-10 (`.efe`/`.efa`), Ensoniq Mirage, Kurzweil K2000/K2500/K2600 (`.krz`), Korg DSS-1, Casio FZ-1/FZ-10M (`.fz`/`.fzv`), Sequential Prophet 2000, Oberheim DPX-1, Fairlight CMI IIx/III (`.vc`), NED Synclavier II, Peavey SP y OctaMED/ProTracker/FastTracker II (`.mod`/`.xi`).
  - Reordenación del modal `RawSamplerExportModal.ts` en orden lógico (*1. Nombre y Metadatos* $\to$ *2. Configuración de Audio y Empaquetado* $\to$ *3. Formatos de Sampler Destino*) con selección múltiple (`Todos (35)` / `Solo activo` + casillas por formato) para empaquetar un único `.zip` multi-formato en una sola pasada, o sub-ZIPs individuales por instrumento cuando se activa *Separar en carpetas por zona*.
  - Unificación del menú `File -> Export Instrument (Choose Destination)...` eliminando la entrada redundante en `File` y cableando el botón `← Volver a Exportar Instrumento` de `RawSamplerExportModal.ts` para regresar a `ExportDestinationModal.ts`.
- [x] **2. Soporte de Carpetas, Imágenes ISO Joliet Multiformato y Contenedores Anidados (`.zip` / `.iso`) (`UniversalImportModal.ts`, `MultiInstrumentModal.ts`, `MultiAssetTriageModal.ts`, `Iso9660ImageReader.ts`)**:
  - Botón `Browse Folder...` y soporte recursivo de carpetas por Drag & Drop en `UniversalImportModal.ts`.
  - Selección del descriptor de volumen suplementario **Joliet (UTF-16BE)** en `Iso9660ImageReader.ts` para preservar nombres largos y subdirectorios multiformato (`AIFF`, `EXS24`, `HALion`, `WAV`) en CD-ROMs de librerías profesionales.
  - Emparejamiento tolerante a truncamiento ISO 9660 Nivel 1 (8.3, `_` por espacios/símbolos y prefijos numéricos) en `Exs24Format.ts` y parser de programas `HalionFxpFormat.ts` (`.fxp` / `.fxb`).
  - Navegación interactiva con migas de pan (*breadcrumbs*) dentro de contenedores anidados (`.zip` dentro de `.zip`, `.iso`/`.bin`/`.img` dentro de `.zip`) y paso directo de los archivos expandidos desde `MultiInstrumentModal` / `MultiAssetTriageModal` hacia `BatchProcessorModal.ts`.
- [x] **3. Control de Tempo en Vivo (`< BPM >`, 30..300) y Reproductor de Secuencias (`Seq`) en el Keymap (`ZoneInspector.ts`, `WebAudioPipeline.ts`)**:
  - Control numérico de BPM (`30..300`, por defecto `120`) con botones triangulares `<` (`#btn-keymap-bpm-dec`) y `>` (`#btn-keymap-bpm-inc`) a izquierda y derecha en la barra del Keymap, sincronizado bidireccionalmente con `unifiedSurfaceConfig.tempoSync.targetBpm` (Resinator v2) y con el botón reproductor `Seq` para escuchar bucles REX y secuencias cromáticas a la velocidad elegida.
- [x] **4. Doble Nombre (`modelName` 11 caracteres vs `expandedName` sin límite), Cobertura Condicional `0..127` y Coherencia de Menús (`Navbar.ts`, `ZoneInspector.ts`, `BatchPreflightEngine.ts`, `ModelIdentity.ts`)**:
  - Separación estricta entre el nombre clásico `MName` (recortado a 11 caracteres ASCII solo para hardware Classic) y `expandedName` (sin recorte en modo Extended ni en exportaciones modernas/Batch).
  - Extensión obligatoria de notas `0..127` aplicada **únicamente** cuando se cumplen simultáneamente `workingMode === 'classic'` y `keyMappingMode === 'chromatic'`.
  - Agrupación de herramientas bajo el submenú `Model -> Tools` y el menú desplegable `Tools` de la barra del Keymap (`Loop Editor`, `AutoLoop in All Zones`, `Audio Chopper & Auto-Slicer`, `Audio & MIDI AutoSampler Recorder`).
  - Notificaciones toast reposicionadas en la esquina superior derecha (`top: 56px; right: 20px`) con mayor tamaño tipográfico y contraste.
- [x] **5. Hidratación de Binarios desde IndexedDB y Recuperación Automática de Modelos Antiguos del Banco (`NeuronAssetStore.ts`, `bankService.ts`, `WebAudioPipeline.ts`)**:
  - Hidratación completa de `legacy_originals` (`STORE_LEGACY`) y `model_capsules` (`STORE_CAPSULES`) desde IndexedDB al iniciar y al restaurar el banco (`restoreBank` / `getModelBinaries`), evitando el error `NO_BINARIES` tras recargar la página.
  - Plan de respaldo (`buildFallbackBankLoadPlan` en `loadBankModel`) para modelos antiguos guardados únicamente en `localStorage` sin binarios `.scape`/`.sphere` en caché: reconstruye sus zonas desde `neuronikModelJson` o `zonesAnalysis`, vincula muestras presentes en `NeuronAssetStore` o sintetiza ondas armónicas desde los parciales analizados (`detectedF0Hz` + `amplitudes`), permitiendo cargar cualquier modelo histórico sin error.

---

## Fase 41 — Unificación DRY de Clases CSS y Plantillas TS [COMPLETADA]

**Objetivo**: Completar la convergencia DRY de las hojas de estilo en `src/styles/` y sus plantillas `.ts` asociadas, consolidando píldoras de estado, tiras/rejillas de métricas, alertas y esqueletos de modales de laboratorio en el módulo canónico `19-modal-canonical.css` y `12-audio-lab.css`.

### 41.1 Consolidación en CSS puro (`12-audio-lab.css`, `16-modal-import.css`, `17-modal-health.css`, `19-modal-canonical.css`, `20-modal-triage.css`)
- [x] **Ventanas modales de talla L**: `.universal-import-modal-window` y `.config-health-modal-window` consolidadas en la regla canónica `.nmm-modal-l`.
- [x] **Leyendas de canvas y pistas de teclado**: `.triage-hint` unificada en `.nmm-audio-canvas-legend`.
- [x] **Tokenización semántica integral**: sustitución de todos los colores hexadecimales/RGBA literales residuales por variables del sistema de temas (`--color-success`, `--color-warning`, `--color-danger`, `--color-ai-bright`, `--color-accent`).

### 41.2 Consolidación en plantillas `.ts` y hojas modulares (`19-modal-canonical.css`, `12-audio-lab.css`)
- [x] **1. Píldoras de estado semántico unificadas en `.nmm-status-pill` (`is-ok`, `is-warn`, `is-err`, `is-ai`, `is-accent`, `is-muted`)**:
  - Migradas en `UniversalImportModal.ts`, `ConfigHealthModal.ts`, `AiCoverGeneratorModal.ts`, `src/ui/settings/tabCloud.ts` y `src/ui/settings/bridgeModels.ts`, eliminando las reglas duplicadas `.uimport-fmt-badge`, `.badge-health-*`, `.health-pill*`, `.provider-badge*`, `.byok-status-pill*`, `.model-custom-url-badge` y `.ai-model-status-pill*`.
- [x] **2. Limpieza de tarjetas de incidencia heredadas (`.issue-item` $\to$ `.issue-card`)**:
  - Eliminado el bloque residual `.issue-item*` en `16-modal-import.css`, quedando `.issue-card` de `19-modal-canonical.css` (`renderCommonPreflightGate`) como único componente de incidencias.
- [x] **3. Tiras y rejillas de métricas unificadas en `.nmm-metric-strip`, `.nmm-metric-grid` y `.nmm-metric-card` (`.nmm-metric-val`, `.nmm-metric-lbl`)**:
  - Migradas en `UniversalImportModal.ts`, `ConfigHealthModal.ts`, `BatchProcessorModal.ts` y `MusicianWizardModal.ts`, retirando las reglas duplicadas `.uimport-metrics-strip` / `.metric-pill`, `.health-overview-strip` / `.health-metric` y `.nmm-preflight-grid` / `.profile-item`.
- [x] **4. Retirada de alias heredados de Audio Lab en `12-audio-lab.css`**:
  - `LoopEditorModal.ts`, `AudioChopperModal.ts`, `AudioRecorderModal.ts`, `MultiAssetTriageModal.ts`, `MultiInstrumentModal.ts` y `ExportDestinationModal.ts` usan directamente las clases canónicas `.nmm-audio-modal-window`, `.nmm-audio-modal-body`, `.nmm-audio-viewport-panel`, `.nmm-audio-table-panel`, `.nmm-audio-controls-card`, `.nmm-audio-zoom-group`, `.nmm-audio-canvas-wrap` y `.nmm-audio-canvas-legend`.

---

## Fase 42 — Partición Modular de Hojas de Estilo y Módulos TypeScript de Gran Tamaño [COMPLETADA]

**Objetivo**: Dividir los ficheros monolíticos de CSS y TypeScript en submódulos cohesivos y pequeños, mejorando la mantenibilidad y evitando colisiones entre desarrollos paralelos.

- [x] **1. Hojas de estilo modulares (`src/style.css` $\to$ `src/styles/00-base.css` .. `20-modal-triage.css`)**:
  - 21 hojas temáticas independientes orquestadas desde `src/style.css` con 0 colores literales y primitivas DRY compartidas en `19-modal-canonical.css`.
- [x] **2. Submódulos de Ajustes (`src/ui/SettingsModal.ts` $\to$ `src/ui/settings/*`)**:
  - Separados en `types.ts`, `constants.ts`, `state.ts`, `badges.ts`, `bridgeModels.ts`, `webPresets.ts`, `tabGeneral.ts`, `tabWeb.ts`, `tabCloud.ts` y `tabBridge.ts`.
- [x] **3. Submódulos de Configuración del Modelo (`src/ui/ModelConfigModal.ts` $\to$ `src/ui/modelConfig/*`)**:
  - Separados en `types.ts`, `constants.ts`, `tagHelpers.ts`, `tabGeneral.ts`, `tabArticulation.ts`, `tabArtwork.ts`, `tabMetadata.ts` y `events/*`.
- [x] **4. Submódulos de Exportadores Raw, Motor AutoSlicer, BridgeClient, BankService y Honestidad IA (`src/core/export/*`, `src/core/dsp/audioSlicer/*`, `src/core/bridge/*`, `src/core/bank/*`, `src/core/ai/honesty/*`)**:
  - Exportadores divididos por familia (`sf2Writer.ts`, `sfzWriter.ts`, `modernSamplers.ts`, `classicHardware.ts`, `workstationSamplers.ts`, `vintageTrackers.ts`, `rawSamplerArchive.ts`, `rawSamplerPreflight.ts`, `rawSamplerTypes.ts`).
  - Motor `src/core/dsp/AudioSlicerEngine.ts` particionado en 7 submódulos especializados bajo `src/core/dsp/audioSlicer/` (`SlicerTypes.ts`, `SlicerSpectral.ts`, `SlicerVocalOpenVpi.ts`, `SlicerDrumAndMidi.ts`, `SlicerBuild.ts`, `SlicerSilenceAndPitch.ts`, `SlicerConform.ts`) manteniendo la fachada pública intacta en `AudioSlicerEngine.ts`.
  - Cliente de comunicación local `BridgeClient.ts` modularizado en `src/core/bridge/` (`bridgeTypes.ts`, `bridgeAudio.ts`, `bridgeLibrary.ts`, `bridgeModels.ts`, `BridgeClient.ts`).
  - Servicio de bancos `src/core/bankService.ts` (1348 $\to$ 393 líneas) descompuesto limpiamente en `src/core/bank/` (`bankExport.ts`, `bankAxionikDb.ts`, `bankSublibraries.ts`, `bankLoadPlan.ts`).
- [x] **5. Partición Completa de Modales Monolíticos Complejos de UI (`BatchProcessorModal`, `MusicianWizardModal`, `AudioChopperModal`, `AudioRecorderModal`)**:
  - Modal por lotes `src/ui/BatchProcessorModal.ts` (1642 $\to$ 347 líneas) particionado en `src/ui/batch/` (`batchModalCore.ts`, `batchDiscoverView.ts`, `batchPreflightView.ts`, `batchEvents.ts`, `batchQueueOps.ts`).
  - Asistente de músico `src/ui/MusicianWizardModal.ts` (1752 $\to$ 333 líneas) descompuesto en `src/ui/musicianWizard/` (`wizardModalCore.ts`, `wizardStep1View.ts`..`wizardStep4View.ts`, `wizardCommitOps.ts`, `wizardEvents.ts`).
  - Cortador de audio `src/ui/AudioChopperModal.ts` (1660 $\to$ 625 líneas) particionado en `src/ui/chopper/` (`chopperFileOps.ts`, `chopperSessionOps.ts`, `types.ts`).
  - Grabador y AutoSampler `src/ui/AudioRecorderModal.ts` (3294 $\to$ 544 líneas) particionado en `src/ui/recorder/` (`types.ts`, `recorderUtils.ts`, `captureOps.ts`, `sweepOps.ts`, `takeOps.ts`, `deckOps.ts`, `renderOps.ts`, `canvasOps.ts`). Eliminados todos los monolitos de UI superiores a 1000 líneas.
- [x] **6. Submódulos de Pipeline de Audio e Inspector (`src/core/pipeline/*`, `src/ui/zoneInspector/*`)**:
  - Operaciones de `WebAudioPipeline.ts` y vistas/plantillas de `ZoneInspector.ts` modulares (`drawerRenderOps.ts`, `tableRenderOps.ts`, `tableEventOps.ts`, `zoneTemplates.ts` y `src/ui/chopper/*` con `a11yKeyboard.ts`).

---

## Fase 43 — Auditoría Transversal de Conformidad con Estándares VST3 y Diccionario de Datos Común (`ABDShared` v2.0) [PLANIFICADA]

**Objetivo**: Revisar exhaustivamente si `ABDNeuModMakr` (y su interacción con los sintetizadores de la suite, especialmente `ABDAxionikVS`) cumple al 100 % con los estándares canónicos actualizados en `ABDShared`:
- [`ABDShared/Docs/architecture/CALIDAD_Y_ESTANDARES_VST3.md`](file:///d:/desarrollos/ABDSynths/ABDShared/Docs/architecture/CALIDAD_Y_ESTANDARES_VST3.md)
- [`ABDShared/Docs/specs/COMMON_DATA_DICTIONARY_AND_INTEGRATION.md`](file:///d:/desarrollos/ABDSynths/ABDShared/Docs/specs/COMMON_DATA_DICTIONARY_AND_INTEGRATION.md)

### Tareas de Auditoría y Verificación:
- [ ] **1. Conformidad con Curvas `SymBipolar` y Cero Físico Exacto**:
  - Verificar que todas las exportaciones a plugins y modelos extendidos (`05_extended_model/`) apliquen simetría exacta en parámetros bipolares (`wireZeroCenter: 0` para `[-64..+63]` y `wireZeroCenter: 64` para `[0..127]`), asegurando que el centro en automatización DAW (`0.5` normalizado) mapee estrictamente a `0.0f` físico.
- [ ] **2. Cobertura de Categorías y Metadatos Semánticos (`semanticRole`)**:
  - Auditar que los parámetros generados en importaciones/exportaciones de samplers contengan `semanticRole` coherente con `sampler_voice_parameter_spec.json` y `hartmann_neuron_parameter_spec.json`.
  - Asegurar que los destinos de modulación y articulaciones se mapeen correctamente a roles estándar (`FilterCutoff`, `FilterResonance`, `AmpEnvAttack`, etc.) para organización automática en carpetas del DAW.
- [ ] **3. Integración de Direccionamiento NRPN 14-bit**:
  - Comprobar que los scripts de emisión MIDI y perfiles de exportación manejen pares `nrpnMsb / nrpnLsb` de alta resolución para evitar saltos o *zipper noise* en barridos de control.
- [ ] **4. Roundtrip Rompler E2E con Motores C++**:
  - Validar de extremo a extremo que un preset/banco exportado desde `ABDNeuModMakr` cargue en `ABDAxionikVS` y reproduzca zonas y loops idénticos a los previsualizados en `AudioChopperModal` y `LoopEditorModal`.








