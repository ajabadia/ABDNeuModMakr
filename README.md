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
- Menús completos: **File**, **Edit**, **Model**, **View** y **Help**.
- Visualización central HUD: ranura activa (`#000..#511`), nombre de modelo, auditor de cobertura MIDI (0..127) y estado del motor IA (Pure DSP / WebGPU / Cloud BYOK / Companion Bridge).
- Botones de acción rápida: Undo/Redo con tooltips dinámicos, Monitor Espectral, Biblioteca NeuronDB, Logs de Auditoría, acceso directo a Ajustes (`Ctrl+,`) y conmutador Sol/Luna para Modo Claro/Oscuro.

### 4.2 Inspector de Zonas y Teclado (`ZoneInspector.ts` & `ZoneRibbon.ts`)
- **`ZoneRibbon`**: Visualización interactiva 2D del teclado (0..127) con notas raíz, límites de zona y velocidades. Soporta división rápida por doble clic o `Alt+Click`.
- **`KeyboardStrip`**: Teclado de piano impulsado por `@abdsynths/midi-keyb` con pines luminosos de nota raíz y audición multitáctil / QWERTY.
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
- **16 Estándares de la Industria Soportados (Lectura y Escritura Bidireccional)**:
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
  - **Native Instruments Kontakt (`.nki.zip`)**: Definición estructurada XML y binaria para versiones K1 a K4 con grupos, zonas, notas raíz, rangos de teclas y velocidades, y soporte para muestras comprimidas sin pérdida `.ncw`.
  - **Steinberg HALion (`.vstpreset.zip`)**: Contenedor binario `VstW` con XML de programa HALion, capas de zonas, fundidos cruzados, conmutadores por nota (keyswitches) y mapeo tímbrico.
  - **Linear Sample Chain con Cue Markers (`.wav`)**: Archivo de audio continuo lineal de 16-bit o 24-bit PCM con marcas de división RIFF `cue ` incrustadas y etiquetas `LIST adtl` para grooves y samplers hardware (Elektron Octatrack, Roland SP-404 MKII, Korg electribe, OP-1/OP-Z), acompañado de mapa de marcas en texto (`_slices.txt`).
- **Compuerta de Preflight e Inspección Técnica (`rawSamplerPreflight.ts` & `FormatFidelity.ts`)**:
  - Detección preventiva de incompatibilidades técnicas y evaluación de avisos de fidelidad para los 16 formatos.
  - Opciones completas de resolución (Original, 16-bit, 24-bit), frecuencia de muestreo (Original, 44.1k, 48k, 96k), normalización (Off, 0 dBFS, -0.3 dBFS) y estructura monolítica vs ZIP con `Samples/`.
- Acceso directo: Menú `File -> Export Sampler / Multi-Format Bank...` o mediante atajo de teclado **`Ctrl+Shift+E`**.

### 4.10 Entrada Universal de Importación Inteligente y Decodificación de Audio (`UniversalImportModal.ts`, `UniversalAudioDecoder.ts` & `rawSamplerParsers.ts` — Fase 18.8, 31, 32)
- **Punto de Entrada Unificado (`Ctrl+I`)**: Reemplaza y consolida las importaciones dispersas en un único diálogo drag-and-drop con soporte para:
  - **Decodificación Universal de Muestras de Audio**:
    - **`.wav` (`RIFF`/`WAVE`)**: PCM 8/16/24/32 bits, IEEE Float 32/64 bits, compresión G.711 µ-Law y A-Law, `WAVE_FORMAT_EXTENSIBLE`, chunks `inst`, `smpl`, `cue ` y `atem`.
    - **`.aif` / `.aiff` / `.aifc` (`FORM`/`AIFF` y `FORM`/`AIFC`)**: Big-Endian (`NONE`/`twos`), Little-Endian (`sowt`), Float (`fl32`/`fl64`), `ulaw`, `alaw`, Apple IMA4 ADPCM (`ima4`), y bucles desde `INST` + `MARK`.
    - **`.flac` (`fLaC`, RFC 9639)**: Decodificador y codificador 100% TypeScript puro con soporte de metadatos `VORBIS_COMMENT` (`ROOTKEY`, `LOOPSTART`, `LOOPEND`) y chunks `smpl` incrustados.
    - **`.caf` (`caff`, Apple CoreAudio Format)**: Decodificador 100% TypeScript puro con chunks `desc`, `data`, `pakt`, `inst` (nota base, rangos de tecla/velocidad, ganancia) y `regn` (bucles).
    - **`.ncw`**: Formato de audio comprimido sin pérdida de Native Instruments Kontakt.
    - **`.mp3`, `.ogg` / `.oga`, `.m4a` / `.aac`, `.opus` / `.webm`**: Normalización asíncrona automática a WAV en navegador manteniendo las propiedades de instrumento.
  - **Imágenes de Disco e Imágenes Floppy Akai Serie S (Fase 32.5)**:
    - **Akai S1000 / S1100 / S2000 / S3000 (`.iso`, `.img`, `.dsk`)**: Imágenes completas de CD-ROM o discos duros SCSI (ZuluSCSI, SCSI2SD). Soporte de hasta 9 particiones ('A'..'I'), sub-volúmenes con programas ('p') y muestras ('s'), keygroups con 4 zonas de velocidad, envolventes ADSR no lineales, filtros pasobajo de 18 dB/octava y extracción de formas de onda PCM16.
    - **Akai S900 / S950 (`.img`, `.dsk`)**: Imágenes de disquete de 3.5" (720 KB DD y 1.44 MB HD, dumps Gotek FlashFloppy) con tabla de 64 entradas de directorio, programas con capas soft/loud por conmutación o fundido de velocidad y descompresión de audio de 12 bits (no comprimido o ADPCM).
    - **Gestión Multi-Instrumento / Multi-Volumen**: Si el disco contiene múltiples programas, la interfaz abre automáticamente la ventana `MultiInstrumentModal` permitiendo seleccionar un instrumento individual o derivar toda la colección a `BatchProcessorModal` para procesamiento desatendido por lotes.
  - **Formatos Multisample y Presets**: SoundFont 2 (`.sf2`), SFZ (`.sfz`), Decent Sampler (`.dspreset`), Ableton Sampler/Simpler (`.adv`), Apple Logic EXS24 (`.exs`), TAL-Sampler (`.talsmpl`), CWITEC TX16Wx (`.txprog`), Korg Trinity/Triton (`.KMP`), MMA DLS (`.dls`), Akai MPC (`.xpm`, `.xpn`), Kontakt (`.nki`), Steinberg HALion (`.vstpreset`), Bitwig (`.multisample`) y paquetes `.zip`.
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
  - *Samplers y Bancos Raw (Lectura y Escritura)*: SoundFont 2 (`.sf2`), SFZ Format (`.sfz`), Decent Sampler (`.dspreset`), Bitwig Studio Multisample (`.multisample`), Ableton Sampler/Simpler (`.adv`), Apple Logic EXS24 (`.exs`), TAL-Sampler (`.talsmpl`), CWITEC TX16Wx (`.txprog`), Korg Trinity/Triton (`.kmp`), MMA DLS Level 2 (`.dls`), Akai MPC (`.xpm`, `.xpn`), Native Instruments Kontakt (`.nki`), Steinberg HALion (`.vstpreset`) y Linear Sample Chains con RIFF `cue ` chunks.
  - *Modelos Neuron*: `.model` (Hartmann binario: `.scape`, `.sphere`, `map.script`, `MName`), `.sound` (`sound.script`, `sound.stickrec`), `.nmmodel` (Modern Neural JSON Float32), y paquetes maestros de Cápsula del Tiempo `.zip`.

---

Parte de la suite [ABDSynths](https://github.com/ajabadia).
