// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Zero-Dependency PKZIP Reader & Writer
//
// Creates and reads standard ZIP archives (STORE method 0 + IEEE 802.3 CRC-32)
// for packaging multi-file Hartmann Neuron `.model` (`MName`, `map.script`,
// `%06d.scape`, `%06d.sphere`), `.sound` (`sound.script`, `sound.stickrec`),
// and `.neuronikmodel` bundles in the browser or Node.js.
// ─────────────────────────────────────────────────────────

export interface ZipEntryInput {
  /** Relative path inside the ZIP using forward slashes (e.g. "Models/000.model/MName") */
  path: string;
  /** File content as Uint8Array or UTF-8/ASCII string */
  data: Uint8Array | string;
}

export interface ParsedZipEntry {
  path: string;
  data: Uint8Array;
}

/**
 * Lightweight Central Directory / Local Header descriptor for lazy extraction.
 * Allows inspecting a multi-hundred-megabyte ZIP/.xpn archive in <1 ms and
 * decompressing only the entries actually needed.
 */
export interface ZipCentralEntry {
  path: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  dataOffset: number;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.byteLength; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeUtf8(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}

function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  let s = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

/**
 * Builds a standard uncompressed (`STORE`, method 0) PKZIP archive from a list of files.
 */
export function createZipArchive(entries: readonly ZipEntryInput[]): Uint8Array {
  interface PreparedEntry {
    nameBytes: Uint8Array;
    dataBytes: Uint8Array;
    crc: number;
    localHeaderOffset: number;
  }

  const prepared: PreparedEntry[] = [];
  let localSectionBytes = 0;
  let centralDirBytes = 0;

  for (const entry of entries) {
    const cleanPath = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBytes = encodeUtf8(cleanPath);
    const dataBytes =
      typeof entry.data === 'string' ? encodeUtf8(entry.data) : entry.data;
    const crc = crc32(dataBytes);

    prepared.push({
      nameBytes,
      dataBytes,
      crc,
      localHeaderOffset: localSectionBytes,
    });

    localSectionBytes += 30 + nameBytes.byteLength + dataBytes.byteLength;
    centralDirBytes += 46 + nameBytes.byteLength;
  }

  const totalBytes = localSectionBytes + centralDirBytes + 22;
  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);

  // MS-DOS date/time (2026-10-26 12:00:00)
  const dosTime = (12 << 11) | (0 << 5) | 0;
  const dosDate = ((2026 - 1980) << 9) | (10 << 5) | 26;

  let ptr = 0;

  // 1. Write Local File Headers + Payloads
  for (const item of prepared) {
    const size = item.dataBytes.byteLength;
    const nameLen = item.nameBytes.byteLength;

    view.setUint32(ptr + 0, 0x04034b50, true); // Local file header signature
    view.setUint16(ptr + 4, 20, true);         // Version needed to extract (2.0)
    view.setUint16(ptr + 6, 0, true);          // General purpose bit flag
    view.setUint16(ptr + 8, 0, true);          // Compression method: 0 (STORE)
    view.setUint16(ptr + 10, dosTime, true);   // Last mod file time
    view.setUint16(ptr + 12, dosDate, true);   // Last mod file date
    view.setUint32(ptr + 14, item.crc, true);  // CRC-32
    view.setUint32(ptr + 18, size, true);      // Compressed size
    view.setUint32(ptr + 22, size, true);      // Uncompressed size
    view.setUint16(ptr + 26, nameLen, true);   // File name length
    view.setUint16(ptr + 28, 0, true);         // Extra field length

    out.set(item.nameBytes, ptr + 30);
    out.set(item.dataBytes, ptr + 30 + nameLen);
    ptr += 30 + nameLen + size;
  }

  const centralDirOffset = ptr;

  // 2. Write Central Directory Headers
  for (const item of prepared) {
    const size = item.dataBytes.byteLength;
    const nameLen = item.nameBytes.byteLength;

    view.setUint32(ptr + 0, 0x02014b50, true);  // Central directory signature
    view.setUint16(ptr + 4, 20, true);          // Version made by
    view.setUint16(ptr + 6, 20, true);          // Version needed to extract
    view.setUint16(ptr + 8, 0, true);           // General purpose bit flag
    view.setUint16(ptr + 10, 0, true);          // Compression method: 0 (STORE)
    view.setUint16(ptr + 12, dosTime, true);    // Last mod file time
    view.setUint16(ptr + 14, dosDate, true);    // Last mod file date
    view.setUint32(ptr + 16, item.crc, true);   // CRC-32
    view.setUint32(ptr + 20, size, true);       // Compressed size
    view.setUint32(ptr + 24, size, true);       // Uncompressed size
    view.setUint16(ptr + 28, nameLen, true);    // File name length
    view.setUint16(ptr + 30, 0, true);          // Extra field length
    view.setUint16(ptr + 32, 0, true);          // File comment length
    view.setUint16(ptr + 34, 0, true);          // Disk number start
    view.setUint16(ptr + 36, 0, true);          // Internal file attributes
    view.setUint32(ptr + 38, 0, true);          // External file attributes
    view.setUint32(ptr + 42, item.localHeaderOffset, true); // Relative offset of local header

    out.set(item.nameBytes, ptr + 46);
    ptr += 46 + nameLen;
  }

  // 3. Write End of Central Directory Record (EOCD)
  view.setUint32(ptr + 0, 0x06054b50, true);         // EOCD signature
  view.setUint16(ptr + 4, 0, true);                  // Number of this disk
  view.setUint16(ptr + 6, 0, true);                  // Disk where central directory starts
  view.setUint16(ptr + 8, prepared.length, true);    // Number of central directory records on this disk
  view.setUint16(ptr + 10, prepared.length, true);   // Total number of central directory records
  view.setUint32(ptr + 12, centralDirBytes, true);   // Size of central directory
  view.setUint32(ptr + 16, centralDirOffset, true);  // Offset of start of central directory
  view.setUint16(ptr + 20, 0, true);                 // Comment length

  return out;
}

/**
 * Inflates a raw DEFLATE (RFC 1951, method 8) byte stream into an uncompressed Uint8Array.
 * Supports Block Type 0 (stored), Block Type 1 (fixed Huffman), and Block Type 2 (dynamic Huffman).
 */
export const MAX_ZIP_ENTRIES = 2000;
export const MAX_ZIP_ENTRY_BYTES = 100 * 1024 * 1024;
export const MAX_ZIP_TOTAL_BYTES = 300 * 1024 * 1024;

export function inflateRaw(compressed: Uint8Array, expectedSize?: number): Uint8Array {
  if (expectedSize !== undefined && expectedSize > MAX_ZIP_ENTRY_BYTES) {
    throw new Error(`ZIP entry too large (${expectedSize} bytes, max ${MAX_ZIP_ENTRY_BYTES})`);
  }
  let out = new Uint8Array(
    expectedSize && expectedSize > 0
      ? expectedSize
      : Math.max(1024, compressed.byteLength * 3)
  );
  let outPos = 0;

  const ensureCapacity = (needed: number) => {
    if (outPos + needed <= out.byteLength) return;
    let nextLen = Math.max(out.byteLength * 2, outPos + needed);
    const next = new Uint8Array(nextLen);
    next.set(out.subarray(0, outPos));
    out = next;
  };

  let bitBuf = 0;
  let bitCount = 0;
  let bytePtr = 0;
  const totalBytes = compressed.byteLength;

  const fillBits = (n: number): void => {
    while (bitCount < n && bytePtr < totalBytes) {
      bitBuf |= compressed[bytePtr++] << bitCount;
      bitCount += 8;
    }
  };

  const readBits = (n: number): number => {
    if (n === 0) return 0;
    fillBits(n);
    if (bitCount < n) {
      throw new Error('Unexpected EOF in DEFLATE stream');
    }
    const val = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCount -= n;
    return val;
  };

  interface HuffTree {
    maxBits: number;
    /** Flat lookup table indexed by LSB-first bit pattern (0 .. (1 << maxBits) - 1).
     *  Entry = `(bitLen << 16) | symbol`, or `-1` if invalid.
     */
    fastTable: Int32Array;
  }

  const buildHuffman = (lengths: ArrayLike<number>): HuffTree => {
    let maxBits = 0;
    const blCount = new Int32Array(16);
    for (let i = 0; i < lengths.length; i++) {
      const len = lengths[i];
      if (len > 0) {
        blCount[len]++;
        if (len > maxBits) maxBits = len;
      }
    }
    if (maxBits === 0) {
      const empty = new Int32Array(2);
      empty.fill(-1);
      return { maxBits: 1, fastTable: empty };
    }

    const nextCode = new Int32Array(16);
    let code = 0;
    blCount[0] = 0;
    for (let bits = 1; bits <= 15; bits++) {
      code = (code + blCount[bits - 1]) << 1;
      nextCode[bits] = code;
    }

    const tableSize = 1 << maxBits;
    const fastTable = new Int32Array(tableSize);
    fastTable.fill(-1);

    for (let sym = 0; sym < lengths.length; sym++) {
      const len = lengths[sym];
      if (len > 0) {
        const c = nextCode[len]++;
        // Reverse bits for LSB-first lookup
        let rev = 0;
        for (let b = 0; b < len; b++) {
          rev |= ((c >>> (len - 1 - b)) & 1) << b;
        }
        const entry = (len << 16) | sym;
        const step = 1 << len;
        for (let fill = rev; fill < tableSize; fill += step) {
          fastTable[fill] = entry;
        }
      }
    }
    return { maxBits, fastTable };
  };

  const decodeSymbol = (tree: HuffTree): number => {
    fillBits(tree.maxBits);
    const idx = bitBuf & ((1 << tree.maxBits) - 1);
    const entry = tree.fastTable[idx];
    if (entry < 0) {
      throw new Error('Invalid Huffman code in DEFLATE stream');
    }
    const len = entry >>> 16;
    if (bitCount < len) {
      throw new Error('Unexpected EOF in DEFLATE stream');
    }
    bitBuf >>>= len;
    bitCount -= len;
    return entry & 0xffff;
  };

  const FIXED_LIT_LENGTHS = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) FIXED_LIT_LENGTHS[i] = 8;
  for (let i = 144; i <= 255; i++) FIXED_LIT_LENGTHS[i] = 9;
  for (let i = 256; i <= 279; i++) FIXED_LIT_LENGTHS[i] = 7;
  for (let i = 280; i <= 287; i++) FIXED_LIT_LENGTHS[i] = 8;
  const FIXED_LIT_TREE = buildHuffman(FIXED_LIT_LENGTHS);

  const FIXED_DIST_LENGTHS = new Uint8Array(32);
  FIXED_DIST_LENGTHS.fill(5);
  const FIXED_DIST_TREE = buildHuffman(FIXED_DIST_LENGTHS);

  const LEN_BASE = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
    35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
  ];
  const LEN_EXTRA = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
    3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
  ];
  const DIST_BASE = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
    257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
  ];
  const DIST_EXTRA = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
    7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
  ];
  const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  let isFinal = 0;
  while (!isFinal) {
    isFinal = readBits(1);
    const btype = readBits(2);

    if (btype === 0) {
      // Uncompressed block: discard remaining bits in current byte
      const dropBits = bitCount & 7;
      bitBuf >>>= dropBits;
      bitCount -= dropBits;
      // Drain any whole bytes already prefetched into bitBuf back to bytePtr
      while (bitCount >= 8) {
        bytePtr--;
        bitCount -= 8;
      }
      bitBuf = 0;
      bitCount = 0;
      if (bytePtr + 4 > totalBytes) {
        throw new Error('Truncated stored block in DEFLATE stream');
      }
      const len = compressed[bytePtr] | (compressed[bytePtr + 1] << 8);
      const nlen = compressed[bytePtr + 2] | (compressed[bytePtr + 3] << 8);
      if ((len ^ 0xffff) !== nlen) {
        throw new Error('Corrupt stored block length in DEFLATE stream');
      }
      bytePtr += 4;
      if (bytePtr + len > totalBytes) {
        throw new Error('Truncated stored block payload in DEFLATE stream');
      }
      ensureCapacity(len);
      out.set(compressed.subarray(bytePtr, bytePtr + len), outPos);
      outPos += len;
      bytePtr += len;
    } else if (btype === 1 || btype === 2) {
      let litTree = FIXED_LIT_TREE;
      let distTree = FIXED_DIST_TREE;

      if (btype === 2) {
        const hlit = readBits(5) + 257;
        const hdist = readBits(5) + 1;
        const hclen = readBits(4) + 4;

        const clLengths = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) {
          clLengths[CL_ORDER[i]] = readBits(3);
        }
        const clTree = buildHuffman(clLengths);

        const totalCodes = hlit + hdist;
        const codeLengths = new Uint8Array(totalCodes);
        let idx = 0;
        while (idx < totalCodes) {
          const sym = decodeSymbol(clTree);
          if (sym < 16) {
            codeLengths[idx++] = sym;
          } else if (sym === 16) {
            const rep = readBits(2) + 3;
            const prev = idx > 0 ? codeLengths[idx - 1] : 0;
            for (let r = 0; r < rep && idx < totalCodes; r++) {
              codeLengths[idx++] = prev;
            }
          } else if (sym === 17) {
            const rep = readBits(3) + 3;
            for (let r = 0; r < rep && idx < totalCodes; r++) {
              codeLengths[idx++] = 0;
            }
          } else if (sym === 18) {
            const rep = readBits(7) + 11;
            for (let r = 0; r < rep && idx < totalCodes; r++) {
              codeLengths[idx++] = 0;
            }
          }
        }

        litTree = buildHuffman(codeLengths.subarray(0, hlit));
        distTree = buildHuffman(codeLengths.subarray(hlit, totalCodes));
      }

      while (true) {
        const sym = decodeSymbol(litTree);
        if (sym < 256) {
          ensureCapacity(1);
          out[outPos++] = sym;
        } else if (sym === 256) {
          break;
        } else {
          const lenIdx = sym - 257;
          if (lenIdx < 0 || lenIdx >= LEN_BASE.length) {
            throw new Error(`Invalid length symbol ${sym} in DEFLATE stream`);
          }
          const copyLen = LEN_BASE[lenIdx] + (LEN_EXTRA[lenIdx] > 0 ? readBits(LEN_EXTRA[lenIdx]) : 0);
          const distSym = decodeSymbol(distTree);
          if (distSym < 0 || distSym >= DIST_BASE.length) {
            throw new Error(`Invalid distance symbol ${distSym} in DEFLATE stream`);
          }
          const dist = DIST_BASE[distSym] + (DIST_EXTRA[distSym] > 0 ? readBits(DIST_EXTRA[distSym]) : 0);
          if (dist > outPos) {
            throw new Error('Invalid back-reference distance in DEFLATE stream');
          }
          ensureCapacity(copyLen);
          if (dist >= copyLen) {
            out.copyWithin(outPos, outPos - dist, outPos - dist + copyLen);
            outPos += copyLen;
          } else {
            for (let c = 0; c < copyLen; c++) {
              out[outPos] = out[outPos - dist];
              outPos++;
            }
          }
        }
      }
    } else {
      throw new Error(`Invalid DEFLATE block type ${btype}`);
    }
  }

  return out.subarray(0, outPos);
}

/** S6.2 Zip-Slip: rechaza `..`, rutas absolutas, unidades Windows y NUL. */
export function isUnsafeZipPath(path: string): boolean {
  const norm = path.replace(/\\/g, '/');
  return (
    norm.length === 0 ||
    norm.length > 512 ||
    norm.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(norm) ||
    norm.split('/').includes('..') ||
    norm.includes('\0')
  );
}

function isMacOsJunkZipPath(path: string): boolean {
  const norm = path.replace(/\\/g, '/');
  if (norm.startsWith('__MACOSX/') || norm.includes('/__MACOSX/')) return true;
  const base = norm.split('/').pop() ?? norm;
  if (base.startsWith('._') || base === '.DS_Store') return true;
  return false;
}

/**
 * Indexes all entries in a ZIP archive without decompressing their payloads.
 * Runs in <1 ms even on 250 MB archives by scanning the Central Directory.
 */
export function indexZipArchive(zipBytes: Uint8Array): ZipCentralEntry[] {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const entries: ZipCentralEntry[] = [];

  let eocdOffset = -1;
  const minEocdSearch = Math.max(0, zipBytes.byteLength - 65557);
  for (let i = zipBytes.byteLength - 22; i >= minEocdSearch; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset >= 0) {
    const totalEntries = Math.min(view.getUint16(eocdOffset + 10, true), MAX_ZIP_ENTRIES);
    const centralDirOffset = view.getUint32(eocdOffset + 16, true);
    let cdPtr = centralDirOffset;

    for (let idx = 0; idx < totalEntries && cdPtr + 46 <= zipBytes.byteLength; idx++) {
      const cdSig = view.getUint32(cdPtr, true);
      if (cdSig !== 0x02014b50) break;

      const method = view.getUint16(cdPtr + 10, true);
      const crc = view.getUint32(cdPtr + 16, true);
      const compSize = view.getUint32(cdPtr + 20, true);
      const uncompSize = view.getUint32(cdPtr + 24, true);
      const nameLen = view.getUint16(cdPtr + 28, true);
      const extraLen = view.getUint16(cdPtr + 30, true);
      const commentLen = view.getUint16(cdPtr + 32, true);
      const localHeaderOffset = view.getUint32(cdPtr + 42, true);

      const nameBytes = zipBytes.subarray(cdPtr + 46, cdPtr + 46 + nameLen);
      const path = decodeUtf8(nameBytes);
      cdPtr += 46 + nameLen + extraLen + commentLen;

      if (path.endsWith('/') || isMacOsJunkZipPath(path) || isUnsafeZipPath(path)) continue;
      if (localHeaderOffset + 30 > zipBytes.byteLength) continue;
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) continue;

      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      if (dataStart + compSize > zipBytes.byteLength) continue;
      if (compSize > MAX_ZIP_ENTRY_BYTES || uncompSize > MAX_ZIP_ENTRY_BYTES) continue;

      entries.push({
        path,
        method,
        compressedSize: compSize,
        uncompressedSize: uncompSize,
        crc32: crc,
        dataOffset: dataStart,
      });
      if (entries.length >= MAX_ZIP_ENTRIES) break;
    }

    if (entries.length > 0) {
      return entries;
    }
  }

  // Fallback: sequential Local File Headers
  let ptr = 0;
  while (ptr + 30 <= zipBytes.byteLength) {
    const sig = view.getUint32(ptr, true);
    if (sig !== 0x04034b50) break;

    const method = view.getUint16(ptr + 8, true);
    const crc = view.getUint32(ptr + 14, true);
    const compSize = view.getUint32(ptr + 18, true);
    const uncompSize = view.getUint32(ptr + 22, true);
    const nameLen = view.getUint16(ptr + 26, true);
    const extraLen = view.getUint16(ptr + 28, true);
    const dataStart = ptr + 30 + nameLen + extraLen;
    if (dataStart + compSize > zipBytes.byteLength) break;

    const nameBytes = zipBytes.subarray(ptr + 30, ptr + 30 + nameLen);
    const path = decodeUtf8(nameBytes);

    if (!path.endsWith('/') && !isMacOsJunkZipPath(path) && !isUnsafeZipPath(path)) {
      if (compSize > MAX_ZIP_ENTRY_BYTES || uncompSize > MAX_ZIP_ENTRY_BYTES) break;
      entries.push({
        path,
        method,
        compressedSize: compSize,
        uncompressedSize: uncompSize,
        crc32: crc,
        dataOffset: dataStart,
      });
      if (entries.length >= MAX_ZIP_ENTRIES) break;
    }

    ptr = dataStart + compSize;
  }

  return entries;
}

/**
 * Extracts and decompresses a single entry from a ZIP archive using its Central Directory descriptor.
 */
export function extractZipEntry(zipBytes: Uint8Array, entry: ZipCentralEntry): Uint8Array {
  if (entry.compressedSize > MAX_ZIP_ENTRY_BYTES || entry.uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
    throw new Error(`ZIP entry exceeds size budget: ${entry.path}`);
  }
  const rawSlice = zipBytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  if (entry.method === 0) {
    const payload = new Uint8Array(entry.compressedSize);
    payload.set(rawSlice);
    return payload;
  }
  if (entry.method === 8) {
    if (entry.uncompressedSize === 0 && entry.compressedSize === 0) {
      return new Uint8Array(0);
    }
    const inflated = inflateRaw(rawSlice, entry.uncompressedSize);
    const payload = new Uint8Array(inflated.byteLength);
    payload.set(inflated);
    return payload;
  }
  throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.path}`);
}

/**
 * Parses a ZIP archive (`STORE` method 0 or `DEFLATE` method 8) into its constituent files.
 * Uses the Central Directory when present (supporting Data Descriptor bit-flag 3 archives
 * created by macOS / Windows / 7-Zip) with fallback to sequential local file headers.
 */
export function parseZipArchive(zipBytes: Uint8Array): ParsedZipEntry[] {
  const index = indexZipArchive(zipBytes);
  const entries: ParsedZipEntry[] = [];
  let totalUncompressed = 0;

  for (const item of index) {
    if (item.method !== 0 && item.method !== 8) continue;
    if (item.method === 8 && item.uncompressedSize === 0 && item.compressedSize === 0) continue;
    const data = extractZipEntry(zipBytes, item);
    if (data.byteLength > MAX_ZIP_ENTRY_BYTES) continue;
    totalUncompressed += data.byteLength;
    if (totalUncompressed > MAX_ZIP_TOTAL_BYTES) break;
    entries.push({ path: item.path, data });
  }

  return entries;
}
