import React, { useId, useReducer, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, X } from 'lucide-react';
import { ConfirmDialog } from '../uploads/shared';
import { count } from '../pricing/priceChange';
import { newIdempotencyKey } from '../pricing/bulkChange';
import {
  STOCK_BULK_LIMIT, STOCK_PRODUCT_IDS_MAX, STOCK_REASON_MAX, stockApi,
  type StockBulkAction, type StockBulkPreview, type StockBulkRequest, type StockBulkResult, type StockBulkRow,
} from '../../api/stock';
import { buildStockBulkRequest, bulkMachine, productsText, stockErrors, stockSelectionProblem, type BulkMachine, type StockBulkForm } from './stockLogic';
import { invalidateStock } from './queries';
import { Stat } from './StockConflictsView';

type State = BulkMachine<StockBulkRequest, StockBulkPreview, StockBulkResult>;
export const stockBulkReducer = bulkMachine<StockBulkRequest, StockBulkPreview, StockBulkResult>(p => p.willChange);
const START: State = { phase: 'choose' };

const actionText = (a: StockBulkAction) => (a.mode === 'set' ? `Set the catalogue stock to ${count(a.stock)}` : 'Reset the catalogue stock to the ERP stock');
const sourceText = (s: 'erp' | 'owner') => (s === 'owner' ? 'manual' : 'ERP');

/**
 * Bulk catalogue stock edit (POST /api/catalogue/stock/bulk/preview and /apply, catalogue.stock_edit): the ticked rows
 * or every product (any status) matching the list's search and category; a value or "reset to ERP"; preview; confirm;
 * apply once. The limits are shown and checked before any call. One idempotency key per confirmation, reused on retry.
 */
export const BulkStockDialog: React.FC<{
  tickedIds: readonly string[];
  filter: StockBulkForm['filter'];
  /** Products of any status matching the filter (the list's "All" count); undefined while not known. */
  filterCount?: number;
  /** 'Search "milk" · Dairy', or '' for no filter. */
  filterSummary: string;
  onClose: () => void;
  onApplied: () => void;
}> = ({ tickedIds, filter, filterCount, filterSummary, onClose, onApplied }) => {
  const uid = useId();
  const qc = useQueryClient();
  const [state, dispatch] = useReducer(stockBulkReducer, START);
  const inFlight = useRef(false);
  const [scope, setScope] = useState<StockBulkForm['scope']>(tickedIds.length > 0 ? 'ticked' : 'filter');
  const [mode, setMode] = useState<StockBulkForm['mode']>('set');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ value?: string; reason?: string }>({});
  const form: StockBulkForm = { scope, tickedIds, filter, filterCount, mode, value, reason };
  const problem = stockSelectionProblem(form);
  const applying = state.phase === 'applying';
  const close = () => { if (!applying) onClose(); };

  const runPreview = async (request: StockBulkRequest) => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: 'preview', request });
    try { dispatch({ type: 'previewed', preview: await stockApi.bulkPreview(request) }); } catch (error) { dispatch({ type: 'previewFailed', error }); } finally { inFlight.current = false; }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (state.phase !== 'choose') return;
    const built = buildStockBulkRequest(form);
    setErrors({ value: built.errors?.value, reason: built.errors?.reason });
    if (built.request) void runPreview(built.request);
  };
  const runApply = async () => {
    if (state.phase !== 'confirm' || !state.request || !state.preview || inFlight.current) return;
    inFlight.current = true;
    const key = state.idempotencyKey ?? newIdempotencyKey();
    dispatch({ type: 'apply', newKey: () => key });
    try {
      const result = await stockApi.bulkApply({ ...state.request, idempotencyKey: key, previewToken: state.preview.previewToken });
      dispatch({ type: 'applied', result });
      invalidateStock(qc, !result.replayed && result.willChange > 0);
      onApplied();
    } catch (error) {
      dispatch({ type: 'applyFailed', error });
    } finally {
      inFlight.current = false;
    }
  };
  const previewErrors = state.phase === 'choose' ? stockErrors(state.error, ['stock', 'reason']) : { fields: {} as Record<string, string> };
  const p = state.preview;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onKeyDown={e => e.key === 'Escape' && state.phase !== 'confirm' && close()}>
      <div role="dialog" aria-modal="true" aria-label="Bulk stock edit" className="w-full max-w-4xl my-8 rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Bulk stock edit</h2>
            <p data-testid="stock-limit" className="text-xs text-gray-500">
              Set the catalogue stock of many products at once. At most {count(STOCK_BULK_LIMIT)} products in one change ({count(STOCK_PRODUCT_IDS_MAX)} when you tick rows). You see a preview before anything is changed.
            </p>
          </div>
          <button onClick={close} disabled={applying} aria-label="Close" className="text-gray-400 hover:text-gray-600 disabled:opacity-40"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-5">
          {(state.phase === 'choose' || state.phase === 'previewing') && (
            <form aria-label="Choose the change" onSubmit={submit} className="space-y-5">
              <fieldset disabled={state.phase === 'previewing'}>
                <legend className="text-xs font-semibold text-gray-700">Products</legend>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${scope === 'ticked' ? 'border-[#027864] bg-[#F2F7F6]' : 'border-gray-200'} ${tickedIds.length === 0 ? 'opacity-60' : ''}`}>
                    <input type="radio" name={`${uid}-scope`} checked={scope === 'ticked'} disabled={tickedIds.length === 0} onChange={() => setScope('ticked')} className="mt-1 accent-[#027864]" />
                    <span>
                      <span className="block font-semibold text-gray-900">Ticked rows ({count(tickedIds.length)})</span>
                      <span className="block text-xs text-gray-500">{tickedIds.length === 0 ? 'Tick rows in the list to use this.' : `At most ${count(STOCK_PRODUCT_IDS_MAX)}.`}</span>
                    </span>
                  </label>
                  <label className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${scope === 'filter' ? 'border-[#027864] bg-[#F2F7F6]' : 'border-gray-200'}`}>
                    <input type="radio" name={`${uid}-scope`} checked={scope === 'filter'} onChange={() => setScope('filter')} className="mt-1 accent-[#027864]" />
                    <span>
                      <span className="block font-semibold text-gray-900">
                        {filterSummary ? 'Every product matching the current filter' : 'Every product'} ({filterCount === undefined ? 'Counting...' : count(filterCount)})
                      </span>
                      <span className="block text-xs text-gray-500">{filterSummary ? `${filterSummary}. ` : ''}Any status; the status tab is not used. At most {count(STOCK_BULK_LIMIT)}.</span>
                    </span>
                  </label>
                </div>
                {problem && <p role="alert" className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">{problem}</p>}
              </fieldset>

              <fieldset disabled={state.phase === 'previewing'} className="space-y-3">
                <legend className="text-xs font-semibold text-gray-700">Change</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name={`${uid}-mode`} checked={mode === 'set'} onChange={() => setMode('set')} className="accent-[#027864]" />
                  Set the catalogue stock to a value
                </label>
                {mode === 'set' && (
                  <div className="ml-6 max-w-xs">
                    <label htmlFor={`${uid}-value`} className="block text-xs font-semibold text-gray-700">Stock</label>
                    <input
                      id={`${uid}-value`} type="number" inputMode="numeric" min={0} step={1} value={value}
                      onChange={e => { setValue(e.target.value); setErrors(x => ({ ...x, value: undefined })); }}
                      aria-invalid={Boolean(errors.value)} aria-describedby={errors.value ? `${uid}-value-err` : undefined}
                      className={`mt-1 w-full h-9 px-3 text-sm font-mono border rounded-lg bg-white ${errors.value ? 'border-red-400' : 'border-gray-300'}`}
                    />
                    {errors.value && <p id={`${uid}-value-err`} role="alert" className="mt-1 text-[11px] text-red-700">{errors.value}</p>}
                    <p className="mt-1 text-[11px] text-gray-500">A product whose ERP stock is this value goes back to following the ERP.</p>
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name={`${uid}-mode`} checked={mode === 'erp'} onChange={() => setMode('erp')} className="accent-[#027864]" />
                  Reset to the ERP stock (remove manual edits)
                </label>
                <div>
                  <label htmlFor={`${uid}-reason`} className="block text-xs font-semibold text-gray-700">Reason (optional)</label>
                  <input
                    id={`${uid}-reason`} value={reason} maxLength={STOCK_REASON_MAX}
                    onChange={e => { setReason(e.target.value); setErrors(x => ({ ...x, reason: undefined })); }}
                    aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason ? `${uid}-reason-err` : undefined}
                    className={`mt-1 w-full h-9 px-3 text-sm border rounded-lg bg-white ${errors.reason ? 'border-red-400' : 'border-gray-300'}`}
                  />
                  {errors.reason && <p id={`${uid}-reason-err`} role="alert" className="mt-1 text-[11px] text-red-700">{errors.reason}</p>}
                </div>
              </fieldset>

              {previewErrors.general && <p role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">We could not run the preview: {previewErrors.general}</p>}

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
                  <b>Nothing was changed.</b> {stockErrors(state.error).general} Run the preview again to see the current numbers.
                </div>
              )}
              <PreviewResult preview={p} faded={state.stale} />
              <div className="flex justify-between gap-2">
                <button type="button" disabled={applying} onClick={() => dispatch({ type: 'edit' })} className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">Back</button>
                {state.stale ? (
                  <button type="button" onClick={() => state.request && void runPreview(state.request)} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F]">Preview again</button>
                ) : p.willChange > 0 && (
                  <button type="button" disabled={applying} onClick={() => dispatch({ type: 'confirm' })} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
                    Change {productsText(p.willChange)}…
                  </button>
                )}
              </div>
            </>
          )}

          {state.phase === 'done' && state.result && (
            <div role="status" aria-label="Stock changed" className="space-y-3 text-center py-4">
              <CheckCircle2 className="w-8 h-8 text-[#027864] mx-auto" aria-hidden />
              <div className="text-base font-bold text-gray-900" data-testid="stock-bulk-done">
                {state.result.replayed ? 'This change had already been applied' : state.result.willChange > 0 ? `Stock changed on ${productsText(state.result.willChange)}` : 'Nothing was changed'}
              </div>
              {state.result.replayed && <p className="text-xs text-gray-600">It was applied earlier from this same confirmation, so nothing was written again.</p>}
              <p className="text-xs text-gray-600">
                {count(state.result.sets)} set, {count(state.result.clears)} back to the ERP stock, {count(state.result.unchanged)} already at this stock, {count(state.result.notFound)} not found.
              </p>
              <p className="text-xs text-gray-600">The comparison will refresh shortly.</p>
              <button onClick={onClose} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F]">Done</button>
            </div>
          )}
        </div>
      </div>

      {(state.phase === 'confirm' || state.phase === 'applying') && p && (
        <ConfirmDialog
          title="Change stock" tone="primary" busy={applying}
          confirmLabel={state.error ? 'Try again' : `Change ${productsText(p.willChange)}`}
          onClose={() => { if (!applying) dispatch({ type: 'cancel' }); }}
          onConfirm={() => void runApply()}
        >
          <p>This changes the catalogue stock of <b data-testid="confirm-count">{productsText(p.willChange)}</b>: {actionText(p.action).toLowerCase()}.</p>
          <p className="mt-2">The comparison and the marketplace files use the new values. {p.unchanged + p.notFound > 0 && `${productsText(p.unchanged + p.notFound)} stay as they are.`}</p>
          {applying && <p role="status" className="mt-2 text-xs text-gray-700">Applying… Keep this window open.</p>}
          {state.error !== undefined && !applying && (
            <p role="alert" className="mt-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              We could not confirm the change: {stockErrors(state.error).general} If the connection dropped it may already be applied; trying again is safe and will not apply it twice.
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
};

const PreviewResult: React.FC<{ preview: StockBulkPreview; faded?: boolean }> = ({ preview: p, faded }) => {
  const left = [
    p.unchanged > 0 && { key: 'unchanged', text: 'Already at this stock', n: p.unchanged },
    p.notFound > 0 && { key: 'notFound', text: 'Not found (removed, or not in this store)', n: p.notFound },
  ].filter((x): x is { key: string; text: string; n: number } => Boolean(x));
  return (
    <div role="region" aria-label="Preview" className={`space-y-5 ${faded ? 'opacity-60' : ''}`}>
      <div className="space-y-1">
        <h3 data-testid="preview-heading" className="text-sm font-bold text-gray-900">{actionText(p.action)}</h3>
        <p className="text-xs text-gray-600">{productsText(p.selected)} selected. Nothing has been changed yet.{p.reason ? ` Reason: “${p.reason}”.` : ''}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Selected" value={p.selected} testId="stock-selected" />
        <Stat label="Will change" value={p.willChange} testId="stock-will-change" />
        <Stat label="Set to a value" value={p.sets} testId="stock-sets" />
        <Stat label="Back to ERP" value={p.clears} testId="stock-clears" />
      </div>
      {p.willChange === 0 && <p role="status" className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-700">Nothing to change: every selected product already has this stock.</p>}
      {left.length > 0 && (
        <section aria-label="Left as they are">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Left as they are</h3>
          <ul className="mt-2 text-xs text-gray-700 divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {left.map(r => <li key={r.key} data-testid={`left-${r.key}`} className="flex justify-between gap-3 px-3 py-2"><span>{r.text}</span><b>{count(r.n)}</b></li>)}
          </ul>
        </section>
      )}
      {p.rows.length > 0 && (
        <section aria-label="First products" className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">First {p.rows.length} of {productsText(p.willChange)}</h3>
          <div className="overflow-x-auto border border-gray-100 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider">
                <tr><th className="px-3 py-2">Product</th><th className="px-3 py-2 text-right">ERP stock</th><th className="px-3 py-2 text-right">Catalogue stock now</th><th className="px-3 py-2 text-right">After</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {p.rows.map(r => <Row key={r.productId} row={r} />)}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

const Row: React.FC<{ row: StockBulkRow }> = ({ row: r }) => (
  <tr data-testid="stock-bulk-row">
    <td className="px-3 py-2"><div className="font-semibold text-gray-900">{r.nameEn || '—'}</div><div className="font-mono text-[11px] text-gray-500">{r.barcode}</div></td>
    <td className="px-3 py-2 text-right font-mono">{count(r.erpStock)}</td>
    <td className="px-3 py-2 text-right whitespace-nowrap"><span className="font-mono">{count(r.old.stock)}</span> <span className="text-[11px] text-gray-500">({sourceText(r.old.source)}{r.old.state === 'conflict' ? ', in conflict' : ''})</span></td>
    <td className="px-3 py-2 text-right whitespace-nowrap"><span className="font-mono font-semibold">{count(r.new.stock)}</span> <span className="text-[11px] text-gray-500">({sourceText(r.new.source)})</span></td>
  </tr>
);
