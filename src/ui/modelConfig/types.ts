// ─────────────────────────────────────────────────────────
// Model Configuration — shared contracts for the dialog shell
// and its per-tab renderers / event binders.
// ─────────────────────────────────────────────────────────

import type { UnifiedSurfaceUiConfig } from '../../core/types';

export type ModelConfigTab = 'general' | 'articulation' | 'metadata' | 'artwork';

export interface ModelConfigModalHandlers {
  getConfig: () => import('../../core/types').ProcessConfig;
  onConfigChange: (config: import('../../core/types').ProcessConfig) => void;
  getParameterSets: () => import('../../core/types').ParameterSetInfo[];
  getSublibraries?: () => import('../../core/types').SublibraryInfo[] | string[];
  onCreateSublibrary?: (name: string) => Promise<void>;
  onSelectCoverImage?: (file: File) => void;
  onRemoveCoverImage?: () => void;
  onReprocessFromPurestSource?: () => void;
  onOpenAiCoverGenerator?: () => void;
  /** Optional real-sample Resynator v2 synthesis (motor WASM) from the active session's inspected zone. */
  getSessionResynatorV2Stereo?: (
    midiNote: number,
    velocity: number,
    hostBpm: number
  ) => Promise<{ left: Float32Array; right: Float32Array; sampleRate: number } | undefined>;
}

/** Resinator v2 audition parameters; shared by reference so tabs mutate live state. */
export interface ModelConfigPreviewState {
  midiNote: number;
  velocity: number;
  hostBpm: number;
}

/** Metadata tag editor state; shared by reference so tabs mutate live state. */
export interface ModelConfigTagEditorState {
  selectedKey: string;
  customKey: string;
}

/** Everything a tab renderer needs to build its markup. */
export interface ModelConfigTabContext {
  handlers: ModelConfigModalHandlers;
  preview: ModelConfigPreviewState;
  tags: ModelConfigTagEditorState;
}

/** Everything a tab event binder needs to wire its DOM. */
export interface ModelConfigEventContext extends ModelConfigTabContext {
  element: HTMLElement;
  rerender: () => void;
  audition: (surf: UnifiedSurfaceUiConfig, neutralCompare: boolean) => void;
  stopPreview: () => void;
}
