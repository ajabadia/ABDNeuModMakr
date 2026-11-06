// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — Fase 42.5: Bridge Types
// Contratos del Companion Bridge (SSOT de tipos) + núcleo mínimo
// (`BridgeCore`) que los módulos de dominio necesitan del cliente.
// ─────────────────────────────────────────────────────────

export interface BridgeLibraries {
  numpy: boolean;
  soundfile: boolean;
  scipy: boolean;
  torch: boolean;
}

export interface BridgeCapabilities {
  status: string;
  app: string;
  version: string;
  python: string;
  device: string;
  gpu: boolean;
  gpu_name: string;
  libraries: BridgeLibraries;
  capabilities: string[];
}

export interface BridgeStatus {
  connected: boolean;
  url: string;
  latencyMs?: number;
  capabilities?: BridgeCapabilities;
  lastChecked?: number;
  error?: string;
}

export interface BridgeScanFile {
  name: string;
  path: string;
  size: number;
  ext: string;
}

export interface BridgeScanResult {
  scanned_path: string;
  total_files: number;
  files: BridgeScanFile[];
}

export interface AxionikDbModelEntry {
  slug: string;
  name: string;
  category: string;
  parameterSet: number;
  zoneCount: number;
  complexity: number;
  hasCover: boolean;
  createdAt?: string;
  updatedAt?: string;
  folderPath: string;
  sublibrary?: string;
  sublibraryOrdinal?: number;
}

export interface SublibraryInfo {
  name: string;
  description?: string;
  order: number;
  modelCount: number;
  isDefault?: boolean;
}

export interface AxionikSaveFileEntry {
  path: string;
  content?: string;
  content_b64?: string;
}

export interface StemSeparationResult {
  status: string;
  stems: Record<string, ArrayBuffer>;
  sampleRate: number;
  durationSec: number;
  success?: boolean;
  error?: string;
}

export interface PhonemeWord {
  word: string;
  startSec: number;
  endSec: number;
  startFrame: number;
  endFrame: number;
  confidence?: number;
}

export interface PhonemeAlignmentResult {
  status: string;
  words: PhonemeWord[];
  boundaries: number[];
  sampleRate: number;
  totalFrames: number;
  durationSec?: number;
  success?: boolean;
  error?: string;
}

export interface BridgeMemoryStatus {
  status: string;
  has_cuda: boolean;
  device_name: string;
  vram_allocated_mb: number;
  vram_reserved_mb: number;
  vram_total_mb: number;
  action?: string;
}

export interface BridgeEnhanceOptions {
  targetSampleRate?: number;
  targetLoopSec?: number;
  capabilities?: string[];
  timeoutMs?: number;
  textPrompt?: string;
  /** Fase 30: Captured Noise Profile to remove/ignore during AI enhancement */
  noiseProfile?: {
    levelDbfs: number;
    hum50HzDb?: number;
    hum60HzDb?: number;
    spectrumBands?: number[];
  };
}

export interface BridgeModelInfo {
  id: string;
  name: string;
  task: string;
  category?: string;
  package?: string;
  runtime?: 'onnx' | 'pytorch' | 'safetensors';
  min_vram_mb?: number;
  filename: string;
  size_mb: number;
  description: string;
  url?: string;
  default_url?: string;
  is_custom_url?: boolean;
  installed: boolean;
  status: 'ready' | 'downloading' | 'available' | 'error' | 'idle';
  progress: number;
  downloaded_bytes?: number;
  total_bytes?: number;
  speed_mbps?: number;
  error?: string | null;
}

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:7860';
const MAX_BRIDGE_URL_LENGTH = 500;

/** S4.1: la URL del bridge es entrada no confiable (localStorage/UI). Solo http(s), sin credenciales. */
export function validateBridgeUrl(v: unknown): string {
  const fallback = DEFAULT_BRIDGE_URL;
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'string') throw new Error('Invalid bridge URL: must be a string');
  const t = v.trim();
  if (t.length === 0) return fallback;
  if (t.length > MAX_BRIDGE_URL_LENGTH) throw new Error(`Invalid bridge URL: too long (max ${MAX_BRIDGE_URL_LENGTH})`);
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new Error('Invalid bridge URL: must be a valid http(s) URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Invalid bridge URL: only http(s) allowed');
  }
  if (u.username || u.password) throw new Error('Invalid bridge URL: credentials in URL are blocked');
  const host = u.hostname.toLowerCase();
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  if (!isLoopback) {
    if (host.endsWith('.local') || host === '0.0.0.0' || host.startsWith('10.') || host.startsWith('192.168.') || host === '169.254.169.254' || host.startsWith('169.254.') || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
      throw new Error('Invalid bridge URL: private/link-local hosts are blocked');
    }
  }
  return t.replace(/\/+$/, '');
}

export type BridgeStatusListener = (status: BridgeStatus) => void;

/**
 * Superficie mínima que los módulos `bridge*` necesitan del cliente.
 * `BridgeClient` la implementa; se pasa como `core` a cada operación.
 */
export interface BridgeCore {
  getUrl(): string;
  isConnected(): boolean;
  authHeaders(base?: Record<string, string>): Record<string, string>;
}
