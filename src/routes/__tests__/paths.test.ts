import { describe, expect, it, vi } from 'vitest';
import { CONNECTED_VIEWS, VIEW_PERMISSION, matchView, pathFor } from '../paths';

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
  // CONNECTED_VIEWS is computed at load time from VITE_REAL_UPLOADS (a developer's .env.local may set it), so pin it.
  const connectedWith = async (flag: string) => {
    vi.stubEnv('VITE_REAL_UPLOADS', flag);
    vi.resetModules();
    try { return [...(await import('../paths')).CONNECTED_VIEWS]; } finally { vi.unstubAllEnvs(); vi.resetModules(); }
  };
  it('only the screens wired to the real backend are marked connected', async () => {
    expect(await connectedWith('')).toEqual(['team']);
    expect(await connectedWith('true')).toEqual(['team', 'uploads', 'upload-review', 'column-mapping']);
    expect(CONNECTED_VIEWS.has('team')).toBe(true);
    expect(VIEW_PERMISSION.team).toBe('team.view');
  });
});
