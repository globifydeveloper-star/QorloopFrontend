import React, { useReducer, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useApp } from '../../context/AppContext';
import { qatarDateTime } from '../../lib/format';
import { pathFor } from '../../routes/paths';
import { EmptyState, ErrorState, LoadingState } from '../common/States';
import { ConfirmDialog } from '../uploads/shared';
import { count } from '../pricing/priceChange';
import { newIdempotencyKey } from '../pricing/bulkChange';
import {
  STOCK_BULK_LIMIT, STOCK_PAGE_SIZE, STOCK_PRODUCT_IDS_MAX, stockApi,
  type ConflictChoice, type ConflictsResolvePreview, type ConflictsResolveRequest, type ConflictsResolveResult, type StockConflictRow,
} from '../../api/stock';
import { bulkMachine, productsText, stockErrors, type BulkMachine } from './stockLogic';
import { invalidateStock, stockConflictsKey } from './queries';

const CHOICE_LABELS: Record<ConflictChoice, string> = { erp: 'Use ERP', keep: 'Keep mine' };
const CHOICE_HINTS: Record<ConflictChoice, string> = {
  erp: 'The catalogue stock goes back to the ERP stock and follows the ERP again.',
  keep: 'Your value stays. Qorloop records the current ERP stock as seen, so only a later ERP change raises a new conflict.',
};

/** In plain words: whose value the comparison and the marketplace files use while a conflict is open (D1). */
export const inEffectText = (inEffect: 'owner' | 'erp') => inEffect === 'owner'
  ? 'While a conflict is open, the stock you entered stays in effect: the comparison and the marketplace files use your value, not the ERP value, until you choose.'
  : 'While a conflict is open, the ERP stock is in effect: the comparison and the marketplace files use the ERP value until you choose.';

/**
 * Open stock conflicts (GET /api/catalogue/stock/conflicts): an ERP file changed the stock of a product whose
 * catalogue stock had been edited. Per row "Use ERP" or "Keep mine" (POST /api/products/:id/stock/resolve, with the
 * values shown), or in bulk (preview, confirm, apply once with an idempotency key).
 */
export const StockConflictsView: React.FC = () => {
  const { can } = useAuth();
  const { showToast } = useApp();
  const qc = useQueryClient();
  const canEdit = can('catalogue.stock_edit');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: stockConflictsKey(page),
    queryFn: ({ signal }) => stockApi.conflicts(page, STOCK_PAGE_SIZE, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const data = q.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const toggle = (ids: string[], on: boolean) => setTicked(prev => {
    const next = new Set(prev);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    return next;
  });
  const [bulk, setBulk] = useState<ConflictChoice | null>(null);

  // One row at a time; the row's error stays under it.
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const resolveOne = async (r: StockConflictRow, choice: ConflictChoice) => {
    if (busy) return;
    setBusy(r.productId);
    setRowError(null);
    try {
      await stockApi.resolve(r.productId, { choice, expected: { erpStock: r.erpStock, ownerStock: r.ownerStock } });
      toggle([r.productId], false);
      showToast(choice === 'erp' ? `${r.nameEn} now follows the ERP stock` : `${r.nameEn} keeps your stock of ${count(r.ownerStock)}`, 'success');
      invalidateStock(qc, true, r.productId);
    } catch (e) {
      const err = stockErrors(e);
      // 409: the conflict moved (or was resolved elsewhere): reload so the newer values are on screen.
      if (err.stale) void q.refetch();
      setRowError({ id: r.productId, message: err.general ?? 'We could not resolve this conflict.' });
    } finally {
      setBusy(null);
    }
  };

  const rows = data?.rows ?? [];
  const allTicked = rows.length > 0 && rows.every(r => ticked.has(r.productId));

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
          <Link to={pathFor('catalogue')} className="text-blue-600 hover:underline">Catalogue</Link>
          <span>/</span>
          <span className="text-gray-700">Stock conflicts</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Stock conflicts</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          An ERP file changed the stock of products whose catalogue stock you had edited. Choose which value to keep. Times are Qatar time.
        </p>
      </div>

      <div role="note" data-testid="in-effect" className="flex items-start gap-2 p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900">
        <Info className="w-4 h-4 shrink-0 text-blue-600" aria-hidden />
        <span>{inEffectText(data?.inEffect ?? 'owner')}</span>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        {canEdit && data && data.total > 0 && (
          <div role="toolbar" aria-label="Resolve in bulk" className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-gray-100 bg-[#F8FBFA] text-xs text-gray-600">
            <span data-testid="ticked-count">
              {ticked.size > 0 ? `${productsText(ticked.size)} ticked` : `Tick rows to resolve them together, or resolve all ${count(data.total)} open conflicts.`}
            </span>
            <span className="flex items-center gap-2">
              {ticked.size > 0 && <button type="button" onClick={() => setTicked(new Set())} className="h-8 px-3 rounded-lg font-semibold border border-gray-300 bg-white hover:bg-gray-50">Clear ticks</button>}
              <button type="button" onClick={() => setBulk('erp')} className="h-8 px-3 rounded-lg font-semibold border border-gray-300 bg-white hover:bg-gray-50">Use ERP for…</button>
              <button type="button" onClick={() => setBulk('keep')} className="h-8 px-3 rounded-lg font-semibold text-white bg-[#027864] hover:bg-[#02604F]">Keep mine for…</button>
            </span>
          </div>
        )}

        {q.isPending ? (
          <LoadingState label="Loading stock conflicts…" rows={6} />
        ) : q.isError && !data ? (
          <ErrorState error={q.error} title="We could not load the stock conflicts" onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="No stock conflicts" hint="Every edited stock agrees with the latest ERP file, or was resolved." />
        ) : (
          <div className="overflow-x-auto" aria-busy={q.isFetching}>
            <table className={`w-full text-left text-xs ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
              <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider border-b border-gray-100">
                <tr>
                  {canEdit && (
                    <th className="pl-4 py-3 w-8">
                      <input type="checkbox" aria-label="Tick every row shown" checked={allTicked} onChange={e => toggle(rows.map(r => r.productId), e.target.checked)} className="accent-[#027864]" />
                    </th>
                  )}
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3 text-right">Your value (in effect)</th>
                  <th className="px-4 py-3 text-right">ERP value</th>
                  <th className="px-4 py-3">Your edit</th>
                  <th className="px-4 py-3">Conflict</th>
                  {canEdit && <th className="px-4 py-3"><span className="sr-only">Resolve</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {rows.map(r => (
                  <React.Fragment key={r.productId}>
                    <tr data-testid="conflict-row" className={ticked.has(r.productId) ? 'bg-[#F2F7F6]' : 'hover:bg-gray-50'}>
                      {canEdit && (
                        <td className="pl-4 py-3">
                          <input type="checkbox" aria-label={`Tick ${r.nameEn}`} checked={ticked.has(r.productId)} onChange={e => toggle([r.productId], e.target.checked)} className="accent-[#027864]" />
                        </td>
                      )}
                      <td className="px-4 py-3 min-w-[200px]">
                        <Link to={pathFor('product-detail', r.productId)} className="font-semibold text-gray-900 hover:text-[#027864] hover:underline">{r.nameEn}</Link>
                        <div className="font-mono text-[11px] text-gray-500">{r.barcode}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900" data-testid="owner-stock">{count(r.ownerStock)}</td>
                      <td className="px-4 py-3 text-right font-mono" data-testid="erp-stock">
                        {count(r.erpStock)}
                        <div className="text-[11px] text-gray-500 font-sans">was {count(r.erpStockAtEdit)} when you edited</div>
                      </td>
                      <td className="px-4 py-3">
                        <div data-testid="set-by">{r.setBy.name}, {qatarDateTime(r.setAt)}</div>
                        {r.reason && <div className="text-[11px] text-gray-500">“{r.reason}”</div>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div>{qatarDateTime(r.conflictAt)}</div>
                        <Link to={`${pathFor('upload-review')}?upload=${encodeURIComponent(r.conflictUploadId)}`} className="text-[11px] text-[#027864] hover:underline">From this ERP upload</Link>
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                          <button type="button" disabled={busy !== null} onClick={() => void resolveOne(r, 'erp')} aria-label={`Use ERP for ${r.nameEn}`} className="h-8 px-3 rounded-lg font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">Use ERP</button>
                          <button type="button" disabled={busy !== null} onClick={() => void resolveOne(r, 'keep')} aria-label={`Keep mine for ${r.nameEn}`} className="h-8 px-3 rounded-lg font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">Keep mine</button>
                        </td>
                      )}
                    </tr>
                    {rowError?.id === r.productId && (
                      <tr><td colSpan={canEdit ? 7 : 5} className="px-4 pb-3"><p role="alert" className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">{rowError.message}</p></td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && (
          <div className="p-3 border-t border-gray-100 text-xs text-gray-500 flex items-center justify-between">
            <span data-testid="conflicts-total">{count(data.total)} open {data.total === 1 ? 'conflict' : 'conflicts'}</span>
            <span className="flex items-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-2 py-1 border rounded disabled:opacity-40">Previous</button>
              <span>Page {page} of {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-2 py-1 border rounded disabled:opacity-40">Next</button>
            </span>
          </div>
        )}
      </div>

      {bulk && data && (
        <ResolveDialog
          initialChoice={bulk} tickedIds={[...ticked]} total={data.total}
          onClose={() => setBulk(null)} onApplied={() => setTicked(new Set())}
        />
      )}
    </div>
  );
};

type ResolveState = BulkMachine<ConflictsResolveRequest, ConflictsResolvePreview, ConflictsResolveResult>;
export const resolveReducer = bulkMachine<ConflictsResolveRequest, ConflictsResolvePreview, ConflictsResolveResult>(p => p.willResolve);
const START: ResolveState = { phase: 'choose' };

/** Why this selection cannot be sent, before calling the API. */
export function resolveSelectionProblem(scope: 'ticked' | 'all', tickedIds: readonly string[], total: number): string | undefined {
  if (scope === 'ticked') {
    if (tickedIds.length === 0) return 'Tick at least one conflict in the list.';
    if (tickedIds.length > STOCK_PRODUCT_IDS_MAX) return `You ticked ${count(tickedIds.length)} products; ticked rows can include at most ${count(STOCK_PRODUCT_IDS_MAX)}. Choose all open conflicts instead.`;
    return undefined;
  }
  if (total === 0) return 'There are no open conflicts.';
  if (total > STOCK_BULK_LIMIT) return `There are ${count(total)} open conflicts. One change can resolve at most ${count(STOCK_BULK_LIMIT)}; tick rows instead.`;
  return undefined;
}

/** Bulk "Use ERP" / "Keep mine": choose, preview, confirm, apply once (one idempotency key per confirmation, reused on retry). */
const ResolveDialog: React.FC<{ initialChoice: ConflictChoice; tickedIds: readonly string[]; total: number; onClose: () => void; onApplied: () => void }> = ({ initialChoice, tickedIds, total, onClose, onApplied }) => {
  const qc = useQueryClient();
  const [state, dispatch] = useReducer(resolveReducer, START);
  const inFlight = useRef(false);
  const [choice, setChoice] = useState<ConflictChoice>(initialChoice);
  const [scope, setScope] = useState<'ticked' | 'all'>(tickedIds.length > 0 ? 'ticked' : 'all');
  const problem = resolveSelectionProblem(scope, tickedIds, total);
  const applying = state.phase === 'applying';
  const close = () => { if (!applying) onClose(); };

  const runPreview = async (request: ConflictsResolveRequest) => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: 'preview', request });
    try { dispatch({ type: 'previewed', preview: await stockApi.conflictsPreview(request) }); } catch (error) { dispatch({ type: 'previewFailed', error }); } finally { inFlight.current = false; }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (state.phase !== 'choose' || problem) return;
    void runPreview({ selection: scope === 'ticked' ? { productIds: [...new Set(tickedIds)] } : { all: true }, choice });
  };
  const runApply = async () => {
    if (state.phase !== 'confirm' || !state.request || !state.preview || inFlight.current) return;
    inFlight.current = true;
    const key = state.idempotencyKey ?? newIdempotencyKey();
    dispatch({ type: 'apply', newKey: () => key });
    try {
      const result = await stockApi.conflictsApply({ ...state.request, idempotencyKey: key, previewToken: state.preview.previewToken });
      dispatch({ type: 'applied', result });
      invalidateStock(qc, !result.replayed && result.willResolve > 0);
      onApplied();
    } catch (error) {
      dispatch({ type: 'applyFailed', error });
    } finally {
      inFlight.current = false;
    }
  };
  const previewError = state.phase === 'choose' ? stockErrors(state.error).general : undefined;
  const p = state.preview;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onKeyDown={e => e.key === 'Escape' && state.phase !== 'confirm' && close()}>
      <div role="dialog" aria-modal="true" aria-label="Resolve stock conflicts" className="w-full max-w-3xl my-8 rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Resolve stock conflicts</h2>
            <p className="text-xs text-gray-500">You see a preview before anything is changed. At most {count(STOCK_BULK_LIMIT)} products in one change.</p>
          </div>
          <button onClick={close} disabled={applying} aria-label="Close" className="text-gray-400 hover:text-gray-600 disabled:opacity-40"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-5">
          {(state.phase === 'choose' || state.phase === 'previewing') && (
            <form aria-label="Choose" onSubmit={submit} className="space-y-4">
              <fieldset disabled={state.phase === 'previewing'} className="space-y-2">
                <legend className="text-xs font-semibold text-gray-700">Conflicts</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="resolve-scope" checked={scope === 'ticked'} disabled={tickedIds.length === 0} onChange={() => setScope('ticked')} className="accent-[#027864]" />
                  Ticked rows ({count(tickedIds.length)})
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="resolve-scope" checked={scope === 'all'} onChange={() => setScope('all')} className="accent-[#027864]" />
                  All open conflicts ({count(total)})
                </label>
              </fieldset>
              <fieldset disabled={state.phase === 'previewing'} className="space-y-2">
                <legend className="text-xs font-semibold text-gray-700">Choice</legend>
                {(['erp', 'keep'] as const).map(c => (
                  <label key={c} className="flex items-start gap-2 text-sm">
                    <input type="radio" name="resolve-choice" checked={choice === c} onChange={() => setChoice(c)} className="mt-1 accent-[#027864]" />
                    <span><b>{CHOICE_LABELS[c]}</b><span className="block text-xs text-gray-500">{CHOICE_HINTS[c]}</span></span>
                  </label>
                ))}
              </fieldset>
              {problem && <p role="alert" className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">{problem}</p>}
              {previewError && <p role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">We could not run the preview: {previewError}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={close} className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={state.phase === 'previewing' || Boolean(problem)} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
                  {state.phase === 'previewing' ? 'Running preview…' : 'Preview'}
                </button>
              </div>
            </form>
          )}

          {(state.phase === 'preview' || state.phase === 'confirm' || state.phase === 'applying') && p && (
            <>
              {state.stale && (
                <div role="alert" className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <b>Nothing was changed.</b> The conflicts changed since the preview. Run the preview again to see the current numbers.
                </div>
              )}
              <div role="region" aria-label="Preview" className={`space-y-4 ${state.stale ? 'opacity-60' : ''}`}>
                <h3 data-testid="preview-heading" className="text-sm font-bold text-gray-900">{CHOICE_LABELS[p.choice]}: {CHOICE_HINTS[p.choice]}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Stat label="Selected" value={p.selected} testId="resolve-selected" />
                  <Stat label="Will be resolved" value={p.willResolve} testId="resolve-will" />
                  <Stat label="No longer in conflict" value={p.notInConflict} testId="resolve-not-in-conflict" />
                  <Stat label="Not found" value={p.notFound} testId="resolve-not-found" />
                </div>
                {p.willResolve === 0 && <p role="status" className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-700">Nothing to resolve: none of the selected products has an open conflict.</p>}
                {p.rows.length > 0 && (
                  <div className="overflow-x-auto border border-gray-100 rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider">
                        <tr><th className="px-3 py-2">Product</th><th className="px-3 py-2 text-right">Your value</th><th className="px-3 py-2 text-right">ERP value</th><th className="px-3 py-2 text-right">Catalogue stock after</th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {p.rows.map(r => (
                          <tr key={r.productId} data-testid="resolve-row">
                            <td className="px-3 py-2"><div className="font-semibold text-gray-900">{r.nameEn}</div><div className="font-mono text-[11px] text-gray-500">{r.barcode}</div></td>
                            <td className="px-3 py-2 text-right font-mono">{count(r.ownerStock)}</td>
                            <td className="px-3 py-2 text-right font-mono">{count(r.erpStock)}</td>
                            <td className="px-3 py-2 text-right font-mono font-semibold">{count(r.catalogueStockAfter)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="flex justify-between gap-2">
                <button type="button" disabled={applying} onClick={() => dispatch({ type: 'edit' })} className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">Back</button>
                {state.stale ? (
                  <button type="button" onClick={() => state.request && void runPreview(state.request)} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F]">Preview again</button>
                ) : p.willResolve > 0 && (
                  <button type="button" disabled={applying} onClick={() => dispatch({ type: 'confirm' })} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
                    {CHOICE_LABELS[p.choice]} for {productsText(p.willResolve)}…
                  </button>
                )}
              </div>
            </>
          )}

          {state.phase === 'done' && state.result && (
            <div role="status" aria-label="Conflicts resolved" className="space-y-3 text-center py-4">
              <CheckCircle2 className="w-8 h-8 text-[#027864] mx-auto" aria-hidden />
              <div className="text-base font-bold text-gray-900" data-testid="resolve-done">
                {state.result.replayed ? 'This change had already been applied' : state.result.willResolve > 0 ? `${productsText(state.result.willResolve)} resolved` : 'Nothing was changed'}
              </div>
              {state.result.replayed && <p className="text-xs text-gray-600">It was applied earlier from this same confirmation, so nothing was written again.</p>}
              <p className="text-xs text-gray-600">The comparison will refresh shortly.</p>
              <button onClick={onClose} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F]">Done</button>
            </div>
          )}
        </div>
      </div>

      {(state.phase === 'confirm' || state.phase === 'applying') && p && (
        <ConfirmDialog
          title="Resolve stock conflicts" tone="primary" busy={applying}
          confirmLabel={state.error ? 'Try again' : `${CHOICE_LABELS[p.choice]} for ${productsText(p.willResolve)}`}
          onClose={() => { if (!applying) dispatch({ type: 'cancel' }); }}
          onConfirm={() => void runApply()}
        >
          <p>This resolves <b data-testid="confirm-count">{productsText(p.willResolve)}</b>: {CHOICE_LABELS[p.choice].toLowerCase()}. {CHOICE_HINTS[p.choice]}</p>
          {applying && <p role="status" className="mt-2 text-xs text-gray-700">Applying… Keep this window open.</p>}
          {state.error !== undefined && !applying && (
            <p role="alert" className="mt-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              <AlertTriangle className="inline w-3.5 h-3.5 mr-1 text-red-600" aria-hidden />
              We could not confirm the change: {stockErrors(state.error).general} If the connection dropped it may already be applied; trying again is safe and will not apply it twice.
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
};

export const Stat: React.FC<{ label: string; value: number; testId: string }> = ({ label, value, testId }) => (
  <div className="rounded-xl border border-gray-200 bg-[#F8FBFA] p-3">
    <div className="text-[11px] text-gray-500">{label}</div>
    <div data-testid={testId} className="mt-0.5 text-xl font-bold text-gray-900">{count(value)}</div>
  </div>
);
