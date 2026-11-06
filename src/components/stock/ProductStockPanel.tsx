import React, { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info, RotateCcw } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useApp } from '../../context/AppContext';
import { qatarDateTime } from '../../lib/format';
import { ErrorState, LoadingState } from '../common/States';
import { count } from '../pricing/priceChange';
import { STOCK_REASON_MAX, stockApi, type ConflictChoice, type ProductStock, type ProductStockChange } from '../../api/stock';
import { productStockKey, useProductStock, invalidateStock } from './queries';
import { readReason, readStock, stockErrors, unavailableReasons } from './stockLogic';

type Op = { kind: 'set'; stock: number; reason?: string } | { kind: 'reset' } | { kind: 'resolve'; choice: ConflictChoice };

/**
 * The product's stock (GET /api/products/:id/stock): the ERP stock and the catalogue stock side by side, who set the
 * catalogue value, when and why, and an open conflict with "Use ERP" / "Keep mine". With catalogue.stock_edit: set a
 * value (optional reason) or go back to the ERP stock. Every write sends the values shown; a 409 reloads the newer ones.
 */
export const ProductStockPanel: React.FC<{ product: { id: string; nameEn: string; status: string; erpActive?: boolean; inLatestErpFile?: boolean } }> = ({ product }) => {
  const q = useProductStock(product.id);
  // Kept here, outside the form that remounts on reload, so the 409 message stays next to the newer values.
  const [staleNote, setStaleNote] = useState<string>();
  return (
    <section aria-label="Stock" className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
      <div>
        <h2 className="text-sm font-bold text-gray-900">Stock</h2>
        <p className="text-xs text-gray-500">The catalogue stock is what the comparison and the marketplace files use. It follows the ERP unless you set your own value.</p>
      </div>
      {q.isPending ? <LoadingState label="Loading stock…" rows={2} />
        : q.isError ? <ErrorState error={q.error} title="We could not load the stock" onRetry={() => void q.refetch()} />
          : <StockBody key={stamp(q.data)} stock={q.data} product={product} staleNote={staleNote} setStaleNote={setStaleNote} reload={async () => { await q.refetch(); }} />}
    </section>
  );
};

/** Remount the form when the server copy changes, so a reload replaces a stale draft's base values. */
const stamp = (s: ProductStock) => `${s.erpStock}:${s.catalogueStock}:${s.edit?.updatedAt ?? 'none'}`;

const StockBody: React.FC<{
  stock: ProductStock; product: { id: string; nameEn: string; status: string; erpActive?: boolean; inLatestErpFile?: boolean };
  staleNote?: string; setStaleNote: (v: string | undefined) => void; reload: () => Promise<void>;
}> = ({ stock: s, product, staleNote, setStaleNote, reload }) => {
  const uid = useId();
  const { can } = useAuth();
  const { showToast } = useApp();
  const qc = useQueryClient();
  const canEdit = can('catalogue.stock_edit');
  const [value, setValue] = useState(String(s.catalogueStock));
  const [reason, setReason] = useState('');
  const [local, setLocal] = useState<{ stock?: string; reason?: string }>({});

  const op = useMutation({
    mutationFn: (o: Op) => {
      if (o.kind === 'set') return stockApi.set(product.id, { stock: o.stock, ...(o.reason ? { reason: o.reason } : {}), expected: { erpStock: s.erpStock, catalogueStock: s.catalogueStock } });
      if (o.kind === 'reset') return stockApi.reset(product.id, { erpStock: s.erpStock, catalogueStock: s.catalogueStock });
      return stockApi.resolve(product.id, { choice: o.choice, expected: { erpStock: s.erpStock, ownerStock: s.conflict!.ownerStock } });
    },
    onSuccess: (result, o) => {
      setStaleNote(undefined);
      // PUT and DELETE answer changed; resolve always changes something.
      const changed = 'changed' in result ? (result as ProductStockChange).changed : true;
      qc.setQueryData(productStockKey(product.id), result);
      invalidateStock(qc, changed, product.id);
      showToast(
        !changed ? 'Nothing changed: the stock already had this value'
          : o.kind === 'reset' ? 'The catalogue stock follows the ERP again'
            : o.kind === 'resolve' ? (o.choice === 'erp' ? 'Conflict resolved: the catalogue stock follows the ERP' : 'Conflict resolved: your value stays')
              : result.source === 'erp' ? 'That is the ERP stock, so the catalogue follows the ERP again' : 'Catalogue stock saved',
        'success',
      );
    },
    onError: e => {
      const err = stockErrors(e);
      if (err.stale) {
        setStaleNote(err.general);
        void reload();
        void qc.invalidateQueries({ queryKey: ['products', 'detail', product.id] });
      }
    },
  });
  const errors = op.error && !stockErrors(op.error).stale ? stockErrors(op.error) : { fields: {} as Record<string, string>, general: undefined };
  const busy = op.isPending;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const st = readStock(value);
    const rs = readReason(reason);
    setLocal({ stock: st.error, reason: rs.error });
    if (st.error !== undefined || rs.error) return;
    setStaleNote(undefined);
    op.mutate({ kind: 'set', stock: st.value, reason: rs.value });
  };
  const run = (o: Op) => { if (!busy) { setStaleNote(undefined); op.mutate(o); } };

  const reasons = unavailableReasons(product);
  const stockError = local.stock ?? errors.fields.stock;
  const reasonError = local.reason ?? errors.fields.reason;

  return (
    <div className="space-y-4">
      {staleNote && (
        <p role="alert" data-testid="stock-stale" className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">{staleNote}</p>
      )}

      {s.conflict && (
        <div role="alert" data-testid="stock-conflict" className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-2">
          <p className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" aria-hidden />
            <span>
              <b>Stock conflict.</b> The ERP stock changed from {count(s.conflict.erpStockAtEdit)} to {count(s.conflict.erpStock)} after you set {count(s.conflict.ownerStock)}.{' '}
              {s.conflict.inEffect === 'owner'
                ? `Your value (${count(s.conflict.ownerStock)}) stays in effect until you choose.`
                : `The ERP value (${count(s.conflict.erpStock)}) is in effect until you choose.`}
            </span>
          </p>
          {canEdit && (
            <div className="flex gap-2 pl-6">
              <button type="button" disabled={busy} onClick={() => run({ kind: 'resolve', choice: 'erp' })} className="h-8 px-3 rounded-lg font-semibold border border-amber-300 bg-white disabled:opacity-50">Use ERP ({count(s.conflict.erpStock)})</button>
              <button type="button" disabled={busy} onClick={() => run({ kind: 'resolve', choice: 'keep' })} className="h-8 px-3 rounded-lg font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">Keep mine ({count(s.conflict.ownerStock)})</button>
            </div>
          )}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-200 bg-[#F8FBFA] p-3">
          <dt className="text-[11px] text-gray-500">ERP stock</dt>
          <dd data-testid="erp-stock" className="mt-0.5 text-xl font-bold text-gray-900 font-mono">{count(s.erpStock)}</dd>
          <dd className="text-[11px] text-gray-500">From the latest ERP file</dd>
        </div>
        <div className="rounded-xl border border-gray-200 bg-[#F8FBFA] p-3">
          <dt className="text-[11px] text-gray-500">Catalogue stock (in use)</dt>
          <dd data-testid="catalogue-stock" className="mt-0.5 text-xl font-bold text-gray-900 font-mono">{count(s.catalogueStock)}</dd>
          <dd data-testid="stock-source" className="text-[11px] text-gray-500">{s.source === 'owner' ? 'Your own value (manual edit)' : 'Follows the ERP'}</dd>
        </div>
      </dl>

      {s.edit && (
        <p data-testid="stock-origin" className="text-xs text-gray-600">
          Set to {count(s.edit.stock)} by <b>{s.edit.setBy.name}</b> on {qatarDateTime(s.edit.setAt)} (Qatar time), when the ERP stock was {count(s.edit.erpStockAtEdit)}.
          {' '}{s.edit.reason ? <>Reason: “{s.edit.reason}”</> : 'No reason given.'}
        </p>
      )}

      <p role="note" data-testid="stock-availability" className="flex items-start gap-1.5 text-xs text-gray-600">
        <Info className="w-3.5 h-3.5 shrink-0 text-gray-400 mt-0.5" aria-hidden />
        {reasons.length > 0
          ? <span>Stock never makes this product available: {reasons.join(', and ')}. It stays unavailable on every marketplace whatever the stock.</span>
          : <span>Stock never makes a product available when it is inactive, inactive in the ERP or missing from the ERP file.</span>}
      </p>

      {errors.general && <p role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">{errors.general}</p>}

      {canEdit ? (
        <form aria-label="Edit catalogue stock" onSubmit={save} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
          <div>
            <label htmlFor={`${uid}-stock`} className="block text-xs font-semibold text-gray-700">Catalogue stock</label>
            <input
              id={`${uid}-stock`} type="number" inputMode="numeric" min={0} step={1} value={value} disabled={busy}
              onChange={e => { setValue(e.target.value); setLocal(l => ({ ...l, stock: undefined })); }}
              aria-invalid={Boolean(stockError)} aria-describedby={stockError ? `${uid}-stock-err` : `${uid}-stock-hint`}
              className={`mt-1 w-full h-9 px-3 text-sm font-mono border rounded-lg bg-white ${stockError ? 'border-red-400' : 'border-gray-300'}`}
            />
            {stockError ? <p id={`${uid}-stock-err`} role="alert" className="mt-1 text-[11px] text-red-700">{stockError}</p>
              : <p id={`${uid}-stock-hint`} className="mt-1 text-[11px] text-gray-500">Entering the ERP stock ({count(s.erpStock)}) removes your edit.</p>}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${uid}-reason`} className="block text-xs font-semibold text-gray-700">Reason (optional)</label>
            <input
              id={`${uid}-reason`} value={reason} maxLength={STOCK_REASON_MAX} disabled={busy} placeholder="For example: counted in the store"
              onChange={e => { setReason(e.target.value); setLocal(l => ({ ...l, reason: undefined })); }}
              aria-invalid={Boolean(reasonError)} aria-describedby={reasonError ? `${uid}-reason-err` : undefined}
              className={`mt-1 w-full h-9 px-3 text-sm border rounded-lg bg-white ${reasonError ? 'border-red-400' : 'border-gray-300'}`}
            />
            {reasonError && <p id={`${uid}-reason-err`} role="alert" className="mt-1 text-[11px] text-red-700">{reasonError}</p>}
          </div>
          <div className="sm:col-span-3 flex flex-wrap justify-end gap-2">
            {s.source === 'owner' && (
              <button type="button" disabled={busy} onClick={() => run({ kind: 'reset' })} className="inline-flex items-center gap-1 h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">
                <RotateCcw className="w-3.5 h-3.5" aria-hidden /> Reset to ERP ({count(s.erpStock)})
              </button>
            )}
            <button type="submit" disabled={busy} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
              {busy ? 'Saving…' : 'Save stock'}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-gray-500">You can view the stock but not change it.</p>
      )}
    </div>
  );
};
