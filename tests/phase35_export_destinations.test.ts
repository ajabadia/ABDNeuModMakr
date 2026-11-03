// ─────────────────────────────────────────────────────────
// Tests — Fase 35.2: Export by Destination & Time Capsule Naming
// ─────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import {
  TIME_CAPSULE_CANONICAL_LABEL,
  TIME_CAPSULE_ES_LABEL,
  buildExportDestinationCards,
  resolveExportDestinationSummary,
  triggerExportDestinationAction,
} from '../src/app/exportDestinations.ts';
import type { RawSamplerFormat } from '../src/core/export/rawSamplerTypes.ts';

async function runTests(): Promise<void> {
  // 1. Canonical Time Capsule labels
  assert.equal(TIME_CAPSULE_CANONICAL_LABEL, 'Time Capsule (.zip)');
  assert.equal(TIME_CAPSULE_ES_LABEL, 'Cápsula del Tiempo (.zip)');

  // 2. Destination catalog structure (3 musician-oriented cards)
  const cards = buildExportDestinationCards();
  assert.equal(cards.length, 3);
  assert.deepEqual(
    cards.map((c) => c.id),
    ['time-capsule', 'other-samplers', 'raw-audio']
  );
  assert.ok(cards[0].title.includes('AxionikVS') && cards[0].title.includes('Cápsula del Tiempo'));
  assert.ok(cards[1].title.includes('otros samplers'));
  assert.ok(cards[2].title.includes('Solo audio'));

  // 3. Session summary resolution for Classic & Extended modes
  const classicSummary = resolveExportDestinationSummary({
    modelName: 'VintPad01',
    expandedName: 'Vintage Warm Pad Expanded',
    slot: 7,
    workingMode: 'classic',
    zoneCount: 4,
    regionCount: 12,
    hasActiveZoneSample: true,
  });
  assert.equal(classicSummary.displayName, 'VintPad01');
  assert.equal(classicSummary.slotLabel, '#007');
  assert.ok(classicSummary.modeLabel.includes('Classic'));
  assert.equal(classicSummary.zonesLabel, '4 zonas');

  const extendedSummary = resolveExportDestinationSummary({
    modelName: 'VintPad01',
    expandedName: 'Vintage Warm Pad Expanded',
    slot: 42,
    workingMode: 'extended',
    zoneCount: 4,
    regionCount: 12,
    hasActiveZoneSample: false,
  });
  assert.equal(extendedSummary.displayName, 'Vintage Warm Pad Expanded');
  assert.equal(extendedSummary.slotLabel, '#042');
  assert.ok(extendedSummary.modeLabel.includes('Extended'));
  assert.equal(extendedSummary.zonesLabel, '12 regiones');

  // 4. Routing to existing exporters without rewriting them
  const calls: Array<{ handler: string; arg?: RawSamplerFormat }> = [];
  const callbacks = {
    onExportTimeCapsule: async () => {
      calls.push({ handler: 'time-capsule' });
    },
    onExportTimeCapsuleAs: async () => {
      calls.push({ handler: 'time-capsule-as' });
    },
    onSaveToAxionikDb: async () => {
      calls.push({ handler: 'axionikdb' });
    },
    onExportSampler: (fmt?: RawSamplerFormat) => {
      calls.push({ handler: 'sampler', arg: fmt });
    },
    onExportZoneAiff: () => {
      calls.push({ handler: 'zone-aiff' });
    },
  };

  await triggerExportDestinationAction('time-capsule', callbacks);
  await triggerExportDestinationAction('time-capsule', callbacks, 'axionikdb');
  await triggerExportDestinationAction('time-capsule', callbacks, 'time-capsule-as');
  await triggerExportDestinationAction('other-samplers', callbacks);
  await triggerExportDestinationAction('other-samplers', callbacks, 'fmt-nki');
  await triggerExportDestinationAction('other-samplers', callbacks, 'fmt-dspreset');
  await triggerExportDestinationAction('raw-audio', callbacks);
  await triggerExportDestinationAction('raw-audio', callbacks, 'wav-chain');

  assert.deepEqual(calls, [
    { handler: 'time-capsule' },
    { handler: 'axionikdb' },
    { handler: 'time-capsule-as' },
    { handler: 'sampler', arg: undefined },
    { handler: 'sampler', arg: 'nki' },
    { handler: 'sampler', arg: 'dspreset' },
    { handler: 'zone-aiff' },
    { handler: 'sampler', arg: 'sample_chain' },
  ]);

  console.log('PASS: phase35_export_destinations (4/4 assertions)');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
