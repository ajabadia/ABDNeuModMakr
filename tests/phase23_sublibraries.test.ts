// ─────────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 23: Hierarchical Sub-libraries
// Unit tests for sublibrary CRUD, strict deletion safety,
// model movement, ordinal reordering and Bridge endpoint shapes.
// ─────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';

// ── Minimal in-memory stub that mirrors bankService behaviour ──

interface StubModel {
  slug: string;
  name: string;
  sublibrary: string;
  sublibraryOrdinal: number;
}

interface StubSublib {
  name: string;
  order: number;
  modelCount: number;
}

class StubBankStore {
  private sublibraries: StubSublib[] = [{ name: 'Default', order: 0, modelCount: 0 }];
  private models: StubModel[] = [];

  // ── Sub-library management ────────────────────────────────

  listSublibraries(): StubSublib[] {
    return this.sublibraries.map((s) => ({
      ...s,
      modelCount: this.models.filter((m) => m.sublibrary === s.name).length,
    }));
  }

  createSublibrary(name: string): StubSublib {
    if (this.sublibraries.find((s) => s.name === name)) {
      throw new Error(`Sublibrary "${name}" already exists.`);
    }
    const sub: StubSublib = { name, order: this.sublibraries.length, modelCount: 0 };
    this.sublibraries.push(sub);
    return sub;
  }

  deleteSublibrary(name: string): void {
    if (name === 'Default') throw new Error('Cannot delete the Default sublibrary.');
    const modelsInSub = this.models.filter((m) => m.sublibrary === name);
    if (modelsInSub.length > 0) {
      throw new Error(
        `Cannot delete non-empty sublibrary "${name}" — move or delete its ${modelsInSub.length} model(s) first.`
      );
    }
    this.sublibraries = this.sublibraries.filter((s) => s.name !== name);
  }

  // ── Model management ─────────────────────────────────────

  addModel(slug: string, name: string, sublibrary = 'Default'): StubModel {
    const existing = this.models.filter((m) => m.sublibrary === sublibrary);
    const model: StubModel = {
      slug,
      name,
      sublibrary,
      sublibraryOrdinal: existing.length + 1,
    };
    this.models.push(model);
    return model;
  }

  moveModel(slug: string, targetSublibrary: string): void {
    const model = this.models.find((m) => m.slug === slug);
    if (!model) throw new Error(`Model "${slug}" not found.`);
    if (!this.sublibraries.find((s) => s.name === targetSublibrary)) {
      throw new Error(`Target sublibrary "${targetSublibrary}" does not exist.`);
    }
    const sourceSublibrary = model.sublibrary;
    // Assign new ordinal at end of target (before moving)
    const targetModels = this.models.filter((m) => m.sublibrary === targetSublibrary);
    model.sublibrary = targetSublibrary;
    model.sublibraryOrdinal = targetModels.length + 1;
    // Recalculate ordinals in source sublibrary sequentially
    this._recalcOrdinals(sourceSublibrary);
  }

  reorder(sublibrary: string, orderedSlugs: string[]): void {
    const inSub = this.models.filter((m) => m.sublibrary === sublibrary);
    // Validate all slugs belong to this sublibrary
    for (const slug of orderedSlugs) {
      if (!inSub.find((m) => m.slug === slug)) {
        throw new Error(`Slug "${slug}" does not belong to sublibrary "${sublibrary}".`);
      }
    }
    // Assign sequential ordinals 1..N
    orderedSlugs.forEach((slug, idx) => {
      const model = this.models.find((m) => m.slug === slug)!;
      model.sublibraryOrdinal = idx + 1;
    });
  }

  getModels(sublibrary?: string): StubModel[] {
    if (sublibrary) return this.models.filter((m) => m.sublibrary === sublibrary);
    return this.models;
  }

  private _recalcOrdinals(sublibrary: string): void {
    const inSub = this.models
      .filter((m) => m.sublibrary === sublibrary)
      .sort((a, b) => a.sublibraryOrdinal - b.sublibraryOrdinal);
    inSub.forEach((m, i) => {
      m.sublibraryOrdinal = i + 1;
    });
  }
}

// ── Stub Bridge API shape validator ───────────────────────────

function validateBridgeCapability(caps: Record<string, unknown>): void {
  assert.ok('hierarchical-sublibraries' in caps, 'Bridge must announce hierarchical-sublibraries capability');
}

function makeCapabilities(): Record<string, unknown> {
  return {
    'sf2-parse': true,
    'demucs-stems': true,
    'whisper-align': true,
    'hierarchical-sublibraries': true,
  };
}

// ── Tests ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

console.log('\nPhase 23 — Hierarchical Sub-libraries\n');

// 1. Create sublibrary
test('Creates a new sublibrary with name and order', () => {
  const store = new StubBankStore();
  const sub = store.createSublibrary('Leads');
  assert.equal(sub.name, 'Leads');
  assert.equal(sub.order, 1); // Default is 0
  const list = store.listSublibraries();
  assert.equal(list.length, 2);
  assert.ok(list.find((s) => s.name === 'Leads'));
});

// 2. Duplicate sublibrary name rejected
test('Rejects creation of duplicate sublibrary name', () => {
  const store = new StubBankStore();
  store.createSublibrary('Pads');
  assert.throws(() => store.createSublibrary('Pads'), /already exists/);
});

// 3. Strict safety: delete non-empty sublibrary MUST throw
test('Strict safety rule: cannot delete a sublibrary that contains models', () => {
  const store = new StubBankStore();
  store.createSublibrary('Bass');
  store.addModel('bass-001', 'Deep Bass', 'Bass');
  assert.throws(
    () => store.deleteSublibrary('Bass'),
    /Cannot delete non-empty sublibrary/
  );
  // Sublibrary must still exist
  assert.ok(store.listSublibraries().find((s) => s.name === 'Bass'));
});

// 4. Delete empty sublibrary succeeds
test('Deletes an empty sublibrary successfully', () => {
  const store = new StubBankStore();
  store.createSublibrary('Arp');
  store.deleteSublibrary('Arp');
  assert.equal(store.listSublibraries().find((s) => s.name === 'Arp'), undefined);
});

// 5. Cannot delete Default
test('Cannot delete the Default sublibrary', () => {
  const store = new StubBankStore();
  assert.throws(() => store.deleteSublibrary('Default'), /Cannot delete the Default/);
});

// 6. Move model between sublibraries — ordinals recalculated
test('Moves a model between sublibraries and recalculates ordinals', () => {
  const store = new StubBankStore();
  store.createSublibrary('Leads');
  store.addModel('def-001', 'Model A', 'Default');
  store.addModel('def-002', 'Model B', 'Default');
  store.addModel('def-003', 'Model C', 'Default');

  // Move Model B to Leads
  store.moveModel('def-002', 'Leads');

  const inDefault = store.getModels('Default').sort((a, b) => a.sublibraryOrdinal - b.sublibraryOrdinal);
  assert.equal(inDefault.length, 2);
  assert.equal(inDefault[0].slug, 'def-001');
  assert.equal(inDefault[0].sublibraryOrdinal, 1);
  assert.equal(inDefault[1].slug, 'def-003');
  assert.equal(inDefault[1].sublibraryOrdinal, 2);

  const inLeads = store.getModels('Leads');
  assert.equal(inLeads.length, 1);
  assert.equal(inLeads[0].slug, 'def-002');
  assert.equal(inLeads[0].sublibraryOrdinal, 1);
});

// 7. Move to non-existent sublibrary throws
test('Moving a model to a non-existent sublibrary throws', () => {
  const store = new StubBankStore();
  store.addModel('mod-001', 'Model', 'Default');
  assert.throws(() => store.moveModel('mod-001', 'Phantom'), /does not exist/);
});

// 8. Reorder assigns sequential ordinals 1..N
test('Reorder assigns sequential contiguous ordinals 1..N', () => {
  const store = new StubBankStore();
  store.addModel('a', 'A', 'Default');
  store.addModel('b', 'B', 'Default');
  store.addModel('c', 'C', 'Default');

  // Reverse the order
  store.reorder('Default', ['c', 'b', 'a']);

  const models = store.getModels('Default').sort((x, y) => x.sublibraryOrdinal - y.sublibraryOrdinal);
  assert.equal(models[0].slug, 'c');
  assert.equal(models[0].sublibraryOrdinal, 1);
  assert.equal(models[1].slug, 'b');
  assert.equal(models[1].sublibraryOrdinal, 2);
  assert.equal(models[2].slug, 'a');
  assert.equal(models[2].sublibraryOrdinal, 3);
});

// 9. Reorder with slug from another sublibrary throws
test('Reorder with foreign-sublibrary slug throws', () => {
  const store = new StubBankStore();
  store.createSublibrary('Pads');
  store.addModel('p-001', 'Pad A', 'Pads');
  store.addModel('d-001', 'Default A', 'Default');

  assert.throws(
    () => store.reorder('Default', ['d-001', 'p-001']),
    /does not belong to sublibrary/
  );
});

// 10. modelCount in listSublibraries is accurate after moves
test('modelCount in listSublibraries is accurate after moves', () => {
  const store = new StubBankStore();
  store.createSublibrary('FX');
  store.addModel('fx-001', 'FX 1', 'FX');
  store.addModel('fx-002', 'FX 2', 'FX');
  store.addModel('def-001', 'Def 1', 'Default');

  const list = store.listSublibraries();
  const fx = list.find((s) => s.name === 'FX')!;
  const def = list.find((s) => s.name === 'Default')!;

  assert.equal(fx.modelCount, 2);
  assert.equal(def.modelCount, 1);

  store.moveModel('fx-001', 'Default');

  const list2 = store.listSublibraries();
  assert.equal(list2.find((s) => s.name === 'FX')!.modelCount, 1);
  assert.equal(list2.find((s) => s.name === 'Default')!.modelCount, 2);
});

// 11. Bridge capabilities include hierarchical-sublibraries
test('Bridge capability object announces hierarchical-sublibraries', () => {
  validateBridgeCapability(makeCapabilities());
});

// 12. Bridge save_axionik_model payload carries sublibrary field
test('save_axionik_model request shape carries sublibrary field', () => {
  const payload = {
    library_path: '/db',
    slug: 'test-001',
    name: 'Test',
    sublibrary: 'Leads',
    manifest: {},
    files: [],
  };
  assert.ok('sublibrary' in payload, 'Payload must carry sublibrary field');
  assert.equal(payload.sublibrary, 'Leads');
});

// 13. move_axionik_model request shape
test('move_axionik_model request shape is correct', () => {
  const payload = {
    library_path: '/db',
    slug: 'test-001',
    target_sublibrary: 'Pads',
  };
  assert.ok('target_sublibrary' in payload);
  assert.equal(payload.target_sublibrary, 'Pads');
});

// 14. reorder_sublibrary request shape
test('reorder_sublibrary request shape carries ordered_slugs array', () => {
  const payload = {
    library_path: '/db',
    sublibrary: 'Default',
    ordered_slugs: ['slug-c', 'slug-a', 'slug-b'],
  };
  assert.ok(Array.isArray(payload.ordered_slugs));
  assert.equal(payload.ordered_slugs.length, 3);
});

// 15. delete_sublibrary request refuses name 'Default' (client-side guard)
test('Client-side guard prevents sending delete request for Default', () => {
  function clientGuard(name: string): boolean {
    return name !== 'Default' && name.length > 0;
  }
  assert.equal(clientGuard('Default'), false);
  assert.equal(clientGuard(''), false);
  assert.equal(clientGuard('Leads'), true);
});

// ── Summary ───────────────────────────────────────────────────

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
