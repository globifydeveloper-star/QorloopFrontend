// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReconMarketplaceSummary, ReconRow, ReconSummary } from '../../../api/recon';
import type { ProductDetail } from '../../../api/products';
import type { InlinePricing, PriceChainStep } from '../../../api/pricing';
import type { ProductStock } from '../../../api/stock';
import { REAL_FLAGS } from '../../../../vitest.setup';

// Read before this file's beforeEach turns VITE_REAL_RECON on: the global setup must have switched every flag off.
const FLAGS_AT_LOAD = REAL_FLAGS.map(f => import.meta.env[f]);

const perms = new Set<string>();
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ can: (p: string) => perms.has(p) }) }));
const app = { showToast: vi.fn(), openUploadModal: vi.fn(), navigate: vi.fn(), compareReference: 'marketplace', setCompareReference: vi.fn() };
vi.mock('../../../context/AppContext', () => ({ useApp: () => app }));

import { DashboardView } from '../../views/DashboardView';
import { StockMismatchesView } from '../../views/StockMismatchesView';
import { PriceDiscrepanciesView } from '../../views/PriceDiscrepanciesView';
import { reconTiming } from '../shared';
import { STALE_STOCK } from '../../stock/stockLogic';

// ───────── Backend fakes in the documented shapes ─────────

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json(200, { data });
const fail = (status: number, message: string, details?: unknown[]) => json(status, { error: { code: 'E', message, details } });

const COMPUTED = '2026-11-02T08:00:00.000Z';
const LATER = '2026-11-02T08:05:00.000Z';
const UPLOADED = '2026-11-01T18:00:00.000Z';
const NOW = new Date('2026-11-02T09:00:00.000Z');

const mp = (marketplaceId: ReconMarketplaceSummary['marketplaceId'], over: Partial<ReconMarketplaceSummary> = {}): ReconMarketplaceSummary => ({
  marketplaceId, hasData: true, stock: 3, price: 1, total: 4, listed: 10, notListed: 0, noData: 0, missingFromErp: 0, newCount: 0,
  lastUploadAt: UPLOADED, stale: false, ...over,
});
const row = (id: string, over: Partial<ReconRow> = {}): ReconRow => ({
  productId: id, barcode: `6281000${id}`, sku: null, nameEn: `Product ${id}`, nameAr: null, productStatus: 'active', erpStock: 0,
  catalogueStock: 0, catalogueStockSource: 'erp', stockConflict: false, catalogueAvailable: false,
  status: 'mismatch', stockIssue: 'available_but_out_of_stock', priceMismatch: false, priceMismatchVsErp: false, priceMismatchVsMarketplace: false,
  expectedPrice: 12.5, erpPrice: 11, marketplacePrice: 12.5, marketplacePriceSource: 'category', actualPrice: 12.5,
  erpAvailable: false, actualAvailable: true, lastUpdated: '2026-11-01T18:30:00.000Z', ...over,
});
const STOCK_ROWS = [
  row('1'),
  row('2', { stockIssue: 'unavailable_but_in_stock', erpStock: 14, catalogueStock: 14, catalogueAvailable: true, erpAvailable: true, actualAvailable: false }),
  row('3'),
];
const PRICE_ROWS = [row('4', { stockIssue: null, priceMismatch: true, actualPrice: 13.75, expectedPrice: 12.5 }), row('5', { stockIssue: null, priceMismatch: true, actualPrice: 9 })];

const chain: PriceChainStep[] = [
  { source: 'offer', status: 'not_set' }, { source: 'product', status: 'not_set' }, { source: 'subcategory', status: 'not_set' },
  { source: 'category', status: 'applied', price: 12.5, rule: { mode: 'percent', value: 15 } }, { source: 'marketplace', status: 'disabled' },
  { source: 'default', status: 'overridden', price: 11, rule: { mode: 'same' } },
];
const detail = (id: string, over: Partial<ProductDetail> = {}): ProductDetail => ({
  id, barcode: `6281000${id}`, sku: null, nameEn: `Product ${id}`, nameAr: null, brand: null, erpCategory: null, categoryId: null, subcategoryId: null,
  erpPrice: 11, erpStock: 0, status: 'active', inLatestErpFile: true, updatedAt: COMPUTED,
  size: null, erpActive: true, createdAt: COMPUTED, category: null, subcategory: null, listings: [], arabicNameMissing: false, categoryMissing: false,
  marketplacePrice: { price: 12.5, source: 'category' },
  pricing: { order: ['offer', 'product', 'subcategory', 'category', 'marketplace', 'default'], productRule: null, offer: null, chain, marketplaces: [] },
  ...over,
} as ProductDetail);
const stockOf = (id: string, over: Partial<ProductStock> = {}): ProductStock => ({ productId: id, erpStock: 0, catalogueStock: 0, source: 'erp', conflict: null, edit: null, ...over });

interface Server {
  computedAt: string;
  stockRows: ReconRow[];
  stock: Record<string, ProductStock>;
  products: Record<string, ProductDetail>;
  /** Next answer of a write, when set. */
  writeAnswer?: () => Response;
}
let srv: Server;
let fetchMock: ReturnType<typeof vi.fn>;
const method = (i?: RequestInit) => i?.method ?? 'GET';
const calls = (pred: (url: string, m: string) => boolean) => fetchMock.mock.calls.filter(([u, i]) => pred(String(u), method(i as RequestInit)));
const bodyOf = (c: unknown[]) => JSON.parse(String((c[1] as RequestInit).body));
const path = (u: string) => u.split('?')[0];
const params = (u: string) => Object.fromEntries(new URL(u, 'http://x').searchParams);

function handle(u: string, i: RequestInit): Response {
  const m = method(i);
  const p = path(u);
  if (m === 'GET' && p === '/api/recon/summary') {
    const s: ReconSummary = { reference: 'marketplace', computedAt: srv.computedAt, stockConflicts: 0, marketplaces: [mp('talabat'), mp('snoonu', { stale: true })] };
    return ok(s);
  }
  if (m === 'GET' && p === '/api/recon/rows') {
    const q = params(u);
    return ok({ reference: 'marketplace', items: q.type === 'price' ? PRICE_ROWS : srv.stockRows.slice(0, Number(q.limit ?? 50)), nextCursor: null });
  }
  if (m === 'GET' && p === '/api/settings') return ok({ thresholds: { priceTolerance: 0, stockThreshold: 3, staleHours: 24 } });
  let hit = /^\/api\/products\/([^/]+)\/stock$/.exec(p);
  if (hit) {
    const id = hit[1];
    if (m === 'GET') return ok(srv.stock[id] ?? stockOf(id));
    if (srv.writeAnswer) { const r = srv.writeAnswer(); srv.writeAnswer = undefined; return r; }
    if (m === 'PUT') {
      const b = bodyOf([u, i]);
      srv.stock[id] = stockOf(id, { catalogueStock: b.stock, source: 'owner', erpStock: srv.stock[id]?.erpStock ?? 0 });
      return ok({ ...srv.stock[id], changed: true });
    }
  }
  hit = /^\/api\/products\/([^/]+)\/stock\/resolve$/.exec(p);
  if (hit && m === 'POST') {
    const b = bodyOf([u, i]);
    const prev = srv.stock[hit[1]];
    srv.stock[hit[1]] = stockOf(hit[1], { erpStock: prev.erpStock, catalogueStock: b.choice === 'erp' ? prev.erpStock : prev.conflict!.ownerStock, source: b.choice === 'erp' ? 'erp' : 'owner' });
    return ok(srv.stock[hit[1]]);
  }
  hit = /^\/api\/products\/([^/]+)$/.exec(p);
  if (hit && m === 'GET') return ok(srv.products[hit[1]] ?? detail(hit[1]));
  hit = /^\/api\/pricing\/products\/([^/]+)$/.exec(p);
  if (hit && m === 'PUT') {
    if (srv.writeAnswer) { const r = srv.writeAnswer(); srv.writeAnswer = undefined; return r; }
    const b = bodyOf([u, i]);
    const a: InlinePricing = {
      productId: hit[1], marketplaceId: b.marketplaceId, erpPrice: 11, previous: { price: 12.5, source: 'category' }, resolved: { price: b.value, source: 'product' },
      rule: { mode: 'fixed', value: b.value, updatedAt: LATER }, chain, changed: true,
      marketplaces: [{ marketplaceId: 'talabat', price: b.value, source: 'product' }],
    } as InlinePricing;
    srv.products[hit[1]] = detail(hit[1], { pricing: { ...detail(hit[1]).pricing!, productRule: { mode: 'fixed', value: b.value, updatedAt: LATER } } });
    return ok(a);
  }
  return fail(404, 'not mocked');
}

const Where = () => { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search}</output>; };
function renderAt(at: string, ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}><Routes><Route path="*" element={<>{ui}<Where /></>} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
  const invalidated = () => spy.mock.calls.map(c => JSON.stringify((c[0] as { queryKey?: unknown })?.queryKey));
  return { qc, invalidated };
}

const EDITOR = ['recon.view', 'reports.view', 'products.view', 'catalogue.stock_edit', 'pricing.view', 'pricing.edit', 'pricing.bulk', 'settings.view'];
const ANALYST = ['recon.view', 'reports.view', 'products.view', 'pricing.view', 'settings.view'];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('VITE_REAL_RECON', 'true');
  vi.stubEnv('VITE_REAL_CATALOGUE', 'true');
  perms.clear();
  EDITOR.forEach(p => perms.add(p));
  app.showToast.mockClear();
  reconTiming.pollMs = 20;
  reconTiming.timeoutMs = 120_000;
  srv = { computedAt: COMPUTED, stockRows: [...STOCK_ROWS], stock: {}, products: {} };
  fetchMock = vi.fn(async (u: string, i: RequestInit = {}) => handle(String(u), i));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); reconTiming.pollMs = 3_000; });

const dialog = () => within(screen.getByRole('dialog'));
const fixIt = () => within(screen.getByRole('region', { name: 'Fix it' }));
const differs = () => within(screen.getByRole('region', { name: 'What differs' }));
const openFromStockReport = async (name = 'Product 1') => {
  renderAt('/reports/stock?marketplace=talabat', <StockMismatchesView />);
  fireEvent.click(await screen.findByRole('button', { name: `Edit ${name}` }));
  await screen.findByRole('dialog', { name });
};
const stockForm = async () => within(await screen.findByRole('form', { name: 'Edit catalogue stock' }));

describe('quick edit drawer', () => {
  it('runs with every VITE_REAL_* flag off from the global setup', () => {
    expect(FLAGS_AT_LOAD).toEqual(REAL_FLAGS.map(() => ''));
  });

  it('opens from a Dashboard "Needs attention" row with the stock sections; Esc closes and focus returns to the row', async () => {
    renderAt('/', <DashboardView />);
    const card = within(await screen.findByRole('region', { name: 'Needs attention on Talabat' }));
    const edit = await card.findByRole('button', { name: 'Edit Product 1' });
    // A click on the row itself opens it too; the product link inside the row does not.
    fireEvent.click(card.getAllByTestId('attention-row')[1]);
    expect(await screen.findByRole('dialog', { name: 'Product 2' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    edit.focus();
    fireEvent.click(edit);
    const d = await screen.findByRole('dialog', { name: 'Product 1' });
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(within(d).getByRole('heading', { level: 2, name: 'Product 1' }));
    expect(dialog().getByText(/62810001/)).toBeTruthy();
    expect(dialog().getByText(/Talabat · Stock difference/)).toBeTruthy();
    expect(dialog().getByRole('link', { name: /Open full product page/ }).getAttribute('href')).toBe('/catalogue/1');
    expect(screen.getByTestId('drawer-position').textContent).toBe('1 of 3');

    expect(differs().getByTestId('stock-issue').textContent).toBe('Available but out of stock');
    expect(differs().getByTestId('stock-reason').textContent).toContain('you do not have the stock to deliver it');
    expect(differs().getByTestId('marketplace-available').textContent).toBe('Available');
    expect(differs().getByTestId('qorloop-available').textContent).toBe('Unavailable');
    expect(differs().getByText('01 Nov 2026, 21:00 (Qatar time)')).toBeTruthy();
    expect(differs().getByTestId('file-age').textContent).toBe('Talabat data is 15 hours old');
    expect(await differs().findByTestId('stock-threshold')).toBeTruthy();
    expect(differs().getByTestId('stock-threshold').textContent).toBe('3');
    expect(fixIt().getByText(/applies to every marketplace\. Marketplace files carry available or unavailable, not stock quantities/)).toBeTruthy();
    expect(await stockForm()).toBeTruthy();
    expect(fixIt().getByTestId('stock-availability')).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(card.getByRole('button', { name: 'Edit Product 1' }));
    expect(screen.getByTestId('where').textContent).toBe('/');
  });

  it('opens from a stock report row click and moves with Previous / Next and J / K, staying in the list', async () => {
    renderAt('/reports/stock?marketplace=talabat', <StockMismatchesView />);
    fireEvent.click((await screen.findByText('Product 2')).closest('tr')!);
    await screen.findByRole('dialog', { name: 'Product 2' });
    expect(screen.getByTestId('drawer-position').textContent).toBe('2 of 3');
    expect(differs().getByTestId('stock-issue').textContent).toBe('Lost sales');

    fireEvent.click(dialog().getByRole('button', { name: /Next/ }));
    expect(await screen.findByRole('dialog', { name: 'Product 3' })).toBeTruthy();
    expect(dialog().getByRole('button', { name: /Next/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'k' });
    expect(await screen.findByRole('dialog', { name: 'Product 2' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'K' });
    expect(await screen.findByRole('dialog', { name: 'Product 1' })).toBeTruthy();
    expect(dialog().getByRole('button', { name: /Previous/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'j' });
    expect(await screen.findByRole('dialog', { name: 'Product 2' })).toBeTruthy();

    // J typed in a field is text, not a shortcut.
    const input = (await stockForm()).getByLabelText('Reason (optional)');
    fireEvent.keyDown(input, { key: 'j' });
    expect(screen.getByRole('dialog', { name: 'Product 2' })).toBeTruthy();
    // The list filter and the page stay as they were.
    expect(screen.getByTestId('where').textContent).toBe('/reports/stock?marketplace=talabat');

    fireEvent.click(dialog().getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit Product 2' }));
  });

  it('opens from a price report row with the price sections and the editor on that marketplace', async () => {
    renderAt('/reports/price?marketplace=snoonu', <PriceDiscrepanciesView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Product 4' }));
    await screen.findByRole('dialog', { name: 'Product 4' });
    expect(dialog().getByText(/Snoonu · Price difference/)).toBeTruthy();
    expect(differs().getByTestId('qe-actual').textContent).toBe('13.75 QAR');
    expect(differs().getByTestId('qe-expected').textContent).toBe('12.50 QAR');
    expect(differs().getByTestId('qe-difference').textContent).toBe('+1.25 QAR');
    expect(differs().getByTestId('qe-source').textContent).toBe('Category rule');
    expect(await differs().findByRole('region', { name: 'Which rule produced the expected price' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Stock' })).toBeNull();

    const form = within(await screen.findByRole('form', { name: 'Change the price' }));
    await waitFor(() => expect((form.getByLabelText('Marketplace') as HTMLSelectElement).value).toBe('snoonu'));
    expect(form.getByRole('note', { name: 'Applies to all marketplaces' }).textContent).toContain('ALL marketplaces');
    expect(fixIt().getByRole('link', { name: 'Set or change an offer on the full product page' }).getAttribute('href')).toBe('/catalogue/4');
    expect(fixIt().getByRole('link', { name: 'Change many prices at once in the Catalogue' }).getAttribute('href')).toBe('/catalogue');
    expect(screen.getByTestId('drawer-position').textContent).toBe('1 of 2');
  });

  it('a stock save shows "Saved. The comparison is updating…" until the recompute lands, refreshes the queries, and keeps the row until then', async () => {
    const { invalidated } = renderAt('/reports/stock?marketplace=talabat', <StockMismatchesView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Product 1' }));
    const form = await stockForm();
    fireEvent.change(form.getByLabelText('Catalogue stock'), { target: { value: '0' } });
    fireEvent.change(form.getByLabelText('Catalogue stock'), { target: { value: '12' } });
    fireEvent.change(form.getByLabelText('Reason (optional)'), { target: { value: 'counted' } });
    fireEvent.click(form.getByRole('button', { name: 'Save stock' }));

    expect((await screen.findByTestId('quick-edit-status')).textContent).toBe('Saved. The comparison is updating…');
    const put = calls((u, m) => m === 'PUT' && path(u) === '/api/products/1/stock');
    expect(bodyOf(put[0])).toEqual({ stock: 12, reason: 'counted', expected: { erpStock: 0, catalogueStock: 0 } });
    for (const key of [['stock'], ['products'], ['recon', 'summary'], ['recon', 'rows'], ['activity']]) expect(invalidated()).toContain(JSON.stringify(key));

    // Still pending: the row stays in the list and in the drawer's count.
    expect(screen.getByRole('button', { name: 'Edit Product 1' })).toBeTruthy();
    expect(screen.getByTestId('drawer-position').textContent).toBe('1 of 3');

    // The recompute lands: the summary moves on, the rows refetch without the fixed product.
    const summaries = calls((u, m) => m === 'GET' && path(u) === '/api/recon/summary').length;
    srv.stockRows = STOCK_ROWS.slice(1);
    srv.computedAt = LATER;
    await waitFor(() => expect(screen.getByTestId('quick-edit-status').textContent).toBe('Saved. The comparison is up to date.'));
    expect(calls((u, m) => m === 'GET' && path(u) === '/api/recon/summary').length).toBeGreaterThan(summaries);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit Product 1' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Product 1' })).toBeTruthy();
    expect(screen.getByTestId('drawer-position').textContent).toBe('No longer in this list: the comparison says it is fixed');
    fireEvent.click(dialog().getByRole('button', { name: /Next/ }));
    expect(await screen.findByRole('dialog', { name: 'Product 2' })).toBeTruthy();
  });

  it('stock 409 reloads and shows the newer values; 400 and 403 in plain words', async () => {
    await openFromStockReport();
    let form = await stockForm();
    srv.stock['1'] = stockOf('1', { erpStock: 6, catalogueStock: 6 });
    srv.writeAnswer = () => fail(409, 'Conflict');
    fireEvent.change(form.getByLabelText('Catalogue stock'), { target: { value: '4' } });
    fireEvent.click(form.getByRole('button', { name: 'Save stock' }));
    expect((await screen.findByTestId('stock-stale')).textContent).toBe(STALE_STOCK);
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Stock' })).getByTestId('erp-stock').textContent).toBe('6'));

    form = await stockForm();
    srv.writeAnswer = () => fail(400, 'Validation failed', [{ path: 'stock', message: 'Stock must be a whole number' }]);
    fireEvent.change(form.getByLabelText('Catalogue stock'), { target: { value: '5' } });
    fireEvent.click(form.getByRole('button', { name: 'Save stock' }));
    expect(await screen.findByText('Stock must be a whole number')).toBeTruthy();

    srv.writeAnswer = () => fail(403, 'Forbidden');
    fireEvent.click(form.getByRole('button', { name: 'Save stock' }));
    expect(await screen.findByText('You do not have permission to change the catalogue stock. Ask your store Owner or an Admin.')).toBeTruthy();
    expect(screen.queryByTestId('quick-edit-status')).toBeNull();
  });

  it('price 409 reloads and shows the newer value; 400 and 403 in plain words; a save shows the status line', async () => {
    renderAt('/reports/price?marketplace=talabat', <PriceDiscrepanciesView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Product 4' }));
    const form = within(await screen.findByRole('form', { name: 'Change the price' }));
    await waitFor(() => expect((form.getByLabelText('Marketplace') as HTMLSelectElement).value).toBe('talabat'));

    srv.products['4'] = detail('4', { pricing: { ...detail('4').pricing!, productRule: { mode: 'fixed', value: 14, updatedAt: '2026-11-02T07:00:00.000Z' } } });
    srv.writeAnswer = () => fail(409, 'This price was changed by someone else; reload it and try again');
    fireEvent.change(form.getByLabelText('New price (QAR)'), { target: { value: '12.5' } });
    fireEvent.click(form.getByRole('button', { name: 'Save price' }));
    expect(await screen.findByText(/Someone else changed this price after you opened it/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('inline-newer').textContent).toContain('Fixed 14.00 QAR'));

    srv.writeAnswer = () => fail(400, 'Validation failed', [{ path: 'value', message: 'Enter a price above 0' }]);
    fireEvent.click(form.getByRole('button', { name: 'Save price' }));
    expect(await screen.findByText('Enter a price above 0')).toBeTruthy();

    srv.writeAnswer = () => fail(403, 'Forbidden');
    fireEvent.click(form.getByRole('button', { name: 'Save price' }));
    expect(await screen.findByText('You do not have permission to change prices.')).toBeTruthy();

    fireEvent.change(form.getByLabelText('New price (QAR)'), { target: { value: '12.5' } });
    fireEvent.click(form.getByRole('button', { name: 'Save price' }));
    expect((await screen.findByTestId('quick-edit-status')).textContent).toBe('Saved. The comparison is updating…');
  });

  it('shows the conflict banner; Use ERP and Keep mine resolve it with the values shown', async () => {
    srv.stock['1'] = stockOf('1', { erpStock: 12, catalogueStock: 5, source: 'owner', conflict: { ownerStock: 5, erpStock: 12, erpStockAtEdit: 8, inEffect: 'owner' } });
    await openFromStockReport();
    const banner = within(await screen.findByTestId('stock-conflict'));
    fireEvent.click(banner.getByRole('button', { name: 'Keep mine (5)' }));
    await waitFor(() => expect(calls((u, m) => m === 'POST' && path(u) === '/api/products/1/stock/resolve')).toHaveLength(1));
    expect(bodyOf(calls((u, m) => m === 'POST' && path(u) === '/api/products/1/stock/resolve')[0])).toEqual({ choice: 'keep', expected: { erpStock: 12, ownerStock: 5 } });
    expect(await screen.findByTestId('quick-edit-status')).toBeTruthy();
    cleanup();

    srv.stock['1'] = stockOf('1', { erpStock: 12, catalogueStock: 5, source: 'owner', conflict: { ownerStock: 5, erpStock: 12, erpStockAtEdit: 8, inEffect: 'owner' } });
    await openFromStockReport();
    fireEvent.click(within(await screen.findByTestId('stock-conflict')).getByRole('button', { name: 'Use ERP (12)' }));
    await waitFor(() => expect(bodyOf(calls((u, m) => m === 'POST' && path(u) === '/api/products/1/stock/resolve').at(-1)!).choice).toBe('erp'));
    await waitFor(() => expect(screen.queryByTestId('stock-conflict')).toBeNull());
  });

  it('asks "Discard changes?" before Esc, Close, the backdrop or Next throws away an unsaved edit', async () => {
    await openFromStockReport();
    const form = await stockForm();
    fireEvent.change(form.getByLabelText('Catalogue stock'), { target: { value: '9' } });

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    let confirm = screen.getByRole('alertdialog', { name: 'Discard changes?' });
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Keep editing' }));
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(((await stockForm()).getByLabelText('Catalogue stock') as HTMLInputElement).value).toBe('9');

    fireEvent.click(dialog().getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('alertdialog', { name: 'Discard changes?' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); // Esc on the question = keep editing
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Product 1' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('drawer-backdrop'));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

    fireEvent.click(dialog().getByRole('button', { name: /Next/ }));
    confirm = screen.getByRole('alertdialog', { name: 'Discard changes?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByRole('dialog', { name: 'Product 2' })).toBeTruthy();
    // The next product starts clean: leaving asks nothing.
    await stockForm();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('traps focus inside the drawer', async () => {
    await openFromStockReport();
    await stockForm();
    const d = screen.getByRole('dialog');
    const focusables = [...d.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])')];
    focusables.at(-1)!.focus();
    fireEvent.keyDown(d, { key: 'Tab' });
    expect(document.activeElement).toBe(focusables[0]);
    focusables[0].focus();
    fireEvent.keyDown(d, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(focusables.at(-1));
  });

  it('is read-only with a short explanation for roles without catalogue.stock_edit or pricing.edit', async () => {
    perms.clear();
    ANALYST.forEach(p => perms.add(p));
    srv.stock['1'] = stockOf('1', { erpStock: 12, catalogueStock: 5, source: 'owner', conflict: { ownerStock: 5, erpStock: 12, erpStockAtEdit: 8, inEffect: 'owner' } });
    await openFromStockReport();
    expect(fixIt().getByTestId('read-only').textContent).toContain('can see the stock but not change it');
    await screen.findByTestId('stock-conflict');
    expect(screen.queryByRole('form', { name: 'Edit catalogue stock' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Use ERP|Keep mine|Save stock|Reset to ERP/ })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Stock' })).getByTestId('catalogue-stock').textContent).toBe('5');
    cleanup();

    renderAt('/reports/price?marketplace=talabat', <PriceDiscrepanciesView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Product 4' }));
    await screen.findByRole('dialog', { name: 'Product 4' });
    expect(fixIt().getByTestId('read-only').textContent).toContain('can see prices but not change them');
    expect(screen.queryByRole('form', { name: 'Change the price' })).toBeNull();
    expect(fixIt().queryByRole('link', { name: /Change many prices/ })).toBeNull();
    expect(differs().getByTestId('qe-expected').textContent).toBe('12.50 QAR');
  });

  it('slides in with CSS that is switched off for reduced motion, and keeps a named slot for the export value', async () => {
    await openFromStockReport();
    expect(screen.getByRole('dialog').className).toContain('q-drawer');
    expect(screen.getByRole('dialog').className).toContain('sm:w-[480px]');
    const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.q-drawer, \.q-drawer-backdrop \{ animation: none; \}/);
    expect(document.querySelector('[data-slot="marketplace-export-value"]')).toBeNull();
  });
});
