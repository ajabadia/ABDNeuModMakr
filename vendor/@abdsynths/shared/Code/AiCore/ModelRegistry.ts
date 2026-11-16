// ─────────────────────────────────────────────────────────
// ABDShared — ModelRegistry & Shared Model Store Contracts
// Single TypeScript/JavaScript source mirroring modelCatalog.json
// so Vite, Vitest, and Node tsx resolve the catalog cleanly.
// ─────────────────────────────────────────────────────────

export type AbdAppId = 'abdneumodmakr' | 'abdaudiolab' | (string & {});

export interface SharedModelCatalogEntry {
  id: string;
  name: string;
  filename: string;
  default_url: string;
  size_mb: number;
  used_by: readonly AbdAppId[];
  inference_wired: boolean;
  coming_soon: boolean;
  description_es: string;
  description_en: string;
}

export interface SharedWorkdirInfo {
  models_root: string;
  source: 'env' | 'custom' | 'dev_resources' | 'default_documents' | string;
  settings_file?: string;
  exists: boolean;
  writable: boolean;
  free_gb?: number | null;
}

export interface SharedModelStatusItem extends SharedModelCatalogEntry {
  folder_path?: string;
  file_path?: string;
  installed: boolean;
  actual_size_mb?: number;
  supported_in_app: boolean;
  url: string;
  is_custom_url: boolean;
  download_state?: {
    status: 'ready' | 'missing' | 'downloading' | 'error' | string;
    progress: number;
    downloaded_bytes?: number;
    total_bytes?: number;
    speed_mbps?: number;
    error?: string | null;
  };
}

export interface SharedCatalogStatusPayload {
  workdir: SharedWorkdirInfo;
  models: SharedModelStatusItem[];
  offline?: boolean;
  error?: string;
}

export interface ModelStoreBridge {
  getStatus: () => Promise<SharedCatalogStatusPayload>;
  setWorkdir: (path: string) => Promise<SharedCatalogStatusPayload & { ok?: boolean }>;
  resetWorkdir?: () => Promise<SharedCatalogStatusPayload & { ok?: boolean }>;
  browseWorkdir?: () => Promise<string | null>;
  openWorkdir?: () => Promise<void>;
  downloadModel: (modelId: string) => Promise<{ ok: boolean; error?: string }>;
  getDownloadProgress?: (modelId: string) => Promise<{
    model_id: string;
    status: string;
    progress: number;
    downloaded_bytes?: number;
    total_bytes?: number;
    speed_mbps?: number;
    error?: string | null;
  }>;
  deleteModel: (modelId: string) => Promise<{ ok: boolean; error?: string }>;
  updateModelUrl?: (modelId: string, url: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
}

export const SHARED_WORKSPACE_STORAGE_KEY = 'abdsynths.ai.workdir.v1';

export const MODEL_CATALOG: Record<string, SharedModelCatalogEntry> = {
  htdemucs: {
    id: 'htdemucs',
    name: 'HT-Demucs v4 (Hybrid Transformer)',
    filename: 'htdemucs_f7e0c4bc.th',
    default_url: 'https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/f7e0c4bc-ba3fe64a.th',
    size_mb: 80.2,
    used_by: ['abdneumodmakr'],
    inference_wired: false,
    coming_soon: true,
    description_es:
      'Separación neuronal de stems en 4 pistas (Vocals, Drums, Bass, Other). Inferencia en VRAM pendiente; procesado actual vía DSP local.',
    description_en:
      '4-track neural stem separation (Vocals, Drums, Bass, Other). VRAM inference pending; current processing runs local DSP.',
  },
  basicpitch: {
    id: 'basicpitch',
    name: 'Spotify Basic Pitch (ONNX)',
    filename: 'basic_pitch_model.onnx',
    default_url: 'https://raw.githubusercontent.com/spotify/basic-pitch/main/basic_pitch/saved_models/icassp_2022/nmp.onnx',
    size_mb: 16.8,
    used_by: ['abdneumodmakr', 'abdaudiolab'],
    inference_wired: false,
    coming_soon: true,
    description_es:
      'Transcripción polifónica audio-a-MIDI y seguimiento continuo de F0/pitch bend. Descarga compartida; inferencia neuronal pendiente.',
    description_en:
      'Polyphonic audio-to-MIDI transcription and continuous F0/pitch-bend tracking. Shared weights; neural inference pending.',
  },
  deepfilter: {
    id: 'deepfilter',
    name: 'DeepFilterNet3 Studio Denoiser',
    filename: 'DeepFilterNet3_onnx.tar.gz',
    default_url: 'https://github.com/Rikorose/DeepFilterNet/raw/main/models/DeepFilterNet3_onnx.tar.gz',
    size_mb: 14.5,
    used_by: ['abdneumodmakr', 'abdaudiolab'],
    inference_wired: false,
    coming_soon: true,
    description_es:
      'Supresión neuronal de ruido estacionario de previo y sala a 48 kHz. Descarga compartida; inferencia neuronal pendiente.',
    description_en:
      '48 kHz neural stationary preamp and room noise suppression. Shared weights; neural inference pending.',
  },
  whispertiny: {
    id: 'whispertiny',
    name: 'Whisper Tiny Phoneme Aligner',
    filename: 'whisper_tiny_en.onnx',
    default_url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    size_mb: 39.0,
    used_by: ['abdneumodmakr'],
    inference_wired: false,
    coming_soon: true,
    description_es: 'Alineación temporal de fonemas vocales para corte automático de frases en AutoSlicer.',
    description_en: 'Vocal phoneme forced alignment for automatic phrase slicing in AutoSlicer.',
  },
  rtneural_nam_base: {
    id: 'rtneural_nam_base',
    name: 'RTNeural / NAM Grey-Box Base Weights',
    filename: 'rtneural_base_v1.json',
    default_url: 'https://huggingface.co/abdsynths/rtneural-base/resolve/main/rtneural_base_v1.json',
    size_mb: 4.2,
    used_by: ['abdaudiolab'],
    inference_wired: false,
    coming_soon: true,
    description_es: 'Pesos semilla WaveNet/LSTM para entrenamiento no lineal asistido en ABDAudioLab.',
    description_en: 'Seed WaveNet/LSTM weights for assisted nonlinear training in ABDAudioLab.',
  },
};

export function listCatalogModelsForApp(appId?: AbdAppId): SharedModelStatusItem[] {
  return Object.values(MODEL_CATALOG).map((entry) => ({
    ...entry,
    installed: false,
    supported_in_app: !appId || entry.used_by.includes(appId),
    url: entry.default_url,
    is_custom_url: false,
    download_state: { status: 'missing', progress: 0 },
  }));
}
