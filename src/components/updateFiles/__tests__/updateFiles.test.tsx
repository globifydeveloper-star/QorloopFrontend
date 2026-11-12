// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReconMarketplaceSummary, ReconRow } from '../../../api/recon';
import type { MarketplaceValueItem } from '../../../api/marketplaceValues';
import { REAL_FLAGS } from '../../../../vitest.setup';

// Read before this file's beforeEach turns flags on: the global setup must have switched every flag off.
const FLAGS_AT_LOAD = REAL_FLAGS.map(f => import.meta.env[f]);

const perms = new Set<string>();
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ can: (p: string) => perms.has(p) }) }));
const app = { showToast: vi.fn(), openUploadModal: vi.fn(), navigate: vi.fn(), compareReference: 'marketplace', setCompareReference: vi.fn() };
vi.mock('../../../context/AppContext', () => ({ useApp: () => app }));

import { UpdateFilesView } from '../UpdateFilesView';
import { filesTiming } from '../../files/RealGenerateFilesView';
import { applySet, applyUseCatalogue, STALE_VALUE, NO_EDIT_PERMISSION } from '../logic';

// ───────── Backend fakes in the PROPOSED ADR 018 shapes (backend step-0 reports of 9 and 10 Nov) ─────────

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json(200, { data });
const fail = (status: number, message: string, details?: unknown[]) => json(status, { error: { code: 'E', message, details } });

const NOW = new Date('2026-11-10T09:00:00.000Z');
const UPLOADED = '2026-11-10T05:00:00.000Z';
const OLD = '2026-11-05T05:00:00.000Z';

const mp = (marketplaceId: ReconMarketplaceSummary['marketplaceId'], over: Partial<ReconMarketplaceSummary> & Record<string, unknown> = {}) => ({
  marketplaceId, hasData: true, stock: 2, price: 1, total: 3, listed: 10, notListed: 0, noData: 0, missingFromErp: 0, newCount: 0,
  lastUploadAt: UPLOADED, stale: false, ...over,
});
const value = (id: string, marketplaceId = 'talabat', over: Partial<MarketplaceValueItem> = {}): MarketplaceValueItem => ({
  productId: id, marketplaceId, version: null,
  catalogue: { available: true, price: 12.5 }, marketplaceCurrent: { available: false, price: 13.75 },
  export: { available: true, price: 12.5, availabilitySource: 'catalogue', priceSource: 'catalogue' },
  overrides: { availability: null, price: null },
  exportState: 'catalogue', exportStateLabel: null, blockedReason: null, blockedReasonLabel: null, rulePrice: 12.5, ...over,
});
const row = (id: string, marketplaceId = 'talabat', over: Partial<ReconRow> = {}): ReconRow => ({
  productId: id, barcode: `62810${id}`, sku: null, nameEn: `Product ${id}`, nameAr: null, productStatus: 'active', erpStock: 9,
  catalogueStock: 9, catalogueStockSource: 'erp', stockConflict: false, catalogueAvailable: true,
  status: 'mismatch', stockIssue: 'unavailable_but_in_stock', priceMismatch: true, priceMismatchVsErp: false, priceMismatchVsMarketplace: true,
  expectedPrice: 12.5, erpPrice: 11, marketplacePrice: 12.5, marketplacePriceSource: 'category', actualPrice: 13.75,
  erpAvailable: true, actualAvailable: false, lastUpdated: UPLOADED, marketplaceValues: value(id, marketplaceId), ...over,
});

interface Server {
  marketplaces: ReturnType<typeof mp>[];
  rows: Record<string, ReconRow[]>;
  /** Next answer of a single-product write, when set. */
  writeAnswer?: () => Response;
  applyAnswers: (() => Response)[];
  jobs: Record<string, number>;
}
let srv: Server;
let fetchMock: ReturnType<typeof vi.fn>;
const method = (i?: RequestInit) => i?.method ?? 'GET';
const calls = (pred: (url: string, m: string) => boolean) => fetchMock.mock.calls.filter(([u, i]) => pred(String(u), method(i as RequestInit)));
const bodyOf = (c: unknown[]) => JSON.parse(String((c[1] as RequestInit).body));
const path = (u: string) => u.split('?')[0];
const params = (u: string) => Object.fromEntries(new URL(u, 'http://x').searchParams);

const PREVIEW = (marketplaceId: string) => ({
  productCount: marketplaceId === 'talabat' ? 3 : 2, rowsToWrite: 3, priceChanges: 1, availabilityChanges: 2, notInFile: 0,
  largestPriceChange: null, firstRows: [], sourceFile: { name: `${marketplaceId}.xlsx`, uploadedAt: UPLOADED }, warnings: [],
  referenceUsed: 'marketplace', valueBasis: 'marketplace_export', exportToken: `tok-${marketplaceId}`, pendingExportProducts: 1, blockedExportProducts: 1,
});

/** Copy from Snoonu into Talabat, in the PROPOSED shape (backend feature/copy-from-marketplace, Step 0 report of 12 Nov). */
const COPY_PREVIEW = {
  marketplaceId: 'talabat', limit: 5000, previewToken: 'b'.repeat(64),
  selected: 6, willChange: 2, unchanged: 1, blocked: 1, notOnSource: 1, pinnedKept: 1, fromOlderFile: 1,
  blockedByReason: [{ reason: 'inactive', label: 'Product is inactive', count: 1 }],
  notOnSourceByReason: [{ reason: 'not_on_source', label: null, count: 1 }],
  source: { marketplaceId: 'snoonu', latestFile: { uploadId: 'up-s', fileName: 'snoonu-export.xlsx', uploadedAt: OLD, appliedAt: OLD } },
  rows: [
    { productId: '1', nameEn: 'Product 1', barcode: '628101', source: { available: true, price: 4.25, uploadId: 'up-s', fileName: 'snoonu-export.xlsx', isLatestFile: true },
      changes: [{ field: 'price', op: 'set', before: 4.5, after: 4.25 }] },
    { productId: '2', nameEn: 'Product 2', barcode: '628102', source: null, changes: [] },
  ],
};

function handle(u: string, i: RequestInit): Response {
  const m = method(i);
  const p = path(u);
  if (m === 'GET' && p === '/api/recon/summary') return ok({ reference: params(u).reference ?? 'marketplace', computedAt: UPLOADED, marketplaces: srv.marketplaces });
  if (m === 'GET' && p === '/api/recon/rows') {
    const q = params(u);
    return ok({ reference: q.reference ?? 'marketplace', items: srv.rows[q.marketplaceId] ?? [], nextCursor: null });
  }
  let hit = /^\/api\/marketplace-values\/([^/]+)\/products\/([^/]+)$/.exec(p);
  if (hit) {
    if (srv.writeAnswer) { const r = srv.writeAnswer(); srv.writeAnswer = undefined; return r; }
    const [, mpId, id] = hit;
    const r = srv.rows[mpId]!.find(x => x.productId === id)!;
    const before = r.marketplaceValues as MarketplaceValueItem;
    const next = m === 'PUT' ? applySet(before, bodyOf([u, i]).values) : applyUseCatalogue(before, ['availability', 'price']);
    const saved = { ...next, version: { id: `v-${id}`, version: (before.version?.version ?? 0) + 1 } };
    r.marketplaceValues = saved;
    return ok({ changed: true, operationId: 'op-1', item: saved });
  }
  if (m === 'POST' && p === '/api/marketplace-values/bulk/preview') {
    if (bodyOf([u, i]).action.type === 'copy_from_marketplace') return ok(COPY_PREVIEW);
    return ok({ selected: 4, willChange: 3, unchanged: 0, blocked: 1, blockedByReason: { inactive: 1 }, limit: 5000, previewToken: 'a'.repeat(64),
      rows: [{ productId: '1', before: value('1'), after: value('1', 'talabat', { export: { ...value('1').export, available: false } }), blockedReason: null }] });
  }
  if (m === 'POST' && p === '/api/marketplace-values/bulk/apply') {
    const next = srv.applyAnswers.shift();
    if (next) return next();
    return ok({ operationId: 'op-b', replayed: false, appliedAt: UPLOADED, selected: 4, willChange: 3, unchanged: 0, blocked: 1, blockedByReason: { inactive: 1 }, created: 3, updated: 0, clearedFields: 0 });
  }
  if (m === 'POST' && p === '/api/generated-files/preview') return ok(PREVIEW(bodyOf([u, i]).marketplaceId));
  if (m === 'POST' && p === '/api/generated-files') return json(202, { data: { jobId: `job-${bodyOf([u, i]).marketplaceId}` } });
  hit = /^\/api\/generated-files\/jobs\/([^/]+)$/.exec(p);
  if (hit) {
    srv.jobs[hit[1]] = (srv.jobs[hit[1]] ?? 0) + 1;
    return ok(srv.jobs[hit[1]] > 1 ? { state: 'done', fileId: `file-${hit[1]}` } : { state: 'running' });
  }
  hit = /^\/api\/generated-files\/([^/]+)\/download$/.exec(p);
  if (hit) return ok({ url: 'https://files.example/x.xlsx', fileName: `${hit[1]}.xlsx`, expiresAt: UPLOADED });
  if (m === 'GET' && p === '/api/generated-files') return ok([]);
  return fail(404, 'not mocked');
}

const Where = () => { const l = useLocation(); return <output data-testid="where">{l.search}</output>; };
function renderAt(at: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}><Routes><Route path="*" element={<><UpdateFilesView /><Where /></>} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}
const where = () => new URLSearchParams(screen.getByTestId('where').textContent ?? '');

const MANAGER = ['recon.view', 'products.view', 'marketplace.values_edit', 'files.view', 'files.preview', 'files.generate', 'files.download', 'uploads.upload'];
const ANALYST = ['recon.view', 'products.view', 'files.view'];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('VITE_REAL_MARKETPLACE_VALUES', 'true');
  perms.clear();
  MANAGER.forEach(p => perms.add(p));
  app.openUploadModal.mockClear();
  filesTiming.pollMs = 10;
  srv = {
    marketplaces: [mp('talabat', { waitingForExport: 2, pinned: 1, blockedExportProducts: 1 }), mp('snoonu', { stale: true, lastUploadAt: OLD }), mp('rafeeq', { hasData: false, lastUploadAt: null })],
    rows: { talabat: [row('1'), row('2'), row('3')], snoonu: [row('7', 'snoonu')] },
    applyAnswers: [], jobs: {},
  };
  fetchMock = vi.fn(async (u: string, i: RequestInit = {}) => handle(String(u), i));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); filesTiming.pollMs = 2_000; });

const rowOf = (id: string) => within(screen.getAllByTestId('adjust-row').find(r => r.getAttribute('data-product') === id)!);
const priceInput = (id: string) => rowOf(id).getByRole('textbox', { name: /Price to export/ }) as HTMLInputElement;
const putCalls = () => calls((u, m) => m === 'PUT' && u.includes('/api/marketplace-values/'));

describe('Update marketplace files', () => {
  it('runs with every VITE_REAL_* flag off from the global setup', () => {
    expect(FLAGS_AT_LOAD).toEqual(REAL_FLAGS.map(() => ''));
    expect(REAL_FLAGS).toContain('VITE_REAL_MARKETPLACE_VALUES');
  });

  describe('tabs, steps and the URL', () => {
    it('shows a tab per enabled marketplace with a file, each with its own counts; the choice goes into the URL', async () => {
      renderAt('/update-files');
      const tabs = await screen.findAllByRole('tab');
      expect(tabs.map(t => t.querySelector('span')?.textContent)).toEqual(['Talabat', 'Snoonu']);
      expect(tabs[0].getAttribute('aria-selected')).toBe('true');
      expect(screen.getByTestId('tab-counts-talabat').textContent).toBe('2 stock · 1 price to fix · 2 waiting');
      expect(screen.getByTestId('tab-counts-snoonu').textContent).toContain('out of date');

      fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
      await waitFor(() => expect(where().get('marketplace')).toBe('snoonu'));
      expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true');
      expect(document.activeElement).toBe(screen.getAllByRole('tab')[1]);
    });

    it('opens the step, marketplace and filter from the URL, and the step buttons change it', async () => {
      renderAt('/update-files?marketplace=snoonu&step=adjust&show=all&type=price');
      expect(await screen.findByRole('heading', { name: 'Adjust the values to export to Snoonu' })).toBeTruthy();
      expect(screen.getByTestId('step-adjust').getAttribute('aria-current')).toBe('step');
      await waitFor(() => expect(calls((u, m) => m === 'GET' && u.includes('/api/recon/rows')).length).toBeGreaterThan(0));
      const q = params(String(calls((u, m) => m === 'GET' && u.includes('/api/recon/rows')).at(-1)![0]));
      expect(q).toMatchObject({ marketplaceId: 'snoonu', type: 'price' });
      expect(q.status).toBeUndefined();
      expect(q.exportState).toBeUndefined();

      fireEvent.click(screen.getByTestId('step-export'));
      await waitFor(() => expect(where().get('step')).toBe('export'));
      fireEvent.click(screen.getByTestId('step-review'));
      await waitFor(() => expect(where().get('step')).toBeNull());
    });

    it('with no marketplace file yet it says to upload one first', async () => {
      srv.marketplaces = [mp('talabat', { hasData: false, lastUploadAt: null })];
      renderAt('/update-files');
      expect(await screen.findByText('No marketplace file yet')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Upload a marketplace file/ }));
      expect(app.openUploadModal).toHaveBeenCalled();
    });
  });

  describe('Review', () => {
    it('shows the file age, the counts and the price used', async () => {
      renderAt('/update-files');
      expect((await screen.findByTestId('file-age')).getAttribute('data-stale')).toBe('false');
      expect(screen.getByTestId('file-age').textContent).toContain('Talabat data is 4 hours old');
      expect(['count-stock', 'count-price', 'count-waiting', 'count-pinned', 'count-blocked'].map(id => screen.getByTestId(id).textContent)).toEqual(['2', '1', '2', '1', '1']);
      expect(screen.getByTestId('reference-used').textContent).toBe('Using My pricing (your store default).');
      expect(screen.queryByTestId('erp-warning')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /Waiting for export: 2/ }));
      await waitFor(() => expect(where().get('show')).toBe('waiting'));
      expect(where().get('step')).toBe('adjust');
    });

    it('an out-of-date file says "Upload a fresh file first" with the upload button', async () => {
      renderAt('/update-files?marketplace=snoonu');
      const banner = await screen.findByRole('alert');
      expect(banner.textContent).toContain('Upload a fresh Snoonu file first');
      expect(banner.textContent).toContain('5 days old');
      fireEvent.click(within(banner).getByRole('button', { name: 'Upload Snoonu file' }));
      expect(app.openUploadModal).toHaveBeenCalledWith('snoonu');
      // Counts the server does not send show as —.
      expect(screen.getByTestId('count-waiting').textContent).toBe('—');
    });

    it('the ERP price shows the warning never to upload such a file to a real marketplace', async () => {
      renderAt('/update-files?reference=erp');
      expect((await screen.findByTestId('erp-warning')).textContent).toBe('Never upload a file made against the ERP price to a real marketplace.');
      expect(screen.getByTestId('reference-used').textContent).toBe('Using the ERP price.');
    });
  });

  describe('Adjust', () => {
    const openAdjust = async (at = '/update-files?step=adjust') => { renderAt(at); await screen.findAllByTestId('adjust-row'); };

    it('lists the mismatches not adjusted yet by default, with the marketplace, catalogue and export values', async () => {
      await openAdjust();
      const q = params(String(calls((u, m) => m === 'GET' && u.includes('/api/recon/rows')).at(-1)![0]));
      expect(q).toMatchObject({ marketplaceId: 'talabat', type: 'all', status: 'mismatch', exportState: 'catalogue', reference: 'marketplace' });
      expect(rowOf('1').getByTestId('mp-now-price').textContent).toBe('13.75 QAR');
      expect(rowOf('1').getByTestId('mp-now-available').textContent).toBe('Unavailable');
      expect(rowOf('1').getByTestId('catalogue-price').textContent).toBe('12.50 QAR');
      expect(priceInput('1').value).toBe('12.50');
      expect(rowOf('1').getByTestId('export-state').textContent).toContain('Needs fix');
    });

    it('a product not in the marketplace file says "Not in the file"', async () => {
      srv.rows.talabat = [row('1', 'talabat', { actualPrice: null, actualAvailable: null })];
      await openAdjust();
      expect(rowOf('1').getByTestId('mp-now-price').textContent).toBe('Not in the file');
      expect(rowOf('1').getByTestId('mp-now-available').textContent).toBe('Not in the file');
    });

    it('Enter saves a price at once (optimistic), with the version last seen; "Differs from the rule price"', async () => {
      await openAdjust();
      fireEvent.change(priceInput('1'), { target: { value: '13' } });
      fireEvent.keyDown(priceInput('1'), { key: 'Enter' });
      await waitFor(() => expect(rowOf('1').getByTestId('export-state').getAttribute('data-state')).toBe('waiting'));
      await waitFor(() => expect(putCalls().length).toBe(1));
      expect(path(String(putCalls()[0][0]))).toBe('/api/marketplace-values/talabat/products/1');
      expect(bodyOf(putCalls()[0])).toEqual({ values: { price: { value: 13, persistent: false } }, expected: null });
      await waitFor(() => expect(rowOf('1').getByText('Saved')).toBeTruthy());
      expect(rowOf('1').getByTestId('export-state').textContent).toContain('Adjusted, waiting for export');
      expect(rowOf('1').getByTestId('differs-from-rule').textContent).toContain('Differs from the rule price (12.50 QAR)');
      // The next save sends the version the server returned.
      fireEvent.click(rowOf('1').getByRole('button', { name: /Unavailable/ }));
      await waitFor(() => expect(putCalls().length).toBe(2));
      expect(bodyOf(putCalls()[1]).expected).toEqual({ id: 'v-1', version: 1 });
    });

    it('Esc puts the saved value back; a bad price is caught before any call', async () => {
      await openAdjust();
      fireEvent.change(priceInput('1'), { target: { value: '99' } });
      fireEvent.keyDown(priceInput('1'), { key: 'Escape' });
      expect(priceInput('1').value).toBe('12.50');
      fireEvent.change(priceInput('1'), { target: { value: '-1' } });
      fireEvent.keyDown(priceInput('1'), { key: 'Enter' });
      expect(rowOf('1').getByTestId('export-error').textContent).toMatch(/above 0/);
      expect(putCalls().length).toBe(0);
    });

    it('Tab saves and moves to the price of the next row; Shift+Tab goes back', async () => {
      await openAdjust();
      priceInput('1').focus();
      fireEvent.keyDown(priceInput('1'), { key: 'Tab' });
      expect(document.activeElement).toBe(priceInput('2'));
      expect(putCalls().length).toBe(0); // nothing typed, nothing to save
      fireEvent.change(priceInput('2'), { target: { value: '14' } });
      fireEvent.keyDown(priceInput('2'), { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(priceInput('1'));
      await waitFor(() => expect(putCalls().length).toBe(1));
    });

    it('409: the change is rolled back, the list reloads and says someone else changed it', async () => {
      await openAdjust();
      const before = calls((u, m) => m === 'GET' && u.includes('/api/recon/rows')).length;
      srv.writeAnswer = () => fail(409, 'Conflict');
      fireEvent.click(rowOf('1').getByRole('button', { name: /Unavailable/ }));
      expect(await rowOf('1').findByText(STALE_VALUE)).toBeTruthy();
      expect(rowOf('1').getByTestId('export-state').getAttribute('data-state')).toBe('needs_fix');
      await waitFor(() => expect(calls((u, m) => m === 'GET' && u.includes('/api/recon/rows')).length).toBeGreaterThan(before));
    });

    it('400 shows the field message and 403 the permission, both rolled back', async () => {
      await openAdjust();
      srv.writeAnswer = () => fail(400, 'Validation failed', [{ path: 'values.price.value', message: 'Use at most 100,000 QAR' }]);
      fireEvent.change(priceInput('1'), { target: { value: '15' } });
      fireEvent.keyDown(priceInput('1'), { key: 'Enter' });
      expect((await rowOf('1').findByTestId('export-error')).textContent).toBe('Use at most 100,000 QAR');
      expect(rowOf('1').getByTestId('export-state').getAttribute('data-state')).toBe('needs_fix');

      srv.writeAnswer = () => fail(403, 'Forbidden');
      fireEvent.click(rowOf('2').getByRole('button', { name: /Unavailable/ }));
      expect((await rowOf('2').findByTestId('export-error')).textContent).toBe(NO_EDIT_PERMISSION);
      expect(rowOf('2').getByRole('button', { name: /Available/, pressed: true }).textContent).toContain('Available');
    });

    it('"Keep until I remove it" sends persistent, and re-saves an adjustment in place', async () => {
      await openAdjust();
      fireEvent.click(rowOf('1').getByRole('checkbox', { name: 'Keep until I remove it' }));
      expect(putCalls().length).toBe(0); // nothing adjusted yet: only remembered for the next save
      fireEvent.click(rowOf('1').getByRole('button', { name: /Unavailable/ }));
      await waitFor(() => expect(putCalls().length).toBe(1));
      expect(bodyOf(putCalls()[0]).values).toEqual({ availability: { value: false, persistent: true } });
      // Talabat shows Unavailable already: a pinned value it shows is "Pinned".
      await waitFor(() => expect(rowOf('1').getByTestId('export-state').textContent).toContain('Pinned'));
      fireEvent.click(rowOf('1').getByRole('checkbox', { name: 'Keep until I remove it' }));
      await waitFor(() => expect(putCalls().length).toBe(2));
      expect(bodyOf(putCalls()[1]).values).toEqual({ availability: { value: false, persistent: false } });
      fireEvent.click(rowOf('1').getByRole('button', { name: /Remove my adjustment/ }));
      await waitFor(() => expect(calls((u, m) => m === 'DELETE').length).toBe(1));
      expect(params(String(calls((u, m) => m === 'DELETE')[0][0]))).toEqual({ fields: 'all', expectedId: 'v-1', expectedVersion: '2' });
    });

    it('shows Blocked with the reason, and the empty state when nothing needs a change', async () => {
      srv.rows.talabat = [row('1', 'talabat', { marketplaceValues: value('1', 'talabat', { exportState: 'blocked', blockedReason: 'missing_from_erp', overrides: { availability: { value: true, state: 'pending', persistent: false, fieldState: 'blocked', setAt: UPLOADED, reason: null, clearedAt: null }, price: null } }) })];
      await openAdjust();
      expect(rowOf('1').getByTestId('export-state').textContent).toContain('Blocked');
      expect(rowOf('1').getByTestId('export-state-detail').textContent).toBe('Not in the latest ERP file');
      cleanup();
      srv.rows.talabat = [];
      renderAt('/update-files?step=adjust');
      expect(await screen.findByText('Nothing needs a change on Talabat')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Show all products' }));
      await waitFor(() => expect(where().get('show')).toBe('all'));
    });

    it('read-only roles see the values with an explanation, and no editors or bulk actions', async () => {
      perms.clear(); ANALYST.forEach(p => perms.add(p));
      await openAdjust();
      expect(screen.getByTestId('read-only').textContent).toContain('can see these values but not change them');
      expect(screen.queryAllByRole('textbox')).toEqual([]);
      expect(screen.queryByTestId('use-catalogue-all')).toBeNull();
      expect(rowOf('1').getByTestId('export-price').textContent).toBe('12.50 QAR');
      // No export permission: no export bar.
      expect(screen.queryByTestId('export-bar')).toBeNull();
    });
  });

  describe('bulk', () => {
    const open = async (label: string) => {
      renderAt('/update-files?step=adjust');
      await screen.findAllByTestId('adjust-row');
      fireEvent.click(rowOf('1').getByRole('checkbox', { name: 'Tick Product 1' }));
      fireEvent.click(rowOf('2').getByRole('checkbox', { name: 'Tick Product 2' }));
      fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: label }));
      return within(await screen.findByRole('dialog', { name: /Change the values to export/ }));
    };
    const applies = () => calls((u, m) => m === 'POST' && u.endsWith('/bulk/apply'));

    it('previews then applies with the token and one idempotency key, reused on a retry', async () => {
      const d = await open('Set Unavailable');
      fireEvent.click(d.getByRole('checkbox', { name: /Keep until I remove it/ }));
      fireEvent.click(d.getByRole('button', { name: 'Preview' }));
      expect((await d.findByTestId('values-will-change')).textContent).toBe('3');
      expect(d.getByTestId('blocked-inactive').textContent).toContain('Product is inactive');
      const preview = bodyOf(calls((u, m) => m === 'POST' && u.endsWith('/bulk/preview'))[0]);
      expect(preview).toEqual({ marketplaceId: 'talabat', selection: { productIds: ['1', '2'] }, action: { type: 'set', values: { availability: { value: false, persistent: true } } } });

      srv.applyAnswers = [() => fail(500, 'boom')];
      fireEvent.click(d.getByRole('button', { name: /Change 3 products…/ }));
      fireEvent.click(within(await screen.findByRole('dialog', { name: 'Change the values to export' })).getByRole('button', { name: 'Change 3 products' }));
      await waitFor(() => expect(applies().length).toBe(1));
      fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
      expect((await screen.findByTestId('values-bulk-done')).textContent).toBe('Changed on 3 products');
      const [first, second] = applies().map(bodyOf);
      expect(first.previewToken).toBe('a'.repeat(64));
      expect(first.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
      expect(second.idempotencyKey).toBe(first.idempotencyKey);
      expect(second).toEqual(first);
    });

    it('409 on apply asks for a new preview, and the next apply gets a new key', async () => {
      const d = await open('Set Available');
      fireEvent.click(d.getByRole('button', { name: 'Preview' }));
      await d.findByTestId('values-will-change');
      srv.applyAnswers = [() => fail(409, 'Conflict')];
      fireEvent.click(d.getByRole('button', { name: /Change 3 products…/ }));
      fireEvent.click(within(await screen.findByRole('dialog', { name: 'Change the values to export' })).getByRole('button', { name: 'Change 3 products' }));
      expect(await screen.findByText(/Nothing was changed\./)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Preview again' }));
      fireEvent.click(await screen.findByRole('button', { name: /Change 3 products…/ }));
      fireEvent.click(within(await screen.findByRole('dialog', { name: 'Change the values to export' })).getByRole('button', { name: 'Change 3 products' }));
      await screen.findByTestId('values-bulk-done');
      const [a, b] = applies().map(bodyOf);
      expect(b.idempotencyKey).not.toBe(a.idempotencyKey);
    });

    it('"Use catalogue values for all N rows" previews the whole list at once', async () => {
      renderAt('/update-files?step=adjust');
      await screen.findAllByTestId('adjust-row');
      const button = screen.getByTestId('use-catalogue-all');
      expect(button.textContent).toBe('Use catalogue values for all 3 rows');
      fireEvent.click(button);
      await screen.findByTestId('values-will-change');
      expect(bodyOf(calls((u, m) => m === 'POST' && u.endsWith('/bulk/preview'))[0])).toEqual({
        marketplaceId: 'talabat',
        selection: { filter: { exportState: 'to_fix' } },
        action: { type: 'use_catalogue', fields: ['availability', 'price'] },
      });
    });

    it('Set price checks the price before any call', async () => {
      const d = await open('Set price');
      fireEvent.change(d.getByLabelText('Price to export (QAR)'), { target: { value: '100001' } });
      fireEvent.click(d.getByRole('button', { name: 'Preview' }));
      expect(d.getByRole('alert').textContent).toMatch(/at most 100,000/);
      expect(calls((u, m) => m === 'POST' && u.endsWith('/bulk/preview')).length).toBe(0);
    });
  });

  describe('Fill from', () => {
    const openAdjust = async () => { renderAt('/update-files?step=adjust'); await screen.findAllByTestId('adjust-row'); };
    const fillFrom = () => screen.getByTestId('fill-from') as HTMLSelectElement;
    const previews = () => calls((u, m) => m === 'POST' && u.endsWith('/bulk/preview'));
    const applies = () => calls((u, m) => m === 'POST' && u.endsWith('/bulk/apply'));
    const COPY_RESULT = {
      operationId: 'op-c', replayed: false, appliedAt: UPLOADED, marketplaceId: 'talabat', sourceMarketplaceId: 'snoonu',
      selected: 6, willChange: 2, unchanged: 1, blocked: 1, blockedByReason: [{ reason: 'inactive', label: 'Product is inactive', count: 1 }],
      notOnSource: 1, notOnSourceByReason: [{ reason: 'not_on_source', label: 'Not on Snoonu', count: 1 }], pinnedKept: 1, created: 2, updated: 0, clearedFields: 0,
    };

    it('offers the catalogue (default) and every other marketplace with a file; the catalogue keeps "Use catalogue values for all"', async () => {
      await openAdjust();
      expect([...fillFrom().options].map(o => o.textContent)).toEqual(['Catalogue (default)', 'Snoonu']); // not Talabat itself, not Rafeeq (no file)
      expect(fillFrom().value).toBe('catalogue');
      expect(screen.getByTestId('use-catalogue-all').textContent).toBe('Use catalogue values for all 3 rows');
      expect(screen.queryByTestId('copy-what')).toBeNull();
      expect(screen.queryByTestId('fill-all')).toBeNull();
    });

    it('another marketplace copies the price only by default; availability and both are under "More options"', async () => {
      await openAdjust();
      fireEvent.change(fillFrom(), { target: { value: 'snoonu' } });
      expect(screen.getByTestId('copy-what').textContent).toBe('Price only');
      expect(screen.getByTestId('fill-all').textContent).toBe('Fill price from Snoonu for all 3 rows');
      expect(screen.queryByTestId('use-catalogue-all')).toBeNull();
      expect(screen.queryByRole('radiogroup', { name: 'What to copy' })).toBeNull();
      // Snoonu's file is 5 days old here: say so.
      expect(screen.getByTestId('fill-source-stale').textContent).toContain('Snoonu data is 5 days old');
      expect(previews().length).toBe(0); // choosing alone changes nothing

      const more = screen.getByRole('button', { name: /More options/ });
      fireEvent.click(more);
      expect(more.getAttribute('aria-expanded')).toBe('true');
      const group = within(screen.getByRole('radiogroup', { name: 'What to copy' }));
      fireEvent.click(group.getByRole('radio', { name: 'Price and availability' }));
      expect(screen.getByTestId('copy-what').textContent).toBe('Price and availability');
      expect(screen.getByTestId('fill-all').textContent).toBe('Fill price and availability from Snoonu for all 3 rows');
      fireEvent.click(group.getByRole('radio', { name: 'Availability only' }));
      expect(screen.getByTestId('fill-all').textContent).toBe('Fill availability from Snoonu for all 3 rows');

      fireEvent.change(fillFrom(), { target: { value: 'catalogue' } });
      expect(screen.getByTestId('use-catalogue-all')).toBeTruthy();
    });

    it('previews the copy: counts, not on that marketplace, pinned kept, blocked and the first rows; then applies with the token and one key', async () => {
      await openAdjust();
      fireEvent.change(fillFrom(), { target: { value: 'snoonu' } });
      fireEvent.click(screen.getByTestId('fill-all'));
      const d = within(await screen.findByRole('dialog', { name: /Change the values to export/ }));
      expect((await d.findByTestId('values-preview-heading')).textContent).toBe('Fill the price from Snoonu');
      expect(bodyOf(previews()[0])).toEqual({
        marketplaceId: 'talabat',
        selection: { filter: { exportState: 'to_fix' } },
        action: { type: 'copy_from_marketplace', sourceMarketplaceId: 'snoonu', fields: ['price'] },
      });
      expect(['values-selected', 'values-will-change', 'values-unchanged', 'values-not-on-source', 'values-pinned-kept', 'values-blocked'].map(id => d.getByTestId(id).textContent))
        .toEqual(['6', '2', '1', '1', '1', '1']);
      expect(d.getByTestId('not-on-source-not_on_source').textContent).toBe('Not on Snoonu1');
      expect(d.getByTestId('blocked-inactive').textContent).toBe('Product is inactive1');
      expect(d.getByTestId('values-pinned-note').textContent).toContain('Pinned values are kept');
      expect(d.getByTestId('values-source-file').textContent).toContain('latest Snoonu file, snoonu-export.xlsx');
      expect(d.getByTestId('values-older-file').textContent).toBe('For 1 product, the Snoonu value is from an older Snoonu file, because the latest one did not include it.');

      const [first, second] = d.getAllByTestId('values-bulk-row').map(r => within(r));
      expect(first.getByTestId('copy-price').textContent).toBe('Price: Snoonu: 4.25 QAR → Talabat (now 4.50 QAR)');
      expect(first.getByTestId('after-price').textContent).toBe('4.25 QAR from Snoonu');
      expect(second.getByText('Not on Snoonu: left as it is')).toBeTruthy();

      srv.applyAnswers = [() => fail(500, 'boom')];
      fireEvent.click(d.getByRole('button', { name: /Change 2 products…/ }));
      const confirm = within(await screen.findByRole('dialog', { name: 'Change the values to export' }));
      expect(confirm.getByTestId('confirm-text').textContent).toBe('This changes what the Talabat file will write for 2 products: fill the price from Snoonu.');
      expect(confirm.getByText(/Snoonu do not change/)).toBeTruthy();
      fireEvent.click(confirm.getByRole('button', { name: 'Change 2 products' }));
      await waitFor(() => expect(applies().length).toBe(1));
      srv.applyAnswers = [() => ok(COPY_RESULT)];
      fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
      expect((await screen.findByTestId('values-bulk-done')).textContent).toBe('Changed on 2 products');
      expect(screen.getByTestId('values-bulk-done-detail').textContent).toBe('1 already had this value, 1 not on Snoonu, 1 pinned, kept as they are, 1 blocked. The files you export next use the new values.');
      const [a, b] = applies().map(bodyOf);
      expect(a).toMatchObject({ action: { type: 'copy_from_marketplace', sourceMarketplaceId: 'snoonu', fields: ['price'] }, previewToken: 'b'.repeat(64) });
      expect(a.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
      expect(b).toEqual(a);
    });

    it('"Back" from the copy preview keeps the choice, and "What to copy" can be changed there', async () => {
      await openAdjust();
      fireEvent.change(fillFrom(), { target: { value: 'snoonu' } });
      fireEvent.click(screen.getByTestId('fill-all'));
      const d = within(await screen.findByRole('dialog', { name: /Change the values to export/ }));
      await d.findByTestId('values-will-change');
      fireEvent.click(d.getByRole('button', { name: 'Back' }));
      expect((d.getByRole('radio', { name: 'Fill from Snoonu' }) as HTMLInputElement).checked).toBe(true);
      fireEvent.click(within(d.getByRole('radiogroup', { name: 'What to copy' })).getByRole('radio', { name: 'Price and availability' }));
      fireEvent.click(d.getByRole('button', { name: 'Preview' }));
      await waitFor(() => expect(previews().length).toBe(2));
      expect(bodyOf(previews()[1]).action).toEqual({ type: 'copy_from_marketplace', sourceMarketplaceId: 'snoonu', fields: ['availability', 'price'] });
    });

    it('rows say where the value to export comes from: the catalogue, or the marketplace it was copied from', async () => {
      const copied = value('2', 'talabat', {
        version: { id: 'v-2', version: 1 }, exportState: 'waiting_for_export',
        export: { available: true, price: 4.25, availabilitySource: 'catalogue', priceSource: 'override' },
        overrides: { availability: null, price: { value: 4.25, state: 'pending', persistent: false, fieldState: 'waiting_for_export', setAt: UPLOADED, reason: 'Copied from Snoonu', clearedAt: null } },
      });
      srv.rows.talabat = [row('1'), row('2', 'talabat', { marketplaceValues: copied })];
      await openAdjust();
      expect(rowOf('1').getByTestId('export-source').textContent).toBe('Availability and price from the catalogue');
      expect(rowOf('2').getByTestId('export-source').textContent).toBe('Availability from the catalogue · price from Snoonu');
      // A price typed by hand says so.
      fireEvent.change(priceInput('1'), { target: { value: '13' } });
      fireEvent.keyDown(priceInput('1'), { key: 'Enter' });
      await waitFor(() => expect(rowOf('1').getByTestId('export-source').textContent).toBe('Availability from the catalogue · price adjusted by hand'));
    });

    it('read-only roles see the source too, and no Fill panel', async () => {
      perms.clear(); ANALYST.forEach(p => perms.add(p));
      await openAdjust();
      expect(screen.queryByTestId('fill-from')).toBeNull();
      expect(rowOf('1').getByTestId('export-source').textContent).toBe('Availability and price from the catalogue');
    });

    it('with no other marketplace file there is no "Fill from", only "Use catalogue values for all"', async () => {
      srv.marketplaces = [mp('talabat'), mp('snoonu', { hasData: false, lastUploadAt: null })];
      await openAdjust();
      expect(screen.queryByTestId('fill-from')).toBeNull();
      expect(screen.getByTestId('use-catalogue-all')).toBeTruthy();
    });
  });

  describe('Export', () => {
    it('shows each marketplace preview and exports one marketplace: progress, then a download button', async () => {
      renderAt('/update-files?step=export');
      await waitFor(() => expect(screen.getByTestId('export-summary-talabat').textContent).toBe('3 products will change: 2 availability, 1 price'));
      expect(screen.getByTestId('export-blocked-talabat').textContent).toBe('1');
      expect(screen.getByTestId('next-step').textContent).toBe("Next: Upload each file in the marketplace's portal, then upload the fresh export here to confirm.");
      const preview = bodyOf(calls((u, m) => m === 'POST' && u.endsWith('/generated-files/preview'))[0]);
      expect(preview).toEqual({ marketplaceId: 'talabat', kind: 'stock_price', scope: 'mismatches', reference: 'marketplace' });

      fireEvent.click(screen.getByTestId('export-talabat'));
      await waitFor(() => expect(calls((u, m) => m === 'POST' && path(u) === '/api/generated-files').length).toBe(1));
      expect(bodyOf(calls((u, m) => m === 'POST' && path(u) === '/api/generated-files')[0])).toMatchObject({ marketplaceId: 'talabat', exportToken: 'tok-talabat' });
      fireEvent.click(await screen.findByTestId('download-talabat'));
      await waitFor(() => expect(calls(u => u.endsWith('/api/generated-files/file-job-talabat/download')).length).toBe(1));
      expect(screen.queryByTestId('download-snoonu')).toBeNull();
      expect(screen.getByText(/lasts 5 minutes/)).toBeTruthy();
    });

    it('"Export both" starts both jobs and gives two download buttons; the bar shows under the other steps', async () => {
      renderAt('/update-files?step=adjust');
      const bar = within(await screen.findByTestId('export-bar'));
      await waitFor(() => expect(bar.getByTestId('export-summary-snoonu').textContent).toContain('2 products will change'));
      await waitFor(() => expect(bar.getByTestId('export-summary-talabat').textContent).toContain('3 products will change'));
      fireEvent.click(bar.getByTestId('export-both'));
      await waitFor(() => expect(calls((u, m) => m === 'POST' && path(u) === '/api/generated-files').map(c => bodyOf(c).marketplaceId).sort()).toEqual(['snoonu', 'talabat']));
      expect(await bar.findByTestId('download-talabat')).toBeTruthy();
      expect(await bar.findByTestId('download-snoonu')).toBeTruthy();
    });

    it('a blocked file says why and cannot be exported', async () => {
      fetchMock.mockImplementation(async (u: string, i: RequestInit = {}) =>
        path(String(u)) === '/api/generated-files/preview' && bodyOf([u, i]).marketplaceId === 'snoonu'
          ? fail(409, 'The Snoonu file has rows that cannot be matched') : handle(String(u), i));
      renderAt('/update-files?step=export');
      await waitFor(() => expect(screen.getByTestId('export-summary-snoonu').textContent).toBe('Cannot export: The Snoonu file has rows that cannot be matched'));
      expect((screen.getByTestId('export-snoonu') as HTMLButtonElement).disabled).toBe(true);
    });

    it('roles without file permissions cannot export', async () => {
      perms.clear(); ANALYST.forEach(p => perms.add(p));
      renderAt('/update-files?step=export');
      expect(await screen.findByText(/Your role cannot export marketplace files/)).toBeTruthy();
      expect(calls((u, m) => m === 'POST').length).toBe(0);
    });
  });
});
