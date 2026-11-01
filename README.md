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

### 4.9 Utilidad Universal de Exportación Multi-Formato Raw (`RawSamplerExportModal.ts` & `RawSamplerExporter.ts` — Fase 16)
- Exportación directa de muestras y zonas originales (`01_raw_source`) de forma pura e intacta, **sin pasar por los transformadores espectrales Scape/Sphere** de Neuron.
- **7 Estándares de la Industria Soportados**:
  - **SoundFont 2 (`.sf2`)**: Generador binario RIFF `sfbk` v2.04 completo con bloques `INFO`, banco contiguo PCM16 `sdta` con holgura de 46 muestras anti-click, y jerarquía `pdta` (`phdr`/`pbag`/`pmod`/`pgen` → `inst`/`ibag`/`imod`/`igen` → `shdr`).
  - **SFZ Format (`.sfz` + carpeta `Samples/` en `.zip`)**: Definición estándar de texto plano con `<control>`, `<global>` y `<region>` compatible con Sforzando, Cakewalk y LinuxSampler.
  - **Decent Sampler (`.dspreset` + carpeta `Samples/` en `.zip`)**: Definición XML nativa con interfaz gráfica interactiva (knobs de Attack, Release, Tone y Volume), mapeo de grupos y samples.
  - **Bitwig Studio Multisample (`.multisample`)**: Archivo empaquetado nativo con `multisample.xml` y carpeta de audio directamente reconocible por Bitwig Studio.
  - **Native Instruments Kontakt (`.nki.zip`)**: Definición estructurada XML con grupos, zonas, clave raíz, rangos de teclas y velocidades.
  - **Steinberg HALion (`.vstpreset.zip`)**: Archivo de programa HALion XML/vstpreset con capas de zonas y mapeo tímbrico.
  - **Linear Sample Chain con Cue Markers (`.wav`)**: Archivo de audio continuo lineal de 16-bit o 24-bit PCM con marcas de división RIFF `cue ` incrustadas y etiquetas `LIST adtl` para grooves y samplers hardware (Elektron Octatrack, Roland SP-404 MKII, Korg electribe, OP-1/OP-Z), acompañado de mapa de marcas en texto (`_slices.txt`).
- **Compuerta de Preflight e Inspección Técnica (`rawSamplerPreflight.ts`)**:
  - Detección preventiva de incompatibilidades técnicas: clamps automáticos de 24-bit a 16-bit PCM con dither TPDF para SF2, simplificación de envolventes DAHDSR a ADSR estándar, conversión de bucles complejos ping-pong a forward continuo, y bloqueo si faltan buffers en memoria.
  - Opciones completas de resolución (Original, 16-bit, 24-bit), frecuencia de muestreo (Original, 44.1k, 48k, 96k), normalización (Off, 0 dBFS, -0.3 dBFS) y estructura monolítica vs ZIP con `Samples/`.
- Acceso directo: Menú `File -> Export Sampler / Multi-Format Bank...` o mediante atajo de teclado **`Ctrl+Shift+E`**.

---

## 5. Atajos de Teclado

| Atajo | Acción |
| :--- | :--- |
| `Ctrl+Z` | Deshacer (*Undo*) |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Rehacer (*Redo*) |
| `Ctrl+O` | Abrir sesión (`.nmsession.json`) |
| `Ctrl+S` | Guardar sesión activa |
| `Ctrl+I` | Importar archivos de audio (.wav / .aif) |
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
  - *Audio*: WAV (PCM 8/16/24/32 bits, IEEE Float 32/64 bits, Extensible), AIFF (FORM/COMM/SSND/INST), SF2 (SoundFont 2.04), SFZ, ReCycle (`.rx2`, `.rex`, `.rcy`), CUE Label Tracks.
  - *Samplers y Bancos Raw*: SoundFont 2 (`.sf2`), SFZ Format (`.sfz`), Decent Sampler (`.dspreset`), Bitwig Studio Multisample (`.multisample`), Native Instruments Kontakt (`.nki`), Steinberg HALion (`.vstpreset`) y Linear Sample Chains con RIFF `cue ` chunks.
  - *Modelos Neuron*: `.model` (Hartmann binario: `.scape`, `.sphere`, `map.script`, `MName`), `.sound` (`sound.script`, `sound.stickrec`), `.nmmodel` (Modern Neural JSON Float32), y paquetes maestros de Cápsula del Tiempo `.zip`.

---

Parte de la suite [ABDSynths](https://github.com/ajabadia).
