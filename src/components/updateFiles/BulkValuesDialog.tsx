import React, { useEffect, useId, useReducer, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, X } from 'lucide-react';
import type { ReconMarketplaceId, ReconRow } from '../../api/recon';
import {
  BLOCKED_REASON_LABELS, VALUES_BULK_LIMIT, VALUES_PRODUCT_IDS_MAX, marketplaceValuesApi,
  type BulkAction, type BulkChange, type BulkPreview, type BulkPreviewRow, type BulkRequest, type BulkResult, type MarketplaceValueItem,
  type ReasonCount, type ValueField, type ValueFilter,
} from '../../api/marketplaceValues';
import { ConfirmDialog } from '../uploads/shared';
import { count, priceText } from '../pricing/priceChange';
import { newIdempotencyKey } from '../pricing/bulkChange';
import { bulkMachine, type BulkMachine } from '../stock/stockLogic';
import { Stat } from '../stock/StockConflictsView';
import { marketplaceName, qatarDateTime } from '../recon/shared';
import { readExportPrice, rowsText, sourceText, valueErrors } from './logic';
import { ADJUST_KEY, afterValueChange } from './queries';

/** 'copy' = "Fill from another marketplace"; it is started from the Fill panel, not from the toolbar. */
export type BulkKind = 'use_catalogue' | 'unavailable' | 'available' | 'price' | 'remove' | 'copy';
export type ToolbarKind = Exclude<BulkKind, 'copy'>;
export const BULK_LABELS: Record<ToolbarKind, string> = {
  use_catalogue: 'Use catalogue values',
  unavailable: 'Set Unavailable',
  available: 'Set Available',
  price: 'Set price',
  remove: 'Remove my adjustment',
};
const SETS: readonly BulkKind[] = ['unavailable', 'available', 'price'];

/** "What to copy" from another marketplace. Price only is the default; the others are under "More options". */
export type CopyWhat = 'price' | 'availability' | 'both';
export const COPY_WHATS: readonly CopyWhat[] = ['price', 'availability', 'both'];
export const COPY_WHAT_LABELS: Record<CopyWhat, string> = { price: 'Price only', availability: 'Availability only', both: 'Price and availability' };
/** Inside a sentence: "Fill the price from Talabat". */
export const COPY_WHAT_WORDS: Record<CopyWhat, string> = { price: 'price', availability: 'availability', both: 'price and availability' };
export const copyFields = (w: CopyWhat): ValueField[] => (w === 'both' ? ['availability', 'price'] : [w]);
const copyWhatOf = (fields: readonly ValueField[]): CopyWhat => (fields.length === 2 ? 'both' : fields[0]!);

type State = BulkMachine<BulkRequest, BulkPreview, BulkResult>;
export const valuesBulkReducer = bulkMachine<BulkRequest, BulkPreview, BulkResult>(p => p.willChange);

const FIELD_LABELS: Record<'both' | ValueField, string> = { both: 'Availability and price', availability: 'Availability only', price: 'Price only' };

/** Block reasons in words; the bulk endpoints also count products of another store. */
const BLOCKED_LABELS: Record<string, string> = { ...BLOCKED_REASON_LABELS, not_found: 'Not found in this store' };
const notOnSourceLabel = (reason: string, source: string) =>
  reason === 'source_price_invalid' ? `The ${source} price cannot be used (0, or above 100,000 QAR)` : `Not on ${source}`;
const reasonLabel = (r: ReasonCount, fallback: (reason: string) => string) => r.label ?? fallback(r.reason);

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function actionText(a: BulkAction): string {
  if (a.type === 'use_catalogue') return a.fields.length === 2 ? 'Use the catalogue values' : `Use the catalogue ${a.fields[0]}`;
  if (a.type === 'copy_from_marketplace') return `Fill the ${COPY_WHAT_WORDS[copyWhatOf(a.fields)]} from ${marketplaceName(a.sourceMarketplaceId)}`;
  const parts = [
    a.values.availability && `set ${a.values.availability.value ? 'Available' : 'Unavailable'}`,
    a.values.price && `set the price to ${priceText(a.values.price.value)} QAR`,
  ].filter(Boolean).join(' and ');
  const keep = a.values.availability?.persistent || a.values.price?.persistent;
  return `${parts.charAt(0).toUpperCase()}${parts.slice(1)}${keep ? ', kept until you remove it' : ''}`;
}

/** The form → the request, or the reason it cannot be sent (checked before any call; the server checks the same). */
export function buildBulkRequest(f: {
  marketplaceId: ReconMarketplaceId; scope: 'ticked' | 'filter'; tickedIds: readonly string[]; filter: ValueFilter;
  kind: BulkKind; price: string; keep: boolean; fields: 'both' | ValueField;
  /** For 'copy': the marketplace to fill from, and what to copy. */
  copyFrom?: ReconMarketplaceId; copyWhat?: CopyWhat;
}): { request: BulkRequest; error?: undefined } | { request?: undefined; error: { selection?: string; price?: string; source?: string } } {
  if (f.scope === 'ticked') {
    if (f.tickedIds.length === 0) return { error: { selection: 'Tick at least one product in the list.' } };
    if (f.tickedIds.length > VALUES_PRODUCT_IDS_MAX) {
      return { error: { selection: `You ticked ${count(f.tickedIds.length)} products. A change of ticked rows can include at most ${count(VALUES_PRODUCT_IDS_MAX)}; use "every product in this list" instead (up to ${count(VALUES_BULK_LIMIT)}).` } };
    }
  }
  let action: BulkAction;
  switch (f.kind) {
    case 'use_catalogue': action = { type: 'use_catalogue', fields: ['availability', 'price'] }; break;
    case 'remove': action = { type: 'use_catalogue', fields: f.fields === 'both' ? ['availability', 'price'] : [f.fields] }; break;
    case 'available': case 'unavailable':
      action = { type: 'set', values: { availability: { value: f.kind === 'available', persistent: f.keep } } }; break;
    case 'price': {
      const r = readExportPrice(f.price);
      if (r.error !== undefined) return { error: { price: r.error } };
      action = { type: 'set', values: { price: { value: r.value, persistent: f.keep } } };
      break;
    }
    case 'copy':
      if (!f.copyFrom) return { error: { source: 'Choose the marketplace to fill from.' } };
      if (f.copyFrom === f.marketplaceId) return { error: { source: `You cannot fill ${marketplaceName(f.marketplaceId)} from itself. Choose another marketplace.` } };
      // persistent and replacePins are left out: fix once, and pins on this marketplace are kept (the server's defaults).
      action = { type: 'copy_from_marketplace', sourceMarketplaceId: f.copyFrom, fields: copyFields(f.copyWhat ?? 'price') };
      break;
  }
  const selection = f.scope === 'ticked' ? { productIds: [...new Set(f.tickedIds)] } : { filter: f.filter };
  return { request: { marketplaceId: f.marketplaceId, selection, action } };
}

/**
 * Bulk change of the values to export (POST /api/marketplace-values/bulk/preview and /apply, marketplace.values_edit):
 * the ticked rows or every product in the current list; preview (read-only, with a token); confirm; apply once with one
 * idempotency key per confirmation, sent again on every retry. At most 5,000 products; never truncated.
 */
export const BulkValuesDialog: React.FC<{
  marketplaceId: ReconMarketplaceId;
  initialKind: BulkKind;
  tickedIds: readonly string[];
  filter: ValueFilter;
  /** "Needs a change · Stock and price". */
  filterSummary: string;
  /** Names for the preview rows, from the loaded list. */
  rows: readonly ReconRow[];
  /** Run the preview at once (the one-click "Use catalogue values for all rows" and "Fill … from Talabat" buttons). */
  autoPreview?: boolean;
  /** "Fill from": the other marketplace and what to copy (offers the 'copy' change). */
  copyFrom?: ReconMarketplaceId;
  initialCopyWhat?: CopyWhat;
  onClose: () => void;
  onApplied: () => void;
  onGoToExport: () => void;
}> = ({ marketplaceId, initialKind, tickedIds, filter, filterSummary, rows, autoPreview, copyFrom, initialCopyWhat, onClose, onApplied, onGoToExport }) => {
  const uid = useId();
  const qc = useQueryClient();
  const [state, dispatch] = useReducer(valuesBulkReducer, { phase: 'choose' } as State);
  const inFlight = useRef(false);
  const [scope, setScope] = useState<'ticked' | 'filter'>(tickedIds.length > 0 && !autoPreview ? 'ticked' : 'filter');
  const [kind, setKind] = useState<BulkKind>(initialKind);
  const [price, setPrice] = useState('');
  const [keep, setKeep] = useState(false);
  const [fields, setFields] = useState<'both' | ValueField>('both');
  const [copyWhat, setCopyWhat] = useState<CopyWhat>(initialCopyWhat ?? 'price');
  const [errors, setErrors] = useState<{ selection?: string; price?: string; source?: string }>({});
  const name = marketplaceName(marketplaceId);
  const sourceName = copyFrom ? marketplaceName(copyFrom) : '';
  const applying = state.phase === 'applying';
  const close = () => { if (!applying) onClose(); };
  const form = { marketplaceId, scope, tickedIds, filter, kind, price, keep, fields, copyFrom, copyWhat };
  const kinds: BulkKind[] = [...(copyFrom ? ['copy' as const] : []), ...(Object.keys(BULK_LABELS) as ToolbarKind[])];
  const kindLabel = (k: BulkKind) => (k === 'copy' ? `Fill from ${sourceName}` : BULK_LABELS[k]);

  const runPreview = async (request: BulkRequest) => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: 'preview', request });
    try { dispatch({ type: 'previewed', preview: await marketplaceValuesApi.bulkPreview(request) }); } catch (error) { dispatch({ type: 'previewFailed', error }); } finally { inFlight.current = false; }
  };
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (state.phase !== 'choose') return;
    const built = buildBulkRequest(form);
    setErrors(built.error ?? {});
    if (built.request) void runPreview(built.request);
  };
  const auto = useRef(autoPreview);
  useEffect(() => { if (auto.current) { auto.current = false; submit(); } });

  const runApply = async () => {
    if (state.phase !== 'confirm' || !state.request || !state.preview || inFlight.current) return;
    inFlight.current = true;
    const key = state.idempotencyKey ?? newIdempotencyKey();
    dispatch({ type: 'apply', newKey: () => key });
    try {
      const result = await marketplaceValuesApi.bulkApply({ ...state.request, previewToken: state.preview.previewToken, idempotencyKey: key });
      dispatch({ type: 'applied', result });
      if (!result.replayed && result.willChange > 0) {
        void qc.invalidateQueries({ queryKey: ADJUST_KEY });
        afterValueChange(qc);
      }
      onApplied();
    } catch (error) {
      dispatch({ type: 'applyFailed', error });
    } finally {
      inFlight.current = false;
    }
  };

  const p = state.preview;
  const previewError = state.phase === 'choose' && state.error !== undefined ? valueErrors(state.error) : undefined;
  const names = new Map(rows.map(r => [r.productId, r] as const));
  const isSet = SETS.includes(kind);
  const doneSource = state.request?.action.type === 'copy_from_marketplace' ? marketplaceName(state.request.action.sourceMarketplaceId) : null;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onKeyDown={e => e.key === 'Escape' && state.phase !== 'confirm' && close()}>
      <div role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} className="w-full max-w-4xl my-8 rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 id={`${uid}-title`} className="text-base font-bold text-gray-900">Change the values to export to {name}</h2>
            <p data-testid="values-limit" className="text-xs text-gray-500">
              Many products at once. At most {count(VALUES_BULK_LIMIT)} products in one change ({count(VALUES_PRODUCT_IDS_MAX)} when you tick rows). You see a preview before anything is changed.
            </p>
          </div>
          <button onClick={close} disabled={applying} aria-label="Close" className="text-gray-400 hover:text-gray-600 disabled:opacity-40"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-5">
          {(state.phase === 'choose' || state.phase === 'previewing') && (
            <form aria-label="Choose the change" noValidate onSubmit={submit} className="space-y-5">
              <fieldset disabled={state.phase === 'previewing'}>
                <legend className="text-xs font-semibold text-gray-700">Products</legend>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Choice name={`${uid}-scope`} checked={scope === 'ticked'} disabled={tickedIds.length === 0} onChange={() => setScope('ticked')}
                    title={`Ticked rows (${count(tickedIds.length)})`} hint={tickedIds.length === 0 ? 'Tick rows in the list to use this.' : `At most ${count(VALUES_PRODUCT_IDS_MAX)}.`} />
                  <Choice name={`${uid}-scope`} checked={scope === 'filter'} onChange={() => setScope('filter')}
                    title="Every product in this list" hint={`${filterSummary}. Including rows not loaded yet. At most ${count(VALUES_BULK_LIMIT)}.`} />
                </div>
                {errors.selection && <p role="alert" className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">{errors.selection}</p>}
              </fieldset>

              <fieldset disabled={state.phase === 'previewing'} className="space-y-2">
                <legend className="text-xs font-semibold text-gray-700">Change</legend>
                {kinds.map(k => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input type="radio" name={`${uid}-kind`} checked={kind === k} onChange={() => setKind(k)} className="accent-[#027864]" /> {kindLabel(k)}
                  </label>
                ))}
                {kind === 'copy' && (
                  <div className="ml-6 space-y-1.5">
                    <div role="radiogroup" aria-label="What to copy" className="flex flex-wrap gap-3">
                      {COPY_WHATS.map(w => (
                        <label key={w} className="flex items-center gap-1.5 text-xs">
                          <input type="radio" name={`${uid}-copy`} checked={copyWhat === w} onChange={() => setCopyWhat(w)} className="accent-[#027864]" /> {COPY_WHAT_LABELS[w]}
                        </label>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-500">
                      Uses the values in the latest {sourceName} file. Products not on {sourceName} are left as they are, and so are values you pinned on {name}.
                    </p>
                    {errors.source && <p role="alert" className="text-[11px] text-red-700">{errors.source}</p>}
                  </div>
                )}
                {kind === 'price' && (
                  <div className="ml-6 max-w-xs">
                    <label htmlFor={`${uid}-price`} className="block text-xs font-semibold text-gray-700">Price to export (QAR)</label>
                    <input id={`${uid}-price`} type="text" inputMode="decimal" value={price}
                      onChange={e => { setPrice(e.target.value); setErrors(x => ({ ...x, price: undefined })); }}
                      aria-invalid={Boolean(errors.price)} aria-describedby={errors.price ? `${uid}-price-err` : undefined}
                      className={`mt-1 w-full h-9 px-3 text-sm font-mono border rounded-lg bg-white ${errors.price ? 'border-red-400' : 'border-gray-300'}`} />
                    {errors.price && <p id={`${uid}-price-err`} role="alert" className="mt-1 text-[11px] text-red-700">{errors.price}</p>}
                  </div>
                )}
                {kind === 'remove' && (
                  <div className="ml-6 flex flex-wrap gap-3">
                    {(Object.keys(FIELD_LABELS) as ('both' | ValueField)[]).map(f => (
                      <label key={f} className="flex items-center gap-1.5 text-xs">
                        <input type="radio" name={`${uid}-fields`} checked={fields === f} onChange={() => setFields(f)} className="accent-[#027864]" /> {FIELD_LABELS[f]}
                      </label>
                    ))}
                  </div>
                )}
                {isSet && (
                  <label className="ml-6 flex items-start gap-2 text-xs text-gray-700">
                    <input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} className="mt-0.5 accent-[#027864]" />
                    <span>
                      <span className="font-semibold">Keep until I remove it</span>
                      <span className="block text-gray-500">Every export keeps writing this value, even after {name} shows it. Without it, the adjustment clears once {name} shows the value.</span>
                    </span>
                  </label>
                )}
                {(kind === 'use_catalogue' || kind === 'remove') && (
                  <p className="ml-6 text-[11px] text-gray-500">Your adjustments are removed, pinned ones too; the file then writes the catalogue value.</p>
                )}
              </fieldset>

              {previewError?.general && <p role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">We could not run the preview: {previewError.general}</p>}

              <div className="flex justify-end gap-2">
                <button type="button" onClick={close} className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={state.phase === 'previewing'} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
                  {state.phase === 'previewing' ? 'Running preview…' : 'Preview'}
                </button>
              </div>
            </form>
          )}

          {(state.phase === 'preview' || state.phase === 'confirm' || state.phase === 'applying') && p && state.request && (
            <>
              {state.stale && (
                <div role="alert" className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <b>Nothing was changed.</b> {valueErrors(state.error).general} Run the preview again to see the current numbers.
                </div>
              )}
              <PreviewResult preview={p} request={state.request} names={names} faded={state.stale} />
              <div className="flex flex-wrap justify-between gap-2">
                <button type="button" disabled={applying} onClick={() => dispatch({ type: 'edit' })} className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">Back</button>
                {state.stale ? (
                  <button type="button" onClick={() => state.request && void runPreview(state.request)} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F]">Preview again</button>
                ) : p.willChange > 0 ? (
                  <button type="button" disabled={applying} onClick={() => dispatch({ type: 'confirm' })} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
                    Change {rowsText(p.willChange)}…
                  </button>
                ) : (
                  <button type="button" onClick={onGoToExport} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F]">Go to Export</button>
                )}
              </div>
            </>
          )}

          {state.phase === 'done' && state.result && (
            <div role="status" aria-label="Values changed" className="space-y-3 text-center py-4">
              <CheckCircle2 className="w-8 h-8 text-[#027864] mx-auto" aria-hidden />
              <div className="text-base font-bold text-gray-900" data-testid="values-bulk-done">
                {state.result.replayed ? 'This change had already been applied' : state.result.willChange > 0 ? `Changed on ${rowsText(state.result.willChange)}` : 'Nothing was changed'}
              </div>
              {state.result.replayed && <p className="text-xs text-gray-600">It was applied earlier from this same confirmation, so nothing was written again.</p>}
              <p data-testid="values-bulk-done-detail" className="text-xs text-gray-600">
                {[
                  `${count(state.result.unchanged)} already had this value`,
                  doneSource && state.result.notOnSource > 0 && `${count(state.result.notOnSource)} not on ${doneSource}`,
                  state.result.pinnedKept > 0 && `${count(state.result.pinnedKept)} pinned, kept as they are`,
                  state.result.blocked > 0 && `${count(state.result.blocked)} blocked`,
                ].filter(Boolean).join(', ')}. The files you export next use the new values.
              </p>
              <div className="flex justify-center gap-2">
                <button onClick={onClose} className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50">Back to the list</button>
                <button onClick={onGoToExport} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F]">Go to Export</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {(state.phase === 'confirm' || state.phase === 'applying') && p && state.request && (
        <ConfirmDialog
          title="Change the values to export" tone="primary" busy={applying}
          confirmLabel={state.error ? 'Try again' : `Change ${rowsText(p.willChange)}`}
          onClose={() => { if (!applying) dispatch({ type: 'cancel' }); }}
          onConfirm={() => void runApply()}
        >
          <p data-testid="confirm-text">This changes what the {name} file will write for <b data-testid="confirm-count">{rowsText(p.willChange)}</b>: {lowerFirst(actionText(state.request.action))}.</p>
          <p className="mt-2">
            {state.request.action.type === 'copy_from_marketplace'
              ? `The catalogue, your stock, your price rules and ${marketplaceName(state.request.action.sourceMarketplaceId)} do not change.`
              : 'The catalogue, your stock and your price rules do not change.'}
          </p>
          {applying && <p role="status" className="mt-2 text-xs text-gray-700">Applying… Keep this window open.</p>}
          {state.error !== undefined && !applying && (
            <p role="alert" className="mt-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              We could not confirm the change: {valueErrors(state.error).general} If the connection dropped it may already be applied; trying again is safe and will not apply it twice.
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
};

const Choice: React.FC<{ name: string; checked: boolean; disabled?: boolean; onChange: () => void; title: string; hint: string }> = ({ name, checked, disabled, onChange, title, hint }) => (
  <label className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${checked ? 'border-[#027864] bg-[#F2F7F6]' : 'border-gray-200'} ${disabled ? 'opacity-60' : ''}`}>
    <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} className="mt-1 accent-[#027864]" />
    <span><span className="block font-semibold text-gray-900">{title}</span><span className="block text-xs text-gray-500">{hint}</span></span>
  </label>
);

const exportText = (i: MarketplaceValueItem | undefined) => (i ? `${i.export.available ? 'Available' : 'Unavailable'}, ${priceText(i.export.price)} QAR` : '—');

/** One field's value in words: "4.25 QAR", "Available"; '—' when unknown. */
export const fieldValueText = (field: ValueField, v: boolean | number | null | undefined) =>
  v === null || v === undefined ? '—' : field === 'price' ? (typeof v === 'number' ? `${priceText(v)} QAR` : '—') : v ? 'Available' : 'Unavailable';

const FIELD_NAMES: Record<ValueField, string> = { availability: 'Availability', price: 'Price' };
const changesText = (changes: readonly BulkChange[], side: 'before' | 'after') =>
  changes.map(c => `${FIELD_NAMES[c.field]}: ${fieldValueText(c.field, c[side])}`).join(', ');

const ReasonList: React.FC<{ label: string; reasons: ReasonCount[]; testPrefix: string; fallback: (reason: string) => string }> = ({ label, reasons, testPrefix, fallback }) => (
  <section aria-label={label}>
    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">{label}</h3>
    <ul className="mt-2 text-xs text-gray-700 divide-y divide-gray-100 border border-gray-100 rounded-lg">
      {reasons.map(r => (
        <li key={r.reason} data-testid={`${testPrefix}-${r.reason}`} className="flex justify-between gap-3 px-3 py-2">
          <span>{reasonLabel(r, fallback)}</span><b>{count(r.count)}</b>
        </li>
      ))}
    </ul>
  </section>
);

const PreviewResult: React.FC<{ preview: BulkPreview; request: BulkRequest; names: Map<string, ReconRow>; faded?: boolean }> = ({ preview: p, request, names, faded }) => {
  const action = request.action;
  const copy = action.type === 'copy_from_marketplace' ? action : null;
  const source = copy ? marketplaceName(copy.sourceMarketplaceId) : '';
  const target = marketplaceName(request.marketplaceId);
  const blockedFallback = (reason: string) => BLOCKED_LABELS[reason] ?? reason;
  return (
    <div role="region" aria-label="Preview" className={`space-y-5 ${faded ? 'opacity-60' : ''}`}>
      <div className="space-y-1">
        <h3 data-testid="values-preview-heading" className="text-sm font-bold text-gray-900">{actionText(action)}</h3>
        <p className="text-xs text-gray-600">{rowsText(p.selected)} selected. Nothing has been changed yet.</p>
        {copy && p.source?.latestFile && (
          <p data-testid="values-source-file" className="text-xs text-gray-600">
            {source} values are from the latest {source} file{p.source.latestFile.fileName ? `, ${p.source.latestFile.fileName}` : ''}, uploaded {qatarDateTime(p.source.latestFile.uploadedAt)} (Qatar time).
          </p>
        )}
      </div>
      <div className={`grid grid-cols-2 gap-3 ${copy ? 'sm:grid-cols-3 lg:grid-cols-6' : 'sm:grid-cols-4'}`}>
        <Stat label="Selected" value={p.selected} testId="values-selected" />
        <Stat label="Will change" value={p.willChange} testId="values-will-change" />
        <Stat label="Already this value" value={p.unchanged} testId="values-unchanged" />
        {copy && <Stat label={`Not on ${source}`} value={p.notOnSource} testId="values-not-on-source" />}
        {copy && <Stat label="Pinned, kept" value={p.pinnedKept} testId="values-pinned-kept" />}
        <Stat label="Blocked" value={p.blocked} testId="values-blocked" />
      </div>
      {p.willChange === 0 && (
        <p role="status" data-testid="values-nothing" className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-700">
          Nothing to change: {action.type === 'use_catalogue'
            ? 'every selected product already exports the catalogue value. You can export now.'
            : copy ? `every selected product already exports the ${source} value, is not on ${source}, is pinned or is blocked.`
              : 'every selected product already has this value or is blocked.'}
        </p>
      )}
      {copy && p.notOnSource > 0 && p.notOnSourceByReason.length > 0 && (
        <ReasonList label={`Not filled from ${source}, left as they are`} reasons={p.notOnSourceByReason} testPrefix="not-on-source" fallback={r => notOnSourceLabel(r, source)} />
      )}
      {copy && p.fromOlderFile > 0 && (
        <p data-testid="values-older-file" className="text-xs text-amber-800">
          For {rowsText(p.fromOlderFile)}, the {source} value is from an older {source} file, because the latest one did not include {p.fromOlderFile === 1 ? 'it' : 'them'}.
        </p>
      )}
      {copy && p.pinnedKept > 0 && (
        <p data-testid="values-pinned-note" className="text-xs text-gray-600">
          {rowsText(p.pinnedKept)} {p.pinnedKept === 1 ? 'has' : 'have'} a value you pinned on {target}. Pinned values are kept; remove the pin first to fill them from {source}.
        </p>
      )}
      {p.blocked > 0 && p.blockedByReason.length > 0 && (
        <ReasonList label="Blocked, left as they are" reasons={p.blockedByReason} testPrefix="blocked" fallback={blockedFallback} />
      )}
      {p.rows.length > 0 && (
        <section aria-label="First products" className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
            {copy ? `First ${p.rows.length} of ${rowsText(p.willChange)} that change` : `First ${p.rows.length} of ${rowsText(p.selected)}`}
          </h3>
          <div className="overflow-x-auto border border-gray-100 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider">
                {copy
                  ? <tr><th className="px-3 py-2">Product</th><th className="px-3 py-2">{source} → {target}</th><th className="px-3 py-2">{target} file after</th></tr>
                  : <tr><th className="px-3 py-2">Product</th><th className="px-3 py-2">Exports now</th><th className="px-3 py-2">After</th></tr>}
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {p.rows.map(r => copy
                  ? <CopyPreviewRow key={r.productId} row={r} named={names.get(r.productId)} fields={copy.fields} source={source} target={target} />
                  : <PreviewRow key={r.productId} row={r} named={names.get(r.productId)} clearsToCatalogue={action.type === 'use_catalogue'} />)}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

const ProductCell: React.FC<{ row: BulkPreviewRow; named?: ReconRow }> = ({ row: r, named }) => (
  <td className="px-3 py-2 align-top">
    <div className="font-semibold text-gray-900">{r.nameEn ?? named?.nameEn ?? 'Product'}</div>
    <div className="font-mono text-[11px] text-gray-500">{r.barcode ?? named?.barcode ?? r.productId}</div>
  </td>
);

/** Set, Use catalogue, Remove: the proposal's whole items, or the backend's per-field `changes`. */
const PreviewRow: React.FC<{ row: BulkPreviewRow; named?: ReconRow; clearsToCatalogue: boolean }> = ({ row: r, named, clearsToCatalogue }) => {
  const changes = r.changes && r.changes.length > 0 ? r.changes : null;
  const before = r.before ? exportText(r.before) : changes ? changesText(changes, 'before') : '—';
  const after = r.after ? exportText(r.after) : changes ? changesText(changes, 'after') : r.changes ? 'No change' : '—';
  const afterSource = r.after ? sourceText(r.after, marketplaceName) : changes ? (clearsToCatalogue || changes.every(c => c.op === 'clear') ? 'From the catalogue' : 'Adjusted by hand') : null;
  return (
    <tr data-testid="values-bulk-row">
      <ProductCell row={r} named={named} />
      <td className="px-3 py-2 whitespace-nowrap align-top">{before}</td>
      <td className="px-3 py-2 align-top">
        {r.blockedReason ? <span className="font-semibold text-amber-800">Blocked: {BLOCKED_LABELS[r.blockedReason] ?? r.blockedReason}</span> : (
          <>
            <div className="font-semibold whitespace-nowrap">{after}</div>
            {afterSource && <div data-testid="values-row-source" className="text-[11px] text-gray-500">{afterSource}</div>}
          </>
        )}
      </td>
    </tr>
  );
};

/** Fill from another marketplace: "Talabat: 4.25 QAR → Snoonu", what the target file writes now, and after. */
const CopyPreviewRow: React.FC<{ row: BulkPreviewRow; named?: ReconRow; fields: readonly ValueField[]; source: string; target: string }> = ({ row: r, named, fields, source, target }) => {
  const sourceValue = (f: ValueField) => (f === 'price' ? r.source?.price : r.source?.available);
  const changeOf = (f: ValueField) => r.changes?.find(c => c.field === f);
  const nowOf = (f: ValueField) => changeOf(f)?.before ?? (r.before ? (f === 'price' ? r.before.export.price : r.before.export.available) : undefined);
  let outcome: React.ReactNode = null;
  if (r.blockedReason) outcome = <span className="font-semibold text-amber-800">Blocked: {BLOCKED_LABELS[r.blockedReason] ?? r.blockedReason}</span>;
  else if (r.source === null) outcome = <span className="text-gray-600">Not on {source}: left as it is</span>;
  else if (!fields.some(changeOf)) outcome = <span className="text-gray-600">No change: already this value, or pinned</span>;
  return (
    <tr data-testid="values-bulk-row" data-product={r.productId}>
      <ProductCell row={r} named={named} />
      <td className="px-3 py-2 align-top">
        {r.source === null ? <span className="text-gray-500">Not on {source}</span> : fields.map(f => (
          <div key={f} data-testid={`copy-${f}`} className="whitespace-nowrap">
            <span className="text-gray-500">{FIELD_NAMES[f]}: </span>
            <b>{source}: {fieldValueText(f, sourceValue(f))} → {target}</b>
            <span className="text-gray-500"> (now {fieldValueText(f, nowOf(f))})</span>
          </div>
        ))}
        {r.source && !r.source.isLatestFile && <div className="text-[11px] text-amber-700">From an older {source} file{r.source.fileName ? `, ${r.source.fileName}` : ''}</div>}
      </td>
      <td className="px-3 py-2 align-top">
        {outcome ?? fields.map(f => {
          const c = changeOf(f);
          return (
            <div key={f} data-testid={`after-${f}`} className="whitespace-nowrap">
              <span className="font-semibold">{fieldValueText(f, c ? c.after : nowOf(f))}</span>
              <span className="text-[11px] text-gray-500"> {c ? `from ${source}` : 'no change'}</span>
            </div>
          );
        })}
      </td>
    </tr>
  );
};
