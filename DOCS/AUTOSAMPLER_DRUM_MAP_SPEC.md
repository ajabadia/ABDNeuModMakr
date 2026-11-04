# Especificación Técnica de Mapas de Golpes para Cajas de Ritmos (`.txt`, `.json`, `.yaml`)

El modo **Caja de Ritmos (`Drum Map`)** del **AutoSampler MIDI Integrado** de **ABDNeuModMakr** permite asignar un nombre explícito, la nota MIDI que dispara cada sonido y un grupo de corte (`muteGroup` / `choke`, por ejemplo entre *Closed Hi-Hat* y *Open Hi-Hat*) a partir de archivos `.txt` / `.csv`, `.json` o `.yaml` / `.yml`, o pegando directamente el texto de la tabla de implementación MIDI de un manual PDF.

---

## 1. Formato `.txt` / `.csv` (Línea por Golpe)

Cada línea define un golpe de percusión. Las líneas vacías o que comiencen por `#` o `//` se ignoran como comentarios.

### Sintaxis admitida por línea
- `nota_midi_o_nombre_de_nota, nombre_del_golpe [, mute_group]`
- `nota_midi_o_nombre_de_nota = nombre_del_golpe`
- `nota_midi_o_nombre_de_nota : nombre_del_golpe`

- **`nota_midi_o_nombre_de_nota`**: Número MIDI (`0..127`, p. ej. `36`) o notación anglosajona (`C1`, `D1`, `F#1`, `A#1`).
- **`nombre_del_golpe`**: Nombre descriptivo del sonido (p. ej. `Kick Drum`, `Snare Rim`, `Closed Hi-Hat`).
- **`mute_group`** *(opcional)*: Entero positivo (`1..16`). Todos los golpes que compartan el mismo `mute_group` se silencian mutuamente al exportarse a `.sfz` (`group=` / `off_by=`), `.decentsampler`, `.xpm` (Akai MPC) o `.nam` / `.xnam`.

### Ejemplo (`drum-map.txt`)
```txt
# Mapa TR-808 / General MIDI
36, Kick Drum
38, Snare Acoustic
39, Hand Clap
42, Closed Hi-Hat, 1
46, Open Hi-Hat, 1
49, Crash Cymbal
```

---

## 2. Formato `.json`

Permite especificar además el nombre del kit (`kitName`) y una lista de velocidades por defecto (`defaultVelocities`) o por golpe individual (`velocities`).

### Esquema JSON
```json
{
  "kitName": "Roland TR-808 Studio Kit",
  "defaultVelocities": [70, 120],
  "hits": [
    { "note": 36, "name": "Kick Drum" },
    { "note": "D1", "name": "Snare Acoustic", "velocities": [50, 95, 127] },
    { "note": 42, "name": "Closed Hi-Hat", "muteGroup": 1 },
    { "note": 46, "name": "Open Hi-Hat", "muteGroup": 1 }
  ]
}
```

También se admite un objeto plano de pares `"nota": "Nombre"`:
```json
{
  "36": "Kick Drum",
  "38": "Snare Acoustic",
  "42": "Closed Hi-Hat"
}
```

---

## 3. Formato `.yaml` / `.yml`

### Ejemplo (`drum-map.yaml`)
```yaml
kitName: Elektron Digitakt Kit
defaultVelocities: [90, 127]
hits:
  - note: 36
    name: Kick Sub
  - note: 38
    name: Snare Crisp
  - note: 42
    name: Closed Hat
    muteGroup: 1
  - note: 46
    name: Open Hat
    muteGroup: 1
```

---

## 4. Extracción Automática desde Manuales en Texto Crudo

Si copias y pegas directamente una tabla de un manual PDF en el botón **`[ Extract from Manual Text ]`** (p. ej. `"36 Bass Drum 1"`, `"C1 - Kick"`, `"42 | Closed Hi-Hat"`), el analizador determinista:
1. Detecta números MIDI (`0..127`) o notas (`C0..G8`) al inicio de cada línea.
2. Limpia numeraciones y signos de puntuación residuales.
3. Asigna automáticamente `muteGroup = 1` a cualquier pareja de *Closed Hi-Hat* / *Open Hi-Hat* / *Pedal Hi-Hat*.
