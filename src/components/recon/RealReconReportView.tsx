import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { QuickEditButton, QuickEditDrawer, rowClickOpens } from './QuickEditDrawer';
import { Slash, Upload } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import {
  RECON_REFERENCES, RECON_STATUSES,
  type ReconMarketplaceSummary, type ReconReference, type ReconRow, type ReconStatus,
} from '../../api/recon';
import { pathFor } from '../../routes/paths';
import { CompareAgainstToggle } from '../common/CompareAgainstToggle';
import { CatalogueStockCell } from '../stock/StockCell';
import { EmptyState, ErrorState, LoadingState } from '../common/States';
import {
  MarketplaceAvailability, NOT_IN_FILE, NoReconAccess, OwnAvailability, PRICE_SOURCE_LABELS, RECON_STATUS_META, REFERENCE_LABELS,
  RecomputeBanner, ReconStatusPill, StockIssuePill, fileNote, freshnessText, marketplaceName, money2, ownSide, priceDifference,
  qatarDateTime, useRecomputeState, useReconRows, useReconSummary,
} from './shared';

export type ReportKind = 'stock' | 'price';

const COPY: Record<ReportKind, { title: string; intro: string; issues: (n: number) => string }> = {
  stock: {
    title: 'Stock report',
    intro: 'Products whose availability on the marketplace does not match the stock you compare against (the catalogue stock, or the ERP stock when comparing with the ERP price), most urgent first.',
    issues: n => `${n} stock ${n === 1 ? 'issue' : 'issues'}`,
  },
  price: {
    title: 'Price report',
    intro: 'Products whose marketplace price differs from the price you compare against.',
    issues: n => `${n} price ${n === 1 ? 'mismatch' : 'mismatches'}`,
  },
};

const isReference = (v: string | null): v is ReconReference => RECON_REFERENCES.includes(v as ReconReference);
const isStatus = (v: string | null): v is ReconStatus => RECON_STATUSES.includes(v as ReconStatus);

/**
 * RPT-001 (stock) and RPT-002 (price) on GET /api/recon/rows. Filters, the marketplace and the compare-against choice
 * live in the URL and go to the server; counts are the same stored summary the dashboard shows. Read-only.
 */
export const RealReconReportView: React.FC<{ kind: ReportKind }> = ({ kind }) => {
  const { can } = useAuth();
  return can('recon.view') ? <Report kind={kind} /> : <NoReconAccess />;
};

const Report: React.FC<{ kind: ReportKind }> = ({ kind }) => {
  const { can } = useAuth();
  const { openUploadModal } = useApp();
  const [params, setParams] = useSearchParams();
  const refParam = params.get('reference');
  const statusParam = params.get('status');
  const requested = isReference(refParam) ? refParam : undefined;
  const status = isStatus(statusParam) ? statusParam : undefined;

  const summary = useReconSummary(requested);
  const recomputeState = useRecomputeState();
  const marketplaces = summary.data?.marketplaces ?? [];
  const reference = requested ?? summary.data?.reference;
  const selected: ReconMarketplaceSummary | undefined =
    marketplaces.find(m => m.marketplaceId === params.get('marketplace')) ?? marketplaces[0];

  const set = (key: string, value: string | undefined) => setParams(p => {
    const next = new URLSearchParams(p);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });

  const copy = COPY[kind];
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{copy.title}</h1>
          <p className="text-xs text-gray-500 mt-0.5">{copy.intro} Times are Qatar time.</p>
        </div>
        <CompareAgainstToggle value={reference} onChange={r => set('reference', r)} disabled={!reference} />
      </div>

      <RecomputeBanner state={recomputeState} />

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        {summary.isPending ? (
          <LoadingState label="Loading the comparison…" rows={6} />
        ) : summary.isError && !summary.data ? (
          <ErrorState error={summary.error} title="We could not load the comparison" onRetry={() => void summary.refetch()} />
        ) : !selected || !reference ? (
          <EmptyState title="No comparison yet" hint="Enable a marketplace and upload your ERP file; its report then appears here." />
        ) : (
          <>
            <div role="tablist" aria-label="Marketplace" className="flex flex-wrap gap-1 px-4 pt-3 border-b border-gray-100">
              {marketplaces.map(m => (
                <button
                  key={m.marketplaceId}
                  role="tab"
                  aria-selected={m.marketplaceId === selected.marketplaceId}
                  onClick={() => set('marketplace', m.marketplaceId)}
                  className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${m.marketplaceId === selected.marketplaceId ? 'border-[#027864] text-[#027864]' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                >
                  {marketplaceName(m.marketplaceId)} ({m.hasData ? (kind === 'stock' ? m.stock : m.price) : 'No data'})
                </button>
              ))}
            </div>

            {!selected.hasData ? (
              <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
                <Slash className="w-6 h-6 text-gray-300" aria-hidden />
                <div className="text-sm font-semibold text-gray-800">No data</div>
                <div className="text-xs text-gray-500">Upload a {marketplaceName(selected.marketplaceId)} file to compare</div>
                {can('uploads.upload') && (
                  <button onClick={() => openUploadModal(selected.marketplaceId)} className="mt-1 inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg">
                    <Upload className="w-3.5 h-3.5" aria-hidden /> Upload {marketplaceName(selected.marketplaceId)} file
                  </button>
                )}
              </div>
            ) : (
              <ReportBody
                kind={kind} summary={selected} reference={reference} status={status}
                onStatus={v => set('status', v)}
                stale={summary.isPlaceholderData}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};

const ReportBody: React.FC<{
  kind: ReportKind; summary: ReconMarketplaceSummary; reference: ReconReference; status?: ReconStatus;
  onStatus: (v: string | undefined) => void; stale: boolean;
}> = ({ kind, summary: s, reference, status, onStatus, stale }) => {
  const { can } = useAuth();
  const rows = useReconRows({ marketplaceId: s.marketplaceId, type: kind, status, reference });
  const items = rows.data?.pages.flatMap(p => p.items) ?? [];
  const name = marketplaceName(s.marketplaceId);
  const count = kind === 'stock' ? s.stock : s.price;
  const linkable = can('products.view');
  // A row click (or its Edit button) opens the quick edit drawer; the product name still opens the full page.
  const [editing, setEditing] = useState<string | null>(null);
  const open = (e: React.MouseEvent, r: ReconRow) => { if (linkable && rowClickOpens(e)) setEditing(r.productId); };

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-4 border-b border-gray-100">
        <div className="text-xs text-gray-600" data-testid="report-counts">
          <span className="font-semibold text-gray-900">{COPY[kind].issues(count)}</span> on {name}
          <span className="text-gray-400"> · </span>{s.total} total ({s.stock} stock, {s.price} price)
          <span className="text-gray-400"> · </span>
          <span className={s.stale ? 'text-amber-800 font-semibold' : ''}>{freshnessText(s) ?? 'Upload time unknown'}{s.stale ? ' (out of date)' : ''}</span>
          <p data-testid="file-note" className="mt-0.5 text-[11px] text-gray-500">{fileNote(s)}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          Status
          <select value={status ?? ''} onChange={e => onStatus(e.target.value || undefined)} className="h-9 px-2 text-xs border border-gray-300 rounded-lg bg-white">
            <option value="">All statuses</option>
            {RECON_STATUSES.map(st => <option key={st} value={st}>{RECON_STATUS_META[st].label}</option>)}
          </select>
        </label>
      </div>

      {rows.isPending ? (
        <LoadingState label="Loading rows…" rows={8} />
      ) : rows.isError && !rows.data ? (
        <ErrorState error={rows.error} title="We could not load this report" onRetry={() => void rows.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={status ? `No rows with status "${RECON_STATUS_META[status].label}"` : kind === 'stock' ? `No stock issues on ${name}` : `No price mismatches on ${name}`}
          hint={status ? 'Choose another status or All statuses.' : undefined}
        />
      ) : (
        <div className="overflow-x-auto" aria-busy={rows.isFetching}>
          <table className={`w-full text-left text-xs ${rows.isPlaceholderData || stale ? 'opacity-60' : ''}`}>
            <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider border-b border-gray-100">
              {kind === 'stock' ? (
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Issue</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">ERP stock</th>
                  <th className="px-4 py-3 text-right">Catalogue stock</th>
                  <th className="px-4 py-3">{reference === 'erp' ? 'ERP' : 'Catalogue'}</th>
                  <th className="px-4 py-3">Marketplace</th>
                  <th className="px-4 py-3">Last updated</th>
                  {linkable && <th className="px-4 py-3"><span className="sr-only">Edit</span></th>}
                </tr>
              ) : (
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Expected price (QAR) <span className="block font-normal normal-case tracking-normal">{REFERENCE_LABELS[reference]}</span></th>
                  <th className="px-4 py-3 text-right">Marketplace price (QAR) <span className="block font-normal normal-case tracking-normal">On {name}</span></th>
                  <th className="px-4 py-3 text-right">Difference (QAR)</th>
                  <th className="px-4 py-3">Price rule</th>
                  <th className="px-4 py-3">Last updated</th>
                  {linkable && <th className="px-4 py-3"><span className="sr-only">Edit</span></th>}
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-700">
              {items.map(r => (
                <tr key={r.productId} onClick={e => open(e, r)} className={linkable ? 'hover:bg-gray-50 cursor-pointer' : ''}>
                  <td className="px-4 py-3 min-w-[220px]">
                    {linkable
                      ? <Link to={pathFor('product-detail', r.productId)} onClick={e => e.stopPropagation()} className="font-semibold text-gray-900 hover:text-[#027864] hover:underline">{r.nameEn}</Link>
                      : <span className="font-semibold text-gray-900">{r.nameEn}</span>}
                    <div className="font-mono text-[11px] text-gray-500">{r.barcode}{r.sku ? ` · ${r.sku}` : ''}</div>
                  </td>
                  {kind === 'stock' ? (
                    <>
                      <td className="px-4 py-3"><StockIssuePill issue={r.stockIssue} /></td>
                      <td className="px-4 py-3"><ReconStatusPill status={r.status} /></td>
                      <td className="px-4 py-3 text-right font-mono">{r.erpStock}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap"><CatalogueStockCell catalogueStock={r.catalogueStock} source={r.catalogueStockSource} conflict={r.stockConflict} /></td>
                      {/* The availability the issue was judged on: by the catalogue stock (marketplace reference) or the ERP stock. */}
                      <td className="px-4 py-3 min-w-[140px]" data-testid="reference-available">
                        <OwnAvailability {...ownSide(r, reference)} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" data-testid="marketplace-available"><MarketplaceAvailability value={r.actualAvailable} /></td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3"><ReconStatusPill status={r.status} /></td>
                      <td className="px-4 py-3 text-right font-mono" data-testid="expected">{money2(r.expectedPrice)}</td>
                      <td className="px-4 py-3 text-right font-mono" data-testid="actual">{r.actualPrice === null ? NOT_IN_FILE : money2(r.actualPrice)}</td>
                      <td className="px-4 py-3 text-right font-mono" data-testid="difference">{priceDifference(r.actualPrice, r.expectedPrice)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {reference === 'erp' ? 'ERP price' : r.marketplacePriceSource ? PRICE_SOURCE_LABELS[r.marketplacePriceSource] : '—'}
                      </td>
                    </>
                  )}
                  <td className="px-4 py-3 whitespace-nowrap" data-testid="updated">{qatarDateTime(r.lastUpdated)}</td>
                  {linkable && <td className="px-4 py-3 text-right"><QuickEditButton row={r} onOpen={setEditing} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.isFetchNextPageError && (
        <div role="alert" className="px-4 py-3 text-xs text-red-700 border-t border-gray-100 flex items-center gap-3">
          We could not load more rows.
          <button onClick={() => void rows.fetchNextPage()} className="font-semibold underline">Try again</button>
        </div>
      )}
      {rows.hasNextPage && !rows.isFetchNextPageError && (
        <div className="p-4 border-t border-gray-100 text-center">
          <button
            onClick={() => void rows.fetchNextPage()}
            disabled={rows.isFetchingNextPage}
            className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            {rows.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
      {editing && (
        <QuickEditDrawer
          list={{ kind, rows: items, summary: s, reference, more: Boolean(rows.hasNextPage) }}
          productId={editing} onNavigate={setEditing} onClose={() => setEditing(null)}
        />
      )}
    </>
  );
};
