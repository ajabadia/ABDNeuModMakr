// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 6 Verification Suite
// Unit tests for the modules extracted during P1.1 / DRY /
// App-shell splits. Pure modules are tested directly;
// ImportHandlers / MenuActions are tested through mock
// contexts (no DOM required).
// Covers:
//   src/core/dsp/DspMath.ts
//   src/core/sessionHistory.ts
//   src/core/sampleNaming.ts
//   src/core/sessionFactory.ts
//   src/core/waveforms.ts
//   src/core/audioPreview.ts
//   src/app/importHandlers.ts (loadSampleFileIntoZone)
//   src/app/menuActions.ts (navbar handlers, undo/redo)
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import { clamp, linearToDb } from '../src/core/dsp/DspMath.ts';
import { SessionHistory } from '../src/core/sessionHistory.ts';
import {
  DEFAULT_MODEL_NAMES,
  deriveModelNameFromSample,
  parseRootKeyFromFilename,
  parseSampleFilenameByName,
} from '../src/core/sampleNaming.ts';
import {
  createInitialSession,
  createZone,
  nextZoneId,
} from '../src/core/sessionFactory.ts';
import {
  buildZoneRibbonWaveforms,
  computeNormalizedEnvelope,
  emptyRibbonWaveforms,
  getSampleEnvelope,
} from '../src/core/waveforms.ts';
import { AudioPreviewService } from '../src/core/audioPreview.ts';
import { WebAudioPipeline } from '../src/core/WebAudioPipeline.ts';
import { parseSessionJson } from '../src/core/sessionSchema.ts';
import { ImportHandlers, type ImportContext } from '../src/app/importHandlers.ts';
import { MenuActions, type MenuContext } from '../src/app/menuActions.ts';
import type { CoreService } from '../src/core/CoreService.ts';
import type { GeneratedModel, ProcessConfig, Session, ZoneAnalysisSummary } from '../src/core/types.ts';
import type { ZoneBinaryPair } from '../src/core/dsp/PipelineRunner.ts';

function testConfig(): ProcessConfig {
  return {
    modelNumber: 0,
    modelName: 'T',
    complexity: 8,
    parameterSet: 0,
    targetFormat: 'dual',
  };
}

async function runPhase6Tests(): Promise<void> {
  console.log('=== ABDNeuModMakr Phase 6 Verification Suite (extracted modules) ===');

  // ── 1. DspMath ──────────────────────────────────────────
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
  assert.equal(clamp(0.125, 0.125, 8.0), 0.125);
  assert.equal(linearToDb(1), 0);
  assert.ok(Math.abs(linearToDb(0.5) - -6.0206) < 1e-3);
  assert.equal(linearToDb(0), -120);
  assert.equal(linearToDb(-2), -120);
  assert.equal(linearToDb(1e-6), -120);
  assert.equal(linearToDb(0, -96, 1e-5), -96);
  console.log('[PASS] 1. DspMath clamp + linearToDb (floors, eps boundaries)');

  // ── 2. SessionHistory ───────────────────────────────────
  {
    const h = new SessionHistory();
    assert.equal(h.getState().canUndo, false);
    assert.equal(h.getState().canRedo, false);

    const doc = { zones: [createZone(0, 60, 127, null)], processConfig: testConfig() };
    assert.equal(h.push(doc, 'Step 1'), true);
    assert.equal(h.getState().undoCount, 1);
    assert.equal(h.getState().undoLabel, 'Step 1');

    // Rapid same-key push coalesces (slider drags collapse to one step)
    assert.equal(h.push(doc, 'Step 1b', 'slider'), true);
    assert.equal(h.push(doc, 'Step 1c', 'slider'), false);
    assert.equal(h.getState().undoCount, 2);

    // Entries hold clones, not live references
    doc.zones[0].rootKey = 99 as never;
    const undone = h.undo({ zones: [], processConfig: testConfig() });
    assert.ok(undone);
    assert.equal(undone.label, 'Step 1b');
    assert.notEqual(undone.zones[0]?.rootKey, 99);
    assert.equal(h.getState().canRedo, true);

    const redone = h.redo({ zones: [], processConfig: testConfig() });
    assert.ok(redone);
    assert.equal(h.getState().canRedo, false);

    // Cap at 50
    const h2 = new SessionHistory();
    for (let i = 0; i < 55; i++) {
      h2.push({ zones: [], processConfig: testConfig() }, `s${i}`);
    }
    assert.equal(h2.getState().undoCount, 50);

    h2.clear();
    assert.equal(h2.getState().canUndo, false);
    const emptyDoc = { zones: [], processConfig: testConfig() };
    assert.equal(h2.undo(emptyDoc), null);
    assert.equal(h2.redo(emptyDoc), null);
  }
  console.log('[PASS] 2. SessionHistory push/undo/redo, coalescing, 50-cap, clone isolation');

  // ── 3. sampleNaming ─────────────────────────────────────
  {
    const hart = parseSampleFilenameByName('Flute_72_68_v2.aif', 60);
    assert.equal(hart.rootKey, 72);
    assert.equal(hart.lowKey, 68);
    assert.equal(hart.velocityLayer, 2);
    assert.equal(hart.isHighVelocity, true);

    const hartLow = parseSampleFilenameByName('Flute_72_68.aif', 60);
    assert.equal(hartLow.velocityLayer, 1);
    assert.equal(hartLow.isHighVelocity, false);

    const named = parseSampleFilenameByName('Piano_C3.wav', 60);
    assert.equal(named.rootKey, 48);
    assert.equal(named.lowKey, 48);
    assert.equal(named.velocityLayer, 1);

    const fallback = parseSampleFilenameByName('NoNotesHere.wav', 42);
    assert.equal(fallback.rootKey, 42);

    assert.equal(parseRootKeyFromFilename('Bass_C2.wav', 60), 36);
    assert.equal(parseRootKeyFromFilename('Cellos_F#3.wav', 60), 54);

    assert.equal(deriveModelNameFromSample('Flute_72_68_v2.aif'), 'Flute');
    assert.equal(deriveModelNameFromSample('Piano_C3.wav'), 'Piano');
    assert.ok(deriveModelNameFromSample('AVeryLongModelNameHere_C4.wav').length <= 11);

    assert.ok(DEFAULT_MODEL_NAMES.has('NewModel'));
    assert.ok(DEFAULT_MODEL_NAMES.has(''));
    assert.ok(!DEFAULT_MODEL_NAMES.has('Flute'));
  }
  console.log('[PASS] 3. sampleNaming Hartmann/note/fallback parsing + model-name derivation');

  // ── 4. sessionFactory ───────────────────────────────────
  {
    const z = createZone(0, 60, 127, 'Piano_C3.wav');
    assert.equal(z.lowKey, 0);
    assert.equal(z.rootKey, 60);
    assert.equal(z.highKey, 127);
    assert.equal(z.sampleLow, 'Piano_C3.wav');
    assert.equal(z.sampleHigh, null);
    assert.equal(z.velSplit, 64);
    assert.notEqual(z.id, nextZoneId());

    const s = createInitialSession('Unit');
    assert.equal(s.name, 'Unit');
    assert.equal(s.zones.length, 1);
    assert.equal(s.zones[0].lowKey, 0);
    assert.equal(s.zones[0].highKey, 127);
    assert.equal(s.dirty, false);
    assert.equal(s.processConfig.modelName, 'NewModel');
  }
  console.log('[PASS] 4. sessionFactory zone/session constructors');

  // ── 5. waveforms ────────────────────────────────────────
  {
    assert.deepEqual(computeNormalizedEnvelope(new Float32Array([1, 1, 1, 1]), 4), [1, 1, 1, 1]);
    assert.deepEqual(computeNormalizedEnvelope(new Float32Array(8), 4), [0, 0, 0, 0]);
    assert.deepEqual(computeNormalizedEnvelope(new Float32Array(0), 4), [0, 0, 0, 0]);

    assert.deepEqual(emptyRibbonWaveforms(), {
      lowOriginal: [],
      highOriginal: null,
      processed: null,
      hasProcessed: false,
    });

    const noModel = buildZoneRibbonWaveforms({
      lowOriginal: [0.5],
      highOriginal: null,
      resynthMono: null,
      hasModelBinaries: false,
    });
    assert.equal(noModel.processed, null);
    assert.equal(noModel.hasProcessed, false);

    const withResynth = buildZoneRibbonWaveforms({
      lowOriginal: [],
      highOriginal: null,
      resynthMono: new Float32Array(256).fill(0.5),
      hasModelBinaries: false,
    });
    assert.equal(withResynth.processed?.length, 64);
    assert.equal(withResynth.hasProcessed, true);

    const lossless = buildZoneRibbonWaveforms({
      lowOriginal: [],
      highOriginal: null,
      resynthMono: null,
      hasModelBinaries: true,
    });
    assert.equal(lossless.processed, null);
    assert.equal(lossless.hasProcessed, true);

    const store = { buffers: new Map<string, ArrayBuffer>(), cache: new Map<string, number[]>() };
    assert.deepEqual(getSampleEnvelope(store, null), []);
    const env = getSampleEnvelope(store, 'Test_C4.wav');
    assert.equal(env.length, 64);
    assert.strictEqual(getSampleEnvelope(store, 'Test_C4.wav'), env);
  }
  console.log('[PASS] 5. waveforms envelopes + ribbon payload builder');

  // ── 6. audioPreview (headless) ──────────────────────────
  {
    let ensureCalls = 0;
    let bufferCalls = 0;
    const svc = new AudioPreviewService({
      getZone: () => undefined,
      getFirstZone: () => undefined,
      getSampleBuffer: () => {
        bufferCalls++;
        return undefined;
      },
      setSampleBuffer: () => {},
      getResynthMono: () => undefined,
      ensureSpectrum: () => {
        ensureCalls++;
      },
    });
    const idle = svc.getRealtimeSpectrum();
    assert.equal(idle.isPlaying, false);
    assert.equal(idle.rmsDb, -96);
    assert.equal(idle.bins.length, 64);
    assert.equal(idle.mode, null);

    svc.stopAudition(); // must not throw headless
    await svc.auditionSample('x.wav', 60);
    await svc.auditionZoneComparison('missing', 'resynthesis');
    assert.equal(bufferCalls, 0);
    assert.equal(ensureCalls, 0);
    svc.disposeAudio();
  }
  console.log('[PASS] 6. audioPreview headless safety (no AudioContext in Node)');

  // ── 7. importHandlers.loadSampleFileIntoZone ────────────
  {
    const makeFile = (name: string) =>
      ({ name, arrayBuffer: async () => new Uint8Array([0, 1, 2, 3]).buffer }) as unknown as File;

    async function runCase(opts: {
      slot: 'low' | 'high';
      existingSampleLow: string | null;
      workingMode?: 'classic' | 'extended';
      lowVelocity: number;
    }) {
      const session = createInitialSession('T');
      session.zones[0].sampleLow = opts.existingSampleLow;
      if (opts.workingMode) session.processConfig.workingMode = opts.workingMode;
      let captured: Record<string, unknown> | null = null;
      let refreshed = 0;
      const logs: string[] = [];
      const coreMock = {
        registerSampleBuffer: (_n: string) => ({
          formatTag: 'wav',
          sampleRate: 44100,
          bitsPerSample: 16,
          numChannels: 1,
          durationSec: 1.0,
          instrument: { lowVelocity: opts.lowVelocity },
        }),
        updateZone: async (_id: string, changes: Record<string, unknown>) => {
          captured = changes;
        },
        getSession: () => session,
      } as unknown as CoreService;
      const handlers = new ImportHandlers({
        core: coreMock,
        session,
        selectedZoneId: session.zones[0].id,
        log: (m: string) => logs.push(m),
        refresh: () => refreshed++,
        bank: {},
        neuronDb: {},
      } as unknown as ImportContext);
      await handlers.loadSampleFileIntoZone(session.zones[0].id, opts.slot, makeFile('Piano_C3.wav'));
      return { captured, refreshed, logs };
    }

    // High slot with no sampleLow falls back to Low Vel
    const a = await runCase({ slot: 'high', existingSampleLow: null, lowVelocity: 80 });
    assert.deepEqual(a.captured, { sampleLow: 'Piano_C3.wav' });
    assert.equal(a.refreshed, 1);
    assert.ok(a.logs[0].includes('Low Vel'));

    // Classic mode forces velSplit 64 even when the WAV suggests 80
    const b = await runCase({ slot: 'high', existingSampleLow: 'a.wav', lowVelocity: 80 });
    assert.deepEqual(b.captured, { sampleHigh: 'Piano_C3.wav', velSplit: 64 });

    // Extended mode adopts the instrument lowVelocity
    const c = await runCase({
      slot: 'high',
      existingSampleLow: 'a.wav',
      workingMode: 'extended',
      lowVelocity: 80,
    });
    assert.deepEqual(c.captured, { sampleHigh: 'Piano_C3.wav', velSplit: 80 });

    // Empty drop list is a no-op
    const noop = new ImportHandlers({} as never);
    await noop.handleDroppedFiles({ length: 0 } as unknown as never);
  }
  console.log('[PASS] 7. importHandlers slot fallback + classic/extended velSplit');

  // ── 8. menuActions ──────────────────────────────────────
  {
    const logs: string[] = [];
    let refreshed = 0;
    const telemetry = { addLog: (m: string) => logs.push(m) };
    const mkCtx = (core: unknown, session: Session | null): MenuContext =>
      ({
        core,
        imports: {},
        shell: {
          getNavbar: () => ({}),
          getInspector: () => ({}),
          getSpectralView: () => ({}),
          getTelemetry: () => telemetry,
          getBank: () => ({}),
        },
        session,
        selectedZoneId: null,
        themes: ['a', 'b'],
        themeIndex: 0,
        log: (m: string) => logs.push(m),
        refresh: () => refreshed++,
        getActiveZone: () => null,
        getActiveZoneIndex: () => 0,
        handleStartProcess: async () => {},
        toggleSpectralPanel: () => {},
      }) as unknown as MenuContext;

    // onNewSession wires session + selection + log + refresh
    {
      logs.length = 0;
      refreshed = 0;
      const s2 = createInitialSession('Init Model');
      const ctx = mkCtx({ newSession: async () => s2 }, null);
      const menus = new MenuActions(ctx);
      await menus.buildNavbarHandlers().onNewSession();
      assert.equal(ctx.session, s2);
      assert.equal(ctx.selectedZoneId, s2.zones[0].id);
      assert.ok(logs.some((l) => l.includes('Init Model')));
      assert.equal(refreshed, 1);
    }

    // onClearZones delegates to resetZonesToSingle
    {
      logs.length = 0;
      refreshed = 0;
      const s3 = createInitialSession('Cleared');
      const ctx = mkCtx({ resetZonesToSingle: () => s3 }, null);
      new MenuActions(ctx).buildNavbarHandlers().onClearZones();
      assert.equal(ctx.session, s3);
      assert.equal(refreshed, 1);
    }

    // performUndo no-ops when history is empty
    {
      logs.length = 0;
      refreshed = 0;
      let undoCalls = 0;
      const ctx = mkCtx(
        {
          getHistoryState: () => ({ canUndo: false, canRedo: false }),
          undo: () => {
            undoCalls++;
            return null;
          },
        },
        createInitialSession('U')
      );
      new MenuActions(ctx).performUndo();
      assert.equal(undoCalls, 0);
      assert.equal(logs.length, 0);
      assert.equal(refreshed, 0);
    }

    // performUndo restores + falls back selection to zone[0]
    {
      logs.length = 0;
      refreshed = 0;
      const s4 = createInitialSession('Restored');
      const ctx = mkCtx(
        {
          getHistoryState: () => ({ canUndo: true, undoLabel: 'X' }),
          undo: () => s4,
        },
        createInitialSession('Before')
      );
      ctx.selectedZoneId = 'gone';
      new MenuActions(ctx).performUndo();
      assert.equal(ctx.session, s4);
      assert.equal(ctx.selectedZoneId, s4.zones[0].id);
      assert.ok(logs.some((l) => l === 'Undo: X'));
      assert.equal(refreshed, 1);
    }

    // performRedo restores symmetrically
    {
      logs.length = 0;
      refreshed = 0;
      const s5 = createInitialSession('Redone');
      const ctx = mkCtx(
        {
          getHistoryState: () => ({ canRedo: true, redoLabel: 'Y' }),
          redo: () => s5,
        },
        createInitialSession('Before')
      );
      new MenuActions(ctx).performRedo();
      assert.equal(ctx.session, s5);
      assert.ok(logs.some((l) => l === 'Redo: Y'));
      assert.equal(refreshed, 1);
    }
    // Drawers are mutually exclusive: opening Bank closes Telemetry and vice versa
    {
      const mkDrawer = (open: boolean) => {
        const d = {
          visible: open,
          isVisible: () => d.visible,
          toggle: () => { d.visible = !d.visible; },
          open: () => { d.visible = true; },
          close: () => { d.visible = false; },
        };
        return d;
      };
      const telemetryDrawer = mkDrawer(false);
      const bankDrawer = mkDrawer(true); // bank auto-opened by folder import
      const ctx = mkCtx({}, createInitialSession('D'));
      (ctx.shell as unknown as { getTelemetry: () => unknown }).getTelemetry = () => telemetryDrawer;
      (ctx.shell as unknown as { getBank: () => unknown }).getBank = () => bankDrawer;
      const handlers = new MenuActions(ctx).buildNavbarHandlers();

      // GAP pill click always surfaces the audit, moving Bank aside
      handlers.onOpenAudit!();
      assert.equal(telemetryDrawer.visible, true);
      assert.equal(bankDrawer.visible, false);

      // Toggling Bank open hides Telemetry
      (ctx.core as unknown as { loadBank: () => Promise<unknown> }).loadBank = async () => ({ models: [], presets: [] });
      (bankDrawer as unknown as { setBank: (b: unknown) => void }).setBank = () => {};
      await handlers.onToggleBank();
      assert.equal(bankDrawer.visible, true);
      assert.equal(telemetryDrawer.visible, false);
    }
  }
  console.log('[PASS] 8. menuActions navbar handlers + undo/redo fallback + drawer exclusivity');

  // ── 9. workingMode extended (freely selectable under any targetFormat) ──
  {
    const p = new WebAudioPipeline();
    await p.init();
    await p.newSession('ExtMode');

    // Freely enable extended under default 'dual' targetFormat
    p.updateProcessConfig({ workingMode: 'extended' });
    assert.equal(p.getSession()?.processConfig.workingMode, 'extended');
    assert.ok((p.getSession()?.extendedRegions?.length ?? 0) >= 1);

    // velSplit honored in extended…
    const zid = p.getSession()!.zones[0].id;
    await p.updateZone(zid, { velSplit: 100 });
    assert.equal(p.getSession()!.zones[0].velSplit, 100);

    // Switching targetFormat to legacy-neuron keeps workingMode: 'extended' (decoupled creation vs export)
    p.updateProcessConfig({ targetFormat: 'legacy-neuron' });
    assert.equal(p.getSession()?.processConfig.workingMode, 'extended');

    // Switching back to classic forces 64 on classic zone edits
    p.updateProcessConfig({ workingMode: 'classic' });
    assert.equal(p.getSession()?.processConfig.workingMode, 'classic');
    await p.updateZone(zid, { velSplit: 100 });
    assert.equal(p.getSession()!.zones[0].velSplit, 64);

    // Session JSON preserves workingMode: 'extended' under any targetFormat
    p.updateProcessConfig({ targetFormat: 'dual', workingMode: 'extended' });
    const exported = JSON.parse(p.exportSessionJson());
    assert.equal(exported.session.processConfig.workingMode, 'extended');
    const reloaded = await p.loadSessionFromJson(JSON.stringify(exported));
    assert.equal(reloaded.processConfig.workingMode, 'extended');

    p.dispose();
  }
  console.log('[PASS] 9. workingMode extended free toggle, velSplit honor/force, JSON roundtrip');

  // ── 10. updateProcessConfig validates BEFORE recording history ──
  {
    const p = new WebAudioPipeline();
    await p.init();
    await p.newSession('HistGuard');
    assert.equal(p.getHistoryState().canUndo, false);

    // Rejected invalid workingMode must not leave a phantom undo step
    assert.throws(
      () => p.updateProcessConfig({ workingMode: 'bogus' as unknown as 'classic' }),
      /Invalid workingMode/
    );
    assert.equal(p.getHistoryState().canUndo, false);

    // Accepted change records exactly one step and undo restores previous state
    p.updateProcessConfig({ targetFormat: 'modern-neural' });
    assert.equal(p.getHistoryState().canUndo, true);
    p.undo();
    assert.equal(p.getHistoryState().canUndo, false);
    assert.equal(p.getSession()?.processConfig.targetFormat, 'dual');

    p.dispose();
  }
  console.log('[PASS] 10. updateProcessConfig history-after-validation');

  // ── 11. buildBankLoadPlan (pure assembly for full model loads) ──
  {
    const { buildBankLoadPlan, BankLoadError } = await import('../src/core/bankService.ts');
    const pair = (s: number): ZoneBinaryPair => ({
      scapeBinary: new Uint8Array([s]),
      sphereBinary: new Uint8Array([s]),
    });
    const sum = (sampleName: string, lowKey: number, rootKey: number, highKey: number): ZoneAnalysisSummary => ({
      zoneId: `${sampleName}-z`,
      lowKey,
      rootKey,
      highKey,
      sampleName,
      sampleRate: 44100,
      durationSec: 1.0,
      detectedF0Hz: 440,
      targetF0Hz: 440,
      gridResidualCents: 0,
      gridObservations: 16,
      gridBand: 'green',
      gridNotice: 'test',
      layerCount: 1,
      frameCount: 16,
      activePartials: 64,
      octaveFoldCents: 0,
      biGrid: false,
      amplitudes: new Array<number>(64).fill(0),
      frequencyOffsets: new Array<number>(64).fill(0),
    });
    const base: GeneratedModel = {
      slot: 7,
      name: 'LoadMe',
      zoneCount: 2,
      complexity: 9,
      parameterSet: 3,
      createdAt: '2026-01-01T00:00:00Z',
      path: 'Models/007.model',
      targetFormat: 'dual',
      zonesAnalysis: [],
      neuronikModelJson: JSON.stringify({
        name: 'LoadMe',
        slot: 7,
        zones: [
          { lowKey: 0, rootKey: 48, highKey: 63, sampleName: 'a.wav', sampleHigh: 'b.wav' },
          { lowKey: 64, rootKey: 72, highKey: 127, sampleName: 'a.wav' },
        ],
      }),
    };

    // Missing record / missing binaries / count mismatch / no zones
    assert.throws(() => buildBankLoadPlan(undefined, [pair(1)]), (e: unknown) => e instanceof BankLoadError && e.code === 'NOT_FOUND');
    assert.throws(() => buildBankLoadPlan(base, undefined), (e: unknown) => e instanceof BankLoadError && e.code === 'NO_BINARIES');
    assert.throws(() => buildBankLoadPlan(base, []), (e: unknown) => e instanceof BankLoadError && e.code === 'NO_BINARIES');
    assert.throws(() => buildBankLoadPlan(base, [pair(1)]), (e: unknown) => e instanceof BankLoadError && e.code === 'MISMATCH');
    assert.throws(
      () => buildBankLoadPlan({ ...base, neuronikModelJson: undefined, zonesAnalysis: [] }, [pair(1)]),
      (e: unknown) => e instanceof BankLoadError && e.code === 'NO_ZONES'
    );

    // Ordered-unique sample alignment: [a.wav, b.wav] ↔ 2 binaries;
    // zone 2 reuses a.wav; config carried over from the record.
    const plan = buildBankLoadPlan(base, [pair(1), pair(2)]);
    assert.deepEqual(plan.sampleOrder, ['a.wav', 'b.wav']);
    assert.equal(plan.zones.length, 2);
    assert.equal(plan.zones[0].sampleHigh, 'b.wav');
    assert.equal(plan.zones[1].sampleLow, 'a.wav');
    assert.equal(plan.processConfig.modelName, 'LoadMe');
    assert.equal(plan.processConfig.modelNumber, 7);
    assert.equal(plan.processConfig.complexity, 9);

    // Fallback when neuronikModelJson is absent: zonesAnalysis (low only).
    const fallback = buildBankLoadPlan(
      {
        ...base,
        neuronikModelJson: undefined,
        zonesAnalysis: [sum('solo.wav', 0, 60, 127)],
      },
      [pair(9)]
    );
    assert.deepEqual(fallback.sampleOrder, ['solo.wav']);
    assert.equal(fallback.zones[0].sampleHigh, null);
  }
  console.log('[PASS] 11. buildBankLoadPlan mapping + error contract');

  // ── 12. Fase 6: Universal SF2 (Baritone Saxophone V2.sf2) + SFZ + Extended Adapter + Safe sound.script ──
  {
    const fs = await import('node:fs');
    const {
      listSf2Presets,
      importSf2PresetToNative,
      importSfzToNative,
      projectExtendedRegionsToClassicZones,
      mapArticulationToSoundOverrides,
    } = await import('../src/core/index.ts');
    const { decodeWav } = await import('../src/core/dsp/WavDecoder.ts');

    const sf2Path = 'D:\\desarrollos\\ABDSynths\\_RESOURCES\\Soundfonts\\polyphone.io\\Baritone Saxophone V2.sf2';
    if (fs.existsSync(sf2Path)) {
      const nodeBuf = fs.readFileSync(sf2Path);
      const ab = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength);

      const presets = listSf2Presets(ab);
      assert.ok(presets.length >= 1);
      assert.equal(presets[0].name, 'Baritone Sax V2');
      assert.equal(presets[0].sampleCount, 22);

      const native = importSf2PresetToNative(ab, 0);
      assert.equal(native.sourceFormat, 'sf2');
      assert.ok(native.detectedCategory === 'Woodwinds & Reeds' || native.detectedCategory === 'Winds & Brass');
      assert.equal(native.suggestedParameterSet, 1);
      // 22 mono L/R samples merged into 11 true 2-channel Stereo WAVs!
      assert.equal(native.audioFiles.length, 11);
      assert.equal(native.extendedRegions.length, 11);
      assert.equal(native.classicZones.length, 11);

      const decFirst = decodeWav(native.audioFiles[0].buffer);
      assert.equal(decFirst.numChannels, 2);
      assert.equal(decFirst.sampleRate, 44100);

      const roots = native.extendedRegions.map((r) => r.rootKey);
      assert.deepEqual(roots, [36, 40, 43, 48, 52, 55, 60, 64, 67, 72, 76]);
      assert.ok(native.extendedRegions.every((r) => r.loopMode === 'loop_continuous'));
      assert.ok(native.extendedRegions.every((r) => r.loopEnd > r.loopStart));

      // Verify WebAudioPipeline integration + 0..127 contiguous coverage
      const p = new WebAudioPipeline();
      await p.init();
      const session = await p.importSf2Buffer(ab, 0);
      assert.equal(session.zones.length, 11);
      assert.equal(p.validateCoverage().length, 0);
      p.dispose();
    }

    // Test SFZ importer + Extended -> Classic velocity volume compensation + Safe sound.script overrides
    const sfzText = `
      <global>
      ampeg_attack=0.04 ampeg_decay=0.5 ampeg_sustain=80 ampeg_release=0.35
      cutoff=2400 resonance=6 fileg_depth=1800
      pitchlfo_delay=0.3 pitchlfo_freq=5.5 pitchlfo_depth=35
      <group> lovel=1 hivel=63 volume=-6
      <region> sample=soft_c4.wav lokey=c3 hikey=b4 pitch_keycenter=c4 loop_mode=loop_continuous loop_start=100 loop_end=8000
      <group> lovel=64 hivel=127 volume=0
      <region> sample=loud_c4.wav lokey=c3 hikey=b4 pitch_keycenter=c4
    `;
    const sfzRes = importSfzToNative(sfzText, 'Expressive Synth Lead.sfz', []);
    assert.equal(sfzRes.extendedRegions.length, 2);
    assert.equal(sfzRes.classicZones.length, 1);
    assert.equal(sfzRes.classicZones[0].lowKey, 0);
    assert.equal(sfzRes.classicZones[0].highKey, 127);
    assert.equal(sfzRes.classicZones[0].sampleLow, 'soft_c4.wav');
    assert.equal(sfzRes.classicZones[0].sampleHigh, 'loud_c4.wav');
    assert.equal(sfzRes.classicZones[0].volume, 0);
    // Low velocity layer (-6 dB vs 0 dB column volume) gets ~0.501 linear amplitude compensation
    const comp = sfzRes.velocityLayerGainCompensation['zone-1'];
    assert.ok(comp.lowGain > 0.49 && comp.lowGain < 0.51);
    assert.equal(comp.highGain, 1.0);

    // Verify safe sound.script overrides
    const overrides = mapArticulationToSoundOverrides(sfzRes.articulation);
    assert.ok(overrides.R1AmpEnvA > 0);
    assert.equal(overrides.SilverSwitch, 1);
    assert.ok(overrides.FilterFreq > 0 && overrides.FilterFreq < 127);
    assert.equal(overrides.LFOSwitch, 1);
    assert.ok(overrides.R1PitchLfoDepth > 0);
    // Critical safety: all Scape/Sphere/Blender LFO & Env depths are explicitly zeroed
    assert.equal(overrides.R1L1Scape1LfoDepth, 0);
    assert.equal(overrides.R1L1Sphere1LfoDepth, 0);
    assert.equal(overrides.R1L2Scape1LfoDepth, 0);
    assert.equal(overrides.R1L3Sphere2LfoDepth, 0);
    assert.equal(overrides.BlenderLfoDepth, 0);
    assert.equal(overrides.R1L1Scape1EnvDepth, 0);
    assert.equal(overrides.R1L1Sphere1EnvDepth, 0);
    assert.equal( projectExtendedRegionsToClassicZones(sfzRes.extendedRegions).zones.length, 1);
  }
  console.log('[PASS] 12. Fase 6 SF2 (Baritone Sax V2), SFZ, Extended->Classic Adapter & Safe sound.script');

  // ── 13. Fase 7: Hybrid YIN/MPM Pitch Detection, Acoustic Classifier, Enhanced DSP & Quality Score ──
  {
    const {
      detectPitchYinMpm,
      hzToMidiAndCents,
      extractAcousticDescriptors,
      classifyAcousticSample,
      applyEnhancedSpectralModel,
      computeDspQualityScore,
    } = await import('../src/core/dsp/AcousticIntelligence.ts');
    const { SpectralAnalyzer } = await import('../src/core/dsp/SpectralAnalyzer.ts');
    const { resynthesizeModelToPcm } = await import('../src/core/dsp/ScapeSphereGenerator.ts');
    const { encodeWavPcm16 } = await import('../src/core/dsp/WavDecoder.ts');

    const sr = 44100;
    const len = sr; // 1.0 sec
    // Synthesize a harmonic 220 Hz (A3 = MIDI 57) plucked string signal with exponential decay
    const harmonicPcm = new Float32Array(len);
    const f0Target = 220.0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = t < 0.005 ? t / 0.005 : Math.exp(-(t - 0.005) * 4.5);
      let s = 0;
      for (let h = 1; h <= 8; h++) {
        s += (1 / h) * Math.sin(2 * Math.PI * f0Target * h * t);
      }
      harmonicPcm[i] = s * env * 0.4;
    }

    const pitch = detectPitchYinMpm(harmonicPcm, sr);
    assert.ok(Math.abs(pitch.f0Hz - 220.0) < 1.5, `Expected ~220 Hz, got ${pitch.f0Hz}`);
    assert.ok(pitch.harmonicity > 0.65, `Expected high harmonicity, got ${pitch.harmonicity}`);

    const midiMap = hzToMidiAndCents(pitch.f0Hz);
    assert.equal(midiMap.midiNote, 57);
    assert.ok(Math.abs(midiMap.centOffset) <= 12);

    const analyzer = new SpectralAnalyzer();
    const desc = extractAcousticDescriptors(harmonicPcm, sr, analyzer, 220.0);
    assert.equal(desc.detectedMidiNote, 57);
    assert.equal(desc.isPercussiveOrNoise, false);
    assert.ok(desc.attackMs < 35, `Expected fast plucked attack, got ${desc.attackMs} ms`);

    const cls = classifyAcousticSample(desc, 'acoustic_guitar_a3.wav');
    assert.ok(cls.detectedCategory.startsWith('Plucked'));
    assert.equal(cls.recommendedParameterSet, 3);
    assert.ok(cls.confidence > 0.5);

    // Enhanced DSP model & Quality Score
    const legacyModel = analyzer.analyzeTemporal(harmonicPcm, sr, pitch.f0Hz, 16);
    const enhancedModel = applyEnhancedSpectralModel(legacyModel, desc);
    assert.equal(enhancedModel.numFramesOf(0), legacyModel.numFramesOf(0));

    const legacyResynth = resynthesizeModelToPcm(legacyModel, 0.5, sr, pitch.f0Hz);
    const enhancedResynth = resynthesizeModelToPcm(enhancedModel, 0.5, sr, pitch.f0Hz);
    const qScore = computeDspQualityScore(
      harmonicPcm,
      legacyResynth,
      enhancedResynth,
      legacyModel,
      enhancedModel,
      'enhanced',
      analyzer.lastGridResidualCents()
    );
    assert.ok(qScore.overallScore > 40);
    assert.ok(qScore.enhancedScore >= qScore.legacyScore);

    // Verify WebAudioPipeline autoDetectZonePitchAndParameterSet & dspAlgorithm config
    const p = new WebAudioPipeline();
    await p.init();
    await p.newSession('Phase7Test');
    p.updateProcessConfig({ dspAlgorithm: 'enhanced' });
    assert.equal(p.getSession()?.processConfig.dspAlgorithm, 'enhanced');

    const z0 = p.getSession()!.zones[0];
    const wavBuf = encodeWavPcm16([harmonicPcm], sr);
    p.registerSampleBuffer('plucked_a3.wav', wavBuf);
    await p.updateZone(z0.id, { sampleLow: 'plucked_a3.wav', rootKey: 60 });

    const autoRes = p.autoDetectZonePitchAndParameterSet(z0.id, true);
    assert.ok(autoRes !== null);
    assert.equal(autoRes!.descriptors.detectedMidiNote, 57);
    assert.equal(p.getSession()!.zones[0].rootKey, 57);
    assert.equal(p.getSession()!.processConfig.parameterSet, 3);

    const spec = p.inspectZoneSpectrum(z0.id);
    assert.ok(spec !== null);
    assert.ok(spec!.qualityScore !== undefined);
    assert.ok(spec!.enhancedResynthPeaks !== undefined);
    assert.ok(spec!.classification !== undefined);

    p.dispose();
  }
  console.log('[PASS] 13. Fase 7 Hybrid Pitch Detection, Acoustic Classifier, Enhanced DSP & Quality Score');

  // ── 14. Fase 8: Master Wave Standard (24-bit / 96 kHz), Short-Loop Expansion, Surround & AI Bridge ──
  {
    const {
      expandShortLoopAndRelocate,
      expandSpatialChannels,
      downmixToClassicMono44k1,
      regenerateMasterWaveFromModel,
      registerAiEnhancementProvider,
    } = await import('../src/core/dsp/MasterWaveEnhancer.ts');
    const { decodeWav, encodeWavPcm16, encodeWavPcm24 } = await import(
      '../src/core/dsp/WavDecoder.ts'
    );
    const { SpectralAnalyzer } = await import('../src/core/dsp/SpectralAnalyzer.ts');

    const sr = 22050; // Simulate a legacy 22.05 kHz SF2 sample with a short 0.25s loop
    const n = Math.round(sr * 0.45);
    const shortWave = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      shortWave[i] =
        0.5 * Math.sin(2 * Math.PI * 220 * t) +
        0.25 * Math.sin(2 * Math.PI * 440 * t) +
        0.12 * Math.sin(2 * Math.PI * 660 * t);
    }

    // 1. Test 24-bit / 96 kHz WAV encoder + `smpl` loop chunk round-trip
    const wav24 = encodeWavPcm24([shortWave], 96000, {
      rootKey: 57,
      detune: -5,
      loopStart: 1200,
      loopEnd: 8400,
    });
    const dec24 = decodeWav(wav24);
    assert.equal(dec24.bitsPerSample, 24);
    assert.equal(dec24.sampleRate, 96000);
    assert.equal(dec24.instrument?.rootKey, 57);
    assert.equal(dec24.instrument?.loopStart, 1200);
    assert.equal(dec24.instrument?.loopEnd, 8400);

    // 2. Test Smart Short-Loop Expansion (0.25s -> >= 2.0s) & Auto-Loop Finder
    const expanded = expandShortLoopAndRelocate(
      [shortWave],
      sr,
      Math.round(sr * 0.1),
      Math.round(sr * 0.35),
      2.0
    );
    assert.equal(expanded.loopExpanded, true);
    const newLoopSec = (expanded.loopEnd - expanded.loopStart) / sr;
    assert.ok(newLoopSec >= 1.75, `Expected expanded loop >= 1.75s, got ${newLoopSec}s`);
    assert.ok(expanded.zeroCrossingCorrelation > 0.7);

    // 3. Test Spatial Expansion (Mono-compatible Stereo 2.0 & Quad Surround 4.0)
    const stereo = expandSpatialChannels([shortWave], sr, 'stereo');
    assert.equal(stereo.length, 2);
    const quad = expandSpatialChannels([shortWave], sr, 'quad-surround');
    assert.equal(quad.length, 4);
    const downmixed = downmixToClassicMono44k1(quad, sr);
    assert.ok(downmixed.length > shortWave.length); // 22050 -> 44100 Hz

    // 4. Test NeuronDB Model -> 24-bit / 96 kHz Cubic-Spline Regeneration
    const analyzer = new SpectralAnalyzer();
    const model = analyzer.analyzeTemporal(shortWave, sr, 220, 8);
    const regen = regenerateMasterWaveFromModel(model, 57, 1.0, {
      targetSampleRate: 96000,
      channelLayout: 'quad-surround',
    });
    assert.equal(regen.channels.length, 4);
    assert.equal(regen.channels[0].length, 96000);
    assert.ok(regen.loopEnd > regen.loopStart);

    // 5. Test WebAudioPipeline.promoteZoneToMasterWave + Pluggable AI Provider Bridge
    const p = new WebAudioPipeline();
    await p.init();
    await p.newSession('Phase8MasterWave');
    const z0 = p.getSession()!.zones[0];
    const srcWav = encodeWavPcm16([shortWave], sr, {
      rootKey: 57,
      loopStart: Math.round(sr * 0.1),
      loopEnd: Math.round(sr * 0.35),
    });
    p.registerSampleBuffer('vintage_sax_22k.wav', srcWav);
    await p.updateZone(z0.id, { sampleLow: 'vintage_sax_22k.wav', rootKey: 57 });

    const fmtBefore = p.getZoneSampleFormatInfo(z0.id);
    assert.equal(fmtBefore?.sampleRate, 22050);
    assert.equal(fmtBefore?.bitsPerSample, 16);

    // Register a mock AI provider to verify the AI Bridge path
    registerAiEnhancementProvider({
      id: 'test-audiosr',
      name: 'Mock AudioSR + BigVGAN',
      capabilities: ['audiosr', 'bigvgan'],
      isAvailable: async () => true,
      enhance: async (req) => ({
        channels: req.channels,
        sampleRate: req.sampleRate,
        loopStart: req.loopStart,
        loopEnd: req.loopEnd,
        providerName: 'Mock AudioSR 96k',
      }),
    });

    const mwRes = await p.promoteZoneToMasterWave(z0.id, {
      promotionMethod: 'ai-bridge',
      channelLayout: 'quad-surround',
      minLoopDurationSec: 1.5,
    });
    registerAiEnhancementProvider(null);

    assert.ok(mwRes !== null);
    assert.equal(mwRes!.masterSampleRate, 96000);
    assert.equal(mwRes!.bitDepth, 24);
    assert.equal(mwRes!.numChannels, 4);
    assert.equal(mwRes!.loopExpanded, true);
    assert.equal(mwRes!.aiProviderUsed, 'Mock AudioSR 96k');

    const fmtAfter = p.getZoneSampleFormatInfo(z0.id);
    assert.equal(fmtAfter?.sampleRate, 96000);
    assert.equal(fmtAfter?.bitsPerSample, 24);
    assert.equal(fmtAfter?.numChannels, 4);

    p.dispose();
  }
  console.log('[PASS] 14. Fase 8 Master Wave (24-bit/96kHz), Short-Loop Expansion, Quad Surround & AI Bridge');

  // ── 15. Fase 9: 5-Layer Time Capsule Container, Provenance & Zero Photocopy Effect ──
  {
    const {
      parseZipArchive,
      serializeMName,
      serializeCanonicalMapScript,
    } = await import('@abdsynths/shared/formats/neuron');
    const { encodeWavPcm16 } = await import('../src/core/dsp/WavDecoder.ts');
    const { NeuronAssetStore } = await import(
      '../src/core/storage/NeuronAssetStore.ts'
    );
    const { extractTimeCapsuleFromFiles } = await import(
      '../src/core/timeCapsule.ts'
    );

    // 1. Test NeuronAssetStore persistence & diagnostics
    const store = new NeuronAssetStore();
    await store.hydrateFromIndexedDb();
    const rawTone = new Float32Array(22050);
    for (let i = 0; i < rawTone.length; i++) {
      rawTone[i] = 0.65 * Math.sin((2 * Math.PI * 330 * i) / 22050);
    }
    const rawWav = encodeWavPcm16([rawTone], 22050, {
      rootKey: 64,
      loopStart: 2205,
      loopEnd: 18000,
    });
    await store.saveRawSource('pure_lead.wav', rawWav);
    const loadedRaw = await store.loadRawSource('pure_lead.wav');
    assert.ok(loadedRaw instanceof ArrayBuffer);
    assert.equal(loadedRaw!.byteLength, rawWav.byteLength);
    const diag = store.getDiagnostics();
    assert.equal(diag.rawSourceCount, 1);
    assert.equal(diag.rawSourceBytes, rawWav.byteLength);

    // 2. Test 5-Layer Time Capsule Packaging, Provenance & Anti-Photocopy Reprocess from `01_raw_source`
    const p1 = new WebAudioPipeline();
    await p1.init();
    await p1.newSession('TimeCapsuleRawSession');
    const z0 = p1.getSession()!.zones[0];
    p1.registerSampleBuffer('pure_lead.wav', rawWav);
    await p1.updateZone(z0.id, { sampleLow: 'pure_lead.wav', rootKey: 64 });

    // Promote to 24-bit / 96.000 Hz Master Wave (`03_enhanced_audio`)
    const promo1 = await p1.promoteZoneToMasterWave(z0.id, {
      promotionMethod: 'dsp-enhanced',
      channelLayout: 'stereo',
      minLoopDurationSec: 1.5,
    });
    assert.ok(promo1 !== null);
    assert.equal(promo1!.masterSampleRate, 96000);
    assert.equal(promo1!.bitDepth, 24);

    // Compile model (`04_classic_enhanced` & `05_extended_model`)
    await p1.startProcess({
      modelNumber: 88,
      modelName: 'Capsule88',
      parameterSet: 1,
      complexity: 6,
      targetFormat: 'dual',
      workingMode: 'extended',
      dspAlgorithm: 'enhanced',
    });

    const prov1 = p1.getModelProvenance(88);
    assert.ok(prov1 !== null);
    assert.equal(prov1!.primarySourceLayer, '01_raw_source');
    assert.equal(prov1!.activeAnalysisSourceLayer, '03_enhanced_audio');
    assert.equal(prov1!.masterWavePromoted, true);
    assert.ok(prov1!.presentLayers.includes('01_raw_source'));
    assert.ok(prov1!.presentLayers.includes('03_enhanced_audio'));
    assert.ok(prov1!.presentLayers.includes('04_classic_enhanced'));
    assert.ok(prov1!.presentLayers.includes('05_extended_model'));

    // Reprocess twice from purest source ("Anti-Photocopy") and verify `01_raw_source` never degrades
    const rawBytesBeforeReprocess = prov1!.layerStats['01_raw_source'].totalBytes;
    const provReproc1 = await p1.reprocessFromPurestSource({
      dspAlgorithm: 'enhanced',
      promoteToMasterWave: true,
      complexity: 8,
    });
    assert.equal(provReproc1.reprocessCount, 1);
    assert.equal(provReproc1.primarySourceLayer, '01_raw_source');
    assert.equal(
      provReproc1.layerStats['01_raw_source'].totalBytes,
      rawBytesBeforeReprocess
    );

    const provReproc2 = await p1.reprocessFromPurestSource({
      dspAlgorithm: 'legacy',
      promoteToMasterWave: true,
      complexity: 7,
    });
    assert.equal(provReproc2.reprocessCount, 2);
    assert.equal(provReproc2.primarySourceLayer, '01_raw_source');
    assert.equal(
      provReproc2.layerStats['01_raw_source'].totalBytes,
      rawBytesBeforeReprocess,
      '01_raw_source byte size must remain 100% unaltered across multiple reprocesses'
    );

    // Export 5-Layer Time Capsule ZIP & verify archive structure
    const capsuleZip = p1.buildModelZipBytes(88);
    const zipEntries = parseZipArchive(capsuleZip);
    const paths = zipEntries.map((e) => e.path);
    assert.ok(paths.includes('manifest.json'), 'Missing manifest.json');
    assert.ok(paths.includes('provenance.json'), 'Missing provenance.json');
    assert.ok(
      paths.some((p) => p.startsWith('01_raw_source/pure_lead.wav')),
      'Missing 01_raw_source/pure_lead.wav'
    );
    assert.ok(
      paths.includes('01_raw_source/native_map.json'),
      'Missing 01_raw_source/native_map.json'
    );
    assert.ok(
      paths.some((p) => p.startsWith('03_enhanced_audio/')),
      'Missing 03_enhanced_audio/* Master Wave'
    );
    assert.ok(
      paths.includes('04_classic_enhanced/MName'),
      'Missing 04_classic_enhanced/MName'
    );
    assert.ok(
      paths.includes('04_classic_enhanced/000001.sphere'),
      'Missing 04_classic_enhanced/000001.sphere'
    );
    assert.ok(
      paths.includes('05_extended_model/model.nmmodel'),
      'Missing 05_extended_model/model.nmmodel'
    );
    assert.ok(
      paths.includes('05_extended_model/extended_map.json'),
      'Missing 05_extended_model/extended_map.json'
    );

    const extracted = extractTimeCapsuleFromFiles([
      { name: 'Capsule88.zip', data: capsuleZip },
    ]);
    assert.equal(extracted.isTimeCapsule, true);
    assert.equal(extracted.manifest?.magic, 'NEURONMM_TIMECAPSULE');
    assert.equal(extracted.provenance?.reprocessCount, 2);
    assert.ok(extracted.rawSourceSamples.has('pure_lead.wav'));

    // Re-import Time Capsule ZIP into a fresh WebAudioPipeline
    const p2 = new WebAudioPipeline();
    await p2.init();
    const imported = await p2.importModelFiles([
      {
        name: 'Capsule88.zip',
        buffer: capsuleZip.buffer.slice(
          capsuleZip.byteOffset,
          capsuleZip.byteOffset + capsuleZip.byteLength
        ) as ArrayBuffer,
      },
    ]);
    assert.equal(imported.slot, 88);
    assert.equal(imported.provenance?.primarySourceLayer, '01_raw_source');
    assert.equal(imported.provenance?.reprocessCount, 2);

    // 3. Test Legacy `.model` Import Lineage (`02_legacy_original` -> `03_enhanced_audio` -> `04_classic_enhanced`)
    const p3 = new WebAudioPipeline();
    await p3.init();
    const dummyZones = [createZone(0, 60, 127, '000001.scape')];
    const scapeBin = zipEntries.find(
      (e) => e.path === '04_classic_enhanced/000001.scape'
    )!.data;
    const sphereBin = zipEntries.find(
      (e) => e.path === '04_classic_enhanced/000001.sphere'
    )!.data;
    const mapBytes = new TextEncoder().encode(serializeCanonicalMapScript(dummyZones));
    const mnameBytes = serializeMName('LegacyOrig');

    const toAb = (u8: Uint8Array): ArrayBuffer => {
      const c = new Uint8Array(u8.byteLength);
      c.set(u8);
      return c.buffer;
    };
    await p3.importModelFiles([
      { name: 'Models/091.model/MName', buffer: toAb(mnameBytes) },
      { name: 'Models/091.model/map.script', buffer: toAb(mapBytes) },
      { name: 'Models/091.model/000001.scape', buffer: toAb(scapeBin) },
      { name: 'Models/091.model/000001.sphere', buffer: toAb(sphereBin) },
    ]);

    const provLegacyBefore = p3.getModelProvenance(91);
    assert.ok(provLegacyBefore !== null);
    assert.equal(provLegacyBefore!.primarySourceLayer, '02_legacy_original');
    assert.ok(provLegacyBefore!.presentLayers.includes('02_legacy_original'));

    const provLegacyAfter = await p3.reprocessFromPurestSource({
      dspAlgorithm: 'enhanced',
      promoteToMasterWave: true,
      masterWaveConfig: { channelLayout: 'quad-surround', minLoopDurationSec: 2.5 },
    });
    assert.equal(provLegacyAfter.primarySourceLayer, '02_legacy_original');
    assert.equal(provLegacyAfter.activeAnalysisSourceLayer, '03_enhanced_audio');
    assert.equal(provLegacyAfter.reprocessCount, 1);
    assert.ok(provLegacyAfter.presentLayers.includes('02_legacy_original'));
    assert.ok(provLegacyAfter.presentLayers.includes('03_enhanced_audio'));
    assert.ok(provLegacyAfter.presentLayers.includes('04_classic_enhanced'));
    assert.ok(provLegacyAfter.presentLayers.includes('05_extended_model'));

    const legZip = p3.buildModelZipBytes(91);
    const legPaths = parseZipArchive(legZip).map((e) => e.path);
    assert.ok(
      legPaths.includes('02_legacy_original/000001.sphere'),
      'Untouched 02_legacy_original/000001.sphere must be preserved inside the Time Capsule'
    );
    assert.ok(
      legPaths.some((p) => p.startsWith('03_enhanced_audio/')),
      'Regenerated 24-bit/96kHz 03_enhanced_audio must be present'
    );

    p1.dispose();
    p2.dispose();
    p3.dispose();
  }
  console.log('[PASS] 15. Fase 9 5-Layer Time Capsule Container, Provenance, Anti-Photocopy Reprocess & IndexedDB Store');

  // ── 16. Common/Particular Architecture, Smart Empty Region Creation, 2D Overlap Detection & A/B/C Spectral Graphs ──
  {
    const {
      computeNextAvailableExtendedRange,
      analyzeExtendedIntersections,
      analyzeClassicZoneOverlaps,
      createDefaultCommonPlayback,
    } = await import('../src/core/extendedAdapter.ts');
    const { encodeWavPcm16 } = await import('../src/core/dsp/WavDecoder.ts');

    // 16a. computeNextAvailableExtendedRange finds gaps or splits largest span
    const next1 = computeNextAvailableExtendedRange([
      {
        id: 'r1',
        sampleName: 's1.wav',
        lowKey: 0,
        highKey: 59,
        rootKey: 36,
        lowVel: 1,
        highVel: 127,
        detune: 0,
        volume: 0,
        pan: 0,
        pitchKeytrack: 100,
        trigger: 'attack',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'equal-power',
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: 0,
        loopCrossfadeMs: 0,
      },
    ]);
    assert.equal(next1.lowKey, 60);
    assert.equal(next1.highKey, 127);

    // 16b. analyzeExtendedIntersections detects 2D (Key x Vel) vs Key-only overlaps
    const ovReport = analyzeExtendedIntersections([
      {
        id: 'r1',
        sampleName: 'a.wav',
        lowKey: 36,
        highKey: 72,
        rootKey: 60,
        lowVel: 1,
        highVel: 80,
        detune: 0,
        volume: 0,
        pan: 0,
        pitchKeytrack: 100,
        trigger: 'attack',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'equal-power',
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: 0,
        loopCrossfadeMs: 0,
      },
      {
        id: 'r2',
        sampleName: 'b.wav',
        lowKey: 48,
        highKey: 84,
        rootKey: 60,
        lowVel: 60,
        highVel: 127,
        detune: 0,
        volume: 0,
        pan: 0,
        pitchKeytrack: 100,
        trigger: 'attack',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'equal-power',
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: 0,
        loopCrossfadeMs: 0,
      },
      {
        id: 'r3',
        sampleName: 'c.wav',
        lowKey: 36,
        highKey: 72,
        rootKey: 60,
        lowVel: 81,
        highVel: 127,
        detune: 0,
        volume: 0,
        pan: 0,
        pitchKeytrack: 100,
        trigger: 'attack',
        keyFadeIn: 0,
        keyFadeOut: 0,
        velFadeIn: 0,
        velFadeOut: 0,
        fadeCurve: 'equal-power',
        loopMode: 'no_loop',
        loopStart: 0,
        loopEnd: 0,
        loopCrossfadeMs: 0,
      },
    ]);
    // r1 & r2 intersect in 2D: keys 48..72, vel 60..80
    // r2 & r3 intersect in 2D: keys 48..72, vel 81..127
    // r1 & r3 share keys 36..72 but velocities 1..80 vs 81..127 are disjoint -> keyOnlyOverlaps
    assert.equal(ovReport.byRegionId['r1'].fullIntersections.length, 1);
    assert.equal(ovReport.byRegionId['r1'].fullIntersections[0].id, 'r2');
    assert.equal(ovReport.byRegionId['r1'].keyOnlyOverlaps.length, 1);
    assert.equal(ovReport.byRegionId['r1'].keyOnlyOverlaps[0].id, 'r3');
    assert.ok(ovReport.intersectingKeySpans.length >= 1);
    assert.equal(ovReport.intersectingKeySpans[0].lowKey, 48);
    assert.equal(ovReport.intersectingKeySpans[0].highKey, 72);

    // Classic zone overlaps
    const classicOv = analyzeClassicZoneOverlaps([
      createZone(0, 48, 64, 'a.wav'),
      createZone(60, 72, 127, 'b.wav'),
    ]);
    const zIds = Object.keys(classicOv);
    assert.equal(classicOv[zIds[0]].overlappingZones.length, 1);
    assert.equal(classicOv[zIds[0]].overlappingZones[0].overlapLowKey, 60);
    assert.equal(classicOv[zIds[0]].overlappingZones[0].overlapHighKey, 64);

    // 16c. WebAudioPipeline smart addExtendedRegion (empty sample + next range) & Common Playback inheritance vs Custom Exception
    const cs = new WebAudioPipeline();
    await cs.init();
    await cs.newSession('TestExt');
    await cs.updateProcessConfig({ workingMode: 'extended' });
    const firstRegId = cs.getExtendedRegions()[0].id;
    await cs.updateExtendedRegion(firstRegId, {
      sampleName: 'lead_c3.wav',
      lowKey: 0,
      highKey: 59,
      rootKey: 48,
    });

    const createdReg = await cs.addExtendedRegion();
    const regionsAfter = cs.getExtendedRegions();
    assert.equal(regionsAfter.length, 2);
    assert.equal(createdReg.sampleName, '', 'New region must have an empty sampleName rather than cloning lead_c3.wav');
    assert.equal(createdReg.lowKey, 60, 'New region must automatically take the next available key range 60..127');
    assert.equal(createdReg.highKey, 127);

    // Common Playback propagation to non-overridden regions & preservation of overridden regions
    await cs.updateExtendedRegion(firstRegId, {
      hasPlaybackOverride: true,
      loopMode: 'loop_sustain',
      fadeCurve: 'linear',
    });
    const nextCommon = {
      ...createDefaultCommonPlayback(),
      loopMode: 'loop_continuous' as const,
      pitchKeytrack: 50,
      fadeCurve: 'spectral-morph' as const,
    };
    await cs.updateProcessConfig({ commonPlayback: nextCommon });
    const regionsCommon = cs.getExtendedRegions();
    const rOverridden = regionsCommon.find((r) => r.id === firstRegId)!;
    const rInherited = regionsCommon.find((r) => r.id === createdReg.id)!;
    assert.equal(rOverridden.loopMode, 'loop_sustain', 'Overridden region must keep its custom loopMode');
    assert.equal(rOverridden.fadeCurve, 'linear', 'Overridden region must keep its custom fadeCurve');
    assert.equal(rInherited.loopMode, 'loop_continuous', 'Inheriting region must receive commonPlayback.loopMode');
    assert.equal(rInherited.pitchKeytrack, 50, 'Inheriting region must receive commonPlayback.pitchKeytrack');
    assert.equal(rInherited.fadeCurve, 'spectral-morph', 'Inheriting region must receive commonPlayback.fadeCurve');

    // 16d. WebAudioPipeline.inspectZoneSpectrum produces distinct A (Original), B (Legacy DSP), and C (Enhanced DSP) spectrograms & partials
    const sr = 44100;
    const pcm = new Float32Array(Math.floor(sr * 0.4));
    for (let i = 0; i < pcm.length; i++) {
      const t = i / sr;
      pcm[i] =
        0.5 * Math.sin(2 * Math.PI * 220 * t) +
        0.25 * Math.sin(2 * Math.PI * 440 * t) +
        0.12 * Math.sin(2 * Math.PI * 660 * t);
    }
    const wavAb = encodeWavPcm16([pcm], sr);
    cs.registerSampleBuffer('test_abc.wav', wavAb);
    const z0 = cs.getSession()!.zones[0];
    await cs.updateZone(z0.id, { sampleLow: 'test_abc.wav', lowKey: 0, rootKey: 57, highKey: 127 });
    const insp = cs.inspectZoneSpectrum(z0.id);
    assert.ok(insp !== null, 'Expected non-null ZoneSpectralInspection');
    assert.ok(insp!.spectrogram.magnitudes.length > 0, 'Expected A Original spectrogram');
    assert.ok(insp!.legacySpectrogram && insp!.legacySpectrogram.magnitudes.length > 0, 'Expected B Legacy DSP spectrogram');
    assert.ok(insp!.enhancedSpectrogram && insp!.enhancedSpectrogram.magnitudes.length > 0, 'Expected C Enhanced DSP spectrogram');
    assert.ok(insp!.legacyPartials && insp!.legacyPartials.length === 64, 'Expected B Legacy 64 partials');
    assert.ok(insp!.enhancedPartials && insp!.enhancedPartials.length === 64, 'Expected C Enhanced 64 partials');
    assert.ok(insp!.enhancedResynthPeaks && insp!.enhancedResynthPeaks.max.length > 0, 'Expected C Enhanced waveform envelope');

    cs.dispose();
  }
  console.log('[PASS] 16. Common/Particular Architecture, Smart Empty Region Creation, 2D Overlap Detection & A/B/C Spectral Graphs');

  // ── 17. Fase 13 (Waveform Loop Editor & Seam Magnifier) & Fase 14 (Model Cover Artwork .webp in Layer 05) ──
  {
    const {
      snapFrameToRisingZeroCrossing,
      computeLoopSeamAnalysis,
      computeZoomedWaveformEnvelope,
    } = await import('../src/core/dsp/LoopEditorTools.ts');
    const {
      convertImageToCoverWebp,
      isWebpBytes,
      parseWebpDimensions,
    } = await import('../src/core/coverArtwork.ts');
    const { extractTimeCapsuleFromFiles } = await import('../src/core/timeCapsule.ts');
    const { parseZipArchive } = await import('@abdsynths/shared/formats/neuron');
    const { encodeWavPcm16 } = await import('../src/core/dsp/WavDecoder.ts');

    // 17a. Fase 13: snapFrameToRisingZeroCrossing & computeLoopSeamAnalysis
    const sr = 44100;
    const freq = 220; // period = 200.4545 samples
    const pcm = new Float32Array(20000);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = 0.8 * Math.sin((2 * Math.PI * freq * i) / sr);
    }

    const snappedStart = snapFrameToRisingZeroCrossing(pcm, 2005, 120);
    assert.ok(pcm[snappedStart - 1] <= 0 && pcm[snappedStart] >= 0, 'Snapped start must be a rising zero-crossing');
    const snappedEnd = snapFrameToRisingZeroCrossing(pcm, 12027, 120);
    assert.ok(pcm[snappedEnd - 1] <= 0 && pcm[snappedEnd] >= 0, 'Snapped end must be a rising zero-crossing');

    const goodSeam = computeLoopSeamAnalysis(pcm, snappedStart, snappedEnd, 64);
    assert.ok(goodSeam.stepDiscontinuity < 0.05, `Expected small step discontinuity, got ${goodSeam.stepDiscontinuity}`);
    assert.ok(goodSeam.seamQualityPercent >= 85, `Expected high seam quality >= 85%, got ${goodSeam.seamQualityPercent}%`);

    // Deliberately bad splice (quarter period offset -> peak-to-zero jump)
    const badEnd = snappedEnd + Math.round(sr / freq / 4);
    const badSeam = computeLoopSeamAnalysis(pcm, snappedStart, badEnd, 64);
    assert.ok(
      goodSeam.seamQualityPercent > badSeam.seamQualityPercent,
      `Phase-aligned zero-crossing seam (${goodSeam.seamQualityPercent}%) must score higher than misaligned seam (${badSeam.seamQualityPercent}%)`
    );

    const zoomed = computeZoomedWaveformEnvelope(pcm, 1000, 5000, 100);
    assert.equal(zoomed.min.length, 100);
    assert.equal(zoomed.max.length, 100);
    assert.equal(zoomed.viewStartFrame, 1000);
    assert.equal(zoomed.viewEndFrame, 5000);

    // 17b. Fase 14: convertImageToCoverWebp + Extended Mode Time Capsule packaging (`05_extended_model/cover.webp`)
    const fakePngInput = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5, 6, 7, 8]);
    const converted = await convertImageToCoverWebp(fakePngInput, {
      targetSize: 512,
      originalName: 'SynthCover.png',
    });
    assert.equal(isWebpBytes(converted.webpBytes), true, 'Converted cover must be a valid RIFF WEBP binary');
    const dims = parseWebpDimensions(converted.webpBytes);
    assert.equal(dims.width, 512);
    assert.equal(dims.height, 512);
    assert.ok(converted.artwork.webpDataUrl.startsWith('data:image/webp;base64,'));
    assert.equal(converted.artwork.originalName, 'SynthCover.png');

    const cs = new WebAudioPipeline();
    await cs.init();
    await cs.newSession('CoverLoopTest');
    await cs.updateProcessConfig({
      modelNumber: 142,
      modelName: 'CoverTest',
      workingMode: 'extended',
      targetFormat: 'dual',
    });
    const wavAb = encodeWavPcm16([pcm], sr);
    cs.registerSampleBuffer('loop_test.wav', wavAb);
    const reg0 = cs.getExtendedRegions()[0];
    await cs.updateExtendedRegion(reg0.id, {
      sampleName: 'loop_test.wav',
      loopMode: 'loop_sustain',
      loopStart: snappedStart,
      loopEnd: snappedEnd,
      loopCrossfadeMs: 25,
    });

    const loopEdData = cs.getZoneLoopEditorData(undefined, reg0.id);
    assert.ok(loopEdData !== null);
    assert.equal(loopEdData!.loopStart, snappedStart);
    assert.equal(loopEdData!.loopEnd, snappedEnd);
    assert.equal(loopEdData!.loopCrossfadeMs, 25);
    assert.equal(loopEdData!.loopMode, 'loop_sustain');

    // Set cover artwork and build Time Capsule ZIP
    const art = await cs.convertAndSetModelCoverArtwork(fakePngInput, 'Artwork.png');
    assert.equal(art.width, 512);
    const zipBytes = cs.buildModelZipBytes(142);
    const entries = parseZipArchive(zipBytes);
    const paths = entries.map((e) => e.path);

    assert.ok(
      paths.includes('05_extended_model/cover.webp'),
      'Extended Time Capsule must include 05_extended_model/cover.webp'
    );
    assert.ok(
      !paths.some((p) => p.startsWith('04_classic_enhanced/') && p.endsWith('.webp')),
      'Classic enhanced layer must NEVER include .webp files'
    );
    assert.ok(
      !paths.some((p) => p.startsWith('Models/') && p.endsWith('.webp')),
      'Classic hardware Models/<NNN>.model directory must NEVER include .webp files'
    );

    const extracted = extractTimeCapsuleFromFiles([{ name: 'Model142.zip', data: zipBytes }]);
    assert.equal(extracted.manifest?.hasCoverArtwork, true);
    assert.ok(extracted.coverWebpBytes !== null && isWebpBytes(extracted.coverWebpBytes!));
    assert.ok(extracted.manifest?.processConfig.coverArtwork?.webpDataUrl.startsWith('data:image/webp;base64,'));

    // 17c. Persistence of coverArtwork & commonPlayback across JSON serialization
    const { parseSessionJson } = await import('../src/core/sessionSchema.ts');
    const exportedJson = cs.exportSessionJson();
    const restoredSession = parseSessionJson(exportedJson);
    assert.ok(restoredSession.processConfig.coverArtwork !== null, 'Restored session must preserve coverArtwork');
    assert.equal(restoredSession.processConfig.coverArtwork?.width, 512);
    assert.equal(restoredSession.processConfig.coverArtwork?.height, 512);
    assert.ok(
      restoredSession.processConfig.coverArtwork?.webpDataUrl.startsWith('data:image/webp;base64,'),
      'Restored session must preserve valid webpDataUrl'
    );

    // 17d. findSmartAutoLoop multi-algorithm test
    const { findSmartAutoLoop, generatePingPongLoopBuffer, applyLoopCrossfade } =
      await import('../src/core/dsp/LoopEditorTools.ts');

    const resPitch = findSmartAutoLoop(pcm, sr, { algorithm: 'pitch_periodic', knownF0Hz: 220 });
    assert.equal(resPitch.algorithm, 'pitch_periodic');
    assert.ok(resPitch.loopStart < resPitch.loopEnd);
    assert.ok(resPitch.cyclesCount !== undefined && resPitch.cyclesCount >= 2);
    assert.ok(resPitch.qualityPercent >= 80, 'Periodic pitch-lock loop should achieve high seam quality');

    const resNcc = findSmartAutoLoop(pcm, sr, { algorithm: 'ncc_zc' });
    assert.equal(resNcc.algorithm, 'ncc_zc');
    assert.ok(resNcc.nccScore > 0.8, 'NCC algorithm should find highly correlated zero-crossings');

    const resSeam = findSmartAutoLoop(pcm, sr, { algorithm: 'min_seam_energy' });
    assert.equal(resSeam.algorithm, 'min_seam_energy');
    assert.ok(resSeam.stepDiscontinuity < 0.1, 'Min seam energy algorithm should have minimal step jump');

    const resXfade = findSmartAutoLoop(pcm, sr, { algorithm: 'equal_power_xfade' });
    assert.equal(resXfade.algorithm, 'equal_power_xfade');
    assert.ok(resXfade.loopCrossfadeMs >= 15 && resXfade.loopCrossfadeMs <= 80);
    assert.ok(resXfade.qualityPercent >= 95);

    // 17e. Ping-Pong buffer generation & crossfade application
    const pp = generatePingPongLoopBuffer(pcm, 1000, 5000);
    assert.equal(pp.pcm.length, pcm.length + 4000);
    assert.equal(pp.loopStart, 1000);
    assert.equal(pp.loopEnd, 1000 + 2 * 4000); // 9000
    // Check that reversed slice is mirror of forward slice
    assert.equal(pp.pcm[5000], pcm[4999]);
    assert.equal(pp.pcm[5000 + 3999], pcm[1000]);

    const xfPcm = applyLoopCrossfade(pcm, 1000, 5000, 100, 'equal-power');
    assert.equal(xfPcm.length, pcm.length);
    assert.ok(Number.isFinite(xfPcm[4999]));

    cs.dispose();
  }
  console.log('[PASS] 17. Fase 13 (Waveform Loop Editor & Seam Magnifier) & Fase 14 (Model Cover Artwork .webp in Layer 05)');

  // ── 18. Fase 10.B: AI Assistance vs Algorithmic DSP Matrix & Companion Bridge ──
  {
    const { DEFAULT_AI_ASSISTANCE_CONFIG } = await import('../src/core/types.ts');
    const { BridgeClient, DEFAULT_BRIDGE_URL } = await import('../src/core/bridge/BridgeClient.ts');
    const { parseSessionJson } = await import('../src/core/sessionSchema.ts');

    // 18a. Default configuration verification
    assert.equal(DEFAULT_BRIDGE_URL, 'http://127.0.0.1:7860');
    assert.equal(DEFAULT_AI_ASSISTANCE_CONFIG.enabled, false);
    assert.equal(DEFAULT_AI_ASSISTANCE_CONFIG.masterWave, 'dsp');
    assert.equal(DEFAULT_AI_ASSISTANCE_CONFIG.separation, 'dsp');
    assert.equal(DEFAULT_AI_ASSISTANCE_CONFIG.loopExpansion, 'dsp');
    assert.equal(DEFAULT_AI_ASSISTANCE_CONFIG.classifier, 'dsp');
    assert.equal(DEFAULT_AI_ASSISTANCE_CONFIG.denoise, 'dsp');

    // 18b. Modular per-stage configuration & session roundtrip
    const p = new WebAudioPipeline();
    await p.init();
    await p.newSession('AiMatrixSession');

    // Default session must have aiConfig initialized
    const sess = p.getSession()!;
    assert.ok(sess.processConfig.aiConfig !== undefined);
    assert.equal(sess.processConfig.aiConfig.enabled, false);

    // Update with hybrid profile: DSP master wave + AI separation & loop outpainting
    p.updateProcessConfig({
      aiConfig: {
        enabled: true,
        masterWave: 'dsp',
        separation: 'ai',
        loopExpansion: 'ai',
        classifier: 'dsp',
        denoise: 'dsp',
      },
    });

    const updated = p.getSession()!;
    assert.equal(updated.processConfig.aiConfig?.enabled, true);
    assert.equal(updated.processConfig.aiConfig?.separation, 'ai');
    assert.equal(updated.processConfig.aiConfig?.loopExpansion, 'ai');
    assert.equal(updated.processConfig.aiConfig?.masterWave, 'dsp');

    // JSON export & schema validation roundtrip
    const jsonStr = p.exportSessionJson();
    const parsed = parseSessionJson(jsonStr);
    assert.equal(parsed.processConfig.aiConfig?.enabled, true);
    assert.equal(parsed.processConfig.aiConfig?.separation, 'ai');
    assert.equal(parsed.processConfig.aiConfig?.loopExpansion, 'ai');
    assert.equal(parsed.processConfig.aiConfig?.masterWave, 'dsp');

    // 18c. BridgeClient headless initialization & URL handling
    const client = new BridgeClient('http://127.0.0.1:7860/');
    assert.equal(client.getUrl(), 'http://127.0.0.1:7860');
    assert.equal(client.isConnected(), false);
    assert.equal(client.getStatus().connected, false);

    client.setUrl('http://localhost:8389');
    assert.equal(client.getUrl(), 'http://localhost:8389');

    p.dispose();
  }
  console.log('[PASS] 18. Fase 10.B (Modular AI Assistance vs DSP Matrix & Local Bridge Client)');

  // ── 19. Fase 17: Dual-Name Independence (Classic vs Extended) & Extended Metadata ──
  {
    const pipe = new WebAudioPipeline();
    await pipe.init();
    await pipe.newSession('DualNameTest');

    // Initially both informed with the same base name
    const initialCfg = pipe.getSession()!.processConfig;
    assert.equal(initialCfg.modelName, 'NewModel');
    assert.equal(initialCfg.expandedName, 'NewModel');

    // 19a. Switch to Extended Mode and set a long, expressive name
    await pipe.updateProcessConfig({
      workingMode: 'extended',
      expandedName: 'Stradivarius Solo Cello Expressive Legato 1982',
    });

    const extCfg = pipe.getSession()!.processConfig;
    assert.equal(extCfg.workingMode, 'extended');
    assert.equal(extCfg.expandedName, 'Stradivarius Solo Cello Expressive Legato 1982');
    assert.ok(extCfg.expandedName.length > 11);

    // 19b. Switch to Classic Mode: classic modelName must be <= 11 chars and NOT corrupt expandedName
    await pipe.updateProcessConfig({
      workingMode: 'classic',
      modelName: 'STRADCELLO1',
    });

    const classicCfg = pipe.getSession()!.processConfig;
    assert.equal(classicCfg.workingMode, 'classic');
    assert.equal(classicCfg.modelName, 'STRADCELLO1');
    assert.equal(classicCfg.modelName.length, 11);
    // expandedName remains completely intact!
    assert.equal(classicCfg.expandedName, 'Stradivarius Solo Cello Expressive Legato 1982');

    // 19c. Switch BACK to Extended Mode: expandedName is still full and untruncated!
    await pipe.updateProcessConfig({
      workingMode: 'extended',
    });

    const reExtCfg = pipe.getSession()!.processConfig;
    assert.equal(reExtCfg.workingMode, 'extended');
    assert.equal(reExtCfg.expandedName, 'Stradivarius Solo Cello Expressive Legato 1982');
    assert.equal(reExtCfg.modelName, 'STRADCELLO1');

    // 19d. ExtendedModelMetadata persistence and custom tag attributes
    await pipe.updateProcessConfig({
      extendedMetadata: {
        author: 'Axel & ABD Acoustics',
        version: '2.4.0',
        license: 'CC-BY-SA 4.0',
        sourceUrl: 'https://polyphone.io/en/soundfonts/strad-1982',
        sourceFormat: 'sf2',
        description: 'Recorded in Berlin chamber hall with vintage Telefunken U47',
        customAttributes: [
          { tag: 'Microphone', value: 'Telefunken U47' },
          { tag: 'Hall', value: 'Berlin Chamber' },
        ],
      },
    });

    const metaCfg = pipe.getSession()!.processConfig;
    assert.equal(metaCfg.extendedMetadata?.author, 'Axel & ABD Acoustics');
    assert.equal(metaCfg.extendedMetadata?.version, '2.4.0');
    assert.equal(metaCfg.extendedMetadata?.license, 'CC-BY-SA 4.0');
    assert.equal(metaCfg.extendedMetadata?.customAttributes?.length, 2);
    assert.equal(metaCfg.extendedMetadata?.customAttributes?.[0].tag, 'Microphone');
    assert.equal(metaCfg.extendedMetadata?.customAttributes?.[0].value, 'Telefunken U47');

    // 19e. Session JSON roundtrip & validation
    const jsonStr = pipe.exportSessionJson();
    const restored = parseSessionJson(jsonStr);
    assert.equal(restored.processConfig.expandedName, 'Stradivarius Solo Cello Expressive Legato 1982');
    assert.equal(restored.processConfig.modelName, 'STRADCELLO1');
    assert.equal(restored.processConfig.extendedMetadata?.license, 'CC-BY-SA 4.0');
    assert.equal(restored.processConfig.extendedMetadata?.customAttributes?.length, 2);

    pipe.dispose();
  }
  console.log('[PASS] 19. Fase 17 (Doble Nomenclatura: modelName vs expandedName & ExtendedModelMetadata)');

  console.log('=== ALL PHASE 6, 7, 8, 9, 13, 14 & 18 TESTS PASSED ===');
}

runPhase6Tests().catch((err) => {
  console.error('Phase 6 test failed:', err);
  process.exit(1);
});
