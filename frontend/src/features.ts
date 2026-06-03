export type FeatureKey =
  | 'ci_gate'
  | 'candidate_assets'
  | 'repair_tasks'
  | 'experiments'
  | 'annotation_queue'
  | 'judge_audit';

export type FeatureFlag = {
  key: FeatureKey;
  label: string;
  enabled: boolean;
  reason: string;
};

declare global {
  // Optional test/local-debug hook. Production behavior is env-driven when unset.
  // eslint-disable-next-line no-var
  var __AEGISQA_FEATURE_OVERRIDES__: Partial<Record<FeatureKey, boolean>> | undefined;
}

export const disabledFeatureReason = 'Reality-first rebuild: hidden until backed by verified runtime behavior.';

export const featureLabels: Record<FeatureKey, string> = {
  ci_gate: 'CI Gate',
  candidate_assets: 'Candidate Assets',
  repair_tasks: 'Repair Tasks',
  experiments: 'Experiments',
  annotation_queue: 'Annotation Queue',
  judge_audit: 'Judge Audit',
};

export function getFeatureFlags(): Record<FeatureKey, FeatureFlag> {
  return Object.fromEntries(
    Object.entries(featureLabels).map(([key, label]) => {
      const featureKey = key as FeatureKey;
      const enabled = overrideEnabled(featureKey) ?? envEnabled(featureKey);
      return [
        featureKey,
        {
          key: featureKey,
          label,
          enabled,
          reason: enabled ? '' : disabledFeatureReason,
        },
      ];
    }),
  ) as Record<FeatureKey, FeatureFlag>;
}

export const featureFlags = new Proxy({} as Record<FeatureKey, FeatureFlag>, {
  get(_target, property: string | symbol) {
    return getFeatureFlags()[property as FeatureKey];
  },
});

export function isFeatureEnabled(key: FeatureKey): boolean {
  return getFeatureFlags()[key].enabled;
}

function overrideEnabled(key: FeatureKey): boolean | undefined {
  const overrides = globalThis.__AEGISQA_FEATURE_OVERRIDES__;
  if (!overrides || !(key in overrides)) {
    return undefined;
  }
  return Boolean(overrides[key]);
}

function envEnabled(key: FeatureKey): boolean {
  const value = import.meta.env[`VITE_ENABLE_${key.toUpperCase()}`];
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}
