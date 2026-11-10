import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Clock, RotateCw, Slash, Upload } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import type { ReconMarketplaceSummary, ReconReference } from '../../api/recon';
import { pathFor } from '../../routes/paths';
import { realCatalogueEnabled } from '../../lib/features';
import { CompareAgainstToggle } from '../common/CompareAgainstToggle';
import { EmptyState, ErrorState, LoadingState } from '../common/States';
import { QuickEditButton, QuickEditDrawer, rowClickOpens } from './QuickEditDrawer';
import {
  NoReconAccess, RecomputeBanner, REFERENCE_LABELS, STOCK_ISSUE_META, freshnessText, marketplaceName, qatarDateTime,
  reconErrorText, useRecompute, useRecomputeState, useReconRows, useReconSummary,
} from './shared';

/** Rows shown under "Needs attention" on each card; the full list is the stock report. */
export const ATTENTION_ROWS = 5;

/** A report link that keeps the marketplace and the compare-against choice. */
export const reportLink = (kind: 'stock' | 'price', marketplaceId: string, reference: ReconReference) =>
  `${pathFor(kind === 'stock' ? 'reports-stock' : 'reports-price-discrepancies')}?${new URLSearchParams({ marketplace: marketplaceId, reference })}`;

/** DASH-001 on GET /api/recon/summary: one card per marketplace that has a summary. Every count is the server's. */
export const RealDashboardView: React.FC = () => {
  const { can } = useAuth();
  return can('recon.view') ? <Dashboard /> : <NoReconAccess />;
};

const Dashboard: React.FC = () => {
  const { openUploadModal, showToast } = useApp();
  const { can } = useAuth();
  // undefined: the store's default (pricing settings); the server names it in the reply.
  const [requested, setRequested] = useState<ReconReference | undefined>(undefined);
  const summary = useReconSummary(requested);
  const recomputeState = useRecomputeState();
  const recompute = useRecompute(summary.data);
  const reference = requested ?? summary.data?.reference;

  // The pending recompute clears when a newer summary arrives.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !recomputeState) showToast('The comparison is up to date', 'success');
    wasPending.current = Boolean(recomputeState && !recomputeState.timedOut);
  }, [recomputeState, showToast]);

  const runRecompute = () => recompute.mutate(undefined, {
    onError: e => showToast(`We could not start the comparison: ${reconErrorText(e)}`, 'error'),
  });

  const data = summary.data;
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Dashboard</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {data ? <>Last compared {data.computedAt ? qatarDateTime(data.computedAt) : 'never'} (Qatar time). Prices are compared against your {REFERENCE_LABELS[data.reference]}.</>
              : 'Your ERP compared with each marketplace.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CompareAgainstToggle value={reference} onChange={setRequested} disabled={!reference} />
          {can('pricing.edit') && (
            <button
              onClick={runRecompute}
              disabled={recompute.isPending || Boolean(recomputeState && !recomputeState.timedOut)}
              className="inline-flex items-center gap-2 h-9 px-3.5 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              <RotateCw className="w-3.5 h-3.5" aria-hidden /> Run comparison
            </button>
          )}
          {can('uploads.upload') && (
            <button onClick={() => openUploadModal()} className="inline-flex items-center gap-2 h-9 px-3.5 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg">
              <Upload className="w-3.5 h-3.5" aria-hidden /> Upload file
            </button>
          )}
        </div>
      </div>

      <RecomputeBanner state={recomputeState} />

      {data && <StockConflictsBadge count={data.stockConflicts ?? 0} />}

      {summary.isPending ? (
        <LoadingState label="Loading the comparison…" rows={4} />
      ) : summary.isError && !data ? (
        <div className="bg-white border border-gray-200 rounded-2xl">
          <ErrorState error={summary.error} title="We could not load the comparison" onRetry={() => void summary.refetch()} />
        </div>
      ) : !data || data.marketplaces.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl">
          <EmptyState
            title="No comparison yet"
            hint="Enable a marketplace and upload your ERP file; each marketplace then gets a card here."
            action={can('uploads.upload') ? (
              <button onClick={() => openUploadModal('erp')} className="mt-2 h-9 px-3.5 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg">Upload ERP file</button>
            ) : undefined}
          />
        </div>
      ) : (
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-4 ${summary.isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={summary.isFetching}>
          {data.marketplaces.map(m => <MarketplaceCard key={m.marketplaceId} summary={m} reference={data.reference} />)}
        </div>
      )}
    </div>
  );
};

/**
 * "N stock conflicts" from stockConflicts in the recon summary, linking to the Stock conflicts page (a real-catalogue
 * screen: without VITE_REAL_CATALOGUE, or without products.view, it is shown without a link). Hidden at 0.
 */
export const StockConflictsBadge: React.FC<{ count: number }> = ({ count: n }) => {
  const { can } = useAuth();
  if (n <= 0) return null;
  const text = `${n.toLocaleString('en-US')} stock ${n === 1 ? 'conflict' : 'conflicts'}`;
  const body = (
    <>
      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" aria-hidden />
      <span><b data-testid="stock-conflicts-badge">{text}</b>: an ERP file changed a stock you had edited. Your value stays in effect until you choose.</span>
    </>
  );
  const cls = 'flex items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900';
  return realCatalogueEnabled() && can('products.view')
    ? <Link to={pathFor('stock-conflicts')} aria-label={`${text}, review them`} className={`${cls} hover:border-amber-300`}>{body}<ChevronRight className="w-3.5 h-3.5 ml-auto" aria-hidden /></Link>
    : <div role="status" className={cls}>{body}</div>;
};

const MarketplaceCard: React.FC<{ summary: ReconMarketplaceSummary; reference: ReconReference }> = ({ summary: s, reference }) => {
  const { openUploadModal } = useApp();
  const { can } = useAuth();
  const name = marketplaceName(s.marketplaceId);
  const fresh = freshnessText(s);

  return (
    <section aria-label={name} className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900">{name}</h2>
          {s.hasData && (
            <p data-testid="freshness" data-stale={s.stale} className={`mt-1 inline-flex items-center gap-1.5 text-[11px] ${s.stale ? 'text-amber-800 font-semibold' : 'text-gray-500'}`}>
              {s.stale ? <AlertTriangle className="w-3.5 h-3.5 text-amber-600" aria-hidden /> : <Clock className="w-3.5 h-3.5" aria-hidden />}
              {fresh ?? `${name} upload time unknown`}
              {s.stale && <span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-[10px]">Out of date</span>}
            </p>
          )}
        </div>
        {s.hasData && s.lastUploadAt && <span className="text-[11px] text-gray-400 whitespace-nowrap">Uploaded {qatarDateTime(s.lastUploadAt)}</span>}
      </header>

      {!s.hasData ? (
        <div className="flex items-center gap-3 py-3">
          <span className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 shrink-0"><Slash className="w-4 h-4" aria-hidden /></span>
          <div className="flex-1">
            <div className="text-sm font-semibold text-gray-800">No data</div>
            <div className="text-xs text-gray-500">Upload a {name} file to compare</div>
          </div>
          {can('uploads.upload') && (
            <button onClick={() => openUploadModal(s.marketplaceId)} className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100">
              <Upload className="w-3 h-3" aria-hidden /> Upload {name} file
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Tile label="Total mismatches" value={s.total} testId="tile-total" />
            <Tile label="Stock" value={s.stock} testId="tile-stock" to={reportLink('stock', s.marketplaceId, reference)} />
            <Tile label="Price" value={s.price} testId="tile-price" to={reportLink('price', s.marketplaceId, reference)} />
          </div>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-gray-500">
            {([['Listed', s.listed], ['Not listed', s.notListed], ['Missing from ERP', s.missingFromErp], ['New', s.newCount]] as const).map(([k, v]) => (
              <div key={k} className="flex gap-1"><dt>{k}</dt><dd className="font-semibold text-gray-800">{v}</dd></div>
            ))}
          </dl>
          <NeedsAttention summary={s} reference={reference} />
        </>
      )}
    </section>
  );
};

const Tile: React.FC<{ label: string; value: number; testId: string; to?: string }> = ({ label, value, testId, to }) => {
  const body = (
    <>
      <div className="text-[11px] font-medium text-gray-500 flex items-center justify-between">{label}{to && <ChevronRight className="w-3.5 h-3.5" aria-hidden />}</div>
      <div data-testid={testId} className={`mt-1 text-2xl font-bold ${value > 0 ? 'text-gray-900' : 'text-[#027864]'}`}>{value}</div>
    </>
  );
  const cls = 'block rounded-xl border border-gray-200 bg-[#F8FBFA] p-3';
  return to ? <Link to={to} aria-label={`${label}: ${value}, open the report`} className={`${cls} hover:border-gray-300`}>{body}</Link> : <div className={cls}>{body}</div>;
};

/** The most urgent stock rows, in the server's order (available but out of stock first, then lost sales). */
const NeedsAttention: React.FC<{ summary: ReconMarketplaceSummary; reference: ReconReference }> = ({ summary: s, reference }) => {
  const { can } = useAuth();
  const rows = useReconRows({ marketplaceId: s.marketplaceId, type: 'stock', reference }, { enabled: s.stock > 0, limit: ATTENTION_ROWS });
  const items = rows.data?.pages[0]?.items ?? [];
  const name = marketplaceName(s.marketplaceId);
  // Quick edit loads the product and its stock, so it needs products.view.
  const editable = can('products.view');
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div aria-label={`Needs attention on ${name}`} role="region" className="border-t border-gray-100 pt-3">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Needs attention</h3>
      {s.stock === 0 ? (
        <p className="mt-2 text-xs text-gray-500">No stock issues on {name}.</p>
      ) : rows.isPending ? (
        <LoadingState label={`Loading ${name} stock issues…`} rows={2} />
      ) : rows.isError ? (
        <div role="alert" className="mt-2 text-xs text-red-700 flex items-center gap-2">
          We could not load the stock issues. <button onClick={() => void rows.refetch()} className="font-semibold underline">Try again</button>
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100">
          {items.map(r => {
            const meta = r.stockIssue ? STOCK_ISSUE_META[r.stockIssue] : undefined;
            return (
              <li
                key={r.productId} data-testid="attention-row" data-issue={r.stockIssue ?? ''}
                onClick={editable ? e => { if (rowClickOpens(e)) setEditing(r.productId); } : undefined}
                className={`py-2 flex items-center gap-3 text-xs ${editable ? 'cursor-pointer hover:bg-gray-50' : ''}`}
              >
                {meta && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${meta.tone}`}>
                    <meta.Icon className="w-3 h-3" aria-hidden /> {meta.label}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">
                  {can('products.view')
                    ? <Link to={pathFor('product-detail', r.productId)} className="font-semibold text-gray-900 hover:text-[#027864] hover:underline">{r.nameEn}</Link>
                    : <span className="font-semibold text-gray-900">{r.nameEn}</span>}
                  <span className="ml-2 font-mono text-[11px] text-gray-500">{r.barcode}</span>
                </span>
                {editable && <QuickEditButton row={r} onOpen={setEditing} />}
              </li>
            );
          })}
        </ul>
      )}
      {s.stock > 0 && (
        <Link to={reportLink('stock', s.marketplaceId, reference)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#027864] hover:underline">
          See all {s.stock} stock {s.stock === 1 ? 'issue' : 'issues'} <ChevronRight className="w-3.5 h-3.5" aria-hidden />
        </Link>
      )}
      {editing && (
        <QuickEditDrawer
          list={{ kind: 'stock', rows: items, summary: s, reference, more: s.stock > items.length }}
          productId={editing} onNavigate={setEditing} onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
};
