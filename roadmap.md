# Roadmap: Mejoras SFZ v2 / ARIA, Motor de Preview y Cohesión `ABDShared` → `ABDNeuModMakr`

> Análisis clean-room basado en el estándar SFZ v1/v2/ARIA y patrones arquitectónicos de `sfizz 1.2.3`.
> **Regla estricta:** cero copia o reutilización de código fuente de `sfizz`; diseño propio en `ABDShared` (lógica agnóstica de UI sincronizada vía `npm run vendor:sync`) y `ABDNeuModMakr` (UI, WebAudio y flujos de usuario).

---

## Base ya resuelta y verificada
- `WavAiffDecoder.ts`: `ping_pong`, `loop_backward`, `sustainPlayMode` en `smpl`/`INST` + `extractAudioHeaderInstrumentInfo()`.
- `SfzParser.ts`: aislamiento de `<curve>`, `<effect>`, `<midi>`, `<sample>` (exención S6.6 en `<curve>`), `#define`, `<control>` (`default_path`, `octave_offset`, `note_offset`), precedencia secuencial de `key=`, descarte de regiones mudas, `sampleName` plano, fallbacks `xfin_*`/`xfout_*`, `ampEnvOverride` y `filterOverride`.
- `Sf2Parser.ts` / `soundfont2Writer.ts`: validación S6.4, `ampEnvOverride`/`filterOverride`, `initialAttenuation`, `loop_sustain`, guardia de 1 muestra, estéreo enlazado.
- `RawSamplerExporter.ts`: remuestreo Blackman windowed-sinc, reescalado de loops/offsets, preservación estéreo y opcodes SFZ separados.
- `UniversalSamplerCapsule.ts` / `UniversalSamplerOfflineRenderer.ts`: cápsula `.abdsmpl.zip`, soporte `.sfz.zip` en `UniversalSamplerModel.ts` y render offline determinista 24-bit.

---

## P0 — Fase 1: Cierre de brechas de integración `ABDShared` → `ABDNeuModMakr` (Completada)
- [x] **1.1 Preservar regiones ricas en `importPreflight.ts` y `universalSamplerImport.ts`**:
  - No aplanar `ExtendedRegion` en `applyPreflightImportAdaptations()` (conservar `pitchKeytrack`, `trigger`, `keyFadeIn/Out`, `velFadeIn/Out`, `fadeCurve`, `loopCrossfadeMs`, `seqPosition/seqLength`, `muteGroup`, `keyswitchNote`, `playLogic`, `sampleStartFrame/EndFrame`, `reversed`, `velToVolumeDepth`, `velToPitchCents`, `groupId/Name`, `loops`, `hasArticulationOverride`, `ampEnvOverride`, `filterOverride`).
  - Propagar `envelope`/`filter`/`pitchEnv`/`polyphony`/`pitchBendUpSt`/`pitchBendDownSt`/`author`/`description` desde `ParsedSamplerPreset` hacia `session.articulation` y `session.processConfig.extendedMetadata`.
- [x] **1.2 Edición no destructiva en `ZoneInspector` (`drawerSampleEventOps.ts`)**:
  - Al editar ADSR o Cutoff/Resonance por región, hacer merge parcial sobre `activeReg.ampEnvOverride` y `activeReg.filterOverride` en lugar de sobreescribir y perder `delaySec`, `holdSec`, `startLevel`, `velModDepth`, `type`, `poles`, `envToFilterCents`, `velToFilterCents`, `keytrackCents`, `filterEnv`.
- [x] **1.3 Exponer `.abdsmpl.zip` de punta a punta**:
  - Añadir `'abdsmpl'` en `ABDShared` (`rawSamplerTypes.ts`, `rawSamplerPreflight.ts`, `RawSamplerExporter.ts`) usando `exportUniversalSamplerCapsule()` y `rawSamplerParsers.ts` (`parseUniversalSampler` para `.abdsmpl` / `.abdsmpl.zip`).
  - Sincronizar con `npm run vendor:sync`.
  - Exponer `.abdsmpl.zip` en `RawSamplerExportModal.ts`, `exportDestinations.ts`, `triageGate.ts` (`TRIAGE_CONTAINER_EXTENSIONS`) y `mixedImport.ts` (detección de `.abdsmpl` / `.abdsmpl.zip`).
- [x] **1.4 Validación**: `npm run verify` (48/48 suites OK).

---

## P1 — Fase 2: SFZ v2 / ARIA `#include`, alias e introspección rica (Completada)
- [x] **2.1 `#include "ruta.sfz"` seguro**:
  - Resolver `#include` en `ABDShared/SfzParser.ts` mediante callback opcional respaldado por `VirtualZipFs` o mapa de `.sfz` hermanos (`sf2SfzImport.ts`, `triageOps.ts`, `UniversalSamplerModel.ts`).
  - Protecciones: sin `..`, detección de ciclos (`visited`), límite de profundidad (`MAX_INCLUDE_DEPTH = 8`) y topes S6.6 (`MAX_SFZ_OPCODES_PER_BLOCK = 128`, `MAX_SFZ_HEADER_BLOCKS = 8192`).
- [x] **2.2 Normalización de alias SFZ v1/v2/ARIA y `<sample> base64data=`**:
  - Normalizar `offby`→`off_by`, `offmode`→`off_mode`, `loopmode`→`loop_mode`, `loopstart`→`loop_start`, `loopend`→`loop_end`, `*_ccN`→`*_onccN`, `*_vel2*`→`*_velto*`.
  - Soporte acotado de `<sample> base64data=...` con `sampleName` plano y tope S6.4 (`16 MB`).
- [x] **2.3 Metadatos ricos e introspección en UI/Preflight**:
  - Extraer `sw_label`, `label_keyN`, `sw_lokey`/`sw_hikey`/`sw_last`, `label_ccN`, `set_ccN`/`set_hdccN`, `image`/`image_controls`.
  - Auditar opcodes desconocidos o degradados en `sfzIntrospection` / `warnings` y enriquecer `metadata.customAttributes`.

---

## P2 — Fase 3: Motor de preview polifónico y expresividad en `ABDNeuModMakr` (Completada)
- [x] **3.1 Pool polifónico en `audioPreview.ts`**:
  - Reemplazar voz única en teclado por pool (`playPolyNoteOn` / `releasePolyNote` / `stopAllPolyVoices`) con límite `polyphony` y *voice stealing* por envolvente + edad (`selectVoiceToSteal`).
  - Aplicar filtro por región (`BiquadFilterNode` con `filterOverride` / `articulation.filter`), `loop_backward`, `reversed`, `ping_pong` y `sampleStartFrame`/`sampleEndFrame`.
- [x] **3.2 Choke groups y Release triggers**:
  - `group` / `off_by` (`muteGroup`) con `off_mode` (`fast`, `normal`, `time` / `off_time`) sin clics.
  - `trigger=release` con caída dependiente del tiempo mantenido (`rt_decay` en dB/s vía `computeReleaseTriggerGainLinear`).
- [x] **3.3 Conectar `SamplerArticulationEngine` y visibilidad en `ZoneInspector`**:
  - Conectar `round_robin` (`seq_length`/`seq_position`), `lorand`/`hirand` y crossfades por nota/velocidad (`computeRegionCrossfadeGain`) en `noteMapping.ts` y `main.ts`.
  - Mostrar badges de `muteGroup`, `keyswitchNote`, `seqPosition`/`seqLength` y `rtDecayDbPerSec` en `zoneTemplates.ts` (`formatRegionModeBadge`).

---

## P3 — Fase 4: `<curve>` 128 puntos, crossfades CC y Stretch Tuning Railsback (Completada)
- [x] **4.1 Tablas `<curve>` de 128 puntos y crossfades CC**:
  - Parsear `v0..v127` + `curve_index` dentro de `<curve>` (exenta de tope S6.6), interpolar puntos faltantes (`interpolateSfzCurvePoints`) y evaluar curvas (`evaluateSfzCurve` / `computeCcCrossfadeGain`) + extraer `xfin_loccN`/`xfin_hiccN`/`xfout_loccN`/`xfout_hiccN` en `SfzParser.ts`.
- [x] **4.2 Stretch tuning paramétrico (Railsback)**:
  - Añadido `createRailsbackStretchTable()` y `applyStretchTuningToTable()` en `ScalaMicrotuning.ts` y conectado `railsbackStretch` en `UniversalSamplerOfflineRenderer.ts`.

---

## P4 — Fase 5: Paridad en Exportador SFZ y Audición de Fila / Loop Editor (Completada)
- [x] **5.1 Exportador SFZ completo (`RawSamplerExporter.ts` + `rawSamplerPreflight.ts`)**:
  - Propagar `offMode`, `offTimeSec`, `rtDecayDbPerSec`, `loRand`, `hiRand`, `ccCrossfadeIn`/`Out`, `curveIndex`, `ampEnvOverride` y `filterOverride` en `UniformSamplerRegion` (`rawSamplerTypes.ts` / `rawSamplerPreflight.ts`).
  - Emitir `off_mode`, `off_time`, `rt_decay`, `lorand`, `hirand`, `xfin_loccN`/`xfin_hiccN`/`xfout_loccN`/`xfout_hiccN`, `curve_index` y filtro por región cuando `hasArticulationOverride` esté activo en `case 'sfz'` de `RawSamplerExporter.ts`.
- [x] **5.2 Audición de fila / Loop Editor (`audioPreview.ts` + `loopEditorOps.ts`)**:
  - Aplicar `filter`/`filterOverride` (`BiquadFilterNode`) y `reversed`/`loop_backward` en `auditionLoopSample()` y propagarlos desde `playLoopEditorData()` en `loopEditorOps.ts`.

---

## P5 — Fase 6: Extensión a Decent Sampler, Kontakt/HALion y TX16Wx (Completada)
- [x] **6.1 Decent Sampler (`.dspreset`)**:
  - Leer `silencingMode="fast|normal|time"` → `offMode`, `releaseDecay` → `rtDecayDbPerSec` y `attack`/`decay`/`sustain`/`release` por `<group>`/`<sample>` → `ampEnvOverride` en `DecentSamplerParser.ts`.
  - Emitir `silencingMode` dinámico, `releaseDecay` y `attack`/`decay`/`sustain`/`release` por región cuando `hasArticulationOverride` esté activo en `case 'dspreset'` de `RawSamplerExporter.ts`.
- [x] **6.2 Kontakt (`.nki` XML) y Steinberg HALion (`.vstpreset`)**:
  - Emitir `trigger`, `muteGroup`, `keyswitchNote`, `seqLength`/`seqPosition`, `reverse` y envolvente/filtro por zona cuando `hasArticulationOverride` esté activo en `RawSamplerExporter.ts`.
- [x] **6.3 CWITEC TX16Wx (`.txprog`)**:
  - Agrupar regiones por `muteGroup`/`playmode`/`keyscale` y emitir múltiples `<tx:group>` en `Tx16WxFormat.ts` (en EXS24 binario, el bloque de grupo 0x02 ya soporta `muteGroup`, `trigger`, `keyswitchNote`, `playLogic` y crossfades; los ADSR/filtros residen en el bloque global 0x04).
