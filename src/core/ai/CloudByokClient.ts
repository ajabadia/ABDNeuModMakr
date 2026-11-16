// ─────────────────────────────────────────────────────────
// ABDNeuModMakr — CloudByokClient (DRY Re-export from @abdsynths/shared)
// Single source of truth lives in ABDShared/Code/AiCore/CloudByokClient.ts
// (synced into vendor/@abdsynths/shared via npm run vendor:sync).
// ─────────────────────────────────────────────────────────

export type {
  CloudAiProvider,
  ByokProvider,
  ByokStorageScope,
  ByokCapability,
  ByokConfig,
  ByokKeyField,
  CloudProviderMeta,
  CloudTextGenerationOptions,
  ByokTextGenerationOptions,
  CloudTextGenerationResult,
  ByokTextGenerationResult,
  CloudByokClientOptions,
  PresetAiMetadata,
  SampleGroupSuggestion,
} from '../../../vendor/@abdsynths/shared/Code/AiCore/CloudByokClient.ts';

export {
  CLOUD_PROVIDER_METADATA,
  ALL_CLOUD_PROVIDERS,
  TEXT_CAPABLE_PROVIDERS,
  SHARED_STORAGE_KEY_BYOK,
  LEGACY_STORAGE_KEY_BYOK,
  DEFAULT_BYOK_CONFIG,
  parseJsonObjectSafe,
  redactUrlForLog,
  fetchWithTimeout,
  safeErrorSnippet,
  CloudByokClient,
  cloudByokClient,
} from '../../../vendor/@abdsynths/shared/Code/AiCore/CloudByokClient.ts';
