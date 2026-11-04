# Inventario de cadenas de texto para internacionalización (i18n)

Proyecto: ABDNeuModMakr · Fecha: 2026-11-03 · Alcance: `src/**/*.ts` (se excluyen `tests/`, `vendor/` y `.d.ts`).

Este documento es solo inventario. No propone implementación.

## Cómo leer cada fila

- **Cadena**: texto actual tal como aparece en el código (se conserva `${...}` porque indica interpolación que la futura i18n deberá parametrizar con estilo ICU).
- **Idioma**: detección heurística — `es` (tildes/ñ/¿¡ o vocabulario español), `en` (vocabulario inglés), `mixto` (ambos), `sin determinar` (etiqueta corta sin marcas de idioma, p. ej. "Gate", "Mix": probablemente préstamo inglés, a decidir término a término).
- **Fichero / líneas**: dónde aparece (las líneas agregan todas las repeticiones idénticas en el mismo fichero y contexto).
- **Contexto**: `toast`, `confirmDialog`, `html` (nodo de texto en plantilla), `attr:title/aria-label/placeholder/alt`, `textContent`, `prop:label/text/...`.

## Resumen

- Cadenas únicas inventariadas: **1639** (repeticiones idénticas dentro del mismo fichero fusionadas).
- Por idioma: `es`: 80 · `técnico/sin marcas`: 273 · `en`: 1066 · `mixto`: 39 · `sin determinar`: 181.
- Por contexto: `prop:label`: 155 · `toast`: 196 · `confirmDialog`: 11 · `prop:message`: 28 · `html`: 876 · `attr:aria-label`: 35 · `attr:alt`: 5 · `attr:title`: 271 · `attr:placeholder`: 23 · `textContent`: 39.
- Con interpolaciones `${...}` (requieren parámetros en i18n): **233**.
- Ficheros con más cadenas: `src/ui/AudioChopperModal.ts` (172), `src/ui/SettingsModal.ts` (171), `src/ui/zoneInspector/zoneTemplates.ts` (162), `src/ui/Navbar.ts` (161), `src/ui/AudioRecorderModal.ts` (126), `src/ui/ModelConfigModal.ts` (111), `src/ui/ZoneInspector.ts` (103), `src/ui/MusicianWizardModal.ts` (79).

## Notas importantes para la futura i18n

1. Ya existe un glosario centralizado parcial (src/ui/preflightGateView.ts:28): `MUSICIAN_TERMS` (usado en 8 ficheros de `src/ui/`). Es el candidato natural a primer catálogo de claves.
2. Existe infraestructura i18n compartida sin usar aquí: `vendor/@abdsynths/shared/Components/I18n/i18n.js`. Decidir si se adopta o se crea catálogo propio.
3. Las cadenas `mixto` (p. ej. "RTL: … ms · Peak: … dBFS · …") mezclan etiquetas inglesas con conectores españoles; al extraer claves habrá que normalizar el idioma base por cadena completa.
4. Los toasts de diagnóstico con valores numéricos (`toFixed`) y unidades (ms, dBFS, smp) necesitan formato numérico por locale, no solo traducción.
5. Las cadenas en `DOCS/` y comentarios de código NO se inventarían (no son UI); este inventario cubre solo texto visible en la aplicación.
6. Limitaciones del extractor: heurística por regex sobre el fuente; puede haber falsos positivos (fragmentos de código con pinta de texto) y falsos negativos (cadenas construidas por concatenación o llegadas por parámetros). Revisar el fichero marcado como dudoso antes de convertirlo en clave.

## Inventario por fichero

### `src/app/exportDestinations.ts` (9 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 83 | prop:label | es | Guardar en AxionikDB |
| 84 | prop:label | es | Guardar Cápsula Como… |
| 96 | prop:label | técnico/sin marcas | SF2 |
| 97 | prop:label | técnico/sin marcas | SFZ |
| 98 | prop:label | técnico/sin marcas | Decent Sampler |
| 99 | prop:label | técnico/sin marcas | Kontakt (.nki) |
| 100 | prop:label | técnico/sin marcas | Akai MPC (.xpm) |
| 101 | prop:label | técnico/sin marcas | Logic EXS24 |
| 113 | prop:label | en | Cadena WAV (Cue Markers) |
### `src/app/importHandlers.ts` (15 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 113, 139 | toast | en | Failed to decode audio file "${file.name}": ${msg} |
| 185 | confirmDialog | en | You have unsaved changes in the current session. Do you want to discard them and open another session? |
| 200 | toast | en | Failed to load session JSON: ${msg} |
| 219 | toast | en | Failed to import audio folder: ${msg} |
| 250 | toast | en | Failed to import model folder: ${msg} |
| 286 | toast | en | Failed to configure NeuronDB folder: ${msg} |
| 1034 | toast | en | No valid audio or .model files found in the selected folder. |
| 1056 | toast | en | Failed to import folder: ${msg} |
| 1104 | toast | en | Could not locate "${item.name}" data — import it with Universal Import (Ctrl+I). |
| 1131 | toast | en | Failed to load "${item.name}": ${err instanceof Error ? err.message : String(err)} |
| 1172 | toast | en | Failed to load SFZ "${item.name}": ${err instanceof Error ? err.message : String(err)} |
| 1214 | toast | en | "${item.name}" (${item.formatLabel}) goes through Batch or Universal Import (Ctrl+I) — direct session load here supports audio packs and SF2. |
| 1259 | toast | en | Nothing batch-processable in the selection — use Universal Import (Ctrl+I) for these formats. |
| 1264 | toast | en | Skipped ${remainingSkipped.length} (${kinds}): batch takes audio packs and SF2 — the rest go via Universal Import (Ctrl+I). |
| 1835 | toast | en | Failed to import files: ${msg} |
### `src/app/menuActions.ts` (8 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 204 | toast | en | No active zone selected to export. |
| 212 | toast | en | Exported sample: ${filename} |
| 216 | toast | en | AIFF export error: ${msg} |
| 228 | toast | en | Saved to AxionikDB: ${res.slug} |
| 233, 257 | toast | técnico/sin marcas | AxionikDB error: ${msg} |
| 252 | toast | en | Saved to AxionikDB as: ${res.slug} |
| 301 | toast | en | NEURON MODELmaker is already running as a standalone desktop app. |
| 307 | toast | en | NEURON MODELmaker installed on desktop! |
### `src/core/ai/CloudByokClient.ts` (10 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 134 | prop:message | es | La clave API no puede estar vacía. |
| 146 | prop:message | mixto | Clave de Replicate verificada y lista para AudioSR. |
| 177 | prop:message | mixto | Google Gemini API Key verificada correctamente. |
| 193 | prop:message | mixto | OpenAI API Key verificada correctamente (DALL-E 3 habilitado). |
| 212 | prop:message | mixto | Anthropic Claude API Key verificada (Claude 3.5 Sonnet / Haiku listo). |
| 220 | prop:message | es | Formato de clave de Anthropic Claude validado (sk-ant-...). Lista para uso. |
| 257 | prop:message | mixto | DeepSeek API Key verificada (DeepSeek-V3 / R1 activo). |
| 273 | prop:message | mixto | Groq API Key verificada (Inferencia ultra-rapida LPU activa). |
| 289 | prop:message | mixto | Mistral AI Key verificada correctamente. |
| 297 | prop:message | técnico/sin marcas | Proveedor no soportado. |
### `src/core/autoSampler/MidiAutoSampleSession.ts` (2 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 752 | prop:label | técnico/sin marcas | NoteOff |
| 784 | prop:label | técnico/sin marcas | TailEnd |
### `src/core/bridge/BridgeClient.ts` (1 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 339 | prop:message | en | Bridge unreachable |
### `src/core/dsp/AudioSlicerEngine.ts` (3 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 295 | prop:label | en | Bass Drum 1 (36 C1) |
| 832 | html | técnico/sin marcas | Math.abs(mf - ab) |
| 945 | html | técnico/sin marcas | Math.abs(b - frame) |
### `src/core/import/importPreflight.ts` (1 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 162 | html | técnico/sin marcas | r.lowKey |
### `src/core/import/modelImportService.ts` (1 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 415 | html | en | Import Model Folder ( |
### `src/core/soundfontMetadata.ts` (19 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 23 | prop:label | en | IENG — Sound Designer / Engineer |
| 30 | prop:label | en | ICOP — Copyright Statement |
| 37 | prop:label | en | ICRD — Creation Date |
| 44 | prop:label | en | ISFT — Authoring Software / Tool |
| 51 | prop:label | en | IPRD — Target Product / Synth |
| 58 | prop:label | en | ICMT — Comments & Performance Notes |
| 65 | prop:label | técnico/sin marcas | isng — Sound Engine Target |
| 74 | prop:label | en | Microphone — Transducer Model |
| 81 | prop:label | en | Mic Position — Placement |
| 88 | prop:label | en | Preamp / Console — Outboard Chain |
| 95 | prop:label | en | Acoustic Space — Hall / Studio |
| 104 | prop:label | en | Instrument Make — Manufacturer / Luthier |
| 111 | prop:label | en | Year — Vintage / Fabrication |
| 118 | prop:label | en | Tuning — Concert Pitch / Temperament |
| 127 | prop:label | en | Genre — Musical Style |
| 134 | prop:label | en | Round Robin — Hit Alternation |
| 141 | prop:label | en | Dynamic Layers — Velocity Mapping |
| 148 | prop:label | en | Articulations — Playing Techniques |
| 155 | prop:label | en | Contact — Creator Website / Support |
### `src/core/WebAudioPipeline.ts` (3 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 703 | html | técnico/sin marcas | z.lowKey |
| 1654 | prop:message | en | Initializing 8192-point STFT & harmonic peak-picking engine... |
| 1701, 1782, 1820 | prop:message | en | Process cancelled by user |
### `src/core/wizard/musicianWizard.ts` (3 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 767 | prop:label | mixto | Batería / Percusión (Kit por golpes) |
| 771 | prop:label | es | Melodía / Frase (Varias notas) |
| 775 | prop:label | es | Nota única / Instrumento cromático |
### `src/main.ts` (32 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 120, 1115 | toast | en | Removed model cover artwork. |
| 130 | toast | en | Reprocessed from purest acoustic source (0 Generation-Loss) |
| 174 | toast | en | Injected ${zones.length} sliced zones into session. |
| 185 | toast | en | Injected ${regions.length} sliced regions into session. |
| 211 | toast | en | Injected "${filename}" into active zone [${activeZone.id}]. |
| 231 | toast | en | AutoSampler MIDI: Injected ${payload.classicZones.length} zones (${payload.extendedRegions.length} regions) into session. |
| 915 | toast | en | Auto-detected: MIDI ${res.descriptors.detectedMidiNote} (${res.descriptors.detectedF0Hz} Hz) • ${res.detectedCategory} (Set #${res.recommendedParameterSet}) |
| 921 | toast | en | Assign an audio sample to this zone before running Auto-Detect. |
| 948 | toast | en | Promoted all ${results.length} zone(s) to 24-bit / 96 kHz Master Wave |
| 963 | toast | en | Reprocessed #${prov.reprocessCount} from ${prov.primarySourceLayer} (0 Generation-Loss) |
| 1198 | confirmDialog | en | Loading Model #${slot} replaces the current session (unsaved changes will be kept in Undo history). |
| 1221 | toast | en | Loaded Model #${slot} '${this.session.name}' |
| 1229 | toast | en | Failed to load Model #${slot}: ${msg} |
| 1273 | toast | en | Loading model "${item.name}" from AxionikDB... |
| 1278 | toast | en | Error loading model from AxionikDB: ${String(err)} |
| 1293 | toast | técnico/sin marcas | Modelo duplicado en AxionikDB: ${newSlug} |
| 1298 | toast | es | Error al duplicar modelo: ${String(err)} |
| 1365 | toast | en | AI Assistance enabled (using local DSP fallback if Companion Bridge is offline) |
| 1367 | toast | en | AI Assistance enabled (Companion Bridge ready) |
| 1370 | toast | en | 100% Algorithmic DSP Mode activated |
| 1438 | toast | en | Could not decode sample for chopper: ${err instanceof Error ? err.message : String(err)} |
| 1461 | toast | es | No hay zonas o regiones para aplicar AutoLoop. |
| 1481 | toast | es | Ninguna zona tenía audio suficiente para calcular puntos de bucle. |
| 1501 | toast | en | AutoLoop aplicado en ${computed.length} zona(s) (zc-snap • empalme medio ${avgQuality}%). |
| 1531 | toast | en | Failed to convert cover image: ${err instanceof Error ? err.message : String(err)} |
| 1592 | toast | en | Error during processing: ${event.error} |
| 1655 | toast | en | Cannot start Process: gaps in MIDI note coverage (${errors.length}). Adjust zone boundaries or Reset to a single 0..127 zone. |
| 1683 | confirmDialog | en | Model "${this.session.processConfig.modelName}" comes from an already-compiled legacy .model (no original WAVs) and nothing was modified. It is ready to use or export as-is. |
| 1692 | confirmDialog | en | The ${srcInfo.importedSources.length} source(s) of this model come from a legacy .model without the original WAVs. |
| 1699 | confirmDialog | en | Force the lossy re-analysis (photocopy effect) at Complexity ${this.session.processConfig.complexity}? |
| 1708 | confirmDialog | en | This model comes from an already-compiled legacy .model (no original WAVs). |
| 1726 | prop:message | en | Beginning spectral neural resynthesis... |
### `src/ui/AiCoverGeneratorModal.ts` (45 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 206 | html | en | AI Model Cover Artwork Generator |
| 207 | html | en | FASE 20 — NEURAL &amp; PROCEDURAL |
| 209 | attr:aria-label | en | Close |
| 224 | html | en | Synthesizing Neural Artwork... |
| 230 | attr:alt | en | Cover Preview |
| 239 | html | en | Ready to Generate |
| 240 | html | en | Select an artistic style and click Generate below |
| 250 | attr:title | en | Apply this artwork as model cover |
| 253 | attr:title | en | Download WebP image |
| 256 | attr:title | técnico/sin marcas | Generate another variation |
| 274 | html | en | Model: |
| 275 | html | en | Set: |
| 276 | html | en | Category: |
| 277 | html | en | Output: |
| 277 | html | técnico/sin marcas | 512×512 WebP |
| 285 | html | en | Visual palette and synthesis genre |
| 308 | attr:title | sin determinar | ${escAttr(llmPromptDecl.buttonTooltip)} |
| 313 | attr:title | en | Reset prompt to acoustic default |
| 322 | attr:placeholder | en | Acoustic description used for diffusion... |
| 330 | html | en | Select offline procedural, local bridge or private Cloud BYOK |
| 339 | attr:title | en | ${escAttr(p.name)}: ${escAttr(p.description)} |
| 354 | html | en | Open Settings (Ctrl+,) |
| 377 | html | en | Close |
| 380 | attr:title | sin determinar | ${escAttr(artworkGenDecl.buttonTooltip)} |
| 410 | prop:message | en | Direct mathematical canvas rendering. 100% offline, zero latency, zero cost. |
| 426 | prop:message | en | Companion Bridge offline (:7860). Generating will ask confirmation before using the Procedural fallback. |
| 437 | prop:message | en | Google Gemini API Key is configured in BYOK storage. |
| 444 | prop:message | en | Google Gemini API Key is not configured. |
| 453 | prop:message | en | OpenAI API Key is configured in BYOK storage. |
| 460 | prop:message | en | OpenAI API Key is not configured. |
| 469 | prop:message | en | OpenRouter API Key is configured in BYOK storage. |
| 476 | prop:message | en | OpenRouter API Key is not configured. |
| 485 | prop:message | en | Anthropic Claude API Key is configured in BYOK storage. |
| 492 | prop:message | en | Anthropic Claude API Key is not configured. |
| 501 | prop:message | en | Hugging Face Token is configured in BYOK storage. |
| 508 | prop:message | en | Hugging Face Token is not configured. |
| 517 | prop:message | en | Replicate Token is configured in BYOK storage. |
| 524 | prop:message | en | Replicate API Token is not configured. |
| 611 | toast | mixto | Prompt enriquecido con la plantilla descriptiva acústica local. |
| 622 | toast | en | Prompt enriched with ${activeTextProvider!.toUpperCase()} acoustic descriptors. |
| 624 | toast | en | Failed to enrich prompt: ${String(err)} |
| 651 | toast | en | Model cover artwork updated (512×512 WebP attached). |
| 716 | toast | en | Artwork generated successfully in ${(result.generationTimeMs / 1000).toFixed(2)}s |
| 719 | toast | en | Artwork generation error: ${this.generationError} |
| 734 | toast | en | Downloaded "${slug}_cover_512x512.webp" |
### `src/ui/AudioChopperModal.ts` (172 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 199 | toast | mixto | Cargadas ${this.currentResult.slices.length} notas/velocidades desde el manifiesto MIDI de AutoSampler (${filename}) |
| 269 | toast | en | Imported ${parsed.sliceFrames.length} slices from ${parsed.formatLabel} (${file.name}) |
| 304 | toast | en | Loaded "${file.name}" with ${embedded.sliceFrames.length} embedded ${embedded.formatLabel} slices! |
| 322 | toast | en | Failed to decode audio file: ${msg} |
| 328 | toast | en | Please load an audio file first before importing a slice marker track. |
| 335 | toast | en | Could not find valid slice markers in "${file.name}". |
| 351 | toast | en | Applied ${parsed.sliceFrames.length} slices from ${parsed.formatLabel} (${file.name})! |
| 357 | toast | en | Failed to parse slice file: ${msg} |
| 388 | toast | en | Loaded 2-second synthesized test beat for slicer auditioning. |
| 459 | html | en | !(Math.abs(r.start - sl.startFrame) |
| 472 | toast | mixto | ${actionLabel} (cortes automáticos recalculados sobre el audio limpio). |
| 481 | toast | mixto | ${actionLabel} (cortes recalculados automáticamente). |
| 488 | toast | en | ${actionLabel} (cortes manuales preservados). |
| 506 | toast | mixto | ${actionLabel} (cortes recalculados sobre el audio limpio). |
| 510 | toast | en | ${actionLabel} (cortes manuales conservados). |
| 536 | html | en | Manual Slice Edits Detected |
| 545 | html | en | Manual Customizations: |
| 547 | html | en | manual slice cut marker(s) |
| 548 | html | en | manual silence interval(s) |
| 551 | html | en | How would you like to handle your manual cuts? |
| 555 | html | en | Remember choice for subsequent changes in this session |
| 561, 735 | html | en | Cancel |
| 564 | html | en | Discard Cuts (Auto) |
| 565 | html | en | Keep Manual Cuts |
| 641 | toast | en | Decompressing REX2 audio via Companion Bridge... |
| 688 | html | en | REX2 Audio Pairing Assistant |
| 695 | html | técnico/sin marcas | Proprietary DWOP Audio Compression Detected |
| 696 | html | en | File |
| 697 | html | técnico/sin marcas | contains |
| 702 | html | en | Option 1: Pair with Equivalent WAV / AIFF (Recommended) |
| 713 | html | en | Option 2: Native Companion Bridge Decompression |
| 714 | html | en | Start the local Python Companion Bridge ( |
| 715 | html | en | python bridge/server.py |
| 723 | html | en | Option 3: Inspect Slices with Synthetic Impulse Preview |
| 724 | html | en | Generate synthetic transient impulses at slice boundaries to inspect, edit, or export slice points without audio. |
| 727 | html | en | Open Slices in Synthetic Mode |
| 764 | toast | en | Paired "${rx2Filename}" slices with audio "${companionFile.name}"! |
| 766 | toast | en | Failed to load companion audio: ${err instanceof Error ? err.message : String(err)} |
| 780 | toast | en | No REX2 buffer stored to retry. Please reload the file. |
| 798 | toast | en | Loaded ${sliceFrames.length} REX2 slice markers with synthetic impulse waveform. |
| 865 | html | en | Audio Chopper &amp; Multi-Layer Auto-Slicer |
| 870 | attr:aria-label | en | Close |
| 885 | html | en | NO AUDIO FILE LOADED IN AUTO-SLICER |
| 893 | attr:title | en | Load a 2-second synthesized test beat to test slicing without a sample |
| 907 | html | en | ZOOM: |
| 908 | attr:title | en | Zoom Out Waveform |
| 910 | attr:title | en | Zoom In Waveform |
| 911 | html | técnico/sin marcas | Fit |
| 911 | attr:title | en | Fit Entire Audio File to Viewport |
| 921 | attr:title | en | Open another audio file |
| 931 | html | en | Left-drag markers to move |
| 931 | html | en | Right-click line/slice for Actions |
| 931 | html | en | Double-click or Right-click to Add Cut |
| 940, 1704 | html | en | CUT POINT MAGNIFIER (±256 smp): |
| 941, 1705 | html | en | &lt; Prev Cut |
| 941 | attr:title | en | Previous cut boundary |
| 943, 1708 | html | en | Next Cut &gt; |
| 943 | attr:title | en | Next cut boundary |
| 951 | html | en | NUDGE: |
| 952 | html | sin determinar | &lt;&lt; -100 |
| 952 | attr:title | en | Nudge boundary -100 samples |
| 953 | html | sin determinar | &lt; -10 |
| 953 | attr:title | en | Nudge boundary -10 samples |
| 954 | attr:title | en | Nudge boundary -1 sample |
| 955 | html | en | Snap 0-X |
| 955, 1048 | attr:title | sin determinar | ${escHtml(MUSICIAN_TERMS.zcSnap)} |
| 956 | attr:title | en | Nudge boundary +1 sample |
| 957 | html | sin determinar | +10 &gt; |
| 957 | attr:title | en | Nudge boundary +10 samples |
| 958 | html | sin determinar | +100 &gt;&gt; |
| 958 | attr:title | en | Nudge boundary +100 samples |
| 959 | attr:title | en | Audition selected slice |
| 962 | attr:title | en | Toggle silence for current slice |
| 965 | attr:title | en | Delete this cut boundary |
| 982 | html | en | SLICING MODE |
| 985 | attr:title | en | Classify into General MIDI Drum Map notes |
| 991 | attr:title | en | Detect F0 pitch and map to contiguous equidistant key zones |
| 994 | html | en | Grid BPM |
| 994 | attr:title | en | Chop by musical grid tempo division |
| 1003 | html | técnico/sin marcas | TRANSIENT SENSITIVITY |
| 1008 | attr:title | en | ${this.manualCutFrames.size} manual cut(s) preserved |
| 1010 | html | en | Reset |
| 1010 | attr:title | en | Discard manual cuts and reset to full auto detection |
| 1022 | html | en | SILENCE GATE |
| 1031 | html | en | MIN SLICE (MS) |
| 1033 | attr:title | en | Minimum slice duration in milliseconds |
| 1039 | html | en | PRE-ROLL (MS) |
| 1041 | attr:title | en | Pre-roll safety margin in milliseconds |
| 1051 | attr:title | en | Allow overlapping key & velocity zones |
| 1057 | attr:title | en | Clean audio with DSP Spectral Gate using captured or auto noise profile |
| 1060 | attr:title | sin determinar | ${escHtml(demucsDecl.buttonTooltip)} |
| 1063 | attr:title | sin determinar | ${escHtml(whisperDecl.buttonTooltip)} |
| 1066 | attr:title | sin determinar | ${escHtml(bweDecl.buttonTooltip)} |
| 1079 | html | sin determinar | Target: |
| 1088 | html | técnico/sin marcas | #ID |
| 1089 | html | en | Time Range |
| 1090 | html | técnico/sin marcas | Duration |
| 1091 | html | técnico/sin marcas | Classification |
| 1092 | html | en | Root Key |
| 1093 | html | en | Key Range |
| 1094 | html | en | Velocity |
| 1095 | html | en | Peak / RMS |
| 1096 | html | técnico/sin marcas | Actions |
| 1112 | html | en | Discard &amp; Close |
| 1119 | attr:title | en | Drag MIDI Pattern directly to DAW track or click to download .mid file |
| 1144 | html | en | No slices detected. Adjust sensitivity slider above. |
| 1158 | html | técnico/sin marcas | Silence |
| 1165 | attr:title | en | Audition slice one-shot |
| 1171 | attr:title | en | Remove slice marker |
| 1626 | html | técnico/sin marcas | Math.abs(s.startFrame - cutFrame) |
| 1705 | attr:title | en | Previous slice boundary |
| 1707 | html | en | MANUAL CUT |
| 1708 | attr:title | en | Next slice boundary |
| 1856 | html | en | Slicing Mode |
| 1856 | html | técnico/sin marcas | to |
| 1862 | toast | en | Mode switched to ${newMode}: manual cuts preserved. |
| 1871 | toast | en | Mode switched to ${newMode}: reset to auto. |
| 1901 | html | técnico/sin marcas | Transient Sensitivity |
| 1906, 1917, 1933, 1945 | textContent | sin determinar | ${this.options.sensitivity}% |
| 1909 | toast | en | Sensitivity set to ${newSens}%: preserved ${this.manualCutFrames.size} manual cut(s). |
| 1920 | toast | en | Sensitivity set to ${newSens}%: reset to automatic transient detection. |
| 1925 | textContent | sin determinar | ${prevSensVal}% |
| 1961 | html | en | Silence Gate Threshold |
| 1966, 1977, 1993, 2005 | textContent | técnico/sin marcas | ${this.options.silenceThresholdDb} dB |
| 1969 | toast | en | Silence gate set to ${newSilence} dB: preserved manual edits. |
| 1980 | toast | en | Silence gate set to ${newSilence} dB: reset to auto. |
| 1985 | textContent | técnico/sin marcas | ${prevSilenceVal} dB |
| 2018 | toast | en | Reset all slices to automatic transient detection. |
| 2086 | toast | en | Removed cut boundary #${bIdx}. |
| 2119 | toast | en | Downloaded Standard MIDI pattern for sliced audio. |
| 2145 | toast | en | DSP Denoise failed: ${err instanceof Error ? err.message : String(err)} |
| 2183 | toast | en | Sending audio to AI Bridge with noise profile removal... |
| 2214 | toast | en | AI Enhance failed: ${err instanceof Error ? err.message : String(err)} |
| 2313 | html | técnico/sin marcas | Math.abs(b - hit.startFrame) |
| 2353 | prop:label | en | Delete Cut Boundary |
| 2362 | toast | en | Removed cut boundary #${hoveredBIdx}. |
| 2367 | prop:label | en | Snap to 0-Crossing |
| 2375 | prop:label | técnico/sin marcas | Inspect in Magnifier |
| 2441 | html | técnico/sin marcas | Math.abs(b - clickedFrame) |
| 2446 | toast | en | Added slice cut at ${clickedFrame.toLocaleString()} smp. |
| 2472 | toast | en | Captured noise print from Slice #${hitSlice.index} (${this.capturedNoiseProfile.levelDbfs.toFixed(1)} dBFS). Ready for DSP cleaning or AI Enhance! |
| 2488 | toast | en | Deleted slice #${hitSlice.index}. |
| 2511 | html | técnico/sin marcas | Math.abs(b - splitFrame) |
| 2516 | toast | en | Added slice cut at ${splitFrame.toLocaleString()} smp. |
| 2591 | html | técnico/sin marcas | Math.abs(b - sl.startFrame) |
| 2634 | toast | en | Removed slice marker. |
| 2653 | toast | en | No valid slices to inject into session. |
| 2700 | toast | en | Successfully mapped ${regions.length} audio slices to 2D Sampler Regions! |
| 2716 | toast | en | Successfully mapped ${zones.length} audio slices to Classic Keyboard Zones! |
| 2724 | toast | en | Please load or drop an audio file before aligning vocal phonemes. |
| 2746 | toast | mixto | Aplicada ${decl.fallbackEngine} (confirmado por el usuario). |
| 2753 | toast | en | Analyzing vocal phonemes with Whisper-tiny... |
| 2785 | toast | en | Aligned ${res.words.length} vocal segments via Whisper-tiny (${((res.durationSec ?? 0) * 1000).toFixed(0)}ms total)! |
| 2791 | toast | sin determinar | Whisper alignment error: ${msg} |
| 2799 | toast | en | Please load an audio file first before separating stems. |
| 2810 | html | sin determinar | Demucs AI Stem Separation |
| 2815 | html | en | Isolate vocal lines or instrument stems using Demucs neural stem separation (or high-fidelity Mid/Side DSP fallback) before slicing. |
| 2819 | html | sin determinar | Stems to Separate: |
| 2823 | html | técnico/sin marcas | Vocals (Acapella) |
| 2827 | html | técnico/sin marcas | Drums (Percussion) |
| 2831 | html | técnico/sin marcas | Bass (Low-End) |
| 2835 | html | técnico/sin marcas | Instrumental (Other) |
| 2840 | html | técnico/sin marcas | Separated Audio Stems: |
| 2844 | html | en | Running Demucs stem separation via Companion Bridge... |
| 2849 | html | en | Close |
| 2877 | toast | en | Select at least one stem to separate. |
| 2895 | html | en | No stems were returned. |
| 2904 | textContent | en | ${name} (${(buf.byteLength / 1024).toFixed(1)} KB) |
| 2912 | textContent | en | Load into Slicer |
| 2924 | toast | en | Loaded "${name}" stem into Audio Chopper! |
| 2927 | toast | en | Failed to load stem: ${errStr} |
| 2972 | toast | sin determinar | Stem separation error: ${msg} |
### `src/ui/AudioRecorderModal.ts` (126 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 326 | html | en | Default input |
| 345 | html | en | No WebMIDI Out port detected |
| 355 | html | en | No WebMIDI In port detected |
| 382 | toast | en | Microphone unavailable: ${err instanceof Error ? err.message : String(err)} |
| 473 | toast | en | Take discarded. |
| 499 | toast | en | Stop current recording before running Pilot Note Calibration. |
| 536 | toast | técnico/sin marcas | RTL ${diag.latencyMs.toFixed(1)} ms (${diag.latencySamples} smp) applied automatically. |
| 589 | prop:label | técnico/sin marcas | Off |
| 596 | toast | en | Live MIDI Capture active: play your MIDI keyboard and press Stop when finished. |
| 642 | toast | en | All scheduled cells are already recorded. |
| 838 | textContent | sin determinar | ${clsLabel} ${(enrichedTake.classificationConfidence * 100).toFixed(0)}% |
| 973 | toast | en | No leading or trailing silence below threshold to trim. |
| 977 | toast | en | Entire take is below the silence threshold; adjust threshold dB. |
| 1027 | toast | en | Select a noise region or capture a noise print first. |
| 1117 | toast | es | Aplicando ${aiDecl.fallbackEngine} (confirmado por el usuario)... |
| 1130 | toast | en | AI Enhancing "${st.name}" (96 kHz BWE + Noise Print suppression)... |
| 1168 | toast | en | AI Enhanced "${st.name}" to ${(decoded.sampleRate / 1000).toFixed(1)} kHz (Noise Print suppressed)! |
| 1176 | toast | en | AI Enhance failed: ${err instanceof Error ? err.message : String(err)} |
| 1193 | toast | en | Restored previous state of "${st.name}". |
| 1305 | html | en | Studio Audio Recorder &amp; MIDI AutoSampler Lab |
| 1306 | html | técnico/sin marcas | IDLE |
| 1308 | attr:aria-label | en | Close |
| 1316 | attr:aria-label | en | Recorder operating mode |
| 1317 | html | sin determinar | WORKFLOW: |
| 1332 | attr:title | en | Constant horizontal zoom window during live recording (never squashes the wave) |
| 1333 | html | en | LIVE WINDOW: |
| 1345 | html | técnico/sin marcas | AUDIO IN: |
| 1346 | attr:aria-label | técnico/sin marcas | Input device |
| 1347 | attr:title | en | Refresh input devices |
| 1351 | html | técnico/sin marcas | −∞ dBFS |
| 1352 | html | en | no take yet |
| 1382 | html | en | SESSION TAKES |
| 1385 | html | en | Select a take to inspect waveform, capture Noise Print, rescue cuts, or send to Chopper / Session |
| 1393 | html | en | Close |
| 1497 | attr:title | en | Apply measured RTL (${this.lastPilotRecommendation.latencyMs.toFixed(1)} ms) and envelope recommendations |
| 1502 | attr:title | en | Rescan WebMIDI ports |
| 1515 | html | en | MIDI OUT (SYNTH / VST) |
| 1520 | attr:title | en | MIDI Channel (1..16) |
| 1526 | html | en | MIDI IN (KEYBOARD / CONTROLLER) |
| 1537 | html | en | START OCTAVE &amp; COUNT |
| 1549 | attr:title | en | Number of octaves |
| 1555 | html | en | NOTES PER OCTAVE |
| 1559 | html | en | 1 per octave (Roots C only · 12 st) |
| 1560 | html | en | 2 per octave (Tritone · every 6 st) |
| 1561 | html | en | 3 per octave (Major 3rds · every 4 st) |
| 1562 | html | en | 4 per octave (Minor 3rds · every 3 st) |
| 1563 | html | en | 6 per octave (Whole tones · every 2 st) |
| 1564 | html | en | 12 per octave (Chromatic · every 1 st) |
| 1573 | html | en | NOTE DURATION &amp; RELEASE TAIL |
| 1577 | attr:title | en | Gate duration (NoteOn to NoteOff in ms) |
| 1578 | attr:title | en | When NoteOff is sent, sound may keep ringing: Auto-Detect waits until decay hits noise floor; Fixed waits exact ms |
| 1579 | html | en | Auto-Decay to Silence |
| 1580 | html | en | Fixed Release Time |
| 1582 | attr:title | en | Max release timeout / Fixed release duration (ms) |
| 1591 | html | en | VELOCITY LAYERS &amp; CURVE |
| 1595 | attr:title | en | Number of velocity layers (1..8) |
| 1597 | html | técnico/sin marcas | Lineal (Equidistante) |
| 1598 | html | es | Logarítmica / Exponencial (+ precisión en altos 85..127) |
| 1599 | html | es | Comprimida (+ precisión en bajos 1..65) |
| 1600 | html | mixto | Clásica Neuron (2 capas: 60 / 120) |
| 1601 | html | en | Tabla Manual Editable |
| 1606 | attr:placeholder | sin determinar | e.g. 35, 75, 105, 127 |
| 1606 | attr:title | en | Comma-separated MIDI velocities (1..127) |
| 1621 | html | en | DRUM MAP: |
| 1623 | html | en | -- Select Factory Drum Map or Import File -- |
| 1631 | attr:title | en | Import .txt, .json, or .yaml drum hit-name map |
| 1635 | attr:title | en | Paste raw text from a drum machine PDF manual to extract MIDI notes & hit names automatically |
| 1638 | html | en | ? Format Spec &amp; Templates |
| 1638 | attr:title | en | Show technical format specification and download templates |
| 1650 | html | en | TECHNICAL SPECIFICATION FOR DRUM HIT-NAME MAPS (.TXT / .JSON / .YAML) |
| 1664 | html | en | PASTE RAW DRUM MANUAL TABLE (E.G. "36 Bass Drum 1" OR "C1: Kick") |
| 1665 | attr:placeholder | en | 36 = Kick Drum&#10;38 = Snare Acoustic&#10;42 = Closed Hat&#10;46 = Open Hat |
| 1680 | attr:title | en | Clean DC offset and subtract pre-roll Noise Print on the continuous take BEFORE slicing |
| 1682 | html | en | Clean before slice |
| 1684 | attr:title | en | Search zero-crossing sustain loops strictly between NoteOn and NoteOff (never inside the release tail) |
| 1686 | html | técnico/sin marcas | AutoLoop (NoteOn..NoteOff) |
| 1688 | attr:title | en | Measure real F0 in sustained region and set detuneCents (-50..+50) for analog drift compensation |
| 1690 | html | en | Analog F0 Detune Comp |
| 1697 | attr:title | en | Continue recording only pending or failed cells from where it stopped |
| 1705 | html | en | OFFSET (ms): |
| 1706 | attr:title | en | Rescue cut offset (± ms) if hardware latency shifted NoteOn markers |
| 1707 | attr:title | en | Re-run deterministic slicing & AutoLoop on the already recorded continuous take without re-recording |
| 1716 | attr:aria-label | en | AutoSampler Notes x Velocities Grid |
| 1733 | html | en | Play notes on your MIDI keyboard or configure sweep parameters above. |
| 1749 | attr:title | en | Click to audition slice · Shift+Click to re-record only this cell (${escHtml(titleLabel)} vel ${ev.velocity}) |
| 1817 | toast | en | Applied RTL ${this.lastPilotRecommendation.latencyMs.toFixed(1)} ms (${this.lastPilotRecommendation.latencySamples} smp) and pilot recommendations. |
| 1916 | toast | en | Could not parse any valid MIDI drum hits from "${file.name}". |
| 1920 | toast | en | Loaded drum map "${parsed.kitName}" (${parsed.hits.length} hits). |
| 1937 | toast | en | No valid note/name pairs found in text. |
| 1942 | toast | en | Extracted ${parsed.hits.length} drum hits from manual text. |
| 2019 | toast | en | Re-sliced "${st.name}" with offset ${this.autoSamplerConfig.extraLatencyOffsetMs} ms: ${out.slicerResult.slices.length} slices ready. |
| 2037 | attr:title | en | Record / start AutoSampler sweep |
| 2038 | attr:title | en | Stop and keep take |
| 2039 | attr:title | en | Discard current take |
| 2058 | attr:title | en | Download selected take as 16-bit WAV |
| 2061 | attr:title | en | Open selected take in Audio Chopper & Auto-Slicer with MIDI cut points |
| 2066 | attr:title | en | Inject all AutoSampled zones/regions + AutoLoops into Session |
| 2070 | attr:title | en | Inject selected take into Active Zone |
| 2103 | html | en | Live Recording = Scrolls horizontally at constant |
| 2103 | html | en | zoom (never squashes) |
| 2104, 2150 | html | técnico/sin marcas | NoteOn |
| 2105, 2151 | html | técnico/sin marcas | NoteOff |
| 2105 | html | en | (Release start) |
| 2106 | html | técnico/sin marcas | TailEnd |
| 2106 | html | en | / Loop |
| 2149 | html | en | Drag on waveform = Select |
| 2149 | html | en | Noise Print |
| 2149 | html | en | region (Violet) |
| 2152 | html | en | TailEnd / Cut |
| 2163 | attr:title | sin determinar | ${escHtml(npSummary)} |
| 2170 | html | en | SILENCE GATE THRESHOLD |
| 2178 | html | en | SPECTRAL DENOISE REDUCTION |
| 2187 | attr:title | sin determinar | ${escHtml(MUSICIAN_TERMS.noisePrint)} |
| 2190 | attr:title | en | Trim leading and trailing silence |
| 2193 | attr:title | en | Subtract captured Noise Print and notch 50/60 Hz hum |
| 2196 | attr:title | en | Apply DC Block and Peak Normalize to -1.0 dBFS |
| 2199 | attr:title | sin determinar | ${escHtml(recBweDecl.buttonTooltip)} |
| 2205 | attr:title | en | Undo last edit on this take |
| 2208 | attr:title | en | Audition selected region (or full take) |
| 2233 | textContent | técnico/sin marcas | ${this.denoiseReductionDb} dB |
| 2549 | html | en | No takes yet — enable audio input and press REC / START SWEEP. |
| 2566 | attr:title | en | Audition take |
| 2567 | attr:title | en | Send to Audio Chopper / AutoSlicer |
| 2570 | attr:title | en | Inject into Session |
| 2573 | attr:title | técnico/sin marcas | Download WAV |
| 2574 | attr:title | en | Delete take |
### `src/ui/BankDrawer.ts` (38 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 137 | prop:label | en | Refresh |
| 138 | prop:label | técnico/sin marcas | Folder |
| 139 | prop:label | en | Clear |
| 140 | prop:label | en | Close |
| 277 | toast | en | There are no generated models to clear in this bank. |
| 281 | confirmDialog | en | Clear all ${count} generated model(s) from the bank? This cannot be undone. |
| 385, 413, 444 | prop:label | técnico/sin marcas | All |
| 430 | prop:label | técnico/sin marcas | Pending |
| 492 | html | en | No models generated in this bank yet |
| 493 | html | en | Create zones, assign samples, and click Process to generate models. |
| 548 | attr:alt | en | ${escAttr(m.name)} |
| 566, 769, 930 | prop:label | en | Load |
| 567 | prop:label | en | Time Capsule |
| 606 | html | en | No sound presets loaded |
| 607 | html | en | Presets are loaded from NeuronDB/Sounds or your library folder. |
| 610 | html | sin determinar | Configure NeuronDB Library Folder... |
| 659 | prop:label | en | Load Sound |
| 719 | html | sin determinar | No library folder scanned yet |
| 720 | html | en | Select a NeuronDB library folder to browse its models here. |
| 723 | html | en | Select Library Folder... |
| 849 | html | en | No models in AxionikDB library yet |
| 850 | html | en | Save your extended models to AxionikDB or configure the library folder in Settings. |
| 853 | html | técnico/sin marcas | Configure AxionikDB Folder... |
| 881 | html | en | Sub-library: |
| 889 | attr:title | en | Delete current sub-library (must be empty) |
| 894 | html | en | Sort: |
| 896 | html | en | Ordinal # (Manual) |
| 897 | html | en | Name (A-Z) |
| 898 | html | en | Recent Date |
| 931 | prop:label | técnico/sin marcas | Duplicate |
| 932 | prop:label | técnico/sin marcas | Move... |
| 998 | toast | en | Moved "${item.name}" to "${targetSub}" |
| 1001 | toast | en | Failed to move model: ${msg} |
| 1061 | toast | en | Created sub-library "${clean}" |
| 1064 | toast | en | Failed to create sub-library: ${msg} |
| 1073 | confirmDialog | en | Are you sure you want to delete the empty sub-library "${subName}"? |
| 1082 | toast | en | Deleted sub-library "${subName}" |
| 1085 | toast | en | Cannot delete sub-library: ${msg} |
### `src/ui/BatchProcessorModal.ts` (69 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 98 | confirmDialog | en | A batch process is currently running. Do you want to cancel it and exit? |
| 156 | html | en | Batch Processor (Phase 12) |
| 158 | attr:aria-label | en | Close |
| 161 | attr:aria-label | en | Batch progress stages |
| 162 | html | técnico/sin marcas | 1. Discovery |
| 164 | html | técnico/sin marcas | 3. Execution |
| 165 | html | técnico/sin marcas | 4. Report |
| 198 | html | sin determinar | Ingestion Strategy: |
| 204 | html | técnico/sin marcas | Multisample Instruments |
| 218 | html | sin determinar | Slicing Profile: |
| 220 | html | técnico/sin marcas | Drums (General MIDI C1..B2 Map) |
| 221 | html | en | Chromatic (F0 Pitch + Equidistant 0..127) |
| 222 | html | sin determinar | Vocals & Phrases (Silence Valleys) |
| 223 | html | en | Musical Grid (1/16 Beat Division) |
| 229 | html | en | Generate & Bundle Groove MIDI Pattern (.mid) |
| 234 | html | en | VRAM Stage Safety Flush |
| 234 | attr:title | en | Flushes CUDA memory between model jobs to prevent GPU OOM on 6/8 GB cards |
| 243 | html | en | Select Source Material |
| 251 | html | en | or loop folders here' : 'Drag & drop |
| 253 | html | en | or use the buttons below |
| 259 | html | en | Select SoundFont (.sf2) |
| 281 | html | en | Companion Bridge Local Disk Scanner |
| 282 | html | en | Scan high-capacity local disk folders without loading gigabytes of raw audio into browser memory. |
| 286 | attr:placeholder | sin determinar | C:\\path\\to\\soundfonts |
| 291 | html | en | Companion Bridge is offline. Start the bridge daemon on |
| 291 | html | sin determinar | to scan local disk paths directly. |
| 337 | html | en | Execution Profile (Inherited from Active Session) |
| 340 | html | sin determinar | DSP Algorithm: |
| 344 | html | en | Working Mode: |
| 348 | html | sin determinar | AI Engine: |
| 352 | html | sin determinar | Complexity: |
| 356 | html | sin determinar | Destination: |
| 360 | html | en | Destination Sub-library: |
| 362 | attr:placeholder | en | Default |
| 366 | html | sin determinar | Estimated Duration: |
| 373 | html | sin determinar | AutoSlicer Pipeline: |
| 398 | html | en | Model Name & Slug |
| 399 | html | en | Source Origin |
| 400 | html | técnico/sin marcas | Coverage |
| 401 | html | técnico/sin marcas | Classification |
| 435 | html | técnico/sin marcas | Pending |
| 439 | html | técnico/sin marcas | Completed |
| 441, 530 | html | en | Failed |
| 443, 534 | html | técnico/sin marcas | Skipped |
| 469 | html | sin determinar | Current: |
| 480 | html | en | Model |
| 481 | html | técnico/sin marcas | Slug |
| 482 | html | en | Status |
| 483 | html | en | Time |
| 501 | html | en | Cancel Batch |
| 520 | html | en | Batch Processing Finished |
| 526 | html | técnico/sin marcas | Succeeded |
| 545 | html | en | Export Log (JSON) |
| 546 | html | en | Close |
| 615 | toast | en | Please enter a directory path on your local disk. |
| 630 | toast | en | Scan failed: ${err instanceof Error ? err.message : String(err)} |
| 684 | confirmDialog | en | Are you sure you want to cancel the batch? |
| 728 | toast | en | Loaded ${candidates.length} candidates from ${originTitle}. |
| 736 | toast | en | No presets found in SoundFont "${soundFontName}". |
| 744 | toast | en | Discovered ${extracted.length} presets from "${soundFontName}". |
| 755 | toast | en | No presets found in SoundFont "${file.name}". |
| 762 | toast | en | Discovered ${extracted.length} presets from "${file.name}". |
| 791 | toast | en | No WAV, AIFF, or ReCycle loop files found in selected directory. |
| 798 | toast | en | Discovered ${extracted.length} model sets from folder. |
| 800 | toast | en | Failed to read folder files: ${err instanceof Error ? err.message : String(err)} |
| 835 | toast | en | Discovered ${extracted.length} loop(s) for Batch AutoSlicer. |
| 837 | toast | en | Failed to read loop files: ${err instanceof Error ? err.message : String(err)} |
| 846 | toast | en | Please select at least one model to process. |
| 868 | toast | en | Batch queue error: ${err instanceof Error ? err.message : String(err)} |
### `src/ui/ConfigHealthModal.ts` (9 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 98 | html | sin determinar | System Configuration &amp; Readiness Diagnostic |
| 101 | attr:aria-label | en | Close |
| 113 | html | técnico/sin marcas | Mandatory Essentials |
| 119 | html | sin determinar | Optional &amp; AI Accelerators |
| 137 | html | es | Configuración Obligatoria (Core System) |
| 155 | html | sin determinar | Impact: |
| 191 | html | sin determinar | Unlocks: |
| 210 | html | en | Show diagnostic on startup when components are unconfigured |
| 216 | html | técnico/sin marcas | Continue to MODELmaker |
### `src/ui/ExportDestinationModal.ts` (9 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 129 | attr:aria-label | sin determinar | Exportar instrumento por destino |
| 134 | html | es | Exportar instrumento: ¿dónde lo vas a tocar? |
| 138 | attr:title | es | Cerrar (Esc) |
| 138 | attr:aria-label | es | Cerrar |
| 145 | html | técnico/sin marcas | con |
| 146 | html | es | o guárdalo en |
| 146 | html | técnico/sin marcas | AxionikDB |
| 157 | html | sin determinar | Destino activo: |
| 160 | html | es | Cerrar |
### `src/ui/KeyboardStrip.ts` (7 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 111 | html | en | KEYBED RANGE: |
| 115 | html | sin determinar | OCT − |
| 117 | html | técnico/sin marcas | OCT + |
| 173 | textContent | sin determinar | ${midiToNoteName(startNote)} (${startNote}) — ${midiToNoteName(startNote + keyCount - 1)} (${startNote + keyCount - 1}) |
| 177 | textContent | sin determinar | OCT ${this.baseOctave} |
| 198 | html | técnico/sin marcas | sp.lowKey |
| 244 | textContent | técnico/sin marcas | R: ${midiToNoteName(midi)} |
### `src/ui/LoadingModal.ts` (2 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 33 | html | técnico/sin marcas | TRABAJANDO... |
| 34 | html | sin determinar | Por favor espera un momento... |
### `src/ui/LoopEditorModal.ts` (44 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 154 | toast | en | Loaded "${file.name}" into AutoLoop Editor (${(totalFrames / sr).toFixed(2)}s) |
| 157 | toast | en | Failed to load audio: ${msg} |
| 202 | toast | en | Loaded 3-second harmonic sustained test tone into AutoLoop Editor. |
| 236 | html | sin determinar | Waveform AutoLoop Editor &amp; Zero-Crossing Seam Magnifier |
| 241 | attr:aria-label | en | Close |
| 257 | html | en | NO AUDIO SAMPLE LOADED IN AUTOLOOP EDITOR |
| 279 | html | en | ZOOM: |
| 280 | attr:title | en | Zoom Out Waveform |
| 282 | attr:title | en | Zoom In Waveform |
| 283 | html | técnico/sin marcas | Fit |
| 283 | attr:title | técnico/sin marcas | Fit Entire Waveform |
| 286 | html | sin determinar | Seam Match: |
| 286 | attr:title | en | Click-free splice continuity score |
| 289 | attr:title | en | Open another audio file |
| 300 | html | técnico/sin marcas | Drag |
| 300 | html | en | L-START |
| 300 | html | sin determinar | (Green) or |
| 300 | html | técnico/sin marcas | L-END |
| 300 | html | en | (Cyan) markers |
| 311 | html | en | LOOP MODE |
| 313 | html | en | One-Shot (No Loop) |
| 314 | html | en | Continuous Forward Loop |
| 315 | html | sin determinar | Ping-Pong (⇄ Alternate) |
| 316 | html | en | Sustain Loop |
| 323 | html | en | LOOP START (FRAMES) |
| 332 | html | en | LOOP END (FRAMES) |
| 341 | html | en | CROSSFADE (MS) |
| 351 | attr:title | sin determinar | ${escHtml(MUSICIAN_TERMS.zcSnap)} |
| 356 | html | sin determinar | ALGORITHM: |
| 358 | html | técnico/sin marcas | F0 Period-Lock (Autocorr) |
| 359 | html | técnico/sin marcas | Normalized Cross-Correlation (NCC) |
| 360 | html | técnico/sin marcas | Minimum Seam Discontinuity |
| 361 | html | en | Equal-Power Crossfade |
| 363 | attr:title | en | Automatically find optimal click-free loop points |
| 370 | attr:title | en | Audition sample in continuous hardware loop |
| 382 | html | en | Discard &amp; Close |
| 457, 464, 719 | textContent | sin determinar | ${this.zoomFactor.toFixed(1)}x |
| 472 | textContent | técnico/sin marcas | 1.0x |
| 491, 499 | textContent | sin determinar | ${(v / d.sampleRate).toFixed(3)}s |
| 510 | textContent | técnico/sin marcas | ${v} ms |
| 550 | toast | en | Auto-Loop identified optimal loop bounds via ${this.selectedAlgo} |
| 584 | toast | en | Applied loop points (${d.loopStart} .. ${d.loopEnd}) to zone. |
| 735 | textContent | sin determinar | ${(d.loopStart / d.sampleRate).toFixed(3)}s |
| 736 | textContent | sin determinar | ${(d.loopEnd / d.sampleRate).toFixed(3)}s |
### `src/ui/ModelConfigModal.ts` (111 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 60 | prop:label | en | GM Drum Map (Default Artwork) |
| 89 | prop:label | en | Default Acoustic Model (Default Artwork) |
| 95 | prop:label | en | Canonical Model (Default Artwork) |
| 172 | html | en | Model Configuration |
| 177 | attr:aria-label | en | Close |
| 183 | attr:aria-label | en | Model Configuration Sections |
| 187 | html | en | Mode &amp; Engine |
| 188 | html | en | Neuron 2002 / HD Multi-Layer |
| 194 | html | sin determinar | Playback &amp; Articulation |
| 195 | html | en | Glide, Bend &amp; Standard 24/96 |
| 201 | html | sin determinar | Metadata &amp; Tags |
| 208 | html | en | Cover Artwork |
| 256 | html | en | Hardware memory location, classic display name and extended next-gen title |
| 276 | attr:placeholder | sin determinar | Max 11 chars (e.g. Lead01)... |
| 282 | html | en | HARDWARE SLOT |
| 312 | attr:placeholder | en | Unrestricted full patch title (e.g. Cinematic Acoustic Guitar 1974 Strumming)... |
| 317 | html | en | SUB-LIBRARY (Fase 23) |
| 321 | attr:title | en | Assign model to sub-library in AxionikDB |
| 334 | attr:title | en | Ordinal position index in sub-library |
| 346 | html | en | Governs keyboard structure, velocity layers, and physical hardware constraints |
| 353 | html | en | Classic Mode (Hartmann Neuron 2002) |
| 354 | html | en | 1:1 Hardware Original |
| 356 | html | en | Contiguous keyboard |
| 357 | html | en | columns with no gaps or overlaps. Two velocity layers fixed at value |
| 357 | html | en | (Low and High). Model names strictly capped at 11 characters for physical display compatibility. |
| 366 | html | en | Extended Mode (Modern Neural / Next-Gen) |
| 367 | html | en | HD Multi-Layer |
| 379 | html | sin determinar | Safe Non-Destructive Bidirectional Compatibility: |
| 380 | html | en | You can switch between Classic and Extended modes at any time. When switching back to Classic Mode, multi-layer velocity regions are |
| 381 | html | en | not deleted |
| 381 | html | en | : the compiler mathematically projects and compensates relative gains ( |
| 381 | html | sin determinar | &Delta;G/20 |
| 391 | html | en | Compilation destination files and spectral modeling pipeline |
| 395 | html | en | TARGET EXPORT FORMAT |
| 397 | html | en | Dual (.model + .sound) |
| 400 | html | en | Legacy Neuron (.model) |
| 403 | html | en | Modern Neural (.sound) |
| 410 | html | técnico/sin marcas | DSP RESYNTHESIS ALGORITHM |
| 412 | html | técnico/sin marcas | Hartmann Legacy (2002) |
| 415 | html | en | Modern Neural Resynthesis |
| 427 | html | en | Controls FFT stick mode resolution: higher levels retain harmonic shimmer at cost of compile time |
| 430 | html | en | COMPLEXITY LEVEL |
| 450 | html | en | Determines the physical modeling exciter/resonator behavior in the Hartmann hardware |
| 460 | attr:title | en | ${p.id}: ${escAttr(p.name)} [${escAttr(p.category)}] — ${escAttr(p.description)} |
| 499 | html | en | Global defaults applied across all model zones and regions |
| 504 | html | en | DEFAULT LOOP MODE |
| 506 | html | en | One-Shot (No Loop) |
| 507 | html | en | Continuous Forward Loop |
| 508 | html | técnico/sin marcas | Ping-Pong (Alternate) |
| 509 | html | en | Sustain Loop (Release One-Shot) |
| 514 | html | técnico/sin marcas | NOTE TRIGGER LOGIC |
| 516 | html | en | Attack (Key-On Normal) |
| 517 | html | en | Release Trigger (Key-Off Release Sample) |
| 518 | html | sin determinar | Legato First Note Only |
| 519 | html | sin determinar | Legato Connected Notes Only |
| 526 | html | en | CROSSFADE CURVE |
| 528 | html | en | Equal Power (3dB Dip Free - Acoustic Standard) |
| 529 | html | en | Linear Gain |
| 530 | html | en | Spectral Morph |
| 536 | html | en | PITCH KEYTRACK |
| 555 | html | en | Studio-grade master wave resynthesis standards |
| 557 | html | en | When Master 24/96 processing is applied, original samples are promoted using cubic hermite interpolation and zero-crossing seam alignment. This ensures zero phase distortion when models are triggered in polyphonic environments. |
| 562 | html | en | SAMPLE RATE |
| 563 | html | técnico/sin marcas | 96.000 Hz |
| 566 | html | en | BIT DEPTH |
| 567 | html | técnico/sin marcas | 24-bit PCM |
| 570 | html | técnico/sin marcas | SEAM SNAPPING |
| 571 | html | técnico/sin marcas | Zero-Crossing &plusmn;128 smp |
| 574 | html | técnico/sin marcas | PHASE CORRELATION |
| 575 | html | en | Stereo Orthogonal |
| 596 | html | en | Preserved across AxionikDB and modern sampler instruments |
| 601 | html | técnico/sin marcas | AUTHOR / SOUND DESIGNER |
| 607 | attr:placeholder | en | Sound designer or creator name... |
| 611 | html | en | VERSION |
| 624 | html | técnico/sin marcas | LICENSE |
| 630 | attr:placeholder | técnico/sin marcas | e.g. CC-BY 4.0, CC0, Commercial |
| 634 | html | en | SOURCE / SF2 ORIGIN URL |
| 646 | html | en | DESCRIPTION &amp; PERFORMANCE NOTES |
| 651 | attr:placeholder | en | Acoustic characteristics, microphone placement, performance suggestions... |
| 667 | html | técnico/sin marcas | STANDARD METADATA ATTRIBUTE |
| 669 | html | en | ★ Custom Tag (User-defined key)... |
| 683 | html | en | CUSTOM KEY |
| 688 | attr:placeholder | técnico/sin marcas | e.g. MicDistance |
| 694 | html | en | ATTRIBUTE VALUE |
| 699 | attr:placeholder | sin determinar | ${escAttr(this.getActiveTagPlaceholder())} |
| 704 | html | sin determinar | &nbsp; |
| 717 | html | en | No metadata tags defined yet. Select an attribute above and click "Add Tag". |
| 728 | attr:title | en | Remove tag ${escAttr(item.tag)} |
| 745 | html | en | Non-destructive origin tracking with zero generation loss |
| 747 | html | en | The Time Capsule system stores original raw audio along with resynthesis parameters. At any time, you can trigger a lossless reprocess from the purest acoustic source without quality degradation. |
| 751 | attr:title | en | Lossless reprocess from original unaltered acoustic source |
| 772 | html | en | Rendered in ABDAxionikVS catalog, SoundFont browser, and modern VST3/AU wrappers |
| 781 | attr:alt | en | Model Cover Artwork |
| 794 | html | en | DEFAULT ARTWORK |
| 803 | html | en | UPLOAD OR REPLACE ARTWORK |
| 806 | html | en | Drag &amp; Drop Image Here |
| 808 | html | en | Browse File... |
| 818 | html | en | Generate unique 512×512 neural cover art tailored to model name and acoustic timbre. |
| 820 | attr:title | en | AI Cover Artwork Generation (Roadmap Phase 20) |
| 821 | html | técnico/sin marcas | Fase 20 |
| 891 | textContent | en | ${val.length}/11 chars |
| 901 | textContent | en | ${val.length} chars (No limit) |
| 931 | textContent | sin determinar | #${ord} |
| 950 | toast | en | Created sub-library "${clean}" |
| 953 | toast | en | Error creating sub-library: ${msg} |
| 1054 | textContent | sin determinar | ${val}% |
| 1131 | toast | en | Please specify a valid tag key. |
| 1140 | toast | en | Please enter a value for the tag. |
| 1147 | toast | sin determinar | Added tag "${finalKey}": "${val}" |
| 1169 | toast | en | Triggered lossless reprocess from purest source for current Time Capsule. |
| 1222 | toast | en | Opening AI Cover Artwork Generator... |
### `src/ui/MultiAssetTriageModal.ts` (18 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 83 | html | mixto | Directo a la sesión: audio y SF2. El resto se prepara en el Batch o va a Importación universal (Ctrl+I). |
| 93, 248 | attr:aria-label | en | Seleccionar ${escAttr(item.name)} |
| 100, 255 | html | es | Cargar |
| 106 | attr:aria-label | es | Contenido mixto: elegir qué hacer con cada pieza |
| 110 | html | es | Contenido mixto: ¿qué hacemos con cada cosa? |
| 113 | attr:aria-label | es | Cerrar |
| 119 | attr:placeholder | sin determinar | Filtrar piezas… |
| 122 | html | técnico/sin marcas | seleccionadas |
| 123 | html | técnico/sin marcas | Todas |
| 124 | html | técnico/sin marcas | Ninguna |
| 130 | html | técnico/sin marcas | Pieza |
| 130 | html | técnico/sin marcas | Formato |
| 130 | html | técnico/sin marcas | Muestras |
| 137 | html | mixto | «Cargar» mete el audio directo en la sesión · «Procesar» manda la selección al Batch · el resto va por Importación universal (Ctrl+I) |
| 142 | html | es | Cerrar |
| 145 | html | es | Procesar selección |
| 263 | textContent | es | Sin coincidencias para «${this.searchTerm}». |
| 271 | textContent | mixto | Procesar selección (${this.selectedIds.size}) |
### `src/ui/MultiInstrumentModal.ts` (13 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 119 | attr:title | en | Cancel |
| 119 | attr:aria-label | es | Cerrar |
| 129 | html | mixto | Carga uno directo en la sesión o procesa la colección entera en el Batch. |
| 144 | html | técnico/sin marcas | Limpiar |
| 149 | attr:title | en | Reagrupar por instrumento con IA (BYOK LLM) |
| 163 | html | en | Bank : Prog |
| 164 | html | técnico/sin marcas | Instrumento |
| 165 | html | técnico/sin marcas | Estructura |
| 192 | attr:title | es | Cargar este instrumento |
| 204 | html | mixto | Doble clic carga el instrumento · «Procesar» manda la colección entera al Batch |
| 210 | html | es | Cerrar |
| 219 | attr:title | mixto | Procesar los ${items.length} instrumentos en el Batch |
| 227 | attr:title | es | Cargar el instrumento seleccionado |
### `src/ui/MusicianWizardModal.ts` (79 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 222 | toast | es | Muestra "${slotAudio.sampleName}" cargada en el Paso 2 (Limpiar y mapear). |
| 235 | toast | mixto | Muestra "${fallback.sampleName ?? 'Zone_Sample.wav'}" cargada en el Paso 2 (Limpiar y mapear). |
| 241 | toast | es | Asigna antes un archivo de audio al slot para poder limpiarlo y mapearlo. |
| 339 | html | es | Asistente Guiado de Creación de Instrumento |
| 340 | html | técnico/sin marcas | 4 PASOS |
| 342 | attr:aria-label | es | Cerrar |
| 345 | attr:aria-label | es | Pasos del asistente guiado |
| 350 | html | es | 1. Material (Grabar / Importar) |
| 356 | html | técnico/sin marcas | 2. Limpiar |
| 362 | html | sin determinar | 3. Cortar y mapear |
| 368 | html | sin determinar | 4. Generar y exportar |
| 379 | html | es | Aviso del asistente |
| 426 | html | es | Paso 1 — Elige tu punto de partida musical |
| 435 | html | es | Captura una nota, acorde, frase melódica o ritmo percusivo directamente en el asistente, con detección automática de huella de ruido. |
| 449 | html | sin determinar | Abrir en taller avanzado (Grabadora)… |
| 458 | html | es | Grabando en vivo… toca tu instrumento o micrófono y pulsa |
| 458 | html | es | Detener grabación |
| 458 | html | es | cuando termines. |
| 483 | html | es | Ir al Paso 4 con la sesión actual → |
| 500 | html | en | Abrir Importador Universal avanzado… |
| 508 | html | técnico/sin marcas | Si sueltas un audio ( |
| 509 | html | técnico/sin marcas | Paso 2 (Limpiar) |
| 509 | html | técnico/sin marcas | Hartmann, |
| 509 | html | sin determinar | Paso 4 (Generar y exportar) |
| 514 | html | es | Arrastra aquí tu |
| 517 | html | es | o selecciónalo desde tu equipo |
| 554 | html | es | Extender zonas extremas para cubrir todo el teclado MIDI (0..127) |
| 564 | html | en | Adaptar capas de velocidad a 2 capas en modo Classic |
| 595 | html | es | Cerrar |
| 608 | html | sin determinar | Siguiente: 2. Limpiar → |
| 652 | html | es | Duración (Antes → Después): |
| 656 | html | es | Silencio recortado: |
| 660 | html | es | Nivel de Pico (Antes → Después): |
| 680 | html | es | Ajustes de limpieza (Defaults de músico activados) |
| 684 | html | es | Recortar silencios de entrada y salida automáticamente |
| 688 | html | es | (evita chasquidos al principio y final) |
| 692 | html | es | Atenuar ruido de fondo y zumbido 50/60 Hz usando la huella de ruido |
| 696 | html | en | Normalizar pico a -1.0 dBFS y eliminar offset DC |
| 707 | html | mixto | Abrir en taller avanzado (Grabadora / Huella de ruido manual)… |
| 718 | html | sin determinar | ← 1. Material |
| 721 | html | sin determinar | Siguiente: 3. Cortar y mapear → |
| 759 | html | es | Paso 3 — Cortar y mapear en el teclado ("¿Batería o melodía?") |
| 760 | html | mixto | Por defecto el asistente analiza el timbre y los ataques para decidir solo cómo trocear y repartir las zonas en el teclado MIDI |
| 760 | html | es | con ajuste al cruce por cero ( |
| 760 | html | en | zc-snap |
| 766 | html | mixto | ¿Qué tipo de material has grabado o importado? |
| 826 | html | sin determinar | -12 Oct |
| 826 | attr:title | sin determinar | Bajar 1 octava (-12 semitonos) |
| 827 | html | sin determinar | -1 Semi |
| 827 | attr:title | técnico/sin marcas | Bajar 1 semitono |
| 835 | attr:aria-label | es | Nota raíz MIDI (0..127) |
| 838 | html | sin determinar | +1 Semi |
| 838 | attr:title | técnico/sin marcas | Subir 1 semitono |
| 839 | html | sin determinar | +12 Oct |
| 839 | attr:title | sin determinar | Subir 1 octava (+12 semitonos) |
| 843 | attr:title | es | Restaurar nota raíz estimada por F0 (${midiToNoteName(res.detectedRootKey)}) |
| 857 | html | sin determinar | Sensibilidad de corte: |
| 877 | html | en | Preparar 2 capas de velocidad en Classic (Suave 1..63 / Fuerte 64..127) |
| 915 | html | mixto | Nota / Golpe detectado |
| 916 | html | es | Duración |
| 917 | html | es | Rango de teclado MIDI |
| 918 | html | técnico/sin marcas | Escuchar |
| 922 | html | en | Sin cortes |
| 930 | html | sin determinar | ← 2. Limpiar |
| 933 | html | sin determinar | Siguiente: 4. Generar y exportar → |
| 1023 | html | sin determinar | Paso 4 — Generar modelo espectral y exportar a tu destino |
| 1032 | html | es | Identidad y Motor del Instrumento (ProcessPanel Simplificado) |
| 1060 | html | sin determinar | Nombre Extendido (AxionikVS): |
| 1071 | html | sin determinar | Modo de trabajo: |
| 1073 | html | en | Classic (2 capas · Hardware 1:1) |
| 1074 | html | en | Extended (Multicapa 2D HD) |
| 1079 | html | mixto | Carácter Acústico (Parameter Set): |
| 1102 | html | es | ¿Dónde quieres usar o exportar tu instrumento? |
| 1115 | html | es | Cerrar asistente |
| 1377 | toast | mixto | Aplicada ${decl.fallbackEngine} (confirmado por el usuario). |
| 1382 | toast | mixto | Ejecutando Reconstructor de agudos (BWE) vía Companion Bridge… |
| 1397 | toast | mixto | Reconstructor de agudos (BWE) aplicado con éxito. |
| 1399 | toast | sin determinar | Error en BWE: ${err instanceof Error ? err.message : String(err)} |
| 1674 | toast | es | Instrumento "${this.expandedName}" volcado a la sesión activa. |
### `src/ui/Navbar.ts` (161 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 109 | attr:title | técnico/sin marcas | MODELmaker |
| 116 | prop:label | en | New Session (Reset) |
| 117 | prop:label | en | Open Session (.nmsession.json)... |
| 120 | prop:label | en | Save... |
| 122 | prop:label | en | Save Session |
| 123 | prop:label | en | Save Session As... |
| 125 | prop:label | en | Save Model to AxionikDB... |
| 126 | prop:label | en | Save Model to AxionikDB As (Duplicate)... |
| 129 | prop:label | en | Export Time Capsule As (.zip)... |
| 133, 176 | prop:label | es | Asistente Guiado de Músico (4 Pasos)... |
| 138 | prop:label | en | Import Audio Files (.wav / .aif / .flac)... |
| 139 | prop:label | en | Import Audio by Name (Hartmann convention)... |
| 140 | prop:label | en | Import Audio Folder... |
| 145 | prop:label | en | Batch Processor (Multi-Model Queue)... |
| 147 | prop:label | en | Import Model Folder (<NNN>.model)... |
| 148 | prop:label | sin determinar | Configure NeuronDB Library Folder... |
| 149 | prop:label | en | Import Model Files / .zip... |
| 151 | prop:label | en | Export Instrument (Choose Destination)... |
| 152 | prop:label | en | Export Active Zone as Legacy AIFF (44.1k/16b)... |
| 153 | prop:label | en | Export Sampler / Multi-Format Bank... |
| 159 | prop:label | técnico/sin marcas | Undo |
| 160 | prop:label | técnico/sin marcas | Redo |
| 164 | prop:label | en | New Zone (Split at Root Key) |
| 165 | prop:label | en | Remove Selected Zone |
| 167 | prop:label | técnico/sin marcas | Auto-Repair MIDI Coverage (0..127) |
| 168 | prop:label | en | Reset to Single Zone (0..127) |
| 170 | prop:label | en | Preferences & Settings... |
| 178 | prop:label | en | Model Configuration & Global Properties... |
| 179 | prop:label | en | Generate Cover Artwork with AI (Fase 20)... |
| 180 | prop:label | en | Audio Chopper & Auto-Slicer... |
| 181 | prop:label | en | Audio Recorder (Takes)... |
| 182 | prop:label | técnico/sin marcas | Waveform AutoLoop Editor... |
| 183 | prop:label | en | Process Model Now... |
| 184 | prop:label | en | Batch Process Models (Queue)... |
| 185 | prop:label | técnico/sin marcas | Validate MIDI Coverage (0..127) |
| 189 | prop:label | en | Working Mode |
| 191 | prop:label | en | Classic Mode (MODELmaker v1.2) |
| 192 | prop:label | en | Extended Mode (N-Layer / 2D Regions) |
| 197 | prop:label | en | Export / Save Mode |
| 199 | prop:label | en | Dual (.model + .nmmodel) |
| 200 | prop:label | en | Classic (.model / .sound) |
| 201 | prop:label | en | Extended (.nmmodel) |
| 205 | prop:label | en | AI Assistance & DSP Processing Engine... |
| 211 | prop:label | en | Zone Metadata Editor Drawer |
| 212 | prop:label | en | Spectral & A/B Resynthesis Inspector |
| 214 | prop:label | en | NeuronDB Bank Browser |
| 215 | prop:label | en | Telemetry & Coverage Audit |
| 219 | prop:label | en | Hardware Skin |
| 221 | prop:label | en | Hartmann Neuron (2002) |
| 222 | prop:label | sin determinar | Access Virus Snow (2008) |
| 223 | prop:label | técnico/sin marcas | AudioLab Precision |
| 224 | prop:label | técnico/sin marcas | Korg MS2000 |
| 225 | prop:label | técnico/sin marcas | Hartmann Advanced |
| 226 | prop:label | técnico/sin marcas | Casio CZ-101 |
| 231 | prop:label | en | Appearance Mode |
| 233 | prop:label | en | Light Mode |
| 234 | prop:label | en | Dark Mode |
| 236 | prop:label | en | Toggle Light / Dark |
| 244 | prop:label | sin determinar | Hartmann MODELmaker User Guide... |
| 245 | prop:label | sin determinar | NASAnalysis.dll & Dual-Target Specs... |
| 247 | prop:label | en | System Configuration Health & Diagnostics... |
| 248 | prop:label | en | Install Desktop App (PWA)... |
| 249 | prop:label | en | Settings & General Preferences... |
| 250 | prop:label | en | Local Companion Bridge & GPU Status... |
| 251 | prop:label | en | About NEURON MODELmaker... |
| 264 | attr:title | en | Active target model slot, hardware name, and character length |
| 265 | html | en | TARGET MODEL: |
| 268 | attr:title | en | Click to inspect or repair MIDI 0..127 coverage |
| 272 | attr:title | en | Algorithmic DSP mode (AI Off). Click to configure AI assistance. |
| 274 | html | en | AI MODE: OFF (DSP) |
| 283 | attr:title | sin determinar | Nothing to Undo (Ctrl+Z) |
| 286 | attr:title | sin determinar | Nothing to Redo (Ctrl+Y) |
| 289 | attr:title | en | Toggle Spectral & A/B Resynthesis Inspector (Ctrl+E) |
| 292 | attr:title | en | NeuronDB Bank Browser (Ctrl+B) |
| 298 | attr:title | en | Validation Log Drawer (Ctrl+L) |
| 304 | attr:title | en | Next synthesizer skin |
| 437 | textContent | técnico/sin marcas | #${slot} \u2022 ${displayName}${dirtyMark} \u2022 ${charInfo} |
| 449 | html | en | 128/128 MIDI KEYS READY |
| 536 | html | en | 1. Canonical Key Zone Table (MIDI 0 C-2 .. 127 G8) |
| 537 | html | en | Every Neuron model requires continuous coverage of all 128 MIDI keys ( |
| 537 | html | técnico/sin marcas | 0 C-2 |
| 537 | html | técnico/sin marcas | through |
| 537 | html | técnico/sin marcas | 127 G8 |
| 537 | html | en | Zone |
| 537 | html | en | Low Key |
| 537 | html | en | Root Key |
| 537 | html | en | High Key |
| 537 | html | técnico/sin marcas | Low Vel |
| 537 | html | técnico/sin marcas | High Vel |
| 537 | html | en | Detune |
| 537 | html | técnico/sin marcas | Volume |
| 537 | html | sin determinar | -32dB..+12dB |
| 537 | html | técnico/sin marcas | Pan |
| 538 | html | en | 2. Importing Audio Samples &amp; Banks |
| 540 | html | en | Universal Smart Import (Ctrl+I) |
| 540 | html | en | : Single entry point for all import formats. Drop or browse |
| 541 | html | en | Advanced Import submenu |
| 541 | html | técnico/sin marcas | name_rrr_lll_v1.aif |
| 542 | html | en | Export Active Zone as Legacy AIFF |
| 542 | html | en | : Converts any loaded zone to |
| 542 | html | en | 44.1 kHz / 16-bit / Mono Big-Endian FORM/AIFF |
| 542 | html | en | with |
| 542 | html | técnico/sin marcas | INST |
| 542 | html | en | chunk for legacy hardware tools. |
| 544 | html | en | 3. Keyboard Shortcuts |
| 545 | html | técnico/sin marcas | Ctrl+O |
| 545 | html | en | Open Session &bull; |
| 545 | html | técnico/sin marcas | Ctrl+S |
| 545 | html | en | Save Session &bull; |
| 545 | html | técnico/sin marcas | Ctrl+I |
| 545 | html | en | Universal Smart Import &bull; |
| 545 | html | técnico/sin marcas | Ctrl+N |
| 545 | html | en | Import by Name &bull; |
| 545 | html | técnico/sin marcas | Ctrl+Z / Ctrl+Y |
| 545 | html | sin determinar | Undo / Redo &bull; |
| 545 | html | técnico/sin marcas | Insert |
| 545 | html | en | New Zone &bull; |
| 545 | html | en | Delete |
| 545 | html | en | Remove Zone &bull; |
| 545 | html | técnico/sin marcas | Ctrl+P |
| 545 | html | en | Process Model &bull; |
| 545 | html | técnico/sin marcas | Ctrl+T |
| 545 | html | en | Export Time Capsule (.zip) &bull; |
| 545 | html | técnico/sin marcas | Ctrl+Shift+X |
| 545 | html | en | Export by Destination &bull; |
| 545 | html | en | Space |
| 545 | html | en | Play/Stop Audition. |
| 550 | html | en | 1. Native Pipeline Reconstructed from NASAnalysis.dll (SHA-256 434e2ac9...) |
| 552 | html | en | Complexity 1..10 &rarr; Recursion Depth |
| 552 | html | técnico/sin marcas | modes ( |
| 552 | html | técnico/sin marcas | stick |
| 552 | html | en | and |
| 553 | html | sin determinar | 6152-Byte Additive Partial Block (FUN_10007e00) |
| 553 | html | sin determinar | uint16 freq[1024] |
| 553 | html | técnico/sin marcas | in |
| 553 | html | técnico/sin marcas | 0.5 Hz |
| 553 | html | técnico/sin marcas | units, |
| 553 | html | sin determinar | uint16 amp[1024] |
| 553 | html | sin determinar | uint16 bin[1024] |
| 554 | html | en | 20 Parameter Set Axis Tables (0..9) |
| 554 | html | sin determinar | : Exact 12x8-byte ASCII morph axes in |
| 554 | html | técnico/sin marcas | mnAN |
| 554 | html | en | (104 B) and 6 float pairs in |
| 554 | html | técnico/sin marcas | fdAN |
| 554 | html | sin determinar | (56 B) for both |
| 554 | html | técnico/sin marcas | csAN |
| 554 | html | técnico/sin marcas | psAN |
| 556 | html | técnico/sin marcas | 2. Dual-Target Architecture |
| 558 | html | en | Legacy Hardware ( |
| 558 | html | sin determinar | : Generates |
| 558 | html | en | &lt;NNN&gt;.model/ |
| 558 | html | técnico/sin marcas | MName |
| 558 | html | técnico/sin marcas | map.script |
| 558 | html | sin determinar | %06d.scape |
| 558 | html | sin determinar | %06d.sphere |
| 558 | html | técnico/sin marcas | &lt;NNN&gt;.sound/ |
| 559 | html | en | Extended Spectral ( |
| 559 | html | sin determinar | : Preserves unquantized |
| 559 | html | técnico/sin marcas | Float32 |
| 559 | html | en | frequencies in Hz, multi-layer harmonic/interlaced clustering, and stereo metadata. |
| 578 | html | en | Close |
### `src/ui/NeuronDbModal.ts` (27 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 75 | attr:aria-label | en | NeuronDB Model Browser |
| 80 | html | en | NEURONDB MODEL BROWSER |
| 83 | attr:title | en | Close (Esc) |
| 96 | attr:aria-label | en | Search models |
| 99 | attr:title | en | Grid View |
| 102 | attr:title | en | Table View |
| 114 | html | sin determinar | COMPLEXITY: |
| 115 | attr:title | en | Filter by Analysis Complexity (1..10) |
| 116 | html | técnico/sin marcas | All (1..10) |
| 120 | html | en | Scanning model headers... |
| 149 | html | en | Cancel |
| 152 | html | en | LOAD MODEL |
| 302 | textContent | en | All ${total} model headers ready |
| 304 | textContent | en | Inspecting headers: ${done} / ${total}... |
| 337 | html | técnico/sin marcas | ALL |
| 371 | prop:label | técnico/sin marcas | SLOT |
| 372 | prop:label | en | MODEL NAME |
| 373 | prop:label | en | ZONES |
| 374 | prop:label | técnico/sin marcas | SOURCES |
| 375 | prop:label | en | PARAMETER SET |
| 376 | prop:label | técnico/sin marcas | COMPLEXITY |
| 385 | attr:title | en | Sort by ${c.label} |
| 391 | html | técnico/sin marcas | ACTION |
| 512 | textContent | técnico/sin marcas | No selection |
| 559, 642 | html | en | No models match the filter criteria |
| 560, 643 | html | en | Reset Filters |
| 742 | html | en | Load |
### `src/ui/preflightGateView.ts` (1 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 348 | html | es | Qué voy a cambiar: |
### `src/ui/ProcessModal.ts` (13 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 39 | html | en | NEURAL SPECTRAL PROCESS |
| 41 | attr:title | en | Close |
| 47 | html | en | Initializing neural analysis pipeline... |
| 56 | html | técnico/sin marcas | PROGRESS |
| 60 | html | en | ACTIVE ZONE |
| 64 | html | en | ELAPSED TIME |
| 65 | html | técnico/sin marcas | 0.0s |
| 70 | html | en | ANALYZING SAMPLE: |
| 75 | html | en | [0.0s] Neural engine starting... |
| 136 | textContent | sin determinar | ${p.percent}% |
| 137 | textContent | sin determinar | ${p.currentZone} / ${p.totalZones} |
| 138 | textContent | sin determinar | ${(p.elapsedMs / 1000).toFixed(1)}s |
| 144 | textContent | sin determinar | [${(p.elapsedMs / 1000).toFixed(1)}s] ${p.message} |
### `src/ui/ProcessPanel.ts` (33 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 228 | attr:title | en | Expand Global Model Settings Panel |
| 229 | attr:aria-label | en | Expand Global Model Settings Panel |
| 240, 379 | attr:title | en | ${status.tooltip} |
| 241 | attr:aria-label | en | ${status.tooltip} |
| 283 | attr:title | en | Parameter Set #${this.currentConfig.parameterSet}: ${escAttr(activeSet.name)} • Click to edit |
| 293 | attr:title | en | Metadata: ${tagCount} tags attached • Click to edit |
| 305 | attr:alt | en | Cover |
| 313, 504 | attr:title | sin determinar | ${escAttr(aiStatus.tooltip)} |
| 332 | html | en | MODEL GENERATOR |
| 333 | html | en | GLOBAL MODEL SETTINGS |
| 340 | attr:title | sin determinar | Abrir Asistente Guiado en 4 pasos (1 Material → 2 Limpiar → 3 Cortar y mapear → 4 Generar y exportar) |
| 364 | attr:title | sin determinar | Collapse to Icon Rail |
| 365 | attr:aria-label | sin determinar | Collapse to Icon Rail |
| 382 | html | en | GENERATE NEURON MODEL |
| 392 | attr:title | en | Click to edit Model Name and Slot |
| 395, 414, 442, 470 | html | en | Edit |
| 411 | attr:title | en | Click to edit Engine and Complexity |
| 419 | html | en | Format: |
| 423 | html | sin determinar | DSP: |
| 427 | html | sin determinar | Modes: |
| 439 | attr:title | en | Click to view or edit Metadata & Tags |
| 450 | html | sin determinar | Author: |
| 451 | html | sin determinar | v: |
| 452 | html | sin determinar | Lic: |
| 455 | html | sin determinar | No author/license defined yet. |
| 465 | attr:title | en | Click to view or edit Cover Artwork |
| 469 | attr:title | en | Generate Cover with AI (Fase 20) |
| 480 | html | en | Converting Artwork... |
| 486 | attr:alt | en | Model Cover |
| 488 | html | técnico/sin marcas | 512×512 WebP Attached |
| 489 | html | sin determinar | ABDAxionikVS &amp; Sampler HD |
| 495 | html | en | No cover image attached. |
| 507 | html | en | Settings |
### `src/ui/RawSamplerExportModal.ts` (42 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 127 | prop:label | en | SoundFont 2 (.sf2) |
| 128 | prop:label | en | SFZ Format (.sfz) |
| 129 | prop:label | técnico/sin marcas | Decent Sampler (.dspreset) |
| 130 | prop:label | sin determinar | Akai MPC Program (.xpm) |
| 131 | prop:label | sin determinar | Akai MPC Expansion (.xpn) |
| 132 | prop:label | técnico/sin marcas | Ableton Sampler (.adv) |
| 133 | prop:label | sin determinar | Apple Logic EXS24 (.exs) |
| 134 | prop:label | técnico/sin marcas | TAL-Sampler (.talsmpl) |
| 135 | prop:label | técnico/sin marcas | CWITEC TX16Wx (.txprog) |
| 136 | prop:label | técnico/sin marcas | Korg Trinity/Triton (.KMP) |
| 137 | prop:label | sin determinar | MMA Downloadable Sounds (.dls) |
| 138 | prop:label | en | Bitwig Studio (.multisample) |
| 139 | prop:label | técnico/sin marcas | Kontakt (.nki XML) |
| 140 | prop:label | técnico/sin marcas | HALion (.vstpreset) |
| 141 | prop:label | en | Linear Sample Chain (.wav) |
| 145 | attr:aria-label | sin determinar | Exportar banco a formato sampler |
| 150 | html | en | Universal Raw Multi-Format Sampler Exporter |
| 151 | html | es | Muestras y zonas originales sin transformación (Fase 16) |
| 154 | attr:title | es | Cerrar (Esc) |
| 154 | attr:aria-label | es | Cerrar |
| 160 | html | sin determinar | Formato de Sampler Destino |
| 176 | html | es | Configuración de Audio |
| 178 | html | es | Resolución de Bits: |
| 181 | html | en | 16-bit PCM (Compatibilidad Universal / SF2) |
| 182 | html | mixto | 24-bit PCM (Alta Definición Master) |
| 186 | html | sin determinar | Frecuencia de Muestreo: |
| 189 | html | técnico/sin marcas | 44.100 Hz (CD Audio Standard) |
| 190 | html | en | 48.000 Hz (Broadcast / Pro Studio) |
| 191 | html | en | 96.000 Hz (Master Wave High-Res) |
| 195 | html | es | Normalización de Pico: |
| 198 | html | en | Normalizar a 0 dBFS Peak |
| 199 | html | en | Normalizar a -0.3 dBFS True-Peak |
| 203 | html | sin determinar | Estructura de Empaquetado: |
| 205 | html | mixto | Carpeta Samples/ + Definición (.zip) |
| 206 | html | es | Monolítico (Directo en formato destino) |
| 212 | html | mixto | Nombre del Banco / Preset: |
| 216 | html | sin determinar | Autor: |
| 220 | html | sin determinar | Licencia: |
| 242 | html | sin determinar | Modo: |
| 242 | html | es | \| Salida: |
| 358 | toast | en | Exported ${result.filename} (${kbSize} KB) successfully. |
| 367 | toast | en | Export failed: ${msg} |
### `src/ui/SettingsModal.ts` (171 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 212 | attr:aria-label | en | General Settings and AI Engine Configuration |
| 217 | html | en | SETTINGS &amp; AI ENGINE |
| 222 | attr:title | en | Close (Esc) |
| 232 | html | técnico/sin marcas | General |
| 233 | html | en | Themes, Mode &amp; Paths |
| 239 | html | técnico/sin marcas | IA |
| 240 | html | en | Web Engine, Cloud BYOK &amp; Local GPU |
| 253 | html | técnico/sin marcas | Built-in Web Engine |
| 254 | html | en | In-Browser (100% Free) |
| 260 | html | en | Companion Bridge |
| 261 | html | técnico/sin marcas | Local GPU (VRAM) |
| 267 | html | en | Cloud AI (BYOK) |
| 268 | html | en | Private User Keys |
| 295 | html | en | Close |
| 296 | html | en | Apply Settings |
| 328 | html | en | Personalize the application aesthetic inspired by legendary hardware. |
| 334 | attr:title | sin determinar | ${escAttr(s.desc)} |
| 346 | html | en | Appearance Mode: |
| 362 | html | en | Configure paths to your local libraries to synchronize with the Companion Bridge. |
| 369 | html | en | AxionikDB Library (Advanced / Time-Capsule) |
| 370 | html | en | Models with semantic slugs and self-contained Time Capsules ( |
| 370 | html | en | cover.webp |
| 373 | attr:placeholder | sin determinar | ${escAttr(DEFAULT_AXIONIK_DB_PATH)} |
| 383 | html | en | NeuronDB Library (Classic / Hartmann 000..511) |
| 384 | html | en | Banks compatible with Hartmann Neuron hardware &amp; classic software. |
| 387 | attr:placeholder | sin determinar | ${escAttr(DEFAULT_NEURON_DB_PATH)} |
| 397 | html | en | SoundFonts &amp; Raw Sample Collection |
| 401 | attr:placeholder | sin determinar | ${escAttr(DEFAULT_BANK_PATH)} |
| 411 | html | en | bridge/server.py |
| 427 | html | en | Persistent browser storage for audio buffers, time capsules, and models. |
| 435 | html | en | IndexedDB Storage: |
| 441 | html | en | Storage Healthy |
| 447 | html | en | Storage quota estimation available in standard browser sessions. |
| 462 | html | en | Models detected in AxionikDB: |
| 492 | html | en | Files found in NeuronDB ( |
| 517 | html | en | Files found in |
| 583 | html | en | Enable AI Assistance |
| 591 | html | en | Quick Presets: |
| 592 | attr:title | en | Pure deterministic classic math algorithms (fast and reproducible) |
| 598 | attr:title | en | All processing stages AI-assisted |
| 601 | attr:title | en | Custom configuration (non-standard combination of stages) |
| 615 | html | en | Browser Hardware Acceleration |
| 620 | html | técnico/sin marcas | 0 Servers |
| 620, 620 | html | sin determinar | &bull; |
| 620 | html | técnico/sin marcas | 0 Cost |
| 620 | html | técnico/sin marcas | 100% Client-Side Private |
| 631 | html | en | High-fidelity sample rate conversion and upper harmonic reconstruction. |
| 639 | html | sin determinar | Linear polyphase sinc + harmonic saturator. Zero network artifacts, phase-coherent. |
| 646 | html | en | Latent diffusion generating realistic ultra-high harmonics up to 48 kHz Nyquist. |
| 657 | html | en | Source Separation &amp; De-Bleeding |
| 658 | html | en | Isolate the solo instrument if the recording contains background bleeding or room noise. |
| 666 | html | en | Harmonic/percussive separation via median filtering on the STFT spectrogram. |
| 673 | html | en | Surgical stem isolation via residual convolutional neural network. |
| 680 | html | en | Do not separate; use original sample as recorded. |
| 691 | html | en | Organic Short Loop Expansion |
| 692 | html | en | Unroll short loops to create natural, non-cyclic sustain without buzzing. |
| 700 | html | en | Periodic phase modulation and equal-power crossfading at zero crossings. |
| 707 | html | en | Generative autoregressive continuation for natural timbral sustain. |
| 718 | html | en | Parameter Set &amp; Acoustic Classifier |
| 719 | html | en | Automatic selection of Parameter Set 0..9 and instrument family tagging. |
| 727 | html | en | Log attack, inharmonicity B, spectral centroid, and zero-crossing rate. |
| 734 | html | en | Deep timbral acoustic embeddings recognition in WebGPU. |
| 741 | html | en | Manually select Parameter Set 0..9 on the main process panel. |
| 752 | html | en | Noise Reduction &amp; Audio Restoration |
| 753 | html | en | Suppression of analog tape hiss and background ambient noise from vintage recordings. |
| 761 | html | en | Static noise-floor attenuation without altering musical phase. |
| 768 | html | en | Adaptive neural filtering preserving subtle instrument harmonics. |
| 775 | html | en | Keep raw recording intact without applying any noise suppression. |
| 808 | prop:label | en | Obtain Replicate API Token |
| 813 | prop:label | en | Obtain Hugging Face User Token |
| 818 | prop:label | en | Get Google AI Studio API Key |
| 823 | prop:label | en | Get OpenAI API Key |
| 828 | prop:label | en | Get Anthropic Claude API Key |
| 833 | prop:label | en | Get OpenRouter API Key |
| 838 | prop:label | en | Get DeepSeek API Key |
| 843 | prop:label | en | Get Groq API Key |
| 848 | prop:label | en | Get Mistral API Key |
| 853 | prop:label | en | Obtain API Token |
| 863 | html | sin determinar | Strict Privacy &amp; Zero Server Cost Guarantee |
| 864 | html | en | Your API keys are stored |
| 865 | html | en | solely and exclusively in your local browser (localStorage) |
| 877 | html | en | Enable Cloud AI (BYOK) |
| 885 | html | en | Preferred Cloud Provider: |
| 890 | html | técnico/sin marcas | Anthropic Claude |
| 891 | html | sin determinar | Sonnet &amp; Haiku |
| 893 | html | en | Deep acoustic reasoning, timbre characterization &amp; prompt synthesis. |
| 898 | html | técnico/sin marcas | OpenRouter |
| 899 | html | en | Multi-Model |
| 901 | html | en | Universal gateway to FLUX.1, Claude, GPT-4o, Llama-3 &amp; open models. |
| 906 | html | técnico/sin marcas | OpenAI / ChatGPT |
| 907 | html | sin determinar | GPT-4o &amp; DALL-E |
| 909 | html | en | Neural album artwork, structured metadata &amp; timbre tagging. |
| 914 | html | técnico/sin marcas | Google Gemini |
| 915 | html | sin determinar | Flash &amp; Imagen 3 |
| 917 | html | en | Multimodal spectral analysis, reasoning &amp; Imagen 3 artwork. |
| 922 | html | técnico/sin marcas | Groq (LPU Speed) |
| 923 | html | en | LPU Real-time |
| 925 | html | en | Ultra-fast token inference for instant prompt refinement. |
| 930 | html | técnico/sin marcas | DeepSeek |
| 931 | html | técnico/sin marcas | R1 Reasoning |
| 933 | html | sin determinar | DeepSeek-V3 &amp; R1 deep reasoning for timbre analysis. |
| 938 | html | técnico/sin marcas | Mistral AI |
| 939 | html | técnico/sin marcas | European AI |
| 946 | html | en | Replicate |
| 947 | html | técnico/sin marcas | AudioSR GPU |
| 949 | html | en | Best for AudioSR (96kHz Super-Resolution) and MusicGen models. |
| 954 | html | en | Hugging Face |
| 955 | html | técnico/sin marcas | Serverless |
| 957 | html | en | Access to open checkpoints and serverless accelerated inference. |
| 972 | attr:placeholder | en | Enter your personal key (e.g. sk-... / r8_... / hf_... / AIzaSy...) |
| 977 | attr:title | en | Show / hide key |
| 984 | attr:title | en | Clear key from local browser storage |
| 1037 | html | en | Local Endpoint: |
| 1041 | html | sin determinar | Compute Device: |
| 1045 | html | sin determinar | GPU Acceleration: |
| 1049 | html | en | Loopback Latency: |
| 1062 | html | en | start.bat (Launches app and companion bridge) or: python bridge/server.py |
| 1079 | html | en | Bridge Endpoint URL: |
| 1092 | html | en | Save &amp; Reconnect |
| 1096 | html | en | Bridge Token (X-Bridge-Token): |
| 1103 | attr:placeholder | mixto | Token impreso por bridge/server.py (vacío = sin auth) |
| 1109 | html | en | Clear |
| 1109 | attr:title | en | Clear token from local browser storage |
| 1111 | html | es | Se envía como cabecera |
| 1111 | html | en | X-Bridge-Token |
| 1111 | html | técnico/sin marcas | ABD_BRIDGE_TOKEN |
| 1119 | html | en | Local Neural Model Catalog |
| 1120 | html | en | Transparent multithreaded model pre-download directly to your local GPU. |
| 1123 | html | en | (Note: Models are also downloaded automatically on first demand if not pre-fetched here). |
| 1142 | html | en | Connect the local Companion Bridge to manage, download, or uninstall GPU neural models. |
| 1150 | html | en | Loading catalog of available models... |
| 1177 | html | en | Custom Mirror |
| 1177 | attr:title | en | Custom download mirror in use |
| 1196 | html | en | Model Download URL: |
| 1199 | html | técnico/sin marcas | Check URL |
| 1199 | attr:title | en | Check if URL is reachable and valid |
| 1200 | html | en | Save |
| 1201 | html | en | Reset to Official |
| 1202 | html | en | Cancel |
| 1215, 1224, 1233 | attr:title | técnico/sin marcas | Configure Download URL / Mirror |
| 1218 | attr:title | en | Delete this model from local disk to free space |
| 1291 | toast | en | Settings saved and applied successfully |
| 1364 | toast | en | AxionikDB scanned: ${this.axionikScanResults.length} models found |
| 1366 | toast | técnico/sin marcas | Error scanning AxionikDB: ${String(err)} |
| 1385 | toast | en | NeuronDB scanned: ${this.neuronDbScanResults.total_files} files found |
| 1387 | toast | sin determinar | Error scanning NeuronDB: ${String(err)} |
| 1407 | toast | en | Scan complete: ${this.scanResults.total_files} files found |
| 1409 | toast | sin determinar | Error scanning directory: ${String(err)} |
| 1439 | toast | en | Preset applied: 100% Deterministic Algorithmic DSP |
| 1452 | toast | en | Preset applied: Optimal Hybrid (Sinc DSP + AI Outpainting/Denoise) |
| 1465 | toast | en | Preset applied: Maximum Quality AI-Assisted (5/5 stages) |
| 1562 | toast | en | Keys cleared from local browser storage |
| 1574, 1586 | toast | en | Bridge endpoint saved. Reconnecting… |
| 1576, 1588 | toast | en | Invalid bridge URL: ${String(err)} |
| 1596 | toast | en | Bridge token saved locally |
| 1601 | toast | en | Bridge token cleared |
| 1605 | toast | en | Checking Companion Bridge connection... |
| 1644 | toast | sin determinar | Error initiating download: ${String(err)} |
| 1670 | toast | en | Model uninstalled: ${res.freed_mb ?? 0} MB freed on disk |
| 1673 | toast | en | Error uninstalling model: ${String(err)} |
| 1698 | toast | en | Please enter a URL to check |
| 1703 | textContent | técnico/sin marcas | Checking... |
| 1709 | textContent | técnico/sin marcas | Contacting server... |
| 1731 | textContent | sin determinar | ✗ Error: ${String(err)} |
| 1733 | toast | técnico/sin marcas | Error checking URL: ${String(err)} |
| 1752 | toast | en | Model URL updated successfully |
| 1754 | toast | técnico/sin marcas | Error updating URL: ${String(err)} |
| 1768 | toast | en | URL reset to official repository mirror |
| 1770 | toast | técnico/sin marcas | Error resetting URL: ${String(err)} |
| 1813 | toast | en | Model "${model.name}" downloaded and ready on GPU |
| 1816 | toast | en | Download failed for "${model.name}": ${prog.error ?? 'Network error'} |
### `src/ui/SpectralView.ts` (22 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 129 | html | en | Select a zone to inspect its 2D spectrogram and neural partial layers |
| 153 | attr:title | sin determinar | ${escAttr(sampleName)} |
| 155 | attr:title | sin determinar | ${summary.gridNotice} |
| 160 | attr:title | en | Objective Resynthesis Quality Score (Cosine Similarity + Envelope Correlation + Residual SNR) |
| 168 | html | técnico/sin marcas | 2D SPECTROGRAM |
| 171 | html | técnico/sin marcas | 64 PARTIALS |
| 174 | html | técnico/sin marcas | WAVEFORM A/B/C |
| 177 | html | en | LOG CURVE |
| 177 | attr:title | en | ABDShared SpectrumPlotter (20 Hz..20 kHz Target vs Model vs Residual) |
| 188 | html | técnico/sin marcas | L1 Harmonic |
| 189 | html | en | L2 Sub/Crest |
| 190 | html | técnico/sin marcas | L3 Transient |
| 199 | html | en | Hover graph to inspect frequency, partial &amp; layer |
| 216 | attr:title | en | Stop Playback [Space] |
| 223 | html | sin determinar | A: ORIGINAL |
| 226 | html | sin determinar | B: LEGACY |
| 229 | html | sin determinar | C: ENHANCED |
| 235 | html | técnico/sin marcas | OUT |
| 239 | html | técnico/sin marcas | -96.0 dB |
| 344 | textContent | en | Hover graph to inspect frequency, partial & layer |
| 475 | textContent | técnico/sin marcas | -96.0 dB |
| 480 | textContent | técnico/sin marcas | ${rmsDb.toFixed(1)} dB |
### `src/ui/TelemetryDrawer.ts` (14 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 30 | html | en | TELEMETRY & MIDI COVERAGE AUDIT |
| 32 | attr:title | en | Close Drawer |
| 40 | html | técnico/sin marcas | ENGINE EVENT STREAM |
| 42 | html | en | [00:00:00] ABDNeuModMakr session engine initialized. |
| 70 | html | técnico/sin marcas | 128-NOTE MIDI COVERAGE MAP (0..127): |
| 77 | html | en | ZONES |
| 81 | html | en | SAMPLES ASSIGNED |
| 85 | html | técnico/sin marcas | MIDI NOTES |
| 91 | html | sin determinar | Errors requiring attention: |
| 94 | attr:title | en | Automatically sort zones, close gaps/overlaps across 0..127, and clamp root keys |
| 100 | html | en | All 128 MIDI note slots are partitioned continuously with no gaps or overlaps. Session is ready for Model Maker processing. |
| 121 | attr:title | técnico/sin marcas | 128-Note MIDI Coverage Mini-Map (0..127) |
| 130 | attr:title | en | ${title} |
| 173 | textContent | en | [${time}] ${message} |
### `src/ui/UniversalImportModal.ts` (19 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 144 | html | en | Universal Smart Import |
| 147 | attr:aria-label | en | Close |
| 159 | html | es | Analizando descriptores de zonas, capas de velocidad, cobertura de teclado y muestras de audio. |
| 231 | html | en | Drag &amp; Drop Audio, Bank or Slice Files Here |
| 232 | html | sin determinar | Supported formats: |
| 244 | html | en | Multisample Banks &amp; Disks: |
| 245 | html | en | Loops &amp; Slices: |
| 246 | html | técnico/sin marcas | Raw Audio: |
| 269 | html | en | Target Model: |
| 274 | html | en | Zones |
| 278 | html | en | Key Range |
| 282 | html | en | Vel Layers |
| 286 | html | en | Samples |
| 300 | html | es | Ajustes de adaptación al importar |
| 305 | html | es | Extender automáticamente las zonas extremas hasta MIDI 0 y 127 |
| 306 | html | es | Estira los límites de la zona más grave y más aguda para cubrir todo el teclado sin huecos en la resíntesis. |
| 314 | html | es | Pliega instrumentos multicapa en las muestras más suave y más fuerte con compensación automática de ganancia. |
| 322 | html | es | Activa regiones 2D ilimitadas, articulación completa y metadatos extendidos de Cápsula del Tiempo. |
| 653 | toast | en | Successfully imported ${this.parsedPreset.formatLabel}: "${this.parsedPreset.presetName}" (${adapted.classicZones.length} zones). |
### `src/ui/ZoneInspector.ts` (103 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 292, 363 | html | técnico/sin marcas | r.lowKey |
| 427 | textContent | sin determinar | Vel ${activeRegion.lowVel}..${activeRegion.highVel} (${spanSteps}) |
| 552 | html | en | No zone selected |
| 588 | attr:title | en | ${drumCollisionReport.totalCollisions} GM Drum collision(s) detected across regions |
| 597, 701 | html | en | KEY MAP: |
| 598, 702 | attr:title | en | Standard Chromatic Keyboard Mapping (Piano / Synth pitch scale C-2..G8) |
| 606 | attr:title | en | Open Interactive Waveform Loop Editor &amp; Zero-Crossing Seam Magnifier for Region #${activeIndex + 1} |
| 609 | attr:title | mixto | AutoLoop en todas las zonas (zc-snap): calcula y aplica puntos de bucle por cruce por cero en todas las regiones |
| 624 | attr:title | en | Open Model Configuration &amp; Global Properties |
| 630 | attr:title | en | Remove selected Sampler Region |
| 635, 636 | attr:aria-label | en | Extended 2D Sampler Regions Table |
| 639 | html | en | Region |
| 639 | attr:title | en | Sampler Region Index |
| 640, 741 | html | en | Low Key |
| 640 | attr:title | en | Region Start MIDI Note (0..127) |
| 642, 743 | html | en | High Key |
| 642 | attr:title | en | Region End MIDI Note (0..127) |
| 643, 744 | html | técnico/sin marcas | Low Vel |
| 643 | attr:title | en | Start Velocity (1..127) |
| 644, 745 | html | técnico/sin marcas | High Vel |
| 644 | attr:title | en | End Velocity (1..127) |
| 645 | html | en | Sample |
| 645 | attr:title | en | Assigned Audio Sample for this Region |
| 646 | html | en | Mode / Loop |
| 646 | attr:title | en | Click any cell to open the Interactive Waveform Loop Editor |
| 647, 746 | html | en | Detune |
| 647 | attr:title | en | Fine Pitch Detune (-99..+99 cents) |
| 648, 747 | html | técnico/sin marcas | Volume |
| 648 | attr:title | en | Region Gain (-32..+12 dB) |
| 649, 748 | html | técnico/sin marcas | Pan |
| 649 | attr:title | en | Stereo Pan (-50..+50) |
| 650, 749 | html | técnico/sin marcas | Act |
| 650 | attr:title | en | Audition / Edit Region Metadata &amp; Exceptions Drawer |
| 692 | attr:title | en | ${drumCollisionReport.totalCollisions} GM Drum collision(s) detected across zones |
| 710 | attr:title | en | Open Interactive Waveform Loop Editor &amp; Zero-Crossing Seam Magnifier for Zone #${this.zoneIndex + 1} |
| 713 | attr:title | mixto | AutoLoop en todas las zonas (zc-snap): calcula y aplica puntos de bucle por cruce por cero en todas las zonas |
| 725 | attr:title | en | Open Right Drawer to Edit Zone #${this.zoneIndex + 1} Metadata |
| 731 | attr:title | en | Remove Zone and merge boundaries (Shortcut: Delete) |
| 736, 737 | attr:aria-label | en | Canonical Hartmann Key Zone Table |
| 740 | html | en | Zone |
| 749 | attr:title | en | Audition / Edit Zone Metadata Drawer |
| 839 | html | en | GM Drum Collision Detected! |
| 840 | html | en | Drum piece |
| 850 | html | en | -- Select Loaded Sample -- |
| 857 | html | en | -- None (Low Vel covers 1..127) -- |
| 899 | attr:title | en | Sample Technical Specifications |
| 901 | html | en | FILE SIZE |
| 905 | html | técnico/sin marcas | CHANNELS |
| 909 | html | técnico/sin marcas | RESOLUTION |
| 913 | html | en | SAMPLE RATE |
| 917 | html | técnico/sin marcas | DURATION |
| 921 | html | en | LOOP RANGE |
| 949 | html | en | 2D Key &amp; Velocity Intersection Detected |
| 950 | html | en | This region overlaps in both key range and velocity with |
| 960 | html | en | Key Range Overlap Detected |
| 961 | html | en | This zone overlaps with |
| 977 | attr:title | en | Close Metadata Drawer |
| 990 | attr:title | en | Auto-detect root note (YIN/MPM + HPS) and optimal Parameter Set (0..9) from audio signal |
| 1014 | html | en | LOW KEY |
| 1016 | attr:title | en | First zone always starts at 0 C-2 in Classic Mode |
| 1030 | html | en | HIGH KEY |
| 1032 | attr:title | en | Last zone always ends at 127 G8 in Classic Mode |
| 1042 | html | en | LOW VEL (START 1..127) |
| 1044 | attr:title | en | Region Start Velocity (1..127) |
| 1045 | html | en | Start |
| 1050 | html | sin determinar | HIGH VEL (END 1..127) |
| 1052 | attr:title | en | Region End Velocity (1..127) |
| 1053 | html | técnico/sin marcas | End |
| 1058 | html | en | VELOCITY SPAN |
| 1074 | html | en | REGION SAMPLE ASSIGNMENT (1 SAMPLE PER 2D REGION) |
| 1081, 1111 | attr:title | en | Open AutoSlicer for this sample |
| 1082, 1112 | attr:title | en | Open Interactive Waveform Loop Editor for this sample |
| 1083, 1113 | attr:title | en | Open Audio Recorder &amp; Noise Print Capture |
| 1084 | attr:title | en | Audition Region Sample |
| 1088 | attr:title | en | Select an already-loaded sample from session memory |
| 1094 | attr:title | en | Clear Region Sample |
| 1104 | html | en | VELOCITY SAMPLE LAYERS (CANONICAL 1..63 / 64..127) |
| 1114 | attr:title | técnico/sin marcas | Audition Low Vel Audio |
| 1118, 1136 | attr:title | en | Select an already-loaded sample from session memory (reused without re-analyzing) |
| 1124 | attr:title | en | Clear Low Vel Sample |
| 1133 | attr:title | técnico/sin marcas | Audition High Vel Audio |
| 1142 | attr:title | en | Clear High Vel Sample |
| 1149 | html | en | VELOCITY SPLIT POINT |
| 1150 | html | en | 64 (Fixed: 1–63 / 64–127) |
| 1152 | attr:title | en | Classic Mode strictly uses the Hartmann MODELmaker v1.2 fixed velocity split (Low Vel 1..63 / High Vel 64..127). Switch WORKING MODE → Extended for free per-region start/end velocities. |
| 1166 | attr:title | en | Fine Detune (-99 .. +99 cents). Double-click knob to reset to 0. |
| 1169 | html | en | DETUNE (-99..+99) |
| 1172 | attr:title | en | Volume (-32dB .. +12dB). Double-click knob to reset to 0dB. |
| 1175 | html | técnico/sin marcas | VOLUME (-32..+12dB) |
| 1178 | attr:title | en | Pan (-50 .. +50). Double-click knob to reset to Center (0). |
| 1181 | html | técnico/sin marcas | PAN (-50..+50) |
| 1188 | html | técnico/sin marcas | INTERACTIVE AUDIO EDITORS |
| 1190 | attr:title | en | Open Interactive Waveform Loop Editor &amp; Zero-Crossing Seam Magnifier Modal |
| 1193 | attr:title | en | Open Audio Chopper &amp; Multi-Layer Auto-Slicer Modal |
| 1196 | attr:title | en | Open Audio Recorder &amp; Noise Print Capture Modal |
| 1204 | html | en | MEJORAR A MASTER WAVE (24-BIT / 96 KHZ) |
| 1208 | attr:title | mixto | Promover la muestra de esta región a 24-bit / 96 kHz Master Wave con expansión de bucle por cruce por cero |
| 1211 | attr:title | mixto | Promover la muestra de esta zona a 24-bit / 96 kHz Master Wave con expansión de bucle por cruce por cero |
| 1215 | attr:title | mixto | Promover todas las zonas con muestra a 24-bit / 96 kHz Master Wave (sobre las notas ya partidas y mapeadas) |
| 1366 | confirmDialog | en | Remove zone #${this.zoneIndex + 1} (${midiNoteToString(z.lowKey)} .. ${midiNoteToString(z.highKey)})? Adjacent zones will expand to maintain 0..127 coverage. |
| 1766 | prop:label | en | DETUNE |
| 1796 | prop:label | técnico/sin marcas | VOLUME |
| 1826 | prop:label | técnico/sin marcas | PAN |
### `src/ui/zoneInspector/zoneTemplates.ts` (162 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 140 | html | técnico/sin marcas | z.lowKey |
| 205, 207, 310, 312 | attr:title | sin determinar | ${escAttr(drumCollisionTip)} |
| 206, 208 | attr:title | sin determinar | ${overlapTip} |
| 303 | html | técnico/sin marcas | OVR |
| 303 | attr:title | en | Custom Exception active in Region #${idx + 1} (overrides Model Common settings) |
| 310 | attr:title | sin determinar | ${fullIntersectTip} |
| 310 | attr:title | sin determinar | ${keySplitTip} |
| 463 | html | en | INTERACTIVE WAVEFORM LOOP EDITOR &amp; ZERO-CROSSING SEAM MAGNIFIER |
| 464 | attr:title | en | Current Sample Audio Format |
| 469 | attr:title | en | Snap dragged L-START / L-END handles to nearest rising zero-crossing |
| 472 | attr:title | en | Select Auto-Loop Algorithm |
| 474 | html | técnico/sin marcas | F0 Period-Lock |
| 475 | html | técnico/sin marcas | NCC Zero-Crossing |
| 476 | html | técnico/sin marcas | Min Seam Discontinuity |
| 477 | html | en | Equal-Power X-Fade |
| 480 | attr:title | en | Automatically find optimal click-free loop points using the selected algorithm |
| 483 | html | en | Zoom + |
| 483 | attr:title | en | Zoom In Waveform around Loop Region |
| 486 | html | en | Zoom - |
| 486 | attr:title | en | Zoom Out Waveform |
| 489 | html | técnico/sin marcas | 1x |
| 489 | attr:title | en | Reset Waveform Zoom (1x) |
| 492 | attr:title | en | Audition sample in continuous hardware loop (updates live while dragging L-START / L-END) |
| 499 | html | técnico/sin marcas | Drag |
| 500 | html | en | L-START |
| 500 | html | técnico/sin marcas | or |
| 500 | html | técnico/sin marcas | L-END |
| 500 | html | en | handles (or double-click waveform) • Right pane shows |
| 500 | html | técnico/sin marcas | Zero-Crossing Seam Magnifier |
| 500 | html | en | (±64 samples) |
| 507 | html | en | LOOP START (FRAMES) |
| 514 | html | en | LOOP END (FRAMES) |
| 521 | html | en | LOOP XFADE (MS) |
| 522 | html | técnico/sin marcas | Equal-Power |
| 530 | html | en | KEY XFADE IN / OUT (SEMITONES) |
| 532 | attr:title | en | Key Crossfade In (semitones) |
| 533 | attr:title | en | Key Crossfade Out (semitones) |
| 537 | html | en | VEL XFADE IN / OUT (VELOCITY UNITS) |
| 539 | attr:title | en | Velocity Crossfade In |
| 540 | attr:title | en | Velocity Crossfade Out |
| 563 | attr:title | en | Enable custom Loop Mode, Keytrack, Trigger &amp; XFade Curve exception for this region |
| 565 | html | en | Custom Exception |
| 567 | html | en | Edit Common &rarr; |
| 567 | attr:title | en | Edit Model Common Playback Defaults for all regions |
| 575 | html | en | LOOP MODE |
| 577, 859 | html | en | No Loop |
| 578, 860 | html | técnico/sin marcas | Continuous (Forward) |
| 579, 861 | html | sin determinar | Ping-Pong (⇄ Alternating) |
| 580, 862 | html | en | Sustain Loop |
| 581, 863 | html | en | Reverse Loop |
| 582, 864 | html | técnico/sin marcas | One Shot |
| 586 | html | en | KEYTRACK (%) |
| 590 | html | técnico/sin marcas | TRIGGER |
| 592, 874 | html | en | Attack |
| 593, 875 | html | en | Release |
| 594, 876 | html | técnico/sin marcas | First Note |
| 595, 877 | html | técnico/sin marcas | Legato |
| 599 | html | en | XFADE CURVE |
| 601, 883 | html | técnico/sin marcas | Equal Power |
| 602, 884 | html | técnico/sin marcas | Linear |
| 603, 885 | html | en | Spectral Morph |
| 627 | attr:title | en | Override ADSR Envelope &amp; Filter Cutoff/Reso specifically for this region |
| 629 | html | en | Custom ADSR / Filter |
| 631 | html | en | Edit Global &rarr; |
| 631 | attr:title | en | Open Global Instrument Articulation |
| 642, 918 | html | en | ATTACK (S) |
| 646, 922 | html | en | DECAY (S) |
| 650, 926 | html | en | SUSTAIN (0..1) |
| 654, 930 | html | en | RELEASE (S) |
| 660 | html | en | REGION FILTER CUTOFF (HZ) |
| 664 | html | en | REGION FILTER RESO (DB) |
| 677 | html | en | SAMPLE ACOUSTIC INTELLIGENCE &amp; 24/96 PROMOTION |
| 679 | attr:title | en | Promote this sample to 24-bit / 96.000 Hz Master Wave using the Model Common 24/96 standard |
| 682 | attr:title | en | Run YIN/MPM + HPS Pitch Detection &amp; Acoustic Parameter Set Classifier |
| 689 | html | en | INSTRUMENT CATEGORY |
| 693 | html | en | RECOMMENDED SET |
| 697 | html | en | DETECTED PITCH (F0) |
| 701 | html | en | HARMONICITY / TYPE |
| 705 | html | en | ATTACK / SUSTAIN |
| 709 | html | sin determinar | STIFFNESS (B) / CENTROID |
| 760 | prop:label | en | 01 Raw Source |
| 761 | prop:label | técnico/sin marcas | 02 Legacy Orig |
| 762 | prop:label | en | 03 Master 24/96 |
| 763 | prop:label | en | 04 Classic Enh |
| 764 | prop:label | en | 05 Extended Mod |
| 779 | attr:aria-label | en | Model Common &amp; Global Subsections |
| 786 | attr:title | en | Common Playback Defaults replicated across all regions unless a region enables Custom Exception |
| 788 | html | técnico/sin marcas | Common Playback |
| 798 | html | en | Instrument Articulation |
| 806 | attr:title | en | Model-Wide Master Wave 24-bit / 96 kHz Promotion Standard, Loop Expansion &amp; Quad Surround |
| 808 | html | en | Master 24/96 Standard |
| 816 | attr:title | en | 5-Layer Time Capsule Container &amp; Zero Generation-Loss Lineage |
| 818 | html | en | Time Capsule |
| 826 | attr:title | en | Extended Model Metadata, Licensing, Provenance &amp; Custom Tags for ABDAxionikVS |
| 828 | html | sin determinar | Metadata &amp; Tags |
| 829 | html | técnico/sin marcas | TAGS |
| 837 | html | en | COMMON PLAYBACK DEFAULTS (REPLICATED TO ALL REGIONS) |
| 844 | html | en | Changes here automatically apply to all regions except those marked with a custom exception (OVR). |
| 849 | attr:title | en | Clear all regional playback exceptions so every region inherits Model Common |
| 857 | html | en | DEFAULT LOOP MODE |
| 868 | html | en | DEFAULT KEYTRACK (%) |
| 872 | html | en | DEFAULT TRIGGER |
| 881 | html | en | DEFAULT XFADE CURVE |
| 911 | attr:title | en | Bake amplitude decay contour into classic wave before analysis |
| 913 | html | técnico/sin marcas | Bake ADSR |
| 941 | html | en | Export Filter (Silver Filter Cutoff / Reso / Env) |
| 946 | html | en | TYPE |
| 948 | html | técnico/sin marcas | LPF (Low-Pass) |
| 949 | html | técnico/sin marcas | BPF (Band-Pass) |
| 950 | html | técnico/sin marcas | HPF (High-Pass) |
| 954 | html | en | CUTOFF (HZ) |
| 958 | html | técnico/sin marcas | RESO (DB) |
| 967 | attr:title | en | Safe-mapped: Scape, Sphere & Blender LFO depths are explicitly locked to 0 so LFO never causes unwanted spectral morphing |
| 974 | html | en | RATE (HZ) |
| 978 | html | en | DELAY (S) |
| 982 | html | en | PITCH (CENTS) |
| 997 | attr:title | en | Current Selected Sample Format |
| 1002 | html | en | PROMOTION ENGINE (MODEL STANDARD) |
| 1002 | attr:title | en | Selects how audio is promoted to 24-bit / 96.000 Hz Master Wave across the instrument |
| 1004 | html | sin determinar | Direct (Sinc 96k / 24b) |
| 1005 | html | en | DSP Enhanced (BWE + DeNoise) |
| 1006 | html | en | AI Bridge (AudioSR/BigVGAN) |
| 1010 | html | técnico/sin marcas | SPATIAL CHANNELS |
| 1010 | attr:title | en | Preserve original channels or expand instrument to Stereo 2.0 or Quad Surround 4.0 |
| 1012 | html | técnico/sin marcas | Original Channels |
| 1013 | html | en | Stereo 2.0 (Mono-Safe) |
| 1014 | html | en | Quad Surround 4.0 (Neuron) |
| 1018 | html | en | MIN LOOP DURATION (S) |
| 1018 | attr:title | en | Unroll short SF2/WAV loops to X seconds with organic modulation & zero-crossing Auto-Loop Finder (0 = keep original length) |
| 1023 | attr:title | en | Harmonic Bandwidth Extension up to 42 kHz in 96 kHz Master Wave |
| 1025 | html | en | Ultrasonic BWE (42 kHz Air) |
| 1027 | attr:title | en | Suppress quantization floor noise from legacy 8/16-bit samples |
| 1029 | html | en | Quantization De-Noise Gate |
| 1032 | attr:title | en | Promote only the currently selected sample to 24-bit / 96.000 Hz Master Wave |
| 1035 | attr:title | en | Promote all samples in the model to 24-bit / 96.000 Hz Master Wave |
| 1049 | attr:title | en | NeuronAssetStore Persistence Status |
| 1054 | html | en | PUREST ORIGIN LAYER |
| 1055 | attr:title | sin determinar | ${primaryLabel} |
| 1058 | html | en | ACTIVE ANALYSIS INPUT |
| 1059 | attr:title | sin determinar | ${activeLabel} |
| 1062 | html | técnico/sin marcas | REPROCESS PASSES |
| 1067 | html | en | CONTAINER LAYERS (01 .. 05) |
| 1085 | html | en | Zero Generation-Loss Lineage Active |
| 1085 | attr:title | en | Guarantees re-analysis always pulls from 01_raw_source or 02_legacy_original, never re-compressing 04_classic_enhanced |
| 1089 | attr:title | en | Re-analyze all zones strictly from purest origin layer (01_raw_source or 02_legacy_original) with zero generation loss |
| 1092 | attr:title | en | Export 5-Layer Multi-Format Time Capsule (.zip) with manifest.json & provenance.json |
| 1123 | html | en | ★ Custom Tag... |
| 1143 | html | en | Layer 05 / AxionikDB |
| 1149 | html | en | Author / Creator |
| 1150 | attr:placeholder | en | Sound designer or creator name... |
| 1153 | html | en | Version |
| 1160 | html | técnico/sin marcas | License |
| 1161 | attr:placeholder | técnico/sin marcas | e.g. CC-BY 4.0, CC0, Commercial |
| 1164 | html | en | Source / Origin URL |
| 1167 | attr:title | en | Open URL in browser |
| 1173 | html | en | Description &amp; Performance Notes |
| 1174 | attr:placeholder | en | Acoustic characteristics, microphone placement, performance suggestions... |
| 1183 | attr:title | en | Add metadata tag (Standard SoundFont RIFF INFO or Custom tag) |
| 1191 | html | en | No tags defined. Click "+ Add Metadata Tag" to attach SoundFont RIFF INFO or studio attributes. |
| 1206 | attr:placeholder | en | Tag name (e.g. Mic) |
| 1209 | attr:title | en | Remove metadata tag |
| 1213 | attr:placeholder | sin determinar | ${escAttr(valPlaceholder)} |
### `src/ui/ZoneRibbon.ts` (22 cadenas)

| Línea(s) | Contexto | Idioma | Cadena |
|---|---|---|---|
| 248 | attr:title | en | Range/Velocity Intersection: Regions ${regListStr} overlap on Keys ${keyRangeStr}, Vel ${box.lowVel}..${box.highVel} |
| 263 | attr:title | en | Zone Key Overlap (${box.label}) on Keys ${midiToNoteName(box.lowKey)}..${midiToNoteName(box.highKey)} |
| 277 | attr:title | en | ${totalIntersections} range/velocity intersection(s) detected. Highlighted in the zone map below so you can verify whether layering is intentional. |
| 289 | attr:aria-label | en | Zone Waveform Display |
| 290 | html | sin determinar | WAVE: |
| 291 | html | sin determinar | A: Original |
| 291 | attr:title | en | Show Original Sample Waveform in Zone Map |
| 294 | html | sin determinar | B: Processed |
| 294 | attr:title | en | Generate or inspect model first to view Processed Resynthesis Waveform |
| 294 | attr:title | en | Show Processed Resynthesis Waveform in Zone Map |
| 302 | attr:title | en | MIDI Velocity Range (1..127) |
| 461 | html | sin determinar | \| null, classicOverlaps: Array |
| 487 | html | técnico/sin marcas | sp.lowKey |
| 507 | attr:title | sin determinar | ${highVelTitle} |
| 512 | attr:title | sin determinar | Split Point @ ${split} · Low: 1–${split - 1} \| High: ${split}–127 |
| 515 | attr:title | sin determinar | ${lowVelTitle} |
| 522 | attr:title | en | Full Velocity (1..127): ${lowLabel} |
| 524 | html | sin determinar | V 1–127 |
| 537 | attr:aria-label | en | Zone #${index + 1}: Keys ${lowStr} to ${highStr} |
| 539 | attr:title | sin determinar | ${zoneTitle} |
| 548 | attr:title | en | Root Key: ${rootStr} (${zone.rootKey}) |
| 550 | attr:title | en | Drag to move boundary between Zone #${index + 1} and Zone #${index + 2} |

*Generado automáticamente con `scripts/i18n-inventory.mjs` (heurística).*
