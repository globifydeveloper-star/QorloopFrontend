// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ProductDetail, ProductItem, TabCounts } from '../../../api/products';
import type { CategoryNode } from '../../../api/categories';

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

const Where = () => { const l = useLocation(); return <output data-testid="where">{l.pathname}</output>; };
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

    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(
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
    expect(screen.getByText('Database unavailable')).toBeTruthy();
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

const detail = (over: Partial<ProductDetail> = {}): ProductDetail => ({
  ...prod('p1', { status: 'new', erpCategory: 'DAIRY', costPrice: 9 }), size: '1L', erpActive: true, createdAt: UPDATED,
  category: null, subcategory: null,
  listings: [{ marketplaceId: 'talabat', marketplaceProductId: 'T-1', price: 13, available: false, updatedAt: UPDATED }],
  ...over,
});

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
    for (const t of ['Marketplace price rules', 'Price discrepancies', 'Change history']) {
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
        ? fail(400, 'The product is not ready to activate', [{ path: 'category', message: 'Category missing' }])
        : ok(detail({ nameAr: 'حليب', categoryId: 'cat_dairy', subcategoryId: 'sub_milk', updatedAt: '2026-10-30T09:00:00.000Z' }));
    };
    renderAt('/catalogue/p1', <ProductDetailView />);
    await screen.findByRole('heading', { name: 'Product p1' });
    await screen.findAllByRole('option', { name: 'Dairy' });

    fireEvent.change(screen.getByRole('textbox', { name: 'Arabic name' }), { target: { value: ' حليب ' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'active' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Category missing')).toBeTruthy();
    expect(screen.getByText('The product is not ready to activate')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Category' }).getAttribute('aria-invalid')).toBe('true');
    expect(bodyOf(calls((u, m) => m === 'PATCH')[0])).toEqual({ nameAr: 'حليب', status: 'active', expectedUpdatedAt: UPDATED });

    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'cat_dairy' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Subcategory' }), { target: { value: 'sub_milk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(app.showToast).toHaveBeenCalledWith('Product saved', 'success'));
    expect(bodyOf(calls((u, m) => m === 'PATCH')[1])).toEqual({
      nameAr: 'حليب', categoryId: 'cat_dairy', subcategoryId: 'sub_milk', status: 'active', expectedUpdatedAt: UPDATED,
    });
  });

  it('a 409 says "This product changed; reload" and Reload fetches the new version', async () => {
    let version = 1;
    handler = (u, i) => {
      if (u !== '/api/products/p1') return undefined;
      if (i.method === 'PATCH') return fail(409, 'This product was changed by someone else; reload it and try again');
      return ok(detail(version === 1 ? {} : { nameAr: 'من شخص آخر', updatedAt: '2026-10-30T10:00:00.000Z' }));
    };
    renderAt('/catalogue/p1', <ProductDetailView />);
    await screen.findByRole('heading', { name: 'Product p1' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Arabic name' }), { target: { value: 'حليب' } });
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
        return 'all' in JSON.parse(String(i.body))
          ? ok({ activated: 1, skipped: [{ id: 'n2', reason: 'Arabic name missing' }, { id: 'n3', reason: 'Category missing' }], skippedCount: 2 })
          : ok({ activated: 1, skipped: [{ id: 'n2', reason: 'Arabic name missing' }], skippedCount: 1 });
      }
      if (u === '/api/products/n2' && i.method === 'PATCH') {
        return ok({ ...detail(), ...NEW[1], nameAr: 'اسم', categoryId: 'cat_snacks', updatedAt: '2026-10-30T09:00:00.000Z', listings: [] });
      }
      return undefined;
    };
  });

  it('labels readiness and saves an inline edit of Arabic name and category', async () => {
    renderAt('/catalogue/new', <NewProductsView />);
    const row = within(await screen.findByTestId('row-n2'));
    expect(row.getByText('Not ready')).toBeTruthy();
    expect(row.getByText('Arabic name missing')).toBeTruthy();
    expect(row.getByText('Category missing')).toBeTruthy();
    expect(within(screen.getByTestId('row-n1')).getByText('Ready')).toBeTruthy();

    await screen.findAllByRole('option', { name: 'Snacks' });
    fireEvent.change(row.getByRole('textbox', { name: 'Arabic name for Product n2' }), { target: { value: 'اسم' } });
    fireEvent.change(row.getByRole('combobox', { name: 'Category for Product n2' }), { target: { value: 'cat_snacks' } });
    fireEvent.click(row.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(row.getByText('Ready')).toBeTruthy());
    expect(bodyOf(calls((u, m) => m === 'PATCH')[0])).toEqual({ nameAr: 'اسم', categoryId: 'cat_snacks', expectedUpdatedAt: UPDATED });
    expect(row.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('activates the selected rows and lists the skipped ones with their reasons', async () => {
    renderAt('/catalogue/new', <NewProductsView />);
    await screen.findByTestId('row-n1');
    const activate = screen.getByRole('button', { name: /Activate selected/ }) as HTMLButtonElement;
    expect(activate.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Product n1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Product n2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate selected (2)' }));

    const result = within(await screen.findByRole('region', { name: 'Activation result' }));
    expect(result.getByText(/Activated 1 product\. Skipped 1\./)).toBeTruthy();
    const skipped = result.getByRole('link', { name: 'Product n2' }).closest('tr')!;
    expect(skipped.textContent).toContain('Arabic name missing');
    expect(skipped.textContent).toContain('6281000n2');
    expect(bodyOf(calls(u => u === '/api/products/activate')[0])).toEqual({ ids: ['n1', 'n2'] });
  });

  it('"Activate all ready" asks first, then sends { all: true }', async () => {
    renderAt('/catalogue/new', <NewProductsView />);
    await screen.findByTestId('row-n1');
    fireEvent.click(screen.getByRole('button', { name: 'Activate all ready' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Activate all ready products?' }));
    expect(calls(u => u === '/api/products/activate')).toHaveLength(0);
    fireEvent.click(dialog.getByRole('button', { name: 'Activate all ready' }));
    const result = within(await screen.findByRole('region', { name: 'Activation result' }));
    expect(result.getByText(/Skipped 2\./)).toBeTruthy();
    expect(result.getByText('Category missing')).toBeTruthy();
    expect(bodyOf(calls(u => u === '/api/products/activate')[0])).toEqual({ all: true });
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
