# 🧠 ABDNeuModMakr

> **Reinterpretación moderna del Hartmann Neuron MODELmaker (v1.2)**  
> Estación web autónoma de análisis espectral, partición multisample y generación de modelos neurales (`.model` y `.sound`).

---

## 🏛️ Arquitectura: "Separado y Web"

A diferencia de un sintetizador en tiempo real (que vive como plugin VST3/CLAP/AU sujeto al audio thread del host DAW), **ABDNeuModMakr** es una herramienta de preparación, análisis espectral y compilación de bancos.

### ¿Por qué separado del futuro Neuron?
1. **Desacoplamiento total**: No se ata al ciclo de vida de JUCE 9, a hilos de audio en tiempo real ni a las limitaciones de ventana de un DAW.
2. **Multiplataforma sin dependencias**: Corre directamente en el navegador con tecnologías web estándar (HTML5 / TypeScript / Web Audio API) o empaquetado en WebView2/Electron como ejecutable standalone.
3. **Servicio universal a ambos mundos**:
   - Genera archivos `.model` y `.sound` compatibles con el **Hartmann Neuron hardware** original (vía tarjetas CompactFlash).
   - Genera y audita los bancos de modelos para la futura recreación software **ABDNeural / NEURONiK**.
4. **Pipeline Dual (TypeScript / WASM / C++)**:
   - El front-end se comunica exclusivamente con la abstracción `CoreService`.
   - **`MockCore`**: Para desarrollo, prototipado e inspección de UI en tiempo real.
   - **`WebAudioPipeline` (TypeScript nativo)**: Decodificación WAV nativa en navegador, cálculo STFT, *peak-picking* armónico y extracción de tramas de Scape/Sphere con *Web Workers* sin dependencias externas.
   - **`WasmCore` / C++20 nativo**: Motor matemático portable opcional para procesamiento por lotes en línea de comandos (CLI) o máxima aceleración SIMD.

---

## 🚀 Inicio Rápido

### Requisitos
- Node.js (v18+)
- pnpm (workspace integrado en la suite `ABDSynths`)

### Lanzamiento
Haz doble clic en `start.bat` o ejecuta:
```cmd
start.bat
```
El script automáticamente:
1. Libera cualquier proceso previo escuchando en el puerto `8388`.
2. Abre la URL en tu navegador predeterminado: `http://localhost:8388`.
3. Inicia el servidor de desarrollo Vite con recarga en caliente (HMR).

---

## 🧩 Componentes Principales

- **`AppNavbar`**: Barra superior unificada (`SynthNavBar`) con menús de archivo, edición, proceso y ayuda, pill de estado del modelo y auditor de cobertura continua MIDI 0..127.
- **`ZoneRibbon`**: Mapa interactivo de la franja de 128 notas MIDI que visualiza la partición de zonas, notas raíz y asignación de muestras.
- **`ZoneInspector`**: Editor detallado de límites de notas (Low/Root/High Key), asignación de archivos WAV primarios (Base) y secundarios (Layer/Velocity), y controles de afinación (*detune*), ganancia y panorama.
- **`ProcessPanel`**: Configuración del modelo destino (ranura 0..511, nombre de hasta 11 caracteres, complejidad 1..10 y los 10 Parameter Sets oficiales del manual).
- **`KeyboardStrip`**: Teclado de piano interactivo para probar notas, verificar rangos y comprobar la cobertura.
- **`ProcessModal`**: Ventana modal con progreso en tiempo real de la resíntesis neural espectral.
- **`TelemetryDrawer`**: Cajón retráctil de auditoría de cobertura continua (verificación sin huecos ni solapamientos) y registro de eventos.
- **`BankDrawer`**: Cajón retráctil para examinar la biblioteca de modelos generados y presets de NeuronDB con exportación a `.model`.

---

## 📦 Estándares y Dependencias

- **Sistema de diseño**: Consume directamente `@abdsynths/shared/styles` (`tokens.css` y paletas temáticas canónicas).
- **Iconografía**: Iconos vectoriales monocromáticos (`currentColor`) limpios desde `ABDShared/Assets/icons` bajo la política estricta **Zero Emojis**.

---

Parte de la familia [ABDSynths](https://github.com/ajabadia).
