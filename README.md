# ABDNeuModMakr

> **Reinterpretacion moderna del Hartmann Neuron MODELmaker (v1.2)**  
> Estacion de trabajo web autonoma de analisis espectral, remuestreo a 24-bit/96kHz, particion multisample y generacion de modelos neurales Dual-Target (`.model` clasico y `.nmmodel` moderno).

---

## 1. Arquitectura: "Separado y Web"

A diferencia de un sintetizador en tiempo real (que opera como plugin VST3/CLAP/AU sujeto al hilo de audio estricto del host DAW), **ABDNeuModMakr** es una estacion de preparacion, analisis espectral, restauracion de audio y compilacion de bancos.

### ¿Por que separado del sintetizador?
1. **Desacoplamiento total**: No se ata al ciclo de vida de JUCE 9, a hilos de audio en tiempo real ni a las limitaciones de ventana de un DAW.
2. **Multiplataforma sin dependencias**: Corre directamente en el navegador con tecnologias web estandar (HTML5 / TypeScript / Web Audio API) o como PWA instalable en escritorio, y se despliega directamente en la nube (Vercel).
3. **Servicio universal a ambos mundos**:
   - Genera archivos `.model` y `.sound` 100% compatibles con el **Hartmann Neuron hardware** original (2002) y con `NeuronVS` (via tarjetas CompactFlash o carpetas de `NeuronDB`).
   - Genera y audita los bancos de modelos de alta definicion para la recreacion software moderna **ABDAxionikVS**.
4. **Pipeline Hibrido Dual-Target**:
   - **`WebAudioPipeline` (TypeScript nativo)**: Decodificacion WAV/AIFF nativa en navegador, calculo STFT, peak-picking armonico, y extraccion de tramas Scape/Sphere mediante Web Workers sin dependencias externas.
   - **Estandar de Audio Maestro (`Master Wave Standard`)**: Remuestreo sinc polifasico a **24-bit PCM / 96.000 Hz**, extension de ancho de banda armonica (BWE) hasta 42 kHz, reduccion de ruido y espacializacion multicanal (Mono / Estereo / Quad Surround 4.0).
   - **Contenedor "Capsula del Tiempo" de 5 Capas**: Almacena `01_raw_source`, `02_legacy_original`, `03_enhanced_audio`, `04_classic_enhanced` y `05_extended_model` con linaje verificable en `manifest.json` y `provenance.json` para evitar el efecto fotocopia.

---

## 2. Motor de IA Hibrido (3 Niveles: Navegador, Cloud BYOK y GPU Local)

ABDNeuModMakr implementa una arquitectura de inteligencia artificial flexible, respetuosa con la privacidad y de coste cero para el servidor:

### Nivel 1: Motor Web Integrado (WebGPU + WebAssembly SIMD — De Serie / 100% Gratis)
- Corre integramente en el navegador del cliente mediante [`WebNeuralEngine`](src/core/ai/WebNeuralEngine.ts).
- Detecta aceleracion de hardware en tiempo real: aprovecha GPUs modernas (Direct3D12/Vulkan, ej. NVIDIA RTX 3070 8GB) en milisegundos mediante WebGPU.
- Fallback automatico a WebAssembly SIMD multihilo y a DSP matematico determinista en maquinas convencionales.
- Cero costes de computacion, cero instalacion de Python y 100% offline.

### Nivel 2: Cloud AI (Bring-Your-Own-Key — BYOK)
- Conector directo [`CloudByokClient`](src/core/ai/CloudByokClient.ts) para usuarios que desean modelos pesados en la nube (AudioSR 96k, HTDemucs, MusicGen) sin instalar software local.
- **Garantia Estricta de Privacidad**: Las claves API se almacenan **unica y exclusivamente en el `localStorage` del navegador**. Jamas se envian ni se guardan en ningun servidor propio.
- **Coste Cero para el Servidor**: Las peticiones viajan directamente desde el cliente hacia el proveedor oficial (Replicate, Hugging Face o Google Gemini), facturandose a la cuenta personal del usuario.
- Interfaz segura con verificacion de conexion en vivo y ocultacion de credenciales.

### Nivel 3: Companion Bridge (GPU Local / VRAM)
- Servidor ligero en Python (`bridge/server.py`) en `http://127.0.0.1:7860` para usuarios que trabajan en local con su propia GPU dedicada (CUDA / MPS).
- Descargador transparente de modelos multihilo con barra de progreso en vivo para AudioSR, HTDemucs y BasicPitch.
- Arranque automatico en segundo plano mediante `start.bat`.

---

## 3. Inicio Rapido

### Requisitos
- Node.js (v18+)
- Navegador web moderno con soporte Web Audio y WebGPU (Chrome, Edge, Brave, Opera, Firefox)

### Lanzamiento en Local
Haz doble clic en `start.bat` o ejecuta:
```cmd
start.bat
```
El script automaticamente:
1. Libera cualquier proceso previo en los puertos `8388` (Vite) y `7860` (Companion Bridge).
2. Arranca el Companion Bridge local en segundo plano (si Python esta disponible).
3. Abre `http://localhost:8388` en tu navegador predeterminado.
4. Inicia el servidor de desarrollo Vite con recarga en caliente (HMR).

### Despliegue en la Nube
El proyecto esta optimizado para Vercel:
- Despliegue publico: [https://abd-neumodmakr.vercel.app/](https://abd-neumodmakr.vercel.app/)
- O compila manualmente con `npm run build` y despliega la carpeta `dist/`.

---

## 4. Componentes Principales

- **`AppNavbar`**: Barra superior integrada (`SynthNavBar`) con menus de archivo, edicion, modelo, vista y ayuda; HUD central con nombre de ranura, auditor de cobertura MIDI continua (0..127) y pill interactivo de estado de IA; botones rapidos de Undo/Redo, monitor espectral, banco NeuronDB, logs de auditoria y conmutador directo de modo Claro/Oscuro.
- **`ZoneRibbon`**: Mapa visual bidimensional de las 128 notas MIDI que visualiza la particion de zonas, notas raiz, puntos de cruce de velocidad y asignacion de muestras. Soporta division por doble clic o `Alt+Click`.
- **`ZoneInspector`**: Editor detallado con pestanas `General` y `Extended`: limites de zona (Low/Root/High Key), asignacion de muestras A/B, afinacion fina (*detune*), ganancia, panorama, DAHDSR, puntos de loop y promocion a Master Wave (24-bit/96kHz).
- **`SpectralView`**: Monitor espectral interactivo con tres vistas:
  1. `2D Spectrogram`: Espectrograma STFT Blackman-Harris con trazas de los 64 parciales armonicos coloreadas por capa.
  2. `64 Partials`: Histograma de magnitudes con espectro FFT de Web Audio en tiempo real.
  3. `Waveform A/B/C`: Comparador de envolventes de audio (Original vs Legacy DSP vs Enhanced DSP) con puntuacion objetiva de calidad (*Quality Score*).
- **`Waveform Loop Editor`**: Editor visual de bucles con zoom horizontal continuo (1x a 32x), marcadores arrastrables `L-START`, `L-END` y rampa de crossfade, lupa de empalme de cruce por cero (*Zero-Crossing Magnifier*) y motor inteligente con 4 algoritmos (`pitch_periodic`, `ncc_zc`, `min_seam_energy`, `equal_power_xfade`).
- **`ProcessPanel`**: Configuracion del modelo de salida (slot 0..511, nombre de hasta 11 caracteres hardware o 32 caracteres extendidos, complejidad 1..10, seleccion de los 10 Parameter Sets oficiales con autodeteccion inteligente y carga de portada `.webp`).
- **`KeyboardStrip`**: Teclado de piano interactivo impulsado por `@abdsynths/midi-keyb`, con representacion de zonas en vivo, indicador pin iluminado en la nota raiz, limites de zona y soporte tactil/QWERTY.
- **`SettingsModal`**: Centro unificado de configuracion accesible desde el boton de rueda dentada en el Navbar (`Ctrl+,`):
  1. *General*: Selector de Hardware Skins (6 familias), Modo Claro/Oscuro, Modo de Trabajo (Clasico vs Extendido con garantia bidireccional no destructiva) y rutas de librerias de bancos locales con exploracion automatica.
  2. *Motor Web*: Procesamiento de serie en navegador 100% gratuito con WebGPU / WASM y matriz DSP modular de 5 etapas.
  3. *Cloud BYOK*: Conexiones privadas directas a Replicate, Hugging Face y Gemini con persistencia de clave exclusiva en `localStorage`.
  4. *Companion Bridge*: Monitor de GPU dedicada (RTX 3070 8GB VRAM / CUDA), catalogo con descarga multihilo transparente, desinstalacion de modelos de disco para liberar espacio y configurador de URLs/mirrors personalizadas.
- **`NeuronDbModal`**: Navegador modal de modelos de fabrica y de usuario de `NeuronDB`, con filtros rapidos por Parameter Set y Complejidad.
- **`BankDrawer`**: Cajon retractil para examinar la biblioteca de modelos generados y presets de NeuronDB con exportacion directa a paquete `.zip` Dual-Target.
- **`TelemetryDrawer`**: Cajon de diagnostico y auditoria de cobertura continua MIDI (0..127) y registro de operaciones.

---

## 5. Sistema de Skins de Hardware y Modo de Apariencia

La aplicacion incluye 6 familias completas de diseno inspiradas en sintetizadores clasicos, cada una con su variante real **Clara** y **Oscura**:

1. **Hartmann Neuron (2002)**: Tema canónico oficial del sintetizador original. *(Por defecto: `neuron-light`)*
2. **Access Virus Snow (2008)**: Diseno minimalista blanco y negro con acentos celestes y grafito.
3. **AudioLab Precision**: Aspecto tecnico de instrumental de laboratorio y osciloscopio de precision.
4. **Korg MS2000**: Estetica azul verdosa y perillas analogicas de modelado fisico.
5. **Hartmann Advanced**: Variante de alto contraste con tonos plateados y antracita.
6. **Casio CZ-101**: Estetica clasica ochentera de sintesis por distorsion de fase.

El usuario puede alternar entre temas desde `View -> Hardware Skin` y conmutar instantaneamente entre **Modo Claro** y **Modo Oscuro** con el boton de sol/luna en la cabecera. La preferencia se auto-persiste en `localStorage`.

---

## 6. Estandares y Politica de Diseno

- **Zero Emojis**: Toda la interfaz de usuario e iconografia cumple estrictamente la politica de cero emojis, empleando exclusivamente iconos vectoriales SVG monocromos (`currentColor`) desde `ABDShared/Assets/icons`.
- **Tokens de Diseno**: Consume de forma rigurosa `@abdsynths/shared/styles` (`tokens.css` y paletas generadas).
- **Formatos Soportados**:
  - Audio: WAV (PCM 8/16/24/32 bits, IEEE Float 32/64 bits, Extensible), AIFF (FORM/COMM/SSND/INST), SF2 (SoundFont 2.04), SFZ.
  - Modelos: `.model` (Hartmann binario: `.scape`, `.sphere`, `map.script`, `MName`), `.sound` (`sound.script`, `sound.stickrec`), `.nmmodel` (Modern Neural JSON Float32), y paquetes multiformato `.zip`.

---

Parte de la suite [ABDSynths](https://github.com/ajabadia).
