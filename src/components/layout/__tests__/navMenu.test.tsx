// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from '../../../App';
import { adminOpenKey, visibleNav } from '../navMenu';

/** The backend's role permissions (D:\Qorloop-backend packages/core/src/roles.ts), copied so the menu is checked against them. */
const PERMS = {
  owner: [
    'products.view', 'products.edit', 'products.activate', 'categories.manage', 'catalogue.stock_edit', 'marketplace.values_edit',
    'pricing.view', 'pricing.edit', 'pricing.bulk',
    'uploads.view', 'uploads.upload', 'uploads.apply', 'uploads.discard', 'uploads.map',
    'recon.view', 'reports.view', 'reports.export',
    'files.view', 'files.preview', 'files.generate', 'files.download',
    'settings.view', 'settings.edit', 'settings.security',
    'team.view', 'team.invite', 'team.manage_roles', 'team.remove',
    'marketplaces.edit', 'activity.view',
  ],
  catalogue_manager: [
    'products.view', 'products.edit', 'products.activate', 'categories.manage', 'catalogue.stock_edit', 'marketplace.values_edit',
    'pricing.view', 'pricing.edit', 'pricing.bulk',
    'uploads.view', 'uploads.upload', 'uploads.apply', 'uploads.discard', 'uploads.map',
    'recon.view', 'reports.view', 'reports.export',
    'files.view', 'files.preview', 'files.generate', 'files.download',
    'settings.view', 'team.view', 'activity.view',
  ],
  analyst: [
    'products.view', 'pricing.view', 'uploads.view', 'recon.view',
    'reports.view', 'reports.export', 'files.view', 'files.download',
    'settings.view', 'team.view', 'activity.view',
  ],
} as const;
type RoleName = keyof typeof PERMS;
const canFor = (r: RoleName) => (p: string) => (PERMS[r] as readonly string[]).includes(p);
const menu = (r: RoleName) => Object.fromEntries(visibleNav(canFor(r)).map(g => [g.title, g.items.map(i => i.label)]));

let role: RoleName = 'owner';
let userId = 'u1';
const auth = () => ({
  status: 'authenticated' as const, error: null, retry: vi.fn(), logout: vi.fn(async () => undefined),
  me: { role, user: { id: userId, name: 'Test User' }, tenant: { name: 'Test Store' } },
  can: canFor(role),
});
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => auth() }));

const Where = () => { const l = useLocation(); return <output data-testid="where">{l.pathname}</output>; };
let clients: QueryClient[] = [];
const mount = (path = '/') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  clients.push(qc);
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter></QueryClientProvider>);
};
const sidebar = () => within(document.querySelector('aside') as HTMLElement);
const adminToggle = () => sidebar().getByRole('button', { name: 'Admin' });

beforeEach(() => {
  role = 'owner';
  userId = 'u1';
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => { cleanup(); clients.forEach(q => q.clear()); clients = []; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('menu groups follow permissions', () => {
  beforeEach(() => vi.stubEnv('VITE_REAL_SETTINGS', 'true')); // Activity keeps its existing build-time condition

  it('an Owner (and an Admin, with the same menu permissions) sees every item', () => {
    expect(menu('owner')).toEqual({
      'Daily work': ['Dashboard', 'Uploads', 'Generated files', 'How it works'],
      Admin: ['Catalogue', 'Pricing', 'Reports', 'Activity', 'Templates', 'Team', 'Settings', 'Help & onboarding'],
    });
  });

  it('a Catalogue Manager does not see Team, Settings or Help & onboarding (no team.invite, no settings.edit)', () => {
    expect(menu('catalogue_manager')).toEqual({
      'Daily work': ['Dashboard', 'Uploads', 'Generated files', 'How it works'],
      Admin: ['Catalogue', 'Pricing', 'Reports', 'Activity', 'Templates'],
    });
  });

  it('a role that only reads (Analyst) sees Dashboard, Reports and Activity, plus the How it works guide', () => {
    expect(menu('analyst')).toEqual({
      'Daily work': ['Dashboard', 'How it works'],
      Admin: ['Reports', 'Activity'],
    });
  });

  it('the decision is made from permissions, not the role name', () => {
    const only = new Set(['uploads.view', 'uploads.upload']);
    expect(Object.fromEntries(visibleNav(p => only.has(p)).map(g => [g.title, g.items.map(i => i.label)]))).toEqual({
      'Daily work': ['Dashboard', 'Uploads', 'How it works'],
    });
  });

  it('a group with nothing to show is left out', () => {
    expect(visibleNav(() => false).map(g => g.title)).toEqual(['Daily work']);
  });

  it('an item hidden from the menu still opens by direct link (the screen guards are unchanged)', async () => {
    role = 'analyst';
    mount('/uploads');
    expect(sidebar().queryByRole('button', { name: 'Uploads' })).toBeNull();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/uploads'));
    expect(screen.queryByText(/do not have access/i)).toBeNull();
  });
});

describe('Admin group: collapsed by default, remembered per user', () => {
  it('starts collapsed and opens on click', () => {
    mount('/');
    expect(adminToggle().getAttribute('aria-expanded')).toBe('false');
    expect(sidebar().queryByRole('button', { name: 'Catalogue' })).toBeNull();
    fireEvent.click(adminToggle());
    expect(adminToggle().getAttribute('aria-expanded')).toBe('true');
    expect(sidebar().getByRole('button', { name: 'Catalogue' })).toBeTruthy();
    expect(window.localStorage.getItem(adminOpenKey('u1'))).toBe('1');
  });

  it('keeps the choice for the same user after a reload, and not for another user', () => {
    mount('/');
    fireEvent.click(adminToggle());
    cleanup();
    mount('/');
    expect(adminToggle().getAttribute('aria-expanded')).toBe('true');
    cleanup();
    userId = 'u2';
    mount('/');
    expect(adminToggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('closing it is remembered too', () => {
    window.localStorage.setItem(adminOpenKey('u1'), '1');
    mount('/');
    fireEvent.click(adminToggle());
    expect(window.localStorage.getItem(adminOpenKey('u1'))).toBe('0');
  });

  it('works when the browser blocks storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    mount('/');
    expect(adminToggle().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(adminToggle());
    expect(adminToggle().getAttribute('aria-expanded')).toBe('true');
  });
});

describe('the active item', () => {
  it('is highlighted, and its collapsed group opens by itself', () => {
    window.localStorage.setItem(adminOpenKey('u1'), '0');
    mount('/pricing');
    expect(adminToggle().getAttribute('aria-expanded')).toBe('true');
    expect(sidebar().getByRole('button', { name: 'Pricing' }).getAttribute('aria-current')).toBe('page');
  });

  it('stays marked on the group header when the user collapses the group', () => {
    mount('/catalogue/new');
    expect(sidebar().getByRole('button', { name: 'Catalogue' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(adminToggle());
    expect(adminToggle().getAttribute('aria-expanded')).toBe('false');
    expect(adminToggle().getAttribute('data-has-active')).toBe('true');
  });

  it('a Daily work item is highlighted and Admin stays as the user left it', () => {
    mount('/files');
    expect(sidebar().getByRole('button', { name: 'Generated files' }).getAttribute('aria-current')).toBe('page');
    expect(adminToggle().getAttribute('aria-expanded')).toBe('false');
    expect(adminToggle().getAttribute('data-has-active')).toBeNull();
  });

  it('the Pricing screen is called Pricing in the menu and the breadcrumb, never "Marketplace price"', () => {
    mount('/pricing');
    expect(within(screen.getByRole('banner')).getByText('Pricing')).toBeTruthy();
    expect(within(screen.getByRole('banner')).getByText('Admin')).toBeTruthy();
    expect(screen.queryByText(/Marketplace price/)).toBeNull();
  });

  it('report tabs keep Reports highlighted', () => {
    mount('/reports/price');
    expect(sidebar().getByRole('button', { name: 'Reports' }).getAttribute('aria-current')).toBe('page');
  });
});
