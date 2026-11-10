// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from '../../../App';
import type { Role } from '../../../api/types';
import { ROLES, ROLE_LABELS } from '../../../api/types';
import { HOW_IT_WORKS as C } from '../../../content/howItWorks';
import { REAL_FLAGS } from '../../../../vitest.setup';
import { STATIC_CONTENT_VIEWS, VIEW_PERMISSION, matchView, pathFor } from '../../../routes/paths';

// The analyst has the fewest permissions; the page must work for every signed-in role, so tests default to it.
let role: Role = 'analyst';
let perms = new Set<string>();
const auth = () => ({
  status: 'authenticated' as const, error: null, retry: vi.fn(), logout: vi.fn(async () => undefined),
  me: { role, user: { id: 'u1', name: 'Test User' }, tenant: { name: 'Test Store' } },
  can: (p: string) => perms.has(p),
});
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => auth() }));

const Where = () => { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search + l.hash}</output>; };
let clients: QueryClient[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
const mount = (path = '/how-it-works') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  clients.push(qc);
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter></QueryClientProvider>);
};
const where = () => screen.getByTestId('where').textContent;
const main = () => within(document.querySelector('main') as HTMLElement);
const sidebar = () => within(document.querySelector('aside') as HTMLElement);
const sections = Object.values(C.sections);

beforeEach(() => {
  role = 'analyst';
  perms = new Set(['products.view', 'pricing.view', 'uploads.view', 'recon.view', 'reports.view', 'reports.export', 'files.view', 'files.download', 'settings.view', 'team.view', 'activity.view']);
  fetchMock = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); clients.forEach(q => q.clear()); clients = []; vi.unstubAllGlobals(); });

describe('How it works page', () => {
  it('runs with every VITE_REAL_* flag off', () => {
    for (const flag of REAL_FLAGS) expect(import.meta.env[flag]).toBe('');
  });

  it('has its own route, open to every role, with no sample-data note and no request to the server', () => {
    expect(pathFor('how-it-works')).toBe('/how-it-works');
    expect(matchView('/how-it-works')).toEqual({ view: 'how-it-works' });
    expect(matchView('/how-it-works/')).toEqual({ view: 'how-it-works' });
    expect(VIEW_PERMISSION['how-it-works']).toBeUndefined();
    expect(STATIC_CONTENT_VIEWS.has('how-it-works')).toBe(true);

    mount();
    expect(main().getByRole('heading', { level: 1, name: 'How it works' })).toBeTruthy();
    expect(screen.queryByText('Page not found')).toBeNull();
    expect(screen.queryByText(/Sample data\./)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders every section, in order, with a Jump to link for each', () => {
    mount();
    const headings = main().getAllByRole('heading', { level: 2 }).map(h => h.textContent);
    expect(headings).toEqual(['Jump to', ...sections.map(s => s.title)]);
    for (const s of sections) {
      const region = main().getByRole('region', { name: s.title });
      expect(region.id).toBe(s.id);
    }
    const nav = within(main().getByRole('navigation', { name: 'Jump to' }));
    const links = nav.getAllByRole('link');
    expect(links.map(a => a.getAttribute('href'))).toEqual(sections.map(s => `#${s.id}`));
    for (const a of links) expect(document.getElementById(a.getAttribute('href')!.slice(1))).not.toBeNull();
  });

  it('shows the content of each section', () => {
    mount();
    const region = (id: keyof typeof C.sections) => within(main().getByRole('region', { name: C.sections[id].title }));
    for (const p of C.what) expect(region('what').getByText(p)).toBeTruthy();
    for (const t of C.sources) expect(region('sources').getByText(t.meaning)).toBeTruthy();
    for (const t of [...C.words, ...C.compare]) expect(region('words').getByText(t.term)).toBeTruthy();
    expect(region('words').getByText(C.compareWarning)).toBeTruthy();
    expect(within(region('words').getByText('Available but out of stock').closest('dt') as HTMLElement).getByText('Urgent')).toBeTruthy();
    for (const t of [...C.can, ...C.cannot]) expect(region('limits').getByText(t)).toBeTruthy();
    for (const t of C.tips) expect(region('tips').getByText(t)).toBeTruthy();
    expect(region('glossary').getAllByRole('term').map(t => t.textContent)).toEqual(['ERP', 'Marketplace', 'Catalogue', 'Listing', 'Mismatch', 'Rule chain', 'Mapping', 'Store']);
  });

  it('shows the daily loop as six numbered cards, each with a button to a real screen', async () => {
    mount();
    const loop = within(main().getByRole('list', { name: 'The daily loop' }));
    const cards = loop.getAllByTestId('loop-step');
    expect(cards).toHaveLength(6);
    expect(cards.map(c => within(c).getByRole('heading', { level: 3 }).textContent)).toEqual(C.loop.map(s => s.title));
    const expected: [string, string][] = [
      ['Open Uploads', '/uploads'], ['Open Uploads', '/uploads'], ['Open Uploads', '/uploads'],
      ['Open Dashboard', '/'], ['Open Catalogue', '/catalogue'], ['Open Generated files', '/files'],
    ];
    cards.forEach((c, i) => {
      const link = within(c).getByRole('link');
      const href = link.getAttribute('href')!;
      expect([link.textContent?.trim(), href]).toEqual(expected[i]);
      // Every target is a route the app knows, and the view it opens is the one the content names.
      expect(matchView(href)).toEqual({ view: C.loop[i].action.view });
    });

    fireEvent.click(within(cards[4]).getByRole('link', { name: /Open Catalogue/ }));
    await waitFor(() => expect(where()).toBe('/catalogue'));
    expect(screen.queryByText('Page not found')).toBeNull();
  });

  it('every action in the content names a view with a real route', () => {
    for (const step of C.loop) expect(matchView(pathFor(step.action.view))).not.toBeNull();
  });

  it('lists the common situations as an accordion that opens from the keyboard', () => {
    mount();
    const region = main().getByRole('region', { name: 'Common situations' });
    const items = region.querySelectorAll('details');
    expect(items).toHaveLength(C.situations.length);
    const summaries = [...items].map(d => d.querySelector('summary')!.textContent);
    expect(summaries).toEqual(C.situations.map(s => s.title));
    const first = items[0];
    expect(first.open).toBe(false);
    fireEvent.click(first.querySelector('summary')!);
    expect(first.open).toBe(true);
    expect(within(first).getAllByRole('listitem').map(li => li.textContent)).toEqual(C.situations[0].steps);
    expect(within(region).getByText(/Use ERP to follow the ERP again, or Keep mine/)).toBeTruthy();
    expect(within(region).getByText(/Download errors \(\.xlsx\)/)).toBeTruthy();
  });

  it('shows the roles table from the backend permissions', () => {
    mount();
    const table = within(main().getByRole('table', { name: 'Who can do what' }));
    expect(table.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['What you can do', ...ROLES.map(r => ROLE_LABELS[r])]);
    expect(table.getAllByRole('columnheader').slice(1).map(h => h.textContent)).toEqual(['Owner', 'Admin', 'Catalogue Manager', 'Analyst']);
    const rows = table.getAllByTestId('role-row');
    expect(rows).toHaveLength(C.roles.length);
    const cells = (label: string) => within(table.getByRole('rowheader', { name: label }).closest('tr') as HTMLElement).getAllByRole('cell').map(c => c.textContent);
    expect(cells('Change security settings')).toEqual(['Yes', 'No', 'No', 'No']);
    expect(cells('Invite team members, change roles and remove members')).toEqual(['Yes', 'Yes', 'No', 'No']);
    expect(cells('Edit stock and prices, one by one or many at once')).toEqual(['Yes', 'Yes', 'Yes', 'No']);
    expect(cells('Export reports')).toEqual(['Yes', 'Yes', 'Yes', 'If allowed in Settings']);
    expect(cells('See who changed what in Activity')).toEqual(['Yes', 'Yes', 'Yes', 'Yes']);
  });

  it.each(['owner', 'admin', 'catalogue_manager', 'analyst'] as Role[])('the sidebar item opens the page for the %s role', async (r) => {
    role = r;
    if (r !== 'analyst') perms = new Set(['settings.view']);
    mount('/');
    const item = sidebar().getByRole('button', { name: 'How it works' });
    fireEvent.click(item);
    await waitFor(() => expect(where()).toBe('/how-it-works'));
    expect(main().getByRole('heading', { level: 1, name: 'How it works' })).toBeTruthy();
    expect(screen.queryByText(/do not have access|No access/i)).toBeNull();
  });

  it('keeps the Help & onboarding item next to it', () => {
    mount();
    const labels = sidebar().getAllByRole('button').map(b => b.textContent?.trim());
    const i = labels.indexOf('How it works');
    expect(i).toBeGreaterThan(-1);
    expect(labels[i + 1]).toBe('Help & onboarding');
  });
});
