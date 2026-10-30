# 🔌 ABDSynths — Local Companion Bridge

Servidor local de aceleración de audio e inteligencia artificial para **ABDNeuModMakr**.

Permite que la aplicación web (tanto si la abres en la nube desde [https://abd-neumodmakr.vercel.app/](https://abd-neumodmakr.vercel.app/) como si la usas en `localhost`) se conecte automáticamente a la potencia de tu máquina local:

- **Procesamiento de Audio 24-bit / 96 kHz**: Remuestreo sinc polifásico, extensión armónica (BWE) y desruidado espectral.
- **Expansión Inteligente de Loops Cortos**: Desenrollado de bucles con modulación orgánica de fase y empalme libre de clics.
- **Aceleración por GPU (NVIDIA CUDA / PyTorch)**: Cuando PyTorch está instalado, delega tareas pesadas a la tarjeta gráfica.
- **Explorador y Acceso Directo al Disco**: Lectura y escritura directa en carpetas locales de `NeuronDB`.

---

## 🚀 Arranque Rápido (Windows)

Simplemente haz **doble clic en `run_bridge.bat`** o ejecuta desde tu terminal:

```powershell
python bridge/server.py
```

El servidor comenzará a escuchar en `http://127.0.0.1:7860`.

Cuando abras `ABDNeuModMakr`, la interfaz detectará el servidor en tiempo real y activará el indicador de estado **🟢 AI BRIDGE CONNECTED**.

---

## 📡 Endpoints del Servidor

- `GET /health` / `GET /api/health`: Retorna el estado del sistema, capacidades, GPU detectada y versión.
- `POST /api/enhance`: Recibe un WAV binario y devuelve el audio mejorado a 24-bit / 96 kHz con marcas `smpl`.
- `GET /api/fs/scan?path=...`: Escanea carpetas locales en busca de modelos `.model`, sonidos `.sound` y SoundFonts `.sf2`.
