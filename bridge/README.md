# ABDSynths - Local Companion Bridge

Servidor local de aceleracion de audio e inteligencia artificial para **ABDNeuModMakr**.

Permite que la aplicacion web (tanto si se ejecuta localmente en `http://localhost:8388` como si se accede desde la nube en [https://abd-neumodmakr.vercel.app/](https://abd-neumodmakr.vercel.app/)) se conecte de forma transparente a la potencia de calculo de la estacion de trabajo local:

- **Procesamiento Maestro de Audio 24-bit / 96 kHz**: Remuestreo sinc polifasico, extension armonica (BWE), eliminacion de ruido espectral y sintesis asistida por IA.
- **Expansion Inteligente de Loops Cortos**: Desenrollado organico de bucles con modulacion de fase y empalme continuo libre de clics.
- **Aceleracion por GPU Dedicada (NVIDIA CUDA / PyTorch)**: Aprovechamiento directo de tarjetas graficas dedicadas (ej. NVIDIA RTX series) y aceleradores Apple MPS.
- **Descarga Asincrona Transparente de Modelos**: Descarga en segundo plano de pesos neuronales (AudioSR, HTDemucs, BasicPitch) con verificacion de integridad y reporte de progreso en tiempo real.
- **Acceso Directo al Sistema de Archivos**: Exploracion rapida e indexacion de librerias locales `NeuronDB` y SoundFonts `.sf2`.

---

## Arranque

### Opcion 1: Automatico (Recomendado)
Al ejecutar `start.bat` en la raiz del proyecto, el lanzador comprueba si Python esta instalado en el sistema. Si lo encuentra, arranca el Companion Bridge automaticamente en segundo plano antes de levantar el servidor de desarrollo Vite.

### Opcion 2: Manual
Puedes iniciar el servidor de forma independiente haciendo doble clic en `run_bridge.bat` o ejecutando desde la terminal:

```powershell
python bridge/server.py
```

El servidor escuchara en `http://127.0.0.1:7860`.

Cuando abras `ABDNeuModMakr`, el cliente `AiBridgeClient` detectara el servidor en tiempo real y activara el indicador de estado **AI BRIDGE CONNECTED** en la barra superior.

---

## Endpoints del Servidor

| Metodo | Endpoint | Descripcion |
|---|---|---|
| `GET` | `/health`, `/api/health` | Estado del sistema, capacidades DSP, GPU/CUDA detectada, VRAM disponible y version. |
| `POST` | `/api/enhance` | Recibe audio WAV binario y devuelve el master mejorado a 24-bit / 96 kHz con marcas `smpl`. Soporta cabecera opcional `X-Text-Prompt` para guiar la estetica del timbre neuronal. |
| `GET` | `/api/models` | Listado completo de modelos neuronales registrados (`MODEL_REGISTRY`), indicando estado (`downloaded`, `downloading`, `pending`), tamano y ruta en disco. |
| `POST` | `/api/models/download` | Inicia la descarga multihilo en segundo plano del modelo solicitado (`model_id`), con staging atomico temporal `.part`. |
| `GET` | `/api/models/progress` | Consulta el progreso de descarga activa (bytes recibidos, total, porcentaje, velocidad de transferencia y ETA) para la barra de progreso de la UI. |
| `GET` | `/api/fs/scan?path=...` | Escanea directorios locales en busca de modelos `.model`, sonidos `.sound` y SoundFonts `.sf2`. |

---

## Politica de Seguridad y Privacidad

- El servidor solo escucha en la interfaz de bucle invertido local (`127.0.0.1`).
- Permite peticiones de origen cruzado (CORS) exclusivamente para comunicarse con la aplicacion web local y el despliegue oficial en Vercel.
- No envia telemetria ni datos a servidores externos.
