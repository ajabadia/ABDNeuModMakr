// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 9: NeuronAssetStore (IndexedDB + Write-Through Cache)
//
// Asynchronous IndexedDB persistence engine for heavy binary assets:
//   - 01_raw_source: Unaltered user/SF2/SFZ audio buffers (WAV/AIFF)
//   - 02_legacy_original: Untouched factory .model binaries (MName, map.script, .scape, .sphere)
//   - 03_enhanced_audio: 24-bit / 96.000 Hz Master Wave WAV buffers
//   - 04_classic_enhanced & 05_extended_model: Per-slot Time Capsule records & provenance
//
// Avoids the 5 MB localStorage quota while providing a synchronous write-through
// cache for zero-latency DSP/ZIP operations and automatic fallback in Node.js tests.
// ─────────────────────────────────────────────────────────

import type {
  AssetStoreDiagnostics,
  ModelProvenance,
  TimeCapsuleManifest,
  Zone,
} from '../types.ts';
import type { ZoneBinaryPair } from '../dsp/PipelineRunner.ts';

export interface LegacyOriginalSampleRecord {
  sampleName: string;
  scapeBinary: Uint8Array;
  sphereBinary: Uint8Array;
  origParameterSet: number;
  complexity: number;
}

export interface LegacyOriginalSlotBundle {
  slot: number;
  name: string;
  zones: Zone[];
  mapScriptVersion?: {
    major: number;
    minor: number;
    build: number;
    lineEnding?: '\r\n' | '\n';
  };
  zoneBinaries: ZoneBinaryPair[];
}

export interface StoredTimeCapsuleRecord {
  slot: number;
  modelName: string;
  manifest: TimeCapsuleManifest;
  provenance: ModelProvenance;
  classicEnhancedBinaries: ZoneBinaryPair[];
  extendedModelJson: string;
  updatedAt: string;
}

const DB_NAME = 'ABDNeuModMakr_TimeCapsuleDB';
const DB_VERSION = 1;
const STORE_RAW = 'raw_sources';
const STORE_LEGACY = 'legacy_originals';
const STORE_ENHANCED = 'enhanced_audio';
const STORE_CAPSULES = 'model_capsules';

export class NeuronAssetStore {
  private readonly rawSources = new Map<string, ArrayBuffer>();
  /** Maps a promoted sampleName (e.g. `Bass_MW24_96k.wav`) back to its original `01_raw_source` sampleName (`Bass.wav`) */
  private readonly promotedToRawAlias = new Map<string, string>();
  private readonly legacySampleBinaries = new Map<string, LegacyOriginalSampleRecord>();
  private readonly legacySlotBundles = new Map<number, LegacyOriginalSlotBundle>();
  private readonly enhancedAudio = new Map<string, ArrayBuffer>();
  private readonly capsulesBySlot = new Map<number, StoredTimeCapsuleRecord>();

  private dbPromise: Promise<IDBDatabase | null> | null = null;

  public isIndexedDbAvailable(): boolean {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  }

  private openDatabase(): Promise<IDBDatabase | null> {
    if (!this.isIndexedDbAvailable()) {
      return Promise.resolve(null);
    }
    if (this.dbPromise) {
      return this.dbPromise;
    }
    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_RAW)) {
            db.createObjectStore(STORE_RAW);
          }
          if (!db.objectStoreNames.contains(STORE_LEGACY)) {
            db.createObjectStore(STORE_LEGACY);
          }
          if (!db.objectStoreNames.contains(STORE_ENHANCED)) {
            db.createObjectStore(STORE_ENHANCED);
          }
          if (!db.objectStoreNames.contains(STORE_CAPSULES)) {
            db.createObjectStore(STORE_CAPSULES);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  private async putIdb(
    storeName: string,
    key: IDBValidKey,
    value: unknown
  ): Promise<void> {
    const db = await this.openDatabase();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private async clearIdbStore(storeName: string): Promise<void> {
    const db = await this.openDatabase();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * Hydrates the in-memory write-through caches from IndexedDB when running in a browser.
   */
  public async hydrateFromIndexedDb(): Promise<void> {
    const db = await this.openDatabase();
    if (!db) return;

    const readAllEntries = <K extends IDBValidKey, V>(
      storeName: string
    ): Promise<Array<{ key: K; value: V }>> =>
      new Promise((resolve) => {
        try {
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const req = store.openCursor();
          const out: Array<{ key: K; value: V }> = [];
          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) {
              out.push({ key: cursor.key as K, value: cursor.value as V });
              cursor.continue();
            } else {
              resolve(out);
            }
          };
          req.onerror = () => resolve(out);
        } catch {
          resolve([]);
        }
      });

    const [rawEntries, enhancedEntries, capsuleEntries] = await Promise.all([
      readAllEntries<string, ArrayBuffer>(STORE_RAW),
      readAllEntries<string, ArrayBuffer>(STORE_ENHANCED),
      readAllEntries<number, StoredTimeCapsuleRecord>(STORE_CAPSULES),
    ]);

    for (const { key, value } of rawEntries) {
      if (typeof key === 'string' && value instanceof ArrayBuffer) {
        this.rawSources.set(key, value);
      }
    }
    for (const { key, value } of enhancedEntries) {
      if (typeof key === 'string' && value instanceof ArrayBuffer) {
        this.enhancedAudio.set(key, value);
      }
    }
    for (const { key, value } of capsuleEntries) {
      if (typeof key === 'number' && value && typeof value === 'object') {
        this.capsulesBySlot.set(key, value);
      }
    }
  }

  // ── Layer 01: Raw Source Audio (`01_raw_source`) ─────────

  public setRawSource(sampleName: string, buffer: ArrayBuffer): void {
    const copy = buffer.slice(0);
    this.rawSources.set(sampleName, copy);
    void this.putIdb(STORE_RAW, sampleName, copy);
  }

  public async saveRawSource(
    sampleName: string,
    buffer: ArrayBuffer
  ): Promise<void> {
    const copy = buffer.slice(0);
    this.rawSources.set(sampleName, copy);
    await this.putIdb(STORE_RAW, sampleName, copy);
  }

  public linkPromotedToRawSource(
    promotedSampleName: string,
    rawSampleName: string
  ): void {
    const rootRaw = this.promotedToRawAlias.get(rawSampleName) ?? rawSampleName;
    this.promotedToRawAlias.set(promotedSampleName, rootRaw);
  }

  public resolveRawSampleName(sampleName: string): string {
    return this.promotedToRawAlias.get(sampleName) ?? sampleName;
  }

  public getRawSourceSync(sampleName: string): ArrayBuffer | undefined {
    const rootName = this.resolveRawSampleName(sampleName);
    return this.rawSources.get(rootName);
  }

  public async loadRawSource(
    sampleName: string
  ): Promise<ArrayBuffer | undefined> {
    return this.getRawSourceSync(sampleName);
  }

  public getAllRawSourcesSync(): Map<string, ArrayBuffer> {
    return new Map(this.rawSources);
  }

  public hasRawSource(sampleName: string): boolean {
    const rootName = this.resolveRawSampleName(sampleName);
    return this.rawSources.has(rootName);
  }

  // ── Layer 02: Legacy Original Binaries (`02_legacy_original`) ──

  public setLegacyOriginalSample(record: LegacyOriginalSampleRecord): void {
    const cloned: LegacyOriginalSampleRecord = {
      ...record,
      scapeBinary: new Uint8Array(record.scapeBinary),
      sphereBinary: new Uint8Array(record.sphereBinary),
    };
    this.legacySampleBinaries.set(record.sampleName, cloned);
    void this.putIdb(STORE_LEGACY, `sample:${record.sampleName}`, cloned);
  }

  public getLegacyOriginalSampleSync(
    sampleName: string
  ): LegacyOriginalSampleRecord | undefined {
    const rootName = this.resolveRawSampleName(sampleName);
    return (
      this.legacySampleBinaries.get(sampleName) ??
      this.legacySampleBinaries.get(rootName)
    );
  }

  public setLegacyOriginalSlotBundle(bundle: LegacyOriginalSlotBundle): void {
    const cloned: LegacyOriginalSlotBundle = {
      slot: bundle.slot,
      name: bundle.name,
      zones: structuredClone(bundle.zones),
      mapScriptVersion: bundle.mapScriptVersion
        ? { ...bundle.mapScriptVersion }
        : undefined,
      zoneBinaries: bundle.zoneBinaries.map((b) => ({
        scapeBinary: new Uint8Array(b.scapeBinary),
        sphereBinary: new Uint8Array(b.sphereBinary),
      })),
    };
    this.legacySlotBundles.set(bundle.slot, cloned);
    void this.putIdb(STORE_LEGACY, `slot:${bundle.slot}`, cloned);
  }

  public getLegacyOriginalSlotBundleSync(
    slot: number
  ): LegacyOriginalSlotBundle | undefined {
    return this.legacySlotBundles.get(slot);
  }

  // ── Layer 03: Enhanced Master Wave Audio (`03_enhanced_audio`) ──

  public setEnhancedAudio(sampleName: string, wav24Buffer: ArrayBuffer): void {
    const copy = wav24Buffer.slice(0);
    this.enhancedAudio.set(sampleName, copy);
    void this.putIdb(STORE_ENHANCED, sampleName, copy);
  }

  public async saveEnhancedAudio(
    sampleName: string,
    wav24Buffer: ArrayBuffer
  ): Promise<void> {
    const copy = wav24Buffer.slice(0);
    this.enhancedAudio.set(sampleName, copy);
    await this.putIdb(STORE_ENHANCED, sampleName, copy);
  }

  public getEnhancedAudioSync(sampleName: string): ArrayBuffer | undefined {
    return this.enhancedAudio.get(sampleName);
  }

  public getAllEnhancedAudioSync(): Map<string, ArrayBuffer> {
    return new Map(this.enhancedAudio);
  }

  public hasEnhancedAudio(sampleName: string): boolean {
    return this.enhancedAudio.has(sampleName);
  }

  // ── Layers 04 & 05 + Full Time Capsule Records (`model_capsules`) ──

  public setCapsuleRecord(record: StoredTimeCapsuleRecord): void {
    this.capsulesBySlot.set(record.slot, record);
    void this.putIdb(STORE_CAPSULES, record.slot, record);
  }

  public async saveCapsuleRecord(
    record: StoredTimeCapsuleRecord
  ): Promise<void> {
    this.capsulesBySlot.set(record.slot, record);
    await this.putIdb(STORE_CAPSULES, record.slot, record);
  }

  public getCapsuleRecordSync(
    slot: number
  ): StoredTimeCapsuleRecord | undefined {
    return this.capsulesBySlot.get(slot);
  }

  public async loadCapsuleRecord(
    slot: number
  ): Promise<StoredTimeCapsuleRecord | undefined> {
    return this.capsulesBySlot.get(slot);
  }

  // ── Session Reset & Diagnostics ─────────────────────────

  public clearSessionAudioLayers(): void {
    this.rawSources.clear();
    this.promotedToRawAlias.clear();
    this.legacySampleBinaries.clear();
    this.enhancedAudio.clear();
    void this.clearIdbStore(STORE_RAW);
    void this.clearIdbStore(STORE_ENHANCED);
  }

  public async clearAll(): Promise<void> {
    this.rawSources.clear();
    this.promotedToRawAlias.clear();
    this.legacySampleBinaries.clear();
    this.legacySlotBundles.clear();
    this.enhancedAudio.clear();
    this.capsulesBySlot.clear();
    await Promise.all([
      this.clearIdbStore(STORE_RAW),
      this.clearIdbStore(STORE_LEGACY),
      this.clearIdbStore(STORE_ENHANCED),
      this.clearIdbStore(STORE_CAPSULES),
    ]);
  }

  /**
   * Queries navigator.storage.estimate() if available in browser context.
   * Returns usage in bytes, total quota in bytes, and percentage used (0..100).
   */
  public async getStorageEstimate(): Promise<{ usage: number; quota: number; percent: number } | null> {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
      try {
        const est = await navigator.storage.estimate();
        const usage = est.usage ?? 0;
        const quota = est.quota ?? 1;
        const percent = Math.min(100, Math.round((usage / quota) * 100));
        return { usage, quota, percent };
      } catch {
        return null;
      }
    }
    return null;
  }

  public getDiagnostics(): AssetStoreDiagnostics {
    let rawSourceBytes = 0;
    for (const buf of this.rawSources.values()) {
      rawSourceBytes += buf.byteLength;
    }

    let legacyOriginalBytes = 0;
    for (const rec of this.legacySampleBinaries.values()) {
      legacyOriginalBytes +=
        rec.scapeBinary.byteLength + rec.sphereBinary.byteLength;
    }
    for (const bundle of this.legacySlotBundles.values()) {
      for (const pair of bundle.zoneBinaries) {
        legacyOriginalBytes +=
          pair.scapeBinary.byteLength + pair.sphereBinary.byteLength;
      }
    }

    let enhancedAudioBytes = 0;
    for (const buf of this.enhancedAudio.values()) {
      enhancedAudioBytes += buf.byteLength;
    }

    return {
      backend: this.isIndexedDbAvailable() ? 'indexeddb' : 'memory-fallback',
      rawSourceCount: this.rawSources.size,
      rawSourceBytes,
      legacyOriginalCount:
        this.legacySampleBinaries.size + this.legacySlotBundles.size,
      legacyOriginalBytes,
      enhancedAudioCount: this.enhancedAudio.size,
      enhancedAudioBytes,
      capsuleCount: this.capsulesBySlot.size,
      totalBytes: rawSourceBytes + legacyOriginalBytes + enhancedAudioBytes,
    };
  }
}
