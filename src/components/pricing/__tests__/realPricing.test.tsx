// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ProductDetail, ProductItem } from '../../../api/products';
import type { CategoryNode } from '../../../api/categories';
import type { AdoptCounts, AdoptPreview, CategoryRule, PriceChainStep, PricingSettings, ProductPricingView } from '../../../api/pricing';

const perms = new Set<string>();
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ can: (p: string) => perms.has(p) }) }));
const app = { showToast: vi.fn(), openUploadModal: vi.fn(), navigate: vi.fn() };
vi.mock('../../../context/AppContext', () => ({ useApp: () => app }));
let demoUsed = false;
vi.mock('../../../demo', async orig => {
  const real = await orig<typeof import('../../../demo')>();
  return { ...real, useDemo: () => { demoUsed = true; return real.useDemo(); } };
});

import { INITIAL_PRODUCTS } from '../../../data/mockData';
import { INITIAL_CATEGORY_PRICE_RULES, INITIAL_PRICING_SETTINGS } from '../../../data/pricingData';
import { MarkupsView } from '../../views/MarkupsView';
import { CatalogueView } from '../../views/CatalogueView';
import { ProductDetailView } from '../../views/ProductDetailView';
import { fromQatarInput, toQatarInput } from '../../../lib/format';
import { ruleText } from '../shared';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json(200, { data });
const fail = (status: number, message: string, details?: unknown[]) => json(status, { error: { code: 'E', message, details } });

const UPDATED = '2026-11-01T18:30:00.000Z';
const SETTINGS: PricingSettings = {
  defaultRule: { mode: 'percent', value: 10 }, rounding: '0.25', perMarketplaceEnabled: false, compareReferenceDefault: 'marketplace',
  marketplaceRules: [], order: ['offer', 'product', 'subcategory', 'category', 'marketplace', 'default'], updatedAt: UPDATED,
};
const DAIRY = { id: 'cat_dairy', nameEn: 'Dairy', nameAr: null };
const MILK = { id: 'sub_milk', nameEn: 'Milk', nameAr: null };
const RULES: CategoryRule[] = [
  { categoryId: 'cat_dairy', subcategoryId: null, mode: 'fixed', value: 5, category: DAIRY, subcategory: null, updatedAt: UPDATED },
  { categoryId: 'cat_dairy', subcategoryId: 'sub_milk', mode: 'amount', value: -0.5, category: DAIRY, subcategory: MILK, updatedAt: UPDATED },
];
const TREE: CategoryNode[] = [
  { id: 'cat_dairy', parentId: null, nameEn: 'Dairy', nameAr: null, sort: 0, productCount: 4, children: [
    { id: 'sub_milk', parentId: 'cat_dairy', nameEn: 'Milk', nameAr: null, sort: 0, productCount: 2 },
  ] },
  { id: 'cat_snacks', parentId: null, nameEn: 'Snacks', nameAr: null, sort: 1, productCount: 0, children: [] },
];

type Handler = (url: string, init: RequestInit) => Response | Promise<Response | undefined> | undefined;
let handler: Handler;
let fetchMock: ReturnType<typeof vi.fn>;
const method = (i?: RequestInit) => i?.method ?? 'GET';
const calls = (pred: (url: string, method: string) => boolean) =>
  fetchMock.mock.calls.filter(([u, i]) => pred(String(u), method(i as RequestInit | undefined)));
const bodyOf = (c: unknown[]) => JSON.parse(String((c[1] as RequestInit).body));
const is = (m: string, path: string) => (u: string, mm: string) => mm === m && u.split('?')[0] === path;

/** Default backend for the pricing screen. */
const backend: Handler = (u, i) => {
  const m = method(i);
  if (is('GET', '/api/pricing/settings')(u, m)) return ok(SETTINGS);
  if (is('GET', '/api/pricing/category-rules')(u, m)) return ok(RULES);
  if (is('GET', '/api/categories')(u, m)) return ok(TREE);
  return undefined;
};

function renderAt(path: string, ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={ui} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
}
/** The message an input points to with aria-describedby. */
const errorOf = (el: HTMLElement) => {
  const id = el.getAttribute('aria-describedby');
  return id ? document.getElementById(id)?.textContent : undefined;
};

beforeEach(() => {
  vi.stubEnv('VITE_REAL_PRICING', 'true');
  vi.stubEnv('VITE_REAL_CATALOGUE', 'true');
  perms.clear();
  ['pricing.view', 'pricing.edit', 'products.view', 'products.edit'].forEach(p => perms.add(p));
  app.showToast.mockClear();
  demoUsed = false;
  handler = backend;
  fetchMock = vi.fn(async (u: string, i: RequestInit = {}) => (await handler(String(u), i)) ?? fail(404, 'not mocked'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('helpers', () => {
  it('formats rules in words and reads datetime inputs as Qatar time', () => {
    expect(ruleText({ mode: 'percent', value: 12.5 })).toBe('+12.5 % of ERP price');
    expect(ruleText({ mode: 'percent', value: -10 })).toBe('−10 % of ERP price');
    expect(ruleText({ mode: 'amount', value: 2 })).toBe('ERP price +2.00 QAR');
    expect(ruleText({ mode: 'fixed', value: 12.5 })).toBe('Fixed 12.50 QAR');
    expect(ruleText({ mode: 'same' })).toBe('Same as ERP price');
    expect(fromQatarInput('2026-11-05T10:00')).toBe('2026-11-05T10:00:00+03:00');
    expect(fromQatarInput('')).toBeNull();
    expect(toQatarInput('2026-11-05T07:00:00.000Z')).toBe('2026-11-05T10:00');
    expect(toQatarInput(null)).toBe('');
  });
});

describe('Pricing settings (PRC-001)', () => {
  it('shows a skeleton, then the settings, the parity warning and the category rules', async () => {
    renderAt('/pricing', <MarkupsView />);
    expect(screen.getByRole('status', { name: 'Loading pricing settings…' })).toBeTruthy();

    const mode = await screen.findByLabelText('Default rule') as HTMLSelectElement;
    expect(mode.value).toBe('percent');
    expect((screen.getByLabelText('Percent (%)') as HTMLInputElement).value).toBe('10');
    expect((screen.getByLabelText('Rounding') as HTMLSelectElement).value).toBe('0.25');
    expect((screen.getByRole('radio', { name: 'My pricing' }) as HTMLInputElement).checked).toBe(true);
    const perMp = within(screen.getByRole('region', { name: 'Different price per marketplace' }));
    expect((perMp.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(perMp.getByText(/many marketplace contracts require the same price everywhere/)).toBeTruthy();
    expect(screen.getByText('Last changed 01 Nov 2026, 21:30 (Qatar time)')).toBeTruthy();

    const rules = within(screen.getByRole('region', { name: 'Category rules' }));
    const whole = (await rules.findByText('Dairy')).closest('tr')!;
    expect(whole.textContent).toContain('(whole category)');
    expect(whole.textContent).toContain('Fixed 5.00 QAR');
    expect(rules.getByText('Dairy › Milk').closest('tr')!.textContent).toContain('ERP price −0.50 QAR');
    expect(calls(is('GET', '/api/categories'))).toHaveLength(0); // the tree loads only for the add/change form
    expect(demoUsed).toBe(false);
  });

  it('saves only the changed settings and shows the result', async () => {
    // The server keeps what was saved; each save moves updatedAt.
    let current: PricingSettings = SETTINGS;
    let saves = 0;
    handler = (u, i) => {
      if (is('PUT', '/api/pricing/settings')(u, method(i))) {
        current = { ...current, ...bodyOf([u, i]), updatedAt: new Date(Date.parse('2026-11-02T06:00:00.000Z') + 60_000 * saves++).toISOString() };
        return ok(current);
      }
      return backend(u, i);
    };
    renderAt('/pricing', <MarkupsView />);
    await screen.findByLabelText('Default rule');
    const save = screen.getByRole('button', { name: 'Save pricing' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Rounding'), { target: { value: 'exact' } });
    fireEvent.click(save);
    await waitFor(() => expect(calls(is('PUT', '/api/pricing/settings'))).toHaveLength(1));
    expect(bodyOf(calls(is('PUT', '/api/pricing/settings'))[0])).toEqual({ rounding: 'exact' });
    expect(await screen.findByText('Last changed 02 Nov 2026, 09:00 (Qatar time)')).toBeTruthy();
    expect(app.showToast).toHaveBeenCalledWith('Pricing saved. The comparison will refresh shortly.', 'success');

    fireEvent.change(screen.getByLabelText('Percent (%)'), { target: { value: '15' } });
    fireEvent.click(within(screen.getByRole('region', { name: 'Different price per marketplace' })).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('radio', { name: 'ERP price (advanced)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save pricing' }));
    await waitFor(() => expect(calls(is('PUT', '/api/pricing/settings'))).toHaveLength(2));
    expect(bodyOf(calls(is('PUT', '/api/pricing/settings'))[1])).toEqual({
      defaultRule: { mode: 'percent', value: 15 }, perMarketplaceEnabled: true, compareReferenceDefault: 'erp',
    });

    fireEvent.change(screen.getByLabelText('Default rule'), { target: { value: 'same' } });
    expect(screen.queryByLabelText('Percent (%)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save pricing' }));
    await waitFor(() => expect(calls(is('PUT', '/api/pricing/settings'))).toHaveLength(3));
    expect(bodyOf(calls(is('PUT', '/api/pricing/settings'))[2])).toEqual({ defaultRule: { mode: 'same' } });
  });

  it('shows API field errors under the field, and a missing value without calling the API', async () => {
    handler = (u, i) => (is('PUT', '/api/pricing/settings')(u, method(i))
      ? fail(400, 'Validation failed', [{ path: 'defaultRule.value', message: 'Too big: expected number to be <=1000' }])
      : backend(u, i));
    renderAt('/pricing', <MarkupsView />);
    const value = await screen.findByLabelText('Percent (%)');
    fireEvent.change(value, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save pricing' }));
    expect(errorOf(screen.getByLabelText('Percent (%)'))).toBe('Enter a value');
    expect(calls(is('PUT', '/api/pricing/settings'))).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Percent (%)'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save pricing' }));
    await waitFor(() => expect(errorOf(screen.getByLabelText('Percent (%)'))).toBe('Too big: expected number to be <=1000'));
    expect(screen.getByLabelText('Percent (%)').getAttribute('aria-invalid')).toBe('true');
  });

  it('shows error, retry and empty states', async () => {
    let failing = true;
    handler = (u, i) => {
      if (is('GET', '/api/pricing/settings')(u, method(i)) && failing) return fail(500, 'Database unavailable');
      if (is('GET', '/api/pricing/category-rules')(u, method(i))) return failing ? fail(500, 'Rules down') : ok([]);
      return backend(u, i);
    };
    renderAt('/pricing', <MarkupsView />);
    const settingsAlert = (await screen.findByText('We could not load the pricing settings')).closest('[role="alert"]') as HTMLElement;
    expect(settingsAlert.textContent).toContain('contact support');
    await waitFor(() => expect(screen.getByRole('region', { name: 'Category rules' }).textContent).toContain('We could not load the category rules'));
    failing = false;
    fireEvent.click(within(settingsAlert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Default rule')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('region', { name: 'Category rules' })).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No category rules yet')).toBeTruthy();
  });

  it('pricing.view without pricing.edit: read only, no actions, no wizard', async () => {
    perms.delete('pricing.edit');
    renderAt('/pricing', <MarkupsView />);
    expect((await screen.findByLabelText('Default rule') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Rounding') as HTMLSelectElement).disabled).toBe(true);
    expect((within(screen.getByRole('region', { name: 'Different price per marketplace' })).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('You can view the pricing but not change it.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save pricing' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Adopt current marketplace prices/ })).toBeNull();
    await screen.findByText('Dairy › Milk');
    expect(screen.queryByRole('button', { name: 'Add category rule' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Change rule for/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove rule for/ })).toBeNull();
  });

  it('adds a subcategory rule, with client and API errors under the fields', async () => {
    let reply: Response = fail(400, 'The subcategory does not belong to the chosen category');
    handler = (u, i) => (is('PUT', '/api/pricing/category-rules')(u, method(i)) ? reply : backend(u, i));
    renderAt('/pricing', <MarkupsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add category rule' }));
    const form = within(screen.getByRole('form', { name: 'Add category rule' }));
    fireEvent.click(form.getByRole('button', { name: 'Add rule' }));
    expect(errorOf(form.getByLabelText('Category'))).toBe('Choose a category');
    expect(calls(is('PUT', '/api/pricing/category-rules'))).toHaveLength(0);

    await form.findByRole('option', { name: 'Snacks' });
    fireEvent.change(form.getByLabelText('Category'), { target: { value: 'cat_dairy' } });
    fireEvent.change(form.getByLabelText('Subcategory'), { target: { value: 'sub_milk' } });
    fireEvent.change(form.getByLabelText('Rule'), { target: { value: 'percent' } });
    fireEvent.change(form.getByLabelText('Percent (%)'), { target: { value: '5' } });
    fireEvent.click(form.getByRole('button', { name: 'Add rule' }));
    expect((await form.findByRole('alert')).textContent).toBe('The subcategory does not belong to the chosen category');
    expect(bodyOf(calls(is('PUT', '/api/pricing/category-rules'))[0])).toEqual({ mode: 'percent', value: 5, categoryId: 'cat_dairy', subcategoryId: 'sub_milk' });

    reply = fail(400, 'Validation failed', [{ path: 'value', message: 'Too small: expected number to be >=-90' }]);
    fireEvent.change(form.getByLabelText('Percent (%)'), { target: { value: '-85' } });
    fireEvent.click(form.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(errorOf(form.getByLabelText('Percent (%)'))).toBe('Too small: expected number to be >=-90'));

    reply = ok({ categoryId: 'cat_dairy', subcategoryId: 'sub_milk', mode: 'percent', value: 5 });
    const before = calls(is('GET', '/api/pricing/category-rules')).length;
    fireEvent.change(form.getByLabelText('Percent (%)'), { target: { value: '5' } });
    fireEvent.click(form.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add category rule' })).toBeNull());
    expect(app.showToast).toHaveBeenCalledWith('Category rule added', 'success');
    await waitFor(() => expect(calls(is('GET', '/api/pricing/category-rules')).length).toBeGreaterThan(before));
  });

  it('changes and removes a category rule', async () => {
    let del: Response = fail(404, 'No price rule for this category');
    handler = (u, i) => {
      if (is('PUT', '/api/pricing/category-rules')(u, method(i))) return ok({ categoryId: 'cat_dairy', subcategoryId: null, mode: 'fixed', value: 6 });
      if (is('DELETE', '/api/pricing/category-rules')(u, method(i))) return del;
      return backend(u, i);
    };
    renderAt('/pricing', <MarkupsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change rule for Dairy' }));
    const form = within(screen.getByRole('form', { name: 'Change category rule' }));
    expect((form.getByLabelText('Category') as HTMLSelectElement).disabled).toBe(true);
    expect((form.getByLabelText('Price (QAR)') as HTMLInputElement).value).toBe('5');
    fireEvent.change(form.getByLabelText('Price (QAR)'), { target: { value: '6' } });
    fireEvent.click(form.getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(calls(is('PUT', '/api/pricing/category-rules'))).toHaveLength(1));
    expect(bodyOf(calls(is('PUT', '/api/pricing/category-rules'))[0])).toEqual({ mode: 'fixed', value: 6, categoryId: 'cat_dairy', subcategoryId: null });

    fireEvent.click(screen.getByRole('button', { name: 'Remove rule for Dairy › Milk' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Remove category rule' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Remove rule' }));
    expect((await dialog.findByRole('alert')).textContent).toBe('No price rule for this category');
    const url = String(calls(is('DELETE', '/api/pricing/category-rules'))[0][0]);
    expect(Object.fromEntries(new URL(url, 'http://x').searchParams)).toEqual({ categoryId: 'cat_dairy', subcategoryId: 'sub_milk' });

    del = ok({ categoryId: 'cat_dairy', subcategoryId: 'sub_milk', deleted: true });
    fireEvent.click(dialog.getByRole('button', { name: 'Remove rule' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove category rule' })).toBeNull());
    expect(app.showToast).toHaveBeenCalledWith('Category rule removed', 'success');
  });

  it('keeps the demo screen when the flag is off', () => {
    vi.stubEnv('VITE_REAL_PRICING', '');
    // The demo screen reads its sample pricing from the app context: give it the demo's own starting data.
    Object.assign(app, {
      products: INITIAL_PRODUCTS, pricingSettings: INITIAL_PRICING_SETTINGS, categoryPriceRules: INITIAL_CATEGORY_PRICE_RULES,
      updatePricingSettings: vi.fn(), upsertCategoryPriceRule: vi.fn(), removeCategoryPriceRule: vi.fn(), bulkUpdatePrices: vi.fn(),
      getMarketplacePrice: () => ({ price: 0, source: 'default' }),
    });
    renderAt('/pricing', <MarkupsView />);
    expect(screen.getByRole('heading', { name: 'Pricing' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Pricing settings' })).toBeNull();
    expect(screen.queryByRole('status', { name: 'Loading pricing settings…' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ───────── Adopt current marketplace prices ─────────

const PREVIEW: AdoptPreview = {
  sourceMarketplaceId: 'snoonu', mode: 'percent', onlyWithoutRule: true, scope: { all: true },
  products: 20, willAdopt: 7, created: 7, replaced: 0, fixedFallback: 2, fallbacks: { rounding: 1, range: 1 },
  skipped: { no_listing: 4, non_positive_erp_price: 0, non_positive_listing_price: 0, has_rule: 2, has_offer: 0, offer_active: 0, unchanged: 0, unverifiable: 0 },
  conflicts: {
    products: 2, byMarketplace: { talabat: 2 },
    examples: [
      { productId: 'p1', nameEn: 'Milk 1L', barcode: '628001', marketplaceId: 'talabat', sourcePrice: 6.5, otherPrice: 7 },
      { productId: 'p2', nameEn: 'Bread', barcode: '628002', marketplaceId: 'talabat', sourcePrice: 3, otherPrice: 2.75 },
    ],
  },
  largestDifferences: [
    { productId: 'p3', nameEn: 'Rice 5kg', barcode: '628003', erpPrice: 30, currentPrice: 33, currentSource: 'default', newPrice: 36.5, difference: 3.5, rule: { mode: 'fixed', value: 36.5 }, fallback: 'rounding', previousRule: null },
  ],
  rows: [
    { productId: 'p1', nameEn: 'Milk 1L', barcode: '628001', erpPrice: 5, currentPrice: 5.5, currentSource: 'category', newPrice: 6.5, difference: 1, rule: { mode: 'percent', value: 30 }, fallback: null, previousRule: null },
    { productId: 'p2', nameEn: 'Bread', barcode: '628002', erpPrice: 2.5, currentPrice: 3.25, currentSource: 'default', newPrice: 3, difference: -0.25, rule: { mode: 'percent', value: 20 }, fallback: null, previousRule: null },
  ],
};
const COUNTS: AdoptCounts = {
  products: 20, adopted: 7, created: 7, replaced: 0, fixedFallback: 2, fallbacks: { rounding: 1, range: 1 },
  skipped: PREVIEW.skipped, conflicts: { products: 2, byMarketplace: { talabat: 2 } },
};

describe('Adopt current marketplace prices', () => {
  it('chooses, previews, confirms and applies with progress, then says the comparison will refresh', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    handler = async (u, i) => {
      if (is('POST', '/api/pricing/adopt/preview')(u, method(i))) return ok(PREVIEW);
      if (is('POST', '/api/pricing/adopt/apply')(u, method(i))) { await gate; return ok(COUNTS); }
      return backend(u, i);
    };
    renderAt('/pricing', <MarkupsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adopt current marketplace prices' }));
    const wizard = within(screen.getByRole('dialog', { name: 'Adopt current marketplace prices' }));
    expect(wizard.getByText(/earlier rules are not overwritten/)).toBeTruthy();
    fireEvent.click(wizard.getByRole('radio', { name: 'Snoonu' }));
    fireEvent.click(wizard.getByRole('radio', { name: /Percent of ERP price/ }));
    fireEvent.click(wizard.getByRole('button', { name: 'Run preview' }));

    const preview = within(await wizard.findByRole('region', { name: 'Preview' }));
    const body = { sourceMarketplaceId: 'snoonu', mode: 'percent', onlyWithoutRule: true, scope: { all: true } };
    expect(bodyOf(calls(is('POST', '/api/pricing/adopt/preview'))[0])).toEqual(body);
    expect(preview.getByTestId('preview-products').textContent).toBe('20');
    expect(preview.getByTestId('preview-will-adopt').textContent).toBe('7');
    expect(preview.getByTestId('preview-skipped').textContent).toBe('6');
    expect(preview.getByTestId('preview-conflicts').textContent).toBe('2');
    expect(preview.getByTestId('preview-fallbacks').textContent).toContain('2 products get a fixed price instead of a percent');

    const skipped = within(preview.getByRole('region', { name: 'Skipped products' }));
    expect(skipped.getAllByRole('listitem').map(li => li.textContent)).toEqual(['Not listed on Snoonu4', 'Already has its own price rule (kept as it is)2']);

    const conflicts = within(preview.getByRole('region', { name: 'Price differs on other marketplaces' }));
    expect(conflicts.getByText(/2 adopted products are listed at a different price elsewhere \(Talabat 2\)/)).toBeTruthy();
    expect(conflicts.getByRole('columnheader', { name: 'Snoonu price (QAR)' })).toBeTruthy();
    const milk = conflicts.getByText('Milk 1L').closest('tr')!;
    expect(milk.textContent).toContain('6.50');
    expect(milk.textContent).toContain('7.00');

    const largest = within(preview.getByRole('region', { name: 'Largest changes' }));
    const rice = largest.getByText('Rice 5kg').closest('tr')!;
    expect(within(rice).getByTestId('adopt-difference').textContent).toBe('+3.50');
    expect(rice.textContent).toContain('Fixed 36.50 QAR');
    expect(rice.textContent).toContain('Fixed instead of percent (rounding)');
    expect(within(rice).getByTestId('price-source').textContent).toBe('Default rule');
    const first = within(preview.getByRole('region', { name: 'First products' }));
    expect(first.getAllByTestId('adopt-row')).toHaveLength(2);
    expect(within(first.getByText('Bread').closest('tr')!).getByTestId('adopt-difference').textContent).toBe('−0.25');
    expect(first.getByRole('columnheader', { name: 'New price (QAR)' })).toBeTruthy();
    expect(calls(is('POST', '/api/pricing/adopt/apply'))).toHaveLength(0);

    // Explicit confirmation, then apply.
    fireEvent.click(wizard.getByRole('button', { name: 'Adopt 7 prices…' }));
    const confirm = within(screen.getByRole('dialog', { name: 'Create price rules' }));
    expect(confirm.getByText(/This creates/).textContent).toContain('This creates 7 product price rules (percent of erp price) from Snoonu');
    expect(confirm.getByText(/Earlier rules are not overwritten/)).toBeTruthy();
    fireEvent.click(confirm.getByRole('button', { name: 'Create 7 rules' }));

    expect(await screen.findByRole('progressbar', { name: 'Adopting prices' })).toBeTruthy();
    expect(bodyOf(calls(is('POST', '/api/pricing/adopt/apply'))[0])).toEqual(body);
    release();

    const done = await screen.findByRole('status', { name: 'Prices adopted' });
    expect(done.textContent).toContain('7 price rules created from Snoonu');
    expect(done.textContent).toContain('The reconciliation will refresh shortly');
    fireEvent.click(within(done).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Adopt current marketplace prices' })).toBeNull();
  });

  it('cancelling the confirmation applies nothing; preview and apply errors are shown', async () => {
    let previewReply: Response = fail(400, 'Category not found');
    handler = (u, i) => {
      if (is('POST', '/api/pricing/adopt/preview')(u, method(i))) return previewReply;
      if (is('POST', '/api/pricing/adopt/apply')(u, method(i))) return fail(500, 'Timed out.');
      return backend(u, i);
    };
    renderAt('/pricing', <MarkupsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adopt current marketplace prices' }));
    const wizard = within(screen.getByRole('dialog', { name: 'Adopt current marketplace prices' }));
    fireEvent.click(wizard.getByRole('button', { name: 'Run preview' }));
    expect((await wizard.findByRole('alert')).textContent).toBe('We could not run the preview: Category not found');
    expect(bodyOf(calls(is('POST', '/api/pricing/adopt/preview'))[0])).toMatchObject({ sourceMarketplaceId: 'talabat', mode: 'fixed' });

    previewReply = ok({ ...PREVIEW, sourceMarketplaceId: 'talabat', mode: 'fixed' });
    fireEvent.click(wizard.getByRole('button', { name: 'Run preview' }));
    fireEvent.click(await wizard.findByRole('button', { name: 'Adopt 7 prices…' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Create price rules' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Create price rules' })).toBeNull();
    expect(calls(is('POST', '/api/pricing/adopt/apply'))).toHaveLength(0);

    fireEvent.click(wizard.getByRole('button', { name: 'Adopt 7 prices…' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Create price rules' })).getByRole('button', { name: 'Create 7 rules' }));
    expect((await wizard.findByRole('alert')).textContent).toBe('We could not adopt the prices: Timed out. Nothing was changed.');
  });

  it('a preview with nothing to adopt offers no apply', async () => {
    handler = (u, i) => (is('POST', '/api/pricing/adopt/preview')(u, method(i))
      ? ok({ ...PREVIEW, sourceMarketplaceId: 'talabat', mode: 'fixed', willAdopt: 0, created: 0, fixedFallback: 0, conflicts: { products: 0, byMarketplace: {}, examples: [] }, largestDifferences: [], rows: [], skipped: { ...PREVIEW.skipped, unchanged: 14 } })
      : backend(u, i));
    renderAt('/pricing', <MarkupsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adopt current marketplace prices' }));
    const wizard = within(screen.getByRole('dialog', { name: 'Adopt current marketplace prices' }));
    fireEvent.click(wizard.getByRole('button', { name: 'Run preview' }));
    expect(await wizard.findByText(/Nothing to adopt/)).toBeTruthy();
    expect(wizard.getByText('Already priced this way')).toBeTruthy();
    expect(wizard.queryByRole('button', { name: /Adopt \d+ price/ })).toBeNull();
    expect(wizard.queryByRole('region', { name: 'Price differs on other marketplaces' })).toBeNull();
  });
});

// ───────── Catalogue and product detail ─────────

const item = (id: string, over: Partial<ProductItem> = {}): ProductItem => ({
  id, barcode: `6281000${id}`, sku: null, nameEn: `Product ${id}`, nameAr: 'منتج', brand: null, erpCategory: null,
  categoryId: null, subcategoryId: null, erpPrice: 10, erpStock: 7, status: 'active', inLatestErpFile: true, updatedAt: UPDATED, ...over,
});
const CHAIN: PriceChainStep[] = [
  { source: 'offer', status: 'applied', price: 13, offer: { price: 13, validFrom: UPDATED, validUntil: null } },
  { source: 'product', status: 'overridden', price: 12, rule: { mode: 'fixed', value: 12 } },
  { source: 'subcategory', status: 'not_set' },
  { source: 'category', status: 'overridden', price: 11.25, rule: { mode: 'percent', value: 12.5 }, rounding: '0.25' },
  { source: 'marketplace', status: 'disabled' },
  { source: 'default', status: 'overridden', price: 11, rule: { mode: 'percent', value: 10 }, rounding: '0.25' },
];
const VIEW: ProductPricingView = {
  marketplacePrice: { price: 13, source: 'offer' },
  pricing: {
    order: ['offer', 'product', 'subcategory', 'category', 'marketplace', 'default'],
    productRule: { mode: 'fixed', value: 12, updatedAt: UPDATED },
    offer: { price: 13, validFrom: UPDATED, validUntil: null, updatedAt: UPDATED, state: 'valid' },
    chain: CHAIN,
    marketplaces: [],
  },
};
const detail = (over: Partial<ProductDetail> = {}): ProductDetail => ({
  ...item('p1'), size: null, erpActive: true, createdAt: UPDATED, category: null, subcategory: null, listings: [],
  arabicNameMissing: false, categoryMissing: true, ...VIEW, ...over,
});

describe('catalogue marketplace price', () => {
  const list = (items: ProductItem[]) => ok({ items, nextCursor: null, counts: { all: items.length, active: items.length, inactive: 0, new: 0, missing: 0 } });

  it('shows the resolved price with its source in words and an icon, QAR in the header', async () => {
    handler = (u, i) => (u.startsWith('/api/products?') ? list([item('1', { marketplacePrice: { price: 13, source: 'offer' } }), item('2', { marketplacePrice: { price: 11, source: 'subcategory' } })]) : backend(u, i));
    renderAt('/catalogue', <CatalogueView />);
    const row = within((await screen.findByText('Product 1')).closest('tr')!);
    expect(screen.getByRole('columnheader', { name: 'Expected price (QAR) The price your pricing rules give this product' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'ERP price (QAR)' })).toBeTruthy();
    expect(row.getByTestId('marketplace-price').textContent).toBe('13.00Offer');
    expect(row.getByTestId('price-source').querySelector('svg')).toBeTruthy();
    expect(row.getByText('10.00')).toBeTruthy();
    expect(within(screen.getByText('Product 2').closest('tr')!).getByTestId('price-source').textContent).toBe('Subcategory rule');
  });

  it('without pricing.view there is no marketplace price column', async () => {
    perms.delete('pricing.view');
    handler = (u, i) => (u.startsWith('/api/products?') ? list([item('1')]) : backend(u, i));
    renderAt('/catalogue', <CatalogueView />);
    await screen.findByText('Product 1');
    expect(screen.queryByRole('columnheader', { name: 'Expected price (QAR) The price your pricing rules give this product' })).toBeNull();
  });
});

describe('product detail pricing', () => {
  const detailHandler = (extra?: Handler): Handler => async (u, i) => {
    const r = extra ? await extra(u, i) : undefined;
    if (r) return r;
    if (is('GET', '/api/products/p1')(u, method(i))) return ok(detail());
    return backend(u, i);
  };

  it('shows the marketplace price, its source and the full rule chain', async () => {
    handler = detailHandler();
    renderAt('/catalogue/p1', <ProductDetailView />);
    const panel = within(await screen.findByRole('region', { name: 'Expected price' }));
    expect(panel.getByRole('heading', { name: 'Expected price (QAR)' })).toBeTruthy();
    expect(panel.getByTestId('marketplace-price').textContent).toBe('13.00');
    expect(panel.getAllByTestId('price-source')[0].textContent).toBe('Offer');

    const steps = within(panel.getByRole('region', { name: 'Price rule chain' })).getAllByTestId('chain-step');
    expect(steps.map(s => [s.children[1].textContent, s.children[2].textContent])).toEqual([
      ['Offer', 'Applied'], ['Product rule', 'Overridden'], ['Subcategory rule', 'Not set'],
      ['Category rule', 'Overridden'], ['Marketplace rule', 'Off'], ['Default rule', 'Overridden'],
    ]);
    steps.forEach(s => expect(s.children[2].querySelector('svg')).toBeTruthy());
    expect(steps[0].textContent).toContain('Offer 13.00 QAR, from 01 Nov 2026, 21:30, no end date');
    expect(steps[3].textContent).toContain('11.25');
    expect(steps[3].textContent).toContain('+12.5 % of ERP price, round to 0.25');
    expect(steps[4].textContent).toContain('Different price per marketplace is off');
    expect(within(panel.getByRole('form', { name: 'Offer' })).getByTestId('offer-state').textContent).toBe('Running now');
    // The product's own rule is shown by the price editor (and the chain's product step above).
    expect(within(panel.getByRole('form', { name: 'Change the price' })).getByTestId('inline-current').textContent).toContain('Product price rule now: Fixed 12.00 QAR.');
    expect(screen.queryByRole('region', { name: 'Pricing rules' })).toBeNull(); // the old "Not available yet" card
  });

  it('has no separate product rule form any more: the price editor and the offer are the only forms', async () => {
    handler = detailHandler();
    renderAt('/catalogue/p1', <ProductDetailView />);
    const panel = within(await screen.findByRole('region', { name: 'Expected price' }));
    expect(panel.getAllByRole('form').map(f => f.getAttribute('aria-label'))).toEqual(['Change the price', 'Offer']);
    expect(screen.queryByRole('form', { name: 'Product price rule' })).toBeNull();
    expect(panel.queryByRole('button', { name: 'Save rule' })).toBeNull();
    expect(panel.queryByRole('button', { name: 'Remove rule' })).toBeNull();
    expect(panel.queryByLabelText('Rule')).toBeNull();
    expect(calls((u, m) => m !== 'GET')).toHaveLength(0);
    expect(calls(u => u.includes('/price-rule'))).toHaveLength(0);
  });

  it('sets an offer with Qatar-time dates, shows date errors under the field, and clears it', async () => {
    let reply: Response = fail(400, 'Validation failed', [{ path: 'validUntil', message: 'This offer has already ended' }]);
    handler = detailHandler((u, i) => {
      if (is('PUT', '/api/products/p1/offer')(u, method(i))) return reply;
      if (is('DELETE', '/api/products/p1/offer')(u, method(i))) return ok({ marketplacePrice: { price: 12, source: 'product' }, pricing: { ...VIEW.pricing, offer: null } });
      return undefined;
    });
    renderAt('/catalogue/p1', <ProductDetailView />);
    const form = within(await screen.findByRole('form', { name: 'Offer' }));
    expect((form.getByLabelText('Offer price (QAR)') as HTMLInputElement).value).toBe('13');
    expect((form.getByLabelText('Starts (Qatar time, optional)') as HTMLInputElement).value).toBe('2026-11-01T21:30');

    fireEvent.change(form.getByLabelText('Offer price (QAR)'), { target: { value: '' } });
    fireEvent.click(form.getByRole('button', { name: 'Save offer' }));
    expect(errorOf(form.getByLabelText('Offer price (QAR)'))).toBe('Enter a price');
    expect(calls(is('PUT', '/api/products/p1/offer'))).toHaveLength(0);

    fireEvent.change(form.getByLabelText('Offer price (QAR)'), { target: { value: '9.5' } });
    fireEvent.change(form.getByLabelText('Starts (Qatar time, optional)'), { target: { value: '2026-11-05T10:00' } });
    fireEvent.change(form.getByLabelText('Ends (Qatar time, optional)'), { target: { value: '2026-11-01T10:00' } });
    fireEvent.click(form.getByRole('button', { name: 'Save offer' }));
    await waitFor(() => expect(errorOf(form.getByLabelText('Ends (Qatar time, optional)'))).toBe('This offer has already ended'));
    expect(bodyOf(calls(is('PUT', '/api/products/p1/offer'))[0])).toEqual({ price: 9.5, validFrom: '2026-11-05T10:00:00+03:00', validUntil: '2026-11-01T10:00:00+03:00' });

    reply = ok({ marketplacePrice: { price: 13, source: 'offer' }, pricing: { ...VIEW.pricing, offer: { price: 9.5, validFrom: '2026-11-05T07:00:00.000Z', validUntil: null, updatedAt: '2026-11-02T06:00:00.000Z', state: 'scheduled' } } });
    fireEvent.change(form.getByLabelText('Ends (Qatar time, optional)'), { target: { value: '' } });
    fireEvent.click(form.getByRole('button', { name: 'Save offer' }));
    await waitFor(() => expect(within(screen.getByRole('form', { name: 'Offer' })).getByTestId('offer-state').textContent).toBe('Scheduled'));
    expect(bodyOf(calls(is('PUT', '/api/products/p1/offer'))[1])).toEqual({ price: 9.5, validFrom: '2026-11-05T10:00:00+03:00', validUntil: null });
    expect(screen.getByText(/9.50 QAR · from 05 Nov 2026, 10:00 · no end date/)).toBeTruthy();

    fireEvent.click(within(screen.getByRole('form', { name: 'Offer' })).getByRole('button', { name: 'Clear offer' }));
    await waitFor(() => expect(screen.getByText('No offer. A running offer wins over every rule.')).toBeTruthy());
    expect(calls(is('DELETE', '/api/products/p1/offer'))).toHaveLength(1);
    expect(app.showToast).toHaveBeenCalledWith('Offer cleared', 'success');
  });

  it('without pricing.edit the chain is shown but nothing can be changed; without pricing.view there is no panel', async () => {
    perms.delete('pricing.edit');
    handler = detailHandler();
    renderAt('/catalogue/p1', <ProductDetailView />);
    const panel = within(await screen.findByRole('region', { name: 'Expected price' }));
    expect(panel.getAllByTestId('chain-step')).toHaveLength(6);
    expect(panel.queryByRole('button', { name: 'Save rule' })).toBeNull();
    expect(panel.queryByRole('button', { name: 'Save offer' })).toBeNull();
    expect(panel.queryByRole('button', { name: 'Clear offer' })).toBeNull();
    expect(panel.queryByLabelText('Offer price (QAR)')).toBeNull();
    cleanup();

    perms.delete('pricing.view');
    const { marketplacePrice: _m, pricing: _p, ...noPricing } = detail();
    handler = (u, i) => (is('GET', '/api/products/p1')(u, method(i)) ? ok(noPricing) : backend(u, i));
    renderAt('/catalogue/p1', <ProductDetailView />);
    await screen.findByRole('heading', { name: 'Product p1' });
    expect(screen.queryByRole('region', { name: 'Expected price' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Pricing rules' })).toBeNull();
  });

  it('shows a load error for the product', async () => {
    handler = (u, i) => (is('GET', '/api/products/p1')(u, method(i)) ? fail(500, 'Down') : backend(u, i));
    renderAt('/catalogue/p1', <ProductDetailView />);
    expect((await screen.findByRole('alert')).textContent).toContain('We could not load this product');
  });
});
