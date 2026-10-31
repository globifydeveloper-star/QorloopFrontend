import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useApp } from '../../context/AppContext';
import { ApiError } from '../../api/client';
import { ERRORS_XLSX_LIMIT, uploadsApi } from '../../api/uploads';
import { REVIEW_TABS, UPLOAD_ERRORS_PAGE_SIZE } from '../../api/types';
import type { ChangeType, ChangeValue, ReviewRow, ReviewTab, UploadDetail, UploadSummary, UploadRowError, ValueChange } from '../../api/types';
import {
  ConfirmDialog, DISCARDABLE, FailureNotice, SOURCE_LABELS, StatusBadge, StatusProgress, UPLOADS_LIST_KEY, cell, errorText,
  formatBytes, saveBlob, uploadKey, useUploadStatus,
} from './shared';

const TAB_LABELS: Record<ReviewTab, string> = {
  price: 'Price changes',
  stock: 'Stock changes',
  availability: 'Availability changes',
  new: 'New products',
  unmatched: 'Unmatched rows',
  all: 'All rows',
};

const CHANGE_LABELS: Record<ChangeType, string> = {
  new: 'New product',
  price: 'Price',
  stock: 'Stock',
  price_stock: 'Price and stock',
  availability: 'Availability',
  price_availability: 'Price and availability',
  none: 'No change',
  unmatched: 'Unmatched',
};

/** Counts shown at the top of the review, in this order. */
const SUMMARY_COUNTS: { key: keyof UploadSummary; label: string; tone?: (n: number) => string | undefined }[] = [
  { key: 'rowsRead', label: 'Rows read' },
  { key: 'matched', label: 'Matched to catalogue', tone: () => 'text-[#027864]' },
  { key: 'newProducts', label: 'New products', tone: () => 'text-blue-600' },
  { key: 'rowsWithErrors', label: 'Rows with errors', tone: n => (n > 0 ? 'text-red-600' : undefined) },
  { key: 'priceChanges', label: 'Price changes', tone: () => 'text-blue-600' },
  { key: 'stockChanges', label: 'Stock changes', tone: () => 'text-blue-600' },
  { key: 'missingFromFile', label: 'Missing from file', tone: n => (n > 0 ? 'text-amber-600' : undefined) },
  { key: 'unmatched', label: 'Unmatched rows', tone: n => (n > 0 ? 'text-amber-600' : undefined) },
];

/** Counts the apply confirmation lists: what is about to change in the catalogue. */
const APPLY_COUNTS: { key: keyof UploadSummary; label: string }[] = [
  { key: 'newProducts', label: 'New products' },
  { key: 'priceChanges', label: 'Price changes' },
  { key: 'stockChanges', label: 'Stock changes' },
  { key: 'missingFromFile', label: 'Missing from file' },
];

const PAGE_SIZE = 50;

/**
 * Upload detail page: live status while processing, the review tabs once the backend reaches needs_review, and the
 * row errors. "Confirm and apply" POSTs /apply, polls while `applying`, and returns to the Dashboard once `applied`;
 * an applied upload is a read-only summary.
 */
export const RealUploadReviewView: React.FC = () => {
  const [params] = useSearchParams();
  const id = params.get('upload');
  const status = useUploadStatus(id);

  if (!id) return <Shell><p className="text-sm text-gray-500">No upload selected. Open one from <Link to="/uploads" className="text-[#027864] hover:underline">Uploads</Link>.</p></Shell>;
  if (status.isPending) return <Shell><p className="text-sm text-gray-500">Loading…</p></Shell>;
  if (status.isError) return <Shell><p role="alert" className="text-sm text-red-600">{errorText(status.error)}</p></Shell>;
  return <Detail upload={status.data} />;
};

const Detail: React.FC<{ upload: UploadDetail }> = ({ upload }) => {
  const { can } = useAuth();
  const { showToast } = useApp();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [confirmingApply, setConfirmingApply] = useState(false);
  // Set synchronously while the POST is in flight, so a double click cannot send a second one (the mutation's
  // isPending only shows up after a render).
  const applyInFlight = useRef(false);
  // This page sent the apply, so reaching `applied` returns to the Dashboard (opening an applied upload does not).
  const appliedHere = useRef(false);
  const apply = useMutation({
    mutationFn: () => uploadsApi.apply(upload.id),
    onSuccess: rec => {
      setConfirmingApply(false);
      qc.setQueryData<UploadDetail>(uploadKey(upload.id), old => ({ ...old, ...rec }));
      // Refetch so polling picks up from the new status.
      void qc.invalidateQueries({ queryKey: uploadKey(upload.id) });
      void qc.invalidateQueries({ queryKey: UPLOADS_LIST_KEY });
    },
    onSettled: () => { applyInFlight.current = false; },
  });
  const startApply = () => {
    if (applyInFlight.current) return;
    applyInFlight.current = true;
    appliedHere.current = true;
    apply.mutate();
  };
  const openApply = () => { apply.reset(); setConfirmingApply(true); };

  useEffect(() => {
    if (upload.status !== 'applied' || !appliedHere.current) return;
    appliedHere.current = false;
    showToast(`Changes from ${upload.fileName} were applied to the catalogue.`);
    navigate('/');
    // Only a status change matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload.status]);

  const discard = useMutation({
    mutationFn: () => uploadsApi.discard(upload.id),
    onSuccess: async () => {
      setConfirming(false);
      await qc.invalidateQueries({ queryKey: uploadKey(upload.id) });
      void qc.invalidateQueries({ queryKey: UPLOADS_LIST_KEY });
    },
  });
  const canDiscard = can('uploads.discard') && DISCARDABLE.has(upload.status) && !apply.isPending;
  const canApply = can('uploads.apply') && upload.status === 'needs_review';
  const rolledBack = upload.status === 'needs_review' && Boolean(upload.errorMessage);
  const summary = upload.summary;

  return (
    <Shell crumb={upload.fileName}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{upload.fileName}</h1>
        <StatusBadge status={upload.status} />
      </div>
      <p className="text-xs text-gray-500 -mt-4">
        {SOURCE_LABELS[upload.source] ?? upload.source} &nbsp;•&nbsp; {upload.contains === 'full' ? 'Full list' : 'Partial update'} &nbsp;•&nbsp; {formatBytes(upload.size)}
      </p>

      {(upload.status === 'uploading' || upload.status === 'processing') && (
        <div className="bg-white border border-gray-200 rounded-xl p-4"><StatusProgress upload={upload} /></div>
      )}

      {upload.status === 'needs_mapping' && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-900 flex items-center justify-between gap-3">
          <span>Qorloop does not recognise this file layout yet. Its columns need to be mapped.</span>
          {can('uploads.map') && (
            <Link to={`/uploads/mapping?upload=${encodeURIComponent(upload.id)}`} className="px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg shrink-0">Map columns</Link>
          )}
        </div>
      )}

      <FailureNotice upload={upload} />

      {upload.status === 'discarded' && <p className="text-sm text-gray-600">This upload was discarded. Nothing from it was applied.</p>}

      {upload.status === 'applying' && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <StatusProgress upload={upload} />
          <p className="text-xs text-gray-600">Applying the changes to the catalogue. You can leave this page; the upload keeps going.</p>
        </div>
      )}

      {upload.status === 'applied' && (
        <p className="p-4 bg-[#E3FAF3] border border-[#027864]/20 rounded-xl text-sm text-[#02604F] flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            These changes were applied to the catalogue{upload.appliedAt ? ` on ${new Date(upload.appliedAt).toLocaleString()}` : ''}.
            This upload is now read-only.
          </span>
        </p>
      )}

      {rolledBack && (
        <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-900 flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="font-semibold">The changes could not be applied</p>
            <p>{upload.errorMessage}</p>
            <p className="text-xs text-red-800">Everything from this attempt was rolled back, so the catalogue has not changed.</p>
          </div>
          {canApply && (
            <button type="button" onClick={openApply} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg shrink-0">
              Retry
            </button>
          )}
        </div>
      )}

      {summary && (
        <div className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-900">Summary</h2>
          {summary.firstImport && (
            <p className="text-xs text-blue-800 bg-blue-50 border border-blue-100 rounded-lg p-2">This is the first file from this source.</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {SUMMARY_COUNTS.filter(c => c.key !== 'missingFromFile' || summary.contains === 'full').map(c => {
              const n = summary[c.key] as number;
              return (
                <div key={c.key} className="bg-white border border-gray-200 rounded-xl p-3">
                  <div className="text-[11px] text-gray-500">{c.label}</div>
                  <div className={`text-xl font-bold mt-1 ${c.tone?.(n) ?? 'text-gray-900'}`}>{n.toLocaleString()}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          {upload.status === 'needs_review' && <ReviewTabs id={upload.id} />}
          {(upload.status === 'needs_review' || upload.status === 'rejected' || upload.status === 'failed') && <RowErrors upload={upload} />}
        </div>

        <div className="space-y-2">
          {canApply && (
            <button
              type="button"
              onClick={openApply}
              disabled={apply.isPending}
              className="w-full py-2.5 text-xs font-bold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirm and apply
            </button>
          )}
          {canDiscard && (
            <button
              type="button"
              onClick={() => { discard.reset(); setConfirming(true); }}
              className="w-full py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Discard upload
            </button>
          )}
          <button type="button" onClick={() => navigate('/uploads')} className="w-full py-2 text-xs font-medium text-gray-600 hover:underline">
            Back to uploads
          </button>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog title="Discard this upload?" confirmLabel="Discard" busy={discard.isPending} onConfirm={() => discard.mutate()} onClose={() => setConfirming(false)}>
          <p><span className="font-medium text-gray-900">{upload.fileName}</span> will be marked as discarded. Nothing from it will be applied, and this cannot be undone.</p>
          {discard.isError && <p role="alert" className="mt-2 text-xs text-red-600">{errorText(discard.error)}</p>}
        </ConfirmDialog>
      )}

      {confirmingApply && (
        <ConfirmDialog title="Apply these changes?" confirmLabel="Apply changes" tone="primary" busy={apply.isPending} onConfirm={startApply} onClose={() => setConfirmingApply(false)}>
          <p>The following changes from <span className="font-medium text-gray-900">{upload.fileName}</span> will be written to the catalogue:</p>
          {summary && (
            <dl className="mt-3 divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {APPLY_COUNTS.filter(c => c.key !== 'missingFromFile' || summary.contains === 'full').map(c => (
                <div key={c.key} className="flex items-center justify-between px-3 py-2">
                  <dt>{c.label}</dt>
                  <dd className="font-semibold text-gray-900">{(summary[c.key] as number).toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-3 font-semibold text-gray-900">This cannot be undone.</p>
          {apply.isError && <p role="alert" className="mt-2 text-xs text-red-600">{errorText(apply.error)}</p>}
        </ConfirmDialog>
      )}
    </Shell>
  );
};

const ReviewTabs: React.FC<{ id: string }> = ({ id }) => {
  const [tab, setTab] = useState<ReviewTab>('price');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['uploads', 'review', id, tab, page],
    queryFn: () => uploadsApi.review(id, tab, page, PAGE_SIZE),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const data = q.data && q.data.tab === tab ? q.data : undefined;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div role="tablist" className="flex items-center border-b border-gray-200 px-4 overflow-x-auto">
        {REVIEW_TABS.map(t => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => { setTab(t); setPage(1); }}
            className={`py-3 px-3 text-xs font-semibold border-b-2 whitespace-nowrap ${tab === t ? 'border-[#027864] text-[#027864]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {TAB_LABELS[t]}{tab === t && data ? ` (${data.total})` : ''}
          </button>
        ))}
      </div>
      {q.isError ? (
        <p role="alert" className="p-4 text-xs text-red-600">{errorText(q.error)}</p>
      ) : !data ? (
        <p className="p-4 text-xs text-gray-500">Loading…</p>
      ) : (
        <>
          <ReviewTable tab={tab} rows={data.rows} />
          <Pager page={page} pages={pages} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
};

type ChangeKey = 'price' | 'stock' | 'availability';
const CHANGE_COLUMNS: Record<ReviewTab, ChangeKey[]> = {
  price: ['price'],
  stock: ['stock'],
  availability: ['availability'],
  new: [],
  unmatched: [],
  all: ['price', 'stock', 'availability'],
};
const CHANGE_HEADINGS: Record<ChangeKey, string> = { price: 'Price', stock: 'Stock', availability: 'Availability' };

const ReviewTable: React.FC<{ tab: ReviewTab; rows: ReviewRow[] }> = ({ tab, rows }) => {
  if (rows.length === 0) return <p className="p-4 text-xs text-gray-500">No {TAB_LABELS[tab].toLowerCase()}.</p>;
  const changeCols = CHANGE_COLUMNS[tab];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
          <tr>
            <th className="py-2.5 px-3 whitespace-nowrap">Row</th>
            {tab === 'all' && <th className="py-2.5 px-3 whitespace-nowrap">Change</th>}
            <th className="py-2.5 px-3 whitespace-nowrap">File row</th>
            {tab !== 'new' && tab !== 'unmatched' && <th className="py-2.5 px-3 whitespace-nowrap">Product</th>}
            {changeCols.map(c => <th key={c} className="py-2.5 px-3 whitespace-nowrap">{CHANGE_HEADINGS[c]}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(r => {
            const data = describeData(r.parsed.data);
            return (
              <tr key={r.rowNumber} className="hover:bg-gray-50/70">
                <td className="py-2.5 px-3 text-gray-600 font-mono">{r.rowNumber}</td>
                {tab === 'all' && <td className="py-2.5 px-3 text-gray-700 whitespace-nowrap">{CHANGE_LABELS[r.changeType] ?? r.changeType}</td>}
                <td className="py-2.5 px-3 text-gray-700 max-w-[280px] truncate" title={data}>{data}</td>
                {tab !== 'new' && tab !== 'unmatched' && <td className="py-2.5 px-3 text-gray-600 font-mono whitespace-nowrap">{r.matchProductId ?? '—'}</td>}
                {changeCols.map(c => (
                  <td key={c} className="py-2.5 px-3 whitespace-nowrap">
                    <OldNew field={c} change={r.parsed.change[c]} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const showValue = (field: ChangeKey, v: ChangeValue) => {
  if (v === null || v === '') return '—';
  if (field === 'availability' && typeof v === 'boolean') return v ? 'Available' : 'Unavailable';
  if (typeof v === 'number') return v.toLocaleString(undefined, field === 'price' ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : undefined);
  return String(v);
};

const OldNew: React.FC<{ field: ChangeKey; change: ValueChange | undefined }> = ({ field, change }) => {
  if (!change) return <span className="text-gray-300">—</span>;
  return (
    <span data-testid={`change-${field}`}>
      <span className="text-gray-500 line-through decoration-gray-300">{showValue(field, change.old)}</span>
      <span className="mx-1.5 text-gray-400" aria-label="changes to">→</span>
      <span className="font-semibold text-gray-900">{showValue(field, change.new)}</span>
    </span>
  );
};

/** One line summarising the parsed file row, so a change can be traced back to the file. */
const describeData = (data: Record<string, unknown>) =>
  Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${cell(v)}`).join(' · ');

/** A rejected upload's message that points at bad rows (as opposed to e.g. "no header row"). */
const MENTIONS_INVALID_ROWS = /invalid rows?|rows? (with|had|have) errors|row errors/i;

const RowErrors: React.FC<{ upload: UploadDetail }> = ({ upload }) => {
  const { id } = upload;
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['uploads', 'errors', id, page], queryFn: () => uploadsApi.errors(id, page), placeholderData: keepPreviousData, retry: false });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / UPLOAD_ERRORS_PAGE_SIZE)) : 1;
  const shownCount = q.data?.total ?? upload.summary?.rowsWithErrors ?? 0;
  const hasErrors = (upload.summary?.rowsWithErrors ?? 0) > 0 || (q.data?.total ?? 0) > 0
    || (upload.status === 'rejected' && MENTIONS_INVALID_ROWS.test(upload.errorMessage ?? ''));

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-900">
          Row errors{q.data ? ` (${q.data.total})` : ''}
        </h2>
        {hasErrors && can('uploads.view') && <DownloadErrors id={id} capped={shownCount > ERRORS_XLSX_LIMIT} />}
      </div>
      {q.isError ? (
        <p role="alert" className="p-4 text-xs text-red-600">{errorText(q.error)}</p>
      ) : !q.data ? (
        <p className="p-4 text-xs text-gray-500">Loading…</p>
      ) : q.data.errors.length === 0 ? (
        <p className="p-4 text-xs text-gray-500">No row errors.</p>
      ) : (
        <>
          <ErrorsTable errors={q.data.errors} />
          <Pager page={page} pages={pages} total={q.data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
};

const DownloadErrors: React.FC<{ id: string; capped: boolean }> = ({ id, capped }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { blob, fileName } = await uploadsApi.downloadErrors(id);
      saveBlob(blob, fileName);
    } catch (e) {
      console.error('[uploads] downloading the errors file failed', e);
      // A 401 has already sent the app to the session-expired screen (client.ts); the message is for everything else.
      setError(`Could not download the errors: ${e instanceof ApiError ? e.message : errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#027864] bg-white border border-[#027864]/40 rounded-lg hover:bg-[#E3FAF3] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download className="w-3.5 h-3.5" />
        {busy ? 'Preparing…' : 'Download errors (.xlsx)'}
      </button>
      {capped && <p className="text-[11px] text-gray-500">The file lists up to {ERRORS_XLSX_LIMIT.toLocaleString('en-US')} errors</p>}
      {error && <p role="alert" className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
};

const ErrorsTable: React.FC<{ errors: UploadRowError[] }> = ({ errors }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-xs">
      <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
        <tr>
          <th className="py-2.5 px-3">Row</th>
          <th className="py-2.5 px-3">Column</th>
          <th className="py-2.5 px-3">Value</th>
          <th className="py-2.5 px-3">Problem</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {errors.map((e, i) => (
          <tr key={`${e.row}-${e.column}-${i}`} className="hover:bg-gray-50/70">
            <td className="py-2.5 px-3 text-gray-600 font-mono">{e.row}</td>
            <td className="py-2.5 px-3 font-medium text-gray-900">{e.column ?? '—'}</td>
            <td className="py-2.5 px-3 font-mono text-gray-600 max-w-[200px] truncate">{e.value ?? ''}</td>
            <td className="py-2.5 px-3 text-red-600">{e.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Pager: React.FC<{ page: number; pages: number; total: number; onPage: (p: number) => void }> = ({ page, pages, total, onPage }) => (
  <div className="p-3 border-t border-gray-100 text-xs text-gray-500 flex items-center justify-between">
    <span>{total.toLocaleString()} total</span>
    <span className="flex items-center gap-2">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="px-2 py-1 border rounded disabled:opacity-40">Previous</button>
      <span>Page {page} of {pages}</span>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className="px-2 py-1 border rounded disabled:opacity-40">Next</button>
    </span>
  </div>
);

const Shell: React.FC<{ crumb?: string; children: React.ReactNode }> = ({ crumb, children }) => (
  <div className="p-8 max-w-7xl mx-auto space-y-6">
    <div className="flex items-center gap-1.5 text-xs text-gray-500">
      <Link to="/uploads" className="text-blue-600 hover:underline">Uploads</Link>
      {crumb && <><span>/</span><span className="text-gray-700">{crumb}</span></>}
    </div>
    {children}
  </div>
);
