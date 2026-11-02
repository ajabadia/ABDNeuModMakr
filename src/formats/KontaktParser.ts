// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Native Instruments Kontakt Inspector (Fase 28 / 32)
//
// Clean-room implementation. Format facts cross-checked against the
// ConvertWithMoss project (Juergen Mossgraber, LGPL-3.0) used purely as
// a format reference; no code was translated.
//
// - Version detection: K1 / K1.5, K2-4.1 (zlib XML), K4.2 (FastLZ chunks),
//   K5+ NI container ("hsin" @ 12), K5 file-container monolith ("/\ NI FC MTD")
// - K2-4.1: header parsing + zlib inflate + K2_Zone extraction (file_ex2)
// - K5+: NI container walk to detect real DRM signals (Authorization PIDs /
//   Encryption chunk); never crashes, returns an informative diagnostic
// - NCW (Native Compressed Wave) decoder: delta / truncated / raw blocks,
//   mid-side stereo and IEEE float flags
// ─────────────────────────────────────────────────────────

export type KontaktContainerKind =
  | 'nki-k1'
  | 'nki-k2-zlib'
  | 'nki-k42-fastlz'
  | 'nki-k5-container'
  | 'nki-k5-encrypted'
  | 'monolith-k5'
  | 'monolith-k2'
  | 'resource-container'
  | 'nki-xml'
  | 'ncw'
  | 'unknown';

export interface KontaktDiagnostic {
  kind: KontaktContainerKind;
  encrypted: boolean;
  importable: boolean;
  message: string;
  conversionGuide: string[];
}

export interface KontaktZone {
  sampleName: string;
  lowKey: number;
  highKey: number;
  rootKey: number;
  lowVel: number;
  highVel: number;
  tuneCents: number;
  volumeDb: number;
}

export const KONTAKT_CONVERSION_GUIDE: string[] = [
  'Open the instrument in a licensed copy of Kontakt.',
  'Use File > Save As and choose "Patch + Samples" with sample compression disabled (WAV).',
  'Alternatively export an SFZ / WAV map using an ecosystem utility for libraries you own.',
  'Drop the resulting folder (or a .zip of it) into NeuModMakr for native import.',
];

const NCW_MAGIC = [0x01, 0xa8, 0x9e, 0xd6];
const NCW_VERSIONS = [0x130, 0x131];
const MONOLITH_K5_MAGIC = [0x2f, 0x5c, 0x20, 0x4e]; // "/\ N" of "/\ NI FC MTD  /\"

// First 4 bytes read big-endian
const K1_INSTRUMENT = [0x5ee56eb3, 0xb36ee55e];
const K1_MULTI = [0x5ae5d6a4, 0xa4d6e55a];
const K2_INSTRUMENT_LE = 0x1290a87f; // bytes 12 90 A8 7F -> little-endian file
const K2_INSTRUMENT_BE = 0x7fa89012;
const K2_MULTI = [0x01ef85ab, 0xab85ef01];

const K2_HEADER_VERSION_K2 = 0x100;
const K2_HEADER_VERSION_K42 = 0x110;

// NI container chunk type IDs
const NIC_TERMINATOR = 1;
const NIC_AUTHORIZATION = 106;
const NIC_ENCRYPTION = 116;

function startsWith(b: Uint8Array, magic: number[], off = 0): boolean {
  if (b.length < off + magic.length) return false;
  return magic.every((v, i) => b[off + i] === v);
}

function u32be(b: Uint8Array, off: number): number {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}

function asciiAt(b: Uint8Array, off: number, len: number): string {
  let s = '';
  for (let i = off; i < Math.min(off + len, b.length); i++) s += String.fromCharCode(b[i]);
  return s;
}

const ok = (kind: KontaktContainerKind, message: string): KontaktDiagnostic => ({
  kind, encrypted: false, importable: true, message, conversionGuide: [],
});

const notYet = (kind: KontaktContainerKind, message: string, encrypted = false): KontaktDiagnostic => ({
  kind, encrypted, importable: false, message, conversionGuide: KONTAKT_CONVERSION_GUIDE,
});

/**
 * Walk a K5+ NI container looking for real DRM signals: an Encryption chunk,
 * or an Authorization chunk with a non-trivial payload. Bounded and defensive.
 */
export function niContainerHasDrm(bytes: Uint8Array): boolean {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Data chunks: u64 length, 4-ASCII domain, u32 type, u32 version, data.
  // Scan for chunk headers whose domain is "hsin" or "DSIN"/"4KIN" and inspect type.
  const limit = Math.min(bytes.length - 20, 1 << 20);
  for (let off = 0; off < limit; off++) {
    const dom = asciiAt(bytes, off + 8, 4);
    if (dom !== 'hsin' && dom !== 'DSIN' && dom !== '4KIN') continue;
    const lenLo = dv.getUint32(off, true);
    const lenHi = dv.getUint32(off + 4, true);
    if (lenHi !== 0 || lenLo < 20 || off + lenLo > bytes.length) continue;
    const type = dv.getUint32(off + 12, true);
    if (type === NIC_ENCRYPTION) return true;
    if (type === NIC_AUTHORIZATION && lenLo > 32) {
      // Authorization payload beyond its fixed header indicates serial/PID entries
      const payload = bytes.subarray(off + 20, off + lenLo);
      if (payload.some((v) => v !== 0)) return true;
    }
    if (type === NIC_TERMINATOR) continue;
  }
  return false;
}

/** Classify a Kontakt file and decide whether it can be imported. Never throws. */
export function inspectKontaktFile(fileName: string, bytes: Uint8Array): KontaktDiagnostic {
  try {
    const ext = (fileName.split('.').pop() ?? '').toLowerCase();

    if (startsWith(bytes, NCW_MAGIC)) {
      const ver = bytes.length >= 8 ? new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true) : 0;
      return NCW_VERSIONS.includes(ver)
        ? ok('ncw', 'NCW compressed audio: decodable to PCM.')
        : notYet('ncw', `NCW file with unsupported version 0x${ver.toString(16)}.`);
    }

    if (bytes.length >= 16 && asciiAt(bytes, 12, 4) === 'hsin') {
      return niContainerHasDrm(bytes)
        ? notYet(
            'nki-k5-encrypted',
            `Kontakt instrument "${fileName}" is protected by Native Instruments licensing (encrypted/authorized content). ` +
              'It cannot be read without the activation keys.',
            true,
          )
        : notYet(
            'nki-k5-container',
            'Kontakt 5+ instrument (NI container). Zone extraction for this version is not implemented yet.',
          );
    }

    if (startsWith(bytes, MONOLITH_K5_MAGIC) && asciiAt(bytes, 0, 16).startsWith('/\\ NI FC MTD')) {
      return notYet('monolith-k5', 'Kontakt 5 monolith (instrument with embedded samples). Extraction is not implemented yet.');
    }

    if (bytes.length >= 4) {
      const id = u32be(bytes, 0);
      if (K1_INSTRUMENT.includes(id) || K1_MULTI.includes(id)) {
        return notYet('nki-k1', 'Kontakt 1 instrument. Parsing for this version is not implemented yet.');
      }
      if (id === K2_INSTRUMENT_LE || id === K2_INSTRUMENT_BE || K2_MULTI.includes(id)) {
        const header = readK2Header(bytes);
        if (header?.isK15) return notYet('nki-k1', 'Kontakt 1.5 instrument. Parsing for this version is not implemented yet.');
        if (header?.isMonolith) return notYet('monolith-k2', 'Kontakt 2-4 monolith (embedded samples). Extraction is not implemented yet.');
        if (header?.headerVersion === K2_HEADER_VERSION_K42) {
          return notYet('nki-k42-fastlz', 'Kontakt 4.2 instrument (FastLZ preset chunks). Parsing is not implemented yet.');
        }
        return ok('nki-k2-zlib', 'Kontakt 2-4.1 instrument with zlib-compressed XML patch data.');
      }
    }

    if (/^\s*(<\?xml|<K2_|<K4)/i.test(asciiAt(bytes, 0, 64))) {
      return ok('nki-xml', 'Plain XML Kontakt patch.');
    }

    if (ext === 'nkr' || ext === 'nkc' || ext === 'nkx' || ext === 'nicnt') {
      return notYet(
        'resource-container',
        `Kontakt library/resource container (.${ext}). Not parsed; commercial libraries in this form are usually licensed and may be encrypted.`,
      );
    }

    return notYet('unknown', 'Unrecognised Kontakt container.');
  } catch {
    return notYet('unknown', 'Unreadable Kontakt file.');
  }
}

// ─── K2-4.2 header ───────────────────────────────────────────────────────
export interface K2Header {
  littleEndian: boolean;
  compressedLength: number;
  headerVersion: number;
  isK15: boolean;
  isMonolith: boolean;
  zones: number;
  groups: number;
}

/** Reads the fixed part of a K2-4.2 header. Returns null when not a K2 file. */
export function readK2Header(bytes: Uint8Array): K2Header | null {
  if (bytes.length < 64) return null;
  const id = u32be(bytes, 0);
  if (id !== K2_INSTRUMENT_LE && id !== K2_INSTRUMENT_BE && !K2_MULTI.includes(id)) return null;
  const le = id === K2_INSTRUMENT_LE || id === K2_MULTI[0];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const compressedLength = dv.getUint32(4, le);
  const headerVersion = dv.getUint16(8, le);
  // magic(4) + compressedLength(4) + headerVersion(2) + headerMagic(4) + patchType(2)
  // + version(4) + libraryID(4) + timestamp(4) + unknown(4) = 32
  const zones = dv.getUint16(32, le);
  const groups = dv.getUint16(34, le);
  // instruments(2) @36, sampleSize(4) @38, isMonolith(4) @42
  const isMonolith = dv.getUint32(42, le) === 1;
  return {
    littleEndian: le,
    compressedLength,
    headerVersion,
    isK15: compressedLength === 0x24,
    isMonolith,
    zones,
    groups,
  };
}

// ─── Zone extraction (K2_Zone XML) ───────────────────────────────────────
function childValue(block: string, names: string[]): string | undefined {
  for (const n of names) {
    // attribute form
    const a = new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`, 'i').exec(block);
    if (a) return a[1];
    // element form <name>value</name> or <V name="n" value="v"/>
    const e = new RegExp(`<${n}>([^<]*)</${n}>`, 'i').exec(block);
    if (e) return e[1];
    const v = new RegExp(`<V\\s+name="${n}"\\s+value="([^"]*)"`, 'i').exec(block);
    if (v) return v[1];
  }
  return undefined;
}

function numValue(block: string, names: string[], fallback: number): number {
  const s = childValue(block, names);
  if (s === undefined) return fallback;
  const n = parseFloat(s);
  return isNaN(n) ? fallback : n;
}

/** Extract zones from Kontakt patch XML (K2_Zone elements, plus generic Zone fallbacks). */
export function parseKontaktXmlZones(xml: string): KontaktZone[] {
  const zones: KontaktZone[] = [];
  const re = /<(K2_Zone|Zone|zone)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = `${m[2]} ${m[4] ?? ''}`;
    const file = childValue(block, ['file_ex2', 'file_ex', 'sampleFile', 'file', 'path', 'filename', 'sample']);
    if (!file) continue;
    const clamp = (v: number) => Math.max(0, Math.min(127, Math.round(v)));
    zones.push({
      sampleName: file.split(/[\\/:]/).pop() ?? file,
      lowKey: clamp(numValue(block, ['lowKey', 'keyLow', 'lokey', 'low_key'], 0)),
      highKey: clamp(numValue(block, ['highKey', 'keyHigh', 'hikey', 'high_key'], 127)),
      rootKey: clamp(numValue(block, ['rootKey', 'root', 'root_key', 'pitch_keycenter'], 60)),
      lowVel: Math.max(1, clamp(numValue(block, ['lowVelocity', 'lowVel', 'velLow', 'lovel', 'low_velocity'], 1))),
      highVel: clamp(numValue(block, ['highVelocity', 'highVel', 'velHigh', 'hivel', 'high_velocity'], 127)),
      tuneCents: numValue(block, ['tune', 'fineTune'], 0),
      volumeDb: numValue(block, ['volume', 'gain'], 0),
    });
  }
  return zones;
}

async function inflateAt(bytes: Uint8Array, off: number): Promise<string | null> {
  try {
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([bytes.slice(off)]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  } catch {
    return null;
  }
}

/**
 * Inflate the zlib XML body of a K2-4.1 instrument. The stream starts after the
 * variable-size header; we search a bounded window for a valid zlib header and
 * accept the first candidate that inflates to XML.
 */
export async function inflateKontaktPatch(bytes: Uint8Array): Promise<string | null> {
  const header = readK2Header(bytes);
  if (header && header.headerVersion !== K2_HEADER_VERSION_K2) return null;
  const start = header ? 40 : 0;
  const end = Math.min(bytes.length - 1, header ? 512 : 256);
  for (let off = start; off < end; off++) {
    if (bytes[off] !== 0x78 || ((bytes[off] << 8) | bytes[off + 1]) % 31 !== 0) continue;
    const text = await inflateAt(bytes, off);
    if (text && text.includes('<')) return text;
  }
  return null;
}

// ─── NCW decoding ────────────────────────────────────────────────────────
export interface NcwDecodeResult {
  sampleRate: number;
  bitsPerSample: number;
  isFloat: boolean;
  channels: Float32Array[];
}

const NCW_BLOCK_MAGIC = 0x3e9a0c16;
const NCW_SAMPLES_PER_BLOCK = 512;
const NCW_FLAG_MID_SIDE = 1;
const NCW_FLAG_FLOAT = 2;

/** Reads `count` LSB-first packed signed values of `bitWidth` bits. */
function readBits(src: Uint8Array, byteOffset: number, bitWidth: number, count: number): Int32Array {
  const out = new Int32Array(count);
  let acc = 0;
  let accBits = 0;
  let pos = byteOffset;
  for (let i = 0; i < count; i++) {
    let v = 0;
    let got = 0;
    while (got < bitWidth) {
      if (accBits === 0) {
        acc = src[pos++] ?? 0;
        accBits = 8;
      }
      const take = Math.min(accBits, bitWidth - got);
      v |= (acc & ((1 << take) - 1)) << got;
      acc >>>= take;
      accBits -= take;
      got += take;
    }
    if (bitWidth < 32 && v & (1 << (bitWidth - 1))) v -= 2 ** bitWidth;
    out[i] = v | 0;
  }
  return out;
}

/**
 * Decode an NCW file to float PCM.
 * Header (LE, 120 bytes): magic@0 version@4 (0x130/0x131) channels@8 bits@10
 *   sampleRate@12 numSamples@16 blockTableOffset@20 blockDataOffset@24 size@28
 * Block table: u32 offsets relative to blockDataOffset, one more entry than blocks.
 * Each block: one 16-byte sub-block header per channel (magic, base i32, bits i16,
 *   flags u16, pad u32) followed by 512*|bits|/8 bytes.
 *   bits > 0: delta; bits < 0: truncated PCM; bits == 0: raw PCM at bitsPerSample.
 *   flags bit0: mid/side (L = M + S, R = M - S); bit1: IEEE float payload.
 */
export function decodeNcw(bytes: Uint8Array): NcwDecodeResult {
  if (!startsWith(bytes, NCW_MAGIC)) throw new Error('Not an NCW file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint32(4, true);
  if (!NCW_VERSIONS.includes(version)) throw new Error(`Unsupported NCW version 0x${version.toString(16)}`);
  const numChannels = dv.getUint16(8, true);
  const bitsPerSample = dv.getUint16(10, true);
  const sampleRate = dv.getUint32(12, true);
  const numSamples = dv.getUint32(16, true);
  const tableOffset = dv.getUint32(20, true);
  const dataOffset = dv.getUint32(24, true);

  if (numChannels < 1 || numChannels > 8 || ![8, 16, 24, 32].includes(bitsPerSample)) {
    throw new Error('Invalid NCW header');
  }
  if (dataOffset <= tableOffset || dataOffset > bytes.length) throw new Error('Invalid NCW block table');
  const entryCount = Math.floor((dataOffset - tableOffset) / 4);
  const blockCount = Math.min(entryCount - 1, Math.ceil(numSamples / NCW_SAMPLES_PER_BLOCK));
  if (blockCount < 0) throw new Error('Invalid NCW block table');

  const channels = Array.from({ length: numChannels }, () => new Float32Array(numSamples));
  const intScale = 1 / 2 ** (bitsPerSample - 1);
  const f32 = new Float32Array(1);
  const i32 = new Int32Array(f32.buffer);
  let isFloat = false;

  for (let blk = 0; blk < blockCount; blk++) {
    let pos = dataOffset + dv.getUint32(tableOffset + blk * 4, true);
    const frames = Math.min(NCW_SAMPLES_PER_BLOCK, numSamples - blk * NCW_SAMPLES_PER_BLOCK);
    const decoded: Float64Array[] = [];
    let midSide = false;

    for (let ch = 0; ch < numChannels; ch++) {
      if (pos + 16 > bytes.length || dv.getUint32(pos, true) !== NCW_BLOCK_MAGIC) {
        throw new Error(`Bad NCW block magic at ${pos}`);
      }
      const base = dv.getInt32(pos + 4, true);
      const bits = dv.getInt16(pos + 8, true);
      const flags = dv.getUint16(pos + 10, true);
      if (flags > 3) throw new Error(`Unsupported NCW block flags ${flags}`);
      if (flags & NCW_FLAG_MID_SIDE) midSide = true;
      const blockFloat = (flags & NCW_FLAG_FLOAT) !== 0;
      if (blockFloat) isFloat = true;
      pos += 16;

      let ints: Int32Array;
      if (bits > 0) {
        const deltas = readBits(bytes, pos, bits, NCW_SAMPLES_PER_BLOCK);
        ints = new Int32Array(NCW_SAMPLES_PER_BLOCK);
        let acc = base;
        for (let i = 0; i < NCW_SAMPLES_PER_BLOCK; i++) {
          ints[i] = acc;
          acc = (acc + deltas[i]) | 0;
        }
        pos += (bits * NCW_SAMPLES_PER_BLOCK) / 8;
      } else {
        const width = bits === 0 ? bitsPerSample : -bits;
        ints = readBits(bytes, pos, width, NCW_SAMPLES_PER_BLOCK);
        pos += (width * NCW_SAMPLES_PER_BLOCK) / 8;
      }

      const vals = new Float64Array(NCW_SAMPLES_PER_BLOCK);
      for (let i = 0; i < NCW_SAMPLES_PER_BLOCK; i++) {
        if (blockFloat) {
          i32[0] = ints[i];
          vals[i] = f32[0];
        } else {
          vals[i] = ints[i] * intScale;
        }
      }
      decoded.push(vals);
    }

    if (midSide) {
      if (numChannels !== 2) throw new Error('NCW mid/side requires exactly 2 channels');
      const [mid, side] = decoded;
      for (let i = 0; i < NCW_SAMPLES_PER_BLOCK; i++) {
        const m = mid[i];
        const s = side[i];
        mid[i] = m + s;
        side[i] = m - s;
      }
    }

    const outStart = blk * NCW_SAMPLES_PER_BLOCK;
    for (let ch = 0; ch < numChannels; ch++) {
      for (let i = 0; i < frames; i++) {
        channels[ch][outStart + i] = Math.max(-1, Math.min(1, decoded[ch][i]));
      }
    }
  }

  return { sampleRate, bitsPerSample, isFloat, channels };
}
