// Unit tests: keyboard note + velocity → classic zone/layer & extended regions
import assert from 'node:assert/strict';
import {
  classicLayerForVelocity,
  resolveClassicNoteTargets,
  resolveExtendedNoteTargets,
  resolveRowAuditionSpan,
  toMidiVelocity,
} from '../src/core/noteMapping.ts';
import type { ExtendedRegion, Zone } from '../src/core/types.ts';

const zone = (p: Partial<Zone>): Zone =>
  ({ id: 'z', lowKey: 0, highKey: 127, rootKey: 60, detune: 0, volume: 0, pan: 0, sampleLow: null, sampleHigh: null, ...p }) as Zone;
const region = (p: Partial<ExtendedRegion>): ExtendedRegion =>
  ({ id: 'r', sampleName: '', lowKey: 0, highKey: 127, rootKey: 60, lowVel: 1, highVel: 127, ...p }) as ExtendedRegion;

// toMidiVelocity
assert.equal(toMidiVelocity(undefined), 100);
assert.equal(toMidiVelocity(0), 1);
assert.equal(toMidiVelocity(1), 127);
assert.equal(toMidiVelocity(0.5), 64);
assert.equal(toMidiVelocity(90), 90);

// Classic layers follow the table ranges (Low 1..split-1, High split..127)
const zA = zone({ id: 'a', lowKey: 0, highKey: 59, sampleLow: 'a_lo.wav', sampleHigh: 'a_hi.wav', velSplit: 80 });
const zB = zone({ id: 'b', lowKey: 60, highKey: 127, rootKey: 72, sampleLow: 'b_lo.wav' });
assert.equal(classicLayerForVelocity(zA, 79), 'low');
assert.equal(classicLayerForVelocity(zA, 80), 'high');
assert.equal(classicLayerForVelocity(zB, 127), 'low', 'no High Vel sample → Low covers 1..127');

let t = resolveClassicNoteTargets([zA, zB], 40, 100);
assert.deepEqual([t.zoneId, t.layer, t.sampleName, t.rootKey], ['a', 'high', 'a_hi.wav', 60]);
t = resolveClassicNoteTargets([zA, zB], 40, 20);
assert.deepEqual([t.zoneId, t.layer, t.sampleName], ['a', 'low', 'a_lo.wav']);
t = resolveClassicNoteTargets([zA, zB], 64, 120);
assert.deepEqual([t.zoneId, t.layer, t.sampleName, t.rootKey], ['b', 'low', 'b_lo.wav', 72]);

// Extended: key AND velocity must match; shared-key velocity layers resolve separately
const soft = region({ id: 'soft', lowKey: 48, highKey: 71, lowVel: 1, highVel: 63, sampleName: 'soft.wav', rootKey: 60 });
const loud = region({ id: 'loud', lowKey: 48, highKey: 71, lowVel: 64, highVel: 127, sampleName: 'loud.wav', rootKey: 62 });
const rrA = region({ id: 'rrA', lowKey: 72, highKey: 84, sampleName: 'rr1.wav' });
const rrB = region({ id: 'rrB', lowKey: 72, highKey: 84, sampleName: 'rr2.wav' });
const regs = [soft, loud, rrA, rrB];

let e = resolveExtendedNoteTargets(regs, 60, 30);
assert.deepEqual(e.regionIds, ['soft']);
assert.equal(e.sampleName, 'soft.wav');
e = resolveExtendedNoteTargets(regs, 60, 100);
assert.deepEqual([e.regionIds, e.sampleName, e.rootKey], [['loud'], 'loud.wav', 62]);
e = resolveExtendedNoteTargets(regs, 76, 100);
assert.deepEqual(e.regionIds, ['rrA', 'rrB'], 'all overlapping regions highlighted');
e = resolveExtendedNoteTargets(regs, 20, 100);
assert.deepEqual([e.regionIds, e.sampleName], [[], undefined]);

console.log('[PASS] noteMapping: classic velocity layers & extended key×velocity regions');

// Row ▶ audition span (keyboard range + zone map box)
let s = resolveRowAuditionSpan([zA, zB], regs, false, { zoneId: 'a' });
assert.deepEqual(s, { zoneId: 'a', lowKey: 0, highKey: 59, rootKey: 60, lowVel: 1, highVel: 79 }, 'classic plays Low layer');
s = resolveRowAuditionSpan([zA, zB], regs, false, { zoneId: 'b' });
assert.deepEqual([s?.lowVel, s?.highVel], [1, 127], 'single layer covers full velocity');
const zHighOnly = zone({ id: 'h', lowKey: 10, highKey: 20, sampleHigh: 'h.wav', velSplit: 100 });
s = resolveRowAuditionSpan([zHighOnly], [], false, { zoneId: 'h' });
assert.deepEqual([s?.lowVel, s?.highVel], [100, 127], 'only High sample → High layer');
s = resolveRowAuditionSpan([zA], regs, true, { zoneId: 'a', regionId: 'loud' });
assert.deepEqual(s, { zoneId: 'a', regionId: 'loud', lowKey: 48, highKey: 71, rootKey: 62, lowVel: 64, highVel: 127 });
s = resolveRowAuditionSpan([zA], regs, false, { zoneId: 'a', regionId: 'loud' });
assert.equal(s?.regionId, undefined, 'classic mode ignores region ids');
assert.equal(resolveRowAuditionSpan([], [], false, { zoneId: 'x' }), null);

console.log('[PASS] noteMapping: row audition key×velocity span (classic layer / extended region)');
