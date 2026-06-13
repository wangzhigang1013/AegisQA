export type FeatureFlagKey =
  | 'ci_gate'
  | 'candidate_assets'
  | 'repair_tasks'
  | 'experiments'
  | 'annotation_queue'
  | 'judge_audit';

export type FeatureFlags = Record<FeatureFlagKey, boolean>;

export type FeatureFlagsResponse = {
  flags?: Partial<FeatureFlags>;
  defaults?: Partial<FeatureFlags>;
  env_prefix?: string;
};

export const FEATURE_FLAG_DEFAULTS: FeatureFlags = {
  ci_gate: false,
  candidate_assets: false,
  repair_tasks: false,
  experiments: false,
  annotation_queue: false,
  judge_audit: false,
};

export const FEATURE_ENV_PREFIX = 'VITE_ENABLE_';

const FEATURE_ENV_NAMES: Record<FeatureFlagKey, string> = {
  ci_gate: 'VITE_ENABLE_CI_GATE',
  candidate_assets: 'VITE_ENABLE_CANDIDATE_ASSETS',
  repair_tasks: 'VITE_ENABLE_REPAIR_TASKS',
  experiments: 'VITE_ENABLE_EXPERIMENTS',
  annotation_queue: 'VITE_ENABLE_ANNOTATION_QUEUE',
  judge_audit: 'VITE_ENABLE_JUDGE_AUDIT',
};

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', 'enabled']);

declare global {
  interface Window {
    __AEGISQA_FEATURE_FLAGS__?: Partial<FeatureFlags>;
  }
}

export function getFeatureFlags(): FeatureFlags {
  const flags: FeatureFlags = { ...FEATURE_FLAG_DEFAULTS };
  for (const feature of Object.keys(FEATURE_FLAG_DEFAULTS) as FeatureFlagKey[]) {
    const envValue = import.meta.env[FEATURE_ENV_NAMES[feature]];
    if (envValue !== undefined) {
      flags[feature] = TRUE_VALUES.has(String(envValue).trim().toLowerCase());
    }
  }
  return { ...flags, ...(globalThis.window?.__AEGISQA_FEATURE_FLAGS__ ?? {}) };
}

export function isFeatureEnabled(feature: FeatureFlagKey, flags: FeatureFlags = getFeatureFlags()) {
  return flags[feature];
}

export function allFeatureFlagsEnabled(): FeatureFlags {
  return Object.fromEntries(Object.keys(FEATURE_FLAG_DEFAULTS).map((feature) => [feature, true])) as FeatureFlags;
}

export function mergeFeatureFlags(base: FeatureFlags, remote?: Partial<FeatureFlags>): FeatureFlags {
  const merged = { ...base };
  for (const feature of Object.keys(FEATURE_FLAG_DEFAULTS) as FeatureFlagKey[]) {
    // 前端 env 与后端 env 任一显式开启都允许试用；默认 false 不覆盖已开启的本地 E2E/开发配置。
    merged[feature] = Boolean(base[feature] || remote?.[feature]);
  }
  return merged;
}
