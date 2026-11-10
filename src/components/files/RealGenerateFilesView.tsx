import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, Eye, FileSpreadsheet, Info, Loader2, Lock, XCircle } from 'lucide-react';
import { ApiError } from '../../api/client';
import type { ReconMarketplaceId, ReconReference } from '../../api/recon';
import {
  generatedFilesApi,
  type FileKind, type FilePreview, type FileScope, type FileSelection, type GeneratedFile, type GenerationJob,
} from '../../api/generatedFiles';
import { useAuth } from '../../auth/AuthContext';
import { EmptyState, ErrorState, LoadingState } from '../common/States';
import { invalidateOnboarding } from '../onboarding/shared';
import { REFERENCE_LABELS, marketplaceName, money2, qatarDateTime, reconErrorText, useReconSummary } from '../recon/shared';

export const KIND_LABELS: Record<FileKind, string> = { stock: 'Stock', price: 'Price', stock_price: 'Stock and price' };
export const SCOPE_LABELS: Record<FileScope, string> = { mismatches: 'Only products that need a change', all: 'All listed products' };

/** Job polling. Mutable so tests can shorten it. */
export const filesTiming = { pollMs: 2_000 };

const HISTORY_KEY = ['generated-files', 'history'] as const;

/** One key per set of choices: a preview counts only for the choices it was made with. */
const keyOf = (s: FileSelection) => `${s.marketplaceId}|${s.kind}|${s.scope}|${s.reference ?? ''}`;

const errorText = (e: unknown) => (e instanceof ApiError && e.status === 404 ? 'This file is no longer available.' : reconErrorText(e));

/** Fetch a signed URL only now and hand it straight to the browser; it is never kept in state. */
export async function startDownload(id: string) {
  const { url, fileName } = await generatedFilesApi.download(id);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const RealGenerateFilesView: React.FC = () => {
  const { can } = useAuth();
  const qc = useQueryClient();
  const summary = useReconSummary();
  const available = (summary.data?.marketplaces ?? []).filter(m => m.hasData);

  const [marketplaceId, setMarketplaceId] = useState<ReconMarketplaceId | null>(null);
  const [kind, setKind] = useState<FileKind>('stock_price');
  const [scope, setScope] = useState<FileScope>('mismatches');
  /** null: the store's default from the pricing settings (the summary names it). */
  const [reference, setReference] = useState<ReconReference | null>(null);
  const [preview, setPreview] = useState<{ key: string; data: FilePreview } | null>(null);
  /** 409 reasons by choice key, so the reason sits next to the marketplace it is about. */
  const [blocked, setBlocked] = useState<Record<string, string>>({});
  const [job, setJob] = useState<{ jobId: string; key: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const chosen = marketplaceId ?? available[0]?.marketplaceId ?? null;
  const ref = reference ?? summary.data?.reference ?? 'marketplace';
  const selection: FileSelection | null = chosen ? { marketplaceId: chosen, kind, scope, reference: ref } : null;
  const key = selection ? keyOf(selection) : '';
  const seen = preview && preview.key === key ? preview.data : null;

  /** Every change of choice clears the preview: Generate needs a preview of the current choices. */
  const choose = (apply: () => void) => { apply(); setPreview(null); setActionError(null); };

  const remember409 = (k: string, e: unknown) => {
    if (e instanceof ApiError && e.status === 409) { setBlocked(b => ({ ...b, [k]: e.message })); return true; }
    return false;
  };

  const previewM = useMutation({
    mutationFn: (s: FileSelection) => generatedFilesApi.preview(s),
    onSuccess: (data, s) => {
      const k = keyOf(s);
      setBlocked(b => { const { [k]: _gone, ...rest } = b; return rest; });
      setPreview({ key: k, data });
    },
    onError: (e, s) => { if (!remember409(keyOf(s), e)) setActionError(`We could not preview the file: ${reconErrorText(e)}`); },
  });

  const generateM = useMutation({
    mutationFn: (s: FileSelection) => generatedFilesApi.generate(s),
    onSuccess: ({ jobId }, s) => setJob({ jobId, key: keyOf(s) }),
    onError: (e, s) => {
      if (remember409(keyOf(s), e)) setPreview(null);
      else setActionError(`We could not start the file: ${reconErrorText(e)}`);
    },
  });

  const jobQ = useQuery<GenerationJob>({
    queryKey: ['generated-files', 'job', job?.jobId],
    queryFn: ({ signal }) => generatedFilesApi.job(job!.jobId, signal),
    enabled: Boolean(job),
    retry: false,
    refetchInterval: q => (q.state.data?.state === 'done' || q.state.data?.state === 'failed' || q.state.error ? false : filesTiming.pollMs),
  });
  const state = job ? jobQ.data?.state ?? 'queued' : null;
  const working = generateM.isPending || state === 'queued' || state === 'running';

  // When the job is done: refresh the history and start the download once. The backend's fileId is optional on a done
  // job (BullMQ returnvalue); without it the file is still listed in the history, so only the automatic download is skipped.
  const downloadedFor = useRef<string | null>(null);
  const done = jobQ.data?.state === 'done';
  const fileId = done ? jobQ.data?.fileId : undefined;
  useEffect(() => {
    if (!job || !done || downloadedFor.current === job.jobId) return;
    downloadedFor.current = job.jobId;
    invalidateOnboarding(qc);
    void qc.invalidateQueries({ queryKey: HISTORY_KEY });
    if (fileId && can('files.download')) startDownload(fileId).catch(e => setActionError(`The file is ready but the download did not start: ${errorText(e)}`));
  }, [job, done, fileId, qc, can]);

  if (summary.isPending) return <Page><LoadingState label="Loading marketplaces…" /></Page>;
  if (summary.isError) return <Page><ErrorState error={summary.error} onRetry={() => void summary.refetch()} title="We could not load the marketplaces" /></Page>;

  const canPreview = can('files.preview');
  const canGenerate = can('files.generate');
  const blockedHere = blocked[key];

  return (
    <Page>
      {available.length === 0 ? (
        <section className="bg-white border border-gray-200 rounded-xl">
          <EmptyState title="No marketplace is ready for a file yet" hint="Upload and apply a marketplace file first. Files are built from the latest compared marketplace file." />
        </section>
      ) : (
        <section aria-label="Choose the file" className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
          <fieldset>
            <legend className="text-sm font-bold text-gray-900 mb-2">Marketplace</legend>
            <div className="grid sm:grid-cols-2 gap-2">
              {available.map(m => {
                const reason = selection ? blocked[keyOf({ ...selection, marketplaceId: m.marketplaceId })] : undefined;
                return (
                  <label key={m.marketplaceId} className={`flex items-start gap-2 p-3 rounded-lg border text-xs cursor-pointer ${chosen === m.marketplaceId ? 'border-[#027864] bg-[#F2F7F6]' : 'border-gray-200'}`}>
                    <input type="radio" name="marketplace" className="mt-0.5 accent-[#027864]" checked={chosen === m.marketplaceId}
                      onChange={() => choose(() => setMarketplaceId(m.marketplaceId))} />
                    <span className="min-w-0">
                      <span className="block font-semibold text-gray-900">{marketplaceName(m.marketplaceId)}</span>
                      <span className="block text-gray-500">{m.stock} stock and {m.price} price issues · uploaded {qatarDateTime(m.lastUploadAt)}</span>
                      {reason && (
                        <span role="alert" data-testid={`blocked-${m.marketplaceId}`} className="mt-1 flex items-start gap-1 text-red-700">
                          <XCircle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden /> {reason}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="grid md:grid-cols-3 gap-5">
            <fieldset>
              <legend className="text-sm font-bold text-gray-900 mb-2">What the file updates</legend>
              {(Object.keys(KIND_LABELS) as FileKind[]).map(k => (
                <Radio key={k} name="kind" label={KIND_LABELS[k]} checked={kind === k} onChange={() => choose(() => setKind(k))} />
              ))}
              <label className="flex items-center gap-2 py-1 text-xs text-gray-400 cursor-not-allowed">
                <input type="radio" name="kind" disabled /> New products <span className="inline-flex items-center gap-1 text-[11px]"><Lock className="w-3 h-3" aria-hidden />Not available yet</span>
              </label>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-bold text-gray-900 mb-2">Products in the file</legend>
              {(Object.keys(SCOPE_LABELS) as FileScope[]).map(s => (
                <Radio key={s} name="scope" label={SCOPE_LABELS[s]} checked={scope === s} onChange={() => choose(() => setScope(s))} />
              ))}
            </fieldset>
            <fieldset>
              <legend className="text-sm font-bold text-gray-900 mb-2">Compare against</legend>
              {(Object.keys(REFERENCE_LABELS) as ReconReference[]).map(r => (
                <Radio key={r} name="reference" checked={ref === r} onChange={() => choose(() => setReference(r))}
                  label={`${REFERENCE_LABELS[r]}${r === summary.data?.reference ? ' (store default)' : ''}`} />
              ))}
            </fieldset>
          </div>

          <div role="note" className="flex items-start gap-2 p-3 rounded-lg bg-blue-50/70 text-blue-900 border border-blue-100 text-xs">
            <Info className="w-4 h-4 shrink-0 text-blue-600 mt-px" aria-hidden />
            <span>Prices in this file use the <b>{REFERENCE_LABELS[seen?.referenceUsed ?? ref]}</b>.</span>
          </div>

          {seen && seen.warnings.length > 0 && (
            <ul aria-label="Warnings" data-testid="preview-warnings" className="space-y-2">
              {seen.warnings.map(w => (
                <li key={w} role="alert" className="flex items-start gap-2 px-4 py-3 rounded-xl border border-amber-300 bg-amber-50 text-sm font-semibold text-amber-900">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" aria-hidden /> {w}
                </li>
              ))}
            </ul>
          )}

          {actionError && <div role="alert" className="text-xs text-red-700">{actionError}</div>}

          <div className="flex flex-wrap items-center gap-3">
            {canPreview && (
              <button type="button" onClick={() => selection && previewM.mutate(selection)} disabled={!selection || previewM.isPending || working}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">
                {previewM.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Eye className="w-3.5 h-3.5" aria-hidden />} Preview
              </button>
            )}
            {canGenerate && (
              <button type="button" onClick={() => { if (selection) { setActionError(null); generateM.mutate(selection); } }}
                disabled={!seen || Boolean(blockedHere) || working}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02634f] disabled:opacity-50">
                <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden /> Generate file
              </button>
            )}
            {canGenerate && !seen && !working && <span className="text-[11px] text-gray-500">Preview these choices first; Generate is enabled after the preview.</span>}
            {!canPreview && !canGenerate && <span className="text-[11px] text-gray-500">You can download files but not create them. Ask an owner or admin for access.</span>}
          </div>

          {job && <JobProgress job={jobQ.data} error={jobQ.error} onRetry={() => void jobQ.refetch()} state={state} downloads={can('files.download') ? (fileId ? 'started' : 'listed') : null} />}
          {seen && <PreviewPanel preview={seen} />}
        </section>
      )}

      <History />
    </Page>
  );
};

const Page: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="p-8 max-w-7xl mx-auto space-y-6">
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-gray-900">Generate marketplace files</h1>
      <p className="text-xs text-gray-500 mt-0.5">Build a corrected copy of a marketplace&apos;s own file, then upload it to the marketplace portal yourself.</p>
    </div>
    {children}
  </div>
);

const Radio: React.FC<{ name: string; label: string; checked: boolean; onChange: () => void }> = ({ name, label, checked, onChange }) => (
  <label className="flex items-center gap-2 py-1 text-xs text-gray-800 cursor-pointer">
    <input type="radio" name={name} checked={checked} onChange={onChange} className="accent-[#027864]" /> {label}
  </label>
);

const STATE_TEXT: Record<GenerationJob['state'], string> = {
  queued: 'Waiting to start…', running: 'Building the file…', done: 'The file is ready.', failed: 'The file could not be generated.',
};

const JobProgress: React.FC<{ job?: GenerationJob; error: unknown; onRetry: () => void; state: GenerationJob['state'] | null; downloads: 'started' | 'listed' | null }> = ({ job, error, onRetry, state, downloads }) => {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!state) return null;
  const failed = state === 'failed';
  return (
    <div role="status" data-testid="job-state" data-state={state}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs ${failed ? 'border-red-200 bg-red-50 text-red-800' : state === 'done' ? 'border-[#027864]/30 bg-[#E3FAF3] text-[#027864]' : 'border-blue-200 bg-blue-50 text-blue-900'}`}>
      {failed ? <XCircle className="w-4 h-4 shrink-0" aria-hidden /> : state === 'done' ? <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden /> : <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden />}
      <span>{STATE_TEXT[state]}{state === 'done' && downloads ? (downloads === 'started' ? ' The download has started; it is also in the list below.' : ' It is in the list below.') : ''}{failed && job?.message ? ` ${job.message}` : ''}</span>
    </div>
  );
};

const PreviewPanel: React.FC<{ preview: FilePreview }> = ({ preview: p }) => {
  const columns = p.firstRows.length ? Object.keys(p.firstRows[0]!) : [];
  return (
    <div aria-label="Preview" role="region" className="border-t border-gray-100 pt-4 space-y-4">
      <div className="text-sm text-gray-900">
        <div data-testid="preview-products" className="font-semibold">{p.productCount} {p.productCount === 1 ? 'product changes' : 'products change'}</div>
        {p.rowsToWrite !== p.productCount && (
          <div data-testid="preview-rows" className="text-xs text-gray-600">
            {p.rowsToWrite} {p.rowsToWrite === 1 ? 'row' : 'rows'} will be written (some products appear on more than one row of the marketplace file)
          </div>
        )}
      </div>
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([['Products in the file', p.productCount, 'productCount'], ['Price changes', p.priceChanges, 'priceChanges'],
          ['Availability changes', p.availabilityChanges, 'availabilityChanges'], ['Not in the marketplace file', p.notInFile, 'notInFile']] as const).map(([label, value, id]) => (
          <div key={id} className="rounded-xl border border-gray-200 bg-[#F8FBFA] p-3">
            <dt className="text-[11px] font-medium text-gray-500">{label}</dt>
            <dd data-testid={`preview-${id}`} className="mt-1 text-2xl font-bold text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="text-xs text-gray-600 space-y-1">
        <div>Built from <b>{p.sourceFile.name}</b>, uploaded {qatarDateTime(p.sourceFile.uploadedAt)}.</div>
        {p.notInFile > 0 && <div>{p.notInFile} selected {p.notInFile === 1 ? 'product is' : 'products are'} not in that file and will be left out.</div>}
        <div data-testid="largest-change">
          Largest price change (QAR):{' '}
          {p.largestPriceChange ? <b>{p.largestPriceChange.name} {money2(p.largestPriceChange.from)} → {money2(p.largestPriceChange.to)}</b> : 'none'}
        </div>
      </div>
      {columns.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-gray-900 mb-1.5">First {p.firstRows.length} {p.firstRows.length === 1 ? 'row' : 'rows'}, in the marketplace&apos;s own columns</h3>
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-600"><tr>{columns.map(c => <th key={c} className="py-2 px-3 font-semibold whitespace-nowrap">{c}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">
                {p.firstRows.map((r, i) => (
                  <tr key={i} data-testid="preview-row">{columns.map(c => <td key={c} className="py-2 px-3 whitespace-nowrap">{cell(r[c])}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const cell = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

const History: React.FC = () => {
  const { can } = useAuth();
  const q = useQuery({ queryKey: HISTORY_KEY, queryFn: ({ signal }) => generatedFilesApi.history(signal), retry: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const download = (f: GeneratedFile) => {
    setError(null); setBusy(f.id);
    startDownload(f.id).catch(e => setError(`We could not download ${f.fileName}: ${errorText(e)}`)).finally(() => setBusy(null));
  };
  return (
    <section aria-label="Generated files" className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-gray-900">Generated files</h2>
        <p className="text-[11px] text-gray-500">The last 30 days. Files can be downloaded until they expire.</p>
      </div>
      {error && <div role="alert" className="text-xs text-red-700">{error}</div>}
      {q.isPending ? <LoadingState label="Loading generated files…" rows={3} />
        : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} title="We could not load the generated files" />
          : q.data.length === 0 ? <EmptyState title="No files generated yet" hint="Files you generate appear here for 30 days." />
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                    <tr>
                      <th className="py-2.5 px-3">Generated on</th><th className="py-2.5 px-3">Marketplace</th><th className="py-2.5 px-3">File</th>
                      <th className="py-2.5 px-3">Contents</th><th className="py-2.5 px-3 text-right">Products</th><th className="py-2.5 px-3">Generated by</th>
                      <th className="py-2.5 px-3">Expires</th>{can('files.download') && <th className="py-2.5 px-3 text-right"><span className="sr-only">Actions</span></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {q.data.map(f => (
                      <tr key={f.id} data-testid="history-row">
                        <td className="py-3 px-3 whitespace-nowrap">{qatarDateTime(f.generatedAt)}</td>
                        <td className="py-3 px-3">{marketplaceName(f.marketplaceId)}</td>
                        <td className="py-3 px-3 font-mono text-[11px] break-all">{f.fileName}</td>
                        <td className="py-3 px-3 text-gray-600">{KIND_LABELS[f.kind] ?? f.kind} · {SCOPE_LABELS[f.scope] ?? f.scope} · {REFERENCE_LABELS[f.reference] ?? f.reference}</td>
                        <td className="py-3 px-3 text-right font-semibold">{f.productCount}</td>
                        <td className="py-3 px-3">{f.generatedBy}</td>
                        <td className="py-3 px-3 whitespace-nowrap">{qatarDateTime(f.expiresAt)}</td>
                        {can('files.download') && (
                          <td className="py-3 px-3 text-right">
                            <button type="button" onClick={() => download(f)} disabled={busy === f.id} aria-label={`Download ${f.fileName}`}
                              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 font-semibold disabled:opacity-50">
                              <Download className="w-3.5 h-3.5" aria-hidden /> Download
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
    </section>
  );
};
