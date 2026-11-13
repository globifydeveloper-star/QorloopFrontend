// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ProductDetail, ProductItem, TabCounts } from '../../../api/products';
import type { CategoryNode } from '../../../api/categories';
import { qatarDateTime } from '../../../lib/format';

const perms = new Set<string>();
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ can: (p: string) => perms.has(p) }) }));
const app = { showToast: vi.fn(), openUploadModal: vi.fn(), navigate: vi.fn() };
vi.mock('../../../context/AppContext', () => ({ useApp: () => app }));
let demoUsed = false;
vi.mock('../../../demo', async orig => {
  const real = await orig<typeof import('../../../demo')>();
  // Real mode must never read the local demo store; the flag-off test below uses it on purpose.
  return { ...real, useDemo: () => { demoUsed = true; return real.useDemo(); } };
});

import { CatalogueView } from '../../views/CatalogueView';
import { ProductDetailView } from '../../views/ProductDetailView';
import { NewProductsView } from '../../views/NewProductsView';
import { CategoriesView } from '../../views/CategoriesView';
import { CategoryDetailView } from '../../views/CategoryDetailView';
import { DemoProvider } from '../../../demo';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json(200, { data });
const fail = (status: number, message: string, details?: unknown[]) => json(status, { error: { code: 'E', message, details } });

const UPDATED = '2026-10-30T08:00:00.000Z';
const prod = (id: string, over: Partial<ProductItem> = {}): ProductItem => ({
  id, barcode: `6281000${id}`, sku: null, nameEn: `Product ${id}`, nameAr: null, brand: null, erpCategory: null,
  categoryId: null, subcategoryId: null, erpPrice: 12.5, erpStock: 7, status: 'active', inLatestErpFile: true, updatedAt: UPDATED, ...over,
});
const counts = (over: Partial<TabCounts> = {}): TabCounts => ({ all: 3, active: 2, inactive: 0, new: 1, missing: 0, ...over });
const TREE: CategoryNode[] = [
  { id: 'cat_dairy', parentId: null, nameEn: 'Dairy', nameAr: 'ألبان', sort: 0, productCount: 4, children: [
    { id: 'sub_milk', parentId: 'cat_dairy', nameEn: 'Milk', nameAr: null, sort: 0, productCount: 2 },
  ] },
  { id: 'cat_snacks', parentId: null, nameEn: 'Snacks', nameAr: null, sort: 1, productCount: 0, children: [] },
];

type Handler = (url: string, init: RequestInit) => Response | Promise<Response | undefined> | undefined;
let handler: Handler;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (pred: (url: string, method: string) => boolean) =>
  fetchMock.mock.calls.filter(([u, i]) => pred(String(u), (i as RequestInit | undefined)?.method ?? 'GET'));
const bodyOf = (c: unknown[]) => JSON.parse(String((c[1] as RequestInit).body));
const params = (u: string) => Object.fromEntries(new URL(u, 'http://x').searchParams);
const isList = (u: string, m: string) => m === 'GET' && u.startsWith('/api/products?');

const Where = () => {
  const l = useLocation();
  return <><output data-testid="where">{l.pathname}</output><output data-testid="search">{l.search}</output></>;
};
function renderAt(path: string, ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="*" element={<>{ui}<Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_REAL_CATALOGUE', 'true');
  perms.clear();
  ['products.view', 'products.edit', 'products.activate', 'categories.manage'].forEach(p => perms.add(p));
  app.showToast.mockClear();
  demoUsed = false;
  handler = () => undefined;
  fetchMock = vi.fn(async (u: string, i: RequestInit = {}) => {
    const url = String(u);
    const r = await handler(url, i);
    if (r) return r;
    if (url === '/api/categories' && (i.method ?? 'GET') === 'GET') return ok(TREE);
    // The product detail's Stock section (ADR 017): the catalogue stock follows the ERP unless a test says otherwise.
    const stock = /^\/api\/products\/([^/?]+)\/stock$/.exec(url);
    if (stock && (i.method ?? 'GET') === 'GET') return ok({ productId: decodeURIComponent(stock[1]), erpStock: 7, catalogueStock: 7, source: 'erp', conflict: null, edit: null });
    return fail(404, 'not mocked');
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('catalogue (CAT-001)', () => {
  it('shows a skeleton, then rows with barcode, names, ERP price/stock, status in words and category', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    handler = async (u, i) => {
      if (!isList(u, i.method ?? 'GET')) return undefined;
      await gate;
      return ok({ items: [prod('1', { nameAr: 'حليب', categoryId: 'cat_dairy', subcategoryId: 'sub_milk' }), prod('2', { status: 'inactive', inLatestErpFile: false })], nextCursor: null, counts: counts() });
    };
    renderAt('/catalogue', <CatalogueView />);
    expect(screen.getByRole('status', { name: 'Loading products…' })).toBeTruthy();
    release();

    const row = (await screen.findByText('Product 1')).closest('tr')!;
    const r = within(row);
    expect(r.getByText('62810001')).toBeTruthy();
    expect(r.getByText('حليب')).toBeTruthy();
    expect(r.getByText('QAR 12.50')).toBeTruthy();
    expect(r.getByText('7')).toBeTruthy();
    expect(r.getByTestId('status-pill').textContent).toBe('Active');
    expect(r.getByTestId('status-pill').querySelector('svg')).toBeTruthy();
    expect(row.textContent).toContain('Dairy › Milk');
    const row2 = within(screen.getByText('Product 2').closest('tr')!);
    expect(row2.getByTestId('status-pill').textContent).toBe('Inactive');
    expect(row2.getByText('Not in latest ERP file')).toBeTruthy();
    expect(row2.getByText('No category')).toBeTruthy();
    expect(row2.getByText('No Arabic name')).toBeTruthy();
    expect(r.getByRole('link', { name: 'Product 1' }).getAttribute('href')).toBe('/catalogue/1');

    expect(within(screen.getByRole('tablist', { name: 'Product status' })).getAllByRole('tab').map(t => t.textContent)).toEqual(
      ['All (3)', 'Active (2)', 'Inactive (0)', 'New (1)', 'Missing from ERP (0)']);
  });

  it('switches tabs, debounces search, filters by category or subcategory and loads more by cursor', async () => {
    handler = (u, i) => {
      if (!isList(u, i.method ?? 'GET')) return undefined;
      const p = params(u);
      return p.cursor === 'c2'
        ? ok({ items: [prod('9')], nextCursor: null, counts: counts() })
        : ok({ items: [prod('1')], nextCursor: 'c2', counts: counts() });
    };
    renderAt('/catalogue', <CatalogueView />);
    await screen.findByText('Product 1');
    expect(params(calls(isList)[0][0] as string)).toEqual({ tab: 'all', limit: '50' });

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Product 9');
    expect(params(calls(isList).at(-1)![0] as string)).toMatchObject({ cursor: 'c2', tab: 'all' });
    expect(screen.getByText('Product 1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /New/ }));
    await waitFor(() => expect(params(calls(isList).at(-1)![0] as string)).toMatchObject({ tab: 'new' }));

    const search = screen.getByRole('searchbox', { name: 'Search products' });
    fireEvent.change(search, { target: { value: 'mi' } });
    fireEvent.change(search, { target: { value: 'milk' } });
    await waitFor(() => expect(params(calls(isList).at(-1)![0] as string)).toMatchObject({ q: 'milk', tab: 'new' }));
    expect(calls(isList).some(c => params(c[0] as string).q === 'mi')).toBe(false);

    await screen.findByRole('option', { name: 'Dairy' });
    const select = screen.getByRole('combobox', { name: 'Category' });
    fireEvent.change(select, { target: { value: 'c:cat_dairy' } });
    await waitFor(() => expect(params(calls(isList).at(-1)![0] as string)).toMatchObject({ categoryId: 'cat_dairy' }));
    fireEvent.change(select, { target: { value: 's:sub_milk' } });
    await waitFor(() => expect(params(calls(isList).at(-1)![0] as string)).toMatchObject({ subcategoryId: 'sub_milk' }));
    expect(params(calls(isList).at(-1)![0] as string).categoryId).toBeUndefined();
  });

  it('shows an empty state, and an error state whose retry loads again', async () => {
    let failing = true;
    handler = (u, i) => {
      if (!isList(u, i.method ?? 'GET')) return undefined;
      return failing ? fail(500, 'Database unavailable') : ok({ items: [], nextCursor: null, counts: counts({ all: 0 }) });
    };
    renderAt('/catalogue', <CatalogueView />);
    expect(await screen.findByText('We could not load the catalogue')).toBeTruthy();
    expect(screen.getByText(/contact support/)).toBeTruthy();
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByText('No products yet')).toBeTruthy();
  });

  it('never touches the demo store in real mode, and keeps the demo screen when the flag is off', async () => {
    handler = (u, i) => (isList(u, i.method ?? 'GET') ? ok({ items: [], nextCursor: null, counts: counts() }) : undefined);
    renderAt('/catalogue', <CatalogueView />);
    await screen.findByText('No products yet');
    expect(demoUsed).toBe(false);
    cleanup();

    vi.stubEnv('VITE_REAL_CATALOGUE', '');
    fetchMock.mockClear();
    renderAt('/catalogue/new', <DemoProvider><NewProductsView /></DemoProvider>);
    expect(screen.getByRole('heading', { name: 'New Products' })).toBeTruthy();
    expect(demoUsed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('catalogue: "Compare with" one or two marketplaces (GET /api/products?marketplaceId=&compareMarketplaceId=)', () => {
  const FILE = '2026-11-08T10:00:00.000Z';
  const OLDER = '2026-11-01T10:00:00.000Z';
  const COMPUTED = '2026-11-08T10:05:00.000Z';
  const mp = (over: Record<string, unknown> = {}) => ({
    marketplaceId: 'talabat', reference: 'marketplace', available: true, price: '4.000', inFile: true, comparison: 'in_sync',
    stockIssue: null, priceIssue: null, sourceUploadedAt: FILE, ...over,
  });
  const notInFile = (id = 'talabat') => mp({ marketplaceId: id, inFile: false, available: null, price: null, comparison: 'not_in_file', sourceUploadedAt: null });
  const withMp = (id: string, m: unknown, c?: unknown) => prod(id, { marketplace: m, ...(c ? { compareMarketplace: c } : {}) } as Partial<ProductItem>);
  const enabledList = (over: { marketplaceId: string; hasData: boolean; lastUploadAt?: string | null }[]) =>
    ok({ items: over.map(m => ({ enabled: true, ageHours: 1, lastUploadAt: m.hasData ? FILE : null, ...m })) });
  const SETTINGS = [
    { marketplaceId: 'talabat', hasData: true }, { marketplaceId: 'snoonu', hasData: true }, { marketplaceId: 'keeta', hasData: false },
  ];
  const BASE_HEADERS = ['Barcode', 'Name', 'ERP price', 'ERP stock', 'Catalogue stock', 'Status', 'Category'];
  const lastList = () => params(calls(isList).at(-1)![0] as string);
  const compareGroup = () => screen.queryByRole('group', { name: 'Compare with' });
  const toggleOf = (name: string) => within(compareGroup()!).getByRole('button', { name }) as HTMLButtonElement;
  const toggleNames = () => within(compareGroup()!).getAllByRole('button').map(t => t.textContent);
  const pressed = () => within(compareGroup()!).getAllByRole('button').filter(t => t.getAttribute('aria-pressed') === 'true').map(t => t.textContent);
  const mismatches = () => screen.getByRole('checkbox', { name: 'Only mismatches' }) as HTMLInputElement;
  const differBox = () => screen.getByRole('checkbox', { name: 'Only where Talabat and Snoonu differ' }) as HTMLInputElement;
  const headers = () => screen.getAllByRole('columnheader').map(h => h.textContent);
  const search = () => screen.getByTestId('search').textContent;

  /** Settings list the enabled marketplaces (settings.view); `list` answers GET /api/products. */
  function serve(list: (p: Record<string, string>) => Response | undefined, enabled = SETTINGS) {
    vi.stubEnv('VITE_REAL_SETTINGS', 'true');
    perms.add('settings.view');
    handler = (u, i) => {
      if (u === '/api/settings/marketplaces') return enabledList(enabled);
      return isList(u, i.method ?? 'GET') ? list(params(u)) : undefined;
    };
  }
  const threeProducts = (p: Record<string, string>) => ok({ items: p.marketplaceId === 'talabat'
    ? [
      withMp('1', mp({ comparison: 'mismatch', stockIssue: 'available_but_out_of_stock', priceIssue: 'marketplace_price_lower', laterField: { x: 1 } })),
      withMp('2', notInFile()),
      withMp('3', mp({ available: false, sourceUploadedAt: OLDER })),
    ]
    : p.marketplaceId ? [withMp('1', mp({ marketplaceId: p.marketplaceId }))] : [prod('1'), prod('2'), prod('3')],
  nextCursor: null, counts: counts() });
  /** Talabat and Snoonu side by side: 1 price differs, 2 is only on Talabat, 3 is the same on both. */
  const twoMarketplaces = (p: Record<string, string>) => ok({
    items: !p.marketplaceId ? [prod('1'), prod('2'), prod('3')]
      : !p.compareMarketplaceId ? [withMp('1', mp()), withMp('2', mp()), withMp('3', mp())]
        : [
          withMp('1', mp(), mp({ marketplaceId: 'snoonu', price: '3.750' })),
          withMp('2', mp(), notInFile('snoonu')),
          withMp('3', mp({ available: false }), mp({ marketplaceId: 'snoonu', available: false, price: '4' })),
        ].filter(i => !p.marketplacesDiffer || i.id !== '3'),
    nextCursor: null, counts: counts(),
  });

  it('default unchanged: with every real flag off there is no "Compare with" and the list is asked and drawn as before', async () => {
    handler = (u, i) => (isList(u, i.method ?? 'GET') ? ok({ items: [prod('1')], nextCursor: null, counts: counts() }) : undefined);
    renderAt('/catalogue?marketplace=talabat', <CatalogueView />);
    await screen.findByText('Product 1');
    expect(compareGroup()).toBeNull();
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(calls(isList).every(([u]) => params(String(u)).marketplaceId === undefined)).toBe(true);
    expect(headers()).toEqual(BASE_HEADERS);
    expect(screen.queryByTestId('marketplace-note')).toBeNull();
    expect(calls(u => u.startsWith('/api/settings') || u.startsWith('/api/recon'))).toHaveLength(0);
  });

  it('shows no "Compare with" when no enabled marketplace has a file', async () => {
    serve(() => ok({ items: [prod('1')], nextCursor: null, counts: counts() }), [{ marketplaceId: 'keeta', hasData: false }]);
    renderAt('/catalogue', <CatalogueView />);
    await screen.findByText('Product 1');
    await waitFor(() => expect(calls(u => u === '/api/settings/marketplaces')).toHaveLength(1));
    expect(compareGroup()).toBeNull();
  });

  it('offers one toggle per enabled marketplace with a file; none is pressed and the catalogue is unchanged', async () => {
    serve(threeProducts);
    renderAt('/catalogue', <CatalogueView />);
    await screen.findByText('Product 1');
    await waitFor(() => expect(compareGroup()).not.toBeNull());
    expect(toggleNames()).toEqual(['Talabat', 'Snoonu']);
    expect(pressed()).toEqual([]);
    expect(screen.getByTestId('compare-hint').textContent).toBe('Choose a marketplace to see its values next to your catalogue.');
    expect(headers()).toEqual(BASE_HEADERS);
    expect(calls(isList).every(([u]) => params(String(u)).marketplaceId === undefined)).toBe(true);
    expect(screen.queryByRole('checkbox', { name: 'Only mismatches' })).toBeNull();
    expect(search()).toBe('');
    // The status tabs and their counts stay.
    expect(screen.getByRole('tab', { name: 'All (3)' })).toBeTruthy();
  });

  it('one marketplace adds its availability, price and Compared badges next to the catalogue values, read-only', async () => {
    serve(threeProducts);
    renderAt('/catalogue', <CatalogueView />);
    await screen.findByText('Product 1');
    await waitFor(() => expect(compareGroup()).not.toBeNull());
    fireEvent.click(toggleOf('Talabat'));
    await screen.findByRole('columnheader', { name: 'Availability on Talabat' });
    expect(pressed()).toEqual(['Talabat']);
    expect(toggleOf('Talabat').getAttribute('aria-pressed')).toBe('true');
    expect(lastList()).toMatchObject({ marketplaceId: 'talabat' });
    expect(lastList().marketplaceStatus).toBeUndefined();
    expect(lastList().compareMarketplaceId).toBeUndefined();
    expect(search()).toBe('?marketplace=talabat');
    expect(screen.getByTestId('compare-hint').textContent).toBe('Read-only. Choose a second marketplace to see both side by side.');
    // The existing columns stay, with their names; the status tab counts too.
    expect(headers()).toEqual(['Barcode', 'Name', 'ERP price', 'ERP stock', 'Catalogue stock', 'Availability on Talabat', 'Price on Talabat', 'Compared', 'Status', 'Category']);
    expect(screen.getByRole('tab', { name: 'All (3)' })).toBeTruthy();

    const r1 = within(screen.getByText('Product 1').closest('tr')!);
    expect(within(r1.getByTestId('mp-availability-cell')).getByText('Available')).toBeTruthy();
    expect(r1.getByTestId('mp-price-cell').textContent).toBe('QAR 4.00');
    expect(within(r1.getByTestId('mp-compared-cell')).getByTestId('mp-compared').textContent).toBe('Mismatch');
    expect(within(r1.getByTestId('mp-compared-cell')).getByTestId('mp-stock-issue').textContent).toBe('Available but out of stock');
    expect(within(r1.getByTestId('mp-compared-cell')).getByTestId('mp-price-issue').textContent).toBe('Price lower than My pricing');

    const r2 = within(screen.getByText('Product 2').closest('tr')!);
    expect(r2.getByTestId('mp-availability-cell').textContent).toBe('Not in the file');
    expect(r2.getByTestId('mp-price-cell').textContent).toBe('Not in the file');
    expect(within(r2.getByTestId('mp-compared-cell')).getByTestId('mp-compared').textContent).toBe('Not in the file');

    const r3 = within(screen.getByText('Product 3').closest('tr')!);
    expect(within(r3.getByTestId('mp-availability-cell')).getByText('Unavailable')).toBeTruthy();
    expect(r3.getByTestId('mp-price-cell').textContent).toBe(`QAR 4.00From the file uploaded ${qatarDateTime(OLDER)}`);
    expect(within(r3.getByTestId('mp-compared-cell')).getByTestId('mp-compared').textContent).toBe('In sync');

    // On a phone the same values stack under the name (the columns are md:table-cell).
    const stacked = within(r1.getByTestId('mp-stacked'));
    expect(stacked.getByText('Availability on Talabat')).toBeTruthy();
    expect(stacked.getByTestId('mp-compared').textContent).toBe('Mismatch');
    expect(r1.getByTestId('mp-availability-cell').className).toContain('hidden md:table-cell');

    for (const cell of screen.getAllByTestId(/^mp-(availability|price|compared)-cell$/)) {
      expect(cell.querySelectorAll('button, input, select, textarea, a')).toHaveLength(0);
    }
    expect(screen.getByTestId('marketplace-note').textContent).toBe(
      `Marketplace values are from the latest Talabat file, uploaded ${qatarDateTime(FILE)} (Qatar time). The comparison is from the last run; right after an upload it can be one run behind.`);

    // Pressing it again: the plain catalogue.
    fireEvent.click(toggleOf('Talabat'));
    await waitFor(() => expect(lastList().marketplaceId).toBeUndefined());
    expect(search()).toBe('');
    await waitFor(() => expect(headers()).toEqual(BASE_HEADERS));
  });

  it('shows "Not compared" for a product the comparison has not judged yet', async () => {
    serve(p => ok({ items: [p.marketplaceId ? withMp('1', mp({ comparison: 'not_applicable', stockIssue: 'available_but_out_of_stock' })) : prod('1')], nextCursor: null, counts: counts() }));
    renderAt('/catalogue?marketplace=talabat', <CatalogueView />);
    const badge = await screen.findAllByTestId('mp-compared');
    expect(badge[0].textContent).toBe('Not compared');
    // Issues only exist for a compared product.
    expect(screen.queryByTestId('mp-stock-issue')).toBeNull();
  });

  it('"Only mismatches" sends marketplaceStatus=mismatch and is kept in the URL; another choice starts without it', async () => {
    serve(p => ok({ items: [withMp('1', mp({ marketplaceId: p.marketplaceId ?? 'talabat', comparison: p.marketplaceStatus ? 'mismatch' : 'in_sync' }))], nextCursor: null, counts: counts() }));
    renderAt('/catalogue', <CatalogueView />);
    await screen.findByText('Product 1');
    await waitFor(() => expect(compareGroup()).not.toBeNull());
    fireEvent.click(toggleOf('Snoonu'));
    fireEvent.click(mismatches());
    await waitFor(() => expect(lastList()).toMatchObject({ marketplaceId: 'snoonu', marketplaceStatus: 'mismatch' }));
    expect(mismatches().checked).toBe(true);
    expect(search()).toBe('?marketplace=snoonu&mismatches=1');

    fireEvent.click(mismatches());
    await waitFor(() => expect(lastList().marketplaceStatus).toBeUndefined());
    expect(search()).toBe('?marketplace=snoonu');

    fireEvent.click(mismatches());
    await waitFor(() => expect(search()).toBe('?marketplace=snoonu&mismatches=1'));
    // Unpress Snoonu, press Talabat: a new choice, without the filter.
    fireEvent.click(toggleOf('Snoonu'));
    fireEvent.click(toggleOf('Talabat'));
    await waitFor(() => expect(lastList()).toMatchObject({ marketplaceId: 'talabat' }));
    expect(lastList().marketplaceStatus).toBeUndefined();
    expect(search()).toBe('?marketplace=talabat');
    expect(mismatches().checked).toBe(false);

    fireEvent.click(mismatches());
    fireEvent.click(toggleOf('Talabat'));
    await waitFor(() => expect(lastList().marketplaceId).toBeUndefined());
    expect(lastList().marketplaceStatus).toBeUndefined();
    expect(search()).toBe('');
    expect(screen.queryByRole('checkbox', { name: 'Only mismatches' })).toBeNull();
  });

  it('says so when "Only mismatches" finds none', async () => {
    serve(p => ok({ items: p.marketplaceStatus ? [] : [p.marketplaceId ? withMp('1', mp()) : prod('1')], nextCursor: null, counts: counts() }));
    renderAt('/catalogue?marketplace=talabat&mismatches=1', <CatalogueView />);
    await screen.findByText('No mismatches on Talabat');
  });

  it('restores the choice from the URL, and leaves out a marketplace that is not offered', async () => {
    serve(p => ok({ items: [p.marketplaceId ? withMp('1', mp({ marketplaceId: p.marketplaceId, comparison: 'mismatch' })) : prod('1')], nextCursor: null, counts: counts() }));
    renderAt('/catalogue?marketplace=snoonu&mismatches=1', <CatalogueView />);
    await screen.findByRole('columnheader', { name: 'Availability on Snoonu' });
    expect(pressed()).toEqual(['Snoonu']);
    expect(mismatches().checked).toBe(true);
    expect(lastList()).toMatchObject({ marketplaceId: 'snoonu', marketplaceStatus: 'mismatch' });
    cleanup();

    fetchMock.mockClear();
    // keeta is enabled but has no file; compare=keeta is not offered either.
    renderAt('/catalogue?marketplace=keeta&compare=keeta', <CatalogueView />);
    await screen.findByText('Product 1');
    await waitFor(() => expect(compareGroup()).not.toBeNull());
    expect(pressed()).toEqual([]);
    expect(calls(isList).every(([u]) => params(String(u)).marketplaceId === undefined && params(String(u)).compareMarketplaceId === undefined)).toBe(true);
  });

  it('two marketplaces side by side: one column each and what differs between them', async () => {
    serve(twoMarketplaces);
    renderAt('/catalogue?marketplace=talabat', <CatalogueView />);
    await screen.findByRole('columnheader', { name: 'Availability on Talabat' });
    fireEvent.click(toggleOf('Snoonu'));
    await screen.findByRole('columnheader', { name: 'Talabat vs Snoonu' });
    expect(pressed()).toEqual(['Talabat', 'Snoonu']);
    expect(search()).toBe('?marketplace=talabat&compare=snoonu');
    expect(lastList()).toMatchObject({ marketplaceId: 'talabat', compareMarketplaceId: 'snoonu' });
    expect(lastList().marketplacesDiffer).toBeUndefined();
    expect(screen.getByTestId('compare-hint').textContent).toBe('Read-only. Your catalogue does not change.');
    expect(headers()).toEqual(['Barcode', 'Name', 'ERP price', 'ERP stock', 'Catalogue stock', 'Talabat', 'Snoonu', 'Talabat vs Snoonu', 'Status', 'Category']);

    const row = (id: string) => within(screen.getByText(`Product ${id}`).closest('tr')!);
    expect(row('1').getByTestId('mp-difference').textContent).toBe('Price differs');
    expect(row('1').getByTestId('mp-b-cell').textContent).toContain('QAR 3.75');
    expect(row('2').getByTestId('mp-difference').textContent).toBe('Only on Talabat');
    expect(row('2').getByTestId('mp-b-cell').textContent).toContain('Not in the file');
    // 4.000 and 4 are the same price.
    expect(row('3').getByTestId('mp-difference').textContent).toBe('Same on both');
    for (const cell of screen.getAllByTestId(/^mp-(a|b|difference)-cell$/)) {
      expect(cell.querySelectorAll('button, input, select, textarea, a')).toHaveLength(0);
    }
    // On a phone both stack under the name, then the difference.
    expect(within(row('1').getByTestId('mp-stacked')).getByText('Talabat vs Snoonu')).toBeTruthy();
    expect(screen.getByTestId('compare-note').textContent).toContain('latest Snoonu file');
    // "Only mismatches" is for one marketplace against the catalogue; two have their own filter.
    expect(screen.queryByRole('checkbox', { name: 'Only mismatches' })).toBeNull();
  });

  it('"Only where … differ" sends marketplacesDiffer, kept in the URL; price or availability can be chosen', async () => {
    serve(twoMarketplaces);
    renderAt('/catalogue?marketplace=talabat&compare=snoonu', <CatalogueView />);
    await screen.findByRole('columnheader', { name: 'Talabat vs Snoonu' });
    fireEvent.click(differBox());
    await waitFor(() => expect(lastList()).toMatchObject({ compareMarketplaceId: 'snoonu', marketplacesDiffer: 'any' }));
    expect(search()).toBe('?marketplace=talabat&compare=snoonu&differ=any');
    await waitFor(() => expect(screen.queryByText('Product 3')).toBeNull());
    fireEvent.change(screen.getByTestId('differ-on'), { target: { value: 'price' } });
    await waitFor(() => expect(lastList().marketplacesDiffer).toBe('price'));
    expect(search()).toBe('?marketplace=talabat&compare=snoonu&differ=price');
    fireEvent.click(differBox());
    await waitFor(() => expect(lastList().marketplacesDiffer).toBeUndefined());
    expect(search()).toBe('?marketplace=talabat&compare=snoonu');
  });

  it('says so when the two marketplaces match, and a third choice waits until one is unpressed', async () => {
    serve(p => ok({ items: p.marketplacesDiffer ? [] : [withMp('1', mp(), mp({ marketplaceId: p.compareMarketplaceId ?? 'snoonu' }))], nextCursor: null, counts: counts() }),
      [{ marketplaceId: 'talabat', hasData: true }, { marketplaceId: 'snoonu', hasData: true }, { marketplaceId: 'rafeeq', hasData: true }]);
    renderAt('/catalogue?marketplace=talabat&compare=snoonu&differ=any', <CatalogueView />);
    expect(await screen.findByText('Talabat and Snoonu match')).toBeTruthy();
    expect(toggleOf('Rafeeq').disabled).toBe(true);
    expect(toggleOf('Rafeeq').title).toBe('Compare at most 2 marketplaces at once');
    fireEvent.click(toggleOf('Snoonu'));
    await waitFor(() => expect(toggleOf('Rafeeq').disabled).toBe(false));
    expect(search()).toBe('?marketplace=talabat');
    fireEvent.click(toggleOf('Rafeeq'));
    await waitFor(() => expect(search()).toBe('?marketplace=talabat&compare=rafeeq'));
  });

  it('a backend that cannot compare two shows the first marketplace alone and says why', async () => {
    serve(p => (p.compareMarketplaceId
      ? fail(400, 'Invalid request', [{ path: '', message: 'Unrecognized key: "compareMarketplaceId"' }])
      : ok({ items: [p.marketplaceId ? withMp('1', mp()) : prod('1')], nextCursor: null, counts: counts() })));
    renderAt('/catalogue?marketplace=talabat&compare=snoonu', <CatalogueView />);
    await screen.findByText('Snoonu values cannot be shown next to Talabat: This server cannot compare two marketplaces yet. The list below shows Talabat alone.');
    expect(screen.getByRole('columnheader', { name: 'Availability on Talabat' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Only where Talabat and Snoonu differ' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Only mismatches' })).toBeTruthy();
  });

  it('without settings.view, takes the choices from the recon summary marketplaces that have a file and says when they were compared', async () => {
    vi.stubEnv('VITE_REAL_RECON', 'true');
    perms.add('recon.view');
    const s = (marketplaceId: string, hasData: boolean) => ({
      marketplaceId, hasData, stock: 0, price: 0, total: 0, listed: 0, notListed: 0, noData: 0, missingFromErp: 0, newCount: 0, lastUploadAt: hasData ? FILE : null, stale: false,
    });
    handler = (u, i) => {
      if (u.startsWith('/api/recon/summary')) return ok({ reference: 'marketplace', computedAt: COMPUTED, marketplaces: [s('talabat', true), s('rafeeq', false)] });
      return isList(u, i.method ?? 'GET') ? ok({ items: [withMp('1', mp())], nextCursor: null, counts: counts() }) : undefined;
    };
    renderAt('/catalogue', <CatalogueView />);
    await screen.findByText('Product 1');
    await waitFor(() => expect(compareGroup()).not.toBeNull());
    expect(toggleNames()).toEqual(['Talabat']);
    expect(calls(u => u.startsWith('/api/settings'))).toHaveLength(0);
    fireEvent.click(toggleOf('Talabat'));
    expect((await screen.findByTestId('marketplace-note')).textContent).toBe(
      `Marketplace values are from the latest Talabat file, uploaded ${qatarDateTime(FILE)} (Qatar time). Compared ${qatarDateTime(COMPUTED)} (Qatar time); right after an upload the comparison can be one run behind.`);
  });

  it('shows nothing extra when the backend sends no marketplace object, a malformed one, or one for another marketplace', async () => {
    serve(p => ok({ items: p.marketplaceId
      ? [prod('1'), withMp('2', { marketplaceId: 'talabat', comparison: 'whatever' }), withMp('3', mp({ marketplaceId: 'keeta' }))]
      : [prod('1'), prod('2'), prod('3')], nextCursor: null, counts: counts() }));
    renderAt('/catalogue?marketplace=talabat', <CatalogueView />);
    await screen.findByText('Talabat values are not available from this server yet; the list below is the catalogue without them.');
    expect(screen.queryByRole('columnheader', { name: 'Availability on Talabat' })).toBeNull();
    expect(screen.queryByTestId('marketplace-note')).toBeNull();
    expect(screen.queryByTestId('mp-stacked')).toBeNull();
  });

  it('falls back to the plain list with the reason when the backend refuses the marketplace (not enabled, or an older backend)', async () => {
    serve(p => (p.marketplaceId
      ? fail(400, 'Invalid request', [{ path: 'marketplaceId', message: 'Talabat is not enabled for this store' }])
      : ok({ items: [prod('1')], nextCursor: null, counts: counts() })));
    renderAt('/catalogue?marketplace=talabat', <CatalogueView />);
    await screen.findByText('Talabat values cannot be shown: Talabat is not enabled for this store. The list below is the catalogue without them.');
    expect(screen.getByText('Product 1')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Only mismatches' })).toBeNull();
    cleanup();

    serve(p => (p.marketplaceId
      ? fail(400, 'Invalid request', [{ path: '', message: 'Unrecognized key: "marketplaceId"' }])
      : ok({ items: [prod('1')], nextCursor: null, counts: counts() })));
    renderAt('/catalogue?marketplace=talabat', <CatalogueView />);
    await screen.findByText(/Talabat values cannot be shown: This server does not offer marketplace values in the catalogue yet\./);
  });

  it('keeps other errors as errors', async () => {
    serve(p => (p.marketplaceId ? fail(500, 'Boom') : ok({ items: [prod('1')], nextCursor: null, counts: counts() })));
    renderAt('/catalogue?marketplace=talabat', <CatalogueView />);
    await screen.findByText('We could not load the catalogue');
  });

  it('keeps the bulk actions, counting a filter selection without "Only mismatches"', async () => {
    perms.add('catalogue.stock_edit');
    serve(p => (p.marketplaceStatus
      ? ok({ items: [withMp('1', mp({ comparison: 'mismatch' }))], nextCursor: null, counts: counts({ all: 1, active: 1 }) })
      : ok({ items: [p.marketplaceId ? withMp('1', mp()) : prod('1')], nextCursor: null, counts: counts({ all: 40, active: 30 }) })));
    renderAt('/catalogue?marketplace=talabat&mismatches=1', <CatalogueView />);
    await screen.findByText('All (1)');
    expect(screen.getByRole('checkbox', { name: 'Tick Product 1' })).toBeTruthy();
    expect(screen.getByTestId('ticked-count').textContent).toContain('A bulk change uses the search and category only, not "Only mismatches".');
    fireEvent.click(screen.getByRole('button', { name: 'Bulk stock edit…' }));
    await screen.findByText(/Every product \(40\)/);
    const countCall = calls(isList).find(([u]) => params(String(u)).limit === '1')!;
    expect(params(countCall[0] as string)).toEqual({ tab: 'all', limit: '1' });
  });

  it('with "Only where … differ" on, the bulk note names that filter too', async () => {
    perms.add('catalogue.stock_edit');
    serve(twoMarketplaces);
    renderAt('/catalogue?marketplace=talabat&compare=snoonu&differ=any', <CatalogueView />);
    await screen.findByRole('columnheader', { name: 'Talabat vs Snoonu' });
    expect(screen.getByTestId('ticked-count').textContent).toContain('A bulk change uses the search and category only, not "Only where Talabat and Snoonu differ".');
  });
});

const detail = (over: Partial<ProductDetail> = {}): ProductDetail => ({
  ...prod('p1', { status: 'new', erpCategory: 'DAIRY', costPrice: 9 }), size: '1L', erpActive: true, createdAt: UPDATED,
  category: null, subcategory: null,
  listings: [{ marketplaceId: 'talabat', marketplaceProductId: 'T-1', price: 13, available: false, updatedAt: UPDATED }],
  arabicNameMissing: true, categoryMissing: true,
  ...over,
});
const LATER = '2026-10-30T09:00:00.000Z';
const detailsForm = () => within(screen.getByRole('form', { name: 'Qorloop details' }));

describe('product detail (CAT-002)', () => {
  it('shows the product, its listings and "Not available yet" for unbuilt sections', async () => {
    handler = u => (u === '/api/products/p1' ? ok(detail()) : undefined);
    renderAt('/catalogue/p1', <ProductDetailView />);
    expect(await screen.findByRole('heading', { name: 'Product p1' })).toBeTruthy();
    const listings = within(screen.getByRole('region', { name: 'Marketplace listings' }));
    expect(listings.getByText('Talabat')).toBeTruthy();
    expect(listings.getByText('T-1')).toBeTruthy();
    expect(listings.getByText('QAR 13.00')).toBeTruthy();
    expect(listings.getByText('Unavailable')).toBeTruthy();
    const erp = within(screen.getByRole('region', { name: 'From the ERP' }));
    expect(erp.getByText('QAR 9.00')).toBeTruthy();
    for (const t of ['Pricing rules', 'Price discrepancies', 'Change history']) {
      expect(within(screen.getByRole('region', { name: t })).getByText('Not available yet')).toBeTruthy();
    }
  });

  it('saves only the changed fields with expectedUpdatedAt, and shows field errors from the API', async () => {
    let attempt = 0;
    handler = (u, i) => {
      if (u !== '/api/products/p1') return undefined;
      if (i.method !== 'PATCH') return ok(detail());
      attempt++;
      return attempt === 1
        ? fail(400, 'Validation failed', [{ path: 'nameAr', message: 'Arabic name is too long' }])
        : ok(detail({ nameAr: 'حليب', categoryId: 'cat_dairy', subcategoryId: 'sub_milk', updatedAt: LATER, arabicNameMissing: false, categoryMissing: false }));
    };
    renderAt('/catalogue/p1', <ProductDetailView />);
    await screen.findByRole('heading', { name: 'Product p1' });
    await screen.findAllByRole('option', { name: 'Dairy' });

    fireEvent.change(screen.getByRole('textbox', { name: 'Arabic name' }), { target: { value: ' حليب ' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'active' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Arabic name is too long')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Arabic name' }).getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText('Validation failed')).toBeNull();
    expect(bodyOf(calls((u, m) => m === 'PATCH')[0])).toEqual({ nameAr: 'حليب', status: 'active', expectedUpdatedAt: UPDATED });

    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'cat_dairy' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Subcategory' }), { target: { value: 'sub_milk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(app.showToast).toHaveBeenCalledWith('Product saved', 'success'));
    expect(bodyOf(calls((u, m) => m === 'PATCH')[1])).toEqual({
      nameAr: 'حليب', categoryId: 'cat_dairy', subcategoryId: 'sub_milk', status: 'active', expectedUpdatedAt: UPDATED,
    });
    // Both details are there now, so no hint.
    await waitFor(() => expect(detailsForm().queryByRole('note')).toBeNull());
  });

  it('activates a product with no Arabic name and no category; the gaps stay a plain hint, not an error', async () => {
    handler = (u, i) => {
      if (u !== '/api/products/p1') return undefined;
      return i.method === 'PATCH' ? ok(detail({ status: 'active', updatedAt: LATER })) : ok(detail());
    };
    renderAt('/catalogue/p1', <ProductDetailView />);
    await screen.findByRole('heading', { name: 'Product p1' });
    expect(detailsForm().getByRole('note').textContent).toBe('Missing details: Arabic name, Category');

    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'active' } });
    const save = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(app.showToast).toHaveBeenCalledWith('Product saved', 'success'));
    expect(bodyOf(calls((u, m) => m === 'PATCH')[0])).toEqual({ status: 'active', expectedUpdatedAt: UPDATED });
    await waitFor(() => expect(screen.getByTestId('status-pill').textContent).toBe('Active'));

    const note = detailsForm().getByRole('note');
    expect(note.textContent).toBe('Missing details: Arabic name, Category');
    expect(note.className).not.toMatch(/red/);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/not ready to activate/i)).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Arabic name' }).getAttribute('aria-invalid')).toBe('false');
    expect(screen.getByRole('combobox', { name: 'Category' }).getAttribute('aria-invalid')).toBe('false');
  });

  it('builds the hint from arabicNameMissing / categoryMissing, not from the fields', async () => {
    handler = u => (u === '/api/products/p1' ? ok(detail({ arabicNameMissing: false, categoryMissing: true })) : undefined);
    renderAt('/catalogue/p1', <ProductDetailView />);
    await screen.findByRole('heading', { name: 'Product p1' });
    expect(detailsForm().getByRole('note').textContent).toBe('Missing details: Category');
    cleanup();

    handler = u => (u === '/api/products/p1' ? ok(detail({ arabicNameMissing: false, categoryMissing: false })) : undefined);
    renderAt('/catalogue/p1', <ProductDetailView />);
    await screen.findByRole('heading', { name: 'Product p1' });
    expect(detailsForm().queryByRole('note')).toBeNull();
  });

  it('a 403 on activating says so, as before', async () => {
    handler = (u, i) => {
      if (u !== '/api/products/p1') return undefined;
      return i.method === 'PATCH' ? fail(403, 'Permission denied') : ok(detail());
    };
    renderAt('/catalogue/p1', <ProductDetailView />);
    await screen.findByRole('heading', { name: 'Product p1' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'active' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have permission to do this.');
    expect(app.showToast).not.toHaveBeenCalled();
  });

  it('a 409 on activating says "This product changed; reload" and Reload fetches the new version', async () => {
    let version = 1;
    handler = (u, i) => {
      if (u !== '/api/products/p1') return undefined;
      if (i.method === 'PATCH') return fail(409, 'This product was changed by someone else; reload it and try again');
      return ok(detail(version === 1 ? {} : { nameAr: 'من شخص آخر', updatedAt: '2026-10-30T10:00:00.000Z' }));
    };
    renderAt('/catalogue/p1', <ProductDetailView />);
    await screen.findByRole('heading', { name: 'Product p1' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'active' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('alert')).textContent).toContain('This product changed; reload');
    version = 2;
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Arabic name' }) as HTMLInputElement).value).toBe('من شخص آخر'));
    expect(screen.queryByText(/This product changed; reload/)).toBeNull();
  });

  it('is read-only without products.edit, and cannot activate without products.activate', async () => {
    handler = u => (u === '/api/products/p1' ? ok(detail()) : undefined);
    perms.delete('products.activate');
    renderAt('/catalogue/p1', <ProductDetailView />);
    await screen.findByRole('heading', { name: 'Product p1' });
    expect((screen.getByRole('option', { name: /Active/ }) as HTMLOptionElement).disabled).toBe(true);
    cleanup();

    perms.delete('products.edit');
    renderAt('/catalogue/p1', <ProductDetailView />);
    await screen.findByRole('heading', { name: 'Product p1' });
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Arabic name' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('You can view this product but not edit it.')).toBeTruthy();
  });
});

describe('new products (CAT-004)', () => {
  const NEW = [
    prod('n1', { status: 'new', nameAr: 'جاهز', categoryId: 'cat_dairy' }),
    prod('n2', { status: 'new' }),
    prod('n3', { status: 'new', nameAr: 'بدون فئة' }),
  ];
  beforeEach(() => {
    handler = (u, i) => {
      if (isList(u, i.method ?? 'GET')) {
        expect(params(u).tab).toBe('new');
        return ok({ items: NEW, nextCursor: null, counts: counts({ new: 3 }) });
      }
      if (u === '/api/products/activate') {
        // As the backend answers: no Arabic name or category is required; only unknown or not-new ids are skipped.
        return 'all' in JSON.parse(String(i.body))
          ? ok({
            activated: 1336, arabicNameMissing: 1300, categoryMissing: 1336,
            skipped: [{ id: 'n1', reason: 'Not a new product' }, { id: 'gone', reason: 'Not found' }], skippedCount: 2,
          })
          : ok({ activated: 2, arabicNameMissing: 1, categoryMissing: 2, skipped: [], skippedCount: 0 });
      }
      if (u === '/api/products/n2' && i.method === 'PATCH') {
        return ok({ ...detail(), ...NEW[1], nameAr: 'اسم', categoryId: 'cat_snacks', updatedAt: LATER, listings: [], arabicNameMissing: false, categoryMissing: false });
      }
      return undefined;
    };
  });
  const OLD_READINESS = /not ready|^ready$|Arabic name missing|Category missing|all ready/i;

  it('shows no readiness labels and saves an inline edit of Arabic name and category', async () => {
    renderAt('/catalogue/new', <NewProductsView />);
    const row = within(await screen.findByTestId('row-n2'));
    expect(screen.queryByRole('columnheader', { name: 'Ready' })).toBeNull();
    expect(screen.queryAllByText(OLD_READINESS)).toHaveLength(0);
    expect(screen.queryByText(/ready once it has/)).toBeNull();

    await screen.findAllByRole('option', { name: 'Snacks' });
    fireEvent.change(row.getByRole('textbox', { name: 'Arabic name for Product n2' }), { target: { value: 'اسم' } });
    fireEvent.change(row.getByRole('combobox', { name: 'Category for Product n2' }), { target: { value: 'cat_snacks' } });
    fireEvent.click(row.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(row.queryByRole('button', { name: 'Save' })).toBeNull());
    expect(bodyOf(calls((u, m) => m === 'PATCH')[0])).toEqual({ nameAr: 'اسم', categoryId: 'cat_snacks', expectedUpdatedAt: UPDATED });
    expect((row.getByRole('textbox', { name: 'Arabic name for Product n2' }) as HTMLInputElement).value).toBe('اسم');
  });

  it('activates selected rows that have no Arabic name or no category and sums up what they lack', async () => {
    renderAt('/catalogue/new', <NewProductsView />);
    await screen.findByTestId('row-n2');
    expect((screen.getByRole('button', { name: /Activate selected/ }) as HTMLButtonElement).disabled).toBe(true);
    // n2 has neither detail; n3 has an Arabic name but no category.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Product n2' }));
    expect((screen.getByRole('button', { name: 'Activate selected (1)' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Product n3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate selected (2)' }));

    const region = await screen.findByRole('region', { name: 'Activation result' });
    expect(within(region).getByText('Activated 2 products. 1 has no Arabic name and 2 have no category.')).toBeTruthy();
    expect(region.textContent).not.toMatch(/Skipped/);
    expect(within(region).queryByRole('table')).toBeNull();
    expect(screen.queryAllByText(OLD_READINESS)).toHaveLength(0);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(app.showToast).toHaveBeenCalledWith('Activated 2 products', 'success');
    expect(bodyOf(calls(u => u === '/api/products/activate')[0])).toEqual({ ids: ['n2', 'n3'] });
  });

  it('"Activate all" asks first, sends { all: true }, then sums up and lists only the skipped ids', async () => {
    renderAt('/catalogue/new', <NewProductsView />);
    await screen.findByTestId('row-n1');
    fireEvent.click(screen.getByRole('button', { name: 'Activate all' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Activate all new products?' }));
    expect(dialog.getByText(/with or without an Arabic name and a category/)).toBeTruthy();
    expect(calls(u => u === '/api/products/activate')).toHaveLength(0);
    fireEvent.click(dialog.getByRole('button', { name: 'Activate all' }));

    const result = within(await screen.findByRole('region', { name: 'Activation result' }));
    expect(result.getByText('Activated 1,336 products. 1,300 have no Arabic name and 1,336 have no category. Skipped 2.')).toBeTruthy();
    const rows = result.getAllByRole('row').slice(1).map(r => r.textContent);
    expect(rows).toEqual(['Product n16281000n1Not a new product', 'gone—Not found']);
    expect(bodyOf(calls(u => u === '/api/products/activate')[0])).toEqual({ all: true });
  });

  it('a 403 on activating shows the permission message, as before', async () => {
    const base = handler;
    handler = (u, i) => (u === '/api/products/activate' ? fail(403, 'Permission denied') : base(u, i));
    renderAt('/catalogue/new', <NewProductsView />);
    await screen.findByTestId('row-n2');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Product n2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate selected (1)' }));
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have permission to do this.');
    expect(screen.queryByRole('region', { name: 'Activation result' })).toBeNull();
  });

  it('a 409 on an inline save asks to reload', async () => {
    const base = handler;
    handler = (u, i) => (u === '/api/products/n2' && i.method === 'PATCH' ? fail(409, 'changed') : base(u, i));
    renderAt('/catalogue/new', <NewProductsView />);
    const row = within(await screen.findByTestId('row-n2'));
    fireEvent.change(row.getByRole('textbox', { name: 'Arabic name for Product n2' }), { target: { value: 'اسم' } });
    fireEvent.click(row.getByRole('button', { name: 'Save' }));
    expect((await row.findByRole('alert')).textContent).toContain('This product changed; reload');
  });

  it('hides selection and activation without products.activate, and editing without products.edit', async () => {
    perms.delete('products.activate');
    perms.delete('products.edit');
    renderAt('/catalogue/new', <NewProductsView />);
    await screen.findByTestId('row-n1');
    expect(screen.queryByRole('button', { name: /Activate/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('categories', () => {
  it('shows the tree and creates a category; a 409 name clash is shown on the name field', async () => {
    let created = 0;
    handler = (u, i) => {
      if (u !== '/api/categories' || i.method !== 'POST') return undefined;
      return ++created === 1
        ? fail(409, 'A category with this name already exists here')
        : ok({ id: 'cat_new', parentId: null, nameEn: 'Bakery', nameAr: null, sort: 0, productCount: 0 });
    };
    renderAt('/categories', <CategoriesView />);
    const tree = within(await screen.findByRole('list', { name: 'Category tree' }));
    expect(tree.getByRole('link', { name: /Dairy.*4 products.*1 subcategory/ }).getAttribute('href')).toBe('/categories/cat_dairy');
    expect(tree.getByRole('link', { name: /Milk.*2 products/ }).getAttribute('href')).toBe('/categories/sub_milk');

    fireEvent.click(screen.getByRole('button', { name: 'New category' }));
    const form = within(screen.getByRole('form', { name: 'New category' }));
    fireEvent.change(form.getByRole('textbox', { name: 'English name' }), { target: { value: 'Dairy' } });
    fireEvent.click(form.getByRole('button', { name: 'Create category' }));
    expect(await form.findByText('A category with this name already exists here')).toBeTruthy();
    fireEvent.change(form.getByRole('textbox', { name: 'English name' }), { target: { value: 'Bakery' } });
    fireEvent.click(form.getByRole('button', { name: 'Create category' }));
    await waitFor(() => expect(app.showToast).toHaveBeenCalledWith('Category "Bakery" created', 'success'));
    expect(bodyOf(calls((u, m) => u === '/api/categories' && m === 'POST')[1])).toEqual({ nameEn: 'Bakery' });
  });

  it('hides create without categories.manage', async () => {
    perms.delete('categories.manage');
    renderAt('/categories', <CategoriesView />);
    await screen.findByRole('list', { name: 'Category tree' });
    expect(screen.queryByRole('button', { name: 'New category' })).toBeNull();
  });

  it('category detail: rename, delete refused with the in-use counts, and ERP suggestions assignment', async () => {
    handler = (u, i) => {
      if (u === '/api/categories/cat_dairy' && i.method === 'PATCH') return ok({ ...TREE[0], nameEn: 'Dairy & eggs' });
      if (u === '/api/categories/cat_dairy' && i.method === 'DELETE') {
        return fail(409, 'This category is still in use', [{ path: 'products', count: 4 }, { path: 'children', count: 1 }]);
      }
      if (u === '/api/categories/erp-suggestions') {
        return ok([{ erpCategory: 'DAIRY', products: 10, unassigned: 6 }, { erpCategory: 'MILK', products: 3, unassigned: 0 }]);
      }
      if (u === '/api/categories/cat_dairy/assign-from-erp') return ok({ updated: 6 });
      if (isList(u, i.method ?? 'GET')) {
        expect(params(u).categoryId).toBe('cat_dairy');
        return ok({ items: [prod('1', { categoryId: 'cat_dairy' })], nextCursor: null, counts: counts({ all: 1 }) });
      }
      return undefined;
    };
    renderAt('/categories/cat_dairy', <CategoryDetailView />);
    expect(await screen.findByRole('heading', { name: 'Dairy' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Subcategories' })).getByRole('link', { name: /Milk/ })).toBeTruthy();
    expect(await within(screen.getByRole('region', { name: 'Products in this category' })).findByText('Product 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const form = within(screen.getByRole('form', { name: 'Rename category' }));
    fireEvent.change(form.getByRole('textbox', { name: 'English name' }), { target: { value: 'Dairy & eggs' } });
    fireEvent.click(form.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(app.showToast).toHaveBeenCalledWith('Category renamed', 'success'));
    expect(bodyOf(calls((u, m) => m === 'PATCH')[0])).toEqual({ nameEn: 'Dairy & eggs', nameAr: 'ألبان' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete category' }));
    expect((await screen.findByText(/cannot be deleted while it is in use/)).parentElement!.textContent).toContain('4 products, 1 subcategory');
    expect(screen.getByTestId('where').textContent).toBe('/categories/cat_dairy');

    const panel = within(screen.getByRole('region', { name: 'ERP category suggestions' }));
    const milk = (await panel.findByText('MILK')).closest('label')!.querySelector('input')!;
    expect(milk.disabled).toBe(true);
    fireEvent.click(panel.getByText('DAIRY'));
    fireEvent.click(panel.getByRole('button', { name: 'Assign selected ERP categories to this category (1)' }));
    expect(await panel.findByText(/6 products filed under Dairy/)).toBeTruthy();
    expect(bodyOf(calls(u => u.endsWith('/assign-from-erp'))[0])).toEqual({ erpCategories: ['DAIRY'] });
  });

  it('without categories.manage: no rename/delete, and ERP suggestions are never requested', async () => {
    perms.delete('categories.manage');
    handler = (u, i) => (isList(u, i.method ?? 'GET') ? ok({ items: [], nextCursor: null, counts: counts({ all: 0 }) }) : undefined);
    renderAt('/categories/cat_dairy', <CategoryDetailView />);
    await screen.findByRole('heading', { name: 'Dairy' });
    await screen.findByText('No products in this category');
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add subcategory' })).toBeNull();
    expect(calls(u => u.includes('erp-suggestions'))).toHaveLength(0);
  });

  it('a subcategory filters products by subcategoryId and has no ERP panel', async () => {
    handler = (u, i) => {
      if (isList(u, i.method ?? 'GET')) {
        expect(params(u)).toMatchObject({ subcategoryId: 'sub_milk' });
        return ok({ items: [], nextCursor: null, counts: counts({ all: 0 }) });
      }
      return undefined;
    };
    renderAt('/categories/sub_milk', <CategoryDetailView />);
    await screen.findByRole('heading', { name: 'Milk' });
    expect(screen.getByText(/Subcategory of Dairy/)).toBeTruthy();
    await screen.findByText('No products in this category');
    expect(screen.queryByRole('region', { name: 'ERP category suggestions' })).toBeNull();
  });
});
