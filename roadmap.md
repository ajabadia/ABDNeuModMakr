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

# 🚀 Nueva Etapa: Evolución Next-Gen (Fases 6 a 12)

> Hoja de ruta para transformar `ABDNeuModMakr` en una factoría de modelos capaz de importar instrumentos complejos, mejorar la síntesis clásica con algoritmos modernos e IA, conservar el linaje completo de ondas sin "efecto fotocopia", y alimentar el motor extendido de `ABDAxionikVS` (C++ / JUCE 9).

---

## Fase 6 — Creación Dual (Clásica vs Extendida) e Importación Universal a Formato Nativo

**Objetivo**: Desacoplar el modo de edición/creación del formato de salida e incorporar un importador de formatos de sampler (`.sf2`, `.sfz`, etc.) que traduzca siempre a **nuestra propia definición nativa + WAVs/AIFFs** (sin guardar nunca el archivo `.sf2` o externo original).

### 6.1 Modo de Creación Conmutable (`Classic Creation` vs `Extended Creation`)
- [ ] Permitir alternar libremente en cualquier momento entre **Creación Clásica** y **Creación Extendida**, independientemente del formato en que luego se decida exportar:
  - **Modo de Creación Clásico**: Reglas estrictas de Hartmann MODELmaker v1.2 (bloques de notas contiguos `0..127` sin huecos ni solapamientos, columnas simétricas y máximo 2 capas de velocidad divididas en `64`).
  - **Modo de Creación Extendido** (inspirado en capacidades de SFZ, HALion, Kontakt y SampleTank):
    - **Mapa 2D libre ("Lego" de regiones)**: $N$ rangos de notas por $N$ rangos de velocidad (`loKey..hiKey` $\times$ `loVel..hiVel`) de tamaños arbitrarios e independientes.
    - **Crossfades en Altura y Velocidad (`keyFadeIn/Out`, `velFadeIn/Out`)**: Fundidos suaves entre zonas solapadas (en ganancia y/o en interpolación espectral).
    - **Modos de Loop (`no_loop`, `loop_continuous`, `loop_sustain`)**: Puntos `loopStart`, `loopEnd` y `loopCrossfade` para sostener instrumentos acústicos y pads.
    - **Seguimiento de Teclado (`pitchKeytrack`)**: Configurable de `0%` (percusión, baterías, efectos inarmónicos que no deben cambiar de pitch) a `100%` (instrumentos cromáticos) o valores intermedios.
    - **Modos de Disparo y Variación (`trigger: attack | release`, `roundRobin`)**: Soporte para muestras de *release* y secuencias de alternancia.

### 6.2 Importador de `.sf2` (SoundFont 2) y `.sfz` a Definición Nativa
- [ ] Parser binario de `.sf2` (chunks `INFO`, `sdta` de audio PCM y `pdta` de presets/instrumentos/zonas/generadores) con modal selector cuando el banco contenga múltiples presets.
- [ ] Parser de `.sfz` (`<global>`, `<group>`, `<region>`, opcodes `sample`, `lokey`, `hikey`, `pitch_keycenter`, `lovel`, `hivel`, `xf_*`, `volume`, `pan`, `tune`, `loop_*`, `trigger`).
- [ ] **Conversión inmediata a Formato Propio**: Al importar un `.sf2` o `.sfz` (o conversiones intermedias desde Kontakt/HALion/SampleTank), se extraen las muestras como WAV/AIFF independientes y se registran sus regiones en nuestro esquema nativo. El archivo `.sf2`/`.sfz` original se descarta tras la importación.

### 6.3 Compilador / Adaptador de Extendido $\rightarrow$ Clásico en Exportación
- [ ] Si se ha trabajado en Modo Extendido (o importado un instrumento complejo) y se exporta a **Clásico** (o a la capa clásica del contenedor multiformato):
  - **Particionado automático de columnas**: Proyectar los límites de nota sobre `0..127` garantizando cobertura continua sin huecos.
  - **Normalización y compensación de volumen**: Aplicar las ganancias individuales (`volumeDb` / atenuación SF2) directamente sobre la amplitud de las muestras o espectros antes de codificar.
  - **Reducción de $N$ velocidades a 2 franjas (`1..63` y `64..127`)**: Agrupar las regiones que caen en la mitad inferior y superior, permitiendo seleccionar la muestra representativa o realizar una **fusión/interpolación espectral ponderada** para generar un único par `.scape`/`.sphere` para `Low` y otro para `High`.

---

## Fase 7 — Autodetección Inteligente y Motor Clásico Mejorado (`Classic Enhanced`)

**Objetivo**: Obtener modelos 100% compatibles con el sintetizador clásico pero con calidad superior mediante nuevos algoritmos de análisis, manteniendo siempre la opción de usar el algoritmo original.

### 7.1 Autodetección de Nota Raíz ($f_0$) y Detector Percusivo / Ruido
- [ ] Mejorar el detector de frecuencia fundamental combinando **YIN / MPM (McLeod Pitch Method)** en dominio temporal con **HPS + Least-Squares** en dominio frecuencial.
- [ ] **Índice de Armonicidad / Confianza de Pitch**: Detectar automáticamente cuándo un sonido es **percusivo, inarmónico o ruido puro** (caja, plato, viento, FX) para no asignarle una fundamental errónea ni deformar la rejilla de parciales.

### 7.2 Clasificador Automático de los 10 Parameter Sets (`0..9`)
- [ ] Analizador de descriptores acústicos por muestra y conjunto de zonas:
  - Tiempo y pendiente de ataque (`Log-Attack Time`).
  - Coeficiente de inarmonicidad / rigidez física de parciales ($f_n$ frente a $n \cdot f_0$, clave para distinguir pianos, campanas y metales de cuerdas o vientos).
  - Relación Armónico-Ruido (`HNR`), *Spectral Flatness* y *Zero-Crossing Rate* (soplido/turbulencia).
  - Evolución temporal de la envolvente y detección de múltiples transitorios (para detectar bucles rítmicos de `Set 8: Loop Factory`).
- [ ] Selección automática del mejor `Parameter Set` (`0..9`) con indicador de confianza en la UI (y posibilidad de sobreescritura manual).

### 7.3 Nuevos Algoritmos para el Formato Clásico (`Legacy DSP` vs `Enhanced DSP`)
- [ ] Conmutador de algoritmo de procesado clásico para conservar el comportamiento exacto de 2001 junto al nuevo motor mejorado:
  - **Separación Transitorio / Estacionario (HPSS)**: Aislar el impacto/excitación real para el archivo `.scape` y dejar los parciales estacionarios limpios para el `.sphere`.
  - **Reasignación Tiempo-Frecuencia y Consistencia de Fase**: Estabilizar las trayectorias de los 64 parciales y sus offsets de frecuencia para eliminar el sonido metálico/fasmagórico.
  - **Ventanas STFT adaptativas según tipo de sonido y registro**: Mayor resolución temporal en ataques percusivos y mayor resolución frecuencial en notas graves/pads.
- [ ] **Comparador A / B / C y Métrica de Calidad (`Quality Score`)**: Audición instantánea entre `Onda Fuente` vs `Clásico Original` vs `Clásico Mejorado`, con puntuación objetiva de fidelidad espectral y de transitorios.

---

## Fase 8 — Estándar de Audio Maestro (`Master Wave Format`) y Regeneración / Upscaling (DSP + IA)

**Objetivo**: Regenerar las ondas a partir de la librería actual (`NeuronDB`), o mejorar muestras procedentes de SoundFonts antiguos y grabaciones propias, llevándolas todas a un estándar de audio maestro de máxima calidad antes de re-analizarlas.

### 8.1 Definición del Estándar de Audio Maestro (`Enhanced Wave Standard`)
- [ ] Establecer un formato canónico de preservación y trabajo para las ondas mejoradas:
  - **Profundidad de bits**: `24-bit PCM` (o `32-bit IEEE Float` en procesamiento interno).
  - **Frecuencia de muestreo**: `96.000 Hz` (upsampling de alta precisión para evitar aliasing en manipulaciones espectrales y permitir extensión armónica por encima de 20 kHz).
  - **Canales**: Conservar **Estéreo / Canales Originales** (o expansión pseudo-estéreo coherente en fase cuando se desee, manteniendo copia mono de referencia para el camino clásico `legacy-neuron`).
- [ ] Pipeline de promoción a formato maestro con tres vías seleccionables:
  1. **Conversión Directa**: Resampling sinc con ventana Kaiser-Bessel de fase lineal y conversión a 24-bit / 96 kHz.
  2. **Mejora por Algoritmos DSP Modernos (100% en navegador/Worker)**.
  3. **Mejora por Modelos de IA (Puente Local o Híbrido)**.

### 8.2 Regeneración desde la Librería Original (`NeuronDB` `.scape` + `.sphere` $\rightarrow$ WAV Maestro)
- [ ] Reconstrucción avanzada desde los ~500 modelos de `NeuronDB`:
  - Interpolación por splines cúbicos entre las tramas de `.sphere` para eliminar escalones temporales.
  - Síntesis de fase coherente e inyección de la envolvente y textura de excitación de `.scape`.
  - Aplicación de **Extensión de Ancho de Banda (BWE)**, limpieza de ruido de cuantización (*spectral gating*) y reconstrucción de transitorios para devolver definición a los modelos de 2001.

### 8.3 Integración con Modelos de IA (Arquitectura de Conexión)
- [ ] Soportar una interfaz de plugins/proveedores de restauración IA (`AudioEnhancementProvider`):
  - **AudioSR / Super-Resolución**: Reconstrucción neuronal de armónicos superiores hasta 48/96 kHz (ideal para resíntesis de `NeuronDB` y muestras SF2 antiguas de 22/32 kHz).
  - **Demucs / Separación Transitorio-Cuerpo**: Separación quirúrgica de excitación (`Scape`) y resonancia (`Sphere`).
  - **BigVGAN / Vocoders Neuronales**: Reconstrucción de fase orgánica a partir de espectrogramas de magnitud.

---

## Fase 9 — Contenedor Multiformato ("Cápsula del Tiempo" Anti-Efecto Fotocopia)

**Objetivo**: Guardar en nuestro paquete de modelo todas las etapas del sonido (si existen) junto con las definiciones en nuestro formato nativo, evitando para siempre el "efecto fotocopia" al reprocesar en el futuro con mejores algoritmos.

### 9.1 Estructura de las 5 Capas del Contenedor Multiformato
Cada modelo empaquetado podrá almacenar de forma estructurada y trazable:
1. **`01_raw_source/` (Onda Original WAV/AIFF + Mapa Nativo)**:
   - Los archivos WAV/AIFF originales sin alterar (aportados por el usuario o extraídos de un SF2/SFZ al importarlo) junto con el manifiesto JSON de zonas/velocidades/loops en nuestro propio formato.
2. **`02_legacy_original/` (Binario Clásico Original)**:
   - Los archivos `MName`, `map.script`, `*.scape` y `*.sphere` originales de fábrica (cuando el modelo proviene de `NeuronDB`).
3. **`03_enhanced_audio/` (Onda Mejorada / Regenerada — Estándar Maestro 24-bit / 96 kHz)**:
   - Las ondas regeneradas desde (2) o mejoradas desde (1) mediante nuestros algoritmos DSP o modelos de IA, en formato maestro (24-bit, 96 kHz, canales originales/estéreo).
4. **`04_classic_enhanced/` (Binario Clásico Mejorado)**:
   - Los archivos `MName`, `map.script`, `*.scape` y `*.sphere` 100% compatibles con el modo clásico del sintetizador, pero calculados con los nuevos algoritmos de la Fase 7 a partir de (3) o (1).
5. **`05_extended_model/` (Modelo Expandido / Neural)**:
   - El formato definitivo para el modo extendido del sintetizador (matrices de alta resolución, campos de vectores / espacio latente IA, transitorios PCM reales y mapa 2D completo), calculado siempre desde (3) o (1).

### 9.2 Regla de Linaje ("Cero Efecto Fotocopia")
- [ ] Metadatos de procedencia (`provenance.json`): registra con qué versión de algoritmo/IA y a partir de qué capa fuente (`01_raw_source` o `02_legacy_original`) se generó cada capa derivada.
- [ ] Al pulsar **"Reprocesar con Nuevos Algoritmos"**, el motor toma automáticamente la fuente primaria más pura disponible (`01` $\rightarrow$ `03` $\rightarrow$ `04`/`05`), sin recomprimir jamás un binario ya degradado.

---

## Fase 10 — Estrategia de Despliegue: Local, Cloud (GitHub / Vercel) o Híbrido

**Objetivo**: Permitir que `ABDNeuModMakr` funcione desplegado en la nube (Vercel / GitHub Pages) desde cualquier navegador, sin renunciar a la potencia del hardware local cuando esté disponible.

- [ ] **Modo 100% Web / Vercel (Client-Side Puro)**:
  - Todo el núcleo TypeScript, Web Workers, importadores `.sf2`/`.sfz`, algoritmos DSP mejorados, resíntesis a 96 kHz y modelos ligeros en **WebGPU / ONNX Runtime Web (`@huggingface/transformers`)** corren directamente en el navegador del usuario.
  - Desplegable gratuitamente en **Vercel** o **GitHub Pages** como SPA estática (cero coste de servidor).
- [ ] **Modo Híbrido con Puente Local ("Local Companion Bridge")**:
  - Aun abriendo la aplicación desde la URL de Vercel (o en `localhost`), la web detecta opcionalmente si hay un micro-servidor local corriendo en la máquina del usuario (`http://127.0.0.1:8389` en Python/FastAPI o C++) con acceso a la GPU local (CUDA/MPS) y al sistema de archivos (`NeuronDB`) para ejecutar modelos de IA pesados (AudioSR, Demucs, entrenamientos de espacio latente) a máxima velocidad.

---

## Fase 11 — Procesado del Modo Extendido y Nuevos Resynators (Coordinado con `ABDAxionikVS`)

> *Nota: Se abordará una vez consolidadas las fases anteriores, ya que implica diseñar nuevos motores de resíntesis (`Resynators`) en el sintetizador C++ / JUCE 9.*

- [ ] **Formato Espectral de Alta Definición y Campos de Vectores / Espacio Latente**:
  - Superar el límite de 64 parciales y 16 tramas; separación explícita entre envolvente espectral (formantes) y pitch para *Formant Shifting* real.
  - Representación mediante **campos vectoriales de morphing** o coordenadas en un espacio latente neuronal (Autoencoder / VAE) para que los joysticks `Scape` y `Sphere` interpolen características acústicas reales en 2D/3D.
- [ ] **Ataques PCM Híbridos + Cuerpo Resintetizado**:
  - Disparo del transitorio original a 24-bit/96 kHz en los primeros milisegundos fundido en fase con el *Resynator* extendido en `ABDAxionikVS`.
- [ ] **Morphing Continuo de Velocidad y Altura**:
  - Aprovechar en el sintetizador las $N$ capas de velocidad y crossfades definidos en el Modo de Creación Extendido (Fase 6).

---

## Fase 12 — Procesamiento por Lotes (`Batch Processor`) *(Pospuesto para fase final)*

> *Nota: Se pospone hasta haber validado y afinado los algoritmos yendo modelo por modelo en la interfaz.*

- [ ] Utilidad de procesamiento desatendido por lotes sobre carpetas completas (`NeuronDB` con sus ~500 modelos, o conversión masiva de colecciones `.sf2`/`.sfz`).
- [ ] Cola de trabajos con reporte de métricas de calidad, detección de errores y generación automática de los contenedores multiformato de 5 capas.

---

## Fase 13 — Testing, CI/CD y Distribución

- [x] Suite de tests automatizados Fases 1 a 5 (`npm test` + `npm run test:types`)
- [ ] Tests unitarios y de integración para importadores SF2/SFZ, clasificador de Parameter Sets, estándar 24-bit/96 kHz y contenedor multiformato
- [ ] Configuración de despliegue continuo en Vercel conectado al repositorio de GitHub
- [ ] Empaquetado opcional desktop (WebView2 / Tauri / Electron) junto al puente local de IA
