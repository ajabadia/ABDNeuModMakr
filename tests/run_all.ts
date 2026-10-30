// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Unified Continuous Test Runner
// Runs all Phase 0-6 and unit verification suites continuously
// and outputs a structured summary table.
// ─────────────────────────────────────────────────────────

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_FILES = [
  'phase0_canonical_contract.test.ts',
  'phase1_pipeline.test.ts',
  'phase2_formats.test.ts',
  'phase3_files.test.ts',
  'phase4_spectral.test.ts',
  'phase5_ux.test.ts',
  'phase6_units.test.ts',
  'noteMapping.test.ts',
  'phase7_import_robustness.test.ts',
];

interface TestResult {
  file: string;
  passed: boolean;
  durationMs: number;
}

async function runTestFile(file: string): Promise<TestResult> {
  const filePath = path.join(__dirname, file);
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
  const args = process.platform === 'win32' ? ['/c', 'npx', 'tsx', filePath] : ['tsx', filePath];
  const startTime = Date.now();

  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: 'inherit',
    });
    proc.on('close', (code) => {
      resolve({
        file,
        passed: code === 0,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

async function main() {
  console.log('================================================================');
  console.log('  ABDNeuModMakr — Master Test Suite Continuous Runner');
  console.log('================================================================\n');

  const results: TestResult[] = [];

  for (const file of TEST_FILES) {
    console.log(`\n>>> [RUNNING] ${file}...`);
    const result = await runTestFile(file);
    results.push(result);
    if (result.passed) {
      console.log(`>>> [SUCCESS] ${file} (${result.durationMs}ms)`);
    } else {
      console.error(`>>> [FAILED] ${file} (${result.durationMs}ms)`);
    }
  }

  // Summary Table
  console.log('\n================================================================');
  console.log('                    TEST EXECUTION SUMMARY                      ');
  console.log('================================================================');
  console.log('| Suite Name                         | Status  | Duration     |');
  console.log('|------------------------------------|---------|--------------|');

  let passedCount = 0;
  let totalDuration = 0;

  for (const r of results) {
    totalDuration += r.durationMs;
    if (r.passed) passedCount++;
    const namePadded = r.file.padEnd(34, ' ');
    const statusPadded = (r.passed ? 'PASS   ' : 'FAIL * ').padEnd(7, ' ');
    const durationStr = `${r.durationMs}ms`.padStart(12, ' ');
    console.log(`| ${namePadded} | ${statusPadded} | ${durationStr} |`);
  }

  console.log('|------------------------------------|---------|--------------|');
  console.log(`Total: ${passedCount}/${results.length} passed in ${(totalDuration / 1000).toFixed(2)}s\n`);

  if (passedCount < results.length) {
    console.error(`Master test suite failed: ${results.length - passedCount} suite(s) had errors.`);
    process.exit(1);
  } else {
    console.log('All test suites passed cleanly!');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
