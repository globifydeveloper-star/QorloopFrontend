// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { BlockPreview, ProductDetail, ProductItem, TabCounts } from '../../../api/products';
import type { MarketplaceListing } from '../../../api/marketplaceListings';
import { qatarDateTime } from '../../../lib/format';

const perms = new Set<string>();
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ can: (p: string) => perms.has(p) }) }));
const app = { showToast: vi.fn(), openUploadModal: vi.fn(), navigate: vi.fn() };
vi.mock('../../../context/AppContext', () => ({ useApp: () => app }));

import { CatalogueView } from '../../views/CatalogueView';
import { ProductDetailView } from '../../views/ProductDetailView';
import { BulkOfferPanel } from '../../pricing/BulkOfferPanel';
import { invalidateAfterBlock } from '../blocking';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json(200, { data });
const fail = (status: number, message: string, details?: unknown[]) => json(status, { error: { code: 'E', message, details } });

const UPDATED = '2026-11-17T08:00:00.000Z';
const BLOCKED_AT = '2026-11-16T09:30:00.000Z';
const prod = (id: string, over: Partial<ProductItem> = {}): ProductItem => ({
  id, barcode: `6281000${id}`, sku: null, nameEn: `Product ${id}`, nameAr: null, brand: null, erpCategory: null,
  categoryId: null, subcategoryId: null, erpPrice: 12.5, erpStock: 7, status: 'active', inLatestErpFile: true, updatedAt: UPDATED,
  isBlocked: false, blockedAt: null, blockedReason: null, ...over,
});
const blockedProd = (id: string, over: Partial<ProductItem> = {}) =>
  prod(id, { isBlocked: true, blockedAt: BLOCKED_AT, blockedReason: 'seasonal', blockedBy: { id: 'u1', name: 'Mariam Owner' }, ...over });
const counts = (over: Partial<TabCounts & { blocked: number }> = {}) => ({ all: 2, active: 2, inactive: 0, new: 0, missing: 0, blocked: 2, ...over });
const preview = (over: Partial<BlockPreview> = {}): BlockPreview => ({
  reason: 'seasonal', reasonLabel: 'Seasonal', selected: 1, toBlock: 1, alreadyBlocked: 0, notFound: 0,
  activeOffersToEnd: 0, offersNote: null, previewToken: 'a'.repeat(64), ...over,
});

type Handler = (url: string, init: RequestInit) => Response | undefined;
let handler: Handler;
let fetchMock: ReturnType<typeof vi.fn>;
const method = (i?: RequestInit) => i?.method ?? 'GET';
const calls = (pred: (url: string, m: string) => boolean) => fetchMock.mock.calls.filter(([u, i]) => pred(String(u), method(i as RequestInit)));
const bodyOf = (c: unknown[]) => JSON.parse(String((c[1] as RequestInit).body));
const params = (u: string) => Object.fromEntries(new URL(u, 'http://x').searchParams);
const isList = (u: string, m: string) => m === 'GET' && u.startsWith('/api/products?');
const isBlockedCount = (u: string, m: string) => isList(u, m) && params(u).blocked === 'only' && params(u).limit === '1';
const isBlockedList = (u: string, m: string) => isList(u, m) && params(u).blocked === 'only' && params(u).limit !== '1';
const isCatalogueList = (u: string, m: string) => isList(u, m) && params(u).blocked === undefined;
const post = (path: string) => (u: string, m: string) => m === 'POST' && u === path;

/** A small backend: the catalogue (blocked products left out), the Blocked tab, and block / unblock. */
const server = { active: [prod('1'), prod('2')], blocked: [blockedProd('8'), blockedProd('9', { blockedReason: 'old', blockedBy: null })] };
function defaults(u: string, i: RequestInit): Response | undefined {
  const m = method(i);
  if (u === '/api/categories' && m === 'GET') return ok([]);
  if (isList(u, m)) {
    const p = params(u);
    const c = counts({ all: server.active.length, active: server.active.length, blocked: server.blocked.length });
    if (p.blocked === 'only') {
      const q = (p.q ?? '').toLowerCase();
      const items = server.blocked.filter(b => !q || b.nameEn.toLowerCase().includes(q) || b.barcode.startsWith(q));
      return ok({ items: p.limit === '1' ? items.slice(0, 1) : items, nextCursor: null, counts: { ...c, all: items.length, blocked: items.length } });
    }
    return ok({ items: server.active, nextCursor: null, counts: c });
  }
  const stock = /^\/api\/products\/([^/?]+)\/stock$/.exec(u);
  if (stock && m === 'GET') return ok({ productId: stock[1], erpStock: 7, catalogueStock: 7, source: 'erp', conflict: null, edit: null });
  if (u === '/api/products/marketplace-listings' || u.startsWith('/api/products/marketplace-listings?')) return undefined;
  return undefined;
}

const Where = () => { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search}</output>; };
function renderAt(path: string, ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={<>{ui}<Where /></>} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
  return { qc, invalidated: () => spy.mock.calls.map(c => JSON.stringify((c[0] as { queryKey?: unknown })?.queryKey)) };
}

beforeEach(() => {
  vi.stubEnv('VITE_REAL_CATALOGUE', 'true');
  perms.clear();
  ['products.view', 'products.edit', 'products.block'].forEach(p => perms.add(p));
  server.active = [prod('1'), prod('2')];
  server.blocked = [blockedProd('8'), blockedProd('9', { blockedReason: 'old', blockedBy: null })];
  handler = () => undefined;
  fetchMock = vi.fn(async (u: string, i: RequestInit = {}) => handler(String(u), i) ?? defaults(String(u), i) ?? fail(404, 'not mocked'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const viewTabs = () => within(screen.getByRole('tablist', { name: 'Catalogue view' }));
const dialogNamed = (name: string | RegExp) => within(screen.getByRole('dialog', { name }));

describe('catalogue tabs', () => {
  it('shows Catalogue | Talabat | Snoonu | Blocked (count), and the catalogue list asks without blocked (left out)', async () => {
    renderAt('/catalogue', <CatalogueView />);
    await screen.findByText('Product 1');
    await waitFor(() => expect(viewTabs().getAllByRole('tab').map(t => t.textContent)).toEqual(['Catalogue', 'Talabat', 'Snoonu', 'Blocked (2)']));
    expect(viewTabs().getByRole('tab', { name: 'Catalogue' }).getAttribute('aria-selected')).toBe('true');
    expect(calls(isCatalogueList).length).toBeGreaterThan(0);
    expect(calls(isList).filter(([u]) => !isBlockedCount(String(u), 'GET')).every(([u]) => params(String(u)).blocked === undefined)).toBe(true);
    expect(screen.queryByText('Product 8')).toBeNull();
  });

  it('never shows a row the backend marks as blocked on the Catalogue tab', async () => {
    server.active = [prod('1'), blockedProd('8')];
    renderAt('/catalogue', <CatalogueView />);
    await screen.findByText('Product 1');
    expect(screen.queryByText('Product 8')).toBeNull();
  });

  it('switches to the Blocked tab (in the URL): name, barcode, reason, date and blocked by, and search works there', async () => {
    renderAt('/catalogue', <CatalogueView />);
    await screen.findByText('Product 1');
    fireEvent.click(viewTabs().getByRole('tab', { name: /Blocked/ }));
    expect(screen.getByTestId('where').textContent).toBe('/catalogue?view=blocked');
    const table = within(await screen.findByRole('table', { name: 'Blocked products' }));
    expect(table.getAllByRole('columnheader').map(h => h.textContent)).toEqual(
      ['', 'Name', 'Barcode', 'Reason', 'Blocked on (Qatar time)', 'Blocked by', 'Actions']);
    const r8 = within(table.getByText('Product 8').closest('tr')!);
    expect(r8.getByText('62810008')).toBeTruthy();
    expect(r8.getByTestId('blocked-reason').textContent).toBe('Seasonal');
    expect(r8.getByTestId('blocked-at').textContent).toBe(qatarDateTime(BLOCKED_AT));
    expect(r8.getByTestId('blocked-by').textContent).toBe('Mariam Owner');
    const r9 = within(table.getByText('Product 9').closest('tr')!);
    expect(r9.getByTestId('blocked-reason').textContent).toBe('Old product');
    // The backend does not send who blocked it yet: a dash, not a guess.
    expect(r9.getByTestId('blocked-by').textContent).toBe('—');
    expect(screen.queryByText('Product 1')).toBeNull();
    expect(params(String(calls(isBlockedList)[0][0]))).toEqual({ tab: 'all', blocked: 'only', limit: '50' });

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search blocked products' }), { target: { value: 'Product 9' } });
    await waitFor(() => expect(screen.queryByText('Product 8')).toBeNull());
    expect(params(String(calls(isBlockedList).at(-1)![0]))).toMatchObject({ q: 'Product 9', blocked: 'only' });
    expect(screen.getByText('Product 9')).toBeTruthy();
  });

  it('opens the Talabat tab from the URL and hides listings matched to blocked products', async () => {
    const listing = (id: string, over: Partial<MarketplaceListing> = {}): MarketplaceListing => ({
      id, marketplaceProductId: `T-${id}`, name: `Listing ${id}`, barcodes: [`6281000${id}`], price: 10, available: true, updatedAt: UPDATED,
      product: { id, nameEn: `Product ${id}`, barcode: `6281000${id}` }, sourceFile: null, availabilityAdjustment: null, ...over,
    });
    handler = (u, i) => (method(i) === 'GET' && u.startsWith('/api/products/marketplace-listings')
      ? ok({ items: [listing('1'), listing('8', { isBlocked: true, product: { id: '8', nameEn: 'Product 8', barcode: '62810008', isBlocked: true } })], total: 2, nextCursor: null, latestUpload: null })
      : undefined);
    renderAt('/catalogue?view=talabat', <CatalogueView />);
    expect(await screen.findByText('Listing 1')).toBeTruthy();
    expect(viewTabs().getByRole('tab', { name: 'Talabat' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByText('Listing 8')).toBeNull();
    expect(screen.getByText(/1 of them belongs to a blocked product and is hidden/)).toBeTruthy();
    expect(params(String(calls((u, m) => m === 'GET' && u.startsWith('/api/products/marketplace-listings'))[0][0])).marketplaceId).toBe('talabat');
  });
});

describe('block', () => {
  it('blocks one row with a reason after a preview that names the offers that end', async () => {
    handler = (u, i) => {
      if (post('/api/products/block/preview')(u, method(i))) return ok(preview({ reason: bodyOf([u, i]).reason, activeOffersToEnd: 2 }));
      if (post('/api/products/block')(u, method(i))) {
        server.active = server.active.filter(p => p.id !== '1');
        server.blocked = [...server.blocked, blockedProd('1')];
        return ok({ reason: 'seasonal', reasonLabel: 'Seasonal', blocked: 1, alreadyBlocked: 0, notFound: 0, offersEnded: 2, offersNote: 'x', blockedAt: UPDATED });
      }
      return undefined;
    };
    const { invalidated } = renderAt('/catalogue', <CatalogueView />);
    const row = within((await screen.findByText('Product 1')).closest('tr')!);
    fireEvent.click(row.getByRole('button', { name: 'Block Product 1' }));
    const d = () => dialogNamed('Block "Product 1"');
    expect(d().getByText('Choose a reason to see what will change.')).toBeTruthy();
    expect((d().getByRole('button', { name: 'Block' }) as HTMLButtonElement).disabled).toBe(true);
    expect(d().getAllByRole('radio').map(r => r.closest('label')!.textContent)).toEqual(['Old product', 'Seasonal', 'Other']);

    fireEvent.click(d().getByRole('radio', { name: 'Seasonal' }));
    expect(await d().findByText('1 product will be blocked.')).toBeTruthy();
    expect(bodyOf(calls(post('/api/products/block/preview'))[0])).toEqual({ productIds: ['1'], reason: 'seasonal' });
    expect(d().getByTestId('offers-to-end').textContent).toBe('2 active offers on this product will end now. Unblocking does not bring them back.');
    expect(calls(post('/api/products/block'))).toHaveLength(0);

    fireEvent.click(d().getByRole('button', { name: 'Block product and end 2 active offers' }));
    expect(await screen.findByRole('dialog', { name: 'Block "Product 1"' })).toBeTruthy();
    await waitFor(() => expect(d().getByRole('heading', { name: 'Blocked 1 product' })).toBeTruthy());
    expect(bodyOf(calls(post('/api/products/block'))[0])).toEqual({ productIds: ['1'], reason: 'seasonal', previewToken: 'a'.repeat(64) });
    expect(d().getByText('2 active offers ended. Unblocking does not bring them back.')).toBeTruthy();
    // The catalogue, the counts, pricing and the comparison (Dashboard and Review) refresh.
    expect(invalidated()).toEqual(expect.arrayContaining(['["products"]', '["pricing"]', '["recon","summary"]', '["recon","rows"]']));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Product 1' })).toBeNull());
    await waitFor(() => expect(viewTabs().getByRole('tab', { name: /Blocked/ }).textContent).toBe('Blocked (3)'));
    fireEvent.click(d().getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('blocks the ticked rows: the preview counts them, and a 409 previews again before a new confirm', async () => {
    const blockAnswers = [fail(409, 'The products or their offers changed since the preview; preview again before blocking')];
    let previews = 0;
    handler = (u, i) => {
      if (post('/api/products/block/preview')(u, method(i))) {
        previews++;
        return ok(preview({ reason: 'old', selected: 2, toBlock: previews === 1 ? 2 : 1, alreadyBlocked: previews === 1 ? 0 : 1, previewToken: String(previews).repeat(64) }));
      }
      if (post('/api/products/block')(u, method(i))) {
        const next = blockAnswers.shift();
        return next ?? ok({ reason: 'old', reasonLabel: 'Old product', blocked: 1, alreadyBlocked: 1, notFound: 0, offersEnded: 0, offersNote: null, blockedAt: UPDATED });
      }
      return undefined;
    };
    renderAt('/catalogue', <CatalogueView />);
    await screen.findByText('Product 1');
    const bar = within(screen.getByRole('toolbar', { name: 'Block products' }));
    expect((bar.getByRole('button', { name: 'Block…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tick every row shown' }));
    expect(screen.getByTestId('ticked-count').textContent).toBe('2 products ticked');
    fireEvent.click(bar.getByRole('button', { name: 'Block…' }));
    const d = () => dialogNamed('Block 2 products');
    fireEvent.click(d().getByRole('radio', { name: 'Old product' }));
    expect(await d().findByText('2 products will be blocked.')).toBeTruthy();
    expect(bodyOf(calls(post('/api/products/block/preview'))[0])).toEqual({ productIds: ['1', '2'], reason: 'old' });
    expect(d().queryByTestId('offers-to-end')).toBeNull();

    fireEvent.click(d().getByRole('button', { name: 'Block 2 products' }));
    expect(await d().findByText(/changed since the preview\. Check the new preview/)).toBeTruthy();
    // Previewed again: the new numbers and token, and nothing blocked until confirmed again.
    expect(await d().findByText('1 product will be blocked.')).toBeTruthy();
    expect(d().getByText('1 product already blocked.')).toBeTruthy();
    fireEvent.click(d().getByRole('button', { name: 'Block 1 product' }));
    await waitFor(() => expect(d().getByRole('heading', { name: 'Blocked 1 product' })).toBeTruthy());
    expect(bodyOf(calls(post('/api/products/block'))[1]).previewToken).toBe('2'.repeat(64));
  });

  it('offers no Block, tick or Unblock without products.block', async () => {
    perms.delete('products.block');
    renderAt('/catalogue', <CatalogueView />);
    await screen.findByText('Product 1');
    expect(screen.queryByRole('button', { name: 'Block Product 1' })).toBeNull();
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.click(viewTabs().getByRole('tab', { name: /Blocked/ }));
    await screen.findByText('Product 8');
    expect(screen.queryByRole('button', { name: 'Unblock Product 8' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

describe('unblock', () => {
  const answerUnblock = () => {
    handler = (u, i) => {
      if (!post('/api/products/unblock')(u, method(i))) return undefined;
      const ids: string[] = bodyOf([u, i]).productIds;
      server.blocked = server.blocked.filter(b => !ids.includes(b.id));
      return ok({ unblocked: ids.length, notBlocked: 0, notFound: 0, offersRestored: 0, offersNote: 'not restored' });
    };
  };

  it('unblocks one product from the Blocked tab and says ended offers are not restored', async () => {
    answerUnblock();
    renderAt('/catalogue?view=blocked', <CatalogueView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Unblock Product 8' }));
    const d = () => dialogNamed('Unblock "Product 8"?');
    expect(d().getByText(/not restored; set a new offer if needed/)).toBeTruthy();
    fireEvent.click(d().getByRole('button', { name: 'Unblock' }));
    await waitFor(() => expect(d().getByRole('heading', { name: 'Unblocked 1 product' })).toBeTruthy());
    expect(bodyOf(calls(post('/api/products/unblock'))[0])).toEqual({ productIds: ['8'] });
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Product 8' })).toBeNull());
    await waitFor(() => expect(viewTabs().getByRole('tab', { name: /Blocked/ }).textContent).toBe('Blocked (1)'));
  });

  it('unblocks the ticked rows together', async () => {
    answerUnblock();
    renderAt('/catalogue?view=blocked', <CatalogueView />);
    await screen.findByText('Product 8');
    const bar = within(screen.getByRole('toolbar', { name: 'Unblock' }));
    expect((bar.getByRole('button', { name: 'Unblock…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tick Product 8' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tick Product 9' }));
    fireEvent.click(bar.getByRole('button', { name: 'Unblock 2 products…' }));
    fireEvent.click(dialogNamed('Unblock 2 products?').getByRole('button', { name: 'Unblock 2 products' }));
    await screen.findByRole('heading', { name: 'Unblocked 2 products' });
    expect(bodyOf(calls(post('/api/products/unblock'))[0])).toEqual({ productIds: ['8', '9'] });
    expect(await screen.findByText('No blocked products')).toBeTruthy();
  });

  it('says so when the server cannot list blocked products yet (unknown query key)', async () => {
    handler = (u, i) => (isList(u, method(i)) && params(u).blocked ? fail(400, 'Validation failed', [{ path: 'blocked', message: 'Unrecognized key' }]) : undefined);
    renderAt('/catalogue?view=blocked', <CatalogueView />);
    expect(await screen.findByText('Blocking is not available yet')).toBeTruthy();
    expect(viewTabs().getByRole('tab', { name: 'Blocked' }).textContent).toBe('Blocked');
  });
});

describe('the product page', () => {
  const detail = (over: Partial<ProductDetail> = {}): ProductDetail => ({
    ...prod('8'), size: null, erpActive: true, createdAt: UPDATED, category: null, subcategory: null, listings: [],
    arabicNameMissing: true, categoryMissing: true, ...over,
  });

  it('shows a blocked product as blocked, with Unblock', async () => {
    handler = (u, i) => (method(i) === 'GET' && u === '/api/products/8' ? ok(detail({ isBlocked: true, blockedAt: BLOCKED_AT, blockedReason: 'seasonal', blockedBy: { id: 'u1', name: 'Mariam Owner' } })) : undefined);
    renderAt('/catalogue/8', <ProductDetailView />);
    expect(await screen.findByTestId('blocked-pill')).toBeTruthy();
    expect(screen.getByText('Blocked (Seasonal)').parentElement!.textContent).toContain(`on ${qatarDateTime(BLOCKED_AT)} (Qatar time) by Mariam Owner`);
    expect(screen.queryByRole('button', { name: 'Block Product 8' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Unblock' }));
    expect(screen.getByRole('dialog', { name: 'Unblock "Product 8"?' })).toBeTruthy();
  });

  it('offers Block on a product that is not blocked', async () => {
    handler = (u, i) => (method(i) === 'GET' && u === '/api/products/8' ? ok(detail()) : undefined);
    renderAt('/catalogue/8', <ProductDetailView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Block Product 8' }));
    expect(screen.getByRole('dialog', { name: 'Block "Product 8"' })).toBeTruthy();
    expect(screen.queryByTestId('blocked-pill')).toBeNull();
  });
});

describe('blocked products stay out of the other tables', () => {
  it('the Bulk offer table never takes a blocked product', () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BulkOfferPanel products={[prod('1', { normalPrice: 10 }), blockedProd('8')]} onClose={() => undefined} onApplied={() => undefined} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Bulk offer: 1 product' })).toBeTruthy();
    expect(screen.queryByText('Product 8')).toBeNull();
  });

  it('a block or unblock refreshes the catalogue, pricing (offers), stock and the comparison behind the Dashboard and Review', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    invalidateAfterBlock(qc, true);
    const keys = spy.mock.calls.map(c => JSON.stringify((c[0] as { queryKey?: unknown }).queryKey));
    expect(keys).toEqual(expect.arrayContaining(['["products"]', '["pricing"]', '["stock"]', '["uploads","changes"]', '["activity"]', '["recon","summary"]', '["recon","rows"]']));
    // A recompute is expected: the Dashboard and Review poll until it lands, so the product leaves them.
    expect(qc.getQueryData(['recon', 'recompute'])).toMatchObject({ timedOut: false });

    spy.mockClear();
    invalidateAfterBlock(qc, false);
    expect(spy.mock.calls.map(c => JSON.stringify((c[0] as { queryKey?: unknown }).queryKey))).not.toContain('["recon","rows"]');
  });
});
