// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ProductItem } from '../../../api/products';
import { qatarToday } from '../offerTable';

const perms = new Set<string>();
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ can: (p: string) => perms.has(p) }) }));
const app = { showToast: vi.fn(), openUploadModal: vi.fn(), navigate: vi.fn() };
vi.mock('../../../context/AppContext', () => ({ useApp: () => app }));

import { CatalogueView } from '../../views/CatalogueView';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json(200, { data });
const fail = (status: number, message: string) => json(status, { error: { code: 'E', message } });
const method = (i?: RequestInit) => i?.method ?? 'GET';
const isList = (u: string, m: string) => m === 'GET' && u.startsWith('/api/products?');
const isPreview = (u: string, m: string) => m === 'POST' && u === '/api/pricing/offers/bulk/preview';
const isApply = (u: string, m: string) => m === 'POST' && u === '/api/pricing/offers/bulk/apply';
const bodyOf = (c: unknown[]) => JSON.parse(String((c[1] as RequestInit).body));

const END = '2099-12-31';
const item = (id: string, over: Partial<ProductItem> = {}): ProductItem => ({
  id, barcode: `628${id}`, sku: null, nameEn: `Product ${id}`, nameAr: null, brand: null, erpCategory: null, categoryId: null, subcategoryId: null,
  erpPrice: 9, erpStock: 3, status: 'active', inLatestErpFile: true, updatedAt: '2026-11-01T00:00:00Z',
  marketplacePrice: { price: 10, source: 'default' }, normalPrice: 10, ...over,
});
const ITEMS = [
  item('p1'),
  item('p2', { normalPrice: 20, marketplacePrice: { price: 15, source: 'offer' }, offer: { price: 15, validFrom: null, validUntil: '2099-01-31T20:59:59.999Z', state: 'valid' } }),
  item('p3', { status: 'inactive' }),
];
const page = (items: ProductItem[]) => ok({ items, nextCursor: null, counts: { all: items.length, active: items.length, inactive: 0, new: 0, missing: 0 } });

type Handler = (url: string, init: RequestInit) => Response | Promise<Response> | undefined;
let handler: Handler;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (pred: (u: string, m: string) => boolean) => fetchMock.mock.calls.filter(([u, i]) => pred(String(u), method(i as RequestInit)));

function renderCatalogue() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/catalogue']}><CatalogueView /></MemoryRouter></QueryClientProvider>);
  return spy;
}
async function openWith(ticks: string[]) {
  for (const id of ticks) fireEvent.click(await screen.findByLabelText(`Tick Product ${id}`));
  fireEvent.click(screen.getByRole('button', { name: 'Bulk offer…' }));
  return within(await screen.findByRole('dialog', { name: /^Bulk offer:/ }));
}
const rowOf = (panel: ReturnType<typeof within>, name: string) => within(panel.getByText(name).closest('tr')!);

beforeEach(() => {
  // Every VITE_REAL_* flag starts off (vitest.setup.ts); this screen needs the real catalogue and real pricing.
  vi.stubEnv('VITE_REAL_CATALOGUE', 'true');
  vi.stubEnv('VITE_REAL_PRICING', 'true');
  perms.clear();
  ['products.view', 'pricing.view', 'pricing.edit'].forEach(p => perms.add(p));
  handler = () => undefined;
  fetchMock = vi.fn(async (u: string, i: RequestInit = {}) => {
    const r = await handler(String(u), i);
    if (r) return r;
    if (isList(String(u), method(i))) return page(ITEMS);
    if (u === '/api/categories') return ok([]);
    return fail(404, 'not mocked');
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Bulk offer: the table', () => {
  it('shows exactly the ticked rows with normal price, current offer and today as the start date; a row can be removed', async () => {
    renderCatalogue();
    const panel = await openWith(['p1', 'p2']);
    expect(screen.getByRole('heading', { name: 'Bulk offer: 2 products' })).toBeTruthy();
    expect(panel.getAllByTestId('offer-row').map(r => r.textContent)).toEqual([expect.stringContaining('Product p1'), expect.stringContaining('Product p2')]);
    expect(panel.queryByText('Product p3')).toBeNull();
    expect(rowOf(panel, 'Product p2').getByTestId('normal-price').textContent).toBe('20.00');
    expect(rowOf(panel, 'Product p2').getByTestId('current-offer').textContent).toContain('Current offer: 15.00 QAR');
    expect(rowOf(panel, 'Product p2').getByTestId('current-offer').textContent).toContain('Running now');
    expect((panel.getByLabelText('Start date for Product p1') as HTMLInputElement).value).toBe(qatarToday());

    fireEvent.click(panel.getByRole('button', { name: 'Remove Product p1' }));
    expect(screen.getByRole('heading', { name: 'Bulk offer: 1 product' })).toBeTruthy();
    expect(panel.getAllByTestId('offer-row')).toHaveLength(1);
  });

  it('works out Off % from the normal price as the promo price is typed', async () => {
    renderCatalogue();
    const panel = await openWith(['p1']);
    const off = () => panel.getByTestId('off-percent').textContent;
    expect(off()).toBe('—');
    fireEvent.change(panel.getByLabelText('Promo price for Product p1'), { target: { value: '8' } });
    expect(off()).toBe('20 %');
    fireEvent.change(panel.getByLabelText('Promo price for Product p1'), { target: { value: '7.25' } });
    expect(off()).toBe('27.5 %');
  });

  it('"Apply to all rows" fills every row with the same values; each row stays editable', async () => {
    renderCatalogue();
    const panel = await openWith(['p1', 'p2']);
    fireEvent.change(panel.getByLabelText('Same promo price for all (QAR)'), { target: { value: '9' } });
    fireEvent.change(panel.getByLabelText('Same end date for all'), { target: { value: END } });
    fireEvent.click(panel.getByRole('button', { name: 'Apply to all rows' }));
    for (const n of ['p1', 'p2']) {
      expect((panel.getByLabelText(`Promo price for Product ${n}`) as HTMLInputElement).value).toBe('9');
      expect((panel.getByLabelText(`End date for Product ${n}`) as HTMLInputElement).value).toBe(END);
      expect((panel.getByLabelText(`Start date for Product ${n}`) as HTMLInputElement).value).toBe(qatarToday());
    }
    fireEvent.change(panel.getByLabelText('Promo price for Product p2'), { target: { value: '12' } });
    expect((panel.getByLabelText('Promo price for Product p2') as HTMLInputElement).value).toBe('12');
    expect((panel.getByLabelText('Promo price for Product p1') as HTMLInputElement).value).toBe('9');
    expect(panel.getByTestId('offer-counts').textContent).toBe('2 valid · 0 with problems');
  });

  it('checks each row and marks the ones with problems; the others are still ready', async () => {
    renderCatalogue();
    const panel = await openWith(['p1', 'p2', 'p3']);
    const check = (n: string) => rowOf(panel, `Product ${n}`).getByTestId('row-check').textContent;
    expect(check('p1')).toContain('Enter a promo price');
    expect(check('p1')).toContain('Enter an end date');
    expect(check('p3')).toContain('Product is not active');

    fireEvent.change(panel.getByLabelText('Promo price for Product p1'), { target: { value: '10' } });
    fireEvent.change(panel.getByLabelText('End date for Product p1'), { target: { value: END } });
    expect(check('p1')).toBe('Promo price must be below the normal price (10.00 QAR)');
    fireEvent.change(panel.getByLabelText('Promo price for Product p1'), { target: { value: '0' } });
    expect(check('p1')).toBe('Promo price must be above 0');
    fireEvent.change(panel.getByLabelText('Promo price for Product p1'), { target: { value: '8' } });
    fireEvent.change(panel.getByLabelText('Start date for Product p1'), { target: { value: '2099-12-31' } });
    fireEvent.change(panel.getByLabelText('End date for Product p1'), { target: { value: '2099-12-01' } });
    expect(check('p1')).toBe('End date is before the start date');
    fireEvent.change(panel.getByLabelText('Start date for Product p1'), { target: { value: qatarToday() } });
    fireEvent.change(panel.getByLabelText('End date for Product p1'), { target: { value: '2000-01-01' } });
    expect(check('p1')).toBe('End date is in the past');
    fireEvent.change(panel.getByLabelText('End date for Product p1'), { target: { value: END } });
    expect(check('p1')).toBe('Ready');

    expect(panel.getByText('Product p1').closest('tr')!.hasAttribute('data-problem')).toBe(false);
    expect(panel.getByText('Product p3').closest('tr')!.hasAttribute('data-problem')).toBe(true);
    expect(panel.getByTestId('offer-counts').textContent).toBe('1 valid · 2 with problems (left out)');
    expect((panel.getByRole('button', { name: 'Preview 1 row' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Enter moves to the next cell; Esc asks before discarding unsaved changes', async () => {
    renderCatalogue();
    const panel = await openWith(['p1', 'p2']);
    const price = panel.getByLabelText('Promo price for Product p1');
    expect(document.activeElement).toBe(price);
    fireEvent.keyDown(price, { key: 'Enter' });
    expect(document.activeElement).toBe(panel.getByLabelText('Start date for Product p1'));
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(document.activeElement).toBe(panel.getByLabelText('Promo price for Product p2'));

    fireEvent.change(price, { target: { value: '8' } });
    fireEvent.keyDown(price, { key: 'Escape' });
    const confirm = await screen.findByRole('dialog', { name: 'Unsaved changes' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: /^Bulk offer:/ })).toBeTruthy();
    fireEvent.keyDown(price, { key: 'Escape' });
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Unsaved changes' })).getByRole('button', { name: 'Close and discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Bulk offer:/ })).toBeNull());
  });

  it('Esc closes at once when nothing was changed', async () => {
    renderCatalogue();
    const panel = await openWith(['p1']);
    fireEvent.keyDown(panel.getByLabelText('Promo price for Product p1'), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /^Bulk offer:/ })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull();
  });
});

describe('Bulk offer: preview and apply', () => {
  it('previews only the valid rows, shows the outcomes and warnings, and retries apply with the SAME key; then refreshes', async () => {
    let applies = 0;
    handler = (u, i) => {
      if (isPreview(u, method(i))) {
        return ok({
          willChange: 1, unchanged: 0, rejected: 1, previewToken: 'tok-1',
          rows: [
            { productId: 'p1', nameEn: 'Product p1', outcome: 'rejected', reason: 'price_not_below_normal' },
            { productId: 'p2', nameEn: 'Product p2', outcome: 'set', warnings: [{ code: 'replaces_offer' }, { code: 'export_value_outranks', marketplaceId: 'talabat' }] },
          ],
        });
      }
      if (isApply(u, method(i))) {
        applies++;
        return applies === 1 ? fail(500, 'Server error')
          : ok({ willChange: 1, unchanged: 0, rejected: 1, replayed: false, operationId: 'op', rows: [{ productId: 'p1', nameEn: 'Product p1', outcome: 'rejected', reason: 'price_not_below_normal' }] });
      }
      return undefined;
    };
    const invalidate = renderCatalogue();
    const panel = await openWith(['p1', 'p2', 'p3']);
    fireEvent.change(panel.getByLabelText('Same promo price for all (QAR)'), { target: { value: '8.5' } });
    fireEvent.change(panel.getByLabelText('Same end date for all'), { target: { value: END } });
    fireEvent.click(panel.getByRole('button', { name: 'Apply to all rows' }));
    fireEvent.click(panel.getByRole('button', { name: 'Preview 2 rows' }));

    const preview = within(await panel.findByRole('region', { name: 'Preview' }));
    const today = qatarToday();
    expect(bodyOf(calls(isPreview)[0])).toEqual({ items: [
      { productId: 'p1', price: 8.5, validFrom: `${today}T00:00:00.000+03:00`, validUntil: `${END}T23:59:59.999+03:00` },
      { productId: 'p2', price: 8.5, validFrom: `${today}T00:00:00.000+03:00`, validUntil: `${END}T23:59:59.999+03:00` },
    ] });
    expect(preview.getByTestId('offer-will-change').textContent).toBe('1');
    expect(preview.getByTestId('offer-unchanged').textContent).toBe('0');
    expect(preview.getByTestId('offer-rejected').textContent).toBe('1');
    expect(preview.getByTestId('rejected-row').textContent).toContain('Promo price is not below the normal price');
    expect(preview.getByTestId('warning-replaces').textContent).toBe('1 product already has an offer; it is replaced.');
    expect(preview.getByTestId('warning-outranks').textContent).toBe('1 product has a pending export price on Talabat; it outranks the offer there.');

    fireEvent.click(panel.getByRole('button', { name: 'Apply 1 offer' }));
    expect((await panel.findByRole('alert')).textContent).toContain('trying again is safe');
    fireEvent.click(panel.getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('offer-done');

    const [first, second] = calls(isApply).map(bodyOf);
    expect(first.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second).toEqual({ items: bodyOf(calls(isPreview)[0]).items, idempotencyKey: first.idempotencyKey, previewToken: 'tok-1' });
    expect(screen.getByTestId('offer-done').textContent).toBe('Offers set on 1 product');
    expect(screen.getByTestId('offer-done-counts').textContent).toBe('0 unchanged, 1 rejected.');
    const keys = invalidate.mock.calls.map(c => JSON.stringify(c[0]?.queryKey));
    expect(keys).toEqual(expect.arrayContaining(['["products"]', '["pricing","active-offers"]', '["recon","summary"]']));
    // The ticks are cleared once applied.
    expect(screen.getByTestId('ticked-count').textContent).not.toContain('ticked');
  });

  it('an edit after the preview drops it, and a new preview gets a new key', async () => {
    handler = (u, i) => {
      if (isPreview(u, method(i))) return ok({ willChange: 1, unchanged: 0, rejected: 0, rows: [{ productId: 'p1', outcome: 'set' }] });
      if (isApply(u, method(i))) return ok({ willChange: 1, unchanged: 0, rejected: 0, replayed: true, rows: [] });
      return undefined;
    };
    renderCatalogue();
    const panel = await openWith(['p1']);
    fireEvent.change(panel.getByLabelText('Promo price for Product p1'), { target: { value: '8' } });
    fireEvent.change(panel.getByLabelText('End date for Product p1'), { target: { value: END } });
    fireEvent.click(panel.getByRole('button', { name: 'Preview 1 row' }));
    await panel.findByRole('region', { name: 'Preview' });
    fireEvent.change(panel.getByLabelText('Promo price for Product p1'), { target: { value: '7' } });
    expect(panel.queryByRole('region', { name: 'Preview' })).toBeNull();
    fireEvent.click(panel.getByRole('button', { name: 'Preview 1 row' }));
    await panel.findByRole('region', { name: 'Preview' });
    expect(bodyOf(calls(isPreview)[1]).items[0].price).toBe(7);
    fireEvent.click(panel.getByRole('button', { name: 'Apply 1 offer' }));
    expect((await screen.findByTestId('offer-done')).textContent).toBe('These offers had already been applied');
  });

  it('a preview error is shown in plain words and nothing is applied', async () => {
    handler = (u, i) => (isPreview(u, method(i)) ? fail(400, 'Offers are not available') : undefined);
    renderCatalogue();
    const panel = await openWith(['p1']);
    fireEvent.change(panel.getByLabelText('Promo price for Product p1'), { target: { value: '8' } });
    fireEvent.change(panel.getByLabelText('End date for Product p1'), { target: { value: END } });
    fireEvent.click(panel.getByRole('button', { name: 'Preview 1 row' }));
    expect((await panel.findByRole('alert')).textContent).toBe('We could not run the preview: Offers are not available');
    expect(calls(isApply)).toHaveLength(0);
  });
});

describe('Bulk offer: a server without the bulk offers API', () => {
  it('a 404 for the whole call says the API is missing, not that a product was not found', async () => {
    handler = (u, i) => (isPreview(u, method(i)) ? json(404, { error: { code: 'NOT_FOUND', message: 'Cannot POST /api/pricing/offers/bulk/preview' } }) : undefined);
    renderCatalogue();
    const panel = await openWith(['p1']);
    fireEvent.change(panel.getByLabelText('Promo price for Product p1'), { target: { value: '8' } });
    fireEvent.change(panel.getByLabelText('End date for Product p1'), { target: { value: END } });
    fireEvent.click(panel.getByRole('button', { name: 'Preview 1 row' }));
    const alert = (await panel.findByRole('alert')).textContent!;
    expect(alert).toContain('Bulk offers are not available on this server yet');
    expect(alert).not.toContain('product was not found');
    expect(calls(isApply)).toHaveLength(0);
  });
});

describe('Bulk offer: permissions and limits', () => {
  it('pricing.edit alone can tick rows and open it; it is disabled until rows are ticked', async () => {
    renderCatalogue();
    const button = await screen.findByRole('button', { name: 'Bulk offer…' });
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Bulk offer' })).toBeTruthy());
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('Tick rows to set an offer on them.');
    fireEvent.click(await screen.findByLabelText('Tick Product p1'));
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('without pricing.edit the button is disabled and says why', async () => {
    perms.delete('pricing.edit');
    perms.add('pricing.bulk');
    renderCatalogue();
    fireEvent.click(await screen.findByLabelText('Tick Product p1'));
    const button = screen.getByRole('button', { name: 'Bulk offer…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('You need permission to edit prices to set offers.')).toBeTruthy();
    expect(button.getAttribute('aria-describedby')).toBe('bulk-offer-reason');
  });

  it('with real pricing off (the default) there is no Bulk offer at all', async () => {
    vi.stubEnv('VITE_REAL_PRICING', '');
    renderCatalogue();
    await screen.findByText('Product p1');
    expect(screen.queryByRole('button', { name: 'Bulk offer…' })).toBeNull();
  });

  it('over 500 ticked rows the table does not open and points to the Excel template', async () => {
    const many = Array.from({ length: 501 }, (_, n) => item(`m${n}`));
    handler = (u, i) => (isList(u, method(i)) ? page(many) : undefined);
    renderCatalogue();
    fireEvent.click(await screen.findByLabelText('Tick every row shown'));
    fireEvent.click(screen.getByRole('button', { name: 'Bulk offer…' }));
    expect(screen.getByRole('alert').textContent).toContain('Too many for the table: use the Excel template.');
    expect(screen.queryByRole('dialog', { name: /^Bulk offer:/ })).toBeNull();
    fireEvent.click(screen.getByLabelText('Tick Product m0'));
    fireEvent.click(screen.getByRole('button', { name: 'Bulk offer…' }));
    expect(await screen.findByRole('heading', { name: 'Bulk offer: 500 products' })).toBeTruthy();
  });
});
