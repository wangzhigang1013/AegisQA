import { afterEach, describe, expect, it } from 'vitest';

import { disabledFeatureReason, getFeatureFlags, isFeatureEnabled } from './features';

describe('frontend feature flags', () => {
  afterEach(() => {
    delete globalThis.__AEGISQA_FEATURE_OVERRIDES__;
  });

  it('defaults experimental features to disabled', () => {
    const flags = getFeatureFlags();

    expect(flags.ci_gate.enabled).toBe(false);
    expect(flags.ci_gate.reason).toBe(disabledFeatureReason);
  });

  it('allows explicit runtime override for tests and local debug without changing defaults', () => {
    globalThis.__AEGISQA_FEATURE_OVERRIDES__ = { ci_gate: true };

    expect(isFeatureEnabled('ci_gate')).toBe(true);
    expect(getFeatureFlags().ci_gate.reason).toBe('');
  });
});
