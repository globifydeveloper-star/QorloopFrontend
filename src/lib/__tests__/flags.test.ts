import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { REAL_FLAGS } from '../../../vitest.setup';
import { realCatalogueEnabled, realFilesEnabled, realPricingEnabled, realReconEnabled, realUploadsEnabled } from '../features';

describe('feature flags in tests', () => {
  it('the global setup switches off every VITE_REAL_* flag that src/lib/features.ts reads', () => {
    const source = readFileSync(new URL('../features.ts', import.meta.url), 'utf8');
    const used = [...new Set(source.match(/VITE_REAL_[A-Z_]+/g) ?? [])].sort();
    expect(used.length).toBeGreaterThan(0);
    expect([...REAL_FLAGS].sort()).toEqual(used);
  });

  it('every flag is off by default, whatever .env.local says, and a test can turn one on', () => {
    for (const flag of REAL_FLAGS) expect(import.meta.env[flag]).toBe('');
    expect([realUploadsEnabled(), realCatalogueEnabled(), realReconEnabled(), realPricingEnabled(), realFilesEnabled()]).toEqual([false, false, false, false, false]);
    vi.stubEnv('VITE_REAL_PRICING', 'true');
    expect(realPricingEnabled()).toBe(true);
  });

  it('the next test starts with the flag off again', () => {
    expect(realPricingEnabled()).toBe(false);
  });
});
