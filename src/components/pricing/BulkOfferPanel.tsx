import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { pricingApi, type BulkOfferApplyResult, type BulkOfferItem, type BulkOfferPreview } from '../../api/pricing';
import type { ProductItem } from '../../api/products';
import { ApiError } from '../../api/client';
import { ConfirmDialog } from '../uploads/shared';
import { expectRecompute, marketplaceName } from '../recon/shared';
import { qatarDateTime } from '../../lib/format';
import { OFFER_STATE_META, invalidatePriced } from './shared';
import { changeErrors, count, isStale, priceText } from './priceChange';
import { newIdempotencyKey } from './bulkChange';
import {
  applyToAll, itemsOf, offPercent, offText, qatarToday, readBulkOfferPreview, readBulkOfferResult, rejectText, rowFrom, rowProblems,
  warningSummary, type OfferRow, type SameForAll,
} from './offerTable';

type Phase = 'edit' | 'previewing' | 'preview' | 'applying' | 'done';
export const NOT_AVAILABLE = 'Bulk offers are not available on this server yet: it has no bulk offers API. Nothing was changed. Set offers one product at a time on the product page.';
const productsText = (n: number) => `${count(n)} ${n === 1 ? 'product' : 'products'}`;
const cellCls = (bad?: boolean) =>
  `h-8 px-2 text-xs border rounded-md bg-white disabled:bg-gray-50 disabled:text-gray-600 ${bad ? 'border-red-400' : 'border-gray-300'}`;

/**
 * "Bulk offer" (POST /api/pricing/offers/bulk/preview and /apply, pricing.edit): a wide side panel with one editable row
 * per ticked product (a full-width sheet on a phone). Each row is checked in the browser; rows with problems are
 * marked and left out, the others are previewed and then applied once. One idempotency key per preview, sent again on
 * every retry of its apply. Afterwards the catalogue, the product pages and the Dashboard refresh.
 */
export const BulkOfferPanel: React.FC<{
  products: readonly ProductItem[];
  onClose: () => void;
  /** After a successful apply (the ticks can be cleared). */
  onApplied: () => void;
}> = ({ products, onClose, onApplied }) => {
  const qc = useQueryClient();
  const today = useMemo(() => qatarToday(), []);
  // A blocked product takes no offer (the backend rejects it as product_blocked): it never enters the table.
  const [rows, setRows] = useState<OfferRow[]>(() => products.filter(p => !p.isBlocked).map(p => rowFrom(p, today)));
  const [same, setSame] = useState<SameForAll>({ price: '', start: '', end: '' });
  const [dirty, setDirty] = useState(false);
  const [phase, setPhase] = useState<Phase>('edit');
  const [preview, setPreview] = useState<BulkOfferPreview>();
  const [result, setResult] = useState<BulkOfferApplyResult>();
  const [error, setError] = useState<unknown>();
  const [askClose, setAskClose] = useState(false);
  // The request the preview answered, and its idempotency key once Apply was pressed (kept for every retry).
  const sent = useRef<BulkOfferItem[] | undefined>(undefined);
  const key = useRef<string | undefined>(undefined);
  const inFlight = useRef(false);
  const tableRef = useRef<HTMLTableElement>(null);
  // Start in the first cell, so Tab, Enter and Esc work at once.
  useEffect(() => { tableRef.current?.querySelector<HTMLInputElement>('input[data-cell]')?.focus(); }, []);

  const problems = useMemo(() => new Map(rows.map(r => [r.id, rowProblems(r, today)])), [rows, today]);
  const validCount = rows.filter(r => problems.get(r.id)!.length === 0).length;
  const badCount = rows.length - validCount;
  const editable = phase === 'edit' || phase === 'preview';
  const busy = phase === 'previewing' || phase === 'applying';

  /** Any edit drops the preview: it no longer matches what would be sent. */
  const edited = () => {
    setDirty(true);
    if (phase === 'preview') { setPhase('edit'); setPreview(undefined); sent.current = undefined; key.current = undefined; }
    setError(undefined);
  };
  const change = (id: string, patch: Partial<OfferRow>) => { setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r))); edited(); };
  const remove = (id: string) => { setRows(rs => rs.filter(r => r.id !== id)); edited(); };
  const toAll = () => { setRows(rs => applyToAll(rs, same)); edited(); };

  const close = () => {
    if (busy) return;
    if (dirty && phase !== 'done') setAskClose(true); else onClose();
  };

  const runPreview = async () => {
    if (inFlight.current || validCount === 0) return;
    inFlight.current = true;
    const items = itemsOf(rows, today);
    setPhase('previewing'); setError(undefined);
    try {
      const p = readBulkOfferPreview(await pricingApi.bulkOfferPreview({ items }));
      sent.current = items; key.current = undefined;
      setPreview(p); setPhase('preview');
    } catch (e) {
      setError(e); setPhase('edit');
    } finally {
      inFlight.current = false;
    }
  };

  const runApply = async () => {
    if (inFlight.current || !sent.current || !preview) return;
    inFlight.current = true;
    // The same key for every retry of this preview: a lost answer is then replayed, never applied twice.
    const k = key.current ?? newIdempotencyKey();
    key.current = k;
    setPhase('applying'); setError(undefined);
    try {
      const r = readBulkOfferResult(await pricingApi.bulkOfferApply({
        items: sent.current, idempotencyKey: k, ...(preview.previewToken ? { previewToken: preview.previewToken } : {}),
      }));
      setResult(r); setPhase('done'); setDirty(false);
      invalidatePriced(qc);
      void qc.invalidateQueries({ queryKey: ['pricing', 'active-offers'] });
      if (!r.replayed && r.willChange > 0) expectRecompute(qc);
      onApplied();
    } catch (e) {
      setError(e);
      if (isStale(e)) {
        // The data moved since the preview: a new preview (and so a new key) is needed.
        setPhase('edit'); setPreview(undefined); sent.current = undefined; key.current = undefined;
      } else {
        setPhase('preview');
      }
    } finally {
      inFlight.current = false;
    }
  };

  /** Enter moves to the next editable cell (Shift+Enter to the previous one); Tab works as usual. */
  const onTableKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement) || !e.target.dataset.cell) return;
    e.preventDefault();
    const cells = [...(tableRef.current?.querySelectorAll<HTMLInputElement>('input[data-cell]') ?? [])];
    const next = cells[cells.indexOf(e.target) + (e.shiftKey ? -1 : 1)];
    next?.focus();
  };

  const errorText = error ? changeErrors(error).general : undefined;
  // The bulk API rejects an unknown product inside its answer (a rejected row), never with a 404: a 404 for the whole
  // call means this server has no bulk offers API (it is not in the backend yet).
  const missingApi = error instanceof ApiError && error.status === 404;
  const warnings = preview ? warningSummary(preview.rows) : undefined;
  const rejectedRows = preview?.rows.filter(r => r.outcome === 'rejected') ?? [];

  return (
    <div
      className="fixed inset-0 z-30 bg-black/30"
      onMouseDown={e => { if (e.target === e.currentTarget) close(); }}
      onKeyDown={e => { if (e.key === 'Escape' && !askClose) { e.stopPropagation(); close(); } }}
    >
      <section
        role="dialog" aria-modal="true" aria-labelledby="bulk-offer-title"
        className="fixed inset-y-0 right-0 flex w-full sm:w-[min(72rem,95vw)] flex-col bg-white shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
          <div>
            <h2 id="bulk-offer-title" className="text-base font-bold text-gray-900">Bulk offer: {productsText(rows.length)}</h2>
            <p className="text-xs text-gray-500">A promo price for each product, from its start date to the end of its end date (Qatar time). The offer applies on every marketplace. You see a preview before anything is changed.</p>
          </div>
          <button type="button" onClick={close} disabled={busy} aria-label="Close bulk offer" className="text-gray-400 hover:text-gray-600 disabled:opacity-40"><X className="w-4 h-4" /></button>
        </header>

        {phase === 'done' && result ? (
          <Done result={result} onClose={onClose} />
        ) : (
          <>
            <fieldset disabled={!editable} aria-label="Same for all rows" className="flex flex-wrap items-end gap-3 px-4 sm:px-6 py-3 border-b border-gray-100 bg-[#F8FBFA] text-xs">
              <label className="flex flex-col gap-1 font-semibold text-gray-700">Same promo price for all (QAR)
                <input type="number" inputMode="decimal" step="0.001" min="0" value={same.price} onChange={e => setSame({ ...same, price: e.target.value })} className={`${cellCls()} w-32 font-mono`} />
              </label>
              <label className="flex flex-col gap-1 font-semibold text-gray-700">Same start date for all
                <input type="date" value={same.start} min={today} onChange={e => setSame({ ...same, start: e.target.value })} className={cellCls()} />
              </label>
              <label className="flex flex-col gap-1 font-semibold text-gray-700">Same end date for all
                <input type="date" value={same.end} min={today} onChange={e => setSame({ ...same, end: e.target.value })} className={cellCls()} />
              </label>
              <button type="button" onClick={toAll} disabled={!same.price.trim() && !same.start && !same.end} className="h-8 px-3 rounded-lg font-semibold border border-[#027864] text-[#027864] bg-white hover:bg-[#E3FAF3] disabled:opacity-50">
                Apply to all rows
              </button>
              <span className="text-gray-500">Rows stay editable one by one.</span>
            </fieldset>

            <div className="flex-1 overflow-auto px-4 sm:px-6 py-4 space-y-4">
              {preview && (phase === 'preview' || phase === 'applying') && (
                <PreviewResult preview={preview} warnings={warnings!} rejected={rejectedRows} />
              )}
              {rows.length === 0 ? (
                <p role="status" className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-700">No products left in the table. Close the panel and tick rows again.</p>
              ) : (
                <fieldset disabled={!editable} className="overflow-x-auto border border-gray-100 rounded-lg">
                  <table ref={tableRef} onKeyDown={onTableKey} aria-label="Offers to set" className="w-full min-w-[56rem] text-left text-xs">
                    <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider">
                      <tr>
                        <th className="px-3 py-2">Product</th>
                        <th className="px-3 py-2 text-right">Normal price (QAR)</th>
                        <th className="px-3 py-2">Promo price (QAR)</th>
                        <th className="px-3 py-2 text-right">Off %</th>
                        <th className="px-3 py-2">Start date</th>
                        <th className="px-3 py-2">End date</th>
                        <th className="px-3 py-2">Check</th>
                        <th className="px-3 py-2"><span className="sr-only">Remove</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-gray-700">
                      {rows.map(r => {
                        const bad = problems.get(r.id)!;
                        return (
                          <tr key={r.id} data-testid="offer-row" data-problem={bad.length > 0 || undefined} className={bad.length ? 'bg-red-50/50' : ''}>
                            <td className="px-3 py-2 align-top">
                              <div className="font-semibold text-gray-900">{r.nameEn || '—'}</div>
                              <div className="font-mono text-[11px] text-gray-500">{r.barcode}</div>
                              {r.offer && <CurrentOffer offer={r.offer} />}
                            </td>
                            <td className="px-3 py-2 align-top text-right font-mono" data-testid="normal-price">
                              {r.normalPrice === null ? <span title="Not known here: the preview checks it">—</span> : priceText(r.normalPrice)}
                            </td>
                            <td className="px-3 py-2 align-top">
                              <input
                                data-cell type="number" inputMode="decimal" step="0.001" min="0" value={r.price}
                                aria-label={`Promo price for ${r.nameEn}`} aria-invalid={bad.length > 0}
                                onChange={e => change(r.id, { price: e.target.value })} className={`${cellCls()} w-28 font-mono`}
                              />
                            </td>
                            <td className="px-3 py-2 align-top text-right font-mono" data-testid="off-percent">{offText(offPercent(r.normalPrice, r.price))}</td>
                            <td className="px-3 py-2 align-top">
                              <input data-cell type="date" value={r.start} min={today} aria-label={`Start date for ${r.nameEn}`} onChange={e => change(r.id, { start: e.target.value })} className={cellCls()} />
                            </td>
                            <td className="px-3 py-2 align-top">
                              <input data-cell type="date" required value={r.end} min={r.start || today} aria-label={`End date for ${r.nameEn}`} onChange={e => change(r.id, { end: e.target.value })} className={cellCls()} />
                            </td>
                            <td className="px-3 py-2 align-top min-w-[12rem]" data-testid="row-check">
                              {bad.length ? (
                                <ul className="space-y-0.5 text-red-700">{bad.map(m => <li key={m} className="flex items-start gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden />{m}</li>)}</ul>
                              ) : <span className="inline-flex items-center gap-1 text-[#027864] font-semibold"><CheckCircle2 className="w-3 h-3" aria-hidden />Ready</span>}
                            </td>
                            <td className="px-3 py-2 align-top text-right">
                              <button type="button" onClick={() => remove(r.id)} aria-label={`Remove ${r.nameEn}`} className="text-gray-400 hover:text-red-600"><X className="w-4 h-4" /></button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </fieldset>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 border-t border-gray-100 bg-white">
              <div className="text-xs text-gray-700 space-y-1">
                <p data-testid="offer-counts"><b>{count(validCount)}</b> valid · <b>{count(badCount)}</b> with problems{badCount > 0 && validCount > 0 ? ' (left out)' : ''}</p>
                {phase === 'applying' && <p role="status">Applying… Keep this panel open.</p>}
                {errorText && (
                  <p role="alert" className="text-red-700">
                    {missingApi ? <>{NOT_AVAILABLE}</>
                      : phase === 'preview' ?<>We could not confirm the change: {errorText} If the connection dropped it may already be applied; trying again is safe and will not apply it twice.</>
                      : isStale(error) ? <>Nothing was changed. {errorText} Run the preview again.</>
                        : <>We could not run the preview: {errorText}</>}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {(phase === 'preview' || phase === 'applying') ? (
                  <>
                    <button type="button" disabled={busy} onClick={() => { setPhase('edit'); setPreview(undefined); setError(undefined); sent.current = undefined; key.current = undefined; }} className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">Back to editing</button>
                    <button type="button" disabled={busy || !preview || preview.willChange === 0} onClick={() => void runApply()} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
                      {phase === 'applying' ? 'Applying…' : error ? 'Try again' : `Apply ${preview ? `${count(preview.willChange)} ${preview.willChange === 1 ? 'offer' : 'offers'}` : ''}`}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={close} disabled={busy} className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">Cancel</button>
                    <button type="button" disabled={busy || validCount === 0} onClick={() => void runPreview()} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
                      {phase === 'previewing' ? 'Running preview…' : `Preview ${count(validCount)} ${validCount === 1 ? 'row' : 'rows'}`}
                    </button>
                  </>
                )}
              </div>
            </footer>
          </>
        )}
      </section>

      {askClose && (
        <ConfirmDialog title="Unsaved changes" confirmLabel="Close and discard" onClose={() => setAskClose(false)} onConfirm={onClose}>
          <p>The offers in this table have not been applied. Close the panel and discard them?</p>
        </ConfirmDialog>
      )}
    </div>
  );
};

const CurrentOffer: React.FC<{ offer: NonNullable<OfferRow['offer']> }> = ({ offer: o }) => {
  const state = o.state ? OFFER_STATE_META[o.state] : undefined;
  return (
    <div data-testid="current-offer" className="mt-1 text-[11px] text-purple-800">
      Current offer: <span className="font-mono">{priceText(o.price)}</span> QAR
      {o.validFrom ? `, from ${qatarDateTime(o.validFrom)}` : ''}{o.validUntil ? `, until ${qatarDateTime(o.validUntil)}` : ', no end date'}
      {state ? ` (${state.label})` : ''}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; testId: string }> = ({ label, value, testId }) => (
  <div className="rounded-xl border border-gray-200 bg-[#F8FBFA] p-3">
    <div className="text-[11px] text-gray-500">{label}</div>
    <div data-testid={testId} className="mt-0.5 text-xl font-bold text-gray-900">{count(value)}</div>
  </div>
);

const PreviewResult: React.FC<{
  preview: BulkOfferPreview; warnings: ReturnType<typeof warningSummary>; rejected: BulkOfferPreview['rows'];
}> = ({ preview: p, warnings: w, rejected }) => (
  <div role="region" aria-label="Preview" className="space-y-3">
    <p className="text-xs text-gray-600">Preview of the valid rows. Nothing has been changed yet.</p>
    <div className="grid grid-cols-3 gap-3">
      <Stat label="Will change" value={p.willChange} testId="offer-will-change" />
      <Stat label="Unchanged" value={p.unchanged} testId="offer-unchanged" />
      <Stat label="Rejected" value={p.rejected} testId="offer-rejected" />
    </div>
    {p.willChange === 0 && <p role="status" className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-700">Nothing to change: no row would set a new offer.</p>}
    {(w.replaces > 0 || w.outranks.length > 0 || w.other.length > 0) && (
      <section aria-label="Warnings" className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" aria-hidden />
        <ul className="space-y-1">
          {w.replaces > 0 && <li data-testid="warning-replaces">{productsText(w.replaces)} already {w.replaces === 1 ? 'has an offer; it is' : 'have an offer; they are'} replaced.</li>}
          {w.outranks.map(o => (
            <li key={o.marketplaceId} data-testid="warning-outranks">
              {productsText(o.products)} {o.products === 1 ? 'has' : 'have'} a pending export price on {o.marketplaceId ? marketplaceName(o.marketplaceId) : 'a marketplace'}; it outranks the offer there.
            </li>
          ))}
          {w.other.map(m => <li key={m}>{m}</li>)}
        </ul>
      </section>
    )}
    {rejected.length > 0 && (
      <section aria-label="Rejected rows">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Rejected: left as they are</h3>
        <ul className="mt-2 text-xs text-gray-700 divide-y divide-gray-100 border border-gray-100 rounded-lg">
          {rejected.map(r => (
            <li key={r.productId} data-testid="rejected-row" className="flex justify-between gap-3 px-3 py-2">
              <span>{r.nameEn ?? r.productId}{r.barcode ? <span className="ml-1 font-mono text-gray-500">{r.barcode}</span> : null}</span>
              <span className="text-red-700">{rejectText(r)}</span>
            </li>
          ))}
        </ul>
      </section>
    )}
  </div>
);

const Done: React.FC<{ result: BulkOfferApplyResult; onClose: () => void }> = ({ result: r, onClose }) => (
  <div role="status" aria-label="Offers applied" className="flex-1 overflow-auto space-y-3 text-center px-6 py-10">
    <CheckCircle2 className="w-8 h-8 text-[#027864] mx-auto" aria-hidden />
    <div className="text-base font-bold text-gray-900" data-testid="offer-done">
      {r.replayed ? 'These offers had already been applied' : r.willChange > 0 ? `Offers set on ${productsText(r.willChange)}` : 'Nothing was changed'}
    </div>
    {r.replayed && <p className="text-xs text-gray-600">They were applied earlier from this same preview, so nothing was written again.</p>}
    <p className="text-xs text-gray-600" data-testid="offer-done-counts">{count(r.unchanged)} unchanged, {count(r.rejected)} rejected.</p>
    {r.rows.filter(x => x.outcome === 'rejected').length > 0 && (
      <ul className="mx-auto max-w-lg text-left text-xs text-gray-700 divide-y divide-gray-100 border border-gray-100 rounded-lg">
        {r.rows.filter(x => x.outcome === 'rejected').map(x => <li key={x.productId} className="flex justify-between gap-3 px-3 py-2"><span>{x.nameEn ?? x.productId}</span><span className="text-red-700">{rejectText(x)}</span></li>)}
      </ul>
    )}
    <p className="text-xs text-gray-600">The catalogue refreshes now; the comparison and the Dashboard update when the recompute has run.</p>
    <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F]">Done</button>
  </div>
);
