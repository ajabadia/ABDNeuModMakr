# Descompilación Completa de `NASAnalysis.dll` (REA / Ghidra 12.1.4)

> **Binario analizado**: `C:\Users\ajaba\Downloads\neuron\NeuronMM_1_2_PC\NASAnalysis.dll`  
> **SHA-256**: `434e2ac94f257c3af87aef745bad2138c70a3a122a60b94f7ad0dfa81f780711`  
> **Arquitectura / Compilador**: PE32 x86 (`ImageBase = 0x10000000`), Metrowerks CodeWarrior C/C++ para Windows x86 (`MW Win32 Runtime`).  
> **Herramienta**: MCP Server `rea` (Ghidra `12.1.4` headless + desensamblado x86 directo).

---

## 1. Por qué el descompilador C de Ghidra ocultaba el generador `.scape` / `.sphere`

Al descompilar `FUN_10009cf0` (`analyseSample`) únicamente mediante el pseudocódigo C de Ghidra aparecen dos obstáculos clásicos del compilador Metrowerks CodeWarrior:

1. **Alocación de pila mediante `__chkstk` (`0x100017b0`)**:
   - `FUN_10009cf0` ejecuta `MOV EAX, 0x431c; CALL 0x100017b0` (y de forma análoga `FUN_100038f0` reserva `0x4278` bytes y `FUN_10003e60` reserva `0x4230` bytes).
   - Como `0x100017b0` ajusta `ESP` dinámicamente a partir de `EAX`, el rastreador de pila de Ghidra pierde la convención de paso de argumentos por `[ESP + offset]` en las llamadas subsiguientes.
2. **Poda de bloque supuestamente inalcanzable (`Removing unreachable block`)**:
   - En el bucle de validación AIFF (`0x10009f80..0x10009fd9`), `FUN_10004130(handle, &doneFlag, EBP)` modifica por referencia el byte `[ESP + 0x41ab]` (`doneFlag = 0` al terminar de recorrer los chunks `FORM/AIFF`).
   - El análisis de flujo de datos de Ghidra asume que `[ESP + 0x41ab]` permanece siempre en `1` y **elimina en el pseudocódigo C el bloque `0x10009fdb..0x1000a0ca`**, que es precisamente donde se inicializan y abren los ficheros `.scape` y `.sphere`.

Al inspeccionar el listado de ensamblador x86 mediante `rea:procedure_assembly` (`0x10009cf0` y `0x100038f0`), el flujo real queda expuesto al 100%.

---

## 2. Mapa Completo de Funciones de `NASAnalysis.dll`

| Dirección VA | Nombre / Rol Real | Firma Reconstruida | Descripción |
| :--- | :--- | :--- | :--- |
| `0x10001710` | `Java_neuron_NASInterface_validateSample` | `(JNIEnv*, jclass, jstring path)` | Wrapper JNI de validación de muestra AIFF. Devuelve código `0..13`. |
| `0x10001500` | `Java_neuron_NASInterface_analyseSample` | `(JNIEnv*, jclass, jstring sample, jstring scape, jstring sphere, jint recDepth, jint paramSet, jint r3)` | Wrapper JNI principal de análisis y síntesis de modelos. |
| `0x100014d0` | `Java_neuron_NASInterface_getProgress` | `(JNIEnv*, jclass)` | Devuelve el porcentaje de progreso global (`0..100` en `0x100154c8`). |
| `0x100014e0` | `Java_neuron_NASInterface_cancelCalculation` | `(JNIEnv*, jclass)` | Activa el flag de cancelación (`0x100154cc = 1`). |
| `0x10009b20` | `validateSample_core` | `(const char* path)` | Valida chunks `FORM`/`AIFF`, `COMM` (`44100 Hz`, `16-bit`, `mono`, `numSamples > 0`), `SSND`, `MARKER` e `INST` (rechaza sustain loops). |
| `0x10009cf0` | `analyseSample_core` | `(const char* samplePath, const char* scapePath, const char* spherePath, int recDepth, int paramSet, int r3, int* progress, int* cancel)` | Pipeline completo de análisis espectral y escritura de `.scape` y `.sphere`. |
| `0x10004da0` | `initAiffSampleState` | `(const char* samplePath, NASState* state)` | Abre el AIFF y carga en `state` (`EBP`) el offset `SSND` (`+0x10`), `numSamples` (`+0x14`), `loopStart` (`+0x08`), `loopEnd` (`+0x0c`) y `sampleRate` (`+0x4164`). |
| `0x10003e60` | `createScapeFile` | `(const char* scapePath, NASState* state, int flags, int paramSet)` | Abre el fichero `.scape` (`"wb+"`), ordena `loopStart`/`loopEnd`, escribe la cabecera `csAN` (100 B) y escribe `mnAN` (104 B) + `fdAN` (56 B) iniciales. Guarda offset `260` en `[EBP + 0x4134]` y `FILE*` en `[EBP + 0x4158]`. |
| `0x100038f0` | `createSphereFile` | `(const char* spherePath, NASState* state, int recDepth, int paramSet, int nb)` | Abre el fichero `.sphere` (`"wb+"`), calcula `paso`, `numFrames` y `frameStride`, escribe `psAN` (140 B) + `mnAN` (104 B) + `fdAN` (56 B). Guarda `FILE*` en `[EBP + 0x415c]`. |
| `0x100028e0` | `buildScapeMnAnFdAn` | `(uint32_t* mnAN, float* fdAN, int paramSet, int period)` | Rellena los 12 nombres ASCII de 8 bytes (`mnAN`, 104 B) y los 6 pares de floats (`fdAN`, 56 B) de `.scape` para `paramSet` (`0..9`). |
| `0x10001880` | `buildSphereMnAnFdAn` | `(uint32_t* mnAN, float* fdAN, int paramSet, int period)` | Rellena los 12 nombres ASCII de 8 bytes (`mnAN`, 104 B) y los 6 pares de floats (`fdAN`, 56 B) de `.sphere` para `paramSet` (`0..9`), plegando `period` por octavas respecto a `164.0`. |
| `0x100056a0` | `readAiffFrameFloats` | `(const char* path, NASState* state, float* dst, uint32_t sampleOffset, int count)` | Lee `count` (`1024`) muestras `int16` big-endian desde `SSND`, hace byte-swap a little-endian, divide entre `32768.0` y aplica fade-out lineal en el último frame. |
| `0x10007e00` | `computePhaseVocoderPartials` | `(int hop, const float* frame, int16_t* outGain, uint16_t* outFreq, uint16_t* outAmp, uint16_t* outBin, uint16_t* outCount, int* initFlag)` | Construye el bloque aditivo de **6152 bytes (`0x1808`) y 1024 parciales** en `0x1001e028` mediante un Phase Vocoder de 2048 puntos con ventana parabólica de Welch y salto interno de 512 muestras. |
| `0x10005ce0` | `extractTop3SpectralPeaks` | `(Peak3* outPeaks, int numPeaks, const float* frame, int frameLen)` | Calcula autocorrelación centrada de 4096 puntos (`0x100063b0`), FFT de 4096 puntos (`0x100068a0`) y extrae los 3 picos principales (`0x10005f90`) ordenados por frecuencia para los 3 histogramas de `psAN.shaping`. |
| `0x100063b0` | `autocorrelateAndTaper` | `(int lagCount, const float* x, int fftLen, float* outBuf)` | Calcula autocorrelación normalizada, elimina la media DC y aplica ventana triangular decreciente `1.0 - i / N`. |
| `0x10005f90` | `pickSpectralPeaks` | `(Peak3* out, float* mag, int maxPeaks, int halfFft)` | Detecta los `maxPeaks` (`3`) máximos espectrales por encima de `50 Hz`, estima anchura de valle a izquierda/derecha y pone a cero el lóbulo antes de buscar el siguiente pico. |
| `0x100068a0` | `radix2ComplexFft` | `(float* data, int N, int sign)` | FFT compleja in-place Radix-2 Cooley-Tukey (`N` complejos intercalados `[re, im]`, `sign = -1` directa / `+1` inversa). |
| `0x1000f530` | `fopen` (MSL) | `(const char* filename, const char* mode)` | Wrapper `stdio` de Metrowerks Standard Library. |
| `0x1000f3d0` | `fclose` (MSL) | `(FILE* stream)` | Cierra stream `FILE*`. |
| `0x1000f350` | `remove` (MSL) | `(const char* path)` | Elimina ficheros `.scape`/`.sphere` incompletos si el usuario cancela (`NAScanceled = 2`). |
| `0x10010000` | `fseek` (MSL) | `(FILE* stream, long offset, int whence)` | Reposiciona el puntero de fichero. |
| `0x1000fee0` | `ftell` (MSL) | `(FILE* stream)` | Devuelve posición actual del stream. |
| `0x1000f880` | `fread` (MSL) | `(void* ptr, size_t size, size_t count, FILE* stream)` | Lectura binaria con buffer. |
| `0x1000fb70` | `fwrite` (MSL) | `(const void* ptr, size_t size, size_t count, FILE* stream)` | Escritura binaria con buffer. |

---

## 3. Tabla Exacta de Constantes Globales (`0x10015920..0x10015f2c`)

Extraída directamente de la sección `.rdata`/`.data` de `NASAnalysis.dll`:

| Dirección VA | Tipo | Valor Exacto | Uso en `NASAnalysis.dll` |
| :--- | :--- | :--- | :--- |
| `0x10015920` | `float32` | `164.0f` | Periodo de referencia en muestras (~`268.9 Hz`, C#4) para plegar por octavas `periodo` en `FUN_10001880` (`fdAN`). |
| `0x10015928` | `float64` | `2.0` | Factor de octava (`2.0`) y escala de medios hercios (`0.5 Hz`) en `FUN_10007e00`. |
| `0x10015930` | `float64` | `1.0` | Constante unidad `1.0` (complementos `1.0 - x` en `fdAN`, ventana de Welch, tapers). |
| `0x10015ca0` | `float64` | `0.0078125` | `1.0 / 128.0`. |
| `0x10015ca4` | `float32` | `1.0f` | Unidad `1.0f` para `F2XM1 + 1.0f` en cálculo de potencias de 2 (`0x100038f0`). |
| `0x10015cac` | `float32` | `1024.0f` | Salto de frame (`hop = 1024` muestras) y mitad de ventana FFT (`2048 / 2`). |
| `0x10015cb0` | `float64` | `0.5` | Redondeo entero (`+ 0.5`). |
| `0x10015d10` | `float64` | `32768.0` | Escala de normalización PCM 16-bit (`int16 / 32768.0`). |
| `0x10015d40` | `float64` | `16383.0` | Escala de cuantización `int16` para la excitación `.scape`. |
| `0x10015d78` | `float64` | `44100.0` | Frecuencia de muestreo canónica (`44.1 kHz`). |
| `0x10015d98` | `float64` | `22050.0` | Frecuencia de Nyquist (`22.05 kHz`). |
| `0x10015da0` | `float32` | `50.0f` | Frecuencia mínima (`50 Hz`) para aceptar picos en `FUN_10005f90`. |
| `0x10015db8` | `float64` | `6.283185307179586` | $2\pi$. |
| `0x10015dc8` | `float64` | `3.141592653589793` | $\pi$. |
| `0x10015dd8` | `float64` | `4.0` | Factor de sobremuestreo temporal del Phase Vocoder (`2048 / 512 = 4`). |
| `0x10015df0` | `float64` | `65535.0` | Escala `uint16` (`0xFFFF`) para amplitudes y ganancia de bloque en `.sphere`. |
| `0x10015df8` | `float32` | `44100.0f` | Frecuencia de muestreo `float32`. |
| `0x10015e00` | `float64` | `2048.0` | Tamaño de FFT del Phase Vocoder (`N = 2048`). |
| `0x10015e08` | `float32` | `21.533203125f` | Resolución de bin del Phase Vocoder (`44100 / 2048 Hz`). |
| `0x10015e10` | `float64` | `2047.0` | `N - 1` para la ventana parabólica de Welch de 2048 muestras. |
| `0x10015e38` | `float64` | `1.5707963267948966` | $\pi / 2$ (avance de fase esperado por bin cada `512` muestras en una FFT de `2048`). |
| `0x10015f28` | `float32` | `10.7666015625f` | Resolución de bin de los 3 histogramas globales (`44100 / 4096 Hz`). |

---

## 4. Algoritmo Exacto de `createSphereFile` (`0x100038f0`)

Al crear el archivo `.sphere`, `FUN_100038f0` calcula todos los campos geométricos de la cabecera `psAN` (140 bytes):

1. **Número de frames (`+0x18`)**:
   $$\text{numFrames} = \max\left(1, \left\lfloor \frac{\text{numSamples}}{1024} \right\rfloor - 1\right)$$
   Y guarda `numFrames + 1` en `state->totalPasses` (`[EBP + 0x4148]`).
2. **Número de bandas (`+0x28` y `+0x2c`)**:
   - En `0x10009cfe`, si el 6º parámetro `r3 == 0`, `nb = 61` (`0x3d`); si `r3 != 0`, `nb = 25` (`0x19`).
3. **Orden / Stride por banda `paso` (`+0x20` y `+0x24`) a partir de `recDepth` (`+0x1c`)**:
   ```c
   int i = 1;
   int d = recDepth - 1;
   while ((d >>= 1) > 1) {
     i++;
   }
   int paso = 1 << (i + 1); // Siguiente potencia de 2 >= recDepth (ej. recDepth=20 -> paso=32)
   ```
4. **Tamaño del bloque de parciales (`+0x30`)**:
   - Constante `0x1808` (`6152` bytes).
5. **Loop Start / End en frames (`+0x34` y `+0x38`)**:
   $$\text{loopStartFrame} = \text{round}\left(\frac{\text{loopStartSamples}}{1024.0}\right), \quad \text{loopEndFrame} = \text{round}\left(\frac{\text{loopEndSamples}}{1024.0}\right)$$
6. **Stride total de frame (`+0x44`) y Offset de datos (`+0x48`)**:
   $$\text{frameStride} = 16 + 4 \cdot \text{nb} \cdot \text{paso} + 6152$$
   $$\text{dataOffset} = 300 \text{ bytes } (\text{0x12C} = 140_{\text{psAN}} + 104_{\text{mnAN}} + 56_{\text{fdAN}})$$

---

## 5. Algoritmo Exacto del Bloque de 6152 Bytes (`FUN_10007e00` — Phase Vocoder de 1024 Parciales)

La función `FUN_10007e00` (`0x10007e00`) resuelve por completo la estructura interna de los `6152` bytes (`0x1808`) al final de cada frame de `.sphere`:

1. **Ventana deslizante de 2048 muestras con salto de 512 muestras**:
   - Mantiene un buffer circular `DAT_1008175c[0..2047]` cuyo cursor empieza en `0x600` (`1536`).
   - Cada vez que entran `512` muestras nuevas (dos veces por cada frame de `1024` muestras), multiplica las `2048` muestras por una **ventana parabólica de Welch**:
     $$w[n] = 1.0 - \left(\frac{2n - 2047}{2047.0}\right)^2, \quad n \in [0, 2047]$$
2. **FFT Compleja de 2048 puntos y Phase Vocoder**:
   - Ejecuta `FUN_100068a0(&DAT_1008975c, 2048, -1)`.
   - Para cada bin $k \in [0, 1024]$:
     - Magnitud normalizada:
       $$M_k = \frac{2.0}{1024.0} \sqrt{\text{Re}_k^2 + \text{Im}_k^2}$$
     - Fase instantánea y desviación de fase respecto al salto anterior de 512 muestras ($\Delta t = 512 / 2048 = 1/4$ de ventana, avance nominal $k \cdot \pi / 2$):
       $$\phi_k = \text{atan2}(\text{Im}_k, \text{Re}_k), \quad \Delta\phi_k = \text{wrap}_{[-\pi, \pi]}\left((\phi_k - \phi_k^{\text{prev}}) - k \frac{\pi}{2}\right)$$
     - Frecuencia instantánea verdadera en Hz:
       $$f_k = \left(k + \Delta\phi_k \frac{4.0}{2\pi}\right) \cdot \frac{44100.0}{2048.0}$$
     - Si $f_k < 21.5332\text{ Hz}$, descarta el bin ($f_k = 22050\text{ Hz}, M_k = 0$).
3. **Normalización al pico del frame y ordenación descendente**:
   - Calcula $M_{\max} = \max_k M_k$. Si $M_{\max} > 0$, divide todas las magnitudes entre $\min(1.0, M_{\max})$.
   - Ordena los 1024 bins mediante *insertion sort* de **mayor a menor magnitud** ($M_{(0)} \ge M_{(1)} \ge \dots \ge M_{(1023)}$), permutando simultáneamente $(M_k, f_k, k)$.
4. **Empaquetado binario en `0x1001e028..0x1001f82f` (6152 bytes)**:
   - `+0x0000` (`uint16`): `1024` (`0x0400`, número de parciales).
   - `+0x0002` (`uint16`): `blockGain = round(M_max * 65535.0)`.
   - `+0x0004` (`uint32`): `0` (reservado).
   - `+0x0008..+0x0807` (`uint16[1024]`): **Frecuencias instantáneas en unidades de `0.5 Hz`**:
     $$\text{freqU16}[i] = \text{round}(f_{(i)} \cdot 2.0 + 0.5)$$
     *(Verificado en `511.model` "sinew": para $f_0 = 441\text{ Hz}$, `freqU16[0] == 882`).*
   - `+0x0808..+0x1007` (`uint16[1024]`): **Amplitudes normalizadas en orden descendente**:
     $$\text{ampU16}[i] = \text{round}(M_{(i)}^{\text{norm}} \cdot 65535.0), \quad \text{ampU16}[0] = 65535$$
   - `+0x1008..+0x1807` (`uint16[1024]`): **Índice de bin FFT original** $k_{(i)} \in [0, 1023]$.

---

## 6. Parcheo Final de Cabeceras al Terminar la Zona (`0x1000c180..0x1000c62a`)

Al concluir el bucle de frames de una zona:
1. Busca la moda estadística del histograma de periodos (`EBP + 0xb4308`, rango `2..44099` muestras) para obtener el periodo fundamental global `periodo` en muestras.
2. Busca el bin ganador (`0..4095`) en cada uno de los 3 histogramas de picos (`EBP + 0xdf41c`, `0xe341c`, `0xe741c`):
   - `shapingFreq[m] = winningBin[m] * 10.7666015625f` (`44100 / 4096 Hz`)
   - `shapingAmp[m]  = sumAmp[winningBin[m]] / voteCount[winningBin[m]]`
3. Hace `fseek(sphereFile, 0, SEEK_SET)`, lee los `140` bytes de `psAN`, escribe `periodo` en `+0x14` y los 6 floats `(shapingFreq[m], shapingAmp[m])` en `+0x50..+0x67`, y reescribe `psAN`.
4. Hace `fseek(scapeFile, 0, SEEK_SET)`, lee los `100` bytes de `csAN`, escribe `periodo` en `+0x10` y reescribe `csAN`.
5. Vuelve a invocar `FUN_100028e0` y `FUN_10001880` con el `periodo` definitivo para actualizar `mnAN` (104 B) y `fdAN` (56 B) en ambos ficheros antes de cerrarlos con `fclose`.
