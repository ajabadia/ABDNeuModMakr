#!/usr/bin/env node
/**
 * Generador de `Contracts/lut_tables.json` a partir del firmware oficial del KORG MS2000.
 *
 * Las dos tablas de frecuencia del LFO viven en la ROM de sistema en los offsets
 * `0x295E8` (LFO1) y `0x29BE8` (LFO2), como 128 palabras big-endian de 32 bits cuyo
 * incremento de fase DSP de 24 bits (Q23) ocupa los bits 31..8: `inc = word >>> 8`.
 * La frecuencia resultante a 48 kHz es `inc * 48000 / 2^24`.
 *
 * Uso:
 *   node Contracts/generators/ms2000_lfo_luts.mjs            # regenera el contrato
 *   node Contracts/generators/ms2000_lfo_luts.mjs --check    # falla si difiere de la ROM
 *   node Contracts/generators/ms2000_lfo_luts.mjs --rom <ruta>
 *
 * Ruta de la ROM: `--rom <ruta>`, variable de entorno `MS2000_ROM`, o las ubicaciones
 * por defecto de `_RESOURCES/ms2000/firmware` dentro de la suite.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(CONTRACTS_DIR, 'lut_tables.json');

export const LUT_LENGTH = 128;

/** Tablas del LFO del MS2000, con su offset en el firmware y su trazabilidad. */
export const MS2000_LFO_TABLES = [
  {
    lutId: 'ms2000_lfo1_hz',
    romOffset: 0x295e8,
    romOffsetLabel: '0x295E8',
    dspAddress: 'P:$0500',
    description: 'KORG MS2000 / MS2000R — frecuencia de LFO1',
  },
  {
    lutId: 'ms2000_lfo2_hz',
    romOffset: 0x29be8,
    romOffsetLabel: '0x29BE8',
    dspAddress: 'P:$052A',
    description: 'KORG MS2000 / MS2000R — frecuencia de LFO2',
  },
];

/** Ubicaciones candidatas del firmware, de la más pequeña a la más completa. */
export function romCandidates() {
  return [
    process.env.MS2000_ROM,
    path.resolve(
      CONTRACTS_DIR,
      '../../_RESOURCES/ms2000/firmware/MS2000_V107/MS2000_V107/x811v107.sys'
    ),
    path.resolve(CONTRACTS_DIR, '../../_RESOURCES/ms2000/firmware/MS2000_Full_Firmware/flash.bin'),
  ].filter(Boolean);
}

/**
 * Extrae las 128 palabras de una tabla como incrementos Q23 de 24 bits.
 * @param {Buffer} rom
 * @param {number} offset
 * @returns {number[]}
 */
export function extractLutIncrements(rom, offset) {
  const increments = [];
  for (let i = 0; i < LUT_LENGTH; i++) {
    const word = rom.readUInt32BE(offset + i * 4);
    increments.push(word >>> 8);
  }
  return increments;
}

/**
 * Extrae todas las tablas del LFO del MS2000 de una imagen de firmware.
 * @param {Buffer} rom
 * @returns {Record<string, number[]>}
 */
export function extractAllLutIncrements(rom) {
  const tables = {};
  for (const table of MS2000_LFO_TABLES) {
    tables[table.lutId] = extractLutIncrements(rom, table.romOffset);
  }
  return tables;
}

/**
 * Construye el contrato completo `lut_tables.json` a partir de la ROM.
 * @param {Buffer} rom
 * @returns {object}
 */
export function buildLutContract(rom) {
  const luts = {};
  for (const table of MS2000_LFO_TABLES) {
    luts[table.lutId] = {
      unit: 'Hz',
      description: table.description,
      length: LUT_LENGTH,
      scaling: { kind: 'phase_increment', qBits: 24, sampleRateHz: 48000 },
      provenance: {
        firmware: 'x811v107.sys (MS2000 system v1.07)',
        romOffset: table.romOffsetLabel,
        dspAddress: table.dspAddress,
        wordFormat:
          'uint32 big-endian; 24-bit Q23 phase increment in bits 31..8 (value = word >>> 8)',
        crossCheckedWith: [
          'MS2000_Full_Firmware/flash.bin (same 128 words)',
          'ABDMS2000 Source/Core/MS2000FirmwareTables.h',
        ],
      },
      increments: extractLutIncrements(rom, table.romOffset),
    };
  }

  return {
    $schema: './lut_tables.schema.json',
    schemaVersion: '1.0.0',
    description:
      'Tablas LUT de firmware indexadas por lutId. Son la verdad del hardware para los parámetros con curve: "Lut": se indexan por el valor normalizado y sustituyen a cualquier fórmula analítica (Exp/Pow), que en el MS2000 se desvía hasta un ~55 % de la tabla real.',
    derivation: 'value = increment * sampleRateHz / 2^qBits',
    luts,
  };
}

function serialize(contract) {
  return `${JSON.stringify(contract, null, 2)}\n`;
}

function firstDifference(a, b) {
  const left = a.split('\n');
  const right = b.split('\n');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i]) {
      return { line: i + 1, expected: right[i] ?? '<eof>', actual: left[i] ?? '<eof>' };
    }
  }
  return null;
}

function main(argv) {
  const romFlag = argv.indexOf('--rom');
  const explicitRom = romFlag >= 0 ? argv[romFlag + 1] : undefined;
  const candidates = explicitRom ? [explicitRom] : romCandidates();
  const romPath = candidates.find((candidate) => existsSync(candidate));

  if (!romPath) {
    console.error('No se encontró el firmware del MS2000. Probadas estas rutas:');
    for (const candidate of candidates) console.error(`  - ${candidate}`);
    console.error('Indica una con --rom <ruta> o con la variable MS2000_ROM.');
    return 2;
  }

  const contract = buildLutContract(readFileSync(romPath));
  const serialized = serialize(contract);

  if (argv.includes('--check')) {
    const current = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, 'utf8') : '';
    const diff = firstDifference(current, serialized);
    if (diff) {
      console.error(`DIVERGE de la ROM (${romPath}) en la línea ${diff.line}:`);
      console.error(`  contrato: ${diff.actual}`);
      console.error(`  ROM     : ${diff.expected}`);
      return 1;
    }
    console.log(`OK: lut_tables.json coincide con ${path.basename(romPath)}`);
    return 0;
  }

  writeFileSync(OUTPUT_PATH, serialized);
  console.log(`Escrito ${path.relative(process.cwd(), OUTPUT_PATH)} desde ${romPath}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
