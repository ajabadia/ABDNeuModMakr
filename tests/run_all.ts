// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Unified Test Runner
// Runs all Phase 1-5 verification suites sequentially
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
];

async function runTestFile(file: string): Promise<boolean> {
  const filePath = path.join(__dirname, file);
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
  const args = process.platform === 'win32' ? ['/c', 'npx', 'tsx', filePath] : ['tsx', filePath];

  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: 'inherit',
    });
    proc.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

async function main() {
  console.log('====================================================');
  console.log('  ABDNeuModMakr — Master Test Suite Verification');
  console.log('====================================================\n');

  let passed = 0;
  const total = TEST_FILES.length;

  for (const file of TEST_FILES) {
    console.log(`\n>>> Running ${file}...`);
    const ok = await runTestFile(file);
    if (ok) {
      passed++;
      console.log(`>>> [SUCCESS] ${file}`);
    } else {
      console.error(`>>> [FAILED] ${file}`);
      process.exit(1);
    }
  }

  console.log('\n====================================================');
  console.log(`  ALL ${passed}/${total} PHASES PASSED SUCCESSFULLY!`);
  console.log('====================================================\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
