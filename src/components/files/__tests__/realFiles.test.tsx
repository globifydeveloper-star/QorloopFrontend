// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReconMarketplaceSummary, ReconSummary } from '../../../api/recon';
import type { FilePreview, GeneratedFile, GenerationJob } from '../../../api/generatedFiles';

const perms = new Set<string>();
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ can: (p: string) => perms.has(p) }) }));
const app = {
  showToast: vi.fn(), navigate: vi.fn(), openUploadModal: vi.fn(), generateMarketplaceFiles: vi.fn(),
  outputFiles: [], products: [], pricingSettings: { defaultMarkup: { type: 'percent', value: 0 }, marketplaceRules: {} }, categoryPriceRules: [],
  compareReference: 'marketplace', setCompareReference: vi.fn(),
};
vi.mock('../../../context/AppContext', () => ({ useApp: () => app }));

import { GenerateFilesView } from '../../views/GenerateFilesView';
import { filesTiming } from '../RealGenerateFilesView';

/** Read before beforeEach shortens it. */
const DEFAULT_POLL_MS = filesTiming.pollMs;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown, status = 200) => json(status, { data });
const fail = (status: number, message: string) => json(status, { error: { code: 'E', message }, requestId: 'req-1' });

const mp = (marketplaceId: ReconMarketplaceSummary['marketplaceId'], over: Partial<ReconMarketplaceSummary> = {}): ReconMarketplaceSummary => ({
  marketplaceId, hasData: true, stock: 3, price: 5, total: 8, listed: 10, notListed: 1, noData: 0, missingFromErp: 0, newCount: 0,
  lastUploadAt: '2026-11-01T18:30:00.000Z', stale: false, ...over,
});
const SUMMARY: ReconSummary = {
  reference: 'marketplace', computedAt: '2026-11-02T08:00:00.000Z',
  marketplaces: [mp('talabat'), mp('snoonu'), mp('keeta', { hasData: false, lastUploadAt: null })],
};
const PREVIEW: FilePreview = {
  productCount: 14, rowsToWrite: 14, priceChanges: 9, availabilityChanges: 4, notInFile: 2,
  largestPriceChange: { name: 'Nescafe Classic 200g', from: 17.5, to: 19.8 },
  firstRows: [
    { 'Item ID': 'T-1', 'Item name': 'Nescafe Classic 200g', Price: 19.8, Available: true },
    { 'Item ID': 'T-2', 'Item name': 'Almarai Milk 1L', Price: 6.25, Available: false },
  ],
  sourceFile: { name: 'talabat-export.xlsx', uploadedAt: '2026-10-30T06:00:00.000Z' },
  warnings: ['The marketplace file is 3 days old'],
  referenceUsed: 'marketplace',
};
const FILE: GeneratedFile = {
  id: '11111111-1111-4111-8111-111111111111', marketplaceId: 'talabat', kind: 'stock_price', scope: 'mismatches', reference: 'marketplace',
  fileName: 'talabat-stock-price-20261102.xlsx', productCount: 14, generatedAt: '2026-11-02T06:15:00.000Z', generatedBy: 'Sara Owner',
  expiresAt: '2026-12-02T06:15:00.000Z',
};
const BLOCKED = 'There is nothing to update for this selection.';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response | undefined> | undefined;
let handler: Handler;
let fetchMock: ReturnType<typeof vi.fn>;
let jobStates: GenerationJob[];
let history: GeneratedFile[];
const method = (i?: RequestInit) => i?.method ?? 'GET';
const calls = (pred: (url: string, method: string) => boolean) =>
  fetchMock.mock.calls.filter(([u, i]) => pred(String(u), method(i as RequestInit | undefined)));
const bodyOf = (i: unknown) => JSON.parse(String((i as RequestInit).body));
const isPreview = (u: string, m: string) => m === 'POST' && u === '/api/generated-files/preview';
const isGenerate = (u: string, m: string) => m === 'POST' && u === '/api/generated-files';
const isJob = (u: string, m: string) => m === 'GET' && u.startsWith('/api/generated-files/jobs/');
const isHistory = (u: string, m: string) => m === 'GET' && u === '/api/generated-files';
const isDownload = (u: string, m: string) => m === 'GET' && /^\/api\/generated-files\/[^/]+\/download$/.test(u);

const backend: Handler = (u, i) => {
  const m = method(i);
  if (m === 'GET' && u.startsWith('/api/recon/summary')) return ok(SUMMARY);
  if (isHistory(u, m)) return ok(history);
  if (isPreview(u, m)) return ok({ ...PREVIEW, referenceUsed: bodyOf(i).reference ?? 'marketplace' });
  if (isGenerate(u, m)) return ok({ jobId: 'generate-job-1' }, 202);
  if (isJob(u, m)) return ok(jobStates.length > 1 ? jobStates.shift() : jobStates[0]);
  if (isDownload(u, m)) return ok({ url: 'https://storage.example/signed?sig=abc', fileName: FILE.fileName, expiresAt: '2026-11-02T09:05:00.000Z' });
  return undefined;
};

let clicked: { href: string; download: string }[];
beforeEach(() => {
  vi.stubEnv('VITE_REAL_FILES', 'true');
  perms.clear();
  ['files.view', 'files.preview', 'files.generate', 'files.download', 'recon.view'].forEach(p => perms.add(p));
  filesTiming.pollMs = 10;
  jobStates = [{ state: 'queued' }, { state: 'running' }, { state: 'done', fileId: FILE.id }];
  history = [FILE];
  handler = backend;
  fetchMock = vi.fn(async (u: string, i: RequestInit = {}) => (await handler(String(u), i)) ?? fail(404, 'not mocked'));
  vi.stubGlobal('fetch', fetchMock);
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function renderView(path = '/files') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><GenerateFilesView /></MemoryRouter></QueryClientProvider>);
}
const choose = () => within(screen.getByRole('region', { name: 'Choose the file' }));
const previewBtn = () => screen.getByRole('button', { name: /Preview/ });
const generateBtn = () => screen.getByRole('button', { name: /Generate file/ });
async function ready() {
  renderView();
  await screen.findByRole('region', { name: 'Choose the file' });
}
async function previewed() {
  await ready();
  fireEvent.click(previewBtn());
  await screen.findByRole('region', { name: 'Preview' });
}

describe('flag', () => {
  it('without VITE_REAL_FILES the demo screen is shown and the API is never called', () => {
    vi.stubEnv('VITE_REAL_FILES', '');
    renderView();
    expect(screen.getByText('Recent output files')).toBeTruthy();
    expect(calls(u => u.startsWith('/api/')).length).toBe(0);
  });
});

describe('generate files (OUT-001)', () => {
  it('opens from a stock mismatch with the marketplace and stock-only choices selected', async () => {
    renderView('/files?marketplace=snoonu&kind=stock&scope=mismatches&reference=erp&from=stock-mismatch');
    await screen.findByRole('region', { name: 'Choose the file' });
    expect(screen.getByRole('radio', { name: /^Snoonu/ })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: 'Stock' })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: 'Only products that need a change' })).toHaveProperty('checked', true);
    expect(screen.queryByRole('radio', { name: 'ERP price' })).toBeNull();
    expect(screen.getAllByRole('note').some(note => note.textContent?.includes('This file updates availability only. Prices stay unchanged.'))).toBe(true);
    expect(screen.getAllByRole('note').some(note => note.textContent?.includes('may include other stock mismatches'))).toBe(true);
    expect(generateBtn()).toHaveProperty('disabled', true);
    fireEvent.click(previewBtn());
    await screen.findByRole('region', { name: 'Preview' });
    expect(bodyOf(calls(isPreview)[0]![1])).toEqual({ marketplaceId: 'snoonu', kind: 'stock', scope: 'mismatches', reference: 'erp' });
  });
  it('shows a loading state, then only marketplaces with a recon summary, the store default and the disabled new-products option', async () => {
    renderView();
    expect(screen.getByRole('status').textContent).toContain('Loading marketplaces');
    await screen.findByRole('region', { name: 'Choose the file' });
    const radios = choose().getAllByRole('radio', { name: /Talabat|Snoonu|Keeta|Rafeeq/ });
    expect(radios.map(r => r.closest('label')!.textContent)).toEqual([expect.stringContaining('Talabat'), expect.stringContaining('Snoonu')]);
    expect(screen.getByRole('radio', { name: 'Marketplace price (store default)' })).toHaveProperty('checked', true);
    expect(screen.getByRole('note').textContent).toBe('Prices in this file use the Marketplace price.');
    const newProducts = screen.getByRole('radio', { name: /New products/ });
    expect(newProducts).toHaveProperty('disabled', true);
    expect(newProducts.closest('label')!.textContent).toContain('Not available yet');
    expect(screen.getAllByText(/uploaded 01 Nov 2026, 21:30/).length).toBe(2);
  });

  it('keeps Generate disabled until the current choices are previewed, and shows the preview', async () => {
    await ready();
    expect(generateBtn()).toHaveProperty('disabled', true);
    fireEvent.click(previewBtn());
    const panel = within(await screen.findByRole('region', { name: 'Preview' }));
    expect(bodyOf(calls(isPreview)[0]![1])).toEqual({ marketplaceId: 'talabat', kind: 'stock_price', scope: 'mismatches', reference: 'marketplace' });
    expect(panel.getByTestId('preview-productCount').textContent).toBe('14');
    expect(panel.getByTestId('preview-priceChanges').textContent).toBe('9');
    expect(panel.getByTestId('preview-availabilityChanges').textContent).toBe('4');
    expect(panel.getByTestId('preview-notInFile').textContent).toBe('2');
    expect(panel.getByTestId('largest-change').textContent).toBe('Largest price change (QAR): Nescafe Classic 200g 17.50 → 19.80');
    expect(screen.getByTestId('preview-warnings').textContent).toContain('The marketplace file is 3 days old');
    expect(panel.getByText(/talabat-export\.xlsx/).closest('div')!.textContent).toContain('30 Oct 2026, 09:00');
    expect(panel.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Item ID', 'Item name', 'Price', 'Available']);
    expect(panel.getAllByTestId('preview-row').map(r => r.textContent)).toEqual(['T-1Nescafe Classic 200g19.8true', 'T-2Almarai Milk 1L6.25false']);
    expect(generateBtn()).toHaveProperty('disabled', false);
  });

  it.each([
    ['marketplace', 'Snoonu'], ['kind', 'Price'], ['scope', 'All listed products'], ['reference', 'ERP price'],
  ])('changing the %s clears the preview and disables Generate again', async (_what, label) => {
    await previewed();
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(`^${label}`) }));
    expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull();
    expect(generateBtn()).toHaveProperty('disabled', true);
    fireEvent.click(previewBtn());
    await screen.findByRole('region', { name: 'Preview' });
    expect(generateBtn()).toHaveProperty('disabled', false);
  });

  const previewWith = (over: Partial<FilePreview>) => {
    handler = (u, i) => (isPreview(u, method(i)) ? ok({ ...PREVIEW, ...over }) : backend(u, i));
  };
  const DUPLICATES = '37 products appear on more than one row of the Snoonu file; all their rows are updated';

  it('when rowsToWrite equals productCount it shows only the products count', async () => {
    await previewed();
    expect(screen.getByTestId('preview-products').textContent).toBe('14 products change');
    expect(screen.queryByTestId('preview-rows')).toBeNull();
  });

  it('when rowsToWrite differs it also says how many rows will be written and why', async () => {
    previewWith({ productCount: 14, rowsToWrite: 51 });
    await previewed();
    expect(screen.getByTestId('preview-products').textContent).toBe('14 products change');
    expect(screen.getByTestId('preview-rows').textContent)
      .toBe('51 rows will be written (some products appear on more than one row of the marketplace file)');
  });

  it('shows one warning prominently above the Generate button', async () => {
    previewWith({ warnings: [DUPLICATES] });
    await previewed();
    const items = within(screen.getByTestId('preview-warnings')).getAllByRole('alert');
    expect(items.map(w => w.textContent!.trim())).toEqual([DUPLICATES]);
    // above the Generate button in document order
    expect(screen.getByTestId('preview-warnings').compareDocumentPosition(generateBtn()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows every warning when there are several, and none when the list is empty', async () => {
    previewWith({ warnings: ['The marketplace file is 3 days old', DUPLICATES] });
    await previewed();
    const items = within(screen.getByTestId('preview-warnings')).getAllByRole('alert');
    expect(items.map(w => w.textContent!.trim())).toEqual(['The marketplace file is 3 days old', DUPLICATES]);
    expect(screen.getByTestId('preview-warnings').compareDocumentPosition(generateBtn()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    previewWith({ warnings: [] });
    await previewed();
    expect(screen.queryByTestId('preview-warnings')).toBeNull();
  });

  it('sends the chosen reference and the banner names it', async () => {
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: 'ERP price' }));
    expect(screen.getByRole('note').textContent).toBe('Prices in this file use the ERP price.');
    fireEvent.click(previewBtn());
    await screen.findByRole('region', { name: 'Preview' });
    expect(bodyOf(calls(isPreview)[0]![1]).reference).toBe('erp');
  });

  it('shows a 409 reason in plain words next to the marketplace and keeps Generate disabled', async () => {
    handler = (u, i) => (isPreview(u, method(i)) ? fail(409, BLOCKED) : backend(u, i));
    await ready();
    fireEvent.click(previewBtn());
    expect((await screen.findByTestId('blocked-talabat')).textContent).toContain(BLOCKED);
    expect(screen.getByTestId('blocked-talabat').closest('label')!.textContent).toContain('Talabat');
    expect(generateBtn()).toHaveProperty('disabled', true);
    // the reason stays next to Talabat (not Snoonu) while the other choices are the same, and goes when they change
    fireEvent.click(screen.getByRole('radio', { name: /^Snoonu/ }));
    expect(screen.getByTestId('blocked-talabat')).toBeTruthy();
    expect(screen.queryByTestId('blocked-snoonu')).toBeNull();
    expect(generateBtn()).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('radio', { name: 'All listed products' }));
    expect(screen.queryByTestId('blocked-talabat')).toBeNull();
  });

  it('shows a non-409 preview failure as an error', async () => {
    handler = (u, i) => (isPreview(u, method(i)) ? fail(500, 'Internal server error') : backend(u, i));
    await ready();
    fireEvent.click(previewBtn());
    expect((await choose().findByText(/We could not preview the file/)).textContent).toContain('Internal server error');
    expect(generateBtn()).toHaveProperty('disabled', true);
  });

  it('generates: polls the job every 2 s (queued, running, done), then fetches the signed URL once and starts the download', async () => {
    expect(DEFAULT_POLL_MS).toBe(2_000); // the tests poll every 10 ms instead
    await previewed();
    const historyBefore = calls(isHistory).length;
    fireEvent.click(generateBtn());
    await waitFor(() => expect(calls(isGenerate).length).toBe(1));
    expect(bodyOf(calls(isGenerate)[0]![1])).toEqual({ marketplaceId: 'talabat', kind: 'stock_price', scope: 'mismatches', reference: 'marketplace' });
    await waitFor(() => expect(screen.getByTestId('job-state').dataset.state).toBe('done'));
    expect(calls(isJob).map(([u]) => u)).toEqual(Array(3).fill('/api/generated-files/jobs/generate-job-1'));
    expect(screen.getByTestId('job-state').textContent).toContain('The download has started');
    await waitFor(() => expect(clicked).toEqual([{ href: 'https://storage.example/signed?sig=abc', download: FILE.fileName }]));
    expect(calls(isDownload).map(([u]) => u)).toEqual([`/api/generated-files/${FILE.id}/download`]);
    await waitFor(() => expect(calls(isHistory).length).toBe(historyBefore + 1));
    // no anchor is left behind holding the signed URL
    expect(document.querySelector('a[href*="signed"]')).toBeNull();
  });

  it('a done job without a fileId refreshes the history but starts no download', async () => {
    jobStates = [{ state: 'done' }];
    await previewed();
    const historyBefore = calls(isHistory).length;
    fireEvent.click(generateBtn());
    await waitFor(() => expect(screen.getByTestId('job-state').dataset.state).toBe('done'));
    expect(screen.getByTestId('job-state').textContent).toBe('The file is ready. It is in the list below.');
    await waitFor(() => expect(calls(isHistory).length).toBe(historyBefore + 1));
    expect(calls(isDownload).length).toBe(0);
    expect(clicked).toEqual([]);
  });

  it('shows running progress while the job works and disables Generate', async () => {
    jobStates = [{ state: 'running' }];
    await previewed();
    fireEvent.click(generateBtn());
    await waitFor(() => expect(screen.getByTestId('job-state').dataset.state).toBe('running'));
    expect(screen.getByTestId('job-state').textContent).toContain('Building the file');
    expect(generateBtn()).toHaveProperty('disabled', true);
    expect(previewBtn()).toHaveProperty('disabled', true);
  });

  it('shows the backend message when the job fails and downloads nothing', async () => {
    jobStates = [{ state: 'failed', message: 'We could not generate this file. Please try again.' }];
    await previewed();
    fireEvent.click(generateBtn());
    await waitFor(() => expect(screen.getByTestId('job-state').dataset.state).toBe('failed'));
    expect(screen.getByTestId('job-state').textContent).toBe('The file could not be generated. We could not generate this file. Please try again.');
    expect(calls(isDownload).length).toBe(0);
    expect(generateBtn()).toHaveProperty('disabled', false);
  });

  it('a 409 on generate shows the reason next to the marketplace and needs a new preview', async () => {
    handler = (u, i) => (isGenerate(u, method(i)) ? fail(409, 'The original is no longer in storage. Upload a fresh Talabat file.') : backend(u, i));
    await previewed();
    fireEvent.click(generateBtn());
    expect((await screen.findByTestId('blocked-talabat')).textContent).toContain('The original is no longer in storage');
    expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull();
    expect(generateBtn()).toHaveProperty('disabled', true);
  });

  it('shows an empty state when no marketplace has a recon summary', async () => {
    handler = (u, i) => (u.startsWith('/api/recon/summary') ? ok({ ...SUMMARY, marketplaces: [mp('keeta', { hasData: false })] }) : backend(u, i));
    renderView();
    expect(await screen.findByText('No marketplace is ready for a file yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Preview/ })).toBeNull();
  });

  it('shows an error with a retry when the marketplaces cannot be loaded', async () => {
    let failing = true;
    handler = (u, i) => (u.startsWith('/api/recon/summary') && failing ? fail(500, 'Internal server error') : backend(u, i));
    renderView();
    expect((await screen.findByRole('alert')).textContent).toContain('We could not load the marketplaces');
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await screen.findByRole('region', { name: 'Choose the file' });
  });
});

describe('generated files history (OUT-002)', () => {
  const table = async () => within(await screen.findByRole('region', { name: 'Generated files' }));

  it('lists files with products, who generated them and expiry in Qatar time; re-download fetches the URL only on click', async () => {
    renderView();
    const t = await table();
    const row = (await t.findAllByTestId('history-row'))[0]!;
    expect(row.textContent).toContain('02 Nov 2026, 09:15');
    expect(row.textContent).toContain('Talabat');
    expect(row.textContent).toContain(FILE.fileName);
    expect(row.textContent).toContain('Stock and price · Only products that need a change · Marketplace price');
    expect(row.textContent).toContain('14');
    expect(row.textContent).toContain('Sara Owner');
    expect(row.textContent).toContain('02 Dec 2026, 09:15');
    expect(calls(isDownload).length).toBe(0);
    fireEvent.click(within(row).getByRole('button', { name: `Download ${FILE.fileName}` }));
    await waitFor(() => expect(clicked.length).toBe(1));
    expect(calls(isDownload).length).toBe(1);
  });

  it('says so in plain words when a file is no longer available', async () => {
    handler = (u, i) => (isDownload(u, method(i)) ? fail(404, 'Generated file not found') : backend(u, i));
    renderView();
    const t = await table();
    fireEvent.click(await t.findByRole('button', { name: `Download ${FILE.fileName}` }));
    expect((await t.findByRole('alert')).textContent).toBe(`We could not download ${FILE.fileName}: This file is no longer available.`);
    expect(clicked.length).toBe(0);
  });

  it('shows an empty state', async () => {
    history = [];
    renderView();
    expect(await (await table()).findByText('No files generated yet')).toBeTruthy();
  });

  it('shows an error state with a retry', async () => {
    let failing = true;
    handler = (u, i) => (isHistory(u, method(i)) && failing ? fail(503, 'Service unavailable') : backend(u, i));
    renderView();
    const t = await table();
    expect((await t.findByRole('alert')).textContent).toContain('We could not load the generated files');
    failing = false;
    fireEvent.click(t.getByRole('button', { name: /Try again/ }));
    expect((await t.findAllByTestId('history-row')).length).toBe(1);
  });
});

describe('permissions from /api/auth/me', () => {
  it('without files.preview and files.generate (Analyst) there is no Preview or Generate, but downloads work', async () => {
    perms.delete('files.preview'); perms.delete('files.generate');
    await ready();
    expect(screen.queryByRole('button', { name: /Preview/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Generate file/ })).toBeNull();
    expect(screen.getByText(/You can download files but not create them/)).toBeTruthy();
    expect(await screen.findByRole('button', { name: `Download ${FILE.fileName}` })).toBeTruthy();
  });

  it('with files.preview but not files.generate the preview works and Generate is hidden', async () => {
    perms.delete('files.generate');
    await previewed();
    expect(screen.queryByRole('button', { name: /Generate file/ })).toBeNull();
  });

  it('without files.download there are no download buttons and a finished job downloads nothing', async () => {
    perms.delete('files.download');
    await previewed();
    expect((await screen.findAllByTestId('history-row')).length).toBe(1);
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
    fireEvent.click(generateBtn());
    await waitFor(() => expect(screen.getByTestId('job-state').dataset.state).toBe('done'));
    expect(screen.getByTestId('job-state').textContent).toBe('The file is ready.');
    expect(calls(isDownload).length).toBe(0);
  });
});
