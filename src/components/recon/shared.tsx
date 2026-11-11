import React, { useEffect } from 'react';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  AlertOctagon, AlertTriangle, CheckCircle2, CircleSlash, EyeOff, FileX, HelpCircle, Sparkles, TrendingDown, XCircle,
} from 'lucide-react';
import { ApiError } from '../../api/client';
import { money2, qatarDateTime } from '../../lib/format';
import { invalidateOnboarding } from '../onboarding/shared';
import {
  RECON_PAGE_SIZE, reconApi,
  type ReconMarketplaceId, type ReconMarketplaceSummary, type ReconPriceSource, type ReconReference, type ReconRow, type ReconRowType,
  type ReconStatus, type ReconSummary, type StockIssue,
} from '../../api/recon';

export const MARKETPLACE_LABELS: Record<ReconMarketplaceId, string> = { talabat: 'Talabat', snoonu: 'Snoonu', rafeeq: 'Rafeeq', keeta: 'Keeta' };
export const marketplaceName = (id: string) => MARKETPLACE_LABELS[id as ReconMarketplaceId] ?? id;

export const REFERENCE_LABELS: Record<ReconReference, string> = { marketplace: 'My pricing', erp: 'ERP price' };
/** The reference inside a sentence: "compared with My pricing", "compared with the ERP price". */
export const REFERENCE_IN_TEXT: Record<ReconReference, string> = { marketplace: 'My pricing', erp: 'the ERP price' };

// ───────── Queries ─────────

export const RECON_KEY = ['recon'] as const;
const summaryKey = (reference?: ReconReference) => ['recon', 'summary', reference ?? 'default'] as const;
const RECOMPUTE_KEY = ['recon', 'recompute'] as const;

/** Polling while a recompute runs. Mutable so tests can shorten it. */
export const reconTiming = { pollMs: 3_000, timeoutMs: 120_000 };

/** A recompute this browser asked for: the summary's computedAt before it, so a newer one means it finished. */
export interface RecomputeState { since: string | null; startedAt: number; timedOut: boolean }

/** Shared by the dashboard and the reports (kept in the query cache so it survives moving between them). */
export function useRecomputeState(): RecomputeState | null {
  const qc = useQueryClient();
  const { data } = useQuery<RecomputeState | null>({
    queryKey: RECOMPUTE_KEY,
    queryFn: () => qc.getQueryData<RecomputeState | null>(RECOMPUTE_KEY) ?? null,
    initialData: null, staleTime: Infinity, gcTime: Infinity,
  });
  return data;
}

const newer = (a: string | null, than: string | null) => a !== null && (than === null || Date.parse(a) > Date.parse(than));

/**
 * GET /api/recon/summary. Without a reference the backend answers with the store's default and names it in `reference`.
 * While a recompute is pending it polls until computedAt moves past the one seen when it was asked for.
 */
export function useReconSummary(reference?: ReconReference) {
  const qc = useQueryClient();
  const pending = useRecomputeState();
  const polling = Boolean(pending && !pending.timedOut);
  const q = useQuery({
    queryKey: summaryKey(reference),
    queryFn: ({ signal }) => reconApi.summary(reference, signal),
    retry: false,
    placeholderData: keepPreviousData,
    refetchInterval: polling ? reconTiming.pollMs : false,
  });
  const computedAt = q.data?.computedAt ?? null;
  useEffect(() => { if (computedAt) invalidateOnboarding(qc); }, [computedAt, qc]);
  const fetchedAt = q.dataUpdatedAt;
  useEffect(() => {
    if (!pending || pending.timedOut || !fetchedAt) return;
    if (newer(computedAt, pending.since)) {
      qc.setQueryData(RECOMPUTE_KEY, null);
      void qc.invalidateQueries({ queryKey: ['recon', 'summary'] });
      void qc.invalidateQueries({ queryKey: ['recon', 'rows'] });
    } else if (Date.now() - pending.startedAt > reconTiming.timeoutMs) {
      qc.setQueryData<RecomputeState>(RECOMPUTE_KEY, { ...pending, timedOut: true });
    }
  }, [qc, pending, computedAt, fetchedAt]);
  return q;
}

/**
 * A change the backend recomputes after by itself (an inline or bulk price change queues one): refetch the rows and the
 * summary now, and keep polling the summary until one newer than the latest cached one lands, as after Recompute.
 */
export function expectRecompute(qc: QueryClient) {
  const seen = qc.getQueriesData<ReconSummary>({ queryKey: ['recon', 'summary'] })
    .map(([, d]) => d?.computedAt ?? null)
    .reduce<string | null>((a, b) => (newer(b, a) ? b : a), null);
  qc.setQueryData<RecomputeState>(RECOMPUTE_KEY, { since: seen, startedAt: Date.now(), timedOut: false });
  void qc.invalidateQueries({ queryKey: ['recon', 'summary'] });
  void qc.invalidateQueries({ queryKey: ['recon', 'rows'] });
}

/** POST /api/recon/recompute (pricing.edit); marks a recompute pending against the summary currently shown. */
export function useRecompute(summary: ReconSummary | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => reconApi.recompute(),
    onSuccess: () => {
      qc.setQueryData<RecomputeState>(RECOMPUTE_KEY, { since: summary?.computedAt ?? null, startedAt: Date.now(), timedOut: false });
      invalidateOnboarding(qc);
    },
  });
}

export interface ReconRowFilter {
  marketplaceId: ReconMarketplaceId;
  type: ReconRowType;
  status?: ReconStatus;
  reference: ReconReference;
}

/** GET /api/recon/rows, one page per 'Load more'; filters are applied by the server. */
export function useReconRows(filter: ReconRowFilter, opts: { enabled?: boolean; limit?: number } = {}) {
  const limit = opts.limit ?? RECON_PAGE_SIZE;
  return useInfiniteQuery({
    queryKey: ['recon', 'rows', filter, limit],
    queryFn: ({ pageParam, signal }) => reconApi.rows({ ...filter, cursor: pageParam, limit }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
    retry: false,
  });
}

export function reconErrorText(e: unknown): string {
  if (e instanceof ApiError) return e.status === 403 ? 'You do not have permission to do this.' : e.message;
  return 'Something went wrong. Please try again.';
}

// ───────── Formatting (times in Asia/Qatar, money to 2 decimals) ─────────

export { money2, qatarDateTime } from '../../lib/format';

/** actual − expected in integer fils (as the backend compares), shown signed with 2 decimals. */
export function priceDifference(actual: number | null, expected: number | null): string {
  if (actual === null || expected === null) return '—';
  const fils = Math.round(actual * 1000) - Math.round(expected * 1000);
  if (fils === 0) return '0.00';
  return `${fils > 0 ? '+' : '−'}${(Math.abs(fils) / 1000).toFixed(2)}`;
}

/** "Talabat data is 15 hours old" from the last applied upload; undefined when there is none. */
export function freshnessText(s: Pick<ReconMarketplaceSummary, 'marketplaceId' | 'lastUploadAt'>, now = Date.now()): string | undefined {
  if (!s.lastUploadAt) return undefined;
  const hours = Math.max(0, Math.floor((now - Date.parse(s.lastUploadAt)) / 3_600_000));
  const name = marketplaceName(s.marketplaceId);
  if (hours < 1) return `${name} data is less than an hour old`;
  if (hours < 48) return `${name} data is ${hours} ${hours === 1 ? 'hour' : 'hours'} old`;
  return `${name} data is ${Math.floor(hours / 24)} days old`;
}

export const PRICE_SOURCE_LABELS: Record<ReconPriceSource, string> = {
  offer: 'Offer', product: 'Product rule', subcategory: 'Subcategory rule', category: 'Category rule', marketplace: 'Marketplace rule', default: 'Default rule',
};

// ───────── Status in words with an icon (never colour alone) ─────────

type Meta = { label: string; tone: string; Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }> };

export const RECON_STATUS_META: Record<ReconStatus, Meta> = {
  in_sync: { label: 'In sync', tone: 'bg-[#E3FAF3] text-[#027864] border-[#027864]/30', Icon: CheckCircle2 },
  mismatch: { label: 'Mismatch', tone: 'bg-red-50 text-red-700 border-red-200', Icon: XCircle },
  not_listed: { label: 'Not listed', tone: 'bg-gray-100 text-gray-700 border-gray-300', Icon: EyeOff },
  missing_from_erp: { label: 'Missing from ERP', tone: 'bg-amber-50 text-amber-800 border-amber-200', Icon: FileX },
  new: { label: 'New', tone: 'bg-blue-50 text-blue-700 border-blue-200', Icon: Sparkles },
  no_data: { label: 'No data', tone: 'bg-gray-100 text-gray-700 border-gray-300', Icon: HelpCircle },
};

export const STOCK_ISSUE_META: Record<StockIssue, Meta & { detail: string }> = {
  available_but_out_of_stock: {
    label: 'Available but out of stock', detail: 'The marketplace sells it but the ERP cannot supply it',
    tone: 'bg-red-50 text-red-700 border-red-200', Icon: AlertOctagon,
  },
  unavailable_but_in_stock: {
    label: 'Lost sales', detail: 'Hidden on the marketplace but in stock in the ERP',
    tone: 'bg-amber-50 text-amber-800 border-amber-200', Icon: TrendingDown,
  },
};

const Pill: React.FC<{ meta: Meta; testId: string }> =({ meta, testId }) => (
  <span data-testid={testId} className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${meta.tone}`}>
    <meta.Icon className="w-3 h-3" aria-hidden />
    {meta.label}
  </span>
);

export const ReconStatusPill: React.FC<{ status: ReconStatus }> = ({ status }) =>
  <Pill meta={RECON_STATUS_META[status] ?? { label: status, tone: 'bg-gray-100 text-gray-700 border-gray-300', Icon: HelpCircle }} testId="recon-status" />;

export const StockIssuePill: React.FC<{ issue: StockIssue | null }> = ({ issue }) =>
  issue ? <Pill meta={STOCK_ISSUE_META[issue]} testId="stock-issue" /> : <span className="text-gray-400">—</span>;

/** Availability in words: the ERP's view or the marketplace's listing (null: not listed). */
export const Availability: React.FC<{ value: boolean | null }> = ({ value }) =>
  value === null ? <span className="text-gray-500">Not listed</span>
    : value ? <span className="inline-flex items-center gap-1 text-[#027864]"><CheckCircle2 className="w-3 h-3" aria-hidden />Available</span>
      : <span className="inline-flex items-center gap-1 text-gray-700"><CircleSlash className="w-3 h-3" aria-hidden />Unavailable</span>;

// ───────── Marketplace values next to the catalogue's ─────────

/** actualAvailable / actualPrice are null when the product has no listing in the marketplace's file. */
export const NOT_IN_FILE = 'Not in the file';

/**
 * Where the marketplace values come from. The API gives the upload time per marketplace (summary lastUploadAt), not per
 * row: after a partial file a row can still carry an older file's listing, so this names the latest file only.
 */
export function fileNote(s: Pick<ReconMarketplaceSummary, 'marketplaceId' | 'lastUploadAt'>): string {
  const name = marketplaceName(s.marketplaceId);
  return s.lastUploadAt
    ? `Marketplace values are from the latest ${name} file, uploaded ${qatarDateTime(s.lastUploadAt)} (Qatar time).`
    : `No ${name} file has been uploaded yet.`;
}

/** The marketplace's availability from its file, or "Not in the file". */
export const MarketplaceAvailability: React.FC<{ value: boolean | null }> = ({ value }) =>
  value === null ? <span className="text-gray-500">{NOT_IN_FILE}</span> : <Availability value={value} />;

/**
 * The side the comparison judged the row on: the catalogue (stock and availability by the catalogue stock) for the
 * marketplace reference, the ERP for the ERP reference, or on a backend without catalogue availability.
 */
export function ownSide(row: ReconRow, reference: ReconReference): { label: 'Catalogue' | 'ERP'; available: boolean | null; stock: number } {
  const byErp = reference === 'erp' || row.catalogueAvailable === undefined;
  return byErp
    ? { label: 'ERP', available: row.erpAvailable, stock: row.erpStock }
    : { label: 'Catalogue', available: row.catalogueAvailable ?? null, stock: row.catalogueStock ?? row.erpStock };
}

/** "Available (stock 12)" with the availability badge; "Unknown" when the comparison has no value. */
export const OwnAvailability: React.FC<{ available: boolean | null; stock: number }> = ({ available, stock }) => (
  <span className="inline-flex flex-wrap items-center gap-1">
    {available === null ? <span className="text-gray-500">Unknown</span> : <Availability value={available} />}{' '}
    <span className="text-gray-500">(stock {stock.toLocaleString('en-US')})</span>
  </span>
);

const Labelled: React.FC<{ label: string; testId: string; children: React.ReactNode }> = ({ label, testId, children }) => (
  <div data-testid={testId} className="flex flex-wrap items-center gap-1">
    <span className="font-semibold text-gray-500">{label}:</span>{' '}{children}
  </div>
);

/**
 * The two values of a row side by side (stacked on a phone): "Catalogue: Available (stock N)" and "Marketplace:
 * Available", or for a price row "Expected price" and "Price on <marketplace>" (the value in the marketplace file).
 * The problem label stays where it was.
 */
export const RowValues: React.FC<{ row: ReconRow; kind: 'stock' | 'price'; reference: ReconReference; marketplaceId?: string }> = ({ row, kind, reference, marketplaceId }) => {
  if (kind === 'price') {
    return (
      <div className="flex flex-col sm:flex-row sm:gap-4 gap-0.5 text-[11px] text-gray-800">
        <Labelled label="Expected price" testId="value-expected">{row.expectedPrice === null ? '—' : `${money2(row.expectedPrice)} QAR`}</Labelled>
        <Labelled label={marketplaceId ? `Price on ${marketplaceName(marketplaceId)}` : 'Price on the marketplace'} testId="value-marketplace">
          {row.actualPrice === null ? <span className="text-gray-500">{NOT_IN_FILE}</span> : `${money2(row.actualPrice)} QAR`}
        </Labelled>
      </div>
    );
  }
  const own = ownSide(row, reference);
  return (
    <div className="flex flex-col sm:flex-row sm:gap-4 gap-0.5 text-[11px] text-gray-800">
      <Labelled label={own.label} testId="value-own"><OwnAvailability available={own.available} stock={own.stock} /></Labelled>
      <Labelled label="Marketplace" testId="value-marketplace"><MarketplaceAvailability value={row.actualAvailable} /></Labelled>
    </div>
  );
};

/** The recompute this browser started: in progress, or taking longer than expected. */
export const RecomputeBanner: React.FC<{ state: RecomputeState | null }> = ({ state }) =>
  !state ? null : state.timedOut ? (
    <div role="status" className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900">
      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" aria-hidden />
      The comparison is taking longer than usual. Refresh this page later to see the new numbers.
    </div>
  ) : (
    <div role="status" className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-blue-200 bg-blue-50 text-xs text-blue-900">
      <span className="w-3.5 h-3.5 rounded-full border-2 border-blue-300 border-t-blue-700 animate-spin shrink-0" aria-hidden />
      Recomputing the comparison… The numbers update when it finishes.
    </div>
  );

export const NoReconAccess: React.FC = () => (
  <div className="p-8 max-w-3xl mx-auto">
    <div role="alert" className="bg-white border border-gray-200 rounded-2xl p-6 text-center">
      <div className="text-sm font-semibold text-gray-900">You do not have access to the comparison</div>
      <div className="text-xs text-gray-500 mt-1">Ask an owner or admin for the reconciliation permission.</div>
    </div>
  </div>
);
