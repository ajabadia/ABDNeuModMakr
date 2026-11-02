// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ABDNeuModMakr â€” Native Instruments Kontakt Inspector (Fase 28)
//
// - Container classification for .nki / .nkm / .nkx / .nksn / .nkc / .ncw
// - Early DRM detection for encrypted Kontakt Player libraries
//   (never crashes; returns an informative diagnostic + conversion guide)
// - Open NKI: plain XML / zlib-compressed XML (Kontakt 1-4 era) zone extraction
// - NCW (Native Compressed Wave) decoder: block-based delta / bit-packed PCM
//   with mid-side stereo reconstruction (per monomadic/ncw public spec)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type KontaktContainerKind =
  | 'nki-xml'
  | 'nki-zlib'
  | 'nki-binary'
  | 'nki-encrypted'
  | 'monolith-encrypted'
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

// Known magic markers
const NCW_MAGIC = [0x01, 0xa8, 0x9e, 0xd6];
const DRM_MARKER = [0x2a, 0x47, 0x24, 0x4e]; // "*G$N"
const NKI_V5_MAGIC = [0x2f, 0x5c, 0x20, 0x50]; // Kontakt 5+ (proprietary chunked)
const ZLIB_HEADERS = [0x78];

function startsWith(b: Uint8Array, magic: number[], off = 0): boolean {
  if (b.length < off + magic.length) return false;
  return magic.every((v, i) => b[off + i] === v);
}

function indexOfSeq(b: Uint8Array, seq: number[], limit = b.length): number {
  const end = Math.min(limit, b.length) - seq.length;
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < seq.length; j++) if (b[i + j] !== seq[j]) continue outer;
    return i;
  }
  return -1;
}

function asciiProbe(b: Uint8Array, len = 512): string {
  let s = '';
  for (let i = 0; i < Math.min(len, b.length); i++) s += String.fromCharCode(b[i]);
  return s;
}

/** Classify a Kontakt file and decide whether it can be imported. Never throws. */
export function inspectKontaktFile(fileName: string, bytes: Uint8Array): KontaktDiagnostic {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  const head = asciiProbe(bytes);

  const encryptedResult = (kind: KontaktContainerKind, what: string): KontaktDiagnostic => ({
    kind,
    encrypted: true,
    importable: false,
    message:
      `${what} is protected by Native Instruments DRM (Kontakt Player licensing). ` +
      'Its samples are encrypted with keys bound to Native Access activation and cannot be read without them.',
    conversionGuide: KONTAKT_CONVERSION_GUIDE,
  });

  if (startsWith(bytes, NCW_MAGIC)) {
    return { kind: 'ncw', encrypted: false, importable: true, message: 'NCW compressed audio: decodable to PCM.', conversionGuide: [] };
  }
  if (ext === 'nkx' || ext === 'nksn' || ext === 'nkc' || ext === 'nkr') {
    return encryptedResult('monolith-encrypted', `Kontakt monolith/resource container (.${ext})`);
  }
  if (indexOfSeq(bytes, DRM_MARKER, 4096) >= 0) {
    return encryptedResult('nki-encrypted', `Kontakt instrument "${fileName}"`);
  }
  if (/<\?xml|<K4|<Program|<Instrument/i.test(head)) {
    return { kind: 'nki-xml', encrypted: false, importable: true, message: 'Open XML Kontakt instrument.', conversionGuide: [] };
  }
  // Zlib-compressed payload somewhere in the first header block (Kontakt 2-4)
  for (let off = 0; off < Math.min(bytes.length - 1, 256); off++) {
    if (ZLIB_HEADERS.includes(bytes[off]) && (((bytes[off] << 8) | bytes[off + 1]) % 31 === 0)) {
      return { kind: 'nki-zlib', encrypted: false, importable: true, message: 'Kontakt 2-4 instrument with zlib-compressed patch data.', conversionGuide: [] };
    }
  }
  if (startsWith(bytes, NKI_V5_MAGIC)) {
    return {
      kind: 'nki-binary',
      encrypted: false,
      importable: false,
      message: 'Kontakt 5+ proprietary binary patch. Structure is undocumented; re-save as "Patch + Samples" and export an SFZ map.',
      conversionGuide: KONTAKT_CONVERSION_GUIDE,
    };
  }
  return {
    kind: 'unknown',
    encrypted: false,
    importable: false,
    message: 'Unrecognised Kontakt container.',
    conversionGuide: KONTAKT_CONVERSION_GUIDE,
  };
}

// â”€â”€â”€ Open NKI zone extraction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function numAttr(tag: string, names: string[], fallback: number): number {
  for (const n of names) {
    const m = new RegExp(`\\b${n}\\s*=\\s*"(-?[\\d.]+)"`, 'i').exec(tag);
    if (m) return parseFloat(m[1]);
  }
  return fallback;
}

function strAttr(tag: string, names: string[]): string | undefined {
  for (const n of names) {
    const m = new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
    if (m) return m[1];
  }
  return undefined;
}

/** Extract zones from open (XML) NKI text. */
export function parseKontaktXmlZones(xml: string): KontaktZone[] {
  const zones: KontaktZone[] = [];
  const re = /<(?:Zone|zone|Sample)\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[0];
    const file = strAttr(tag, ['sampleFile', 'file', 'path', 'filename', 'sample']);
    if (!file) continue;
    const clamp = (v: number) => Math.max(0, Math.min(127, Math.round(v)));
    zones.push({
      sampleName: file.split(/[\\/]/).pop() ?? file,
      lowKey: clamp(numAttr(tag, ['lowKey', 'keyLow', 'lokey'], 0)),
      highKey: clamp(numAttr(tag, ['highKey', 'keyHigh', 'hikey'], 127)),
      rootKey: clamp(numAttr(tag, ['rootKey', 'root', 'pitch_keycenter'], 60)),
      lowVel: Math.max(1, clamp(numAttr(tag, ['lowVel', 'velLow', 'lovel'], 1))),
      highVel: clamp(numAttr(tag, ['highVel', 'velHigh', 'hivel'], 127)),
      tuneCents: numAttr(tag, ['tune', 'fineTune'], 0),
      volumeDb: numAttr(tag, ['volume', 'gain'], 0),
    });
  }
  return zones;
}

/** Inflate zlib payloads (Kontakt 2-4) using the platform DecompressionStream. */
export async function inflateKontaktPatch(bytes: Uint8Array): Promise<string | null> {
  for (let off = 0; off < Math.min(bytes.length - 1, 256); off++) {
    if (bytes[off] !== 0x78 || ((bytes[off] << 8) | bytes[off + 1]) % 31 !== 0) continue;
    try {
      const slice = bytes.slice(off);
      const ds = new DecompressionStream('deflate');
      const stream = new Blob([slice]).stream().pipeThrough(ds);
      const buf = await new Response(stream).arrayBuffer();
      return new TextDecoder('utf-8', { fatal: false }).decode(buf);
    } catch {
      // try next candidate header
    }
  }
  return null;
}

// â”€â”€â”€ NCW decoding â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface NcwDecodeResult {
  sampleRate: number;
  bitsPerSample: number;
  channels: Float32Array[];
}

const NCW_BLOCK_MAGIC = 0x3e9a0c16;
const NCW_SAMPLES_PER_BLOCK = 512;

function readBits(src: Uint8Array, byteOffset: number, bitWidth: number, count: number): Int32Array {
  const out = new Int32Array(count);
  let bitPos = 0;
  for (let i = 0; i < count; i++) {
    let v = 0;
    for (let b = 0; b < bitWidth; b++) {
      const idx = byteOffset + ((bitPos + b) >> 3);
      const bit = (src[idx] >> ((bitPos + b) & 7)) & 1;
      v |= bit << b;
    }
    bitPos += bitWidth;
    // sign extend
    if (bitWidth < 32 && v & (1 << (bitWidth - 1))) v -= 1 << bitWidth;
    out[i] = v;
  }
  return out;
}

/**
 * Decode an NCW file to float PCM.
 * Header: magic(4) channels(u16) bits(u16) sampleRate(u32) numSamples(u32)
 *         blockDefOffset(u32) blocksOffset(u32) blocksSize(u32)
 * Block header (16 bytes): magic(u32) baseValue(i32) bits(i16) flags(u16) reserved(u32)
 *   bits > 0  : delta-encoded with that width (first value = baseValue)
 *   bits < 0  : raw truncated PCM with |bits| width
 *   bits == 0 : raw full-width PCM
 *   flags & 1 : mid-side stereo pair (ch0 = mid, ch1 = side)
 */
export function decodeNcw(bytes: Uint8Array): NcwDecodeResult {
  if (!startsWith(bytes, NCW_MAGIC)) throw new Error('Not an NCW file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numChannels = dv.getUint16(8, true);
  const bitsPerSample = dv.getUint16(10, true);
  const sampleRate = dv.getUint32(12, true);
  const numSamples = dv.getUint32(16, true);
  const blockDefOffset = dv.getUint32(20, true);
  const blocksOffset = dv.getUint32(24, true);

  if (numChannels < 1 || numChannels > 8 || ![8, 16, 24, 32].includes(bitsPerSample)) {
    throw new Error('Invalid NCW header');
  }
  const blockCount = Math.ceil(numSamples / NCW_SAMPLES_PER_BLOCK);
  const channels = Array.from({ length: numChannels }, () => new Float32Array(numSamples));
  const scale = 1 / 2 ** (bitsPerSample - 1);

  for (let blk = 0; blk < blockCount; blk++) {
    const blockOffset = blocksOffset + dv.getUint32(blockDefOffset + blk * 4, true);
    let pos = blockOffset;
    const frames = Math.min(NCW_SAMPLES_PER_BLOCK, numSamples - blk * NCW_SAMPLES_PER_BLOCK);
    const decoded: Int32Array[] = [];
    let midSide = false;

    for (let ch = 0; ch < numChannels; ch++) {
      if (dv.getUint32(pos, true) !== NCW_BLOCK_MAGIC) throw new Error(`Bad NCW block magic at ${pos}`);
      const base = dv.getInt32(pos + 4, true);
      const bits = dv.getInt16(pos + 8, true);
      const flags = dv.getUint16(pos + 10, true);
      if (flags & 1) midSide = true;
      pos += 16;

      let samples: Int32Array;
      if (bits > 0) {
        const deltas = readBits(bytes, pos, bits, NCW_SAMPLES_PER_BLOCK);
        samples = new Int32Array(NCW_SAMPLES_PER_BLOCK);
        let acc = base;
        for (let i = 0; i < NCW_SAMPLES_PER_BLOCK; i++) {
          samples[i] = acc;
          acc += deltas[i];
        }
        pos += (bits * NCW_SAMPLES_PER_BLOCK) / 8;
      } else {
        const width = bits === 0 ? bitsPerSample : -bits;
        samples = readBits(bytes, pos, width, NCW_SAMPLES_PER_BLOCK);
        pos += (width * NCW_SAMPLES_PER_BLOCK) / 8;
      }
      decoded.push(samples);
    }

    if (midSide && numChannels >= 2) {
      const mid = decoded[0];
      const side = decoded[1];
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
        channels[ch][outStart + i] = Math.max(-1, Math.min(1, decoded[ch][i] * scale));
      }
    }
  }

  return { sampleRate, bitsPerSample, channels };
}
