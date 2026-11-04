# ABDNeuModMakr

> **Reinterpretación moderna del Hartmann Neuron MODELmaker (v1.2)**  
> Estación de trabajo web profesional para análisis espectral, remuestreo a 24-bit/96kHz, partición multisample, troceado inteligente de audio (AutoSlicer) y generación de modelos neurales Dual-Target (`.model` clásico y `.nmmodel` moderno).

---

## 1. Arquitectura: "Separado y Web"

A diferencia de un sintetizador en tiempo real (que opera como plugin VST3/CLAP/AU sujeto al hilo de audio estricto del host DAW), **ABDNeuModMakr** es una estación de preparación, análisis espectral, restauración de audio, troceado rítmico/tonal y compilación de bancos.

### ¿Por qué separado del sintetizador?
1. **Desacoplamiento total**: No se ata al ciclo de vida de JUCE 9, a hilos de audio en tiempo real ni a las limitaciones de ventana de un DAW.
2. **Multiplataforma sin dependencias**: Corre directamente en el navegador con tecnologías web estándar (HTML5 / TypeScript / Web Audio API) o como PWA instalable en escritorio, y se despliega directamente en la nube (Vercel).
3. **Servicio universal a ambos mundos**:
   - Genera archivos `.model` y `.sound` 100% compatibles con el **Hartmann Neuron hardware** original (2002) y con `NeuronVS` (vía tarjetas CompactFlash o carpetas de `NeuronDB`).
   - Genera y audita los bancos de modelos de alta definición para la recreación software moderna **ABDAxionikVS**.
4. **Pipeline Híbrido Dual-Target**:
   - **`WebAudioPipeline` (TypeScript nativo)**: Decodificación WAV/AIFF nativa en navegador, cálculo STFT, peak-picking armónico, y extracción de tramas Scape/Sphere mediante Web Workers sin dependencias externas.
   - **Estándar de Audio Maestro (`Master Wave Standard`)**: Remuestreo sinc polifásico a **24-bit PCM / 96.000 Hz**, extensión de ancho de banda armónica (BWE) hasta 42 kHz, reducción de ruido y espacialización multicanal (Mono / Estéreo / Quad Surround 4.0).
   - **Contenedor "Cápsula del Tiempo" de 5 Capas**: Almacena `01_raw_source`, `02_legacy_original`, `03_enhanced_audio`, `04_classic_enhanced` y `05_extended_model` con linaje verificable en `manifest.json` y `provenance.json` para evitar la degradación por generaciones ("efecto fotocopia").

---

## 2. Motor de IA Híbrido (3 Niveles: Navegador, Cloud BYOK y GPU Local)

ABDNeuModMakr implementa una arquitectura de inteligencia artificial flexible, respetuosa con la privacidad y de coste cero para el servidor:

### Nivel 1: Motor Web Integrado (WebGPU + WebAssembly SIMD — De Serie / 100% Gratis)
- Corre íntegramente en el navegador del cliente mediante [`WebNeuralEngine`](src/core/ai/WebNeuralEngine.ts).
- Detecta aceleración de hardware en tiempo real: aprovecha GPUs modernas (Direct3D12/Vulkan, ej. NVIDIA RTX 3070 8GB) en milisegundos mediante WebGPU.
- Fallback automático a WebAssembly SIMD multihilo y a DSP matemático determinista en máquinas convencionales.
- Cero costes de computación, cero instalación de Python y 100% offline.

### Nivel 2: Cloud AI (Bring-Your-Own-Key — BYOK)
- Conector directo [`CloudByokClient`](src/core/ai/CloudByokClient.ts) para usuarios que desean modelos pesados en la nube sin instalar software local.
- **Garantía Estricta de Privacidad**: Las claves API se almacenan **única y exclusivamente en el `localStorage` del navegador**. Jamás se envían ni se guardan en ningún servidor propio.
- **Coste Cero para el Servidor**: Las peticiones viajan directamente desde el cliente hacia el proveedor oficial, facturándose a la cuenta personal del usuario.
- **Proveedores Soportados**:
  - **Google Gemini (AI Studio)**: Razonamiento espectral multimodal e Imagen 3 para carátulas.
  - **OpenAI / ChatGPT**: DALL-E 3 para portadas de alta definición e inferencia de metadatos.
  - **OpenRouter**: Pasarela universal multimodelo (FLUX.1, Claude 3.5, GPT-4o, Llama-3).
  - **Anthropic Claude**: Razonamiento acústico avanzado y síntesis de prompts con Sonnet 3.5 / Haiku.
  - **DeepSeek**: Análisis profundo de timbres y catalogación con DeepSeek-V3 y R1.
  - **Groq**: Inferencia ultrarrápida a velocidad LPU para refinamiento instantáneo de prompts.
  - **Mistral AI**: Modelos europeos avanzados (Mistral Large, Codestral, Pixtral).
  - **Hugging Face**: Checkpoints acelerados serverless (FLUX.1-schnell).
  - **Replicate**: AudioSR (96kHz Super-Resolution), MusicGen y difusión FLUX/SDXL.

### Nivel 3: Companion Bridge (GPU Local / VRAM)
- Servidor ligero en Python (`bridge/server.py`) en `http://127.0.0.1:7860` para usuarios que trabajan en local con su propia GPU dedicada (CUDA / MPS).
- **Catálogo Neuronal Integrado de 7 Modelos**:
  1. `audiosr`: AudioSR (96kHz Bandwidth Extension, 5.8 GB) — Super-resolución por difusión latente.
  2. `htdemucs`: HTDemucs v4 (Stem Separator & De-bleeder, 80 MB) — Aislamiento de fuentes y desangrado.
  3. `basicpitch`: Spotify Basic Pitch (Neural F0 / Note Tracker, 1 MB) — Detección polifónica de tono.
  4. `deepfilter`: DeepFilterNet 3 (Neural Audio Denoiser, 8 MB) — Supresión de ruido en tiempo real.
  5. `sdturbo`: SD-Turbo (1-Step Synthesizer Cover Artwork, 1.6 GB) — Difusión local directa en GPU.
  6. `whispertiny`: OpenAI Whisper-tiny (Speech & Phoneme Alignment, 39 MB) — Segmentación fonética para troceado de voces (Fase 23).
  7. `musicgen`: Meta MusicGen-Small (Timbre Continuation & Infill, 300 MB) — Continuación tímbrica generativa.
- Descargador transparente multihilo con barra de progreso, comprobador de integridad, desinstalación con liberación de disco y soporte de URLs / mirrors personalizados.

---

## 3. Inicio Rápido

### Requisitos
- Node.js (v18+)
- Navegador web moderno con soporte Web Audio y WebGPU (Chrome, Edge, Brave, Opera, Firefox)

### Lanzamiento en Local
Haz doble clic en `start.bat` o ejecuta:
```cmd
start.bat
```
El script automáticamente:
1. Libera cualquier proceso previo en los puertos `8388` (Vite) y `7860` (Companion Bridge).
2. Arranca el Companion Bridge local en segundo plano (si Python está disponible).
3. Abre `http://localhost:8388` en tu navegador predeterminado.
4. Inicia el servidor de desarrollo Vite con recarga en caliente (HMR).

### Despliegue en la Nube
El proyecto está optimizado para Vercel:
- Despliegue público: [https://abd-neumodmakr.vercel.app/](https://abd-neumodmakr.vercel.app/)
- O compila manualmente con `npm run build` y despliega la carpeta `dist/`.

---

## 4. Funcionalidades y Componentes Principales

### 4.1 Barra Superior y Navegación (`Navbar.ts`)
- Menús completos: **File**, **Edit**, **Model** (con submenú **Tools** unificado), **View** (con **Hardware Skin**, **Appearance Mode** y **Language / Idioma** con banderas SVG `ES` / `EN`) y **Help**.
- Visualización central HUD: ranura activa (`#000..#511`), nombre de modelo (`MName` clásico de 11 caracteres o `expandedName` sin recorte en modo Extended), auditor de cobertura MIDI (0..127) y estado del motor IA (Pure DSP / WebGPU / Cloud BYOK / Companion Bridge).
- Botones de acción rápida en cabecera: Undo/Redo con tooltips dinámicos, Monitor Espectral, Biblioteca NeuronDB, Procesador por Lotes (`Ctrl+Shift+B`), Logs de Auditoría, **Conmutador de Idioma con Banderas SVG (`ES` / `EN`)** junto a los iconos de tema, conmutador Sol/Luna para Modo Claro/Oscuro, selector de Skin de Hardware y acceso directo a Ajustes (`Ctrl+,`).

### 4.2 Inspector de Zonas y Teclado (`ZoneInspector.ts` & `ZoneRibbon.ts`)
- **`ZoneRibbon`**: Visualización interactiva 2D del teclado (0..127) con notas raíz, límites de zona y velocidades. Soporta división rápida por doble clic o `Alt+Click`.
- **`KeyboardStrip`**: Teclado de piano impulsado por `@abdsynths/midi-keyb` con pines luminosos de nota raíz y audición multitáctil / QWERTY.
- **Barra de Herramientas del Keymap**: Incluye control numérico **`< BPM >`** (`30..300`, con botones triangulares `<` y `>` a izquierda y derecha), reproductor secuencial **`Seq`** para escuchar bucles REX y secuencias cromáticas al tempo elegido, y menú desplegable **`Tools`** (`Loop Editor`, `AutoLoop in All Zones`, `Audio Chopper & Auto-Slicer`, `Audio & MIDI AutoSampler Recorder`).
- **Pestaña Mapping & Sample**: Edición de notas raíz, límites inferior/superior (Low/High Key), rangos de velocidad (1..127), asignación de muestras A/B, desafinación fina (*detune* -99..+99 cents), ganancia (-32..+12 dB), panorama (-50..+50) y asignación a General MIDI Drum Map.

### 4.3 Editor Visual de Bucles (`Waveform Loop Editor`)
- Canvas de forma de onda con zoom horizontal continuo (1x a 32x).
- Marcadores interactivos arrastrables de `L-START`, `L-END` y rampa de fundido cruzado (*crossfade*).
- **Lupa de Empalme de Cruce por Cero (*Zero-Crossing Magnifier*)**: Visualiza los puntos de contacto con curvas fantasma de continuidad y snap automático a 0-X.
- **AutoLoop Inteligente**: 4 algoritmos de cálculo automático de bucles (`pitch_periodic`, `ncc_zc`, `min_seam_energy`, `equal_power_xfade`).
- Soporte de modos de bucle: continuo, sustain, ping-pong y marcha atrás (*reverse*).

### 4.4 Troceador Inteligente de Audio (`AudioChopperModal.ts` & `AudioSlicerEngine.ts`)
- **Detección Avanzada de Transitorios**: Basada en flujo espectral (SuperFlux) con sensibilidad ajustable y puerta dinámica de silencio.
- **Segmentación de Voces y Frases**: Algoritmo OpenVPI Silence Valley para corte semántico de tomas vocales continuas sin micro-cortes artificiales.
- **Ajuste y Manipulación Interactiva de Cortes**:
  - Arrastre directo de marcadores de corte sobre la forma de onda principal.
  - **Lupa de Ajuste Fino (*Cut Point Magnifier*)**: Zoom a nivel de muestra individual (±256 samples) con micro-ajuste mediante arrastre del ratón.
  - Botones de **Micro-Nudge** (±1 muestra) y botón de **Snap to 0-X** para magnetizar la frontera al cruce por cero más próximo.
  - Inserción de nuevos cortes mediante clic en zona libre y menú contextual (botón derecho) para eliminar rebanadas.
  - **Marcado de Zonas de Silencio**: Posibilidad de silenciar/mutear rebanadas individuales (con patrón visual de rayado diagonal).
  - Preservación inteligente de cortes y silencios manuales al modificar la sensibilidad de los sliders.
- **Mapeo Automático Multicapa**:
  - *Modo Batería (GM Drum Map)*: Clasificación de bombos, cajas, charles, toms y platos con mapeo estándar C1..B2.
  - *Modo Cromático*: Detección de F0 de cada rebanada y reparto equidistante contiguo en teclas 0..127 sin huecos.
- **Importador de Formatos de Slices**:
  - Parser recursivo IFF para archivos **Propellerhead ReCycle 2.0 y 1.x (`.rx2`, `.rex`, `.rcy`)**.
  - Soporte de definiciones de corte **SFZ (`offset`, `end`)** y pistas de etiquetas de texto **CUE / Audacity**.
  - Detección de bloques de corte incrustados en archivos WAV (`cue ` / `smpl`) y AIFF (`MARK`).
- **Exportación de Patrones MIDI**:
  - Generador en memoria de archivos Standard MIDI (`.mid` Type 0) con el timing exacto del loop original.
  - Botón arrastrable (*Draggable MIDI Badge*) para transferir el archivo MIDI directamente a cualquier DAW (Ableton, FL Studio, Logic, Reaper, Cubase).

### 4.5 Generador de Carátulas con IA (`AiCoverGeneratorModal.ts` — Fase 20)
- Generación de portadas oficiales de 512×512 píxeles optimizadas estrictamente en formato **WebP**.
- **6 Estilos Estéticos Pre-diseñados**: Cyberpunk Synthesizer, 1980s Analog Hardware, Minimalist Bauhaus Vector, Studio Hi-Fi Audiophile, Organic Acoustic Watercolor y Neural Latent Space.
- **Asistente de Prompt Acústico**: Construye descripciones de alta precisión a partir del nombre, número de modelo, timbre acústico y Parameter Set seleccionado.
- **Selector de Motores mediante Pills Estándar**:
  - *Procedural Acoustic*: Renderizado matemático 100% offline derivado de armónicos F0 y envolventes. Instantáneo (0 ms) y gratuito.
  - *Local Companion Bridge*: Difusión en GPU local mediante el endpoint Python 7860 (modelo SD-Turbo).
  - *Cloud BYOK*: Conexión directa a Google Gemini (Imagen 3), OpenAI (DALL-E 3), OpenRouter, Claude, Hugging Face (FLUX) o Replicate.
- Empaquetado automático en la capa `05_extended_model/cover.webp` de la Cápsula del Tiempo y visualización en tarjetas de biblioteca.

### 4.6 Procesador por Lotes (`BatchProcessorModal.ts` & `FolderBatchExtractor.ts` — Fase 12)
- Extracción inteligente por carpetas: agrupa subdirectorios y ficheros con prefijos de instrumentos en trabajos independientes.
- Cola asíncrona FIFO con tolerancia a fallos: los archivos corruptos o no conformes se aislan en el registro sin detener el lote.
- Diálogo interactivo de 4 pasos con **inspección Preflight obligatoria** antes del procesamiento.
- Exportación masiva a paquete maestro PKZIP (`.zip`) con Cápsulas del Tiempo o sincronización a la librería local `AxionikDB`.

### 4.7 Configuración del Modelo y Metadatos Ricos (`ModelConfigModal.ts` & Fase 17)
- **Doble Nomenclatura Independiente**:
  - `modelName`: Nombre clásico de 11 caracteres ASCII estrictos para hardware Hartmann Neuron 2002 / `MName`.
  - `expandedName`: Nombre sin límite de caracteres para catálogos modernos y presets de `ABDAxionikVS`. Conmutación no destructiva bidireccional.
- **Metadatos Ricos y Atributos Libres**:
  - Procedencia: URL de origen del sample/SoundFont con enlace web directo, formato original y nombre del preset.
  - Licencia y autoría: Autor, distribuidor/vendor, versión semántica y licencia (CC-BY, CC0, Comercial, etc.).
  - Tags libres: Pares clave-valor (`customAttributes`) editables de forma dinámica.

### 4.8 Monitor Espectral Avanzado (`SpectralView.ts`)
- **2D Spectrogram**: Espectrograma STFT 37×96 con ventana Blackman-Harris y sobreimpresión de las trayectorias de los 64 parciales armónicos coloreados por capa.
- **64 Partials**: Histograma de armónicos en tiempo real con analizador FFT de 2048 puntos.
- **Waveform A/B/C**: Comparativa de envolventes (Original vs DSP Legacy 2002 vs DSP Mejorado) con métrica matemática de calidad acústica (*Quality Score*).

### 4.9 Utilidad Universal de Exportación Multi-Formato Raw (`RawSamplerExportModal.ts` & `RawSamplerExporter.ts` — Fase 16, 31, 32)
- Exportación directa de muestras y zonas originales (`01_raw_source`) de forma pura e intacta, **sin pasar por los transformadores espectrales Scape/Sphere** de Neuron.
- **35 Estándares de la Industria Soportados en Exportación (Exportación Individual o Simultánea Multi-Formato)**:
  - **Exportación Simultánea a Múltiples Samplers (`RawSamplerExportModal.ts`)**: Permite marcar 1, varios o los **35 formatos de destino a la vez** (*Todos / Solo activo* o casillas individuales) y exportar todos los paquetes simultáneamente en una sola operación, con orden lógico de trabajo: **1. Nombre del Instrumento y Metadatos**, **2. Configuración de Audio y Empaquetado**, y **3. Formatos de Sampler Destino**.
  - **SoundFont 2 (`.sf2`)**: Generador binario RIFF `sfbk` v2.04 completo con generadores de offsets de muestra, `exclusiveClass` (choke/mute groups), `scaleTuning`, bucles continuos y filtro 2 polos.
  - **SFZ Format (`.sfz` + carpeta `Samples/` en `.zip`)**: Definición estándar de texto plano con `<control>`, `<global>`, `<master>`, `<group>`, `<region>`, `offset`/`end`, `loop_crossfade`, `direction=reverse`, curvas de fundido cruzado `xf_keycurve`/`xf_velcurve`, filtros multimodo (1/2/4/6 polos), `fileg_*`, `pitcheg_*`, `group`/`off_by` y keyswitches.
  - **Decent Sampler (`.dspreset` + carpeta `Samples/` en `.zip`)**: Definición XML nativa con interfaz gráfica interactiva, `start`/`end`, `loopCrossfade`, `seqMode="round_robin"`, `tags`/`silencedByTags` (mute groups) y efectos de filtro/reverb.
  - **Bitwig Studio Multisample (`.multisample`)**: Archivo empaquetado nativo con `multisample.xml` y carpeta de audio, con soporte de sub-elementos `<key>` y `<velocity>` con fundidos de entrada/salida (`fade-in`/`fade-out`), `<loop>`, `sample-start`/`sample-stop`, `reverse` y lógica round-robin.
  - **Ableton Sampler / Simpler (`.adv.zip`)**: Archivos de preset XML comprimidos en GZIP con estructura jerárquica `<MultiSampleMap>` / `<SampleParts>`, zonas con rangos cruzados `CrossfadeMin`/`CrossfadeMax`, puntos de inicio/fin, bucles sustain con crossfade y desafinación, reverse y envolventes de filtro y tono.
  - **Apple Logic EXS24 / Sampler (`.exs.zip`)**: Bloques binarios nativos `SOBT`/`SOBJ`/`TBOS` con serialización limpia de zonas, grupos con modos round-robin y keyswitching, muestras y parámetros de filtro, envolventes y modulación.
  - **TAL-Sampler (`.talsmpl.zip`)**: Definición XML para TAL-Sampler con modelado exacto de las leyes de ganancia, envolventes y filtros no lineales, soporte de 4 capas independientes, offsets normalizados `[0..1]`, reverse y matriz de modulación de tono.
  - **CWITEC TX16Wx (`.txprog.zip`)**: Especificación XML con namespace `tx:`, mapeando `<tx:wave>`, `<tx:loop>`, generadores `<tx:soundshape>` (filtro, envolventes AEG/FEG, LFO), `<tx:group>` (choke groups y modos de disparo) y regiones `<tx:bounds>` con atenuación de bordes de nota y velocidad.
  - **Korg Trinity / Triton / M3 / Pa (`.kmp.zip`)**: Formato multisample hardware Big-Endian con bloques `MSP1`/`RLP1` (`.KMP`), descriptores de muestra `SMP1`/`SMD1` (`.KSF`), listas de asignación `.KSC` y audio PCM Big-Endian incrustado.
  - **MMA Downloadable Sounds Level 2 (`.dls`)**: Sintetizador estándar de tabla de ondas RIFF `'DLS '` con articulaciones `lar2`/`art2` de Nivel 2, generadores de conexión para filtros y envolventes, bloques `wsmp` y pool de ondas `wvpl`.
  - **Akai MPC Moderno (`.xpm`, `.xpn`, `.xty`, `.xtd`)**: Programas Keygroup y Drum XML (MPC 2.x) y GZIP+JSON (MPC 3.x), paquetes de expansión `.xpn`, kits troceados DRY con división de WAV largo, soporte de choke groups (`MuteGroup`), Round-Robin (`CycleType`) y asignación por pad.
  - **Akai S5000 / S6000 / Z4 / Z8 (`.akp` / `.akp.zip`)**: Generador binario RIFF `APRG` con bloques `prg `, `out `, `tune`, `lfo `, `mods` y `kgrp` (hasta 4 zonas de velocidad por keygroup).
  - **Native Instruments Kontakt (`.nki.zip`)** y **NI Maschine (`.mxsnd.zip`)**: Definiciones estructuradas XML para Kontakt y grupos/sonidos de Maschine con muestras en `Samples/`.
  - **Steinberg HALion (`.vstpreset.zip`)**: Contenedor binario `VstW` con XML de programa HALion, capas de zonas, fundidos cruzados, conmutadores por nota (keyswitches) y mapeo tímbrico.
  - **FL Studio DirectWave (`.dwp.zip`)**: Parche binario `DwPr` con contenedores de zona (`0x0003`) y muestras asociadas en `Samples/`.
  - **Reason Studios NN-XT (`.sxt.zip`)**: Contenedor IFF `FORM` `PTCH` con bloques `DESC`, `AUTH`, `PARM`, `CAT REFS` y tabla de zonas `BODY`.
  - **Audiomodern Soundbox (`.sbpack`)** y **Spectrasonics Omnisphere (`.zmap.zip`)**: Paquetes multisample XML de 4 capas y mapas de zonas `.zmap`.
  - **1010music Blackbox / Tangerine (`preset.xml` en `.zip`)**: Presets XML para la serie 1010music con asignación de celdas por cuadrícula, activos multisample, envolventes de amplitud/filtro y audio asociado.
  - **Synthstrom Deluge (`SYNTHS/*.XML` en `.zip`)**: Sintetizador y sampler de rejilla con definiciones XML en `SYNTHS/`, mapeo de rangos con `rangeTopNote`, filtros resonantes multimodo y muestras en `SAMPLES/`.
  - **Renoise Instrument (`.xrni`)**: Formato contenedor ZIP de tracker con `Instrument.xml`, compresión de audio FLAC sin pérdida en `SampleData/`, capas de modulación por muestra y bucles bidireccionales.
  - **discoDSP Bliss (`.zbp`)**: Sampler VST con definiciones `program.xml` empaquetadas en ZIP, audio en FLAC nativo y parámetros completos de zona y envolvente.
  - **Polyend Tracker / Play (`.pti`)**: Instrumento standalone binario de tracker con cabecera `TI`, parámetros de reproducción, modulación de corte y muestra PCM16 de 44.1 kHz incrustada.
  - **Waldorf Quantum / Iridium (`.qpat` en `.zip`)**: Sintetizador híbrido de referencia con contenedor binario `0x0033ECB4`, tabla de parámetros de 16 bytes y mapas de muestras de texto tabulado con crossfade y bucles.
  - **Teenage Engineering OP-XY (`patch.json` en `.preset` o `.zip`)**: Multisampler moderno con estructura JSON limpia para motor de síntesis, envolventes, rangos de nota/velocidad, start/end y puntos de bucle.
  - **Elektron Tonverk (`.tvpst` / `elmulti` en `.zip`)**: Presets basados en formato declarativo estilo TOML con `[[key-zones]]`, `[[key-zones.velocity-layers]]` y `[[key-zones.velocity-layers.sample-slots]]`.
  - **Expert Sleepers Disting EX (`.dexpreset` en `.zip`)**: Formato multisample modular Eurorack en archivo binario `DEXBPRST` con algoritmo 2 y convención de nombres de archivo `[Name]_[Note]_SW[key]_V[vel].wav`.
  - **Sequential Prophet X / XL (`.grp` en `.zip`)**: Mapeo multisample hardware de 15 columnas TSV a 48 kHz con afinación por Hertz exacta (`File Path`, `Low Midi Note`, `Pitch in Hertz`).
  - **Isla Instruments S2400 (`.kit` / `.s24` en `.zip`)**: Kit de sampler clásico y multisample binario con registros TLV (`FIELD_*`), ganancia de pista, choke groups y modos de disparo.
  - **Korg Modern Multisample (`.korgmultisample` en `.zip`)**: Formato multisample binario moderno para teclados Korg Kronos, Nautilus, WaveState y modwave (`0x00000001`).
  - **Groove Synthesis 3rd Wave (`.3wv` en `.zip`)**: Sintetizador wavetable/multisample híbrido con archivo binario de programa `3WV\0`, ranuras de mapeo de notas y afinación por ranura.
  - **Roland Zen-Core / SP-404MKII / MC-707 (`.svz` en `.zip`)**: Descriptor de tono binario `SVZ\0` de la plataforma Zen-Core y samplers Roland modernos con zonas de tecla y afinación.
  - **Linear Sample Chain con Cue Markers (`.wav`)**: Archivo de audio continuo lineal de 16-bit o 24-bit PCM con marcas de división RIFF `cue ` incrustadas y etiquetas `LIST adtl` para grooves y samplers hardware (Elektron Octatrack, Roland SP-404 MKII, Korg electribe, OP-1/OP-Z), acompañado de mapa de marcas en texto (`_slices.txt`).
- **Compuerta de Preflight e Inspección Técnica (`rawSamplerPreflight.ts` & `FormatFidelity.ts`)**:
  - Detección preventiva de incompatibilidades técnicas y evaluación de avisos de fidelidad para los 35 formatos.
  - Opciones completas de resolución (Original, 16-bit, 24-bit), frecuencia de muestreo (Original, 44.1k, 48k, 96k), normalización (Off, 0 dBFS, -0.3 dBFS) y estructura monolítica vs ZIP con `Samples/`.
- **Flujo de Exportación Unificado (`ExportDestinationModal.ts` $\leftrightarrow$ `RawSamplerExportModal.ts`)**: Acceso unificado desde `File -> Export Instrument (Choose Destination)...` (**`Ctrl+Shift+X`**), con botón **`← Volver a Exportar Instrumento`** en el exportador multi-formato para regresar directamente al selector de destinos.

### 4.10 Entrada Universal de Importación Inteligente y Decodificación de Audio (`UniversalImportModal.ts`, `UniversalAudioDecoder.ts` & `rawSamplerParsers.ts` — Fase 18.8, 31, 32)
- **Punto de Entrada Unificado (`Ctrl+I`) con Soporte de Archivos y Carpetas**: Reemplaza y consolida las importaciones dispersas en un único diálogo drag-and-drop con botones **`Browse File...`** y **`Browse Folder...`** (además de arrastrar y soltar carpetas completas o unidades montadas directamente sobre la zona de drop) y soporte para:
  - **Decodificación Universal de Muestras de Audio**:
    - **`.wav` (`RIFF`/`WAVE`)**: PCM 8/16/24/32 bits, IEEE Float 32/64 bits, compresión G.711 µ-Law y A-Law, `WAVE_FORMAT_EXTENSIBLE`, chunks `inst`, `smpl`, `cue ` y `atem`.
    - **`.aif` / `.aiff` / `.aifc` (`FORM`/`AIFF` y `FORM`/`AIFC`)**: Big-Endian (`NONE`/`twos`), Little-Endian (`sowt`), Float (`fl32`/`fl64`), `ulaw`, `alaw`, Apple IMA4 ADPCM (`ima4`), y bucles desde `INST` + `MARK`.
    - **`.flac` (`fLaC`, RFC 9639)**: Decodificador y codificador 100% TypeScript puro con soporte de metadatos `VORBIS_COMMENT` (`ROOTKEY`, `LOOPSTART`, `LOOPEND`) y chunks `smpl` incrustados.
    - **`.caf` (`caff`, Apple CoreAudio Format)**: Decodificador 100% TypeScript puro con chunks `desc`, `data`, `pakt`, `inst` (nota base, rangos de tecla/velocidad, ganancia) y `regn` (bucles).
    - **`.ncw`**: Formato de audio comprimido sin pérdida de Native Instruments Kontakt.
    - **`.mp3`, `.ogg` / `.oga`, `.m4a` / `.aac`, `.opus` / `.webm`**: Normalización asíncrona automática a WAV en navegador manteniendo las propiedades de instrumento.
  - **Imágenes de Disco, Contenedores Anidados e Imágenes Floppy de Samplers Hardware y Software (Fases 32.4 y 32.5)**:
    - **Formatos Binarios Clásicos y Modernos de Sampler**:
      - **Akai S5000 / S6000 / Z4 / Z8** (`.akp`, carpetas, `.zip`, imágenes CD-ROM ISO-9660 `.iso` / `.img`): Programas RIFF con form type `APRG`, hasta 99 keygroups (`kgrp`), 4 zonas de velocidad (`zone`), enrutamiento de modulación (`mods`), filtros, curvas de envolvente y resolución insensible a mayúsculas/extensión de muestras WAV/AIFF hermanas.
      - **Akai S-Series Clásica (S1000 / S1100 / S2000 / S3000 / S900 / S950)** (`.iso`, `.img`, `.dsk`): Imágenes SCSI/CD-ROM o dumps de floppy Gotek FlashFloppy (DD 720 KB y HD 1.44 MB). Soporte de particiones (`A`..`I`), volúmenes, keygroups con 4 zonas de velocidad, descompresión de 12 bits (S900/S950) y audio PCM16.
      - **Akai MPC Moderno y Clásico** (`.xpm`, `.xty`, `.xtd`, `.xpn`, `.pgm`, `.set`, `.snd`, Gotek floppy images): MPC Key 61 / MPC Live / MPC One / MPC X (XML y MPC3 JSON/GZIP), además de MPC2000, MPC2000XL, MPC1000, MPC2500, MPC500 y MPC60 (con descompresión de audio de 12 bits no lineal).
      - **Akai MESA / MESA II** (`.s3p`): Formato nativo del editor MESA de Akai para PC/Mac con deserialización SysEx de programas S3000/S1000 y keygroups empaquetados.
      - **E-mu Systems (Emulator X / Proteus X / EOS Emulator IV / ESI-32 / Emulator III / EIIIX)** (`.exb`, `.e4b`, `.esi`, `.iso`, `.img`, `.dsk`):
        - **`.exb` (Emulator X / Proteus X)**: Contenedores RIFF `E5B0` con chunks `E5P1` (presets), `E5V0` (voces/zonas), `WPOOL` y muestras WAV externas o incrustadas.
        - **`.e4b` / `.esi` (EOS E4 / E-Synth / Ultra / ESI-32)**: Bancos IFF `FORM` `E4B0` / `E3B0` (`EMULATOR THREE`, `E4P1`, `E3P1`, `E4S1`, `E3S1`) con audio PCM de 16 bits.
        - **Imágenes de Disco `EMU3`** (`.iso`, `.img`, `.dsk`): Superbloque en sector 0, tabla FAT de clusters, directorios jerárquicos y extracción de bancos y muestras.
      - **Roland Samplers (S-7xx / S-5xx / Zen-Core)** (`.iso`, `.img`, `.out`, `.dsk`, `.svz`):
        - **Roland S-770 / S-750 / S-760 / SP-700** (`.iso`, `.img`, `.out`): Imágenes SCSI y CD-ROM Roland S-7xx (bloque ID `770`), FAT y directorio de parámetros a partir de `0x10D800` (Performance, Patch, Partial, Sample) con audio lineal de 16 bits por clusters de 9216 bytes.
        - **Roland S-50 / S-550 / S-330 / W-30** (`.out`, `.img`, `.dsk`): Imágenes de disquete de 720 KB con mapa de sectores, 16 Patches, 32 Tones, bancos de onda A y B, y descompresión de audio PCM de 12 bits.
        - **Roland Zen-Core / Fantom / Jupiter-X / SP-404MKII** (`.svz`): Contenedores `SVZ` (`SVZa`/`SVZ1` + `DIFa`/`ZCOR`/`SMPL`) con extracción de tonos y muestras WAV/AIFF embebidas.
      - **Yamaha Samplers & Workstations (A-Series / Motif / Montage / MODX)** (`.iso`, `.img`, `.hda`, `.hds`, `.x7u`, `.x8u`, `.x3a`, `.x7l`, `.x8l`):
        - **Yamaha A3000 / A4000 / A5000**: Sistemas de archivos de disco Yamaha SFS, volúmenes FAT con programas `.akp`/`.wav` y contenedores YSFC.
        - **Yamaha Motif XF / Montage / MODX** (`.x7u`, `.x8u`, `.x3a`): Contenedores `YAMAHA-YSFC` con metadatos de forma de onda (`WVM1`), asignaciones multicapa de keybank y muestras PCM de 16 bits (`WVD1`).
      - **Ensoniq EPS / EPS-16+ / ASR-10** (`.img`, `.dsk`, `.iso`, `.efe`, `.ede`, `.eda`, `.gkh`): Detección de imágenes de disco y archivos de instrumento nativos Ensoniq (headers GKH `TDDF`, EFE CRLF, marcadores de sector floppy `ID` a 550 y `DR` a 2558), extracción de instrumentos de tipo `0x02` y muestras de audio PCM.
      - **Kurzweil K2000 / K2500 / K2600 / PC3** (`.krz`, `.k25`, `.k26`): Contenedor estructurado `PRAM` con objetos de Programas (36), Keymaps (37), Muestras (38) y pool de audio PCM lineal de 16 bits en Big-Endian.
      - **Casio FZ-1 / FZ-10M / FZ-20M** (`.fzv`, `.fzf`, dumps de disquete): Volcados de voz y bancos con bloques de onda PCM lineal de 16 bits (36 kHz, 18 kHz, 9 kHz) y zonas de división de teclado.
      - **Korg Trinity / Triton / M3 / Pa / Kronos / Nautilus / Modwave / Wavestate** (`.kmp`, `.ksf`, `.korgmultisample`): Multisamples clásicos `.KMP` (`MSP1`/`RLP1`) con muestras `.KSF` (`SMP1`/`SMD1`) y formato moderno `.korgmultisample`.
      - **Synclavier II / Synclavier V / Synclavier Regen** (`.synx`, `.txt`, `.sflc`): Timbres multipartiales, archivos de biblioteca Regen con algoritmo de desofuscación LCG de 64 bits y exportaciones SYNX.
      - **Fairlight CMI Series IIx / III** (`.cmi`, `.cmi3`, `.vc`, `.co`): Archivos Voice Series III con tabla de zonas de 128 teclas y audio PCM de 16 bits, y formato clásico Series IIx de 8 bits.
      - **Samplers Hardware Modernos**:
        - **Waldorf Quantum / Iridium** (`.qpat`)
        - **Teenage Engineering OP-XY / OP-1 Field** (`patch.json` / `.preset`)
        - **Elektron Tonverk** (`.tvpst`, `elmulti`)
        - **Expert Sleepers Disting EX** (`.dexpreset`)
        - **Sequential Prophet X / Prophet XL** (`.grp`)
        - **Isla Instruments S2400** (`.kit`, `.s24`)
        - **Groove Synthesis 3rd Wave** (`.3wv`)
      - **Samplers Software y Estándares Abiertos**:
        - **Hartmann Neuron / Neuronik** (`.model`, `.nmpack`, `.neuronikmodel`, `.nmmodel`, `MName`, `map.script`, `.scape`, `.sphere`, bancos `NeuronDB.zip`)
        - **SoundFont 2** (`.sf2`) y **SFZ v1/v2** (`.sfz`)
        - **Steinberg HALion** (`.vstpreset` VST3 XML y parches binarios VST2 `.fxp` con chunks `CcnK`/`FPCh`/`HaPa`/`HaSm`)
        - **Apple Logic EXS24 / Sampler** (`.exs` Little-Endian y Big-Endian con resolución automática de rutas Mac/Windows y muestras WAV/AIFF)
        - **Native Instruments Kontakt** (`.nki` XML desbloqueado y diagnóstico DRM preventivo para monolitos protegidos) y **Maschine / NICNT** (`.mxsnd`, `.mxgrp`, `.nicnt`)
        - **Ableton Live Sampler / Simpler** (`.adv` GZIP/XML)
        - **Bitwig Studio Multisample** (`.multisample`, `multisample.xml`)
        - **Decent Sampler** (`.dspreset`, `.dslibrary`)
        - **TAL-Sampler** (`.talsmpl`) y **CWITEC TX16Wx** (`.txprog`)
        - **Reason Studios NN-XT** (`.sxt` IFF `FORM` `PTCH`), **FL Studio DirectWave** (`.dwp`), **Audiomodern Soundbox** (`.sbpack`, `.sbx`), **Spectrasonics Omnisphere** (`.zmap`, `.prt_omn`) y **MMA Downloadable Sounds** (`.dls`).
      - **CD-ROMs Multiformato ISO-9660 + Joliet y Contenedores Anidados (`IsoFormatIdentifier`)**:
        - Lectura completa del **Supplementary Volume Descriptor Joliet (UTF-16BE)** en imágenes `.iso` para preservar nombres largos de archivo y jerarquías profundas (hasta 10 niveles).
        - Soporte de **CDs multiformato** (p. ej. discos que combinan carpetas `EXS24`, `HALion .fxp`, `WAV` y `AIFF`) y **contenedores anidados** (`.zip` dentro de `.zip`, `.iso` dentro de `.zip`, `.zip` o `.e4b` dentro de `.iso`).
        - **Navegación por Carpetas y Contenedores**: Tanto `MultiInstrumentModal` como `MultiAssetTriageModal` presentan píldoras interactivas de navegación por carpeta/contenedor en la parte superior para filtrar y explorar cada formato o subcarpeta antes de cargar en la sesión o enviar al Batch Processor.
  - **Bucles Rebanados y Slices**: ReCycle (`.rx2`, `.rex`, `.rcy`), pistas CUE (`.cue`), y sample chains lineales (WAV/AIFF con marcas `cue ` / `smpl`). Detección automática que ofrece abrir directamente en el **Audio Chopper**.
  - **Audio Crudo Multizona**: Lotes de archivos de audio en cualquiera de los formatos soportados con deducción automática de notas o afinación cromática.
- **Motor de Inspección Preflight de Entrada (`importPreflight.ts`)**:
  - Detección automática de huecos de teclado (cobertura incompleta de notas MIDI 0..127).
  - Alertas sobre capas de velocidad incompatibles con el modo clásico Hartmann (más de 2 capas).
  - Detección de contenedores propietarios o encriptados (ej. Kontakt monolith comprimido) con advertencia clara y explicativa.
  - Validación de muestras faltantes o referencias de audio huérfanas en el preset.
- **Adaptaciones Interactivas con un Clic**:
  - Auto-extensión de zonas exteriores hacia 0 y 127 para garantizar cobertura continua sin silencios.
  - Adaptación de multicapa a modelo clásico de 2 capas (Low 1..63, High 64..127) con compensación de ganancia.
  - Conmutación automática a Modo Extendido para preservar todas las capas y regiones dinámicas 2D.

### 4.11 Diagnóstico de Salud del Sistema y Onboarding (`ConfigHealthModal.ts` — Fase 21)
- Verificación automática al inicio del estado de configuración del entorno (rutas NeuronDB/AxionikDB, Companion Bridge local y API Keys BYOK).
- Distinción visual clara entre requisitos obligatorios y opcionales con botones directos para configurar cada apartado.
- Indicador visual dinámico (badge y punto de estado) en la barra de navegación y en el acceso de ajustes.

### 4.12 Descompresión de Audio REX2 Dual (`DwopDecompressor.ts` & Companion Bridge — Fase 26)
- **Motor 100% In-Browser en TypeScript Puro**: Descompresión directa de streams de audio DWOP con predictor adaptativo de 5 estados para archivos `.rx2`, `.rex` y `.rcy`. Cero backend, cero dependencias nativas, listo para Vercel.
- **Respaldo con Companion Bridge**: Endpoint `POST /api/decode-rx2` en Python en el puerto 7860 como acelerador local.
- **Asistente de Emparejamiento REX2 (`Rx2PairingAssistantModal.ts`)**: Ventana interactiva que asiste al usuario cuando falta audio o se desea emparejar con archivos WAV/AIFF existentes o previsualizar con impulsos acústicos sintéticos.

### 4.13 Ampliación de Proveedores BYOK y Estandarización UI en Pills (Fase 27)
- **Conectores de Texto y Razonamiento**: Conectores directos desde el cliente browser en `CloudByokClient` para Anthropic Claude (`v1/messages` con Sonnet/Haiku), OpenRouter (gateway OpenAI-compatible), OpenAI GPT-4o (`v1/chat/completions`), Google Gemini (`generateContent`), Groq LPU, DeepSeek y Mistral AI.
- **Análisis Tímbrico y Prompting Acústico**: Extracción automática de descriptores acústicos armónicos (`generateAcousticTimbreDescription`) y enriquecimiento de prompts de carátulas (`enhancePromptWithByokLlm`) con metáforas sensoriales.
- **Estandarización UI en Pills**: Selectores de proveedores de IA y estilos unificados bajo componentes de píldora interactiva (`.btn-style-pill`, `.byok-provider-opt`) con badges de capacidades (`AudioSR GPU`, `Multimodal`, `GPT-4o & DALL-E`, `Sonnet & Haiku`, etc.).
- **Catálogo Modular del Bridge**: Especificación según `MODULAR_PACKAGES_STANDARD.md` con metadatos de paquetes (`@abdsynths/*`), categorías y requisitos de VRAM en `/api/models`.

### 4.14 Akai MPC (`.xpm` / `.xpn`) y Kontakt / NCW (Fases 28 y 31)
- **Akai MPC** (`src/formats/MpcXpmFormat.ts`): importación de programas Keygroup y Drum en XML de MPC 2.x y en GZIP+JSON de MPC 3.x, y de expansiones `.xpn` (ZIP con `Expansion.xml`, programas y WAV). Escritor de programas `.xpm` (128 instrumentos x 4 capas, convenciones verificadas con archivos reales: `RootNote` = nota MIDI + 1, `SampleName` sin extensión, tiempos de envolvente logarítmicos, cutoff normalizado).
- **Kontakt** (`src/formats/KontaktParser.ts`): detección por versión (K1/K1.5, K2-4.1 zlib, K4.2 FastLZ, K5+ contenedor NI, monolitos), extracción de zonas `K2_Zone`, detección de DRM real (chunks Authorization/Encryption) y decodificador de audio NCW (delta, truncado, raw, mid/side y float).

### 4.15 Estudio de Grabación de Audio, Asistente Guiado de Músico y AutoSampler MIDI Integrado (`AudioRecorderModal.ts` & `MusicianWizardModal.ts` — Fases 34, 35 y 37)
En lugar de herramientas desconectadas, el **Grabador de Audio**, el **AutoSlicer (`AudioChopperModal.ts`)**, el **Editor de Bucles (`AutoLoop`)** y el **Asistente Guiado de 4 Pasos (`Ctrl+Shift+W`)** operan sobre el mismo motor y los mismos componentes visuales, ofreciendo dos modos de grabación dentro de `AudioRecorderModal.ts`:

1. **Grabación Directa de Audio (Mic / Línea / Sintetizador)**:
   - Captura directa con vúmetros L/R con decaimiento balístico, detección de silencios con *hangover*, captura automática o manual de **Huella de ruido (`Noise Print`)**, sustracción espectral DSP con filtro notch de red (50/60 Hz), eliminación de DC + normalización a `-1.0 dBFS`, realce neuronal opcional (`BWE`) y pila `Undo` no destructiva por toma.
2. **Grabación Tipo AutoSampler MIDI (Barrido Automático o Teclado MIDI en Vivo)**:
   - **Modo A — Barrido Automático Paramétrico (`Auto-Sweep` WebMIDI Out $\to$ Audio In)**: el usuario define la octava de inicio, número de octavas, notas por octava (`1, 2, 3, 4, 6, 12`), duración de nota pulsada (`Gate`) y capas de velocidad con **5 curvas seleccionables** (*Lineal*, *Logarítmica / más precisión en valores altos*, *Exponencial / más precisión en valores bajos*, *Clásico Neuron 2 capas* o *Tabla manual de velocidades*).
   - **Modo B — Captura en Vivo desde Teclado MIDI (`Live MIDI Capture`)**: el usuario no configura rejilla; toca libremente su teclado MIDI y se capturan en paralelo las notas, velocidades, tiempos de pulsación y el audio, agrupando automáticamente capas de velocidad o Round-Robin.
   - **Gestión Inteligente de la Cola tras soltar la nota (`NoteOff` $\neq$ fin del sonido)**: puesto que soltar una tecla no apaga instantáneamente el sonido, el sistema soporta tanto **auto-detección dinámica de extinción al suelo de ruido** (con tope de seguridad) como **tiempo de Release fijo** definido por el usuario.
   - **Cajas de Ritmos y Mapas de Nombres (`.txt`, `.json`, `.yaml`)**: importación de archivos de texto, JSON o YAML (o extracción asistida por IA/Regex desde el texto de un manual) con los nombres de cada golpe y la nota MIDI que aplica (más grupos de exclusión `choke/muteGroup` e información técnica y plantillas descargables en la propia interfaz).
   - **Visor de Onda en Tiempo Real con Zoom Constante (*Scrolling Live Waveform*)**: durante la grabación la onda avanza horizontalmente con escala constante seleccionable (`2 s`, `5 s`, `10 s`, `30 s` por pantalla) **sin irse achatando**, permitiendo observar modulaciones (LFO/chorus) para lograr un mejor bucle y pintando en vivo las marcas de `NoteOn`, `NoteOff` y `Fin de cola`.
   - **Continuar Grabación Interrumpida y Recuperación No Destructiva**: si la grabación se detiene a mitad, permite **continuar desde donde se paró** o re-grabar una celda individual de la matriz `Notas × Velocidades`. El audio continuo y el manifiesto MIDI (`MidiAutoSampleManifest`) se guardan siempre juntos antes de cortar; si falla el parseo o el corte, se puede re-aplicar el manifiesto, ajustar el offset de latencia o abrir en el `AutoSlicer` sin perder la grabación.
   - **Empalme Directo con `AutoSlicer` y `AutoLoop` (`NoteOn..NoteOff`)**: la limpieza de ruido se ejecuta sobre la toma continua antes de cortar; después, `AudioSlicerEngine` corta exactamente por los eventos MIDI con ajuste a cruce por cero (`zc-snap`) y `computeBatchAutoLoopForZones` busca el bucle estacionario exclusivamente dentro del tramo sostenido (`NoteOn..NoteOff`, nunca en la cola de release).
   - **Puentes de Rescate desde cualquier Slot (`ZoneInspector.ts`)**: cualquier muestra multipista cargada en una zona puede enviarse en 1 clic a **"Limpiar y mapear"** (Paso 2 del Asistente), aplicar **"AutoLoop en todas las zonas"** en lote o promoverse a **Master Wave (`24-bit / 96 kHz`)** una vez partida y remapeada.

### 4.16 Superficie Espectral Continua Unificada (`UnifiedSpectralSurface.ts`), Cola por Fases del Batch Processor y Denoise Triple (Fase 39)
- **Un único archivo de Superficie Espectral Continua para el Resinator (`05_extended_model/axionik-expanded.json`)**:
  - A partir de cualquier conjunto de muestras y velocidades de entrada, `buildUnifiedSpectralSurface` destila un único campo espectral continuo (`unifiedSurface`) con dos topologías automáticas:
    1. **`melodic_surface` (`Pitch 0..127 × Velocity 1..127 × Time`)**: para pianos, sintes, cuerdas, bajos y objetos percusivos afinados (botellas/marimbas). Basta con conocer los puntos de calibración `(Nota, Velocidad)` para cubrir las 128 notas y 127 velocidades sin saltos de zona ni *phasing*, desacoplando los formantes en 24 bandas Bark del tono para evitar el efecto "ardilla".
    2. **`drum_kit_surface` (`Hit_Key → Velocity 1..127 × Time`)**: para mapas de batería y sonidos no afinados, aislando cada tecla pero interpolando continuamente la velocidad dentro de cada golpe y añadiendo variación estocástica DDSP anti-metralleta.
  - **Resolución Adaptativa (`compact` 32p, `standard` 64p, `hd` 128p, `ultra-hd` 256p)** según la densidad armónica real o nivel manual (`1..10`).
  - **Control de Ataque/Release y Modulaciones de Sintetizador**: alinea hitos de ataque (`canonicalAttackPeakFrame`) y sostenimiento (`canonicalSustainStartFrame`), permitiendo acortar ataques lentos de *pads* en tiempo real, alargar *releases* cortados en seco con caída física de agudos (`hfDampingDbPerSec`) y conservar el batimiento de osciladores desafinados (`modulationRateHz` / `estimatedDetuneCents`) y PWM (`oddEvenModDepth`).
  - **Escudo contra muestras intrusas (`timbreCoherenceScore`)**: detecta y aísla automáticamente muestras de otro instrumento coladas por error en un lote melódico.
- **Gestor de Colas por Fases (`stage-grouped`) en `BatchQueue.ts` e Ingesta Multiformato (`BatchProcessorModal.ts`)**:
  - Procesa todo el lote etapa por etapa (`Stage 1/5` a `Stage 5/5`) manteniendo los modelos IA (`HTDemucs v4`, `DeepFilterNet 3`, `AudioSR`) calientes en memoria/VRAM para todos los instrumentos del lote y liberando VRAM una sola vez entre fases.
- **Denoise Triple y Silencios en Mute**:
  - Selección de `Denoise Algorítmico` (puerta espectral), `Denoise por Huella de Ruido` (`Noise Print`) y `Denoise IA` (`DeepFilterNet 3` / Cloud BYOK con verificación previa en `aiHonesty.ts`), más corte automático de silencios en estado `mute` dentro de `AudioChopperModal.ts`.
- **AutoSlicer Dual (`One-Shot Extractor` vs `REX / Groove Loop`), Extracción de Melodías (BPM + `.mid`) y Contrato `tempoSync`**:
  - Dos modos de flujo en `AudioChopperModal.ts`: **Modo 1 (`One-Shot Extractor`)** para cortar grabaciones nota a nota (cromáticas o kits de batería golpe a golpe) y **Modo 2 (`REX / Groove Loop`)** con estimación automática de BPM y compases (`estimateLoopBpmAndBars`), conformador elástico de tempo (`conformLoopToTargetBpm` preservando $25\text{ ms}$ de transitorio intacto), extracción de melodías grabadas (detectando cambios de nota *legato*, agrupando notas repetidas en capas de velocidad sin colisiones de teclado y exportando la partitura `.mid` cronológica a `Target BPM`) y persistencia del bloque `tempoSync` (`AxionikSurfaceTempoSync`) en `05_extended_model/axionik-expanded.json` consumido por el Resinator v2 (`AxionikExpandedSynthesizer.h`) de `ABDAxionikVS`.
  - **Control de Tempo en Vivo (`< BPM >` 30..300, por defecto `120`) y Reproductor de Secuencias (`Seq`) en el Keymap (`ZoneInspector.ts`)**: En la barra superior del Keymap se incluye un selector numérico de `BPM` con botones `<` y `>` conectado directamente al motor de síntesis `Resinator v2` (`synthesizeZoneResynatorV2` con escalado temporal `tempoScaleFactor`) y un botón **`Seq`** que reproduce secuencialmente las zonas o regiones mapeadas (rebanadas tipo REX o escalas cromáticas) a la velocidad indicada.

### 4.17 Accesibilidad (a11y), Internacionalización Reactiva con Banderas (`ES` / `EN`), Recuperación de Modelos del Banco y Arquitectura Modular DRY (Fases 36, 38, 40, 41 y 42)
- **Internacionalización Reactiva Bilingüe (`ES` / `EN`) en 3 Capas e Iconografía de Banderas en `@abdsynths/shared` (`src/core/i18n.ts`)**:
  - Integración con `@abdsynths/shared/i18n` (`createSynthI18n`) sincronizada en `localStorage` (`abdsynths.locale`) y `<html lang="...">`, con helpers reactivos (`getAppLocale`, `setAppLocale`, `onAppLocaleChange`, `tApp`, `isEs`).
  - Iconos vectoriales de banderas (`flag-es.svg`, `flag-en.svg` y `FLAG_ICONS` en `@abdsynths/shared/components`) accesibles desde tres puntos sincronizados: botón de bandera en la cabecera superior (`#nav-btn-lang`) junto a los controles de tema, submenú **`View -> Language / Idioma`** y pestaña **`Settings -> General`**.
  - **Cobertura completa en 3 capas sin recargar la página**:
    1. **Capa 1 (Shell y Espacio de Trabajo)**: `Navbar`, `ProcessPanel`, `ZoneRibbon`, `KeyboardStrip`, `ZoneInspector` (`tableRenderOps`), `SpectralView`, `BankDrawer`, `TelemetryDrawer` y estado honesto de IA (`honesty/status.ts`).
    2. **Capa 2 (Ajustes, Configuración del Modelo y Cajón de Zona)**: `SettingsModal` (`tabGeneral`, `tabWeb`, `tabCloud`, `tabBridge`, `bridgeModels`, `webPresets`), `ModelConfigModal` (`tabGeneral`, `tabArticulation`, `tabMetadata`, `tabArtwork`) y `drawerRenderOps.ts`.
    3. **Capa 3 (Modales Interactivos, Asistentes y Talleres de Audio)**: `ExportDestinationModal` (`exportDestinations.ts`), `RawSamplerExportModal`, `preflightGateView` (`MUSICIAN_TERMS` dinámico), `ConfigHealthModal`, `LoadingModal`, `ProcessModal`, `UniversalImportModal`, `MultiAssetTriageModal`, `MultiInstrumentModal`, `NeuronDbModal`, `AiCoverGeneratorModal`, `MusicianWizardModal`, `BatchProcessorModal`, `LoopEditorModal`, `AudioChopperModal` (`chopper/renderOps.ts`) y `AudioRecorderModal`.
- **Accesibilidad Integral y Navegación por Teclado en Superficies Complejas (a11y — Fase 38)**:
  - Trampa de foco reutilizable (`createModalFocusTrap`) con cierre por `Escape` y restauración del foco al elemento invocador en los 14 modales de la aplicación.
  - Anillos `:focus-visible` y `:focus-within` de alto contraste, respeto a `@media (prefers-reduced-motion: reduce)` y anunciador global `announceToScreenReader` (`aria-live`) para notificaciones toast y progreso de carga (`LoadingModal.ts`).
  - **Navegación completa por teclado en superficies interactivas complejas**:
    - **Matriz 2D `Notas × Velocidades` (`AudioRecorderModal.ts`)**: `role="grid"` / `role="gridcell"` con navegación 2D (`ArrowLeft`/`ArrowRight`/`ArrowUp`/`ArrowDown`/`Home`/`End`), audición de celda (`Enter`/`Space`) y re-grabación de celda individual (`Shift+Enter`).
    - **Bloques del `ZoneRibbon` (`ZoneRibbon.ts`)**: selección por teclado (`ArrowLeft`/`ArrowRight`/`Home`/`End`, `Enter`/`Space`) y ajuste fino del límite de zona en $\pm 1$ semitono (`Shift+ArrowLeft`/`Shift+ArrowRight`).
    - **Filas de la Tabla de Zonas (`zoneTemplates.ts` y `tableEventOps.ts`)**: `tabindex="0"`, `aria-selected` y navegación vertical (`ArrowUp`/`ArrowDown`/`Home`/`End`, `Enter`/`Space` para audición).
    - **Canvases de Onda (`AudioChopperModal` / `chopper/a11yKeyboard.ts` y `LoopEditorModal.ts`)**: `tabindex="0"`, `role="application"`, ajuste fino de fronteras de slice o puntos `Loop Start` / `Loop End` (`Shift+←/→`, `Alt+←/→`), reproducción (`Space`) y zoom (`+`/`-`).
    - **Pestañas y Tarjetas del Gestor de Bancos (`@abdsynths/shared/components/bank/bankShell.js`)**: `role="tablist"` / `role="tab"` con navegación por flechas (`ArrowLeft`/`ArrowRight`/`Home`/`End`).
- **Hidratación desde IndexedDB y Recuperación Automática de Modelos Antiguos (`NeuronAssetStore.ts`, `bankService.ts`, `WebAudioPipeline.ts`)**:
  - Hidratación automática de `legacy_originals` y `model_capsules` desde IndexedDB al iniciar y restaurar bancos, más plan de recuperación (`buildFallbackBankLoadPlan`) que reconstruye zonas y sintetiza ondas armónicas de respaldo para modelos antiguos sin binarios en caché.
- **Arquitectura Modular de Hojas de Estilo (`src/styles/00..20`) y Submódulos TypeScript (Fases 41 y 42)**:
  - Hojas de estilo divididas en 21 módulos (`00-base.css` a `20-modal-triage.css`) con componentes canónicos DRY (`.nmm-status-pill`, `.nmm-metric-strip`, `.nmm-metric-grid`, `.nmm-metric-card`, `.nmm-audio-modal-*`) y 100% de colores tokenizados.
  - Módulos de gran tamaño particionados en subpaquetes cohesivos (`src/ui/settings/*`, `src/ui/modelConfig/*`, `src/ui/zoneInspector/*`, `src/ui/chopper/*`, `src/core/dsp/audioSlicer/*`, `src/core/pipeline/*`, `src/core/export/*`).

---

## Créditos y Atribuciones

- **ConvertWithMoss** — Jürgen Moßgraber, https://www.mossgrabers.de/Software/ConvertWithMoss/ (licencia LGPL-3.0). Usado como referencia de documentación de formatos (Akai MPC `.xpm`/`.xpn`, Kontakt `.nki`, NCW, Ableton `.adv`, Logic EXS24 `.exs`, TAL-Sampler `.talsmpl`, CWITEC TX16Wx `.txprog`, Korg `.KMP`/`.KSF`, MMA DLS `.dls`, Bitwig `.multisample`, Decent Sampler `.dspreset`, SF2 y SFZ). La implementación de `@abdsynths/shared/formats/sampler` y NeuModMakr es independiente (clean-room en TypeScript); no incluye ni traduce código de ConvertWithMoss.

---

## 5. Atajos de Teclado

| Atajo | Acción |
| :--- | :--- |
| `Ctrl+Z` | Deshacer (*Undo*) |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Rehacer (*Redo*) |
| `Ctrl+O` | Abrir sesión (`.nmsession.json`) |
| `Ctrl+S` | Guardar sesión activa |
| `Ctrl+I` | Universal Smart Import (Audio, Bancos, Slices, Sample Chains) |
| `Ctrl+N` | Importar archivos por convención de nombre Hartmann |
| `Ctrl+P` | Procesar modelo y sintetizar tramas Scape/Sphere |
| `Ctrl+T` | Exportar modelo clásico (`.model`) |
| `Ctrl+Shift+T` | Guardar paquete completo en formato Cápsula del Tiempo (`.zip`) |
| `Ctrl+Shift+E` | Abrir exportador de bancos sampler multi-formato raw (*Raw Sampler Export*) |
| `Ctrl+Shift+B` | Abrir el Procesador por Lotes (*Batch Processor*) |
| `Ctrl+Shift+W` | Abrir el Asistente Guiado de Músico en 4 Pasos (*Musician Guided Wizard*) |
| `Ctrl+Shift+X` | Exportar Instrumento eligiendo Destino (*AxionikVS / Otros Samplers / Solo Audio*) |
| `Ctrl+,` | Abrir Ajustes Generales, Motores de IA y Companion Bridge |
| `Insert` | Añadir nueva zona |
| `Delete` | Eliminar zona seleccionada |
| `Espacio` | Iniciar / Detener audición en tiempo real |

---

## 6. Sistema de Skins de Hardware

La aplicación incluye 6 familias completas de diseño inspiradas en sintetizadores clásicos, cada una con variantes **Clara** y **Oscura**:

1. **Hartmann Neuron (2002)**: Tema canónico oficial del sintetizador original. *(Por defecto: `neuron-light`)*
2. **Access Virus Snow (2008)**: Diseño minimalista en blanco y negro con acentos celestes y grafito.
3. **AudioLab Precision**: Aspecto técnico de instrumental de laboratorio y osciloscopio de precisión.
4. **Korg MS2000**: Estética azul verdosa y controles analógicos de modelado físico.
5. **Hartmann Advanced**: Variante de alto contraste con tonos plateados y antracita.
6. **Casio CZ-101**: Estética clásica ochentera de síntesis por distorsión de fase.

---

## 7. Estándares y Política de Diseño

- **Cero Emojis**: Toda la interfaz de usuario, diálogos e iconografía cumplen estrictamente la política de cero emojis, empleando exclusivamente iconos vectoriales SVG monocromos (`currentColor`) sincronizados con `@abdsynths/shared`.
- **Tokens de Diseño**: Uso estricto de design tokens (`tokens.css` de `@abdsynths/shared/styles`) sin colores hardcodeados.
- **Formatos de Audio y Modelos**:
  - *Audio*: WAV (PCM 8/16/24/32 bits, IEEE Float 32/64 bits, G.711 µ-Law/A-Law, Extensible, chunks `inst`/`smpl`/`cue `), AIFF/AIFC (FORM/COMM/SSND/INST/MARK, Big/Little Endian, Float, IMA4, uLaw, aLaw), FLAC (16-bit PCM, RFC 9639, Vorbis Comment), Apple CoreAudio CAF (`.caf`), Native Instruments NCW (`.ncw`), MP3, OGG/Vorbis, M4A/AAC, Opus, ReCycle (`.rx2`, `.rex`, `.rcy`), CUE Label Tracks.
  - *Samplers y Bancos Raw (Lectura y Escritura)*: SoundFont 2 (`.sf2`), SFZ Format (`.sfz`), Decent Sampler (`.dspreset`), Bitwig Studio Multisample (`.multisample`), Ableton Sampler/Simpler (`.adv`), Apple Logic EXS24 (`.exs`), TAL-Sampler (`.talsmpl`), CWITEC TX16Wx (`.txprog`), Korg Trinity/Triton (`.kmp`), Korg Modern Multisample (`.korgmultisample`), MMA DLS Level 2 (`.dls`), Akai MPC (`.xpm`, `.xpn`, `.pgm`, `.set`), Akai S-Series & S5000 (`.akp`, `.iso`, `.img`, `.dsk`), Akai MESA (`.s3p`), Reason NN-XT (`.sxt`), FL Studio DirectWave (`.dwp`), Audiomodern Soundbox (`.sbpack`, `.sbx`), Spectrasonics Omnisphere (`.zmap`), NI Maschine (`.mxsnd`, `.mxgrp`, `.nicnt`), E-mu (`.e4b`, `.iso`), Roland (`.out`, `.img`, `.svz`), Ensoniq (`.gkh`, `.efe`, `.ede`), Yamaha (`.x7u`, `.x8u`, `.x3a`, `.iso`), Kurzweil (`.krz`, `.k25`, `.k26`), Casio FZ (`.fzv`, `.fzf`), Synclavier (`.synx`, `.sflc`), Fairlight CMI (`.cmi`, `.cmi3`), Waldorf Quantum (`.qpat`), Teenage Engineering OP-XY (`.preset`), Elektron Tonverk (`.tvpst`), Expert Sleepers Disting EX (`.dexpreset`), Sequential Prophet X (`.grp`), Isla S2400 (`.kit`), 1010music (`preset.xml`), Synthstrom Deluge (`SYNTHS/*.XML`), Renoise (`.xrni`), discoDSP Bliss (`.zbp`), Polyend Tracker (`.pti`), Groove Synthesis 3rd Wave (`.3wv`), Roland Zen-Core (`.svz`), Native Instruments Kontakt (`.nki`), Steinberg HALion (`.vstpreset`) y Linear Sample Chains con RIFF `cue ` chunks.
  - *Modelos Neuron*: `.model` (Hartmann binario: `.scape`, `.sphere`, `map.script`, `MName`), `.sound` (`sound.script`, `sound.stickrec`), `.nmmodel` (Modern Neural JSON Float32), y paquetes maestros de Cápsula del Tiempo `.zip`.

---

Parte de la suite [ABDSynths](https://github.com/ajabadia).
