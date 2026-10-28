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
import { ImportHandlers, type ImportContext } from '../src/app/importHandlers.ts';
import { MenuActions, type MenuContext } from '../src/app/menuActions.ts';
import type { CoreService } from '../src/core/CoreService.ts';
import type { ProcessConfig, Session } from '../src/core/types.ts';

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

  // ── 9. workingMode extended (gated on modern-neural, legacy untouched) ──
  {
    const p = new WebAudioPipeline();
    await p.init();
    await p.newSession('ExtMode');

    // Gate: extended requires modern-neural
    assert.throws(() => p.updateProcessConfig({ workingMode: 'extended' }), /modern-neural/);
    assert.equal(p.getSession()?.processConfig.workingMode, undefined);

    // Enable behind modern-neural
    p.updateProcessConfig({ targetFormat: 'modern-neural' });
    p.updateProcessConfig({ workingMode: 'extended' });
    assert.equal(p.getSession()?.processConfig.workingMode, 'extended');

    // velSplit honored in extended…
    const zid = p.getSession()!.zones[0].id;
    await p.updateZone(zid, { velSplit: 100 });
    assert.equal(p.getSession()!.zones[0].velSplit, 100);

    // …and leaving modern-neural resets to classic + forces 64 again
    p.updateProcessConfig({ targetFormat: 'legacy-neuron' });
    assert.equal(p.getSession()?.processConfig.workingMode, 'classic');
    await p.updateZone(zid, { velSplit: 100 });
    assert.equal(p.getSession()!.zones[0].velSplit, 64);

    // Session JSON gate mirrors the core gate
    p.updateProcessConfig({ targetFormat: 'modern-neural', workingMode: 'extended' });
    const exported = JSON.parse(p.exportSessionJson());
    assert.equal(exported.session.processConfig.workingMode, 'extended');
    exported.session.processConfig.targetFormat = 'dual';
    await assert.rejects(p.loadSessionFromJson(JSON.stringify(exported)), /modern-neural/);
    exported.session.processConfig.targetFormat = 'modern-neural';
    const reloaded = await p.loadSessionFromJson(JSON.stringify(exported));
    assert.equal(reloaded.processConfig.workingMode, 'extended');

    p.dispose();
  }
  console.log('[PASS] 9. workingMode extended gating, velSplit honor/force, JSON gate');

  // ── 10. updateProcessConfig validates BEFORE recording history ──
  {
    const p = new WebAudioPipeline();
    await p.init();
    await p.newSession('HistGuard');
    assert.equal(p.getHistoryState().canUndo, false);

    // Rejected change must not leave a phantom undo step
    assert.throws(() => p.updateProcessConfig({ workingMode: 'extended' }), /modern-neural/);
    assert.equal(p.getHistoryState().canUndo, false);

    // Accepted change records exactly one step
    p.updateProcessConfig({ targetFormat: 'modern-neural' });
    assert.equal(p.getHistoryState().canUndo, true);
    p.undo();
    assert.equal(p.getHistoryState().canUndo, false);

    p.dispose();
  }
  console.log('[PASS] 10. updateProcessConfig history-after-validation');

  console.log('=== ALL PHASE 6 TESTS PASSED ===');
}

runPhase6Tests().catch((err) => {
  console.error('Phase 6 test failed:', err);
  process.exit(1);
});
