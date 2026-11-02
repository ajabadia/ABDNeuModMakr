/**
 * @abdsynths/contracts
 * Canonical Contracts, JSON Schemas, Parameter Specs, and Hardware Profiles
 * Single Source of Truth (SSOT) for the ABDSynths suite.
 */

import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Lists all JSON contract filenames available in the package.
 * @returns {string[]}
 */
export function listContracts() {
  return readdirSync(__dirname)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.schema.json'))
    .sort();
}

/**
 * Lists all JSON schema validation filenames.
 * @returns {string[]}
 */
export function listSchemas() {
  return readdirSync(__dirname)
    .filter((f) => f.endsWith('.schema.json'))
    .sort();
}

/**
 * Reads and parses a contract or schema JSON file.
 * @param {string} name - e.g. 'korg_ms2000.json', 'casio_cz101', 'hardware_profile.schema.json'
 * @returns {Record<string, any>}
 */
export function getContract(name) {
  const filename = name.endsWith('.json') ? name : `${name}.json`;
  const filePath = path.join(__dirname, filename);
  const content = readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}
