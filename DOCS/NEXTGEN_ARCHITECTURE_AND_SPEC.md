# 🧬 ABDNeuModMakr — Especificación Maestra Next-Gen (Fases 6 a 13)

> **Propósito de este documento**: Recoger sin pérdida ningún matiz técnico, algorítmico ni arquitectónico acordado desde las conversaciones iniciales de concepción hasta el plan de ingeniería definitivo para **ABDNeuModMakr** y su integración con **ABDAxionikVS** (`C++ / JUCE 9`) y **NeuronDB** (~500 modelos).
>
> **Última actualización**: `2026-10-29`

---

## 1. Diagnóstico Técnico del Hartmann Neuron Original (Punto de Partida)

1. **El mito de la "Síntesis Neuronal" vs. la realidad de `NASAnalysis.dll`**:
   - El hardware original (2001–2005) y el software `MODELmaker v1.2` (desarrollado por Stephan Bernsee / Prosoniq) **no ejecutaban redes neuronales en tiempo real** ni aprendían libremente de cada muestra.
   - El usuario debía elegir manualmente uno de los **10 Parameter Sets (`0..9`)** predefinidos. Cada Parameter Set es una plantilla fija de enrutamiento DSP y mapeo de ejes (`mnAN` / `fdAN`) para **Scape** (propiedades de excitación/ataque) y **Sphere** (propiedades del cuerpo resonante).
   - De hecho, varios de esos algoritmos recortaban la resolución temporal/espectral (`nb = 1` vs `nb = 25 / 61`) simplemente para que la CPU del sintetizador pudiera alcanzar ~20 voces a `44.100 Hz`.
2. **Las limitaciones rígidas del mapeo Clásico (`map.script` + `.scape`/`.sphere`)**:
   - **Cuadrícula homogénea ("Anti-Lego")**: El teclado `0..127` se divide únicamente en columnas verticales contiguas sin huecos ni solapamientos. Todas las velocidades dentro de una columna están obligadas a compartir exactamente el mismo rango `[LowKey..HiKey]`. Si una muestra abarca distinto rango en otra velocidad, hay que trocear la columna y repetir datos espectrales.
   - **Solo 2 velocidades fijas (`1..63` y `64..127`)**: El corte de velocidad en el motor clásico está fijado en el valor MIDI `64` (`LowSource` y `HiSource`).
   - **Un único Volumen, Pan y Detune por columna**: En `map.script`, `Volume` (`-32..+12 dB`), `Pan` (`-50..+50`) y `Detune` (`-99..+99 cents`) se definen por zona de teclado, afectando por igual a `LowSource` y `HiSource`.
   - **Audio estrictamente Mono a `44.100 Hz`**: Los archivos `.scape` y `.sphere` son monocanal. El Surround 4.0/5.1 del hardware original no estaba en los modelos, sino en un paneo/efectos posterior en la sección *Silver*.

---

## 2. Arquitectura del Modo de Creación Dual (`Classic` vs. `Extended`) y Adaptación a la Salida

### 2.1 Desacoplamiento entre Creación y Exportación
En lugar de atar la edición al formato de salida, la interfaz dispondrá de un **conmutador libre de Modo de Creación (`Classic Creation` vs `Extended Creation`)**:
- **Si trabajas en Creación Clásica**: Juegas con las reglas estrictas de Hartmann (columnas contiguas `0..127`, sin huecos ni solapes, 2 alturas de velocidad partidas en `64`, nombres de hasta 11 caracteres para hardware).
- **Si trabajas en Creación Extendida**: Juegas con un mapa 2D libre de regiones (`Key × Velocity`) con todas las posibilidades de los samplers modernos (SFZ, HALion, Kontakt, SampleTank).
- **Al Exportar**:
  - Si creaste en Clásico y exportas en Clásico (o Extendido) $\rightarrow$ Directo.
  - Si creaste (o importaste un SF2/SFZ) en **Extendido** y exportas a **Clásico** $\rightarrow$ El **Compilador/Adaptador Clásico** realiza automáticamente las transformaciones necesarias para cumplir al 100% las reglas del formato clásico.

### 2.2 Capacidades del Modo de Creación Extendido (`ExtendedRegion`)
Cada región en nuestra definición nativa soporta:
1. **Geometría 2D Libre ("Lego")**:
   - `lowKey..highKey` (`0..127`), `rootKey` (`0..127`), `lowVel..highVel` (`1..127`) independientes para cada muestra. Permite $N$ capas de velocidad por nota y rangos de notas asimétricos entre velocidades.
2. **Crossfades en Altura (Tecla) y en Velocidad**:
   - `keyFadeIn`, `keyFadeOut` (en semitonos) y `velFadeIn`, `velFadeOut` (en unidades de velocidad MIDI `0..127`), con curva seleccionable (`linear`, `equal-power`, `spectral-morph`).
3. **Loops Avanzados**:
   - `loopMode`: `'no_loop' | 'loop_continuous' | 'loop_sustain' | 'one_shot'`.
   - `loopStart`, `loopEnd` (en muestras o segundos) y `loopCrossfadeMs` para bucles sin clics.
4. **Afinación y Seguimiento de Teclado (`Pitch Keytracking`)**:
   - `detuneCents` (`-100..+100`), `pitchKeytrack` (`0%` a `100%`, donde `100%` = 100 cents/semitono cromático y `0%` = pitch fijo para baterías, percusión o FX inarmónicos).
5. **Disparo y Alternancia (`Trigger` & `Round-Robin`)**:
   - `trigger`: `'attack' | 'release' | 'first' | 'legato'`.
   - `seqPosition` y `seqLength` para variaciones *Round-Robin*.
6. **Envolventes DAHDSR, Filtro y LFOs (Por Zona vs. Global y Mapeo Seguro al Sintetizador)**:
   - **Ámbito Dual (Por Zona/Onda vs. Global del Instrumento)**:
     - **Por Onda / Región (`Per-Region`)**: Puntos de Loop (`loopMode`, `loopStart`, `loopEnd`, `loopCrossfadeMs`), `pitchKeytrack`, `trigger`, `crossfades`, y (cuando el SF2/SFZ define ajustes específicos para una nota/velocidad) su envolvente DAHDSR local con opción de *"Bake ADSR into Wave"* (hornear la caída en la onda para el modo clásico).
     - **Global del Modelo / Preset (`Global Synth Articulation`)**: Envolvente de Amplitud (`Amp ADSR`), Filtro + Envolvente de Filtro (`Filter + Env`) y `LFO` generales del instrumento, visibles y editables en un panel dedicado del editor extendido.
   - **Matriz de Mapeo Seguro a `sound.script` (`ABDAxionikVS` — 445 parámetros) para NO modular lo que no debe**:
     - En `sound.script`, cada modulador tiene profundidades (`Depth`) independientes por destino. Para evitar modulaciones parásitas al importar de SF2/SFZ/HALion/SampleTank, el mapeo es explícito y con interruptores (` Enable `) por bloque:
       - **Amp ADSR** $\rightarrow$ `R1AmpEnvA`, `R1AmpEnvD`, `R1AmpEnvS`, `R1AmpEnvR` (`0..127`), manteniendo `R1ResEnv*` y `R1L*Scape/SphereEnvDepth = 0` para no deformar los ejes Scape/Sphere salvo que el usuario lo active explícitamente.
       - **Filter & Filter Env** $\rightarrow$ Solo activa `SilverSwitch = 1` si el preset SF2/SFZ realmente filtra (`cutoff < 18 kHz` o `FilterEnvDepth != 0`); mapea a `FilterType = 0 (LPF)`, `FilterFreq` (`0..127`), `FilterReso` (`0..127`), `FilterEnvA/D/S/R` y `FilterEnvDepth` (`-64..63`), dejando todos los efectos de Silver (`EQ_Switch`, `CR_Switch`, `FreqFXSwitch`, `TimeFXSwitch`) en `0`.
       - **LFO (Vibrato / Tremolo / Filter LFO)** $\rightarrow$ `LFOSwitch`, `LFORate` (`0..1000`), `LFODelay` (`-64..63`), `LFODepth = 127`, aplicando la intensidad **exclusivamente** al destino que tenía en el SF2/SFZ (`R1PitchLfoDepth` para vibrato, `R1AmpLfoDepth` para trémolo, `FilterLfoDepth` para wah) y forzando a `0` el resto de destinos (`R1L*Scape/SphereLfoDepth = 0`, `BlenderLfoDepth = 0`).

### 2.3 Algoritmo del Adaptador Extendido $\rightarrow$ Clásico
Cuando una sesión con regiones extendidas se compila hacia el formato Clásico (`legacy-neuron` o capa `04_classic_enhanced`):
1. **Proyección de Columnas de Notas (`0..127`)**:
   - Se recogen todos los puntos de corte `lowKey` y `highKey + 1` de las regiones activas (`trigger === 'attack'`) y se particiona el eje `0..127` en intervalos elementales contiguos sin huecos ni solapes.
2. **Reducción de $N$ Velocidades a la Rejilla `1..63` (`Low`) y `64..127` (`High`)**:
   - Para cada columna de notas, las regiones que intersectan `1..63` forman el grupo `Low` y las que intersectan `64..127` forman el grupo `High`.
   - Si en un grupo hay 1 sola muestra, se asigna directamente.
   - Si en un grupo caen $\ge 2$ muestras de velocidad (p. ej. `pp` en `1..31` y `mp` en `32..63`), se aplica **Fusión Espectral Ponderada** (promediando las trayectorias de magnitudes espectrales ponderadas por el ancho de su franja de velocidad y su ganancia) o selección de la muestra central según configuración.
3. **Compensación Matemática del Volumen Único por Columna**:
   - Como `map.script` solo admite un `Volume` entero (`-32..+12 dB`) para toda la columna:
     - Se fija el `Volume` de la zona en `map.script` al valor correspondiente a la capa de mayor energía (normalmente `High`, p. ej. $V_{\text{zone}} = \text{round}(G_{\text{high}})$).
     - La diferencia relativa de ganancia de la otra capa ($\Delta G_{\text{low}} = G_{\text{low}} - V_{\text{zone}}$ en dB, convertida a factor lineal $10^{\Delta G / 20}$) **se multiplica directamente sobre las amplitudes de la curva `.scape` y los parciales `.sphere`** de esa fuente antes de serializarla. Así el sintetizador clásico reproduce el balance dinámico exacto entre velocidades bajas y altas.

---

## 3. Importación Universal a Formato Nativo (`.sf2`, `.sfz`, Kontakt/SampleTank/HALion)

1. **Principio de Conversión a Formato Propio**:
   - Al importar un archivo `.sf2` (SoundFont 2), `.sfz`, o estructuras exportadas desde Kontakt, SampleTank o HALion, **nunca guardamos el contenedor `.sf2`/externo**.
   - El importador extrae las ondas de audio a archivos WAV/AIFF independientes en memoria/proyecto y traduce todas las zonas, velocidades, loops y envolventes a **nuestro propio esquema de sesión/modelo nativo**.
2. **Particularidades del Importador `.sf2` y `.sfz`**:
   - **Selector de Preset**: Si un `.sf2` contiene múltiples presets (p. ej. un banco con 128 instrumentos), se abre un modal selector (con buscador por banco/programa) para elegir cuál importar.
   - **Unión de Pares Estéreo (`Left / Right`)**: En SoundFont 2, los samples estéreo se almacenan como dos zonas mono vinculadas (`sampleModes` / `sampleType` Left y Right con `pan = -50` y `+50`). El importador detecta estas parejas y reconstruye un único **WAV Estéreo de 2 canales** en nuestra definición nativa.
   - **Traducción de DAHDSR, Filtro y LFO al archivo `.sound`**:
     - Los generadores del SF2/SFZ (`attackVolEnv`, `decayVolEnv`, `sustainVolEnv`, `releaseVolEnv`, `initialFilterFc`, `initialFilterQ`, `vibLfoToPitch`, etc.) se guardan en la definición nativa y se mapean automáticamente a los parámetros correspondientes de los Resynators, Shaper y Silver del archivo `sound.script` (445 parámetros) al exportar.
   - **Opción de *"Hornear ADSR" (`Bake Envelope`)* en la onda**: Para instrumentos SF2 donde el carácter percusivo o punteado reside únicamente en el `decayVolEnv` aplicado sobre un loop corto estático, permite imprimir esa caída de amplitud/filtro en el audio antes de calcular los `.scape`/`.sphere` clásicos.

---

## 4. Autodetección Inteligente y Motor Clásico Mejorado (`Classic Enhanced`)

### 4.1 Autodetección de Nota Raíz ($f_0$) y Detector de Percusión / Ruido
1. **Prioridad de metadatos verificados**: Si la muestra proviene de un SF2/SFZ o tiene chunk `INST`/`smpl` con `rootKey` válido (y coherente), se toma como referencia; si es un WAV crudo o con `rootKey` genérico sin calibrar, actúa el detector.
2. **Detector Híbrido Temporal + Espectral**:
   - Dominio temporal: **YIN / MPM (McLeod Pitch Method)** para estimar el periodo fundamental sin caer en errores de sub-armónicos.
   - Dominio espectral: **HPS (Harmonic Product Spectrum) + ajuste por Mínimos Cuadrados (Least-Squares) en 2 pasadas** sobre los parciales detectados.
   - Conversión a nota MIDI y desviación fina:
     $$d = 69 + 12 \cdot \log_2\left(\frac{f_0}{440}\right), \quad \text{rootKey} = \text{round}(d), \quad \text{detuneCents} = \text{round}(100 \cdot (d - \text{rootKey}))$$
3. **Filtro de Confianza / Sonidos Percusivos o Ruido**:
   - Calcula la **Periodicidad / Armonicidad (Confidence $0..1$)**, la **Planicidad Espectral (*Spectral Flatness*)** y la **Tasa de Cruce por Cero (*ZCR*)**.
   - Si la confianza armónica es baja (p. ej. $< 0,35$), marca automáticamente la muestra como **Inarmónica / Percusiva / Ruido** (`isUnpitched = true`, `pitchKeytrack = 0` en modo extendido), evitando deformar el análisis con una fundamental fantasma.

### 4.2 Clasificador Automático de Tipo de Instrumento y de los 10 Parameter Sets (`0..9`)
Para no tener que clasificar nunca los sonidos ni los bancos a mano, el analizador (combinando descriptores acústicos DSP, modelos de clasificación de audio por IA como YAMNet / CLAP / AST en ONNX o Python, y metadatos GM cuando existan) detecta automáticamente tanto la **Familia/Tipo de Instrumento** entre las categorías disponibles del ecosistema (`@abdsynths/shared` `bankCategories`) como el **`Parameter Set (0..9)`**:

1. **Detección del Tipo de Instrumento y Categoría del Banco**:
   - Clasifica automáticamente el sonido dentro del catálogo canónico del sintetizador y del `BankDrawer`:
     - **`Strings / Bowed / Solo` (`cat-1`)**: Violín, Cello, Cuerdas orquestales, Synth Strings.
     - **`Bells / Mallet / World Percussion` (`cat-2`)**: Campanas, Vibráfono, Marimba, Kalimba, Gongs.
     - **`Bass / Plucked / Guitar` (`cat-3`)**: Bajo eléctrico/acústico, Synth Bass, Guitarra acústica/eléctrica, Arpa, Pizzicato.
     - **`Pads / Orchestral / Ambient` (`cat-4`)**: Warm Pad, Glass Pad, Lush Strings Pad, Ensemble.
     - **`Keys / Piano / Organ` (`cat-5`)**: Piano acústico, Rhodes / Wurlitzer / FM E-Piano, Clavinet, Órgano Hammond / Litúrgico.
     - **`Winds / Brass / Vocal / Choir` (`cat-6`)**: Flauta, Oboe, Clarinete, Saxo, Trompeta, Brass Section, Coros, Voz solista.
     - **`Textures / Drones / FX` (`cat-7`)**: Drones oscuros, Atmósferas de cine, Sci-Fi FX, Ruido evolutivo.
     - **`Arp / Loops / Sequenced` (`cat-8`)**: Bucles rítmicos, Arpegios sincronizados, Slicers.
     - **`Drums / Rhythm / Corpus` (`cat-9`)**: Baterías, Kicks, Snares, Hi-Hats, Percusión seca y efectos de cuerpo acústico.
     - **`General / Neutral Synth` (`cat-0`)**: Formas de onda puras, Leads genéricos.

2. **Matriz de Descriptores Acústicos para Parameter Set (`0..9`) y Familia**:

| Descriptor Acústico | Qué mide | Parameter Sets y Familias que discrimina |
| :--- | :--- | :--- |
| **Log-Attack Time (LAT) & Attack Slope** | Tiempo desde el inicio hasta el pico de energía ($\log_{10}(t_{\text{peak}} - t_{\text{onset}})$) | Ataques rápidos ($< 20\text{ ms}$): `2 (Plucked & Bells)`, `3 (Plucked & Picked)`, `5 (Piano)` vs. Ataques lentos ($> 120\text{ ms}$): `1 (Bowed)`, `4 (Carpet Shop)`, `7 (Extreme Pads)` |
| **Coeficiente de Inarmonicidad ($\beta$)** | Estiramiento de parciales superiores $f_n = n f_0 \sqrt{1 + \beta n^2}$ | Alta inarmonicidad/rigidez: `2 (Bells)`, `4 (Glass/Stiffness)`, `5 (Piano)` vs. Armónicos puros ($\beta \approx 0$): `1 (Strings)`, `6 (Woodwinds)` |
| **Relación Armónico-Ruido (HNR) & ZCR** | Proporción de energía periódica frente a soplido/turbulencia | Ruido de soplido modulado + predominio impar: `6 (Woodwinds)` / Percusión inarmónica: `9 (Drums/Rhythm)` |
| **Flujo Espectral (Spectral Flux) & Modulación** | Variación del espectro frame a frame | Alta evolución tímbrica en sostén: `7 (Extreme Pads / Textures)` vs. Estacionario denso: `4 (Carpet Shop)` |
| **Densidad de Onsets Temporales** | Número de picos transitorios distintos a lo largo de la muestra | Múltiples ataques rítmicos ($\ge 3$ onsets): `8 (Loop Factory)` |
| **Balance Cuerpo / Resonancia Acústica** | Energía de formantes graves/medios en decaimiento | `9 (Multipurpose / Body)` y `0 (Default Neutral)` |

La UI ofrecerá selección automática (`Auto-Detect Instrument & Parameter Set`) mostrando la familia detectada, las etiquetas sugeridas y el ranking de confianza (ej. *Instrumento: Piano / Keys (`cat-5`) — Set 5: 88%, Set 2: 74%*).

### 4.3 Nuevos Algoritmos para el Binario Clásico (`Legacy DSP` vs. `Enhanced DSP`)
Mantenemos siempre un selector para elegir entre el algoritmo clásico actual y el nuevo motor mejorado (**"Caballo de Troya"**: escribe exactamente el mismo formato `.scape`/`.sphere`, pero con matemáticas modernas):
1. **Separación Quirúrgica Transitorio / Estacionario (HPSS — *Harmonic-Percussive Source Separation*)**:
   - Mediante filtrado mediano ortogonal sobre el espectrograma STFT (horizontal en tiempo = armónico; vertical en frecuencia = percusivo/transitorio), separamos la muestra en dos flujos limpios antes de empaquetar: el componente transitorio/excitación alimenta `.scape` y el componente estacionario/armónico alimenta `.sphere`.
2. **STFT Multi-Resolución Adaptativa**:
   - Adapta el tamaño de ventana y solapamiento según el sonido y el registro: ventanas cortas (`512` / `1024`) para preservar ataques rápidos en `.scape`, y ventanas largas (`4096` / `8192` con ventana Blackman-Harris / Kaiser-Bessel y 75–87,5% de overlap) para máxima resolución de graves y formantes en `.sphere`.
3. **Reasignación Tiempo-Frecuencia y Consistencia de Fase (*Phase Unwrapping*)**:
   - Usa la derivada temporal de la fase desenvolvuelta ($\partial \phi / \partial t$) para calcular la frecuencia instantánea exacta de cada parcial y evitar cancelaciones de fase o sonido metálico al mover los joysticks.
4. **Métrica Objetiva de Calidad (*Quality Score*) y Comparador A/B/C/D**:
   - Evalúa automáticamente cada zona combinando **fidelidad de envolvente transitoria** (prioritaria en sonidos percusivos) y **distancia espectral / estabilidad de centroide y formantes** (prioritaria en sonidos sostenidos).
   - Permite conmutar en tiempo real en la UI entre: `Onda Original` $\leftrightarrow$ `Onda Mejorada (96 kHz)` $\leftrightarrow$ `Clásico Original (2001)` $\leftrightarrow$ `Clásico Mejorado`.

---

## 5. Estándar de Audio Maestro (`24-bit / 96 kHz`), Expansión de Loops, IA y Surround

### 5.1 El Estándar Maestro (`Enhanced Wave Standard`)
Toda onda regenerada desde `NeuronDB` o mejorada desde un SF2/WAV se promueve a un formato maestro unificado:
- **Formato**: WAV (`RIFF/WAVE` o `FORM/AIFF`) a **`24-bit PCM`**, **`96.000 Hz`** (procesado internamente en `Float32`/`Float64`).
- **Canales**:
  - Conserva los canales originales (**Mono `1ch`** o **Estéreo `2ch`**).
  - Permite **expansión espacial opcional** a **Estéreo (`2.0`)** o **Surround / Quad (`4.0` / `5.1`)** (o Pseudo-Surround espectral), realizando siempre un *downmix* compensado en fase a Mono `44.100 Hz` únicamente cuando se compila hacia el binario clásico `.scape`/`.sphere`.
- **Tres métodos de promoción a `24-bit / 96 kHz`**:
  1. **Conversión Directa**: Interpolador polifásico Sinc con ventana Kaiser-Bessel de fase lineal + dithering TPDF a 24 bits.
  2. **Restauración Algorítmica DSP (100% en navegador/Web Worker)**:
     - Al regenerar desde `.sphere` + `.scape` de `NeuronDB`: interpolación por splines cúbicos entre las tramas espectrales + reconstrucción coherente de fase (Griffin-Lim / Phase Vocoder adaptativo) + modulación de ataque con `.scape`.
     - **Filtrado FIR de Fase Lineal** y **De-noising Espectral (*Spectral Gating*)** para limpiar el ruido de cuantización de 2001 o de SF2 de 8/16 bits.
     - **Extensión de Ancho de Banda (*Bandwidth Extension* — BWE)**: Generación controlada de armónicos superiores coherentes (hasta 48 kHz gracias al muestreo a 96 kHz) mediante excitación armónica no lineal por bandas (`std::tanh` / plegamiento espectral armónico en agudos) para devolver el aire y brillo perdidos.
  3. **Restauración por Modelos de IA (Gratuitos y Open Source)**:
     - **AudioSR (*Audio Super-Resolution*)**: Reconstruye mediante difusión latente los armónicos reales perdidos en muestras de baja tasa de muestreo o modelos antiguos hasta 48/96 kHz.
     - **Demucs / HTDemucs**: Separación por Deep Learning entre componente transitorio/excitación (`Scape`) y cuerpo resonante (`Sphere`).
     - **BigVGAN / Multi-Band MelGAN**: Vocoders neuronales que predicen una fase natural y orgánica a partir de las magnitudes espectrales de los modelos viejos.

### 5.2 Ampliación de Loops Cortos a $X$ Segundos (`Loop Expansion & Auto-Loop Finder`)
Cuando una muestra (muy habitual en `.sf2`) tiene un loop muy corto que suena estático o repetitivo:
1. **Desenrollado + Evolución Viva ($X$ segundos, p. ej. 4 a 6 s)**:
   - Se desenrolla el bucle original con crossfade de fase hasta alcanzar $X$ segundos.
   - Se aplica **variación orgánica mediante IA (*Audio Outpainting* / variación en espacio latente) o micro-modulación estocástica de fase/formantes por DSP**, de modo que durante esos $X$ segundos el sonido tenga movimiento natural sin efecto "metralleta".
2. **Recálculo Automático de las Marcas de Loop (`Auto-Loop Finder`)**:
   - El algoritmo busca los puntos óptimos de cruce por cero con máxima correlación de fase y similitud de envolvente espectral ajustados a la nueva duración extendida, aplica un crossfade de cierre libre de clics y actualiza `loopStart` y `loopEnd` tanto en el WAV de `24-bit / 96 kHz` como en la definición nativa del modelo.

---

## 6. El Contenedor Multiformato de 5 Capas ("Cápsula del Tiempo" Anti-Efecto Fotocopia)

Para evitar el **efecto fotocopia** (degradación acumulativa al reprocesar algo ya comprimido), nuestro contenedor multiformato guarda todas las capas existentes de cada modelo junto con un archivo `provenance.json`:

```text
<NNN>_<ModelName>.nmpack (o estructura de directorio / ZIP unificado)
├── manifest.json                 ← Definición nativa completa (zonas 2D, velocidades, loops, DAHDSR, Surround, ParSet)
├── provenance.json               ← Linaje exacto: qué capa es la fuente primaria y con qué versión de algoritmo se creó cada derivada
├── 01_raw_source/                ← [Si existe] WAV/AIFF originales intactos (o extraídos del SF2/SFZ al importar)
├── 02_legacy_original/           ← [Si viene de NeuronDB] MName, map.script, *.scape, *.sphere originales de 2001 intactos
├── 03_enhanced_audio/            ← Ondas Maestras en formato 24-bit / 96.000 Hz (Mono/Estéreo/Surround, loops extendidos)
├── 04_classic_enhanced/          ← MName, map.script, *.scape, *.sphere compatibles con modo Clásico pero con los nuevos algoritmos
├── 05_extended_model/            ← Modelo Extendido / Neural HD (campos de vectores, espacio latente, transitorios PCM, Surround)
└── Sounds/
    └── <NNN>.sound/              ← sound.script (con DAHDSR/Filtro traducidos) + sound.stickrec
```

**Regla estricta de reprocesado**:
- Si mañana mejoramos un algoritmo DSP o cambiamos de modelo de IA:
  - `03_enhanced_audio` se regenera **siempre** desde `01_raw_source` (si existe) o desde `02_legacy_original` (si es un modelo de fábrica de `NeuronDB`).
  - `04_classic_enhanced` y `05_extended_model` se calculan **siempre** desde `03_enhanced_audio` (o `01_raw_source`), **nunca** recomprimiendo un `.sphere` de `04`.

**Persistencia en el Navegador (`IndexedDB`)**:
- Dado que un modelo con ondas a `24-bit / 96 kHz` supera ampliamente los 5 MB de `localStorage`, los binarios y buffers de audio se almacenan en **`IndexedDB`** (`NeuronAssetStore`), dejando `localStorage` solo para preferencias ligeras de interfaz.

---

## 7. Despliegue (Local / GitHub / Vercel / Híbrido) y Vendorizado de `ABDShared`

1. **Vendorizado Sincronizado de `@abdsynths/shared` y `@abdsynths/midi-keyb`**:
   - En desarrollo local dentro de `D:\desarrollos\ABDSynths`, trabajamos cómodamente con `ABDShared`.
   - Mediante un script automatizado (`npm run vendor:sync`), sincronizamos una copia local autocontenida dentro del repositorio de `ABDNeuModMakr` para que al hacer `git push` a GitHub, **Vercel** pueda clonar y desplegar la aplicación de forma 100% autónoma sin depender de carpetas externas fuera del repo.
2. **Arquitectura Híbrida para la IA (Cero coste de servidores)**:
   - **Frontend estático en Vercel / GitHub**: Ejecuta en el navegador del usuario toda la app, Web Workers DSP, importadores SF2/SFZ, generación a 96 kHz e inferencia ligera con **WebGPU / ONNX Runtime Web**.
   - **Puente IA Local Opcional (`Local AI Companion` en `http://127.0.0.1:8389`)**: Un ligero servidor local en Python (FastAPI) que el usuario puede arrancar en su PC cuando quiera procesar modelos con AudioSR, Demucs o BigVGAN sobre su propia GPU (CUDA / Apple MPS) sin límites ni costes en la nube. La web (incluso abierta desde Vercel) detecta automáticamente si el puente local está activo.

---

## 8. Modo Extendido Final, Modelos Surround y Nuevos Resynators (`ABDAxionikVS`) *(Fase Final)*

Cuando abordemos la expansión de los *Resynators* en el sintetizador C++ / JUCE 9 (`ABDAxionikVS`):
1. **Campos de Vectores y Espacio Latente Real (Autoencoders / VAE)**:
   - Reducción o proyección de las características tímbricas a un espacio vectorial/latente continuo (ejecutable en C++ mediante **RTNeural** u **ONNX Runtime** o interpolación matricial avanzada) para que los joysticks `Scape` y `Sphere` muten el sonido de forma orgánica.
   - Capacidad de **Morphing 2D Multi-Modelo** (interpolar hasta 4 modelos distintos en las esquinas del joystick).
2. **Separación de Envolvente de Formantes y Fundamental ($f_0$)**:
   - Permite **Formant Shifting** real en tiempo real (cambiar el tamaño aparente del cuerpo resonante sin cambiar la nota musical, y transponer notas a lo largo del teclado sin "efecto ardilla").
3. **Inyección de Transitorios PCM Reales (`24-bit / 96 kHz`)**:
   - Disparo híbrido del micro-ataque PCM real en los primeros milisegundos fundido en fase con la resíntesis espectral del cuerpo.
4. **Modelos Surround / Quad (4.0 / 5.1) y Pseudo-Surround Espectral**:
   - Expansión espacial nativa donde la excitación (`Scape`) puede proyectarse focalizada en el plano frontal (`Front L/R`) mientras la resonancia del cuerpo (`Sphere`) y las capas espectrales (`Layers 0..3`) se distribuyen en un campo envolvente 360° (`Rear L/R` en salidas multicanal JUCE 9, o mediante decorrelación espectral / binaural en modo Pseudo-Surround sobre salidas Estéreo convencionales).

---

## 9. Editor Visual Interactivo de Loops (`Waveform Loop Editor` — Fase Final)

- **Canvas de Forma de Onda con Handles Arrastrables**: Visualización completa de la onda con marcadores interactivos de `Loop Start`, `Loop End` y rampa de `Loop Crossfade (ms)`.
- **Lupa de Empalme de Fase (`Seam / Zero-Crossing Magnifier`)**: Vista ampliada del punto de unión (`loopEnd` $\rightarrow$ `loopStart`) con ajuste automático a cruces por cero de igual pendiente (*Snap to Zero-Crossing*) y pre-escucha continua en tiempo real mientras se arrastran los puntos.
- **Controles de Loop**: Selección visual de modo (`no_loop`, `loop_continuous`, `loop_sustain`, `one_shot`, y futuro `ping_pong`), edición numérica en `frames` y `ms`, e integración directa con el `Auto-Loop Finder` de la Fase 8.

---

## 10. Portada / Artwork del Modelo en Formato `.webp` (Exclusivo Modo Extended — Fase Final)

- **Asignación de Imagen de Portada**: Carga por archivo (`PNG`, `JPG`, `WEBP`, `AVIF`, `SVG`), Drag & Drop o pegado desde portapapeles, visible únicamente en **Modo Extended**.
- **Conversión Automática a `.webp`**: Procesado en cliente mediante `Canvas` / `OffscreenCanvas` (`image/webp`, calidad `0.88`, resolución normalizada p. ej. `512×512`) para garantizar peso mínimo y carga instantánea.
- **Almacenamiento en el Contenedor**: Se guarda como `05_extended_model/cover.webp` (y en `IndexedDB`) referenciado en `manifest.json`, mostrándose como carátula del modelo tanto en `ABDNeuModMakr` como en el navegador visual de modelos de `ABDAxionikVS`.
