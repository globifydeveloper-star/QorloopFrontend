import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Lock } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { realCatalogueEnabled } from '../../lib/features';
import { pathFor } from '../../routes/paths';
import { ErrorState } from '../common/States';
import { count } from '../pricing/priceChange';
import {
  ERP_CHANGE_KINDS, STOCK_PAGE_SIZE, stockApi,
  type ChangeKindFilter, type UploadChangeCounts, type UploadChangeRow, type UploadChangesPage,
} from '../../api/stock';
import type { UploadSummary } from '../../api/types';
import { CHANGE_KIND_LABELS, changeFieldLabel, changeValue } from './stockLogic';

export const uploadChangesKey = (id: string, kind: ChangeKindFilter, conflictOnly: boolean, page: number) =>
  ['uploads', 'changes', id, kind, conflictOnly, page] as const;

/**
 * What an applied ERP upload changed (GET /api/uploads/:id/changes): counts per kind, then the rows in file order,
 * filterable by kind or to stock conflicts only, 50 per page. An upload applied before the change list existed
 * (changesRecorded false) says so and shows nothing but the summary above it.
 */
export const UploadChanges: React.FC<{ uploadId: string; applied?: UploadSummary['applied'] }> = ({ uploadId, applied }) => {
  const [kind, setKind] = useState<ChangeKindFilter>('all');
  const [conflictOnly, setConflictOnly] = useState(false);
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: uploadChangesKey(uploadId, kind, conflictOnly, page),
    queryFn: ({ signal }) => stockApi.uploadChanges(uploadId, { kind, conflict: conflictOnly, page, pageSize: STOCK_PAGE_SIZE }, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const data = q.data;
  const choose = (k: ChangeKindFilter) => { setKind(k); setPage(1); };

  return (
    <section aria-label="Changes" className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-900">Changes</h2>
        <p className="text-[11px] text-gray-500">What this file changed in the catalogue when it was applied, row by row.</p>
      </div>
      {q.isError && !data ? (
        <ErrorState error={q.error} title="We could not load the changes" onRetry={() => void q.refetch()} />
      ) : !data ? (
        <p className="p-4 text-xs text-gray-500">Loading…</p>
      ) : !data.changesRecorded ? (
        <p role="note" data-testid="changes-not-recorded" className="p-4 text-xs text-gray-700">
          This upload was applied before Qorloop started recording changes row by row, so there is no list of changes for it.
          Only the summary above is available.
        </p>
      ) : (
        <ChangeList
          data={data} kind={kind} conflictOnly={conflictOnly} applied={applied} fetching={q.isPlaceholderData}
          onKind={choose} onConflictOnly={v => { setConflictOnly(v); setPage(1); }} onPage={setPage}
        />
      )}
    </section>
  );
};

const ChangeList: React.FC<{
  data: UploadChangesPage; kind: ChangeKindFilter; conflictOnly: boolean; applied?: UploadSummary['applied']; fetching: boolean;
  onKind: (k: ChangeKindFilter) => void; onConflictOnly: (v: boolean) => void; onPage: (p: number) => void;
}> = ({ data, kind, conflictOnly, applied, fetching, onKind, onConflictOnly, onPage }) => {
  const { counts } = data;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  // cost is left out of the counts for roles that may not see costs: no chip for it then.
  const kinds = ERP_CHANGE_KINDS.filter(k => k !== 'cost' || counts.cost !== undefined);

  return (
    <>
      <div className="p-4 space-y-3 border-b border-gray-100">
        <div role="group" aria-label="Change kind" className="flex flex-wrap gap-2">
          <KindChip label="All" n={counts.all} active={kind === 'all'} onClick={() => onKind('all')} />
          {kinds.map(k => (
            <KindChip key={k} label={CHANGE_KIND_LABELS[k]} n={countOf(counts, k)} active={kind === k} onClick={() => onKind(k)} testId={`count-${k}`} />
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <label className="inline-flex items-center gap-2 text-gray-700">
            <input type="checkbox" checked={conflictOnly} onChange={e => onConflictOnly(e.target.checked)} className="accent-[#027864]" />
            Conflicts only ({count(counts.stockConflicts)})
          </label>
          {applied && (
            <span data-testid="applied-summary" className="text-gray-500">
              {count(applied.changes)} changes recorded · {count(applied.stockConflicts)} stock {applied.stockConflicts === 1 ? 'conflict' : 'conflicts'} raised
              {applied.stockEditsCleared > 0 ? ` · ${count(applied.stockEditsCleared)} stock ${applied.stockEditsCleared === 1 ? 'edit' : 'edits'} cleared because the ERP now matches` : ''}
            </span>
          )}
        </div>
        {counts.stockConflicts > 0 && (
          <p role="note" className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" aria-hidden />
            <span>
              {count(counts.stockConflicts)} stock {counts.stockConflicts === 1 ? 'change' : 'changes'} from this file met a stock you had edited.
              Your value stays in effect until you choose.
            </span>
          </p>
        )}
      </div>
      {data.rows.length === 0 ? (
        <p className="p-4 text-xs text-gray-500">{conflictOnly ? 'No stock conflicts in this view.' : 'No changes of this kind.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={`w-full text-left text-xs ${fetching ? 'opacity-60' : ''}`}>
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
              <tr>
                <th className="py-2.5 px-3 whitespace-nowrap">File row</th>
                <th className="py-2.5 px-3">Product</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Change</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Old value</th>
                <th className="py-2.5 px-3 whitespace-nowrap">New value</th>
                <th className="py-2.5 px-3">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.rows.map((r, i) => <ChangeRow key={`${r.productId}:${r.kind}:${r.field ?? ''}:${i}`} row={r} />)}
            </tbody>
          </table>
        </div>
      )}
      <div className="p-3 border-t border-gray-100 text-xs text-gray-500 flex items-center justify-between">
        <span data-testid="changes-total">{count(data.total)} {data.total === 1 ? 'change' : 'changes'}</span>
        <span className="flex items-center gap-2">
          <button type="button" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)} className="px-2 py-1 border rounded disabled:opacity-40">Previous</button>
          <span>Page {data.page} of {pages}</span>
          <button type="button" disabled={data.page >= pages} onClick={() => onPage(data.page + 1)} className="px-2 py-1 border rounded disabled:opacity-40">Next</button>
        </span>
      </div>
    </>
  );
};

const countOf = (c: UploadChangeCounts, k: (typeof ERP_CHANGE_KINDS)[number]) => (k === 'cost' ? c.cost ?? 0 : c[k]);

const KindChip: React.FC<{ label: string; n: number; active: boolean; onClick: () => void; testId?: string }> = ({ label, n, active, onClick, testId }) => (
  <button
    type="button" aria-pressed={active} onClick={onClick} data-testid={testId}
    className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-semibold ${active ? 'border-[#027864] bg-[#F2F7F6] text-[#027864]' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
  >
    {label} <span className="font-mono">{count(n)}</span>
  </button>
);

const ChangeRow: React.FC<{ row: UploadChangeRow }> = ({ row: r }) => {
  const { can } = useAuth();
  const linkable = realCatalogueEnabled() && can('products.view');
  return (
    <tr data-testid="change-row" className={r.stockConflict ? 'bg-amber-50/50' : 'hover:bg-gray-50/70'}>
      <td className="py-2.5 px-3 text-gray-600 font-mono">{r.rowNumber ?? '—'}</td>
      <td className="py-2.5 px-3 min-w-[200px]">
        {linkable
          ? <Link to={pathFor('product-detail', r.productId)} className="font-semibold text-gray-900 hover:text-[#027864] hover:underline">{r.product.nameEn}</Link>
          : <span className="font-semibold text-gray-900">{r.product.nameEn}</span>}
        <div className="font-mono text-[11px] text-gray-500">{r.barcode}</div>
      </td>
      <td className="py-2.5 px-3 whitespace-nowrap text-gray-700">{changeFieldLabel(r)}</td>
      {r.kind === 'new' ? (
        <td colSpan={2} className="py-2.5 px-3 text-gray-700">Added to the catalogue</td>
      ) : (
        <>
          <td className="py-2.5 px-3 whitespace-nowrap text-gray-500" data-testid="change-old">{changeValue(r.field, r.old)}</td>
          <td className="py-2.5 px-3 whitespace-nowrap font-semibold text-gray-900" data-testid="change-new">{changeValue(r.field, r.new)}</td>
        </>
      )}
      <td className="py-2.5 px-3 text-gray-700">
        {r.kind === 'price' && r.fixedPriceRule && (
          <span data-testid="fixed-price-note" className="inline-flex items-center gap-1"><Lock className="w-3 h-3 text-gray-500" aria-hidden />This product keeps its fixed price.</span>
        )}
        {r.stockConflict && (
          <span data-testid="conflict-note" className="inline-flex items-center gap-1 text-amber-900 font-semibold">
            <AlertTriangle className="w-3 h-3 text-amber-600" aria-hidden />
            Stock conflict: your value{r.catalogueStock?.conflict ? ` (${count(r.catalogueStock.conflict.ownerStock)})` : ''} stays in effect
          </span>
        )}
        {r.kind === 'stock' && !r.stockConflict && r.catalogueStock?.source === 'owner' && (
          <span className="text-gray-500">Catalogue stock is your own value ({count(r.catalogueStock.catalogueStock)})</span>
        )}
      </td>
    </tr>
  );
};
