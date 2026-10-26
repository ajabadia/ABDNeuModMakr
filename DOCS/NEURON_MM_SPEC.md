# 🧠 ABDNeuModMakr — Especificación Técnica del Pipeline y Formatos Neuron

> Consolidación de la ingeniería inversa de `MODELmaker_1_2.exe` (`NASAnalysis.dll` + clases Java de `neuronapp.*`), los formatos binarios de `NeuronDB` (`.scape`, `.sphere`, `map.script`, `MName`, `sound.script`) y el motor espectral `SpectralAnalyzer` (NEURONiK / ABDNeural).

---

## 1. Arquitectura de `MODELmaker_1_2.exe` (Evidencia Decompilada)

El ejecutable original `MODELmaker_1_2.exe` empaqueta (vía `jexepack`) las clases Java `neuronapp.*` junto con la librería nativa Win32 `NASAnalysis.dll` (Metrowerks CodeWarrior, SHA256 `434e2ac9…f780711`).

### 1.1 Frontera JNI (`NASAnalysisProvider`) y Códigos de `validateSample`
- `validateSample(String path, SampleInfo info)` (`0x10001420` → `FUN_10009b20`):
  - En el binario original solo existe un lector manual de chunks `FORM/AIFF` (`FUN_10004130`: `COMM` con frecuencia de muestreo en `IEEE-80` big-endian, `SSND`, `MARK` hasta 64 marcadores, `INST` y salto de `AESD`, `ANNO`, `APPL`, `AUTH`, `COMT`, `FVER`, `MIDI`, `NAME`). No tiene soporte `RIFF/WAVE` ni MP3/LAME.
  - Rellena los 16 campos de `SampleInfo`: `numChannels`, `sampleSize`, `sampleRate`, `loopStart`, `loopEnd`, `soundDataStart`, `numFrames`, `rootKey`, `lowKey`, `highKey`, `gain`, `lowVelocity`, `highVelocity`, `detune`, `reserved`, `loopType`.
  - **Códigos de estado verificados (`NASAnalysisProvider`)**:
    - `0` (`NASok`): Archivo válido.
    - `1` (`NASdone`): Análisis completado (escribe ficheros).
    - `2` (`NAScancel`): Análisis cancelado por el usuario.
    - `3` (`NASerrorBadFormat`): Error de parseo (no es `FORM/AIFF` o chunk desconocido).
    - `4` (`NASreadError`): No se puede abrir el archivo (`FUN_1000f530`).
    - `5` (`NASwriteError`) / `6` (`NASinternalError`): Errores de E/S o internos.
    - `7` (`NASsampleRateError`): Tasa $\neq 44100\text{ Hz}$ (`LB !Sample rate needs to be 44.1kHz`).
    - `8` (`NASsampleSizeError`): Profundidad $\neq 16\text{ bits}$ (`!Only 16bit files are supported`).
    - `9` (`NASnumChannelError`): Canales $\neq 1$ (`!Only mono files are supported`).
    - `10` (`NASnumFramesError`): `0` frames (`!No data to process`).
    - `11` (`NASnotEnoughData`): Datos insuficientes.
    - `12` (`0x0C`, `NASloopIsTooSmall`): `loopStart == loopEnd != 0` o `loopEnd < loopStart`.
    - `13` (`0x0D`, `NASmissingMarker` / sustain-loop): Loop con tipo `1` (sustain-loop no soportado).
  - En **ABDNeuModMakr** (`src/core/dsp/WavDecoder.ts`), **no estamos atados a estas limitaciones de entrada**: decodificamos tanto `RIFF/WAVE` (PCM 8/16/24/32 bits + IEEE Float 32/64 bits + `WAVE_FORMAT_EXTENSIBLE`) como `FORM/AIFF` (`COMM` IEEE-80, `SSND`, `INST`), aplicamos downmix estéreo → mono `(L + R) * 0.5` en coma flotante y operamos en Hz reales independientemente del `sampleRate` de origen.
- `initNAS()` (`0x10001710`):
  - Reserva el bloque de estado persistente (~1 MB, offsets hasta `+0xf75cc`).
- `analyseSample(String sample, String scapeOut, String sphereOut, int recDepth, int paramSet, int r3, int r4, int r5)` (`0x10001750` → `FUN_10009cf0`):
  - Ejecuta el análisis iterativo ventana a ventana (`32768` floats $\approx 0,74\text{ s}$ a $44,1\text{ kHz}$) y notifica el porcentaje mediante `nasCallback(int)`.
- `cancelAnalysis(...)` (`0x10001840`):
  - Escribe `-1` en el flag global de progreso (`DAT_10015004`) para abortar limpiamente y liberar memoria.

### 1.2 Tabla Oficial `complexityToRecDepth`
En `neuronapp.ProcessDialog.complexityToRecDepth` (`tableswitch 1..10`), la complejidad seleccionada en la UI (`1..10`) se traduce a `recursionDepth`:

| Complejidad UI | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| `recursionDepth` | `1` | `4` | `8` | `12` | `16` | `24` | `32` | `42` | `54` | `64` |

---

## 2. Estructura de un Modelo Neuron (`Models/NNN.model/`)

Cada modelo generado reside en una carpeta `<NNN>.model/` (donde `NNN` es `000..511`) y contiene:

1. **`MName`**: Nombre ASCII del modelo (máximo 11 caracteres en la UI), rellenado a longitud par con `\0`.
2. **`map.script`**: Mapa completo de las 128 teclas MIDI (`000`..`127`).
   - Cabecera:
     ```text
     MapVersionMajor	0
     MapVersionMinor	9
     MapVersionBuild	2
     ```
   - Seguido de 128 bloques (`000`..`127`) con 8 pares `clave\tvalor` (separados por tabulador y `CRLF`):
     - `NNNLowKey`, `NNNHiKey`, `NNNRootKey`, `NNNLowSource`, `NNNHiSource`, `NNNDetune`, `NNNVolume`, `NNNPan`.
   - `LowSource` y `HiSource` son índices 1-based (`1..N`) al diccionario de muestras únicas de la sesión (`000001.scape`/`.sphere`, `000002.scape`/`.sphere`, etc.). Las entradas de zonas no usadas (`Z..127`) llevan todos sus campos a `0`.
3. **`%06d.scape` (ej. `000001.scape`)**:
   - Cadena de chunks donde `size` (uint32 LE en `+0x04`) **incluye los 8 bytes de cabecera** (`tag` + `size`):
     - **`csAN`** (`100` bytes en `+0x00`):
       - `+0x08`: `uint32 format = 256`
       - `+0x0C`: `int32 curveId` (debe coincidir exactamente con el `curveId` del `.sphere`)
       - `+0x10`: `int32 resolution` (muestras por ciclo a 44,1 kHz, ej. `100` para ~441 Hz)
       - `+0x14`: `int32 flags = 0`
       - `+0x18`: `int32 length` (largo útil en muestras `int16`)
       - `+0x1C`: `int32 loopStart`
       - `+0x20`: `int32 loopEnd`
     - **`mnAN`** (`104` bytes en `+0x64`): 12 nombres ASCII de 8 bytes correspondientes a los ejes de morfología Scape del `Parameter Set` (`0..9`).
     - **`fdAN`** (`56` bytes en `+0xCC`): 6 pares de `float32` (48 bytes de payload).
     - **Payload en `+0x104` (260)**: Array de `int16` little-endian con la curva de excitación/fase periódica (leída por `FUN_100317b0` con interpolación lineal y diferenciador de 2 puntos).
4. **`%06d.sphere` (ej. `000001.sphere`) — Verificado sobre 3.134 ficheros reales (`Models/000..511`)**:
   - Cadena de chunks:
     - **`psAN`** (`140` bytes en `+0x00`):
       - `+0x08`: `int32 version` $\in \{272, 288\}$ (`272` = escritor antiguo con 6 floats a cero; `288` = `0x120` nuevo con 6 floats rellenos)
       - `+0x0C`: `int32 curveId` (idéntico al de `.scape`)
       - `+0x10`: `int32 cnt = parameterSet` (`0..9`, verificado al 100 % contra las ventanas de nombres `mnAN`)
       - `+0x14`: `int32 periodo` (periodo de la fundamental en muestras a 44,1 kHz $\approx \text{round}(44100 / f_0)$ con clamp $\ge 84$, idéntico al campo `+0x10` de `.scape`)
       - `+0x18`: `int32 nvalid` (número de frames válidos, típicamente `nsamp / 1024 - 3` con hop de 1024 muestras)
       - `+0x1C`: `int32 stick = recursionDepth` (`1, 4, 8, 12, 16, 24, 32, 42, 54, 64`)
       - `+0x20`: `int32 psum = max(4, nextpow2(stick))`
       - `+0x24`: `int32 paso = max(4, nextpow2(stick))` (`1→4`, `4→4`, `8→8`, `16→16`, `24→32`, `32→32`, `42→64`, `64→64`)
       - `+0x28`: `int32 nb` $\in \{1, 25, 61\}$ (`1` en modo draft `parameterSet == 9`; `25` lo común; `61` en zonas sueltas)
       - `+0x2C`: `int32 nb2 == nb`
       - `+0x30`: `int32 psize = 6152` (tamaño fijo del banco aditivo de 1024 parciales)
       - `+0x34`: `int32 u1 = round(loopStart / 1024)` (inicio de loop en frames; `0` si one-shot)
       - `+0x38`: `int32 u2 = round(loopEnd / 1024)` (fin de loop en frames; `0` si one-shot)
       - `+0x3C`: `int32 mask = 0`
       - `+0x40`: `int32 reserved = 0`
       - `+0x44`: `int32 frameStride = 16 + nb * paso * 4 + 6152` (ej. `6568` para `nb=25, paso=4`; `6968` para `25, 8`; `7768` para `25, 16`; `6296` para `1, 32`; `10072` para `61, 16`; `21784` para `61, 64`)
       - `+0x48`: `int32 dataOffset = 300` (`0x12C`)
       - `+0x4C`: `int32 unk4c = 0`
       - `+0x50`: `6 × float32` = **3 pares globales `(freqHz, amp)`** ganadores del peak-picking de 3 parciales en los histogramas de `NASAnalysis.dll` (`+0xdf41c`, `+0xe341c`, `+0xe741c`).
     - **`mnAN`** (`104` bytes en `+0x8C`): 12 nombres ASCII de 8 bytes tomados de la Tabla A (`0x100154d0`, 91 slots) según el `parameterSet` (`0..9`), mientras que `.scape` los toma de la Tabla B (`0x10015938`, 73 slots) con préstamos puntuales de A.
     - **`fdAN`** (`56` bytes en `+0xF4`): 6 pares complementarios de `float32` (`[(0,0), (1,1), (x, 0.5), (1-x, 0.5), (y, 0), (1-y, 1)]`).
     - **Banco de Frames en `+0x12C` (300)**: Cada `SphereFrame` ocupa `step = 16 + nb * paso * 4 + 6152` bytes:
       - `+0x00`: `int32 magic = 0x4D2` (`1234`, verificado por `FUN_10031950`)
       - `+0x04`: `int32 frame_id = curveId + frameIndex`
       - `+0x08`: `2 × float32` (cabecera de frame)
       - `+0x10`: `float32 bands[nb][paso]` (`nb * paso * 4` bytes)
       - `+0x10 + nb * paso * 4`: **Bloque aditivo de `6152` bytes (1024 parciales)** leído por `FUN_1002e750` → `FUN_1003bd10` / `FUN_1003c980`:
         - `+0x000`: `uint16 count = 1024`
         - `+0x002`: `uint16 blockGain` (factor de normalización del frame, ej. `31040` / `54130`)
         - `+0x004`: `uint16 0`, `+0x006`: `uint16 0`
         - `+0x008`: `uint16 freqA[1024]` — frecuencia medida del pico en Hz
         - `+0x808`: `uint16 ampB[1024]` — amplitud lineal `65535..0` **ordenada en orden descendente** (el primer `0` termina la lista de parciales activos)
         - `+0x1008`: `uint16 binC[1024]` — índice de bin `0..1023` sobre la rejilla `44100 / 1024 = 43,066 Hz`

---

## 3. Pipeline DSP TypeScript en `ABDNeuModMakr` (`src/core/dsp/`)

| Módulo | Archivo | Responsabilidad |
|---|---|---|
| **WAV / AIFF Decoder** | `src/core/dsp/WavDecoder.ts` | Decodificador nativo `RIFF/WAVE` (PCM 8/16/24/32 + IEEE Float 32/64 + `WAVE_FORMAT_EXTENSIBLE`) y `FORM/AIFF` (`COMM` IEEE-80, `SSND`, `INST`), downmix estéreo → mono y sintetizador de muestras de prueba. |
| **Motor FFT / STFT** | `src/core/dsp/FftEngine.ts` | FFT Radix-2 Cooley-Tukey en TypeScript puro con tablas precalculadas, ventanas `blackman-harris` (4 términos JUCE), `hanning`, `blackman`, `hamming`, y STFT completa (magnitud + fase). |
| **Analizador Espectral** | `src/core/dsp/SpectralAnalyzer.ts` | Port 1:1 de `SpectralAnalyzer.cpp`: FFT 8192 puntos, HPS refinado (`k=2..4`) con escalera de octava para fundamental débil, ajuste por mínimos cuadrados en 2 pasadas (`fitGridLeastSquares`), batería de candidatos de octava, peak-picking sub-bin parabólico en media banda con guardia de máximo local, detección de sub-rejilla entrelazada (`f0/2` impar) y análisis temporal (`1..16` frames). |
| **Clustering de Capas** | `src/core/dsp/LayerClustering.ts` | Port 1:1 de `LayerClustering.h`: separación automática en hasta 3 capas espectrales por forma de envolvente (`supportFraction`, `entropy` o `envelopeCosine`), refinado por medoide, guardia de degeneración (`kPersistentSupport = 0.75`) y orden por persistencia. |
| **Indicador de Rejilla** | `src/core/dsp/GridIndicator.ts` | Port 1:1 de `SpectralModel.h`, `GridIndicator.h` y `LayerView.h` (bandas de residuo verde $\le 15$ cents, amarillo $\le 40$ cents, naranja $> 40$ cents). |
| **Scape/Sphere & `.neuronikmodel`** | `src/core/dsp/ScapeSphereGenerator.ts` | Generación de descriptores Scape/Sphere, serialización binaria auténtica `.scape` (`csAN`) y `.sphere` (`psAN` + bloque aditivo de 6152 B), `map.script`, `.neuronikmodel` JSON v2/v2.1 (`SpectralModelWriter.h`) y resíntesis aditiva de verificación (`resynthesizeModelToPcm`). |
| **Web Worker & Pipeline** | `src/core/worker/analysisWorker.ts`, `src/core/WebAudioPipeline.ts` | Ejecución asíncrona en segundo plano por zona con reporte de progreso, cancelación y audición mediante Web Audio API. |

---

## 7. Hallazgos de la Descompilación de `NASAnalysis.dll` (REA / Ghidra 12.1.4)

Mediante el servidor MCP `rea` (Ghidra `12.1.4`) y el desensamblado x86 directo de `NASAnalysis.dll` (SHA-256 `434e2ac94f257c3af87aef745bad2138c70a3a122a60b94f7ad0dfa81f780711`), se resolvió el 100% restante del pipeline nativo que el descompilador C de Ghidra ocultaba tras `__chkstk` (`0x100017b0`) y la poda del bloque `0x10009fdb..0x1000a0ca`:

1. **Constructores de cabeceras `.scape` (`FUN_10003e60`) y `.sphere` (`FUN_100038f0`)**:
   - `paso` (`+0x20` y `+0x24` en `psAN`) se calcula como la siguiente potencia de 2 mayor o igual a `recDepth`: $\text{paso} = 2^{\lfloor \log_2(\text{recDepth} - 1) \rfloor + 1}$ (ej. `recDepth = 20 -> paso = 32`).
   - `nb` (`+0x28` y `+0x2c` en `psAN`) vale `61` (`0x3d`) cuando el 6º argumento `r3 == 0` y `25` (`0x19`) cuando `r3 != 0`.
   - `mnAN` (104 B) y `fdAN` (56 B) se construyen mediante `FUN_100028e0` (para `.scape`) y `FUN_10001880` (para `.sphere`), donde `FUN_10001880` pliega `periodo` por octavas frente a `164.0` muestras (`0x10015920`).
2. **Generador del Bloque de 6152 Bytes (`FUN_10007e00` — Phase Vocoder de 1024 Parciales)**:
   - Opera sobre una ventana deslizante de `2048` muestras con salto de `512` muestras (2 pasos por cada frame de `1024` muestras) y ventana parabólica de Welch $w[n] = 1 - ((2n - 2047)/2047)^2$.
   - Calcula la frecuencia instantánea verdadera por desviación de fase $\Delta\phi_k$ respecto a $k\pi/2$, normaliza las magnitudes respecto al máximo del frame $M_{\max}$ y ordena los `1024` bins de **mayor a menor amplitud** mediante *insertion sort*.
   - Almacena en `+0x000` el contador `1024` (`0x0400`), en `+0x002` `blockGain = round(M_max * 65535.0)`, en `+0x008` `uint16[1024]` las frecuencias en **unidades de `0.5 Hz`** (`round(freqHz * 2.0 + 0.5)`), en `+0x808` `uint16[1024]` las amplitudes normalizadas (`65535..0`) y en `+0x1008` `uint16[1024]` los índices de bin FFT originales (`0..1023`).
3. **Parcheo de Cabeceras al Final de la Zona (`0x1000c180..0x1000c62a`)**:
   - Al terminar todos los frames, extrae la moda del histograma de periodos (`periodo` en muestras) y los 3 picos espectrales ganadores (`winningBin * 10.7666 Hz`, `sumAmp / voteCount`), rebobina `.sphere` y `.scape` con `fseek(..., 0, SEEK_SET)` (`0x10010000`) y parchea `psAN`, `csAN`, `mnAN` y `fdAN`.

> Para el mapa completo de direcciones virtuales, constantes IEEE-754 y ensamblador comentado, véase [`DOCS/NASANALYSIS_DECOMPILATION.md`](./NASANALYSIS_DECOMPILATION.md).

