// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReviewRow, UploadDetail, UploadStatus, UploadSummary } from '../../../api/types';

const perms = new Set<string>();
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ can: (p: string) => perms.has(p) }) }));
const app = { isUploadModalOpen: true, closeUploadModal: vi.fn(), uploadModalPreselectedSource: 'talabat', showToast: vi.fn(), openUploadModal: vi.fn(), navigate: vi.fn() };
vi.mock('../../../context/AppContext', () => ({ useApp: () => app }));
// Real mode must never read or write the local demo store (in particular never its applyReview).
vi.mock('../../../demo', async orig => ({
  ...(await orig<typeof import('../../../demo')>()),
  useDemo: () => { throw new Error('demo store used in real mode'); },
}));

import { UploadReviewView } from '../../views/UploadReviewView';
import { UploadsHistoryView } from '../../views/UploadsHistoryView';
import { ColumnMappingView } from '../../views/ColumnMappingView';
import { UploadModal } from '../../modals/UploadModal';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const rec = (status: UploadStatus, over: Partial<UploadDetail> = {}): UploadDetail => ({
  id: 'up_1', source: 'talabat', fileName: 'talabat.xlsx', size: 4096, contains: 'full', status,
  step: null, progress: null, summary: null, errorMessage: null, uploadedById: 'usr_1',
  createdAt: '2026-10-30T08:00:00.000Z', updatedAt: '2026-10-30T08:00:00.000Z', appliedAt: null, ...over,
});
const summary: UploadSummary = {
  rowsRead: 120, matched: 110, newProducts: 4, rowsWithErrors: 2, priceChanges: 3, stockChanges: 5,
  missingFromFile: 6, unmatched: 1, contains: 'full', firstImport: false, missingSample: [],
};
const row = (rowNumber: number, changeType: ReviewRow['changeType'], change: ReviewRow['parsed']['change'], data: Record<string, unknown> = { barcode: `62810${rowNumber}` }): ReviewRow =>
  ({ rowNumber, changeType, matchProductId: changeType === 'new' || changeType === 'unmatched' ? null : `prd_${rowNumber}`, parsed: { data, change } });
const ROWS: Record<string, ReviewRow[]> = {
  price: [row(4, 'price', { price: { old: 10, new: 12.5 } })],
  stock: [row(5, 'stock', { stock: { old: 3, new: 0 } })],
  availability: [row(6, 'availability', { availability: { old: true, new: false } })],
  new: [row(7, 'new', {}, { barcode: '999', name: 'New crisps' })],
  unmatched: [row(8, 'unmatched', {}, { barcode: '000' })],
  all: [row(9, 'price_stock', { price: { old: 1, new: 2 }, stock: { old: 4, new: 8 } })],
};

type Handler = (url: string, init: RequestInit) => Response | undefined;
let handler: Handler;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (pred: (url: string, method: string) => boolean) =>
  fetchMock.mock.calls.filter(([u, i]) => pred(String(u), (i as RequestInit).method ?? 'GET'));

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

beforeEach(() => {
  vi.stubEnv('VITE_REAL_UPLOADS', 'true');
  perms.clear();
  ['uploads.view', 'uploads.upload', 'uploads.map', 'uploads.discard'].forEach(p => perms.add(p));
  fetchMock = vi.fn((u: string, i: RequestInit = {}) => Promise.resolve(handler(String(u), i) ?? json(404, { error: { code: 'NOT_FOUND', message: 'nope' } })));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('review page (real mode)', () => {
  let errorsTotal = 1;
  beforeEach(() => {
    errorsTotal = 1;
    handler = url => {
      if (url === '/api/uploads/up_1') return json(200, { data: rec('needs_review', { summary }) });
      if (url.startsWith('/api/uploads/up_1/review')) {
        const tab = new URL(url, 'http://x').searchParams.get('tab')!;
        return json(200, { data: { upload: rec('needs_review'), tab, page: 1, pageSize: 50, total: ROWS[tab].length, errorCount: 2, rows: ROWS[tab] } });
      }
      if (url.startsWith('/api/uploads/up_1/errors')) {
        const page = Number(new URL(url, 'http://x').searchParams.get('page'));
        return json(200, { data: { page, total: errorsTotal, errors: [{ row: 9 + page, column: 'Price', value: 'abc', reason: 'Not a number' }] } });
      }
      if (url === '/api/uploads/up_1/discard') return json(200, { data: rec('discarded') });
      return undefined;
    };
  });

  it('shows labelled summary counts', async () => {
    renderAt('/uploads/review?upload=up_1', <UploadReviewView />);
    await screen.findByText('Rows read');
    const block = within(screen.getByRole('heading', { name: 'Summary' }).parentElement!);
    const value = (label: string) => block.getByText(label).nextElementSibling?.textContent;
    expect(value('Rows read')).toBe('120');
    expect(value('Matched to catalogue')).toBe('110');
    expect(value('Rows with errors')).toBe('2');
    expect(value('Missing from file')).toBe('6');
    expect(value('Unmatched rows')).toBe('1');
  });

  it('renders old -> new values per backend tab, and a disabled "Not available yet" apply', async () => {
    renderAt('/uploads/review?upload=up_1', <UploadReviewView />);
    expect((await screen.findByTestId('change-price')).textContent).toBe('10.00→12.50');
    expect(screen.getAllByRole('tab').map(t => t.textContent?.replace(/ \(\d+\)$/, ''))).toEqual(
      ['Price changes', 'Stock changes', 'Availability changes', 'New products', 'Unmatched rows', 'All rows']);
    expect(calls(u => u.includes('/review'))[0][0]).toBe('/api/uploads/up_1/review?tab=price&page=1&pageSize=50');
    expect(screen.getByText('prd_4')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Stock changes/ }));
    expect((await screen.findByTestId('change-stock')).textContent).toBe('3→0');
    fireEvent.click(screen.getByRole('tab', { name: /Availability changes/ }));
    expect((await screen.findByTestId('change-availability')).textContent).toBe('Available→Unavailable');
    fireEvent.click(screen.getByRole('tab', { name: /New products/ }));
    expect(await screen.findByText('barcode: 999 · name: New crisps')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /All rows/ }));
    expect(await screen.findByText('Price and stock')).toBeTruthy();
    expect(screen.getByTestId('change-price').textContent).toBe('1.00→2.00');
    expect(screen.getByTestId('change-stock').textContent).toBe('4→8');

    const apply = screen.getByRole('button', { name: 'Confirm and apply' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(screen.getByText(/Not available yet\./)).toBeTruthy();
    expect(calls(u => /apply|confirm/.test(u))).toHaveLength(0);
  });

  it('shows row errors and pages them at the fixed 200 per page', async () => {
    errorsTotal = 450;
    renderAt('/uploads/review?upload=up_1', <UploadReviewView />);
    expect(await screen.findByText('Not a number')).toBeTruthy();
    expect(screen.getByText('Row errors (450)')).toBeTruthy();
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Next' }).at(-1)!);
    await waitFor(() => expect(calls(u => u === '/api/uploads/up_1/errors?page=2')).toHaveLength(1));
    expect(await screen.findByText('Page 2 of 3')).toBeTruthy();
  });

  it('discards only after confirmation', async () => {
    renderAt('/uploads/review?upload=up_1', <UploadReviewView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Discard upload' }));
    const dialog = screen.getByRole('dialog', { name: 'Discard this upload?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls(u => u.endsWith('/discard'))).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Discard upload' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(calls((u, m) => u === '/api/uploads/up_1/discard' && m === 'POST')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('hides Discard without uploads.discard', async () => {
    perms.delete('uploads.discard');
    renderAt('/uploads/review?upload=up_1', <UploadReviewView />);
    await screen.findByText('Rows read');
    expect(screen.queryByRole('button', { name: /Discard/ })).toBeNull();
  });
});

describe('discard availability by status', () => {
  const cases: [UploadStatus, boolean][] = [
    ['uploading', true], ['needs_mapping', true], ['needs_review', true], ['rejected', true], ['failed', true],
    ['processing', false], ['discarded', false],
  ];
  it.each(cases)('%s -> discard shown: %s', async (status, shown) => {
    handler = url => {
      if (url === '/api/uploads/up_1') return json(200, { data: rec(status, status === 'needs_review' ? { summary } : {}) });
      if (url.includes('/review')) return json(200, { data: { upload: rec(status), tab: 'price', page: 1, pageSize: 50, total: 0, errorCount: 0, rows: [] } });
      if (url.includes('/errors')) return json(200, { data: { page: 1, total: 0, errors: [] } });
      return undefined;
    };
    renderAt('/uploads/review?upload=up_1', <UploadReviewView />);
    await screen.findByRole('heading', { name: 'talabat.xlsx' });
    expect(Boolean(screen.queryByRole('button', { name: 'Discard upload' }))).toBe(shown);
  });
});

describe('rejected / failed', () => {
  it.each([
    ['rejected', 'Qorloop could not accept this file', 'Fix the file and upload it again.'],
    ['failed', 'Something went wrong while reading this file', 'Please upload it again.'],
  ] as const)('%s shows a human message around errorMessage', async (status, title, next) => {
    handler = url => {
      if (url === '/api/uploads/up_1') return json(200, { data: rec(status, { errorMessage: 'The file has no header row.' }) });
      if (url.includes('/errors')) return json(200, { data: { page: 1, total: 0, errors: [] } });
      return undefined;
    };
    renderAt('/uploads/review?upload=up_1', <UploadReviewView />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(title);
    expect(alert.textContent).toContain('The file has no header row.');
    expect(alert.textContent).toContain(next);
  });
});

describe('download errors (.xlsx)', () => {
  const NAME = 'Download errors (.xlsx)';
  let xlsxReply: () => Response | Promise<Response>;
  let detail: UploadDetail;
  let errorsTotal: number;
  let clicked: { href: string; download: string }[];
  beforeEach(() => {
    detail = rec('needs_review', { summary });
    errorsTotal = 2;
    xlsxReply = () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Disposition': 'attachment; filename="talabat-errors.xlsx"' } });
    handler = url => {
      if (url === '/api/uploads/up_1') return json(200, { data: detail });
      if (url.startsWith('/api/uploads/up_1/review')) return json(200, { data: { upload: detail, tab: 'price', page: 1, pageSize: 50, total: 0, errorCount: 0, rows: [] } });
      if (url.startsWith('/api/uploads/up_1/errors?')) return json(200, { data: { page: 1, total: errorsTotal, errors: errorsTotal ? [{ row: 3, column: 'Price', value: 'x', reason: 'Not a number' }] : [] } });
      return undefined;
    };
    // fetch is wired through handler, except the xlsx which may be deferred.
    fetchMock.mockImplementation((u: string, i: RequestInit = {}) =>
      String(u) === '/api/uploads/up_1/errors.xlsx' ? Promise.resolve(xlsxReply()) : Promise.resolve(handler(String(u), i) ?? json(404, { error: { code: 'NOT_FOUND', message: 'nope' } })));
    clicked = [];
    // jsdom has no object URLs.
    URL.createObjectURL = vi.fn(() => 'blob:qorloop/1');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push({ href: this.href, download: this.download }); });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (URL as Partial<typeof URL>).createObjectURL;
    delete (URL as Partial<typeof URL>).revokeObjectURL;
  });
  const open = async () => {
    renderAt('/uploads/review?upload=up_1', <UploadReviewView />);
    await screen.findByText(/Row errors \(/);
  };

  it('is hidden at zero errors', async () => {
    detail = rec('needs_review', { summary: { ...summary, rowsWithErrors: 0 } });
    errorsTotal = 0;
    await open();
    expect(screen.queryByRole('button', { name: NAME })).toBeNull();
  });

  it('is shown for a rejected upload whose message mentions invalid rows, and hidden without uploads.view', async () => {
    detail = rec('rejected', { errorMessage: 'The file has 12 invalid rows.' });
    errorsTotal = 0;
    await open();
    expect(screen.getByRole('button', { name: NAME })).toBeTruthy();
    cleanup();
    perms.delete('uploads.view');
    await open();
    expect(screen.queryByRole('button', { name: NAME })).toBeNull();
  });

  it('downloads through a temporary object URL and an <a download> with the server file name, then revokes it', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: NAME }));
    await waitFor(() => expect(clicked).toEqual([{ href: 'blob:qorloop/1', download: 'talabat-errors.xlsx' }]));
    expect((URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(Blob);
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:qorloop/1'));
    expect(document.querySelector('a[download]')).toBeNull();
    expect(calls(u => u === '/api/uploads/up_1/errors.xlsx')[0][1]).toMatchObject({ credentials: 'include' });
  });

  it('is disabled and says "Preparing…" while the file is being prepared', async () => {
    let finish!: (r: Response) => void;
    xlsxReply = () => new Promise<Response>(r => { finish = r; });
    await open();
    fireEvent.click(screen.getByRole('button', { name: NAME }));
    const busy = await screen.findByRole('button', { name: 'Preparing…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    finish(new Response(new Uint8Array([1]), { status: 200 }));
    expect(((await screen.findByRole('button', { name: NAME })) as HTMLButtonElement).disabled).toBe(false);
    expect(clicked[0].download).toBe('row-errors.xlsx');
  });

  it('a 401 takes the session-expired path', async () => {
    const { onSessionExpired } = await import('../../../api/client');
    const expired = vi.fn();
    const off = onSessionExpired(expired);
    xlsxReply = () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Session expired or invalid' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await open();
    fireEvent.click(screen.getByRole('button', { name: NAME }));
    await waitFor(() => expect(expired).toHaveBeenCalledTimes(1));
    expect(clicked).toHaveLength(0);
    off();
  });

  it('a 404 shows the specific message and logs the original error', async () => {
    xlsxReply = () => json(404, { error: { code: 'NOT_FOUND', message: 'Upload not found' } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await open();
    fireEvent.click(screen.getByRole('button', { name: NAME }));
    expect((await screen.findByText(/Could not download the errors/)).textContent).toBe('Could not download the errors: Upload not found');
    expect(log).toHaveBeenCalledWith('[uploads] downloading the errors file failed', expect.objectContaining({ status: 404 }));
    expect(clicked).toHaveLength(0);
  });

  it('notes the 5,000 cap only when more than 5,000 errors are shown', async () => {
    errorsTotal = 5000;
    await open();
    expect(screen.queryByText('The file lists up to 5,000 errors')).toBeNull();
    cleanup();
    errorsTotal = 5001;
    await open();
    expect(screen.getByText('The file lists up to 5,000 errors')).toBeTruthy();
  });
});

describe('status polling', () => {
  it('polls every 2 s while processing (showing step/progress) and stops once settled', async () => {
    let n = 0;
    handler = url => {
      if (url === '/api/uploads/up_1') {
        n++;
        return json(200, { data: n === 1 ? rec('processing', { step: 'Reading rows', progress: 40 }) : rec('rejected', { errorMessage: 'The file has no header row.' }) });
      }
      if (url.includes('/errors')) return json(200, { data: { page: 1, total: 0, errors: [] } });
      return undefined;
    };
    renderAt('/uploads/review?upload=up_1', <UploadReviewView />);
    expect(await screen.findByText('Reading rows')).toBeTruthy();
    expect(screen.getByText('40%')).toBeTruthy();
    expect(await screen.findByText('The file has no header row.', {}, { timeout: 3500 })).toBeTruthy();
    const after = n;
    await new Promise(r => setTimeout(r, 2300));
    expect(n).toBe(after);
  }, 10_000);
});

describe('column mapping (real mode)', () => {
  const mappingUpload = (confidence: number, missingRequired: string[] = []) => rec('needs_mapping', {
    headers: ['EAN', 'Selling Price', 'Qty'],
    mappingSuggestion: { fields: { barcode: 'EAN', price: 'Selling Price', ghost: 'Not a column' }, missingRequired, confidence },
    fields: [
      { key: 'barcode', label: 'Barcode', required: true },
      { key: 'price', label: 'Price', required: true },
      { key: 'stock', label: 'Stock', required: true },
    ],
  });

  it('pre-selects suggestion.fields, hints missingRequired, and posts the mapping', async () => {
    handler = (url, init) => {
      if (url === '/api/uploads/up_1') return json(200, { data: mappingUpload(0.9, ['stock']) });
      if (url === '/api/uploads/up_1/mapping' && init.method === 'POST') return json(200, { data: rec('processing') });
      return undefined;
    };
    renderAt('/uploads/mapping?upload=up_1', <ColumnMappingView />);
    const barcode = await screen.findByText('Barcode');
    expect((within(barcode.closest('tr')!).getByRole('combobox') as HTMLSelectElement).value).toBe('EAN');
    expect((within(screen.getByText('Price').closest('tr')!).getByRole('combobox') as HTMLSelectElement).value).toBe('Selling Price');
    const stockRow = screen.getByText('Stock').closest('tr')!;
    expect(within(stockRow).getByText(/Not found in this file automatically/)).toBeTruthy();
    expect(screen.queryByText(/Check this mapping/)).toBeNull();

    const save = screen.getByRole('button', { name: 'Save and continue' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // a required field is still unmapped
    fireEvent.change(within(stockRow).getByRole('combobox'), { target: { value: 'Qty' } });
    expect(within(stockRow).queryByText(/Not found in this file automatically/)).toBeNull();
    fireEvent.click(save);

    await waitFor(() => expect(calls(u => u.endsWith('/mapping'))).toHaveLength(1));
    const body = JSON.parse(String((calls(u => u.endsWith('/mapping'))[0][1] as RequestInit).body));
    expect(body).toEqual({ fields: { barcode: 'EAN', price: 'Selling Price', stock: 'Qty' } });
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/uploads/review?upload=up_1'));
  });

  it('asks the user to check a low-confidence suggestion', async () => {
    handler = url => (url === '/api/uploads/up_1' ? json(200, { data: mappingUpload(0.3) }) : undefined);
    renderAt('/uploads/mapping?upload=up_1', <ColumnMappingView />);
    expect(await screen.findByText(/Check this mapping/)).toBeTruthy();
  });
});

describe('history (real mode)', () => {
  beforeEach(() => {
    handler = url => (url === '/api/uploads'
      ? json(200, { data: [rec('needs_mapping'), rec('needs_review', { id: 'up_2' }), rec('failed', { id: 'up_3', errorMessage: 'Storage timed out.' })] })
      : undefined);
  });

  it('lists uploads from the API, links each to its next step, and explains failures', async () => {
    renderAt('/uploads', <UploadsHistoryView />);
    expect((await screen.findByRole('link', { name: 'Map columns' })).getAttribute('href')).toBe('/uploads/mapping?upload=up_1');
    expect(screen.getByRole('link', { name: 'Review' }).getAttribute('href')).toBe('/uploads/review?upload=up_2');
    expect(screen.getByText('Storage timed out.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Upload file/ })).toBeTruthy();
  });

  it('hides Upload without uploads.upload and Map columns without uploads.map', async () => {
    perms.delete('uploads.upload');
    perms.delete('uploads.map');
    renderAt('/uploads', <UploadsHistoryView />);
    await screen.findByRole('link', { name: 'Review' });
    expect(screen.queryByRole('button', { name: /Upload file/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Map columns' })).toBeNull();
  });
});

describe('upload modal (real mode)', () => {
  it('is not rendered without uploads.upload', () => {
    perms.delete('uploads.upload');
    renderAt('/', <UploadModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('create -> PUT -> complete -> poll, then opens mapping when the backend asks for it', async () => {
    class OkXHR {
      upload = { onprogress: null as null | ((e: object) => void) };
      status = 0; responseText = ''; withCredentials = false;
      onload: null | (() => void) = null; onloadend: null | (() => void) = null; onerror = null; onabort = null;
      static sent: { url: string; headers: Record<string, string> }[] = [];
      private url = ''; private headers: Record<string, string> = {};
      open(_m: string, u: string) { this.url = u; }
      setRequestHeader(k: string, v: string) { this.headers[k] = v; }
      send() { OkXHR.sent.push({ url: this.url, headers: this.headers }); queueMicrotask(() => { this.status = 200; this.onload?.(); this.onloadend?.(); }); }
    }
    vi.stubGlobal('XMLHttpRequest', OkXHR);
    handler = (url, init) => {
      if (url === '/api/uploads' && init.method === 'POST') return json(201, { data: {
        ...rec('uploading'), uploadUrl: 'https://bucket.example/k?sig=1', uploadMethod: 'PUT',
        uploadHeaders: { 'Content-Type': 'text/csv', 'x-amz-server-side-encryption': 'AES256' }, uploadUrlExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      } });
      if (url === '/api/uploads/up_1/complete') return new Response(null, { status: 204 });
      if (url === '/api/uploads/up_1') return json(200, { data: rec('needs_mapping', { headers: [], fields: [], mappingSuggestion: { fields: {}, missingRequired: [], confidence: 0 } }) });
      return undefined;
    };
    renderAt('/', <UploadModal />);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keeta' }));
    fireEvent.change(screen.getByTestId('upload-input'), { target: { files: [new File(['a,b\n1,2'], 'k.csv', { type: 'text/csv' })] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/uploads/mapping?upload=up_1'));
    expect(JSON.parse(String((calls((u, m) => u === '/api/uploads' && m === 'POST')[0][1] as RequestInit).body)))
      .toEqual({ source: 'keeta', fileName: 'k.csv', size: 7, contains: 'full' });
    expect(OkXHR.sent).toEqual([{ url: 'https://bucket.example/k?sig=1', headers: { 'Content-Type': 'text/csv', 'x-amz-server-side-encryption': 'AES256' } }]);
    expect(calls(u => u === '/api/uploads/up_1/complete')).toHaveLength(1);
    expect(app.closeUploadModal).toHaveBeenCalled();
  });

  describe('says which step failed (and logs it)', () => {
    let putStatus = 200;
    class StatusXHR {
      upload = { onprogress: null }; status = 0; responseText = ''; withCredentials = false;
      onload: null | (() => void) = null; onloadend: null | (() => void) = null; onerror = null; onabort = null;
      open() {} setRequestHeader() {}
      send() { queueMicrotask(() => { this.status = putStatus; this.onload?.(); this.onloadend?.(); }); }
    }
    const created = () => json(201, { data: {
      ...rec('uploading'), uploadUrl: 'http://127.0.0.1:8333/qorloop-uploads/k?sig=1', uploadMethod: 'PUT',
      uploadHeaders: { 'Content-Type': 'text/csv', 'x-amz-server-side-encryption': 'AES256' }, uploadUrlExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    } });
    let logged: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { putStatus = 200; vi.stubGlobal('XMLHttpRequest', StatusXHR); logged = vi.spyOn(console, 'error').mockImplementation(() => undefined); });
    afterEach(() => logged.mockRestore());

    const submit = async () => {
      renderAt('/', <UploadModal />);
      fireEvent.change(screen.getByTestId('upload-input'), { target: { files: [new File(['a,b'], 'a.csv', { type: 'text/csv' })] } });
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Upload' }));
      return (await screen.findByRole('alert')).textContent ?? '';
    };

    it('create failed', async () => {
      handler = (url, init) => (url === '/api/uploads' && init.method === 'POST' ? json(503, { error: { code: 'UNAVAILABLE', message: 'Storage is not configured' } }) : undefined);
      expect(await submit()).toBe('Could not start the upload: Storage is not configured');
      expect(logged).toHaveBeenCalledWith('[uploads] upload failed at step "create"', expect.anything());
    });

    it('storage upload failed, with its HTTP status', async () => {
      putStatus = 500;
      handler = (url, init) => (url === '/api/uploads' && init.method === 'POST' ? created() : undefined);
      expect(await submit()).toBe('Storage upload failed (HTTP 500). Please try again.');
      expect(calls(u => u.endsWith('/complete'))).toHaveLength(0);
      expect(logged).toHaveBeenCalledWith('[uploads] upload failed at step "storage"', expect.anything());
    });

    it('complete failed, with the API message, and Retry calls complete again', async () => {
      let completes = 0;
      handler = (url, init) => {
        if (url === '/api/uploads' && init.method === 'POST') return created();
        if (url === '/api/uploads/up_1/complete') {
          completes++;
          return completes === 1 ? json(409, { error: { code: 'INVALID_STATE', message: 'Upload object not found in storage' } }) : json(200, { data: rec('processing') });
        }
        if (url === '/api/uploads/up_1') return json(200, { data: rec('needs_review') });
        return undefined;
      };
      expect(await submit()).toContain('The file was uploaded, but the server could not start processing it: Upload object not found in storage');
      expect(logged).toHaveBeenCalledWith('[uploads] upload failed at step "complete"', expect.anything());
      expect((within(screen.getByRole('dialog')).getByRole('button', { name: 'Upload' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/uploads/review?upload=up_1'));
      expect(completes).toBe(2);
      expect(calls((u, m) => u === '/api/uploads' && m === 'POST')).toHaveLength(1); // no second upload record
    });
  });

  it('rejects a file over 25 MB before calling the API', () => {
    renderAt('/', <UploadModal />);
    const big = new File(['x'], 'big.xlsx');
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    fireEvent.change(screen.getByTestId('upload-input'), { target: { files: [big] } });
    expect(screen.getByRole('alert').textContent).toMatch(/larger than 25 MB/);
    expect((within(screen.getByRole('dialog')).getByRole('button', { name: 'Upload' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('flag off', () => {
  it('keeps the demo views (they read the demo store)', () => {
    vi.stubEnv('VITE_REAL_UPLOADS', '');
    expect(() => renderAt('/uploads', <UploadsHistoryView />)).toThrow('demo store used in real mode');
  });
});
