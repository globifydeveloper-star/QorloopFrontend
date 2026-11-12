import React from 'react';
import { AlertTriangle, ArrowRight, Clock, Upload } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import { readExportCounts } from '../../api/marketplaceValues';
import { HOW_IT_WORKS } from '../../content/howItWorks';
import { CompareAgainstToggle } from '../common/CompareAgainstToggle';
import { count } from '../pricing/priceChange';
import { REFERENCE_LABELS, fileNote, freshnessText, marketplaceName, qatarDateTime } from '../recon/shared';
import type { Show, StepProps } from './urlState';

/**
 * REVIEW: how old the marketplace file is (the Dashboard's rule: summary.stale, from the store's staleHours), what needs
 * a change, what is waiting for export, pinned or blocked, and which price the comparison uses.
 */
export const ReviewStep: React.FC<StepProps> = ({ summary: s, reference, state, set }) => {
  // The summary names the store default only when no reference was asked for.
  const isDefault = state.reference === undefined;
  const name = marketplaceName(s.marketplaceId);
  const c = readExportCounts(s);
  const go = (show: Show) => set({ step: 'adjust', show });

  return (
    <section aria-labelledby="review-heading" className="bg-white border border-gray-200 rounded-2xl p-5 space-y-5">
      <h2 id="review-heading" className="text-sm font-bold text-gray-900">Review {name}</h2>

      <FileAge summary={s} />

      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">What needs your attention</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <CountTile label="Stock to fix" value={s.stock} testId="count-stock" onClick={() => set({ step: 'adjust', show: 'needs', type: 'stock' })} />
          <CountTile label="Prices to fix" value={s.price} testId="count-price" onClick={() => set({ step: 'adjust', show: 'needs', type: 'price' })} />
          <CountTile label="Waiting for export" value={c.waitingForExport} testId="count-waiting" onClick={() => go('waiting')} />
          <CountTile label="Pinned" value={c.pinned} testId="count-pinned" onClick={() => go('pinned')} />
          <CountTile label="Blocked" value={c.blocked} testId="count-blocked" onClick={() => go('blocked')} warn />
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          {fileNote(s)} A product with both a stock and a price difference counts once in each.
          {(c.waitingForExport === undefined || c.pinned === undefined) && ' The server does not send the waiting, pinned and blocked counts yet; they show as —.'}
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Prices are compared with</h3>
        <CompareAgainstToggle value={reference} onChange={r => set({ reference: r })} />
        <p data-testid="reference-used" className="text-xs text-gray-700">
          Using the <b>{REFERENCE_LABELS[reference]}</b>{isDefault ? ' (your store default)' : ''}.
        </p>
        {reference === 'erp' && (
          <p role="alert" data-testid="erp-warning" className="flex items-start gap-2 px-4 py-3 rounded-xl border border-amber-300 bg-amber-50 text-sm font-semibold text-amber-900">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" aria-hidden /> {HOW_IT_WORKS.compareWarning}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={() => set({ step: 'adjust' })}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#027864]">
          Next: adjust the values <ArrowRight className="w-3.5 h-3.5" aria-hidden />
        </button>
      </div>
    </section>
  );
};

/** The file's age; out of date: "Upload a fresh file first", with the upload button for roles that may upload. */
export const FileAge: React.FC<{ summary: StepProps['summary'] }> = ({ summary: s }) => {
  const { can } = useAuth();
  const { openUploadModal } = useApp();
  const name = marketplaceName(s.marketplaceId);
  const age = freshnessText(s) ?? `${name} upload time unknown`;
  if (!s.stale) {
    return (
      <p data-testid="file-age" data-stale="false" className="flex items-center gap-1.5 text-xs text-gray-600">
        <Clock className="w-3.5 h-3.5 text-gray-400" aria-hidden />
        {age}{s.lastUploadAt ? ` (uploaded ${qatarDateTime(s.lastUploadAt)}, Qatar time)` : ''}.
      </p>
    );
  }
  return (
    <div role="alert" data-testid="file-age" data-stale="true" className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900">
      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" aria-hidden />
      <div className="flex-1 text-xs">
        <div className="text-sm font-bold">Upload a fresh {name} file first</div>
        <div>
          {age}{s.lastUploadAt ? ` (uploaded ${qatarDateTime(s.lastUploadAt)}, Qatar time)` : ''}, which is out of date. {name} may already show
          different values, so a file exported now could undo changes made there.
        </div>
      </div>
      {can('uploads.upload') && (
        <button type="button" onClick={() => openUploadModal(s.marketplaceId)}
          className="self-start sm:self-center inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg">
          <Upload className="w-3.5 h-3.5" aria-hidden /> Upload {name} file
        </button>
      )}
    </div>
  );
};

const CountTile: React.FC<{ label: string; value: number | undefined; testId: string; onClick: () => void; warn?: boolean }> = ({ label, value, testId, onClick, warn }) => (
  <button type="button" onClick={onClick} aria-label={`${label}: ${value === undefined ? 'not known' : value}. Show them`}
    className={`text-left rounded-xl border p-3 hover:border-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#027864] ${warn && value ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-[#F8FBFA]'}`}>
    <span className="block text-[11px] font-medium text-gray-500">{label}</span>
    <span data-testid={testId} className="mt-1 block text-2xl font-bold text-gray-900">{value === undefined ? '—' : count(value)}</span>
  </button>
);
