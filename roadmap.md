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

# 🚀 Nueva Etapa: Evolución Next-Gen (Fases 6 a 13)

> Hoja de ruta para transformar `ABDNeuModMakr` en una factoría de modelos capaz de importar instrumentos complejos, mejorar la síntesis clásica con algoritmos modernos e IA, conservar el linaje completo de ondas sin "efecto fotocopia", y alimentar el motor extendido de `ABDAxionikVS` (C++ / JUCE 9).
>
> 📄 **Especificación Técnica Completa y Detallada**: Ver [`DOCS/NEXTGEN_ARCHITECTURE_AND_SPEC.md`](DOCS/NEXTGEN_ARCHITECTURE_AND_SPEC.md) (incluye fórmulas, reglas de conversión Extendido $\rightarrow$ Clásico, tablas de descriptores para los 10 Parameter Sets, estructura del contenedor de 5 capas, ampliación de loops, DAHDSR, Surround y arquitectura híbrida Vercel/Local).

---

## Fase 6 — Creación Dual (Clásica vs Extendida) e Importación Universal a Formato Nativo ✅ COMPLETADA

**Objetivo**: Desacoplar el modo de edición/creación del formato de salida e incorporar un importador de formatos de sampler (`.sf2`, `.sfz`, etc.) que traduzca siempre a **nuestra propia definición nativa + WAVs/AIFFs** (sin guardar nunca el archivo `.sf2` o externo original).

### 6.1 Modo de Creación Conmutable (`Classic Creation` vs `Extended Creation`)
- [x] Permitir alternar libremente en cualquier momento entre **Creación Clásica** y **Creación Extendida**, independientemente del formato en que luego se decida exportar:
  - **Modo de Creación Clásico**: Reglas estrictas de Hartmann MODELmaker v1.2 (bloques de notas contiguos `0..127` sin huecos ni solapamientos, columnas simétricas y máximo 2 capas de velocidad divididas en `64`).
  - **Modo de Creación Extendido** (inspirado en capacidades de SFZ, HALion, Kontakt y SampleTank):
    - **Mapa 2D libre ("Lego" de regiones)**: $N$ rangos de notas por $N$ rangos de velocidad (`loKey..hiKey` $\times$ `loVel..hiVel`) de tamaños arbitrarios e independientes.
    - **Crossfades en Altura y Velocidad (`keyFadeIn/Out`, `velFadeIn/Out`)**: Fundidos suaves entre zonas solapadas (en ganancia y/o en interpolación espectral).
    - **Modos de Loop (`no_loop`, `loop_continuous`, `loop_sustain`)**: Puntos `loopStart`, `loopEnd` y `loopCrossfade` para sostener instrumentos acústicos y pads.
    - **Seguimiento de Teclado (`pitchKeytrack`)**: Configurable de `0%` (percusión, baterías, efectos inarmónicos que no deben cambiar de pitch) a `100%` (instrumentos cromáticos) o valores intermedios.
    - **Modos de Disparo y Variación (`trigger: attack | release`, `roundRobin`)**: Soporte para muestras de *release* y secuencias de alternancia.
    - **Panel de Articulación y Modulación en el Editor Extendido (Loop por Zona + ADSR / Filtro / LFO con Mapeo Seguro al Sintetizador)**:
      - Visualización y edición de **Loop** (por onda/zona) y de **ADSR de Amplitud, Filtro/Env y LFO** (tanto por zona como global del instrumento) cargados desde `.sf2`, `.sfz`, HALion, SampleTank, etc.
      - **Mapeo controlado y aislado hacia `sound.script` (`ABDAxionikVS`)**: Mapear únicamente a los parámetros destino correspondientes (`R1AmpEnvA/D/S/R`, `FilterFreq/Reso` + `FilterEnvA/D/S/R`, `LFORate/Delay` + `R1PitchLfoDepth` / `R1AmpLfoDepth` / `FilterLfoDepth`) con interruptores de activación por sección, manteniendo a `0` las profundidades hacia `Scape`/`Sphere`/`Blender` para que nunca module parámetros indeseados del sintetizador.

### 6.2 Importador de `.sf2` (SoundFont 2) y `.sfz` a Definición Nativa
- [x] Parser binario de `.sf2` (chunks `INFO`, `sdta` de audio PCM y `pdta` de presets/instrumentos/zonas/generadores) con modal selector cuando el banco contenga múltiples presets (`src/formats/Sf2Parser.ts`, verificado con `Baritone Saxophone V2.sf2`).
- [x] Parser de `.sfz` (`<global>`, `<group>`, `<region>`, opcodes `sample`, `lokey`, `hikey`, `pitch_keycenter`, `lovel`, `hivel`, `xf_*`, `volume`, `pan`, `tune`, `loop_*`, `trigger`, `ampeg_*`, `fileg_*`, `cutoff`, `resonance`) en `src/formats/SfzParser.ts`.
- [x] **Captura de Envolventes (DAHDSR), Filtros y LFOs del SF2/SFZ**:
  - Extraer los parámetros de envolvente de volumen (`delay`, `attack`, `hold`, `decay`, `sustain`, `release`), envolvente de modulación/filtro, cutoff/resonancia y vibrato del preset SF2/SFZ.
  - Guardarlos en nuestra definición nativa de zona/instrumento y **traducirlos automáticamente al archivo `.sound` (`sound.script` de 445 parámetros)** y al formato extendido.
  - Opción de *"Hornear envolvente (Bake ADSR)"* sobre la onda para instrumentos SF2 que dependen de un `decay` artificial sobre una onda estática al exportar a modo clásico.
- [x] **Unión inteligente de pares Estéreo (`L/R`)**: Detectar regiones vinculadas Left/Right en `.sf2` y unificarlas como onda estéreo real en nuestra definición nativa (ej. las 22 muestras mono L/R de `Baritone Saxophone V2.sf2` se fusionan automáticamente en 11 WAVs estéreo de 2 canales).
- [x] **Conversión inmediata a Formato Propio**: Al importar un `.sf2` o `.sfz` (o conversiones intermedias desde Kontakt/HALion/SampleTank), se extraen las muestras como WAV/AIFF independientes y se registran sus regiones y envolventes en nuestro esquema nativo. El archivo `.sf2`/`.sfz` original se descarta tras la importación.

### 6.3 Compilador / Adaptador de Extendido $\rightarrow$ Clásico en Exportación
- [x] Si se ha trabajado en Modo Extendido (o importado un instrumento complejo) y se exporta a **Clásico** (o a la capa clásica del contenedor multiformato) (`src/core/extendedAdapter.ts`):
  - **Particionado automático de columnas**: Proyectar los límites de nota sobre `0..127` garantizando cobertura continua sin huecos.
  - **Compensación exacta de volumen entre velocidades**: Dado que `map.script` tiene un único `Volume` por zona (compartido por `LowSource` y `HiSource`), fijar el volumen de zona a la capa principal y aplicar la diferencia relativa de dB entre velocidad baja y alta **escalando directamente las magnitudes espectrales** del `.scape`/`.sphere` de la capa atenuada (`10^(deltaDb / 20)`).
  - **Reducción de $N$ velocidades a 2 franjas (`1..63` y `64..127`)**: Agrupar las regiones que caen en la mitad inferior y superior, permitiendo seleccionar la muestra representativa o realizar una **fusión/interpolación espectral ponderada** para generar un único par `.scape`/`.sphere` para `Low` y otro para `High`.

---

## Fase 7 — Autodetección Inteligente y Motor Clásico Mejorado (`Classic Enhanced`) ✅ COMPLETADA

**Objetivo**: Obtener modelos 100% compatibles con el sintetizador clásico pero con calidad superior mediante nuevos algoritmos de análisis, manteniendo siempre la opción de usar el algoritmo original.

### 7.1 Autodetección de Nota Raíz ($f_0$) y Detector Percusivo / Ruido
- [x] Mejorar el detector de frecuencia fundamental combinando **YIN / MPM (McLeod Pitch Method)** en dominio temporal con **HPS + Least-Squares** en dominio frecuencial (`src/core/dsp/AcousticIntelligence.ts`).
- [x] **Índice de Armonicidad / Confianza de Pitch**: Detectar automáticamente cuándo un sonido es **percusivo, inarmónico o ruido puro** (caja, plato, viento, FX) para no asignarle una fundamental errónea ni deformar la rejilla de parciales.

### 7.2 Clasificador Automático de Tipo de Instrumento y de los 10 Parameter Sets (`0..9`)
- [x] **Detección automática del Tipo de Instrumento / Categoría (`InstrumentClassifier`)**:
  - Identificar mediante descriptores acústicos (`classifyAcousticSample`) y/o heurísticas semánticas a qué categoría del ecosistema (`Plucked Strings`, `Winds & Brass`, `Bells & Mallets`, `Keys & Organ`, `Bowed Strings`, `Pads & Textures`, `Synth & Lead`, `Rhythmic Loops`, `Drums & Perc`) pertenece el sonido para no tener que etiquetarlo ni clasificarlo a mano en el banco.
- [x] Analizador de descriptores acústicos por muestra y conjunto de zonas para el `Parameter Set (0..9)` (`extractAcousticDescriptors`):
  - Tiempo y pendiente de ataque (`Log-Attack Time`, `attackMs`).
  - Coeficiente de inarmonicidad / rigidez física de parciales ($B$, clave para distinguir pianos, campanas y metales de cuerdas o vientos).
  - Relación Armónico-Ruido (`harmonicity`), *Spectral Flatness*, *Spectral Centroid* y *Zero-Crossing Rate* (soplido/turbulencia).
  - Evolución temporal de la envolvente (`sustainRatio`) y detección de múltiples transitorios (`transientDensityHz`, para detectar bucles rítmicos de `Set 8: Loop Factory`).
- [x] Selección automática del tipo de instrumento y del mejor `Parameter Set` (`0..9`) con indicador de confianza y justificación en la UI (`autoDetectZonePitchAndParameterSet`, botones `Auto-Detect` en `ProcessPanel.ts` y `ZoneInspector.ts`).

### 7.3 Nuevos Algoritmos para el Formato Clásico (`Legacy DSP` vs `Enhanced DSP`)
- [x] Conmutador de algoritmo de procesado clásico (`dspAlgorithm: 'legacy' | 'enhanced'`) en `ProcessPanel.ts` para conservar el comportamiento exacto de 2001 junto al nuevo motor mejorado (`applyEnhancedSpectralModel`):
  - **Separación Transitorio / Estacionario (HPSS)**: Aislar el impacto/excitación real en el ataque y suavizar mediante filtro de mediana + media ponderada las trayectorias estacionarias.
  - **Reasignación Tiempo-Frecuencia y Consistencia de Fase**: Estabilizar las trayectorias de los 64 parciales y sus offsets de frecuencia para eliminar saltos espurios de bin.
  - **Supresión adaptativa de piso de ruido en armónicos superiores**: Atenuación de ruido de cuantización en parciales de orden alto según `harmonicity` y `spectralFlatness`.
- [x] **Comparador A / B / C y Métrica de Calidad (`Quality Score`)**: Audición instantánea entre `A: Original` vs `B: Legacy DSP` vs `C: Enhanced DSP` en `SpectralView.ts`, con puntuación objetiva (`computeDspQualityScore`: fidelidad armónica, correlación de envolvente y SNR espectral).

---

## Fase 8 — Estándar de Audio Maestro (`Master Wave Format`), Expansión de Loops y Regeneración (DSP + IA) ✅ COMPLETADA

**Objetivo**: Regenerar las ondas a partir de la librería actual (`NeuronDB`), o mejorar muestras procedentes de SoundFonts antiguos y grabaciones propias, llevándolas todas a un estándar de audio maestro de máxima calidad (incluyendo extensión de loops cortos y espacialización Estéreo/Surround) antes de re-analizarlas.

### 8.1 Definición del Estándar de Audio Maestro (`Enhanced Wave Standard`)
- [x] Establecer un formato canónico de preservación y trabajo para las ondas mejoradas (`src/core/dsp/WavDecoder.ts` `encodeWavPcm24` + `src/core/dsp/MasterWaveEnhancer.ts`):
  - **Profundidad de bits**: `24-bit PCM` con dithering TPDF determinista y chunk `smpl` de marcas de loop embebido (con procesamiento interno en `32-bit / 64-bit IEEE Float`).
  - **Frecuencia de muestreo**: `96.000 Hz` (upsampling sinc con ventana de fase lineal para evitar aliasing en manipulaciones espectrales y permitir extensión armónica hasta 42–48 kHz).
  - **Canales y Espacialización (Mono / Estéreo / Surround / Pseudo-Surround)** (`expandSpatialChannels` + `downmixToClassicMono44k1`):
    - Conservar **Canales Originales (Mono o Estéreo)** o expandir mediante síntesis espacial coherente a **Estéreo (2.0)** (`+Side`/`-Side` 100% mono-compatible) y **Quad / Surround (4.0)** (`[FL, FR, RL, RR]`, recuperando y superando el concepto cuadrafónico del Hartmann Neuron hardware original, mientras se mantiene una reducción limpia en fase a Mono 44.1 kHz para el binario clásico).
- [x] Pipeline de promoción a formato maestro con tres vías seleccionables (`promoteBufferToMasterWave`):
  1. **Conversión Directa (`direct-conversion`)**: Resampling sinc de fase lineal y conversión a 24-bit / 96 kHz.
  2. **Mejora por Algoritmos DSP Modernos (`dsp-enhanced`, 100% en navegador/Worker)**: Puerta de de-noising de cuantización + Extensión de Ancho de Banda Armónica (BWE ultrasónico hasta 42 kHz).
  3. **Mejora por Modelos de IA (`ai-bridge`, Puente Local o Híbrido)**: Conector `AudioEnhancementProvider` (`HttpAiBridgeProvider` + fallback transparente a `dsp-enhanced`).

### 8.2 Ampliación Inteligente de Loops Cortos (`Loop Expansion & Auto-Loop Relocator`)
- [x] Para muestras de `.sf2` o WAVs con bucles muy cortos (que producen efecto estático o "metralleta") (`expandShortLoopAndRelocate` + `findOptimalZeroCrossingLoop`):
  - **Extensión de duración a $X$ segundos (ej. 3 a 6 s)**: Desenrollar el bucle original con crossfade de igual potencia (`sin`/`cos`) y aplicar **micro-modulación orgánica no repetitiva de fase/formantes/respiración** (o *Audio Outpainting* vía puente IA) para que el sostenido evolucione de forma viva sin repeticiones idénticas perceptibles.
  - **Recálculo automático de las marcas de Loop (`Auto-Loop Finder`)**: Buscar automáticamente los nuevos puntos `loopStart` y `loopEnd` óptimos ajustados al nuevo tiempo de $X$ segundos (cruce por cero ascendente con máxima correlación cruzada normalizada `NCC` y cierre libre de clics) y grabarlos tanto en el chunk `smpl` del WAV de 24-bit / 96 kHz como en nuestra definición nativa (`ExtendedRegion`).

### 8.3 Regeneración desde la Librería Original (`NeuronDB` `.scape` + `.sphere` $\rightarrow$ WAV Maestro)
- [x] Reconstrucción avanzada desde modelos de `NeuronDB` (`regenerateMasterWaveFromModel`):
  - Interpolación por **splines cúbicos Catmull-Rom** entre las tramas de `.sphere` para eliminar escalones temporales.
  - Síntesis de fase continua coherente e inyección de la envolvente de `.scape`.
  - Aplicación de **Extensión de Ancho de Banda (BWE)**, limpieza de ruido de cuantización (*spectral gating*) y espacialización Estéreo/Quad Surround a `24-bit / 96.000 Hz`.

### 8.4 Integración con Modelos de IA (Arquitectura de Conexión)
- [x] Soportar la interfaz de proveedores de restauración IA (`AudioEnhancementProvider` / `registerAiEnhancementProvider` / `HttpAiBridgeProvider`):
  - **AudioSR / Super-Resolución (`audiosr`)**: Reconstrucción neuronal de armónicos superiores hasta 48/96 kHz.
  - **Demucs / Separación Transitorio-Cuerpo (`htdemucs`)**: Separación quirúrgica de excitación (`Scape`) y resonancia (`Sphere`).
  - **BigVGAN / Vocoders Neuronales & Audio Outpainting (`bigvgan`, `outpaint-loop`)**: Reconstrucción de fase orgánica y extensión natural de bucles cortos.

---

## Fase 9 — Contenedor Multiformato ("Cápsula del Tiempo" Anti-Efecto Fotocopia) e `IndexedDB` (100% COMPLETADA)

**Objetivo**: Guardar en nuestro paquete de modelo todas las etapas del sonido (si existen) junto con las definiciones en nuestro formato nativo, evitando para siempre el "efecto fotocopia" al reprocesar en el futuro con mejores algoritmos.

### 9.1 Estructura de las 5 Capas del Contenedor Multiformato
Cada modelo empaquetado almacena de forma estructurada y trazable (`src/core/timeCapsule.ts`):
1. **`01_raw_source/` (Onda Original WAV/AIFF + Mapa Nativo)**:
   - Los archivos WAV/AIFF originales sin alterar (aportados por el usuario o extraídos de un SF2/SFZ al importarlo) junto con `native_map.json` (zonas, regiones 2D, velocidades y loops).
2. **`02_legacy_original/` (Binario Clásico Original)**:
   - Los archivos `MName`, `map.script`, `*.scape` y `*.sphere` originales e intactos de fábrica (cuando el modelo proviene de `NeuronDB`).
3. **`03_enhanced_audio/` (Onda Mejorada / Regenerada — Estándar Maestro 24-bit / 96 kHz)**:
   - Las ondas regeneradas desde (2) (`regenerateMasterWaveFromLegacyBinaries`) o mejoradas desde (1) (`promoteBufferToMasterWave`) en formato maestro (`24-bit`, `96.000 Hz`, Mono/Estéreo/Quad Surround, con marcas de loop extendidas).
4. **`04_classic_enhanced/` (Binario Clásico Mejorado)**:
   - Los archivos `MName`, `map.script`, `*.scape` y `*.sphere` 100% compatibles con el modo clásico del sintetizador, calculados a partir de (3) o (1).
5. **`05_extended_model/` (Modelo Expandido / Neural / Surround)**:
   - `model.nmmodel` (Float32 JSON de alta resolución) y `extended_map.json` (regiones 2D, articulación DAHDSR/Filtro/LFO y configuración Surround), calculados siempre desde (3) o (1).

### 9.2 Regla de Linaje ("Cero Efecto Fotocopia") y Persistencia en `IndexedDB`
- [x] Metadatos de procedencia (`provenance.json` y `manifest.json`): registra con qué versión de algoritmo/IA y a partir de qué capa fuente (`01_raw_source` o `02_legacy_original`) se generó cada capa derivada (`ModelProvenance`, `TimeCapsuleManifest`).
- [x] Al ejecutar **`reprocessFromPurestSource` ("Reprocess Purest Source")**, el motor resuelve automáticamente la fuente primaria más pura disponible (`resolvePurestSourceForSample`: `01` o `02` $\rightarrow$ `03` $\rightarrow$ `04`/`05`), sin recomprimir jamás un binario `04_classic_enhanced` ya degradado.
- [x] **Persistencia de activos pesados en `IndexedDB` (`src/core/storage/NeuronAssetStore.ts`)**: Mantiene configuraciones ligeras en `localStorage` y almacena las 5 capas binarias (`raw_sources`, `legacy_originals`, `enhanced_audio`, `model_capsules`) en `IndexedDB` con caché write-through en memoria y fallback automático para tests en Node.js.

### 9.3 Tarea a Estudiar: Exportación Clásica Pura, Gestión de Librerías NeuronDB y Cifrado de Contenedor

> *Nota: Se abordará una vez validado empíricamente en las pruebas que el contenido del paquete actual satisface todas las necesidades del sintetizador y del diseñador sonoro.*

- [ ] **Exportación Exclusiva en Formato Clásico (`Legacy Hardware/Software Only`)**:
  - Opción de exportar un paquete depurado que contenga **únicamente la estructura clásica original** (`Models/<NNN>.model/` con `MName`, `map.script`, `.scape`, `.sphere` y `Sounds/<NNN>.sound/` con `sound.script`, `sound.stickrec`), omitiendo las capas de preservación cruda o moderna cuando el destino sea estrictamente volcar a CompactFlash para el teclado hardware Hartmann Neuron o para el plugin clásico `NeuronVS`.
  - Opción de **inyectar / actualizar modelos directamente** sobre una carpeta de librería `NeuronDB` existente seleccionada por el usuario (mediante File System Access API o descargador de reemplazo).
- [ ] **Generador y Reorganizador de Librerías Clásicas Nuevas (NeuronDB Manager)**:
  - Capacidad de **crear una librería completa nueva en formato antiguo** sin sobreescribir ni tocar la librería original de fábrica (`Factory NeuronDB`), tanto de forma manual (modelo a modelo) como en lotes (*batch* cuando se implemente la Fase 12).
  - **Herramientas de reorganización de la librería**:
    - Reordenar visualmente y reasignar números de slot (`000..511`).
    - Copiar, clonar y mover modelos entre diferentes librerías o bancos.
    - Reconstrucción y sincronización automática de los archivos índice de catálogo `ModelNames` y `SoundNames` de la librería para que el hardware y NeuronVS reconozcan los nombres sin corrupción de índices.
- [ ] **Extensión de Paquete Propia**:
  - Reemplazar la extensión genérica `.zip` por una extensión de marca propia (ej. `.abdnmodel`, `.axionikpack` o `.npack`).
- [ ] **Ofuscación y Protección contra Extracción Genérica**:
  - Alterar o encapsular la cabecera estándar de archivo mediante firma propietaria para evitar que herramientas de descompresión genéricas abran o despiecen las muestras por error.
- [ ] **Valoración de Cifrado Autenticado (Criptografía AES-256-GCM / Poly1305)**:
  - Analizar mecanismo de cifrado en reposo integrado con el plugin VST/CLAP/AU (`ABDAxionikVS` en C++ / JUCE 9) y `ABDNeuModMakr`, garantizando que bancos comerciales o modelos de autor solo puedan ser cargados y reproducidos por el motor oficial protegiendo la propiedad intelectual de las muestras.

---

## Fase 10 — Estrategia de Despliegue: Vendorizado de `ABDShared`, Vercel y CI/CD ✅ COMPLETADA

**Objetivo**: Permitir que `ABDNeuModMakr` funcione desplegado en la nube (Vercel / GitHub Pages) de forma 100% autónoma, sin renunciar a la potencia del hardware local cuando esté disponible.

- [x] **Vendorizado Sincronizado de `@abdsynths/shared` y `@abdsynths/midi-keyb` (`vendor:sync`)**:
  - Script automatizado (`scripts/vendorSync.js` y comando `npm run vendor:sync`) que empaqueta y sincroniza los módulos compartidos (`Components`, `Contracts`, `Utils`, `Code/NeuronFormats`, `Assets/styles`, `Assets/themes`, `Assets/icons`, `Assets/fonts`, `@abdsynths/midi-keyb`) en `vendor/@abdsynths/`.
  - Configuración autocontenida `file:./vendor/@abdsynths/...` en `package.json` para que GitHub y Vercel compilen el proyecto sin depender de rutas externas en disco.
- [x] **Configuración de Despliegue Vercel SPA (`vercel.json`)**:
  - Configuración nativa de Vite SPA con enrutamiento limpio, rewrite a `index.html`, inmutabilidad de caché para `/assets/` (1 año), revalidación de HTML (`max-age=0, must-revalidate`) y cabeceras de seguridad (`nosniff`, `DENY`, `strict-origin-when-cross-origin`).
- [x] **Modo 100% Web / Vercel (Client-Side Puro — Despliegue en Producción)**:
  - Todo el núcleo TypeScript, Web Workers, importadores `.sf2`/`.sfz`, algoritmos DSP mejorados, resíntesis a 96 kHz y visualizadores corren directamente en el navegador del usuario.
  - Conexión de repositorio en dashboard de Vercel y publicación de la URL pública [https://abd-neumodmakr.vercel.app/](https://abd-neumodmakr.vercel.app/) verificada sin errores de consola.
- [x] **Soporte PWA / Offline (Progressive Web App Instalable en Escritorio)**:
  - Manifiesto web (`manifest.webmanifest`) con soporte standalone, iconos y colores de tema dark.
  - Service Worker (`public/sw.js`) con estrategia híbrida (Network-First para HTML, Cache-First para bundles `/assets/` y Stale-While-Revalidate para estáticos), permitiendo arrancar y trabajar 100% desconectado de internet.
  - Integración en la interfaz desde `Help -> Install Desktop App (PWA)...` y eventos `beforeinstallprompt` / `appinstalled`.
- [ ] **Modo Híbrido con Puente Local ("Local Companion Bridge")**:
  - Aun abriendo la aplicación desde la URL de Vercel (o en `localhost`), la web detecta opcionalmente si hay un micro-servidor local corriendo en la máquina del usuario (`http://127.0.0.1:8389` en Python/FastAPI o C++) con acceso a la GPU local (CUDA/MPS) y al sistema de archivos (`NeuronDB`) para ejecutar modelos de IA pesados (AudioSR, Demucs, entrenamientos de espacio latente) a máxima velocidad.

---

## Fase 11 — Procesado del Modo Extendido, Modelos Surround y Nuevos Resynators (`ABDAxionikVS`)

> *Nota: Se abordará una vez consolidadas las fases anteriores, ya que implica diseñar nuevos motores de resíntesis (`Resynators`) y buses multicanal en el sintetizador C++ / JUCE 9.*

- [ ] **Formato Espectral de Alta Definición y Campos de Vectores / Espacio Latente**:
  - Superar el límite de 64 parciales y 16 tramas; separación explícita entre envolvente espectral (formantes) y pitch para *Formant Shifting* real.
  - Representación mediante **campos vectoriales de morphing** o coordenadas en un espacio latente neuronal (Autoencoder / VAE) para que los joysticks `Scape` y `Sphere` interpolen características acústicas reales en 2D/3D.
- [ ] **Modelos Estéreo, Surround (Quad 4.0 / 5.1) y Pseudo-Surround Espectral**:
  - Recuperar y expandir el espíritu Surround del Hartmann Neuron hardware original: mientras el formato clásico era mono y solo paneaba al final, nuestro modelo extendido permitirá **información espacial real por componente y por capa**:
    - Ejemplo de separación espacial nativa: **Excitación (`Scape`)** enfocada y definida en el plano frontal (`Front L/R`) mientras la **Resonancia del cuerpo (`Sphere`)** o las capas secundarias (`Layers 1..3`) envuelven al oyente en los canales traseros (`Rear L/R`) o mediante decorrelación espectral de fase (Pseudo-Surround compatible con Estéreo / Binaural y con buses 4.0/5.1 en JUCE 9).
- [ ] **Ataques PCM Híbridos + Cuerpo Resintetizado**:
  - Disparo del transitorio original a 24-bit/96 kHz en los primeros milisegundos fundido en fase con el *Resynator* extendido en `ABDAxionikVS`.
- [ ] **Morphing Continuo de Velocidad y Altura**:
  - Aprovechar en el sintetizador las $N$ capas de velocidad, crossfades y envolventes capturadas en el Modo de Creación Extendido (Fase 6).

---

## Fase 12 — Procesamiento por Lotes (`Batch Processor`) *(Pospuesto para fase final)*

> *Nota: Se pospone hasta haber validado y afinado los algoritmos yendo modelo por modelo en la interfaz.*

- [ ] Utilidad de procesamiento desatendido por lotes sobre carpetas completas (`NeuronDB` con sus ~500 modelos, o conversión masiva de colecciones `.sf2`/`.sfz`).
- [ ] Cola de trabajos con reporte de métricas de calidad, detección de errores y generación automática de los contenedores multiformato de 5 capas.

---

## Fase 13 — Editor Visual Interactivo de Loops (`Waveform Loop Editor`) ✅ COMPLETADA

> *Nota: Implementado en `SpectralView.ts` (pestaña `LOOP EDITOR`), `ZoneInspector.ts` (cajón integrado `Waveform Loop Editor`) y `src/core/dsp/LoopEditorTools.ts`.*

- [x] **Visor de Onda Interactivo con Marcas de Loop (`Loop Start` / `Loop End` / `Crossfade`)**:
  - Visualización de la forma de onda completa con zoom horizontal (`1x .. 32x`, rueda de ratón y botones) y cursores arrastrables a mano para `Loop Start` (`L-START`), `Loop End` (`L-END`) y rampa visual de `Loop Crossfade`.
  - **Vista de Empalme / Cruce por Cero (`Loop Seam / Zero-Crossing Magnifier`)**: Ventana de zoom de alta precisión (panel derecho 30%) donde se superponen el final (`loopEnd`) y el principio (`loopStart`) del bucle junto con las curvas fantasma de continuación y métricas en vivo (`Seam Quality %`, `ΔStep`, `NCC`).
  - **Controles y Lectura en Vivo**: Valores numéricos en muestras (`frames`) y tiempo (`s`), selector de tipo de loop (`no_loop`, `loop_continuous`, `loop_sustain`, `ping_pong`, `loop_backward`, `one_shot`), *Snap to Zero-Crossing* automático (`snapFrameToRisingZeroCrossing`) y audición en bucle en tiempo real (`auditionLoopSample` + `updateLiveLoopPoints`) mientras se arrastran los marcadores.
- [x] **Motor Auto-Loop Multi-Algoritmo (`findSmartAutoLoop`)**:
  - `pitch_periodic`: sincronización exacta con el período fundamental $T_0 = f_s / f_0$ de la nota para preservar afinación perfecta y fase armónica continua sin saltos.
  - `ncc_zc`: correlación cruzada normalizada entre ventanas de empalme con restricción de cruce por cero de pendiente positiva.
  - `min_seam_energy`: minimización de energía del paso de discontinuidad $\Delta \text{Step}$ entre el final y el comienzo del bucle.
  - `equal_power_xfade`: optimización de longitud de empalme para crossfade circular de igual potencia.
- [x] **Modos de Bucle Avanzados y Badges Visuales**:
  - Soporte para **Ping-Pong (`ping_pong`)**: síntesis en vivo del búfer reflejado espejo adelante-atrás con insignia `⇄ PING-PONG` en el canvas.
  - Soporte para **Bucle en Reversa (`loop_backward`)** con insignia `← REVERSE`.
- [x] **Audición Instantánea en Lista de Zonas / Regiones (`.btn-row-play`)**:
  - Botón de reproducción interactivo `Play` / `Stop` en cada fila junto al botón de engranaje de configuración.
  - Mapeo unívoco: cada zona (en Modo Clásico) o región (en Modo Extendido) reproduce con exactitud su propia muestra asignada.
  - Procesamiento Web Audio completo en vivo: Envolvente de amplitud DAHDSR de 6 etapas (*Delay*, *Attack*, *Hold*, *Decay*, *Sustain*, *Release*), balance de panorama estéreo (`StereoPannerNode`), volumen de región en dB y desafinación (*Detune*) en cents, con parada suave anti-clic.

---

## Fase 14 — Portada / Artwork del Modelo en Formato `.webp` (Exclusivo Modo Extended) ✅ COMPLETADA

> *Nota: Exclusivo del Modo Extendido (`.nmmodel` y capa `05_extended_model/cover.webp`). El formato hardware clásico `.model` de 2001 se mantiene intacto sin imagen para preservar compatibilidad binaria estricta.*

- [x] **Selector y Zona Drag & Drop de Portada (`Model Cover Artwork`)**:
  - Asignación de imagen de portada al modelo en modo `Extended` en `ProcessPanel.ts` (mediante carga de archivos `PNG`, `JPG`, `WEBP`, `AVIF`, `SVG` o Drag & Drop).
  - **Conversión y Optimización Automática a `.webp` en Cliente (`src/core/coverArtwork.ts`)**: Redimensionado cuadrado `512×512` con recorte centrado (`cover`) y codificación automática a **`cover.webp`** (`data:image/webp;base64,...` + binario RIFF WEBP).
  - **Modal de Inspección en Alta Definición (`dlg-cover-preview`)**: Botón "Ver en grande" y click sobre la miniatura para abrir un diálogo modal accesible (`<dialog>`) con visualización 512×512, cuadrícula de metadatos técnicos (dimensiones, formato, tamaño en KB, timestamp) y opciones de reemplazo o eliminación.
  - **Persistencia Robusta en Esquema de Sesión y Banco**: Validación y preservación de `coverArtwork` y `commonPlayback` en `sessionSchema.ts`, persistencia en `localStorage`, `BankDrawer.ts` y empaquetado en la capa `05_extended_model/cover.webp` de la `Time Capsule` (.zip).

---

## Fase 15 — Testing, CI/CD y Distribución

- [x] Suite de tests automatizados Fases 1 a 8 (`npm test` + `npm run test:types`)
- [ ] Tests unitarios y de integración para clasificador acústico de Parameter Sets, motor DSP mejorado, estándar 24-bit/96 kHz, editor de loops, portada `.webp` y contenedor multiformato
- [x] Configuración de despliegue continuo en Vercel conectado al repositorio de GitHub ([https://abd-neumodmakr.vercel.app/](https://abd-neumodmakr.vercel.app/))
- [ ] Empaquetado opcional desktop (WebView2 / Tauri / Electron) junto al puente local de IA
