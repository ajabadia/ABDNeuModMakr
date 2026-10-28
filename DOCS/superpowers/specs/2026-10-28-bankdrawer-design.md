# Bank drawer: per-host tabs, full model load, ABDShared convergence

Date: 2026-10-28. Status: APPROVED by host (2026-10-28) with one change:
`Load` replaces `Select Slot` on model cards (no coexistence).
`onSelectModel(slot)` keeps its name and now means "host loads this
model" — the same serve-don't-apply contract as the synth, where the
host loads into its engine.

## Intent and the why

Today each WebUI carries its own bank-drawer fork, and neither one does
what its user expects:

- In ABDNeuModMakr the presets tab serves presets but the host could not
  load them; the interim fix warns instead of loading. The user wants the
  tab gone here (the synth keeps it) — each host chooses its tabs.
- In ABDNeuModMakr, selecting a Generated Model only switches the editor
  slot number. Name, zone layout, samples and config stay put. The user
  expects reading a model to restart everything, loading all its data —
  the way the NeuronDB modal import already does.
- There is no place showing the models of the selected library folder
  inside the drawer; that list only exists in the one-shot import modal.
- The user believes the drawer should live in ABDShared. It does not:
  ABDShared only provides the catalog CSS (`Assets/styles/components/
  catalog-browser.css`), the neuron format parsers (`Code/NeuronFormats`)
  and generic controls. Both drawers are independent forks.

Success looks like: one presentational drawer in ABDShared, configured
per host (NeuModMakr shows Models + Library, the synth shows Models +
Presets), full model load in NeuModMakr, and zero behavior change in
ABDAxionikVS.

## Goals

1. Each host declares which tabs its drawer shows; NeuModMakr hides
   presets, the synth keeps them.
2. Loading a Generated Model in NeuModMakr restores name, config, zone
   layout and playable (resynthesized) samples — a full session restart
   with undo support.
3. A Library tab lists the models of the configured folder and loads
   them through the existing import path.
4. A single drawer implementation in ABDShared; both projects consume it
   through thin adapters; forks deleted.

## Non-goals

- Integrating ABDBankManager (separate nested pnpm workspace, C++ core).
  The shared drawer stays UI-only so a future ABDBankManager core can
  plug underneath without touching hosts.
- Parsing preset parameter payloads (445 params stay display-only).
- Changing anything audible, anything in the DSP/export path, or any
  synth behavior, sound, or styling.

## Anti-goals (what would make this a failure)

- The synth looking, sounding, or behaving even slightly differently.
- A shared drawer so abstract that adding a tab requires touching three
  repos, or so coupled that hosts cannot decide what a selection means.
- Bank models that load structure but silently drop data (velSplit,
  missing binaries) without telling the user.

## Constraints (verified)

- Both projects resolve `@abdsynths/shared` via pnpm workspace symlink
  to the same directory (`/d/desarrollos/ABDSynths/ABDShared`). Edits
  there are instantly live in both; no publish step.
- Shared `exports` map already serves `./components/*` → `./Components/*`
  and TS sources (`./formats/neuron` → `.ts`). A TS drawer module works;
  both Vites transpile it today.
- The drawers mount differently: NeuModMakr constructs with
  `(container, handlers)` and owns show/hide classes; the synth
  constructs with `(drawerManager, handlers)` and the manager owns
  visibility (`open(tab, scope)`, `toggle(tab, scope)`). The shared
  drawer must not own mounting or visibility — the adapters do.
- `catalog-browser.css` (`.ndb-*`) is already the shared visual
  language; both drawers speak it. No new visual design in this project.
- Synth verification available: `vitest run` + `vite build` in
  ABDAxionikVS; NeuModMakr: `tsc`, `test:types`, 7-phase suite,
  `vite build`.

## Findings that shape the design

| Aspect | ABDNeuModMakr drawer (485 lines) | ABDAxionikVS drawer (~1300 lines) |
|---|---|---|
| Models tab data | Generated models (session bank: slot, name, zones, complexity, set) | Folder library models 000..511 (name, set, zones, files) |
| Presets tab data | Preset names + referenced model index | Same, plus Load applies preset to synth engine |
| Selection contract | Now serve-don't-apply (`onSelectPreset?` optional, legacy fallback) | Serve-don't-apply (`onSelectModel(slot, resynator)`, `onSelectPreset(slot, name)`) |
| Extras | Export .zip, Clear, Configure-folder, Select Slot | Resynator target row (R1/R2/global), category chips, load modal, folder scan + persistence, `syncCatalogFromHost`, `getBank` |
| Host callbacks in synth main | n/a | Engine load, stick labels, navbar names, WebBridge scan |
| Full-load feasibility | Proven: `zonesAnalysis` (bounds, roots, sample names, complexity, set) + in-memory `modelZoneBinaries` + the import path's resynthesis closure | n/a (synth loads into engine, not into an editor session) |

Full-load data audit (NeuModMakr): restorable exactly — slot, name,
complexity, parameterSet, targetFormat, zone bounds + root keys +
sample names (via `zonesAnalysis`), playable audio (resynthesized from
stored scape/sphere binaries, same routine the import path uses).
NOT restorable: per-zone `velSplit` (`ZoneAnalysisSummary` does not
carry it — defaults to 64), detune/volume/pan (never stored on the
model record), and anything after a page reload (binaries are
memory-only; `persistBank` saves metadata + capped `neuronikModelJson`
only). The UI must say so when it happens.

## Design

### Part A — per-host tabs (both drawers, additive)

Drawer option `visibleTabs: Array<'models' | 'presets' | 'library'>`,
default `['models', 'presets']` (current behavior, synth untouched).
NeuModMakr passes `['models', 'library']` (Library arrives in Part C;
until then `['models']`). Tab chips, counters, footer and the
`activeTab` fallback render only visible tabs. New `isVisible()` style
additive getters already exist on both drawers; no signature changes.
Hiding presets in NeuModMakr also removes the now-dead preset-load
branch in its host (`onSelectPreset` + preset warning) in the same
slice — no dead code left behind.

### Part B — full model load (NeuModMakr core + drawer action)

1. Extract the resynthesis closure inside
   `WebAudioPipeline.importModelFiles` (`buildResynthSourceWav`) into a
   module-level function (same file or `core/modelResynth.ts` — builder's
   call) used by both paths, byte-identical behavior.
2. New `BankService.buildSessionData(slot)` (pure assembly, no session
   mutation): returns `{ zones, processConfig, sampleBuffers }` from the
   model record + `zonesAnalysis` + binaries, or throws `NO_BINARIES`
   when the slot has metadata but no cached binaries (post-reload,
   factory records).
3. New `CoreService.loadBankModel(slot): Promise<Session>`: validates,
   `pushHistory('Load Model …')`, installs zones/config, registers
   sample buffers, marks dirty, emits `session-changed`. On `NO_BINARIES`
   the host toasts that the model needs re-import/regeneration.
4. Drawer models tab: the card action becomes `Load` (replacing `Select
   Slot`, per approval). Single click highlights only; double-click /
   `Load` serves the slot via `onSelectModel` and the host performs the
   full load. Loading with a dirty session asks via the existing
   non-blocking `confirmDialog` (same pattern as zone delete). Success
   → `refreshUI` + success toast; the editor shows the model's name,
   zones, samples and config. `Select Slot` disappears: loading a model
   already positions the editor (and the next Process) on its slot.
5. `velSplit` restores to 64 with a one-line telemetry note; detune/
   volume/pan restore to zone defaults. Documented, not silent.

### Part C — Library tab (NeuModMakr, reuses the modal scan)

The NeuronDB folder scan already produces entries and the modal already
loads them via `importModelFiles`. The scan handles stay owned by
`importHandlers`; the drawer receives a read-only entry list
(`{ slot, name, parameterSet, zoneCount }`) plus an `onPickLibraryModel`
callback that delegates to the exact modal-pick code path. Empty state
offers the existing "Configure folder…" trigger. No new parsing, no new
import logic — a new view over an existing flow. Entry data follows the
modal's scan lifecycle (fresh scan on open/configure, progressive
updates) rather than a permanently cached list, so the tab can never
disagree with the modal.

### Part D — one drawer in ABDShared (convergence)

New `ABDShared/Components/bank/` (TS): a presentational drawer that
renders configured tabs/entries/actions from a declarative config and
emits selection/action events only. Host-specific UI (resynator row,
category chips, Export/Clear, folder buttons, footer actions) becomes
optional named slots with defaults. Adapters:

- `ABDNeuModMakr/src/ui/BankDrawer.ts` → thin adapter (container
  mounting, CoreService wiring, `visibleTabs`, Load/Select actions).
- `ABDAxionikVS/WebUI/src/ui/BankDrawer.ts` → thin adapter
  (DrawerManager mounting, WebBridge wiring, resynator context,
  category chips, load modal).

Migration order (each slice independently verified, suite green):

1. Parts A–C against the local NeuModMakr drawer.
2. Extract the shared drawer; NeuModMakr adapter; delete local
   implementation. Verify: `tsc`, `test:types`, 7/7 suite, build.
3. Synth adapter reproducing current behavior exactly (same tabs,
   chips, modal, persistence keys, handler names). Verify with the
   synth's `vitest run` + `vite build` + manual click-through of
   Models/Presets/Load/R1-R2. Delete the fork only after that.
4. Follow-up (separate change): point the shared drawer at a future
   ABDBankManager core when it publishes; not part of this project.

## Verification plan

- NeuModMakr slices: `tsc`, `test:types`, full 7-phase suite (new
  phase-6 section for the `NO_BINARIES`/load decision logic), `vite
  build`, plus manual browser pass (Load generated model, Load missing
  binaries, Library pick, hidden presets tab).
- Synth slice: its `vitest run`, `vite build`, manual pass. Any synth
  test or pixel change blocks the slice — the fork stays until green.
- ABDBankManager is not touched and needs no verification.

## Builder calls left open (do not change the design above)

- Exact module path/name inside `ABDShared/Components/bank/`.
- Whether the resynth helper lives in `core/modelResynth.ts` or stays
  module-local in `WebAudioPipeline.ts`.
- Exact plumbing of the Library entry list (props vs pull from
  `importHandlers`); behavior is fixed, wiring is free.

## Calls already made (check while reading)

- Tabs are host configuration, not drawer branches: `visibleTabs`
  default preserves the synth exactly.
- Load and Select Slot coexist on model cards; Load never silently
  overwrites a dirty session (confirm first).
- Convergence is UI-only; ABDBankManager integration is explicitly out.
