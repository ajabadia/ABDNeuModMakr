# 🔄 ABDNeuModMakr — Handoff

> Estado del proyecto a **2026-10-26**. Lee este archivo al inicio de cualquier conversación nueva para obtener contexto completo.

---

## 1. ¿Qué es ABDNeuModMakr?

Reinterpretación moderna del **Hartmann Neuron MODELmaker v1.2** como aplicación web autónoma (no plugin DAW). Analiza muestras de audio, particiona el teclado MIDI 0..127 en zonas y genera archivos `.model` / `.sound` compatibles tanto con el hardware Neuron original como con el futuro sintetizador software ABDNeural / NEURONiK.

### Decisión arquitectónica clave: "Separado y Web"

- **No se ata a JUCE 9 ni a un plugin VST/CLAP/AU.**
- Pipeline dual: TypeScript nativo (FFT + peak-picking vía Web Audio / Web Workers) como implementación principal, con opción futura de WASM/C++ para batch CLI.
- La UI se comunica **solo** a través de la interfaz `CoreService` — nunca invoca DSP directamente.

---

## 2. Stack tecnológico

| Capa | Tecnología | Notas |
|---|---|---|
| Build tool | **Vite 8.3** | Puerto fijo `8388`, `strictPort: true` |
| Lenguaje | **TypeScript 6.0** | Strict, `erasableSyntaxOnly` |
| Diseño | `@abdsynths/shared` (workspace pnpm) | `tokens.css`, paletas temáticas, `SynthNavBar` |
| Iconos | SVG vectoriales en `ABDShared/Assets/icons` | Policy: Zero Emojis, `currentColor` |
| Monorepo | `pnpm-workspace.yaml` en `D:\desarrollos\ABDSynths` | `ABDShared` como `@abdsynths/shared` |

---

## 3. Estructura actual del proyecto

```
ABDNeuModMakr/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── start.bat              ← Lanzador: mata puerto, abre browser, arranca Vite
├── .gitignore
├── README.md
├── public/
├── DOCS/
│   ├── NEURON_MM_SPEC.md            ← Especificación técnica de ingeniería inversa (NASAnalysis.dll, .scape/.sphere, map.script)
│   ├── ARCHITECTURE_DUAL_TARGET.md  ← Diseño Dual-Target (legacy-neuron vs modern-neural) y estado de extracción (100% resuelto)
│   └── NASANALYSIS_DECOMPILATION.md ← Descompilación completa de NASAnalysis.dll con REA/Ghidra 12.1.4 (direcciones, constantes y algoritmos)
├── tests/
│   ├── phase1_pipeline.test.ts      ← Suite de verificación de Fase 1 (WAV/AIFF, FFT/STFT, HPS+LS, Clustering, Scape/Sphere)
│   ├── phase2_formats.test.ts       ← Suite de verificación de Fase 2 (.scape, .sphere, map.script, .sound, y NeuronDB real 511.model/000.sound)
│   ├── phase3_files.test.ts         ← Suite de verificación de Fase 3 (PKZIP, Import by Name vs Import Samples, .nmsession.json, import/export .model/.zip)
│   ├── phase4_spectral.test.ts      ← Suite de verificación de Fase 4 (Espectrograma 2D 37x96, trazas de 64 parciales por capa, envolventes A/B)
│   └── phase5_ux.test.ts            ← Suite de verificación de Fase 5 (Undo/Redo stack, coalescencia de sliders, validación ProcessConfig, autoRepairCoverage)
├── src/
│   ├── main.ts            ← Bootstrap + orquestación de eventos conectado a WebAudioPipeline
│   ├── style.css           ← Master stylesheet (24 KB), importa @abdsynths/shared/styles
│   ├── formats/
│   │   ├── ZipArchive.ts   ← Lector/Escritor PKZIP sin dependencias (CRC-32 IEEE 802.3 + STORE)
│   │   ├── ModelFormat.ts  ← Reader/Writer binario de .scape (csAN), .sphere (psAN + Phase Vocoder 6152B), map.script, MName, ModelNames, buildModelExportZip y parseModelFileSet
│   │   └── SoundFormat.ts  ← Reader/Writer del esquema de 445 parámetros de sound.script, migración v1, clamping FUN_100014c0, sound.stickrec y SoundNames
│   ├── core/
│   │   ├── CoreService.ts  ← Interfaz abstracta (contrato UI↔engine)
│   │   ├── types.ts        ← Domain types: Zone, Session, ProcessConfig, ZoneAnalysisSummary, etc.
│   │   ├── WebAudioPipeline.ts ← Implementación real de CoreService (DSP + Web Worker + Web Audio preview)
│   │   ├── MockCore.ts     ← Implementación mock conservada como referencia
│   │   ├── dsp/
│   │   │   ├── WavDecoder.ts       ← Decodificador RIFF/WAVE (PCM 8/16/24/32, Float 32/64) + FORM/AIFF (IEEE-80)
│   │   │   ├── FftEngine.ts        ← Radix-2 Cooley-Tukey FFT (4096/8192) + ventanas + STFT
│   │   │   ├── SpectralAnalyzer.ts ← Detector F0 (HPS + Least Squares 2 pasadas), 64 parciales, sub-rejilla f0/2
│   │   │   ├── LayerClustering.ts  ← Clustering de trazas temporales en hasta 4 capas (descriptores / coseno)
│   │   │   ├── GridIndicator.ts    ← Modelo espectral multi-capa (`SpectralModelData`) y semáforo de residuo
│   │   │   ├── ScapeSphereGenerator.ts ← Serializador binario `.scape` (`csAN`), `.sphere` (`psAN`), `map.script`, resíntesis
│   │   │   └── PipelineRunner.ts   ← Orquestador multi-zona compartido entre Worker y fallback
│   │   └── worker/
│   │       └── analysisWorker.ts   ← Web Worker no bloqueante para el análisis espectral multi-zona
│   ├── ui/
│   │   ├── Navbar.ts       ← AppNavbar (SynthNavBar + menús + pill de estado)
│   │   ├── ZoneRibbon.ts   ← Mapa visual de las 128 notas MIDI con zonas
│   │   ├── ZoneInspector.ts ← Editor de zonas (Low/Root/High Key, samples, detune, volume, pan)
│   │   ├── SpectralView.ts  ← Monitor espectral 2D + 64 parciales + comparación A/B y vúmetro dBFS en vivo
│   │   ├── ProcessPanel.ts  ← Config de modelo (slot, nombre, complejidad, parameter set)
│   │   ├── KeyboardStrip.ts ← Teclado de piano interactivo
│   │   ├── ProcessModal.ts  ← Modal de progreso de resíntesis
│   │   ├── TelemetryDrawer.ts ← Auditoría de cobertura continua
│   │   ├── BankDrawer.ts    ← Biblioteca de modelos + exportación
│   │   └── icons.ts         ← SVG icon library (inline, currentColor)
│   ├── types/
│   │   └── shared.d.ts     ← Declaraciones ambientales para @abdsynths/shared
│   └── assets/
```

---

## 4. Qué ESTÁ hecho (✅)

- [x] **Toda la capa UI** — 9 componentes completos conectados a `WebAudioPipeline`
- [x] **CoreService interface** — Contrato limpio con tipos estrictos
- [x] **Fase 1 — Pipeline de audio TypeScript (`WebAudioPipeline`)** — Implementación real de `CoreService` sin dependencias externas:
  - [x] Decodificador nativo WAV (`RIFF/WAVE` PCM 8/16/24/32 + IEEE Float 32/64) y AIFF (`FORM/AIFF` con IEEE 80-bit float)
  - [x] Motor FFT/STFT Radix-2 Cooley-Tukey (`4096`/`8192` puntos, ventanas Blackman-Harris, Hanning, Blackman, Hamming)
  - [x] Detector de pitch F0 híbrida (HPS refinado + ajuste Least-Squares de 2 pasadas) y peak-picking de 64 parciales con interpolación parabólica sub-bin
  - [x] Detección de sub-rejilla entrelazada (`f0/2`), puerta de plegado de octava y clustering de capas (`propia` / `entrelazada` / descriptores)
  - [x] Generador binario auténtico `.scape` (`csAN` + `mnAN` + `fdAN`) y `.sphere` (`psAN` + tramas de 6568 bytes con banco aditivo Phase-Vocoder de 1024 parciales en unidades de `0.5 Hz`), `map.script`, y `.neuronikmodel` v2/v2.1
  - [x] Resíntesis aditiva de verificación (`resynthesizeModelToPcm`) y reproducción Web Audio API (`auditionSample` / `auditionResynthesis`)
  - [x] Web Worker no bloqueante (`analysisWorker.ts`) con telemetría por zona y suite de tests (`tests/phase1_pipeline.test.ts`)
- [x] **Fase 2 — Lectores/Escritores binarios `.model` y `.sound` + Descompilación 100% de `NASAnalysis.dll` (REA / Ghidra 12.1.4)**:
  - [x] `src/formats/ModelFormat.ts` — Reader/Writer completo de `.scape` (`csAN`), `.sphere` (`psAN`), `map.script` (1027 líneas canónicas + `add mapentry`), `MName`, `ModelNames` (`000..511`), resíntesis de tramas/curvas y puente `convertLegacyModelToModern`
  - [x] `src/formats/SoundFormat.ts` — Esquema completo de 445 parámetros (`sound.script`), migración v1 `BlenderAmount`, clamping `FUN_100014c0`, `sound.stickrec` y `SoundNames` (`000..999`)
  - [x] Importación real de muestras WAV/AIFF en UI (`ZoneInspector.ts` + `main.ts` con file picker y Drag & Drop)
  - [x] Verificado contra la base de datos real `NeuronDB` (`Models/511.model` "sinew" y `Sounds/000.sound` "Symbiont") en `tests/phase2_formats.test.ts`
- [x] **Fase 3 — Gestión de archivos, empaquetado PKZIP Dual-Target, `Import by Name` (`Ctrl+N`) vs `Import Samples` (`Ctrl+I`), importación de `.model`/`.zip` y persistencia**:
  - [x] `src/formats/ZipArchive.ts` — Lector/Escritor PKZIP en TypeScript puro (CRC-32 IEEE 802.3 + `STORE`)
  - [x] `buildModelExportZip` y `parseModelFileSet` en `src/formats/ModelFormat.ts` — Empaquetado completo de `Models/<NNN>.model/` (`MName`, `map.script`, `%06d.scape`, `%06d.sphere`), `Sounds/<NNN>.sound/` (`sound.script`, `sound.stickrec`) y `Modern/<NNN>_<Name>.neuronikmodel`
  - [x] `Import by Name (Ctrl+N)` (`parseSampleFilenameByName` soportando `name_rootkey_lowkey[_v1|_v2]` y `_high`, fusión de capas de velocidad y zonas contiguas `0..127`) vs `Import Samples (Ctrl+I)` (lectura de chunks `INST`/`smpl` + fallback de pitch por autocorrelación)
  - [x] Importación directa de archivos `.model` / `.zip` en la UI (`importModelFiles`) con resíntesis de tramas `.sphere`/`.scape` a WAV PCM16 reproducible
  - [x] Persistencia automática en `localStorage` y exportación/apertura de sesiones `.nmsession.json` (`Ctrl+S` / `Ctrl+O`)
  - [x] Verificado con `tests/phase3_files.test.ts` (incluyendo importación real de `NeuronDB/Models/511.model`)
- [x] **Fase 4 — Visualización Espectral 2D, Overlay de Parciales por Capa y Comparación A/B (`SpectralView.ts`)**:
  - [x] `inspectZoneSpectrum(zoneId)` en `WebAudioPipeline.ts` con caché en memoria (espectrograma 2D STFT Blackman-Harris `37x96`, 64 parciales etiquetados por capa `0..2`, resíntesis aditiva multi-capa y envolventes de forma de onda `A` vs `B` + RMS dB)
  - [x] `src/ui/SpectralView.ts` — Monitor interactivo Canvas 2D con 3 modos (`2D SPECTROGRAM` + toggle `PARTIAL TRACKS`, `64 PARTIALS` + espectro FFT en vivo, y `WAVEFORM A/B`), cursor de inspección de frecuencia/parcial/capa, audición directa `A: Original` vs `B: Resynthesis`, selector de modo de audición del teclado (`KeyboardStrip`) y vúmetro `dBFS` a 60fps
  - [x] Verificado con `tests/phase4_spectral.test.ts`
- [x] **Fase 5 — UX Avanzada (Undo/Redo, Validación en Tiempo Real, Auto-Repair y Atajos)**:
  - [x] Pila `undo()` / `redo()` (`getHistoryState`) en `WebAudioPipeline.ts` con coalescencia automática (`450 ms`) para edición fluida de sliders e inputs
  - [x] Auto-reparación en 1 clic de cobertura MIDI `0..127` (`autoRepairCoverage()`) desde `Navbar` y `TelemetryDrawer`
  - [x] Validación en tiempo real sin pérdida de foco en `ProcessPanel.ts` (`0..511` slot, `11` chars en `legacy-neuron`/`dual` vs `32` chars en `modern-neural`, `recDepth` modes) y división de zonas con `Double-Click` / `Alt+Click` en `ZoneRibbon.ts`
  - [x] Atajos completos (`Ctrl+Z`, `Ctrl+Y`/`Ctrl+Shift+Z`, `Ctrl+S/O/I/N/P/T/B/L`, `Insert`, `Delete`, `←`/`→`, `Space`) y suite `tests/phase5_ux.test.ts`
- [x] **Fase 6 — Creación Dual (`Classic` $\leftrightarrow$ `Extended`), Importador Universal `.sf2`/`.sfz` a Formato Nativo y Adaptador Extendido $\rightarrow$ Clásico**:
  - [x] `workingMode: 'classic' | 'extended'` desacoplado de `targetFormat`: conmutación libre en cualquier momento con sincronización bidireccional automática (`syncExtendedRegionsFromClassicZones` $\leftrightarrow$ `projectExtendedRegionsToClassicZones`).
  - [x] `src/formats/Sf2Parser.ts` — Importador nativo de SoundFont 2 (`.sf2`): extrae muestras de `sdta/smpl`, une automáticamente pares estéreo `Left/Right` en WAVs estéreo reales de 2 canales (ej. `Baritone Saxophone V2.sf2`: 22 muestras L/R $\rightarrow$ 11 WAVs estéreo), captura DAHDSR (`VolEnv`/`ModEnv`), Filtro, LFO, puntos de Loop, `pitchKeytrack`, clasifica automáticamente el Tipo de Instrumento y `Parameter Set (0..9)`, y descarta el contenedor `.sf2` externo.
  - [x] `src/formats/SfzParser.ts` — Importador nativo de `.sfz` (`<control>`, `<global>`, `<master>`, `<group>`, `<region>`, crossfades `xf_*`, modos de loop, DAHDSR, filtro y LFO).
  - [x] `src/core/extendedAdapter.ts` — Compilador Extendido $\rightarrow$ Clásico (`projectExtendedRegionsToClassicZones` con compensación espectral exacta de volumen entre velocidades `10^(deltaDb/20)`) y mapeo seguro hacia `sound.script` (`mapArticulationToSoundOverrides` hacia `R1AmpEnvA/D/S/R`, `Filter*` y `LFO*` manteniendo explícitamente a `0` todas las profundidades hacia `Scape`/`Sphere`/`Blender`).
  - [x] Editor de Región Extendida (Loop, Keytrack, Trigger, Crossfades) y Panel de Articulación y Modulación (`Amp Env`, `Filter + Env`, `Vib LFO`) integrado en `src/ui/ZoneInspector.ts`, más `Import SoundFont / SFZ (.sf2, .sfz)...` en menú `File` y Drag & Drop.
  - [x] Verificado al 100% en `tests/phase6_units.test.ts` (7/7 suites en verde + `vite build`).
- [x] **Fase 7 — Autodetección Inteligente y Motor Clásico Mejorado (`Classic Enhanced`) + Rediseño del Drawer de Zona (`General` / `Extended`)**:
  - [x] `src/core/dsp/AcousticIntelligence.ts` — Detector híbrido de pitch `detectPitchYinMpm` (YIN/MPM en dominio temporal + HPS y Least-Squares de 2 pasadas), extractor de descriptores acústicos (`extractAcousticDescriptors`: `logAttackTime`, `attackMs`, rigidez física de parciales `inharmonicityB`, `spectralFlatness`, `spectralCentroidHz`, `zeroCrossingRate`, `sustainRatio`, `transientDensityHz`, detector percusivo/ruido), clasificador automático de Tipo de Instrumento y de los 10 `Parameter Sets (0..9)` (`classifyAcousticSample`), motor espectral clásico mejorado (`applyEnhancedSpectralModel`: HPSS, suavizado de trayectorias y supresión de piso de ruido en parciales superiores) y métrica objetiva de calidad (`computeDspQualityScore`).
  - [x] `src/ui/ZoneInspector.ts` y `src/style.css` — Pestañas tipo pill **`General`** y **`Extended`** en el drawer de metadatos de zona (`Extended` visible únicamente cuando `workingMode === 'extended'`), ancho ampliado hasta el `50%` del viewport disponible (`clamp(420px, 48dvw, 50dvw)`) con `@container` queries responsivas y tokens `@abdsynths/shared` sin colores hardcodeados.
  - [x] `src/ui/SpectralView.ts` y `src/ui/ProcessPanel.ts` — Comparador de audición **A / B / C** (`A: Original`, `B: Legacy DSP`, `C: Enhanced DSP`), indicador de `Quality Score` en vivo, selector `Legacy DSP` vs `Enhanced DSP` y botones `Auto-Detect`.
  - [x] Fase 13 (`Waveform Loop Editor` visual interactivo) documentada en `roadmap.md` y `DOCS/NEXTGEN_ARCHITECTURE_AND_SPEC.md`.
- [x] **Fase 8 — Estándar de Audio Maestro (`24-bit PCM / 96.000 Hz`), Expansión Inteligente de Loops Cortos, Espacialización Estéreo/Quad Surround y Puente IA**:
  - [x] `src/core/dsp/WavDecoder.ts` (`encodeWavPcm24` + parser de loops en chunk `smpl`) y `src/core/dsp/MasterWaveEnhancer.ts` (`promoteBufferToMasterWave`, `expandShortLoopAndRelocate`, `findOptimalZeroCrossingLoop`, `expandSpatialChannels`, `downmixToClassicMono44k1`, `applyDspEnhancement96k`, `regenerateMasterWaveFromModel`, `AudioEnhancementProvider` / `HttpAiBridgeProvider`).
  - [x] Integrado en `WebAudioPipeline.ts` (`promoteZoneToMasterWave`, `promoteAllZonesToMasterWave`, `getZoneSampleFormatInfo`) y en la pestaña **`Extended`** de `ZoneInspector.ts` (`MASTER WAVE (24-BIT / 96 KHZ), LOOP EXPANSION & SURROUND`).
  - [x] Verificado al 100% en la sección 14 de `tests/phase6_units.test.ts` + `vite build`.
- [x] **Documentación técnica en `DOCS/`** — `DOCS/NEURON_MM_SPEC.md`, `DOCS/ARCHITECTURE_DUAL_TARGET.md`, `DOCS/NASANALYSIS_DECOMPILATION.md` y **`DOCS/NEXTGEN_ARCHITECTURE_AND_SPEC.md`** (especificación maestra de las Fases 6 a 13).
- [x] **main.ts** — Orquestación de eventos: selección de zona, audición A/B, Undo/Redo, menús, atajos de teclado, drawers, modal y telemetría espectral real
- [x] **Sistema de diseño** — Integración con `@abdsynths/shared` (tokens, paletas, SynthNavBar)
- [x] **Iconos vectoriales** — Sincronizados con `ABDShared/Assets/icons`
- [x] **start.bat** — Script funcional con limpieza de puerto
- [x] **Vite dev server** — Corre en `localhost:8388` con HMR
- [x] **.gitignore** — Configurado para el proyecto
- [x] **README.md** — Documentación de arquitectura y uso

---

## 5. Qué FALTA por hacer (❌)

### 5.1 Convergencia con `ABDShared` (Fase 5B — 🎯 SIGUIENTE)
- [ ] Evaluar si los gráficos/visualizadores (`SpectralView`) pueden usar componentes existentes en `ABDShared` o promoverse a `@abdsynths/shared`
- [ ] Auditar archivos `.css` (`src/style.css`) frente a `ABDShared`: eliminar colores hardcodeados y minimizar estilos atomizados

### 5.2 Infraestructura
- [ ] Tests E2E con Playwright
- [ ] CI/CD pipeline

---

## 6. Convenciones y reglas del proyecto

1. **Toda lógica DSP pasa por `CoreService`** — la UI nunca toca raw audio.
2. **Zero Emojis en la UI** — Solo iconos SVG vectoriales `currentColor`.
3. **Colores y tipografía** vienen de `@abdsynths/shared/styles/tokens.css`.
4. **El componente SynthNavBar** se importa de `@abdsynths/shared`.
5. **TypeScript strict** — sin `any`, sin parámetros no usados (prefijo `_`).
6. **Vite puerto fijo `8388`** — strictPort, sin fallback.
7. **start.bat** debe matar procesos previos en el puerto antes de arrancar.

---

## 7. Dependencias externas relevantes

- **ABDShared** (`D:\desarrollos\ABDSynths\ABDShared`): Paquete workspace `@abdsynths/shared` con estilos, componentes comunes e iconos.
- **Otros proyectos de referencia**:
  - `D:\desarrollos\ABDSynths\ABDMS2000` — Ejemplo de `start.bat` y patrón de webapp similar.

---

## 8. Documentación de referencia

El documento de investigación completo sobre el Neuron MODELmaker original (comportamiento del software, formatos, parameter sets, pipeline de resíntesis) está en el artifact de esta conversación:
`neuronmm_research_digest.md`

Puntos clave de ese documento:
- 10 Parameter Sets oficiales (0-9) con descripciones
- Formato de zonas: cobertura continua 0..127, sin gaps ni overlaps
- Modelo de resíntesis: análisis espectral → tramas Scape/Sphere → archivos binarios
- Restricciones: nombre max 11 chars, slot 0..511, complejidad 1..10
