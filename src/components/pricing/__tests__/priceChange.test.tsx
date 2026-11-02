// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ProductDetail, ProductItem, TabCounts } from '../../../api/products';
import type { BulkApplyResult, BulkPreview, InlinePricing, PriceChainStep, PriceRule } from '../../../api/pricing';
import type { ReconMarketplaceSummary, ReconSummary } from '../../../api/recon';

const perms = new Set<string>();
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ can: (p: string) => perms.has(p) }) }));
const app = { showToast: vi.fn(), openUploadModal: vi.fn(), navigate: vi.fn() };
vi.mock('../../../context/AppContext', () => ({ useApp: () => app }));

import { CatalogueView } from '../../views/CatalogueView';
import { ProductDetailView } from '../../views/ProductDetailView';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json(200, { data });
const fail = (status: number, message: string, details?: unknown[]) =>
  json(status, { error: { code: status === 409 ? 'CONFLICT' : status === 400 ? 'VALIDATION_ERROR' : 'E', message, ...(details ? { details } : {}) }, requestId: 'req-1' });

type Handler = (url: string, init: RequestInit) => Response | Promise<Response | undefined> | undefined;
let handler: Handler;
let fetchMock: ReturnType<typeof vi.fn>;
const method = (i?: RequestInit) => i?.method ?? 'GET';
const is = (m: string, path: string) => (u: string, mm: string) => mm === m && u.split('?')[0] === path;
const isList = (u: string, m: string) => m === 'GET' && u.startsWith('/api/products?');
const calls = (pred: (url: string, method: string) => boolean) => fetchMock.mock.calls.filter(([u, i]) => pred(String(u), method(i as RequestInit | undefined)));
const bodyOf = (c: unknown[]) => JSON.parse(String((c[1] as RequestInit).body));
const params = (u: string) => Object.fromEntries(new URL(u, 'http://x').searchParams);
const errorOf = (el: HTMLElement) => {
  const id = el.getAttribute('aria-describedby');
  return id ? document.getElementById(id)?.textContent : undefined;
};

// ───────── Fixtures in the backend's shapes ─────────

const V1 = '2026-11-01T18:30:00.000Z';
const V2 = '2026-11-02T06:00:00.000Z';
const V3 = '2026-11-02T06:05:00.000Z';

const summaryRow = (marketplaceId: ReconMarketplaceSummary['marketplaceId']): ReconMarketplaceSummary => ({
  marketplaceId, hasData: true, stock: 0, price: 0, total: 0, listed: 3, notListed: 0, noData: 0, missingFromErp: 0, newCount: 0, lastUploadAt: V1, stale: false,
});
const SUMMARY: ReconSummary = { reference: 'marketplace', computedAt: V1, marketplaces: [summaryRow('talabat'), summaryRow('snoonu'), summaryRow('keeta')] };

const chain = (rule: PriceRule | null, price: number): PriceChainStep[] => [
  { source: 'offer', status: 'not_set' },
  rule ? { source: 'product', status: 'applied', price, rule } : { source: 'product', status: 'not_set' },
  { source: 'subcategory', status: 'not_set' },
  { source: 'category', status: 'not_set' },
  { source: 'marketplace', status: 'disabled' },
  { source: 'default', status: rule ? 'overridden' : 'applied', price: 10, rule: { mode: 'same' } },
];

const item = (id: string, over: Partial<ProductItem> = {}): ProductItem => ({
  id, barcode: `62810000${id}`, sku: null, nameEn: `Product ${id}`, nameAr: 'منتج', brand: null, erpCategory: null,
  categoryId: null, subcategoryId: null, erpPrice: 10, erpStock: 5, status: 'active', inLatestErpFile: true, updatedAt: V1,
  marketplacePrice: { price: 11, source: 'product' }, ...over,
});
type Rule = (PriceRule & { updatedAt: string }) | null;
const detail = (id: string, rule: Rule, price: number, over: Partial<ProductDetail> = {}): ProductDetail => ({
  ...item(id), size: null, erpActive: true, createdAt: V1, category: null, subcategory: null, listings: [],
  marketplacePrice: { price, source: rule ? 'product' : 'default' },
  pricing: { order: ['offer', 'product', 'subcategory', 'category', 'marketplace', 'default'], productRule: rule, offer: null, chain: chain(rule, price), marketplaces: [] },
  ...over,
});
const answer = (id: string, marketplaceId: InlinePricing['marketplaceId'], rule: Rule, price: number, previous: number, changed = true): InlinePricing => ({
  productId: id, marketplaceId, erpPrice: 10,
  previous: { price: previous, source: 'product' }, resolved: { price, source: rule ? 'product' : 'default' },
  rule, chain: chain(rule, price), changed,
  marketplaces: (['talabat', 'snoonu', 'keeta'] as const).map(m => ({ marketplaceId: m, price, source: rule ? 'product' as const : 'default' as const })),
});
const list = (items: ProductItem[], counts: Partial<TabCounts> = {}) =>
  ok({ items, nextCursor: null, counts: { all: items.length, active: items.length, inactive: 0, new: 0, missing: 0, ...counts } });

/**
 * A small fake of the inline endpoints over one product: the rule version check as checkRuleVersion does it, the rule
 * written on PUT and removed on DELETE, and the product detail reading it back.
 */
function inlineServer(start: Rule = { mode: 'percent', value: 10, updatedAt: V1 }, startPrice = 11) {
  const s = { rule: start, price: startPrice, versions: [V2, V3, '2026-11-02T06:10:00.000Z'], status: 'active' as ProductItem['status'] };
  const h: Handler = (u, i) => {
    const m = method(i);
    if (is('GET', '/api/recon/summary')(u, m)) return ok(SUMMARY);
    if (is('GET', '/api/products/p1')(u, m)) return ok(detail('p1', s.rule, s.price, { status: s.status }));
    if (is('PUT', '/api/pricing/products/p1')(u, m)) {
      const b = bodyOf([u, i]);
      if (b.expectedRuleUpdatedAt !== undefined && b.expectedRuleUpdatedAt !== (s.rule?.updatedAt ?? null)) return fail(409, 'This price was changed by someone else; reload it and try again');
      const previous = s.price;
      s.rule = { mode: b.mode, value: b.value, updatedAt: s.versions.shift()! };
      s.price = b.mode === 'fixed' ? b.value : 10 * (100 + b.value) / 100;
      return ok(answer('p1', b.marketplaceId, s.rule, s.price, previous));
    }
    if (is('DELETE', '/api/pricing/products/p1')(u, m)) {
      const q = params(u);
      if (q.expectedRuleUpdatedAt !== undefined && q.expectedRuleUpdatedAt !== s.rule?.updatedAt) return fail(409, 'This price was changed by someone else; reload it and try again');
      const previous = s.price;
      const changed = s.rule !== null;
      s.rule = null;
      s.price = 10;
      return ok(answer('p1', q.marketplaceId as InlinePricing['marketplaceId'], null, 10, previous, changed));
    }
    return undefined;
  };
  return { s, h };
}

function renderAt(path: string, ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={ui} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_REAL_PRICING', 'true');
  vi.stubEnv('VITE_REAL_CATALOGUE', 'true');
  perms.clear();
  ['products.view', 'products.edit', 'pricing.view', 'pricing.edit', 'pricing.bulk', 'recon.view'].forEach(p => perms.add(p));
  app.showToast.mockClear();
  handler = () => undefined;
  fetchMock = vi.fn(async (u: string, i: RequestInit = {}) => (await handler(String(u), i)) ?? fail(404, 'not mocked'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const editorForm = () => screen.findByRole('form', { name: 'Change the price' });

// ───────── Inline edit ─────────

describe('inline price edit on product detail', () => {
  it('says the price applies to ALL marketplaces, saves a fixed price for a marketplace and shows the result', async () => {
    const { h } = inlineServer();
    handler = h;
    renderAt('/catalogue/p1', <ProductDetailView />);
    const form = within(await editorForm());
    expect(form.getByTestId('inline-current').textContent).toContain('Product price rule now: +10 % of ERP price.');
    const note = form.getByRole('note', { name: 'Applies to all marketplaces' });
    expect(note.textContent).toContain('This price applies to ALL marketplaces for this product');
    await waitFor(() => expect(note.textContent).toContain('Talabat, Snoonu and Keeta all use it'));
    // The editor starts from the product's own rule.
    expect((form.getByLabelText('Percent over the ERP price') as HTMLInputElement).checked).toBe(true);
    expect((form.getByLabelText('Percent over ERP price (%)') as HTMLInputElement).value).toBe('10');
    expect((form.getByLabelText('Marketplace') as HTMLSelectElement).value).toBe('talabat');

    fireEvent.change(form.getByLabelText('Marketplace'), { target: { value: 'snoonu' } });
    fireEvent.click(form.getByLabelText('Fixed price'));
    fireEvent.change(form.getByLabelText('New price (QAR)'), { target: { value: '' } });
    fireEvent.click(form.getByRole('button', { name: 'Save price' }));
    expect(errorOf(form.getByLabelText('New price (QAR)'))).toBe('Enter a price');
    fireEvent.change(form.getByLabelText('New price (QAR)'), { target: { value: '100001' } });
    fireEvent.click(form.getByRole('button', { name: 'Save price' }));
    expect(errorOf(form.getByLabelText('New price (QAR)'))).toBe('Enter a price above 0 and at most 100,000 QAR');
    expect(calls(is('PUT', '/api/pricing/products/p1'))).toHaveLength(0);

    const productReads = calls(is('GET', '/api/products/p1')).length;
    fireEvent.change(form.getByLabelText('New price (QAR)'), { target: { value: '12.5' } });
    fireEvent.click(form.getByRole('button', { name: 'Save price' }));
    const result = within(await screen.findByRole('region', { name: 'Price change result' }));
    expect(bodyOf(calls(is('PUT', '/api/pricing/products/p1'))[0])).toEqual({ marketplaceId: 'snoonu', mode: 'fixed', value: 12.5, expectedRuleUpdatedAt: V1 });
    expect(result.getByTestId('inline-result').textContent).toBe('Price saved. Snoonu: 12.50 QAR (was 11.00 QAR).');
    expect(within(result.getByRole('list', { name: 'Price on each marketplace' })).getAllByTestId('marketplace-price-row').map(li => li.textContent))
      .toEqual(['Talabat12.50QARProduct rule', 'Snoonu12.50QARProduct rule', 'Keeta12.50QARProduct rule']);
    const steps = within(result.getByRole('region', { name: 'Price rule chain on Snoonu' })).getAllByTestId('chain-step');
    expect(steps.map(s => s.dataset.status)).toEqual(['not_set', 'applied', 'not_set', 'not_set', 'disabled', 'overridden']);
    expect(app.showToast).toHaveBeenCalledWith('Price saved', 'success');

    // The product and the comparison are read again; the next save sends the version the server just gave.
    await waitFor(() => expect(calls(is('GET', '/api/products/p1')).length).toBeGreaterThan(productReads));
    await waitFor(() => expect(within(screen.getByRole('form', { name: 'Change the price' })).getByTestId('inline-current').textContent).toContain('Fixed 12.50 QAR'));
    fireEvent.change(form.getByLabelText('New price (QAR)'), { target: { value: '13' } });
    fireEvent.click(form.getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(calls(is('PUT', '/api/pricing/products/p1'))).toHaveLength(2));
    expect(bodyOf(calls(is('PUT', '/api/pricing/products/p1'))[1])).toMatchObject({ value: 13, expectedRuleUpdatedAt: V2 });
    await waitFor(() => expect(screen.getByTestId('inline-result').textContent).toBe('Price saved. Snoonu: 13.00 QAR (was 12.50 QAR).'));
  });

  it('409: reloads the product, shows the newer value and does not save; saving again sends the new version', async () => {
    const { s, h } = inlineServer();
    handler = h;
    renderAt('/catalogue/p1', <ProductDetailView />);
    const form = within(await editorForm());
    await waitFor(() => expect((form.getByLabelText('Marketplace') as HTMLSelectElement).value).toBe('talabat'));

    // Someone else sets a fixed 14.00 after this page loaded.
    s.rule = { mode: 'fixed', value: 14, updatedAt: '2026-11-02T05:00:00.000Z' };
    s.price = 14;
    const reads = calls(is('GET', '/api/products/p1')).length;
    fireEvent.change(form.getByLabelText('Percent over ERP price (%)'), { target: { value: '20' } });
    fireEvent.click(form.getByRole('button', { name: 'Save price' }));

    const alert = await screen.findByText(/Someone else changed this price after you opened it/);
    await waitFor(() => expect(screen.getByTestId('inline-newer').textContent).toBe('Fixed 14.00 QAR, 14.00 QAR on Talabat'));
    expect(alert.closest('[role="alert"]')!.textContent).toContain('Your change was not saved.');
    expect(calls(is('GET', '/api/products/p1')).length).toBe(reads + 1);
    expect(screen.queryByRole('region', { name: 'Price change result' })).toBeNull();
    // The draft now shows the newer value.
    expect((form.getByLabelText('Fixed price') as HTMLInputElement).checked).toBe(true);
    expect((form.getByLabelText('New price (QAR)') as HTMLInputElement).value).toBe('14');
    expect(s.rule?.value).toBe(14);

    fireEvent.change(form.getByLabelText('New price (QAR)'), { target: { value: '15' } });
    fireEvent.click(form.getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(screen.getByTestId('inline-result').textContent).toBe('Price saved. Talabat: 15.00 QAR (was 14.00 QAR).'));
    expect(bodyOf(calls(is('PUT', '/api/pricing/products/p1'))[1]).expectedRuleUpdatedAt).toBe('2026-11-02T05:00:00.000Z');
    expect(screen.queryByText(/Someone else changed this price/)).toBeNull();
  });

  it('400s in plain words: an offer, a disabled marketplace, a price out of range', async () => {
    const { h } = inlineServer();
    let reply = fail(400, 'Validation failed', [{ path: 'offer', message: 'A current offer sets this price; change or remove the offer first' }]);
    handler = (u, i) => (is('PUT', '/api/pricing/products/p1')(u, method(i)) ? reply : h(u, i));
    renderAt('/catalogue/p1', <ProductDetailView />);
    const form = within(await editorForm());
    await waitFor(() => expect((form.getByLabelText('Marketplace') as HTMLSelectElement).value).toBe('talabat'));
    fireEvent.click(form.getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(form.getByRole('alert').textContent).toBe('A current offer sets this price; change or remove the offer first'));
    expect(screen.queryByText('Validation failed')).toBeNull();

    reply = fail(400, 'Validation failed', [{ path: 'marketplaceId', message: 'Keeta is not enabled for this store' }]);
    fireEvent.click(form.getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(errorOf(form.getByLabelText('Marketplace'))).toBe('Keeta is not enabled for this store'));

    reply = fail(400, 'Validation failed', [{ path: 'value', message: 'The new price would be above 100,000 QAR' }]);
    fireEvent.change(form.getByLabelText('Percent over ERP price (%)'), { target: { value: '1000' } });
    fireEvent.click(form.getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(errorOf(form.getByLabelText('Percent over ERP price (%)'))).toBe('The new price would be above 100,000 QAR'));

    reply = fail(400, 'Validation failed', [{ path: 'productId', message: 'Only an active product can be priced; activate it first' }]);
    fireEvent.click(form.getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(form.getByRole('alert').textContent).toBe('Only an active product can be priced; activate it first'));

    reply = fail(403, 'Forbidden');
    fireEvent.click(form.getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(form.getByRole('alert').textContent).toBe('You do not have permission to change prices.'));
  });

  it('removes the product rule with the version on the query string; a second removal changes nothing', async () => {
    const { h } = inlineServer({ mode: 'fixed', value: 12.5, updatedAt: V1 }, 12.5);
    handler = h;
    renderAt('/catalogue/p1', <ProductDetailView />);
    const form = within(await editorForm());
    await waitFor(() => expect((form.getByLabelText('Marketplace') as HTMLSelectElement).value).toBe('talabat'));
    fireEvent.click(form.getByRole('button', { name: 'Remove the product price rule' }));
    await waitFor(() => expect(screen.getByTestId('inline-result').textContent).toBe('Product price rule removed. Talabat: 10.00 QAR (was 12.50 QAR).'));
    const [del] = calls(is('DELETE', '/api/pricing/products/p1'));
    expect(params(String(del[0]))).toEqual({ marketplaceId: 'talabat', expectedRuleUpdatedAt: V1 });
    expect((del[1] as RequestInit).body).toBeUndefined();
    await waitFor(() => expect(form.queryByRole('button', { name: 'Remove the product price rule' })).toBeNull());
    expect(form.getByTestId('inline-current').textContent).toContain('No product price rule now');
  });

  it('explains and disables when the product is not active or an offer sets the price', async () => {
    const { s, h } = inlineServer();
    s.status = 'inactive';
    handler = h;
    renderAt('/catalogue/p1', <ProductDetailView />);
    const form = within(await editorForm());
    expect(form.getByText('Only active products can be priced. Activate this product first.')).toBeTruthy();
    expect((form.getByRole('button', { name: 'Save price' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    handler = (u, i) => (is('GET', '/api/products/p1')(u, method(i))
      ? ok(detail('p1', { mode: 'fixed', value: 12, updatedAt: V1 }, 13, { marketplacePrice: { price: 13, source: 'offer' } }))
      : h(u, i));
    renderAt('/catalogue/p1', <ProductDetailView />);
    const form2 = within(await editorForm());
    expect(form2.getByText(/A current offer sets this price, so a price set here would not show/)).toBeTruthy();
    expect((form2.getByRole('button', { name: 'Save price' }) as HTMLButtonElement).disabled).toBe(true);
    expect((form2.getByRole('button', { name: 'Remove the product price rule' }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls(is('PUT', '/api/pricing/products/p1'))).toHaveLength(0);
  });

  it('without the comparison summary every marketplace is offered and the notice still says ALL marketplaces', async () => {
    const { h } = inlineServer();
    handler = (u, i) => (is('GET', '/api/recon/summary')(u, method(i)) ? fail(403, 'Forbidden') : h(u, i));
    renderAt('/catalogue/p1', <ProductDetailView />);
    const form = within(await editorForm());
    await waitFor(() => expect([...(form.getByLabelText('Marketplace') as HTMLSelectElement).options].map(o => o.value)).toEqual(['talabat', 'snoonu', 'rafeeq', 'keeta']));
    expect(form.getByRole('note', { name: 'Applies to all marketplaces' }).textContent).toContain('every marketplace your store uses gets it');
  });
});

describe('inline price edit in the catalogue', () => {
  it('opens the editor under the row, loads the product, saves and refreshes the list', async () => {
    const { h } = inlineServer();
    handler = (u, i) => (isList(u, method(i)) ? list([item('p1'), item('2')]) : h(u, i));
    renderAt('/catalogue', <CatalogueView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change the price of Product p1' }));
    const row = within(screen.getByRole('row', { name: 'Price editor for Product p1' }));
    const form = within(await row.findByRole('form', { name: 'Change the price' }));
    expect(row.getAllByTestId('chain-step')).toHaveLength(6);
    expect(row.getByRole('region', { name: 'Current price rule chain' })).toBeTruthy();
    // Exactly one GET of that product, for its rule version.
    expect(calls(is('GET', '/api/products/p1'))).toHaveLength(1);

    await waitFor(() => expect((form.getByLabelText('Marketplace') as HTMLSelectElement).value).toBe('talabat'));
    const lists = calls(isList).length;
    fireEvent.click(form.getByLabelText('Fixed price'));
    fireEvent.change(form.getByLabelText('New price (QAR)'), { target: { value: '9.75' } });
    fireEvent.click(form.getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(row.getByTestId('inline-result').textContent).toBe('Price saved. Talabat: 9.75 QAR (was 11.00 QAR).'));
    expect(bodyOf(calls(is('PUT', '/api/pricing/products/p1'))[0])).toEqual({ marketplaceId: 'talabat', mode: 'fixed', value: 9.75, expectedRuleUpdatedAt: V1 });
    await waitFor(() => expect(calls(isList).length).toBeGreaterThan(lists));

    fireEvent.click(row.getByRole('button', { name: 'Close the price editor' }));
    expect(screen.queryByRole('row', { name: 'Price editor for Product p1' })).toBeNull();
  });
});

// ───────── Permissions ─────────

describe('permissions', () => {
  it('without pricing.edit and pricing.bulk: no price actions anywhere', async () => {
    perms.delete('pricing.edit');
    perms.delete('pricing.bulk');
    const { h } = inlineServer();
    handler = (u, i) => (isList(u, method(i)) ? list([item('p1')]) : h(u, i));
    renderAt('/catalogue', <CatalogueView />);
    await screen.findByText('Product p1');
    expect(screen.getByRole('columnheader', { name: 'Marketplace price (QAR)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Change the price of/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Bulk price change' })).toBeNull();
    cleanup();

    renderAt('/catalogue/p1', <ProductDetailView />);
    await screen.findByRole('region', { name: 'Marketplace price' });
    expect(screen.queryByRole('form', { name: 'Change the price' })).toBeNull();
  });

  it('pricing.edit alone: inline edit but no bulk; pricing.bulk alone: bulk but no inline edit', async () => {
    perms.delete('pricing.bulk');
    handler = (u, i) => (isList(u, method(i)) ? list([item('p1')]) : undefined);
    renderAt('/catalogue', <CatalogueView />);
    expect(await screen.findByRole('button', { name: 'Change the price of Product p1' })).toBeTruthy();
    expect(screen.queryByRole('toolbar', { name: 'Bulk price change' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    cleanup();

    perms.add('pricing.bulk');
    perms.delete('pricing.edit');
    renderAt('/catalogue', <CatalogueView />);
    expect(await screen.findByRole('toolbar', { name: 'Bulk price change' })).toBeTruthy();
    expect(await screen.findByLabelText('Tick Product p1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change the price of Product p1' })).toBeNull();
  });
});

// ───────── Bulk change ─────────

const ROW = {
  productId: 'p1', nameEn: 'Product p1', barcode: '62810000p1', marketplaceId: 'talabat' as const,
  oldPrice: 4.4, oldSource: 'default' as const, newPrice: 4.6, newSource: 'product' as const, difference: 0.2,
  previousRule: null, rule: { mode: 'fixed' as const, value: 4.6 },
};
const BULK_COUNTS = {
  selected: 2, willChange: 1, unchanged: 0, blocked: 1,
  blockedReasons: [{ reason: 'not_active' as const, message: 'Not active (only active products can be priced)', count: 1 }],
  otherMarketplaces: [{ marketplaceId: 'snoonu' as const, products: 1 }, { marketplaceId: 'keeta' as const, products: 1 }],
};
const PREVIEW: BulkPreview = {
  marketplaceId: 'talabat', action: { type: 'increase_percent', percent: 5, rounding: '0.05' }, selection: { productIds: ['p1', '2'] },
  limit: 5000, ...BULK_COUNTS, largestIncrease: ROW, largestDecrease: null, rows: [ROW], previewToken: 'c'.repeat(64),
};
const RESULT: BulkApplyResult = { operationId: 'op-1', replayed: false, appliedAt: V2, ...BULK_COUNTS, created: 1, replaced: 0, removed: 0 };

const bulkBackend = (extra: Handler): Handler => async (u, i) => {
  const r = await extra(u, i);
  if (r) return r;
  const m = method(i);
  if (isList(u, m)) return list([item('p1'), item('2', { status: 'inactive' }), item('3')], { active: 2, inactive: 1 });
  if (is('GET', '/api/recon/summary')(u, m)) return ok(SUMMARY);
  if (is('POST', '/api/pricing/bulk/preview')(u, m)) return ok(PREVIEW);
  return undefined;
};
const openBulk = async () => {
  const button = await screen.findByRole('button', { name: 'Bulk price change…' }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false)); // enabled once the list has loaded
  fireEvent.click(button);
  return within(screen.getByRole('dialog', { name: 'Bulk price change' }));
};

describe('bulk price change', () => {
  it('ticked rows → preview → confirm with the number → apply; a lost answer is retried with the SAME key; then everything refreshes', async () => {
    let applies = 0;
    let release!: (r: Response) => void;
    handler = bulkBackend((u, i) => {
      if (!is('POST', '/api/pricing/bulk/apply')(u, method(i))) return undefined;
      applies++;
      if (applies === 1) throw new TypeError('Failed to fetch');
      return new Promise<Response>(res => { release = res; });
    });
    renderAt('/catalogue', <CatalogueView />);
    fireEvent.click(await screen.findByLabelText('Tick Product p1'));
    fireEvent.click(screen.getByLabelText('Tick Product 2'));
    expect(screen.getByTestId('ticked-count').textContent).toBe('2 products ticked');

    const dialog = await openBulk();
    expect((dialog.getByLabelText(/Ticked rows \(2\)/) as HTMLInputElement).checked).toBe(true);
    expect(dialog.getByText('Every active product (2)')).toBeTruthy();
    await waitFor(() => expect((dialog.getByLabelText('Marketplace') as HTMLSelectElement).value).toBe('talabat'));
    expect(dialog.getByRole('note').textContent).toContain('The new prices apply to ALL marketplaces');
    fireEvent.change(dialog.getByLabelText('Change'), { target: { value: 'increase_percent' } });
    fireEvent.change(dialog.getByLabelText('Percent (%)'), { target: { value: '5' } });
    fireEvent.change(dialog.getByLabelText('Rounding'), { target: { value: '0.05' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Preview' }));

    const preview = within(await dialog.findByRole('region', { name: 'Preview' }));
    expect(bodyOf(calls(is('POST', '/api/pricing/bulk/preview'))[0])).toEqual({
      marketplaceId: 'talabat', selection: { productIds: ['p1', '2'] }, action: { type: 'increase_percent', percent: 5, rounding: '0.05' },
    });
    expect(preview.getByText(/Increase by 5 % \(round to 0\.05\)/)).toBeTruthy();
    expect([preview.getByTestId('bulk-selected'), preview.getByTestId('bulk-will-change'), preview.getByTestId('bulk-unchanged'), preview.getByTestId('bulk-blocked')].map(e => e.textContent))
      .toEqual(['2', '1', '0', '1']);
    expect(within(preview.getByRole('region', { name: 'Blocked products' })).getByText('Not active (only active products can be priced)').closest('li')!.textContent)
      .toBe('Not active (only active products can be priced)1');
    expect(preview.getAllByTestId('other-marketplace').map(e => e.textContent)).toEqual(['Also changes 1 product on Snoonu', 'Also changes 1 product on Keeta']);
    expect(preview.getByTestId('largest-increase').textContent).toBe('Largest increase: Product p1 4.40 → 4.60 QAR (+0.20)');
    const rows = preview.getAllByTestId('bulk-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('4.40');
    expect(rows[0].textContent).toContain('4.60');
    expect(rows[0].textContent).toContain('Fixed 4.60 QAR');
    expect(calls(is('POST', '/api/pricing/bulk/apply'))).toHaveLength(0);

    fireEvent.click(dialog.getByRole('button', { name: 'Change 1 product…' }));
    const confirm = within(screen.getByRole('dialog', { name: 'Change prices' }));
    expect(confirm.getByTestId('confirm-count').textContent).toBe('1 product');

    // First try: the answer is lost.
    fireEvent.click(confirm.getByRole('button', { name: 'Change 1 product' }));
    await waitFor(() => expect(confirm.getByRole('alert').textContent).toContain('trying again is safe and will not apply it twice'));
    expect(confirm.getByRole('alert').textContent).toContain('We could not reach the server');

    // Retry: the button is disabled while the apply runs.
    const lists = calls(isList).length;
    const summaries = calls(is('GET', '/api/recon/summary')).length;
    fireEvent.click(confirm.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(applies).toBe(2));
    expect((confirm.getByRole('button', { name: 'Working…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((dialog.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true);
    release(ok(RESULT));

    expect((await dialog.findByTestId('bulk-done')).textContent).toBe('Prices changed on 1 product');
    expect(dialog.getByTestId('bulk-done-counts').textContent).toContain('1 new price rule, 0 replaced, 0 removed.');
    const [first, second] = calls(is('POST', '/api/pricing/bulk/apply')).map(bodyOf);
    expect(first.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second).toEqual({
      marketplaceId: 'talabat', selection: { productIds: ['p1', '2'] }, action: { type: 'increase_percent', percent: 5, rounding: '0.05' },
      idempotencyKey: first.idempotencyKey, previewToken: PREVIEW.previewToken,
    });
    // The product list and the comparison summary are read again; the ticks are cleared.
    await waitFor(() => expect(calls(isList).length).toBeGreaterThan(lists));
    await waitFor(() => expect(calls(is('GET', '/api/recon/summary')).length).toBeGreaterThan(summaries));
    expect(screen.getByTestId('ticked-count').textContent).not.toContain('ticked');
    fireEvent.click(dialog.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Bulk price change' })).toBeNull();
  });

  it('a new confirmation after a 409 uses a new key and a new preview token', async () => {
    let applies = 0;
    let previews = 0;
    handler = bulkBackend((u, i) => {
      const m = method(i);
      if (is('POST', '/api/pricing/bulk/preview')(u, m)) return ok({ ...PREVIEW, previewToken: String(++previews).repeat(64) });
      if (is('POST', '/api/pricing/bulk/apply')(u, m)) {
        return ++applies === 1 ? fail(409, 'Prices or rules changed since the preview; preview again before applying') : ok({ ...RESULT, replayed: false });
      }
      return undefined;
    });
    renderAt('/catalogue', <CatalogueView />);
    fireEvent.click(await screen.findByLabelText('Tick Product p1'));
    const dialog = await openBulk();
    await waitFor(() => expect((dialog.getByLabelText('Marketplace') as HTMLSelectElement).value).toBe('talabat'));
    fireEvent.change(dialog.getByLabelText('Change'), { target: { value: 'match_erp' } });
    expect(dialog.queryByLabelText('Percent (%)')).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: 'Preview' }));
    fireEvent.click(await dialog.findByRole('button', { name: 'Change 1 product…' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Change prices' })).getByRole('button', { name: 'Change 1 product' }));

    const alert = await dialog.findByText(/Prices or rules changed since the preview/);
    expect(alert.closest('[role="alert"]')!.textContent).toContain('Nothing was changed.');
    expect(screen.queryByRole('dialog', { name: 'Change prices' })).toBeNull();
    expect(dialog.queryByRole('button', { name: 'Change 1 product…' })).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: 'Preview again' }));
    fireEvent.click(await dialog.findByRole('button', { name: 'Change 1 product…' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Change prices' })).getByRole('button', { name: 'Change 1 product' }));
    await dialog.findByTestId('bulk-done');

    const [a, b] = calls(is('POST', '/api/pricing/bulk/apply')).map(bodyOf);
    expect(a.action).toEqual({ type: 'match_erp' });
    expect(a.previewToken).toBe('1'.repeat(64));
    expect(b.previewToken).toBe('2'.repeat(64));
    expect(b.idempotencyKey).not.toBe(a.idempotencyKey);
  });

  it('a replayed apply says nothing was written again', async () => {
    handler = bulkBackend((u, i) => (is('POST', '/api/pricing/bulk/apply')(u, method(i)) ? ok({ ...RESULT, replayed: true }) : undefined));
    renderAt('/catalogue', <CatalogueView />);
    fireEvent.click(await screen.findByLabelText('Tick Product p1'));
    const dialog = await openBulk();
    await waitFor(() => expect((dialog.getByLabelText('Marketplace') as HTMLSelectElement).value).toBe('talabat'));
    fireEvent.change(dialog.getByLabelText('Percent (%)'), { target: { value: '5' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Preview' }));
    fireEvent.click(await dialog.findByRole('button', { name: 'Change 1 product…' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Change prices' })).getByRole('button', { name: 'Change 1 product' }));
    expect((await dialog.findByTestId('bulk-done')).textContent).toBe('This change had already been applied');
    expect(dialog.getByText(/nothing was written again/)).toBeTruthy();
  });

  it('the current filter: sends the search and category, and refuses more than 5,000 products before calling the API', async () => {
    let active = 6000;
    handler = bulkBackend(u => (u.startsWith('/api/products?') ? list([item('p1')], { active }) : undefined));
    renderAt('/catalogue', <CatalogueView />);
    let dialog = await openBulk();
    expect((dialog.getByLabelText(/Ticked rows \(0\)/) as HTMLInputElement).disabled).toBe(true);
    expect((dialog.getByLabelText(/Every active product \(6,000\)/) as HTMLInputElement).checked).toBe(true);
    expect(dialog.getByRole('alert').textContent).toBe('The current search and category match 6,000 active products. One change can price at most 5,000; narrow the search or category.');
    expect((dialog.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(dialog.getByRole('form', { name: 'Choose the change' }));
    expect(calls(is('POST', '/api/pricing/bulk/preview'))).toHaveLength(0);
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    cleanup();

    active = 40;
    renderAt('/catalogue', <CatalogueView />);
    fireEvent.change(await screen.findByPlaceholderText('Search by English name, barcode or SKU'), { target: { value: 'milk' } });
    await waitFor(() => expect(calls(isList).some(([u]) => params(String(u)).q === 'milk')).toBe(true));
    await screen.findByText('Product p1');
    dialog = await openBulk();
    // The count follows the list once the search has loaded.
    await waitFor(() => expect(dialog.getByLabelText(/Active products matching the current filter \(40\)/)).toBeTruthy());
    expect(dialog.getByText(/Search "milk"\./)).toBeTruthy();
    await waitFor(() => expect((dialog.getByLabelText('Marketplace') as HTMLSelectElement).value).toBe('talabat'));
    fireEvent.change(dialog.getByLabelText('Marketplace'), { target: { value: 'keeta' } });
    fireEvent.change(dialog.getByLabelText('Change'), { target: { value: 'set_fixed' } });
    fireEvent.change(dialog.getByLabelText('Price (QAR)'), { target: { value: '0' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Preview' }));
    expect(errorOf(dialog.getByLabelText('Price (QAR)'))).toBe('Enter a price above 0 and at most 100,000 QAR');
    expect(calls(is('POST', '/api/pricing/bulk/preview'))).toHaveLength(0);
    fireEvent.change(dialog.getByLabelText('Price (QAR)'), { target: { value: '7.25' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Preview' }));
    await dialog.findByRole('region', { name: 'Preview' });
    expect(bodyOf(calls(is('POST', '/api/pricing/bulk/preview'))[0])).toEqual({
      marketplaceId: 'keeta', selection: { filter: { q: 'milk' } }, action: { type: 'set_fixed', price: 7.25 },
    });
  });

  it('a preview 400 is shown in plain words; Back keeps the choices', async () => {
    handler = bulkBackend((u, i) => (is('POST', '/api/pricing/bulk/preview')(u, method(i))
      ? fail(400, 'Validation failed', [{ path: 'selection', message: 'This selection has 6,200 products; one change can price at most 5,000. Narrow the filter.' }])
      : undefined));
    renderAt('/catalogue', <CatalogueView />);
    const dialog = await openBulk();
    await waitFor(() => expect((dialog.getByLabelText('Marketplace') as HTMLSelectElement).value).toBe('talabat'));
    fireEvent.change(dialog.getByLabelText('Percent (%)'), { target: { value: '5' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(dialog.getByRole('alert').textContent).toBe('We could not run the preview: This selection has 6,200 products; one change can price at most 5,000. Narrow the filter.'));
    expect((dialog.getByLabelText('Percent (%)') as HTMLInputElement).value).toBe('5');
  });

  it('a preview with nothing to change offers no apply', async () => {
    handler = bulkBackend((u, i) => (is('POST', '/api/pricing/bulk/preview')(u, method(i))
      ? ok({ ...PREVIEW, willChange: 0, unchanged: 2, blocked: 0, blockedReasons: [], otherMarketplaces: [], rows: [], largestIncrease: null })
      : undefined));
    renderAt('/catalogue', <CatalogueView />);
    fireEvent.click(await screen.findByLabelText('Tick Product p1'));
    const dialog = await openBulk();
    await waitFor(() => expect((dialog.getByLabelText('Marketplace') as HTMLSelectElement).value).toBe('talabat'));
    fireEvent.change(dialog.getByLabelText('Percent (%)'), { target: { value: '5' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Preview' }));
    expect((await dialog.findByText(/Nothing to change/)).textContent).toContain('no selected product would get a new price');
    expect(dialog.queryByRole('button', { name: /^Change .*…$/ })).toBeNull();
    expect(dialog.queryByRole('region', { name: 'Other marketplaces' })).toBeNull();
  });
});

// ───────── Flag off ─────────

describe('VITE_REAL_PRICING off', () => {
  it('the real catalogue and product detail stay as before: no price column, editor, ticks or bulk change, no recon call', async () => {
    vi.stubEnv('VITE_REAL_PRICING', '');
    const { h } = inlineServer();
    handler = (u, i) => (isList(u, method(i)) ? list([item('p1')]) : h(u, i));
    renderAt('/catalogue', <CatalogueView />);
    await screen.findByText('Product p1');
    expect(screen.queryByRole('columnheader', { name: 'Marketplace price (QAR)' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Change the price of/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Bulk price change' })).toBeNull();
    cleanup();

    renderAt('/catalogue/p1', <ProductDetailView />);
    await screen.findByRole('heading', { name: 'Product p1' });
    expect(screen.queryByRole('form', { name: 'Change the price' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Marketplace price' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Marketplace price rules' }).textContent).toContain('Not available yet');
    expect(calls(is('GET', '/api/recon/summary'))).toHaveLength(0);
    expect(calls((u, m) => m !== 'GET')).toHaveLength(0);
  });
});
