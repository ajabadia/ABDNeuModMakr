// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Virtual Filesystem Abstraction (Fase 29)
//
// Unifies ZIP archives (including nested ZIPs) and physical
// filesystem folder hierarchies into a high-performance in-memory
// tree without extracting files to the host hard drive.
// ─────────────────────────────────────────────────────────

import {
  indexZipArchive,
  extractZipEntry,
  parseZipArchive,
  type ZipCentralEntry,
} from '../NeuronFormats/ZipArchive.ts';

export interface VirtualFileEntry {
  /** Normalized POSIX path with forward slashes (e.g. "Vintage/Rhodes/sample.wav") */
  path: string;
  /** File basename (e.g. "sample.wav") */
  name: string;
  /** Size in bytes */
  size: number;
  /** Lazy or synchronous binary content getter */
  getData: () => Uint8Array | Promise<Uint8Array>;
  /** Optional origin metadata (e.g. "archive.zip" or "archive.zip::subfolder/inner.zip") */
  sourceContainer?: string;
}

export interface VirtualZipFsOptions {
  /** Recursively unpack and mount nested .zip or .xpn archives (default: true) */
  mountNestedZips?: boolean;
  /** Maximum recursion depth for nested archives (default: 3) */
  maxZipRecursionDepth?: number;
  /** Maximum total uncompressed bytes budget (default: 500 MB) */
  maxTotalBytes?: number;
}

/**
 * Normalizes file path to forward slashes and removes leading slashes and dot-slash segments.
 */
export function normalizeVirtualPath(rawPath: string): string {
  let norm = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  while (norm.startsWith('./')) {
    norm = norm.slice(2);
  }
  return norm;
}

/**
 * Checks if a path is macOS system metadata, hidden junk or unsafe zip-slip.
 */
export function isIgnorableOrUnsafePath(path: string): boolean {
  const norm = normalizeVirtualPath(path);
  if (!norm || norm.length > 512) return true;
  if (norm.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(norm)) return true;
  if (norm.split('/').includes('..')) return true;
  if (norm.includes('\0')) return true;
  if (norm.startsWith('__MACOSX/') || norm.includes('/__MACOSX/')) return true;
  const base = norm.split('/').pop() ?? norm;
  if (base.startsWith('._') || base === '.DS_Store' || base === 'Thumbs.db') return true;
  return false;
}

/**
 * Virtual Filesystem representing a collection of files loaded from
 * a folder, one or more ZIP archives, or an in-memory buffer.
 */
export class VirtualZipFs {
  private readonly files = new Map<string, VirtualFileEntry>();
  private readonly lowerMap = new Map<string, string>();
  private readonly directories = new Set<string>();

  public static async fromZipBuffer(
    zipData: ArrayBuffer | Uint8Array,
    containerName = 'archive.zip',
    options: VirtualZipFsOptions = {}
  ): Promise<VirtualZipFs> {
    const fs = new VirtualZipFs();
    await fs.mountZipBuffer(zipData, containerName, '', 0, options);
    return fs;
  }

  public static fromFileArray(
    fileList: Array<{ path: string; data: Uint8Array | ArrayBuffer | (() => Uint8Array | Promise<Uint8Array>) }>
  ): VirtualZipFs {
    const fs = new VirtualZipFs();
    for (const f of fileList) {
      const normPath = normalizeVirtualPath(f.path);
      if (isIgnorableOrUnsafePath(normPath)) continue;
      const base = normPath.split('/').pop() || normPath;
      const getter = typeof f.data === 'function'
        ? f.data
        : () => (f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data));
      const size = f.data instanceof Uint8Array ? f.data.byteLength : f.data instanceof ArrayBuffer ? f.data.byteLength : 0;
      fs.addFile({
        path: normPath,
        name: base,
        size,
        getData: getter,
      });
    }
    return fs;
  }

  public addFile(entry: VirtualFileEntry): void {
    const norm = normalizeVirtualPath(entry.path);
    if (isIgnorableOrUnsafePath(norm)) return;
    this.files.set(norm, {
      ...entry,
      path: norm,
    });
    this.lowerMap.set(norm.toLowerCase(), norm);

    // Record directory hierarchy
    const parts = norm.split('/');
    let currentDir = '';
    for (let i = 0; i < parts.length - 1; i++) {
      currentDir = currentDir ? `${currentDir}/${parts[i]}` : parts[i];
      this.directories.add(currentDir);
    }
  }

  public getFile(path: string): VirtualFileEntry | undefined {
    const norm = normalizeVirtualPath(path);
    const direct = this.files.get(norm);
    if (direct) return direct;
    const resolved = this.lowerMap.get(norm.toLowerCase());
    return resolved ? this.files.get(resolved) : undefined;
  }

  public hasFile(path: string): boolean {
    const norm = normalizeVirtualPath(path);
    if (this.files.has(norm)) return true;
    return this.lowerMap.has(norm.toLowerCase());
  }

  public listFiles(): VirtualFileEntry[] {
    return Array.from(this.files.values());
  }

  public listPaths(): string[] {
    return Array.from(this.files.keys());
  }

  public listDirectories(): string[] {
    return Array.from(this.directories.values());
  }

  /**
   * Returns all files directly inside or under a given directory prefix.
   */
  public listFilesUnder(dirPrefix: string): VirtualFileEntry[] {
    const normDir = normalizeVirtualPath(dirPrefix).replace(/\/+$/, '');
    if (!normDir) return this.listFiles();
    const prefix = `${normDir}/`;
    return this.listFiles().filter((f) => f.path.startsWith(prefix));
  }

  /**
   * Mounts a ZIP buffer into this virtual filesystem under a relative mount point prefix.
   */
  public async mountZipBuffer(
    zipData: ArrayBuffer | Uint8Array,
    containerName: string,
    prefixPath = '',
    depth = 0,
    options: VirtualZipFsOptions = {}
  ): Promise<void> {
    const mountNested = options.mountNestedZips !== false;
    const maxDepth = options.maxZipRecursionDepth ?? 3;
    const bytes = zipData instanceof Uint8Array ? zipData : new Uint8Array(zipData);

    const index = indexZipArchive(bytes);
    const nestedZipsToMount: Array<{ path: string; name: string; getBytes: () => Uint8Array }> = [];

    for (const entry of index) {
      if (entry.path.endsWith('/') || isIgnorableOrUnsafePath(entry.path)) continue;

      const fullPath = prefixPath ? `${prefixPath}/${entry.path}` : entry.path;
      const normPath = normalizeVirtualPath(fullPath);
      const base = normPath.split('/').pop() || normPath;
      const lower = base.toLowerCase();

      const getData = (): Uint8Array => extractZipEntry(bytes, entry);

      if (mountNested && depth < maxDepth && (lower.endsWith('.zip') || lower.endsWith('.xpn'))) {
        nestedZipsToMount.push({
          path: normPath,
          name: base,
          getBytes: getData,
        });
      }

      this.addFile({
        path: normPath,
        name: base,
        size: entry.uncompressedSize || entry.compressedSize,
        getData,
        sourceContainer: containerName,
      });
    }

    // Process nested archives recursively
    for (const nested of nestedZipsToMount) {
      try {
        const nestedBytes = nested.getBytes();
        // Check PK signature (0x04034b50)
        if (nestedBytes.length >= 4 && nestedBytes[0] === 0x50 && nestedBytes[1] === 0x4b) {
          const nestedPrefix = nested.path.replace(/\.[^.]+$/, '');
          await this.mountZipBuffer(
            nestedBytes,
            `${containerName}::${nested.path}`,
            nestedPrefix,
            depth + 1,
            options
          );
        }
      } catch {
        // Silently skip corrupted inner zip
      }
    }
  }

  /**
   * Helper to retrieve all entries as a Map of relative paths to Uint8Array.
   */
  public async toFileMap(): Promise<Map<string, Uint8Array>> {
    const map = new Map<string, Uint8Array>();
    for (const [path, entry] of this.files.entries()) {
      const data = await Promise.resolve(entry.getData());
      map.set(path, data);
    }
    return map;
  }
}
