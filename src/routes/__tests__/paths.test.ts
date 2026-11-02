import { describe, expect, it, vi } from 'vitest';
import { CONNECTED_VIEWS, VIEW_PERMISSION, matchView, pathFor } from '../paths';
import { REAL_FLAGS } from '../../../vitest.setup';

/** Every VITE_REAL_* flag off except the ones given, so a flag set in .env.local never leaks into the import. */
const onlyFlags = (on: Partial<Record<(typeof REAL_FLAGS)[number], string>>) => {
  for (const flag of REAL_FLAGS) vi.stubEnv(flag, on[flag] ?? '');
};

describe('real URLs for every screen', () => {
  it('round-trips static and parameterised paths', () => {
    expect(matchView(pathFor('dashboard'))).toEqual({ view: 'dashboard' });
    expect(matchView(pathFor('team'))).toEqual({ view: 'team' });
    expect(matchView(pathFor('product-detail', 'a b/1'))).toEqual({ view: 'product-detail', id: 'a b/1' });
    expect(matchView('/catalogue/new')).toEqual({ view: 'new-products' }); // not a product with id "new"
    expect(matchView('/settings/team/')).toEqual({ view: 'team' });
  });
  it('returns null for unknown paths so the shell shows 404', () => {
    expect(matchView('/nope')).toBeNull();
    expect(matchView('/signup')).toBeNull();
  });
  // CONNECTED_VIEWS is computed at load time from the VITE_REAL_* flags (a developer's .env.local may set any), so pin them all.
  const connectedWith = async (flag: string) => {
    onlyFlags({ VITE_REAL_UPLOADS: flag });
    vi.resetModules();
    try { return [...(await import('../paths')).CONNECTED_VIEWS]; } finally { vi.unstubAllEnvs(); vi.resetModules(); }
  };
  it('only the screens wired to the real backend are marked connected', async () => {
    expect(await connectedWith('')).toEqual(['team']);
    expect(await connectedWith('true')).toEqual(['team', 'uploads', 'upload-review', 'column-mapping']);
    expect(CONNECTED_VIEWS.has('team')).toBe(true);
    expect(VIEW_PERMISSION.team).toBe('team.view');
  });
  it('VITE_REAL_RECON marks the dashboard and the stock and price reports connected', async () => {
    const connected = async (recon: string) => {
      onlyFlags({ VITE_REAL_RECON: recon });
      vi.resetModules();
      try { return [...(await import('../paths')).CONNECTED_VIEWS]; } finally { vi.unstubAllEnvs(); vi.resetModules(); }
    };
    expect(await connected('')).toEqual(['team']);
    expect(await connected('true')).toEqual(['team', 'dashboard', 'reports', 'reports-stock', 'reports-price-discrepancies']);
  });
  it('VITE_REAL_PRICING marks the Marketplace Price screen connected', async () => {
    onlyFlags({ VITE_REAL_PRICING: 'true' });
    vi.resetModules();
    try {
      expect([...(await import('../paths')).CONNECTED_VIEWS]).toEqual(['team', 'markups']);
    } finally { vi.unstubAllEnvs(); vi.resetModules(); }
  });
  it('VITE_REAL_FILES marks the Generate files screen connected', async () => {
    onlyFlags({ VITE_REAL_FILES: 'true' });
    vi.resetModules();
    try {
      expect([...(await import('../paths')).CONNECTED_VIEWS]).toEqual(['team', 'outputs-generate']);
    } finally { vi.unstubAllEnvs(); vi.resetModules(); }
  });
});
