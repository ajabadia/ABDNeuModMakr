// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Zone Templates Snapshot Suite
// Pure HTML builders in `ui/zoneInspector/zoneTemplates.ts`:
// fixed fixtures → structural assertions (no DOM, no golden files).
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import { createZone } from '../src/core/sessionFactory.ts';
import type { ExtendedRegion, Zone } from '../src/core/types.ts';
import {
  basenameOf,
  findZoneIdForRegion,
  formatRegionModeBadge,
  renderExtendedRegionTableRows,
  renderGmDrumOptions,
  renderModelCommonSectionsHtml,
  renderModelMetadataPaneHtml,
  renderRegionLoopAndExceptionsHtml,
  renderZoneTableRows,
} from '../src/ui/zoneInspector/zoneTemplates.ts';
import type {
  ModelCommonTemplateDeps,
  RegionLoopTemplateDeps,
} from '../src/ui/zoneInspector/zoneTemplates.ts';

function zoneFixture(): Zone[] {
  const a = createZone(0, 60, 127, 'Piano_60_C4.wav');
  a.sampleHigh = 'Piano_60_C4_v2.wav';
  a.velSplit = 64;
  const b = createZone(0, 38, 60, '../../evil.wav');
  return [a, b];
}

function regionFixture(): ExtendedRegion[] {
  return [
    {
      id: 'reg-1',
      sampleName: 'Piano_60_C4.wav',
      lowKey: 0,
      rootKey: 60,
      highKey: 127,
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
      loopMode: 'loop_continuous',
      loopStart: 100,
      loopEnd: 4000,
      loopCrossfadeMs: 15,
    },
    {
      id: 'reg-2',
      sampleName: 'Drums.wav',
      lowKey: 36,
      rootKey: 38,
      highKey: 36,
      lowVel: 1,
      highVel: 127,
      detune: 0,
      volume: 0,
      pan: 0,
      pitchKeytrack: 0,
      trigger: 'attack',
      keyFadeIn: 0,
      keyFadeOut: 0,
      velFadeIn: 0,
      velFadeOut: 0,
      fadeCurve: 'equal-power',
      loopMode: 'one_shot',
      loopStart: 0,
      loopEnd: 0,
      loopCrossfadeMs: 0,
    },
  ];
}

function loopDeps(): RegionLoopTemplateDeps {
  return {
    getCommonPlayback: () => undefined,
    getArticulation: () => undefined,
    getZoneClassification: () => undefined,
    getDetectedCategory: () => 'Piano',
    getZoneSampleFormatInfo: () => ({
      sampleName: 'Piano_60_C4.wav',
      sampleRate: 44100,
      bitsPerSample: 16,
      numChannels: 2,
      durationSec: 1.0,
      loopStart: 100,
      loopEnd: 4000,
    }),
    isAuditionPlaying: () => false,
    getLoopData: () => ({
      zoneId: 'z',
      sampleRate: 44100,
      totalFrames: 44100,
      loopStart: 100,
      loopEnd: 4000,
      loopCrossfadeMs: 15,
      loopMode: 'loop_continuous',
      sampleName: 'Piano_60_C4.wav',
      numChannels: 2,
      durationSec: 1.0,
      monoPcm: new Float32Array(8),
      rootKey: 60,
    }),
    snapZeroCrossing: true,
    selectedAlgo: 'pitch_periodic',
  };
}

function modelDeps(): ModelCommonTemplateDeps {
  return {
    activeModelSubTab: 'common-playback',
    getArticulation: () => undefined,
    getCommonPlayback: () => undefined,
    getAssetStoreDiagnostics: () => undefined,
    getMasterWaveConfig: () => undefined,
    getModelProvenance: () => null,
    getExtendedMetadata: () => undefined,
    getZoneSampleFormatInfo: () => null,
    extendedMetadata: undefined,
    metadataHtml: '',
  };
}

async function runZoneTemplateTests(): Promise<void> {
  console.log('=== Zone Templates Snapshot Suite ===');

  // 1. basenames + mode badges: pure string helpers
  assert.equal(basenameOf('a/b/Piano_60_C4.wav'), 'Piano_60_C4.wav');
  assert.equal(basenameOf(null), '');
  assert.equal(formatRegionModeBadge(regionFixture()[0]), 'Loop');
  assert.ok(formatRegionModeBadge(regionFixture()[1]).startsWith('One-Shot'), 'one-shot badge');
  console.log('[PASS] 1. basenameOf + formatRegionModeBadge');

  // 2. classic zone rows: names escaped, traversal payload neutralized
  const zones = zoneFixture();
  const classic = renderZoneTableRows(zones, zones[0].id, {
    keyMappingMode: 'chromatic',
    playingRowId: null,
  });
  assert.ok(classic.includes('Piano_60_C4.wav'), 'sample name rendered');
  // Full path only appears inside escAttr-escaped title tooltips, never as raw markup
  assert.ok(!classic.includes(`'../../evil.wav'`) && !classic.includes('>../../evil.wav<'), 'traversal path must not leak as raw text node');
  assert.ok(classic.includes('zone-table-row'), 'row class present');
  console.log('[PASS] 2. renderZoneTableRows chromatic + escape');

  // 3. drum mode: root key renders drum piece label, collides on same root
  const drum = renderZoneTableRows(
    [zones[0], { ...zones[0], id: 'zone-dup' }],
    zones[0].id,
    { keyMappingMode: 'drum', playingRowId: null }
  );
  assert.ok(drum.includes('Hi Bongo (60'), 'drum label for root 60 (Hi Bongo)');
  assert.ok(drum.includes('has-drum-collision'), 'duplicate root must flag collision');
  console.log('[PASS] 3. renderZoneTableRows drum mode + collision');

  // 4. extended region rows: region table + zone mapping
  const regions = regionFixture();
  const ext = renderExtendedRegionTableRows(regions, 'reg-1', zones, zones[0], {
    keyMappingMode: 'chromatic',
    playingRowId: null,
  });
  assert.ok(ext.includes('reg-1') || ext.includes('Region'), 'region rendered');
  assert.ok(ext.includes('One-Shot'), 'mode badge for reg-2 rendered');
  assert.equal(findZoneIdForRegion(zones, zones[0], regions[0]), zones[0].id);
  console.log('[PASS] 4. renderExtendedRegionTableRows + findZoneIdForRegion');

  // 5. drum options: current marked, used flagged
  const opts = renderGmDrumOptions(38, 'zone-x', [
    { id: 'zone-a', index: 1, rootKey: 36 },
    { id: 'zone-x', index: 2, rootKey: 38 },
  ]);
  assert.ok(opts.includes('[Current]'), 'current option marked');
  assert.ok(opts.includes('[In Use: #1]'), 'used piece flagged');
  console.log('[PASS] 5. renderGmDrumOptions current/used flags');

  // 6. loop section: renders editor shell with loop frames, escaped category
  const loop = renderRegionLoopAndExceptionsHtml(zones[0], regions[0], loopDeps());
  assert.ok(loop.includes('INTERACTIVE WAVEFORM LOOP EDITOR'), 'loop editor shell');
  assert.ok(loop.includes('100') && loop.includes('4000'), 'loop frames present');
  assert.ok(loop.includes('Piano'), 'detected category rendered');
  console.log('[PASS] 6. renderRegionLoopAndExceptionsHtml shell');

  // 7. model common: tab bar + metadata pane delegated
  const meta = renderModelMetadataPaneHtml({ author: 'ABDSynths <x>' } as never);
  assert.ok(!meta.includes('<x>'), 'metadata author escaped');
  const common = renderModelCommonSectionsHtml(zones[0], regions, {
    ...modelDeps(),
    metadataHtml: meta,
  });
  assert.ok(common.includes('drawer-subtab-bar'), 'model common subtab bar shell');
  console.log('[PASS] 7. renderModelCommonSectionsHtml + metadata escape');

  // 8. XSS: malicious sample/zone names never produce raw markup
  const evil = createZone(60, 60, 60, '"><img src=x onerror=alert(1)>.wav');
  const evilHtml = renderZoneTableRows([evil], evil.id, {
    keyMappingMode: 'chromatic',
    playingRowId: null,
  });
  assert.ok(!evilHtml.includes('<img src=x'), 'injected tag must be escaped');
  assert.ok(evilHtml.includes('&lt;img'), 'escaped entity present');
  console.log('[PASS] 8. XSS payload neutralized in rows');

  console.log('=== ALL ZONE TEMPLATE TESTS PASSED ===');
}

runZoneTemplateTests().catch((err) => {
  console.error('Zone template test failed:', err);
  process.exit(1);
});
