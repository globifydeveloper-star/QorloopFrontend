// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ProductStock, StockConflictsPage, UploadChangeRow, UploadChangesPage } from '../../../api/stock';

const perms = new Set<string>();
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ can: (p: string) => perms.has(p) }) }));
const app = { showToast: vi.fn(), openUploadModal: vi.fn(), navigate: vi.fn(), compareReference: 'marketplace', setCompareReference: vi.fn() };
vi.mock('../../../context/AppContext', () => ({ useApp: () => app }));

import { UploadChanges } from '../UploadChanges';
import { StockConflictsView } from '../StockConflictsView';
import { ProductStockPanel } from '../ProductStockPanel';
import { DashboardView } from '../../views/DashboardView';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json(200, { data });
const fail = (status: number, message: string, details?: unknown[]) => json(status, { error: { code: 'E', message, details } });

type Handler = (url: string, init: RequestInit) => Response | undefined;
let handler: Handler;
let fetchMock: ReturnType<typeof vi.fn>;
const method = (i?: RequestInit) => i?.method ?? 'GET';
const calls = (pred: (url: string, m: string) => boolean) => fetchMock.mock.calls.filter(([u, i]) => pred(String(u), method(i as RequestInit)));
const bodyOf = (c: unknown[]) => JSON.parse(String((c[1] as RequestInit).body));
const params = (u: string) => Object.fromEntries(new URL(u, 'http://x').searchParams);

function renderUi(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}><Routes><Route path="*" element={ui} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_REAL_CATALOGUE', 'true');
  vi.stubEnv('VITE_REAL_UPLOADS', 'true');
  perms.clear();
  ['products.view', 'uploads.view'].forEach(p => perms.add(p));
  app.showToast.mockClear();
  handler = () => undefined;
  fetchMock = vi.fn(async (u: string, i: RequestInit = {}) => handler(String(u), i) ?? fail(404, 'not mocked'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

// ───────── Change list ─────────

const PID = '7d1f3c2e-0000-4000-8000-000000000001';
const change = (over: Partial<UploadChangeRow>): UploadChangeRow => ({
  productId: PID, barcode: '6281', rowNumber: 3, kind: 'price', field: 'erpPrice', old: 6.32, new: 6.325, stockConflict: false,
  product: { nameEn: 'Milk 1L', nameAr: null, status: 'active' }, fixedPriceRule: true, catalogueStock: null, ...over,
});
const COUNTS = { all: 120, new: 2, price: 40, stock: 70, name: 3, active: 1, missing: 2, returned: 1, other: 1, stockConflicts: 4 };
const changesPage = (over: Partial<UploadChangesPage> = {}): UploadChangesPage => ({
  upload: { id: 'up_1' } as UploadChangesPage['upload'], changesRecorded: true, kind: 'all', conflictOnly: false, page: 1, pageSize: 50, total: 120,
  counts: COUNTS,
  rows: [
    change({}),
    change({ kind: 'stock', field: 'erpStock', old: 8, new: 12, stockConflict: true, fixedPriceRule: null, rowNumber: 4,
      catalogueStock: { erpStock: 12, catalogueStock: 5, source: 'owner', conflict: { ownerStock: 5, erpStock: 12, erpStockAtEdit: 8, inEffect: 'owner' } } }),
    change({ kind: 'missing', field: 'inLatestErpFile', old: true, new: false, rowNumber: null, fixedPriceRule: null }),
  ],
  ...over,
});
const isChanges = (u: string) => u.startsWith('/api/uploads/up_1/changes');

describe('upload change list', () => {
  it('shows counts per kind, rows with old and new values, the fixed price note and the conflict note', async () => {
    handler = u => (isChanges(u) ? ok(changesPage()) : undefined);
    renderUi(<UploadChanges uploadId="up_1" applied={{ changesRecorded: true, changes: 120, stockConflicts: 4, stockEditsCleared: 1 }} />);
    expect((await screen.findByTestId('count-price')).textContent).toBe('Price 40');
    expect(screen.getByTestId('count-stock').textContent).toBe('Stock 70');
    expect(screen.queryByTestId('count-cost')).toBeNull(); // no cost count for this role
    const rows = screen.getAllByTestId('change-row');
    expect(rows).toHaveLength(3);
    const price = within(rows[0]);
    expect(price.getByTestId('change-old').textContent).toBe('6.32 QAR');
    expect(price.getByTestId('change-new').textContent).toBe('6.325 QAR');
    expect(price.getByTestId('fixed-price-note').textContent).toBe('This product keeps its fixed price.');
    expect(within(rows[1]).getByTestId('conflict-note').textContent).toContain('your value (5) stays in effect');
    expect(within(rows[2]).getByTestId('change-new').textContent).toBe('Not in the file');
    expect(rows[2].textContent).toContain('—'); // no file row for a missing product
    expect(screen.getByTestId('applied-summary').textContent).toContain('1 stock edit cleared');
    expect(screen.getByRole('link', { name: 'Review stock conflicts' }).getAttribute('href')).toBe('/catalogue/stock-conflicts');
  });

  it('filters by kind and to conflicts only, and pages; each filter goes back to page 1', async () => {
    handler = u => {
      if (!isChanges(u)) return undefined;
      const p = params(u);
      return ok(changesPage({ kind: (p.kind ?? 'all') as UploadChangesPage['kind'], conflictOnly: p.conflict === 'true', page: Number(p.page) }));
    };
    renderUi(<UploadChanges uploadId="up_1" />);
    await screen.findByTestId('count-price');
    expect(params(String(calls(isChanges)[0][0]))).toEqual({ page: '1', pageSize: '50' });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(params(String(calls(isChanges).at(-1)![0]))).toEqual({ page: '2', pageSize: '50' }));
    await screen.findByText('Page 2 of 3');

    fireEvent.click(screen.getByTestId('count-stock'));
    await waitFor(() => expect(params(String(calls(isChanges).at(-1)![0]))).toEqual({ kind: 'stock', page: '1', pageSize: '50' }));
    expect(screen.getByTestId('count-stock').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('checkbox', { name: /Conflicts only/ }));
    await waitFor(() => expect(params(String(calls(isChanges).at(-1)![0]))).toEqual({ kind: 'stock', conflict: 'true', page: '1', pageSize: '50' }));
  });

  it('shows the cost count only when the server sends it', async () => {
    handler = u => (isChanges(u) ? ok(changesPage({ counts: { ...COUNTS, cost: 5 } })) : undefined);
    renderUi(<UploadChanges uploadId="up_1" />);
    expect((await screen.findByTestId('count-cost')).textContent).toBe('Cost 5');
  });

  it('an upload applied before the change list existed says so and lists nothing', async () => {
    handler = u => (isChanges(u) ? ok(changesPage({ changesRecorded: false, total: 0, rows: [] })) : undefined);
    renderUi(<UploadChanges uploadId="up_1" />);
    expect((await screen.findByTestId('changes-not-recorded')).textContent).toContain('applied before Qorloop started recording changes');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByTestId('count-price')).toBeNull();
  });
});

// ───────── Conflicts page ─────────

const conflictRow = (id: string, over = {}) => ({
  productId: id, barcode: `628${id}`, nameEn: `Product ${id}`, nameAr: null, status: 'active', erpStock: 12, ownerStock: 5, erpStockAtEdit: 8,
  catalogueStock: 5, reason: 'Counted', setBy: { id: 'u1', name: 'Amal' }, setAt: '2026-11-05T07:00:00.000Z',
  conflictUploadId: 'up_2', conflictAt: '2026-11-06T05:00:00.000Z', updatedAt: '2026-11-06T05:00:00.000Z', ...over,
});
const conflicts = (rows = [conflictRow('1'), conflictRow('2')]): StockConflictsPage => ({ inEffect: 'owner', page: 1, pageSize: 50, total: rows.length, rows });
const isConflicts = (u: string, m: string) => m === 'GET' && u.startsWith('/api/catalogue/stock/conflicts?');

describe('stock conflicts page', () => {
  it('says the owner value is in effect and lists both values, who and when (Qatar time); read-only without stock_edit', async () => {
    handler = (u, i) => (isConflicts(u, method(i)) ? ok(conflicts()) : undefined);
    renderUi(<StockConflictsView />);
    const row = within((await screen.findAllByTestId('conflict-row'))[0]);
    expect(screen.getByTestId('in-effect').textContent).toContain('the stock you entered stays in effect');
    expect(row.getByTestId('owner-stock').textContent).toBe('5');
    expect(row.getByTestId('erp-stock').textContent).toContain('12');
    expect(row.getByTestId('set-by').textContent).toBe('Amal, 05 Nov 2026, 10:00');
    expect(screen.queryByRole('button', { name: /Keep mine/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('resolves one row with the values shown; a 409 reloads the list and says why', async () => {
    perms.add('catalogue.stock_edit');
    let resolves = 0;
    handler = (u, i) => {
      if (isConflicts(u, method(i))) return ok(conflicts());
      if (u === '/api/products/1/stock/resolve') return ++resolves === 1 ? ok({}) : fail(409, 'Conflict');
      return undefined;
    };
    renderUi(<StockConflictsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep mine for Product 1' }));
    await waitFor(() => expect(app.showToast).toHaveBeenCalledWith('Product 1 keeps your stock of 5', 'success'));
    expect(bodyOf(calls(u => u === '/api/products/1/stock/resolve')[0])).toEqual({ choice: 'keep', expected: { erpStock: 12, ownerStock: 5 } });

    const before = calls(isConflicts).length;
    fireEvent.click(screen.getByRole('button', { name: 'Use ERP for Product 1' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Someone changed this stock');
    await waitFor(() => expect(calls(isConflicts).length).toBeGreaterThan(before));
  });

  it('bulk: preview, confirm, apply; a failed apply retries with the same idempotency key', async () => {
    perms.add('catalogue.stock_edit');
    let applies = 0;
    handler = (u, i) => {
      if (isConflicts(u, method(i))) return ok(conflicts());
      if (u === '/api/catalogue/stock/conflicts/resolve/preview') {
        return ok({ selected: 1, willResolve: 1, notInConflict: 0, notFound: 0, selection: bodyOf([u, i]).selection, choice: 'erp', limit: 5000, previewToken: 'b'.repeat(64),
          rows: [{ productId: '1', nameEn: 'Product 1', barcode: '6281', choice: 'erp', ownerStock: 5, erpStock: 12, erpStockAtEdit: 8, catalogueStockAfter: 12 }] });
      }
      if (u === '/api/catalogue/stock/conflicts/resolve/apply') {
        return ++applies === 1 ? fail(500, 'boom') : ok({ operationId: 'ev1', replayed: true, appliedAt: '2026-11-06T06:00:00.000Z', selected: 1, willResolve: 1, notInConflict: 0, notFound: 0 });
      }
      return undefined;
    };
    renderUi(<StockConflictsView />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Tick Product 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use ERP for…' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Resolve stock conflicts' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Preview' }));
    expect((await dialog.findByTestId('resolve-will')).textContent).toBe('1');
    expect(bodyOf(calls(u => u.endsWith('/resolve/preview'))[0])).toEqual({ selection: { productIds: ['1'] }, choice: 'erp' });
    expect(dialog.getByTestId('resolve-row').textContent).toContain('12');

    fireEvent.click(dialog.getByRole('button', { name: 'Use ERP for 1 product…' }));
    const confirm = () => within(screen.getAllByRole('dialog').at(-1)!);
    expect(confirm().getByTestId('confirm-count').textContent).toBe('1 product');
    fireEvent.click(confirm().getByRole('button', { name: 'Use ERP for 1 product' }));
    await confirm().findByRole('button', { name: 'Try again' });
    fireEvent.click(confirm().getByRole('button', { name: 'Try again' }));
    expect((await screen.findByTestId('resolve-done')).textContent).toBe('This change had already been applied');

    const applied = calls(u => u.endsWith('/resolve/apply')).map(bodyOf);
    expect(applied).toHaveLength(2);
    expect(applied[0].idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(applied[1].idempotencyKey).toBe(applied[0].idempotencyKey);
    expect(applied[0]).toMatchObject({ selection: { productIds: ['1'] }, choice: 'erp', previewToken: 'b'.repeat(64) });
  });

  it('a 409 on apply asks for a new preview and drops the key', async () => {
    perms.add('catalogue.stock_edit');
    handler = (u, i) => {
      if (isConflicts(u, method(i))) return ok(conflicts());
      if (u.endsWith('/resolve/preview')) return ok({ selected: 2, willResolve: 2, notInConflict: 0, notFound: 0, selection: { all: true }, choice: 'keep', limit: 5000, previewToken: 'c'.repeat(64), rows: [] });
      if (u.endsWith('/resolve/apply')) return fail(409, 'stale');
      return undefined;
    };
    renderUi(<StockConflictsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep mine for…' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Resolve stock conflicts' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Preview' }));
    fireEvent.click(await dialog.findByRole('button', { name: 'Keep mine for 2 products…' }));
    fireEvent.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Keep mine for 2 products' }));
    expect((await dialog.findByRole('alert')).textContent).toContain('Nothing was changed');
    expect(dialog.getByRole('button', { name: 'Preview again' })).toBeTruthy();
    expect(bodyOf(calls(u => u.endsWith('/resolve/preview'))[0]).selection).toEqual({ all: true });
  });
});

// ───────── Product stock editor ─────────

const stock = (over: Partial<ProductStock> = {}): ProductStock => ({
  productId: PID, erpStock: 12, catalogueStock: 5, source: 'owner', conflict: null,
  edit: { stock: 5, erpStockAtEdit: 12, state: 'active', reason: 'Counted', setBy: { id: 'u1', name: 'Amal' }, setAt: '2026-11-05T07:00:00.000Z', updatedAt: '2026-11-05T07:00:00.000Z' },
  ...over,
});
const PRODUCT = { id: PID, nameEn: 'Milk 1L', status: 'active', erpActive: true, inLatestErpFile: true };
const stockUrl = `/api/products/${PID}/stock`;

describe('product stock section', () => {
  it('shows ERP and catalogue stock side by side and who set it; no edit control without catalogue.stock_edit', async () => {
    handler = (u, i) => (u === stockUrl && method(i) === 'GET' ? ok(stock()) : undefined);
    renderUi(<ProductStockPanel product={PRODUCT} />);
    expect((await screen.findByTestId('erp-stock')).textContent).toBe('12');
    expect(screen.getByTestId('catalogue-stock').textContent).toBe('5');
    expect(screen.getByTestId('stock-source').textContent).toBe('Your own value (manual edit)');
    expect(screen.getByTestId('stock-origin').textContent).toContain('by Amal on 05 Nov 2026, 10:00 (Qatar time)');
    expect(screen.getByTestId('stock-origin').textContent).toContain('Reason: “Counted”');
    expect(screen.queryByRole('form', { name: 'Edit catalogue stock' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reset to ERP/ })).toBeNull();
  });

  it('saves a value with the expected values shown, and resets to ERP', async () => {
    perms.add('catalogue.stock_edit');
    // The server remembers each write, so the reload after it reads the new value.
    let current = stock();
    handler = (u, i) => {
      if (u === stockUrl && method(i) === 'GET') return ok(current);
      if (u === stockUrl && method(i) === 'PUT') { current = stock({ catalogueStock: 9, edit: { ...stock().edit!, stock: 9, updatedAt: '2026-11-06T09:00:00.000Z' } }); return ok({ ...current, changed: true }); }
      if (u.startsWith(`${stockUrl}?`) && method(i) === 'DELETE') { current = stock({ catalogueStock: 12, source: 'erp', edit: null }); return ok({ ...current, changed: true }); }
      return undefined;
    };
    renderUi(<ProductStockPanel product={PRODUCT} />);
    fireEvent.change(await screen.findByLabelText('Catalogue stock'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: ' shelf count ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stock' }));
    await waitFor(() => expect(app.showToast).toHaveBeenCalledWith('Catalogue stock saved', 'success'));
    expect(bodyOf(calls((u, m) => m === 'PUT')[0])).toEqual({ stock: 9, reason: 'shelf count', expected: { erpStock: 12, catalogueStock: 5 } });

    fireEvent.click(await screen.findByRole('button', { name: 'Reset to ERP (12)' }));
    await waitFor(() => expect(app.showToast).toHaveBeenCalledWith('The catalogue stock follows the ERP again', 'success'));
    expect(String(calls((u, m) => m === 'DELETE')[0][0])).toBe(`${stockUrl}?expectedErpStock=12&expectedCatalogueStock=9`);
  });

  it('checks the value before sending; shows 400 field messages and 403 in words', async () => {
    perms.add('catalogue.stock_edit');
    let puts = 0;
    handler = (u, i) => {
      if (u === stockUrl && method(i) === 'GET') return ok(stock());
      if (u === stockUrl && method(i) === 'PUT') return ++puts === 1 ? fail(400, 'Validation failed', [{ path: 'reason', message: 'Too long' }]) : fail(403, 'Forbidden');
      return undefined;
    };
    renderUi(<ProductStockPanel product={PRODUCT} />);
    fireEvent.change(await screen.findByLabelText('Catalogue stock'), { target: { value: '-3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stock' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a whole number of 0 or more');
    expect(calls((u, m) => m === 'PUT')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Catalogue stock'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stock' }));
    expect(await screen.findByText('Too long')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save stock' }));
    expect(await screen.findByText(/do not have permission to change the catalogue stock/)).toBeTruthy();
  });

  it('a 409 reloads and shows the newer values with a plain message', async () => {
    perms.add('catalogue.stock_edit');
    let gets = 0;
    handler = (u, i) => {
      if (u === stockUrl && method(i) === 'GET') return ok(++gets === 1 ? stock() : stock({ erpStock: 20, catalogueStock: 7, edit: { ...stock().edit!, stock: 7, setBy: { id: 'u2', name: 'Sara' }, updatedAt: '2026-11-06T08:00:00.000Z' } }));
      if (u === stockUrl && method(i) === 'PUT') return fail(409, 'The stock changed since you loaded it; reload the product and try again');
      return undefined;
    };
    renderUi(<ProductStockPanel product={PRODUCT} />);
    fireEvent.change(await screen.findByLabelText('Catalogue stock'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save stock' }));
    expect((await screen.findByTestId('stock-stale')).textContent).toContain('Someone changed this stock after you opened it');
    await waitFor(() => expect(screen.getByTestId('erp-stock').textContent).toBe('20'));
    expect(screen.getByTestId('catalogue-stock').textContent).toBe('7');
    expect(screen.getByTestId('stock-origin').textContent).toContain('Sara');
    expect(screen.getByTestId('stock-stale')).toBeTruthy(); // still there after the reload
  });

  it('a conflict banner offers Use ERP / Keep mine with the conflict values', async () => {
    perms.add('catalogue.stock_edit');
    const inConflict = stock({ conflict: { ownerStock: 5, erpStock: 12, erpStockAtEdit: 8, inEffect: 'owner' }, edit: { ...stock().edit!, erpStockAtEdit: 8, state: 'conflict' } });
    let current = inConflict;
    handler = (u, i) => {
      if (u === stockUrl && method(i) === 'GET') return ok(current);
      if (u === `${stockUrl}/resolve`) { current = stock({ catalogueStock: 12, source: 'erp', edit: null }); return ok(current); }
      return undefined;
    };
    renderUi(<ProductStockPanel product={PRODUCT} />);
    const banner = await screen.findByTestId('stock-conflict');
    expect(banner.textContent).toContain('changed from 8 to 12 after you set 5');
    expect(banner.textContent).toContain('Your value (5) stays in effect until you choose');
    fireEvent.click(within(banner).getByRole('button', { name: 'Use ERP (12)' }));
    await waitFor(() => expect(app.showToast).toHaveBeenCalledWith('Conflict resolved: the catalogue stock follows the ERP', 'success'));
    expect(bodyOf(calls(u => u.endsWith('/resolve'))[0])).toEqual({ choice: 'erp', expected: { erpStock: 12, ownerStock: 5 } });
    await waitFor(() => expect(screen.queryByTestId('stock-conflict')).toBeNull());
  });

  it('says stock never makes an inactive, ERP-inactive or missing product available', async () => {
    handler = (u, i) => (u === stockUrl && method(i) === 'GET' ? ok(stock()) : undefined);
    renderUi(<ProductStockPanel product={{ ...PRODUCT, status: 'inactive', erpActive: false, inLatestErpFile: false }} />);
    expect((await screen.findByTestId('stock-availability')).textContent)
      .toBe('Stock never makes this product available: it is inactive in Qorloop, and it is inactive in the ERP, and it is missing from the latest ERP file. It stays unavailable on every marketplace whatever the stock.');
  });
});

// ───────── Dashboard badge ─────────

describe('dashboard stock conflicts badge', () => {
  beforeEach(() => { vi.stubEnv('VITE_REAL_RECON', 'true'); perms.add('recon.view'); });
  const summary = (stockConflicts: number) => ({ reference: 'marketplace', computedAt: '2026-11-06T05:00:00.000Z', stockConflicts, marketplaces: [] });

  it('shows "N stock conflicts" from the recon summary, linking to the page', async () => {
    handler = u => (u.startsWith('/api/recon/summary') ? ok(summary(3)) : undefined);
    renderUi(<DashboardView />);
    expect((await screen.findByTestId('stock-conflicts-badge')).textContent).toBe('3 stock conflicts');
    expect(screen.getByRole('link', { name: '3 stock conflicts, review them' }).getAttribute('href')).toBe('/catalogue/stock-conflicts');
  });

  it('hidden at 0; without the real catalogue it is shown without a link', async () => {
    handler = u => (u.startsWith('/api/recon/summary') ? ok(summary(0)) : undefined);
    const { unmount } = renderUi(<DashboardView />);
    await screen.findByText('No comparison yet');
    expect(screen.queryByTestId('stock-conflicts-badge')).toBeNull();
    unmount();

    vi.stubEnv('VITE_REAL_CATALOGUE', '');
    handler = u => (u.startsWith('/api/recon/summary') ? ok(summary(1)) : undefined);
    renderUi(<DashboardView />);
    expect((await screen.findByTestId('stock-conflicts-badge')).textContent).toBe('1 stock conflict');
    expect(screen.queryByRole('link', { name: /stock conflict/ })).toBeNull();
  });
});
