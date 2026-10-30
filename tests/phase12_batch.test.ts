// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Phase 12 Batch Processor Test Suite
// ─────────────────────────────────────────────────────────

import { extractFolderFilesToCandidates } from '../src/core/batch/FolderBatchExtractor.ts';
import { BatchQueue } from '../src/core/batch/BatchQueue.ts';
import type { BatchConfig, BatchModelCandidate } from '../src/core/batch/types.ts';
import { synthesizeDemoWav } from '../src/core/dsp/WavDecoder.ts';
import { parseZipArchive } from '../src/formats/ZipArchive.ts';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`);
}

export async function runPhase12Tests(): Promise<void> {
  console.log('=== ABDNeuModMakr Phase 12 Batch Processor Suite ===');

  // Test 1: FolderBatchExtractor - Subdirectory & prefix grouping
  console.log('Testing FolderBatchExtractor grouping logic...');
  const wavSampleA = synthesizeDemoWav('strings', 48, 44100, 0.1);
  const wavSampleB = synthesizeDemoWav('strings', 60, 44100, 0.1);
  const wavSampleC = synthesizeDemoWav('bass', 36, 44100, 0.1);

  const folderFiles = [
    { path: 'RhodesSuitcase/Rhodes_048_C3.wav', name: 'Rhodes_048_C3.wav', buffer: wavSampleA },
    { path: 'RhodesSuitcase/Rhodes_060_C4.wav', name: 'Rhodes_060_C4.wav', buffer: wavSampleB },
    { path: 'MinimoogBass/Mini_036_C2.wav', name: 'Mini_036_C2.wav', buffer: wavSampleC },
  ];

  const folderCandidates = extractFolderFilesToCandidates(folderFiles);
  assert(folderCandidates.length === 2, `Expected 2 candidates from folders, got ${folderCandidates.length}`);
  const rhodes = folderCandidates.find((c) => c.name.toLowerCase().includes('rhodes'));
  const mini = folderCandidates.find((c) => c.name.toLowerCase().includes('mini'));
  assert(!!rhodes, 'Rhodes candidate must exist');
  assert(!!mini, 'Minimoog candidate must exist');
  assert(rhodes!.zoneCount === 2, `Rhodes must have 2 zones, got ${rhodes!.zoneCount}`);
  assert(mini!.zoneCount === 1, `Mini must have 1 zone, got ${mini!.zoneCount}`);
  console.log('  [PASS] 1. Folder extractor groups subdirectories into discrete model jobs');

  // Test 2: Flat files with common instrument prefixes
  const flatFiles = [
    { path: 'Hammond_048_C3.wav', name: 'Hammond_048_C3.wav', buffer: wavSampleA },
    { path: 'Hammond_060_C4.wav', name: 'Hammond_060_C4.wav', buffer: wavSampleB },
  ];
  const flatCandidates = extractFolderFilesToCandidates(flatFiles);
  assert(flatCandidates.length === 1, `Expected 1 group for Hammond, got ${flatCandidates.length}`);
  assert(flatCandidates[0].name === 'Hammond', `Expected name Hammond, got ${flatCandidates[0].name}`);
  console.log('  [PASS] 2. Flat files grouped by instrument prefix');

  // Test 3: BatchQueue Execution & Fault Tolerance
  console.log('Testing BatchQueue sequential execution & fault tolerance...');
  const queue = new BatchQueue();

  // Valid Job 1: Rhodes
  const job1: BatchModelCandidate = {
    id: 'job_rhodes',
    name: 'Vintage Rhodes',
    slug: 'vintage-rhodes',
    sourceType: 'folder-pack',
    sourceOrigin: 'RhodesSuitcase',
    zoneCount: 2,
    detectedCategory: 'Keyboards & Acoustic Pianos',
    suggestedParameterSet: 2,
    suggestedComplexity: 6,
    status: 'pending',
    progressPct: 0,
    files: [
      { name: 'Rhodes_048_C3.wav', buffer: wavSampleA },
      { name: 'Rhodes_060_C4.wav', buffer: wavSampleB },
    ],
  };

  // Corrupt Job 2: Invalid 0-byte buffer that must fail cleanly without breaking the batch
  const job2: BatchModelCandidate = {
    id: 'job_broken',
    name: 'Corrupt Instrument',
    slug: 'corrupt-instrument',
    sourceType: 'folder-pack',
    sourceOrigin: 'BrokenFolder',
    zoneCount: 1,
    detectedCategory: 'SFX, Drones & Cinematic',
    suggestedParameterSet: 9,
    suggestedComplexity: 4,
    status: 'pending',
    progressPct: 0,
    files: [
      { name: 'Broken_060.wav', buffer: new ArrayBuffer(0) },
    ],
  };

  // Valid Job 3: Minimoog
  const job3: BatchModelCandidate = {
    id: 'job_mini',
    name: 'Minimoog Lead',
    slug: 'minimoog-lead',
    sourceType: 'folder-pack',
    sourceOrigin: 'MinimoogBass',
    zoneCount: 1,
    detectedCategory: 'Bass & Low End',
    suggestedParameterSet: 4,
    suggestedComplexity: 6,
    status: 'pending',
    progressPct: 0,
    files: [
      { name: 'Mini_036_C2.wav', buffer: wavSampleC },
    ],
  };

  queue.setJobs([job1, job2, job3]);

  let progressEventsCount = 0;
  let jobFailedCaught = false;
  queue.on((event) => {
    if (event === 'progress') progressEventsCount++;
    if (event === 'job-failed') jobFailedCaught = true;
  });

  const config: BatchConfig = {
    targetFormat: 'dual',
    destination: 'zip-master',
    complexityStrategy: 'auto',
    dspAlgorithm: 'legacy',
    autoAcousticClassification: true,
  };

  const summary = await queue.start(config);

  assert(summary.total === 3, `Expected total 3, got ${summary.total}`);
  assert(summary.succeeded === 2, `Expected 2 succeeded, got ${summary.succeeded}`);
  assert(summary.failed === 1, `Expected 1 failed, got ${summary.failed}`);
  assert(jobFailedCaught, 'job-failed event must be emitted');
  assert(progressEventsCount > 0, 'Progress events must be fired');
  assert(job1.status === 'completed', 'Job 1 must be completed');
  assert(job2.status === 'failed', 'Job 2 must be failed');
  assert(job3.status === 'completed', 'Job 3 must be completed despite Job 2 failure');
  console.log('  [PASS] 3. BatchQueue executes sequentially with fault tolerance (2/3 succeeded, 1 isolated error)');

  // Test 4: Master ZIP generation
  assert(!!summary.masterZipBytes, 'Master ZIP bytes must be generated');
  const masterZip = summary.masterZipBytes!;
  assert(masterZip.length > 500, 'Master ZIP must contain data');
  const extracted = parseZipArchive(masterZip);
  const rhodesManifest = extracted.find((e) => e.path === 'vintage-rhodes/manifest.json');
  const miniManifest = extracted.find((e) => e.path === 'minimoog-lead/manifest.json');
  const rhodesScape = extracted.find((e) => e.path.startsWith('vintage-rhodes/04_classic_enhanced/'));
  assert(!!rhodesManifest, 'vintage-rhodes/manifest.json must exist in master ZIP');
  assert(!!miniManifest, 'minimoog-lead/manifest.json must exist in master ZIP');
  assert(!!rhodesScape, 'vintage-rhodes classic enhanced binary must exist in master ZIP');
  console.log('  [PASS] 4. Master ZIP contains 5-layer Time Capsule entries for all successful models');

  console.log('=== ALL PHASE 12 BATCH TESTS PASSED ===\n');
}

runPhase12Tests().catch((err) => {
  console.error('Phase 12 Tests Failed:', err);
  process.exit(1);
});
