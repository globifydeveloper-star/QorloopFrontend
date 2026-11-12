import React, { useEffect, useState } from 'react';
import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, XCircle } from 'lucide-react';
import { ApiError } from '../../api/client';
import type { ReconMarketplaceSummary, ReconReference } from '../../api/recon';
import { generatedFilesApi, type FilePreview, type FileSelection, type GenerationJob } from '../../api/generatedFiles';
import { useAuth } from '../../auth/AuthContext';
import { useApp } from '../../context/AppContext';
import { HOW_IT_WORKS } from '../../content/howItWorks';
import { count } from '../pricing/priceChange';
import { marketplaceName, reconErrorText } from '../recon/shared';
import { filesTiming, startDownload } from '../files/RealGenerateFilesView';
import { invalidateOnboarding } from '../onboarding/shared';
import { EXPORT_PREVIEW_KEY } from './queries';
import { rowsText } from './logic';

/** The file this screen exports: stock and price, only the products that need a change (and every pending value). */
export const exportSelection = (marketplaceId: ReconMarketplaceSummary['marketplaceId'], reference: ReconReference): FileSelection =>
  ({ marketplaceId, kind: 'stock_price', scope: 'mismatches', reference });

export const NEXT_STEP_TEXT = "Upload each file in the marketplace's portal, then upload the fresh export here to confirm.";

// ───────── Export jobs, kept in the query cache so they survive moving between the steps ─────────

const JOBS_KEY = ['update-files', 'jobs'] as const;
type Jobs = Record<string, { jobId?: string; starting?: boolean; error?: string }>;

function useJobs(): [Jobs, (qc: QueryClient, id: string, v: Jobs[string]) => void] {
  const qc = useQueryClient();
  const { data } = useQuery<Jobs>({ queryKey: JOBS_KEY, queryFn: () => qc.getQueryData<Jobs>(JOBS_KEY) ?? {}, initialData: {}, staleTime: Infinity, gcTime: Infinity });
  return [data, (c, id, v) => c.setQueryData<Jobs>(JOBS_KEY, j => ({ ...(j ?? {}), [id]: v }))];
}

const blockedText = (e: unknown) => (e instanceof ApiError && e.status === 409 ? e.message : undefined);

/**
 * EXPORT: per marketplace, the generated-file preview (rows that will change, availability vs price, blocked), the
 * "Export Talabat" / "Export Snoonu" / "Export both" buttons, progress, and a download button per finished file (the
 * download link is made when you click and lasts 5 minutes). `bar` is the sticky bar under the other steps; `full` is
 * the Export step.
 */
export const ExportPanel: React.FC<{ marketplaces: ReconMarketplaceSummary[]; reference: ReconReference; variant: 'bar' | 'full'; onOpenExport?: () => void }> = ({ marketplaces, reference, variant, onOpenExport }) => {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [jobs, setJob] = useJobs();
  const canPreview = can('files.preview');
  const canGenerate = can('files.generate');

  const previews = useQueries({
    queries: marketplaces.map(m => ({
      queryKey: [...EXPORT_PREVIEW_KEY, m.marketplaceId, reference],
      queryFn: () => generatedFilesApi.preview(exportSelection(m.marketplaceId, reference)),
      enabled: canPreview,
      retry: false,
    })),
  });
  const jobQueries = useQueries({
    queries: marketplaces.map(m => {
      const jobId = jobs[m.marketplaceId]?.jobId;
      return {
        queryKey: ['generated-files', 'job', jobId],
        queryFn: ({ signal }: { signal: AbortSignal }) => generatedFilesApi.job(jobId!, signal),
        enabled: Boolean(jobId),
        retry: false,
        refetchInterval: (q: { state: { data?: GenerationJob; error: unknown } }) => (q.state.data?.state === 'done' || q.state.data?.state === 'failed' || q.state.error ? false : filesTiming.pollMs),
      };
    }),
  });

  // A finished file: the history and the get-started checklist refresh.
  const doneKey = jobQueries.map(q => (q.data?.state === 'done' ? q.data.fileId ?? 'done' : '')).join('|');
  useEffect(() => {
    if (!doneKey.replace(/\|/g, '')) return;
    void qc.invalidateQueries({ queryKey: ['generated-files', 'history'] });
    invalidateOnboarding(qc);
  }, [doneKey, qc]);

  const exportable = (i: number) => {
    const p = previews[i];
    const job = jobQueries[i]?.data?.state;
    const busy = jobs[marketplaces[i]!.marketplaceId]?.starting || job === 'queued' || job === 'running';
    return canGenerate && Boolean(p?.data) && (p!.data!.productCount > 0) && !busy;
  };

  const start = async (i: number) => {
    const m = marketplaces[i]!;
    if (!exportable(i)) return;
    setJob(qc, m.marketplaceId, { starting: true });
    try {
      const { jobId } = await generatedFilesApi.generate(exportSelection(m.marketplaceId, reference), previews[i]?.data?.exportToken);
      setJob(qc, m.marketplaceId, { jobId });
    } catch (e) {
      // 409: the values changed since the preview, or the file is blocked; the preview shows the current state.
      if (e instanceof ApiError && e.status === 409) void qc.invalidateQueries({ queryKey: [...EXPORT_PREVIEW_KEY, m.marketplaceId] });
      setJob(qc, m.marketplaceId, { error: `We could not start the ${marketplaceName(m.marketplaceId)} file: ${reconErrorText(e)}` });
    }
  };
  const startAll = () => marketplaces.forEach((_, i) => { if (exportable(i)) void start(i); });
  const anyExportable = marketplaces.some((_, i) => exportable(i));

  const rows = marketplaces.map((m, i) => (
    <MarketplaceExport key={m.marketplaceId} summary={m} variant={variant}
      preview={previews[i]!} job={jobQueries[i]!} startError={jobs[m.marketplaceId]?.error} starting={Boolean(jobs[m.marketplaceId]?.starting)}
      canExport={exportable(i)} onExport={() => void start(i)} />
  ));

  if (!canPreview && !canGenerate) {
    const note = <p role="note" className="text-xs text-gray-600">Your role cannot export marketplace files. An Owner, Admin or Catalogue Manager can.</p>;
    return variant === 'bar' ? null : <section aria-label="Export" className="bg-white border border-gray-200 rounded-2xl p-5">{note}</section>;
  }

  const both = marketplaces.length > 1 && canGenerate && (
    <button type="button" data-testid="export-both" onClick={startAll} disabled={!anyExportable}
      className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#027864]">
      <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden /> Export {marketplaces.length === 2 ? 'both' : 'all'}
    </button>
  );

  if (variant === 'bar') {
    return (
      <aside aria-label="Export" data-testid="export-bar"
        className="sticky bottom-0 z-10 -mx-4 sm:mx-0 border-t sm:border border-gray-200 sm:rounded-2xl bg-white/95 backdrop-blur shadow-[0_-4px_16px_rgba(0,0,0,0.06)] px-4 py-3">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1 grid gap-2 sm:grid-cols-2">{rows}</div>
          <div className="flex flex-wrap items-center gap-2">
            {both}
            {onOpenExport && <button type="button" onClick={onOpenExport} className="h-9 px-3 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50">Export details</button>}
          </div>
        </div>
      </aside>
    );
  }
  return (
    <section aria-labelledby="export-heading" className="bg-white border border-gray-200 rounded-2xl p-5 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 id="export-heading" className="text-sm font-bold text-gray-900">Export the files</h2>
          <p className="text-[11px] text-gray-500">Stock and price, for the products that need a change and every value you adjusted. The files are built from each marketplace&apos;s latest file.</p>
        </div>
        {both}
      </div>
      {reference === 'erp' && (
        <p role="alert" className="flex items-start gap-2 px-4 py-3 rounded-xl border border-amber-300 bg-amber-50 text-sm font-semibold text-amber-900">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" aria-hidden /> {HOW_IT_WORKS.compareWarning}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">{rows}</div>
      <NextStep marketplaces={marketplaces} />
    </section>
  );
};

const MarketplaceExport: React.FC<{
  summary: ReconMarketplaceSummary; variant: 'bar' | 'full';
  preview: { data?: FilePreview; error: unknown; isPending: boolean; fetchStatus: string; refetch: () => unknown };
  job: { data?: GenerationJob; error: unknown };
  startError?: string; starting: boolean; canExport: boolean; onExport: () => void;
}> = ({ summary: m, variant, preview, job, startError, starting, canExport, onExport }) => {
  const { can } = useAuth();
  const name = marketplaceName(m.marketplaceId);
  const p = preview.data;
  const blocked = blockedText(preview.error);
  const state = starting ? 'queued' : job.data?.state;
  const fileId = state === 'done' ? job.data?.fileId : undefined;
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const summaryText = preview.isPending && preview.fetchStatus !== 'idle' ? 'Checking the file…'
    : blocked ? `Cannot export: ${blocked}`
      : preview.error ? `We could not check the file: ${reconErrorText(preview.error)}`
        : !p ? 'Not checked'
          : p.productCount === 0 ? 'Nothing to change'
            : `${rowsText(p.productCount)} will change: ${count(p.availabilityChanges)} availability, ${count(p.priceChanges)} price`;

  const download = () => {
    if (!fileId) return;
    setDownloadError(null); setDownloading(true);
    startDownload(fileId).catch(e => setDownloadError(`We could not download the ${name} file: ${e instanceof ApiError && e.status === 404 ? 'it is no longer available. Export it again.' : reconErrorText(e)}`)).finally(() => setDownloading(false));
  };

  const progress = state && (
    <span role="status" data-testid={`job-${m.marketplaceId}`} data-state={state}
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${state === 'failed' ? 'text-red-700' : state === 'done' ? 'text-[#027864]' : 'text-blue-800'}`}>
      {state === 'failed' ? <XCircle className="w-3.5 h-3.5" aria-hidden /> : state === 'done' ? <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> : <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
      {state === 'queued' ? 'Waiting to start…' : state === 'running' ? 'Building the file…' : state === 'done' ? 'The file is ready.' : `The file could not be made.${job.data?.message ? ` ${job.data.message}` : ''}`}
    </span>
  );

  const buttons = (
    <div className="flex flex-wrap items-center gap-2">
      {can('files.generate') && (
        <button type="button" data-testid={`export-${m.marketplaceId}`} onClick={onExport} disabled={!canExport}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold border border-[#027864] text-[#027864] bg-white hover:bg-[#F2F7F6] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#027864]">
          <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden /> Export {name}
        </button>
      )}
      {fileId && can('files.download') && (
        <button type="button" data-testid={`download-${m.marketplaceId}`} onClick={download} disabled={downloading}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
          <Download className="w-3.5 h-3.5" aria-hidden /> Download {name} file
        </button>
      )}
    </div>
  );

  const errors = Boolean(startError || downloadError || job.error) && (
    <p role="alert" className="text-[11px] text-red-700">{startError ?? downloadError ?? `We could not check the ${name} file: ${reconErrorText(job.error)}`}</p>
  );

  if (variant === 'bar') {
    return (
      <div className="min-w-0 space-y-1" data-testid={`export-row-${m.marketplaceId}`}>
        <div className="text-xs"><b>{name}</b> <span data-testid={`export-summary-${m.marketplaceId}`} className={blocked ? 'text-red-700' : 'text-gray-600'}>{summaryText}</span></div>
        {buttons}
        {progress}
        {errors}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 p-4 space-y-3" data-testid={`export-row-${m.marketplaceId}`}>
      <h3 className="text-sm font-bold text-gray-900">{name}</h3>
      <p data-testid={`export-summary-${m.marketplaceId}`} className={`text-xs ${blocked ? 'text-red-700 font-semibold' : 'text-gray-700'}`}>{summaryText}</p>
      {p && (
        <dl className="grid grid-cols-2 gap-2 text-xs">
          {([
            ['Rows that will change', p.productCount, 'products'],
            ['Availability changes', p.availabilityChanges, 'availability'],
            ['Price changes', p.priceChanges, 'price'],
            ['Blocked', p.blockedExportProducts, 'blocked'],
            ['Not in the marketplace file', p.notInFile, 'not-in-file'],
          ] as const).map(([label, v, id]) => (
            <div key={id} className="rounded-lg bg-[#F8FBFA] border border-gray-100 px-3 py-2">
              <dt className="text-[11px] text-gray-500">{label}</dt>
              <dd data-testid={`export-${id}-${m.marketplaceId}`} className="text-lg font-bold text-gray-900">{v === undefined ? '—' : count(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {p && p.warnings.length > 0 && (
        <ul aria-label={`${name} warnings`} className="space-y-1">
          {p.warnings.map(w => <li key={w} className="flex items-start gap-1.5 text-[11px] text-amber-900"><AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden />{w}</li>)}
        </ul>
      )}
      {buttons}
      {progress}
      {fileId && <p className="text-[11px] text-gray-500">Each click on Download makes a new link that lasts 5 minutes.</p>}
      {errors}
    </div>
  );
};

const NextStep: React.FC<{ marketplaces: ReconMarketplaceSummary[] }> = ({ marketplaces }) => {
  const { can } = useAuth();
  const { openUploadModal } = useApp();
  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 space-y-2">
      <p data-testid="next-step" className="text-xs font-semibold text-blue-900">Next: {NEXT_STEP_TEXT}</p>
      {can('uploads.upload') && (
        <div className="flex flex-wrap gap-2">
          {marketplaces.map(m => (
            <button key={m.marketplaceId} type="button" onClick={() => openUploadModal(m.marketplaceId)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50">
              <Upload className="w-3.5 h-3.5" aria-hidden /> Upload the fresh {marketplaceName(m.marketplaceId)} export
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
