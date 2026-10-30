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

---

## Fase 11 — Procesado del Modo Extendido, Modelos Surround y Nuevos Resynators (`ABDAxionikVS`) [EN PLANIFICACION]

- [ ] Formato Espectral de Alta Definicion (>64 parciales, >16 tramas).
- [ ] Separacion de formantes y pitch para Formant Shifting en tiempo real.
- [ ] Campos de morphing 2D/3D y espacio latente (Autoencoder / VAE).
- [ ] Modelos Surround reales (Quad 4.0 / 5.1) con Scape frontal y Sphere envolvente.
- [ ] Disparo hibrido de transitorios PCM reales fundidos en fase con el cuerpo.

---

## Fase 12 — Procesamiento por Lotes (`Batch Processor`) [POSPUESTO]

- [ ] Procesamiento desatendido por lotes sobre colecciones completas de `NeuronDB` o SoundFonts.
- [ ] Cola de conversion con reporte de metricas y generacion de paquetes multiformato de 5 capas.

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
