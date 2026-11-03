// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReconMarketplaceSummary, ReconRow, ReconSummary } from '../../../api/recon';

const perms = new Set<string>();
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ can: (p: string) => perms.has(p) }) }));
const app = {
  showToast: vi.fn(), openUploadModal: vi.fn(), navigate: vi.fn(),
  compareReference: 'marketplace', setCompareReference: vi.fn(),
};
vi.mock('../../../context/AppContext', () => ({ useApp: () => app }));
let demoUsed = false;
vi.mock('../../../demo', async orig => {
  const real = await orig<typeof import('../../../demo')>();
  // Real mode must never read the local demo store; the flag-off test uses it on purpose.
  return { ...real, useDemo: () => { demoUsed = true; return real.useDemo(); } };
});

import { DashboardView } from '../../views/DashboardView';
import { StockMismatchesView } from '../../views/StockMismatchesView';
import { PriceDiscrepanciesView } from '../../views/PriceDiscrepanciesView';
import { DemoProvider } from '../../../demo';
import { freshnessText, priceDifference, qatarDateTime, reconTiming } from '../shared';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json(200, { data });
const fail = (status: number, message: string) => json(status, { error: { code: 'E', message } });

const NOW = new Date('2026-11-02T09:00:00.000Z');
const COMPUTED = '2026-11-02T08:00:00.000Z';
const mp = (marketplaceId: ReconMarketplaceSummary['marketplaceId'], over: Partial<ReconMarketplaceSummary> = {}): ReconMarketplaceSummary => ({
  marketplaceId, hasData: true, stock: 0, price: 0, total: 0, listed: 10, notListed: 1, noData: 0, missingFromErp: 0, newCount: 0,
  lastUploadAt: '2026-11-02T07:00:00.000Z', stale: false, ...over,
});
// total is deliberately not stock + price here: the screens must show the server's total, never add it up.
const TALABAT = mp('talabat', { stock: 3, price: 2, total: 9, listed: 120, notListed: 4, missingFromErp: 2, newCount: 1, lastUploadAt: '2026-11-01T18:00:00.000Z', stale: true });
const SNOONU = mp('snoonu', { stock: 0, price: 1, total: 1 });
const KEETA = mp('keeta', { hasData: false, listed: 0, notListed: 0, noData: 50, lastUploadAt: null });
const summary = (over: Partial<ReconSummary> = {}): ReconSummary => ({
  reference: 'marketplace', computedAt: COMPUTED, marketplaces: [TALABAT, SNOONU, KEETA], ...over,
});
const row = (id: string, over: Partial<ReconRow> = {}): ReconRow => ({
  productId: id, barcode: `6281000${id}`, sku: null, nameEn: `Product ${id}`, nameAr: null, productStatus: 'active', erpStock: 0,
  status: 'mismatch', stockIssue: null, priceMismatch: false, priceMismatchVsErp: false, priceMismatchVsMarketplace: false,
  expectedPrice: 12.5, erpPrice: 11, marketplacePrice: 12.5, marketplacePriceSource: 'default', actualPrice: 12.5,
  erpAvailable: true, actualAvailable: true, lastUpdated: '2026-11-01T18:30:00.000Z', ...over,
});
const URGENT = row('1', { stockIssue: 'available_but_out_of_stock', erpAvailable: false, actualAvailable: true, erpStock: 0 });
const LOST = row('2', { stockIssue: 'unavailable_but_in_stock', erpAvailable: true, actualAvailable: false, erpStock: 14 });

type Handler = (url: string, init: RequestInit) => Response | Promise<Response | undefined> | undefined;
let handler: Handler;
let fetchMock: ReturnType<typeof vi.fn>;
const method = (i?: RequestInit) => i?.method ?? 'GET';
const calls = (pred: (url: string, method: string) => boolean) =>
  fetchMock.mock.calls.filter(([u, i]) => pred(String(u), method(i as RequestInit | undefined)));
const params = (u: string) => Object.fromEntries(new URL(u, 'http://x').searchParams);
const isSummary = (u: string, m: string) => m === 'GET' && u.startsWith('/api/recon/summary');
const isRows = (u: string, m: string) => m === 'GET' && u.startsWith('/api/recon/rows');
const isRecompute = (u: string, m: string) => m === 'POST' && u === '/api/recon/recompute';

const Where = () => { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search}</output>; };
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

/** Default backend: the summary (store default = marketplace) and Talabat's stock rows. */
const backend: Handler = (u, i) => {
  if (isSummary(u, method(i))) return ok(summary({ reference: (params(u).reference as ReconSummary['reference']) ?? 'marketplace' }));
  if (isRows(u, method(i))) return ok({ reference: params(u).reference ?? 'marketplace', items: [URGENT, LOST], nextCursor: null });
  return undefined;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('VITE_REAL_RECON', 'true');
  perms.clear();
  ['recon.view', 'reports.view', 'products.view', 'uploads.upload', 'pricing.edit'].forEach(p => perms.add(p));
  app.showToast.mockClear();
  app.openUploadModal.mockClear();
  demoUsed = false;
  reconTiming.pollMs = 3_000;
  reconTiming.timeoutMs = 120_000;
  handler = backend;
  fetchMock = vi.fn(async (u: string, i: RequestInit = {}) => (await handler(String(u), i)) ?? fail(404, 'not mocked'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const card = (name: string) => within(screen.getByRole('region', { name }));

describe('formatting', () => {
  it('shows times in Asia/Qatar, money differences in fils and freshness in hours', () => {
    expect(qatarDateTime('2026-11-01T18:30:00.000Z')).toBe('01 Nov 2026, 21:30');
    expect(priceDifference(13, 12.5)).toBe('+0.50');
    expect(priceDifference(0.1 + 0.2, 0.3)).toBe('0.00');
    expect(priceDifference(10, 12.345)).toBe('−2.35');
    expect(priceDifference(null, 12)).toBe('—');
    const at = NOW.getTime();
    expect(freshnessText({ marketplaceId: 'talabat', lastUploadAt: '2026-11-01T18:00:00.000Z' }, at)).toBe('Talabat data is 15 hours old');
    expect(freshnessText({ marketplaceId: 'snoonu', lastUploadAt: '2026-11-02T08:30:00.000Z' }, at)).toBe('Snoonu data is less than an hour old');
    expect(freshnessText({ marketplaceId: 'rafeeq', lastUploadAt: '2026-10-30T09:00:00.000Z' }, at)).toBe('Rafeeq data is 3 days old');
    expect(freshnessText({ marketplaceId: 'keeta', lastUploadAt: null }, at)).toBeUndefined();
  });
});

describe('dashboard (DASH-001)', () => {
  it('shows a skeleton, then one card per summarised marketplace with the server counts, freshness and needs attention', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    handler = async (u, i) => { if (isSummary(u, method(i))) await gate; return backend(u, i); };
    renderAt('/', <DashboardView />);
    expect(screen.getByRole('status', { name: 'Loading the comparison…' })).toBeTruthy();
    release();

    const talabat = await screen.findByRole('region', { name: 'Talabat' });
    expect(screen.getAllByRole('region').filter(r => ['Talabat', 'Snoonu', 'Rafeeq', 'Keeta'].includes(r.getAttribute('aria-label')!)).map(r => r.getAttribute('aria-label')))
      .toEqual(['Talabat', 'Snoonu', 'Keeta']);
    expect(params(calls(isSummary)[0][0] as string)).toEqual({}); // store default, no reference sent

    const t = within(talabat);
    expect(t.getByTestId('tile-total').textContent).toBe('9');
    expect(t.getByTestId('tile-stock').textContent).toBe('3');
    expect(t.getByTestId('tile-price').textContent).toBe('2');
    const fresh = t.getByTestId('freshness');
    expect(fresh.textContent).toContain('Talabat data is 15 hours old');
    expect(fresh.textContent).toContain('Out of date');
    expect(fresh.getAttribute('data-stale')).toBe('true');
    expect(fresh.className).toContain('amber');
    expect(t.getByText('Uploaded 01 Nov 2026, 21:00')).toBeTruthy();
    expect(card('Snoonu').getByTestId('freshness').textContent).toBe('Snoonu data is 2 hours old');
    expect(card('Snoonu').getByTestId('freshness').className).not.toContain('amber');

    // Needs attention: the server's order, urgent (red) before lost sales (amber), in words with an icon.
    const attention = within(t.getByRole('region', { name: 'Needs attention on Talabat' }));
    const items = await attention.findAllByTestId('attention-row');
    expect(items.map(li => li.getAttribute('data-issue'))).toEqual(['available_but_out_of_stock', 'unavailable_but_in_stock']);
    expect(items[0].textContent).toContain('Available but out of stock');
    expect(items[0].querySelector('span')!.className).toContain('red');
    expect(items[0].querySelector('svg')).toBeTruthy();
    expect(items[1].textContent).toContain('Lost sales');
    expect(items[1].querySelector('span')!.className).toContain('amber');
    expect(within(items[0]).getByRole('link', { name: 'Product 1' }).getAttribute('href')).toBe('/catalogue/1');
    expect(attention.getByRole('link', { name: /See all 3 stock issues/ }).getAttribute('href')).toBe('/reports/stock?marketplace=talabat&reference=marketplace');
    expect(t.getByRole('link', { name: 'Price: 2, open the report' }).getAttribute('href')).toBe('/reports/price?marketplace=talabat&reference=marketplace');

    // Only Talabat has stock issues: one rows request, for its 5 most urgent rows.
    expect(calls(isRows).map(c => params(c[0] as string))).toEqual([{ marketplaceId: 'talabat', type: 'stock', reference: 'marketplace', limit: '5' }]);
    expect(card('Snoonu').getByText('No stock issues on Snoonu.')).toBeTruthy();

    // A marketplace without a file: "No data", never zeros.
    const keeta = card('Keeta');
    expect(keeta.getByText('No data')).toBeTruthy();
    expect(keeta.getByText('Upload a Keeta file to compare')).toBeTruthy();
    expect(keeta.queryByTestId('tile-total')).toBeNull();
    expect(keeta.queryByText('0')).toBeNull();
    fireEvent.click(keeta.getByRole('button', { name: 'Upload Keeta file' }));
    expect(app.openUploadModal).toHaveBeenCalledWith('keeta');

    expect(screen.getByRole('button', { name: 'Marketplace price' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/Last compared 02 Nov 2026, 11:00/)).toBeTruthy();
    expect(demoUsed).toBe(false);
  });

  it('defaults the toggle to the store setting and refetches the summary for the other reference', async () => {
    handler = (u, i) => {
      if (isSummary(u, method(i))) {
        const ref = params(u).reference;
        return ok(ref === 'marketplace'
          ? summary({ reference: 'marketplace', marketplaces: [{ ...TALABAT, price: 7, total: 10 }] })
          : summary({ reference: 'erp', marketplaces: [TALABAT] }));
      }
      return backend(u, i);
    };
    renderAt('/', <DashboardView />);
    await screen.findByRole('region', { name: 'Talabat' });
    expect(screen.getByRole('button', { name: 'ERP price' }).getAttribute('aria-pressed')).toBe('true');
    expect(params(calls(isRows)[0][0] as string).reference).toBe('erp');

    fireEvent.click(screen.getByRole('button', { name: 'Marketplace price' }));
    await waitFor(() => expect(card('Talabat').getByTestId('tile-price').textContent).toBe('7'));
    expect(card('Talabat').getByTestId('tile-total').textContent).toBe('10');
    expect(params(calls(isSummary).at(-1)![0] as string)).toEqual({ reference: 'marketplace' });
    expect(screen.getByRole('button', { name: 'Marketplace price' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(params(calls(isRows).at(-1)![0] as string).reference).toBe('marketplace'));
  });

  it('shows an empty state when no marketplace has a summary', async () => {
    handler = (u, i) => (isSummary(u, method(i)) ? ok(summary({ marketplaces: [], computedAt: null })) : undefined);
    renderAt('/', <DashboardView />);
    expect(await screen.findByText('No comparison yet')).toBeTruthy();
    expect(screen.getByText(/Last compared never/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload ERP file' })).toBeTruthy();
  });

  it('shows the error with a retry', async () => {
    let failing = true;
    handler = (u, i) => (isSummary(u, method(i)) && failing ? fail(500, 'Database unavailable') : backend(u, i));
    renderAt('/', <DashboardView />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('We could not load the comparison');
    expect(alert.textContent).toContain('share the Request ID with support');
    failing = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Talabat' })).toBeTruthy();
  });

  it('shows an error inside a card when its needs-attention rows fail', async () => {
    handler = (u, i) => (isRows(u, method(i)) ? fail(500, 'boom') : backend(u, i));
    renderAt('/', <DashboardView />);
    const attention = within(await screen.findByRole('region', { name: 'Needs attention on Talabat' }));
    expect((await attention.findByRole('alert')).textContent).toContain('We could not load the stock issues');
    expect(card('Talabat').getByTestId('tile-stock').textContent).toBe('3');
  });

  it('runs a recompute, shows it in progress and clears when a newer summary arrives', async () => {
    reconTiming.pollMs = 20;
    let computedAt = COMPUTED;
    let polls = 0;
    handler = (u, i) => {
      if (isRecompute(u, method(i))) return ok({ queued: true });
      if (isSummary(u, method(i))) {
        polls++;
        return ok(summary({ computedAt, marketplaces: [{ ...TALABAT, stock: computedAt === COMPUTED ? 3 : 1 }, SNOONU] }));
      }
      return backend(u, i);
    };
    renderAt('/', <DashboardView />);
    await screen.findByRole('region', { name: 'Talabat' });
    const button = screen.getByRole('button', { name: 'Run comparison' });
    fireEvent.click(button);

    expect(await screen.findByText(/Recomputing the comparison/)).toBeTruthy();
    expect(calls(isRecompute)).toHaveLength(1);
    expect((screen.getByRole('button', { name: 'Run comparison' }) as HTMLButtonElement).disabled).toBe(true);
    const before = polls;
    await waitFor(() => expect(polls).toBeGreaterThan(before + 1)); // polling, still the old computedAt
    expect(screen.getByText(/Recomputing the comparison/)).toBeTruthy();

    computedAt = '2026-11-02T08:59:00.000Z';
    await waitFor(() => expect(screen.queryByText(/Recomputing the comparison/)).toBeNull());
    await waitFor(() => expect(card('Talabat').getByTestId('tile-stock').textContent).toBe('1'));
    expect(app.showToast).toHaveBeenCalledWith('The comparison is up to date', 'success');
    expect((screen.getByRole('button', { name: 'Run comparison' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says when a recompute takes too long, and reports a failed request', async () => {
    reconTiming.pollMs = 20;
    reconTiming.timeoutMs = -1;
    let recompute = ok({ queued: true });
    handler = (u, i) => (isRecompute(u, method(i)) ? recompute : backend(u, i));
    renderAt('/', <DashboardView />);
    await screen.findByRole('region', { name: 'Talabat' });
    fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }));
    expect(await screen.findByText(/taking longer than usual/)).toBeTruthy();
    cleanup();

    recompute = fail(403, 'Forbidden');
    reconTiming.timeoutMs = 120_000;
    renderAt('/', <DashboardView />);
    await screen.findByRole('region', { name: 'Talabat' });
    fireEvent.click(screen.getByRole('button', { name: 'Run comparison' }));
    await waitFor(() => expect(app.showToast).toHaveBeenCalledWith('We could not start the comparison: You do not have permission to do this.', 'error'));
    expect(screen.queryByText(/Recomputing the comparison/)).toBeNull();
  });

  it('hides what the permissions do not allow', async () => {
    perms.delete('pricing.edit');
    perms.delete('uploads.upload');
    perms.delete('products.view');
    renderAt('/', <DashboardView />);
    const attention = within(await screen.findByRole('region', { name: 'Needs attention on Talabat' }));
    await attention.findAllByTestId('attention-row');
    expect(screen.queryByRole('button', { name: 'Run comparison' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload file' })).toBeNull();
    expect(card('Keeta').queryByRole('button', { name: 'Upload Keeta file' })).toBeNull();
    expect(card('Keeta').getByText('Upload a Keeta file to compare')).toBeTruthy();
    expect(attention.queryByRole('link', { name: 'Product 1' })).toBeNull();
    expect(attention.getByText('Product 1')).toBeTruthy();
    cleanup();

    perms.delete('recon.view');
    fetchMock.mockClear();
    renderAt('/', <DashboardView />);
    expect(screen.getByRole('alert').textContent).toContain('You do not have access to the comparison');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the demo dashboard when the flag is off', async () => {
    vi.stubEnv('VITE_REAL_RECON', '');
    renderAt('/', <DemoProvider><DashboardView /></DemoProvider>);
    expect(screen.getByText('Data sources')).toBeTruthy();
    expect(demoUsed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('stock report (RPT-001)', () => {
  it('lists rows from the server with the same counts as the dashboard, statuses in words and Qatar times', async () => {
    renderAt('/reports/stock?marketplace=talabat', <StockMismatchesView />);
    expect(screen.getByRole('status', { name: 'Loading the comparison…' })).toBeTruthy();
    const r1 = within((await screen.findByText('Product 1')).closest('tr')!);

    expect(params(calls(isRows)[0][0] as string)).toEqual({ marketplaceId: 'talabat', type: 'stock', reference: 'marketplace', limit: '50' });
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Talabat (3)', 'Snoonu (0)', 'Keeta (No data)']);
    const counts = screen.getByTestId('report-counts').textContent!;
    expect(counts).toContain('3 stock issues on Talabat');
    expect(counts).toContain('9 total (3 stock, 2 price)');
    expect(counts).toContain('Talabat data is 15 hours old (out of date)');

    expect(r1.getByTestId('stock-issue').textContent).toBe('Available but out of stock');
    expect(r1.getByTestId('stock-issue').querySelector('svg')).toBeTruthy();
    expect(r1.getByTestId('recon-status').textContent).toBe('Mismatch');
    expect(r1.getByTestId('recon-status').querySelector('svg')).toBeTruthy();
    expect(r1.getByText('Unavailable')).toBeTruthy();
    expect(r1.getByText('Available')).toBeTruthy();
    expect(r1.getByTestId('updated').textContent).toBe('01 Nov 2026, 21:30');
    const r2 = within(screen.getByText('Product 2').closest('tr')!);
    expect(r2.getByTestId('stock-issue').textContent).toBe('Lost sales');
    expect(r2.getByText('14')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Talabat' })).toBeTruthy();
  });

  it('filters by status and marketplace on the server, loads more by cursor and opens the product', async () => {
    handler = (u, i) => {
      if (isRows(u, method(i))) {
        const p = params(u);
        if (p.cursor === 'c2') return ok({ reference: 'marketplace', items: [row('9', { stockIssue: 'unavailable_but_in_stock' })], nextCursor: null });
        return ok({ reference: 'marketplace', items: [URGENT], nextCursor: 'c2' });
      }
      return backend(u, i);
    };
    renderAt('/reports/stock', <StockMismatchesView />);
    await screen.findByText('Product 1');
    expect(params(calls(isRows)[0][0] as string).marketplaceId).toBe('talabat'); // first marketplace by default

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Product 9');
    expect(params(calls(isRows).at(-1)![0] as string)).toMatchObject({ cursor: 'c2', marketplaceId: 'talabat', type: 'stock' });
    expect(screen.getByText('Product 1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'missing_from_erp' } });
    await waitFor(() => expect(params(calls(isRows).at(-1)![0] as string)).toMatchObject({ status: 'missing_from_erp', marketplaceId: 'talabat' }));
    expect(screen.getByTestId('where').textContent).toBe('/reports/stock?status=missing_from_erp');

    fireEvent.click(screen.getByRole('tab', { name: 'Snoonu (0)' }));
    await waitFor(() => expect(params(calls(isRows).at(-1)![0] as string)).toMatchObject({ marketplaceId: 'snoonu', status: 'missing_from_erp' }));

    fireEvent.click((await screen.findByText('Product 1')).closest('tr')!);
    expect(screen.getByTestId('where').textContent).toBe('/catalogue/1');
  });

  it('shows "No data" for a marketplace without a file and never asks for its rows', async () => {
    renderAt('/reports/stock?marketplace=keeta', <StockMismatchesView />);
    expect(await screen.findByText('Upload a Keeta file to compare')).toBeTruthy();
    expect(screen.getByText('No data')).toBeTruthy();
    expect(calls(isRows)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Upload Keeta file' }));
    expect(app.openUploadModal).toHaveBeenCalledWith('keeta');
  });

  it('shows empty, rows error with retry, and summary error states', async () => {
    let rows: Response | 'empty' = 'empty';
    handler = (u, i) => {
      if (isRows(u, method(i))) return rows === 'empty' ? ok({ reference: 'marketplace', items: [], nextCursor: null }) : rows;
      return backend(u, i);
    };
    renderAt('/reports/stock?marketplace=talabat', <StockMismatchesView />);
    expect(await screen.findByText('No stock issues on Talabat')).toBeTruthy();
    cleanup();

    rows = fail(400, 'Invalid cursor');
    renderAt('/reports/stock?marketplace=talabat', <StockMismatchesView />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('We could not load this report');
    expect(alert.textContent).toContain('Invalid cursor');
    rows = 'empty';
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No stock issues on Talabat')).toBeTruthy();
    cleanup();

    handler = (u, i) => (isSummary(u, method(i)) ? fail(500, 'Down') : undefined);
    fetchMock.mockClear();
    renderAt('/reports/stock', <StockMismatchesView />);
    expect((await screen.findByRole('alert')).textContent).toContain('We could not load the comparison');
    expect(calls(isRows)).toHaveLength(0);
  });

  it('without products.view rows are plain text and do not open the product; without recon.view nothing loads', async () => {
    perms.delete('products.view');
    renderAt('/reports/stock?marketplace=talabat', <StockMismatchesView />);
    fireEvent.click((await screen.findByText('Product 1')).closest('tr')!);
    expect(screen.queryByRole('link', { name: 'Product 1' })).toBeNull();
    expect(screen.getByTestId('where').textContent).toBe('/reports/stock?marketplace=talabat');
    cleanup();

    perms.delete('recon.view');
    fetchMock.mockClear();
    renderAt('/reports/stock', <StockMismatchesView />);
    expect(screen.getByRole('alert').textContent).toContain('You do not have access to the comparison');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the demo report when the flag is off', () => {
    vi.stubEnv('VITE_REAL_RECON', '');
    renderAt('/reports/stock', <DemoProvider><StockMismatchesView /></DemoProvider>);
    expect(screen.getByRole('heading', { name: 'Stock & Availability' })).toBeTruthy();
    expect(demoUsed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('price report (RPT-002)', () => {
  const priceRows = [
    row('5', { priceMismatch: true, expectedPrice: 12.5, actualPrice: 13, marketplacePriceSource: 'offer' }),
    row('6', { priceMismatch: true, expectedPrice: 8, actualPrice: null, actualAvailable: null, status: 'not_listed' }),
  ];
  it('shows money with 2 decimals and QAR in the headers, and the toggle sends the reference to summary and rows', async () => {
    handler = (u, i) => {
      if (isRows(u, method(i))) {
        const erp = params(u).reference === 'erp';
        return ok({ reference: erp ? 'erp' : 'marketplace', items: erp ? [row('5', { expectedPrice: 11, actualPrice: 13 })] : priceRows, nextCursor: null });
      }
      return backend(u, i);
    };
    renderAt('/reports/price?marketplace=talabat&reference=marketplace', <PriceDiscrepanciesView />);
    const r5 = within((await screen.findByText('Product 5')).closest('tr')!);
    expect(params(calls(isRows)[0][0] as string)).toEqual({ marketplaceId: 'talabat', type: 'price', reference: 'marketplace', limit: '50' });
    expect(screen.getByRole('columnheader', { name: 'Marketplace price (QAR)' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Talabat price (QAR)' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Difference (QAR)' })).toBeTruthy();
    expect(r5.getByTestId('expected').textContent).toBe('12.50');
    expect(r5.getByTestId('actual').textContent).toBe('13.00');
    expect(r5.getByTestId('difference').textContent).toBe('+0.50');
    expect(r5.getByText('Offer')).toBeTruthy();
    const r6 = within(screen.getByText('Product 6').closest('tr')!);
    expect(r6.getByTestId('actual').textContent).toBe('Not listed');
    expect(r6.getByTestId('recon-status').textContent).toBe('Not listed');
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Talabat (2)', 'Snoonu (1)', 'Keeta (No data)']);
    expect(screen.getByTestId('report-counts').textContent).toContain('2 price mismatches on Talabat');
    expect(screen.getByRole('button', { name: 'Marketplace price' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'ERP price' }));
    await screen.findByRole('columnheader', { name: 'ERP price (QAR)' });
    await waitFor(() => expect(within(screen.getByText('Product 5').closest('tr')!).getByTestId('expected').textContent).toBe('11.00'));
    expect(params(calls(isSummary).at(-1)![0] as string)).toEqual({ reference: 'erp' });
    expect(params(calls(isRows).at(-1)![0] as string)).toMatchObject({ reference: 'erp', type: 'price' });
    expect(screen.getByTestId('where').textContent).toBe('/reports/price?marketplace=talabat&reference=erp');
    expect(screen.queryByText('Product 6')).toBeNull();
  });

  it('without a reference in the URL uses the store default from the summary', async () => {
    handler = (u, i) => (isSummary(u, method(i)) && !params(u).reference ? ok(summary({ reference: 'erp' })) : backend(u, i));
    renderAt('/reports/price', <PriceDiscrepanciesView />);
    await screen.findByText('Product 1');
    expect(screen.getByRole('button', { name: 'ERP price' }).getAttribute('aria-pressed')).toBe('true');
    expect(params(calls(isRows)[0][0] as string).reference).toBe('erp');
    expect(screen.getByRole('columnheader', { name: 'ERP price (QAR)' })).toBeTruthy();
  });

  it('shows an empty state when there are no price mismatches', async () => {
    handler = (u, i) => (isRows(u, method(i)) ? ok({ reference: 'marketplace', items: [], nextCursor: null }) : backend(u, i));
    renderAt('/reports/price?marketplace=snoonu', <PriceDiscrepanciesView />);
    expect(await screen.findByText('No price mismatches on Snoonu')).toBeTruthy();
  });
});
