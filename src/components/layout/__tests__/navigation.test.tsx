// @vitest-environment jsdom
import React from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from '../../../App';
import { AppProvider } from '../../../context/AppContext';
import { DemoProvider } from '../../../demo';
import { CategoryDetailView } from '../../views/CategoryDetailView';
import { RETIRED_PATHS, matchView } from '../../../routes/paths';

const auth = {
  status: 'authenticated' as const,
  error: null,
  retry: vi.fn(),
  logout: vi.fn(async () => undefined),
  me: { role: 'owner' as const, user: { id: 'u1', name: 'Store Owner' }, tenant: { name: 'Test Store' } },
  can: () => true,
};
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => auth }));

const Where = () => {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
};
let clients: QueryClient[] = [];
const mount = (path: string, ui: React.ReactNode = <App />) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  clients.push(qc);
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>{ui}<Where /></MemoryRouter></QueryClientProvider>);
};
const where = () => screen.getByTestId('where').textContent;
const sidebar = () => within(document.querySelector('aside') as HTMLElement);
const navLabels = () => sidebar().getAllByRole('button').map((b) => b.textContent?.trim() ?? '').filter(Boolean);

beforeEach(() => {
  // Screens wired to the backend (Team) stay loading; no request may reach a real server.
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => {
  cleanup();
  clients.forEach((q) => q.clear());
  clients = [];
  vi.unstubAllGlobals();
});

// Every sidebar item and the URL it opens, with all VITE_REAL_* flags off (vitest.setup.ts).
const NAV: [string, string][] = [
  ['Dashboard', '/'],
  ['Uploads', '/uploads'],
  ['Reports', '/reports/stock'],
  ['Catalogue', '/catalogue'],
  ['Marketplace price', '/pricing'],
  ['Generated files', '/files'],
  ['Templates', '/settings/file-mappings'],
  ['Team', '/settings/team'],
  ['Settings', '/settings'],
  ['Help & onboarding', '/onboarding'],
];

describe('Category mapping is removed from the navigation', () => {
  it('the sidebar has no Category mapping item and keeps every other screen', () => {
    mount('/');
    expect(navLabels()).toEqual(NAV.map(([label]) => label));
    expect(sidebar().queryByText(/category mapping/i)).toBeNull();
    expect(screen.queryByText(/category mapping/i)).toBeNull();
  });

  it.each(NAV)('the %s item still opens %s', async (label, path) => {
    mount(path === '/' ? '/catalogue' : '/');
    fireEvent.click(sidebar().getByRole('button', { name: label }));
    await waitFor(() => expect(where()).toBe(path));
    expect(screen.queryByText('Page not found')).toBeNull();
    expect(screen.queryByText(/category mapping/i)).toBeNull();
  });

  it.each(['/settings/category-mapping', '/settings/category-mapping/', '/Settings/Category-Mapping', '/settings/category-mapping?from=bookmark'])(
    'a direct visit to the old URL %s goes to the Dashboard',
    async (path) => {
      mount(path);
      await waitFor(() => expect(where()).toBe('/'));
      expect(screen.queryByText('Page not found')).toBeNull();
      expect(within(screen.getByRole('banner')).getByText('Dashboard')).toBeTruthy();
      expect(screen.queryByText(/category mapping/i)).toBeNull();
    },
  );

  it('the old URL is no longer a screen of its own', () => {
    expect(RETIRED_PATHS).toEqual(['/settings/category-mapping']);
    expect(matchView('/settings/category-mapping')).toBeNull();
  });

  it('Category detail no longer links to the mapping page from its Marketplaces card', () => {
    mount('/categories/c003', <DemoProvider><AppProvider><CategoryDetailView /></AppProvider></DemoProvider>);
    const heading = screen.getByRole('heading', { name: 'Marketplaces (3)' });
    expect(within(heading.parentElement as HTMLElement).queryByRole('button', { name: 'Manage' })).toBeNull();
  });

  it('no source file links to the removed screen', () => {
    const src = new URL('../../../', import.meta.url);
    const offenders = (readdirSync(src, { recursive: true }) as string[])
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__/') && f !== 'routes/paths.ts')
      .filter((f) => /category-mapping|CategoryMappingView|'Category mapping'/.test(readFileSync(new URL(f, src), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
