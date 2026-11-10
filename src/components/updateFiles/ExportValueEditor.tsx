import React, { useEffect, useId, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, RotateCcw } from 'lucide-react';
import type { ReconRow } from '../../api/recon';
import type { MarketplaceValueItem, SetValues } from '../../api/marketplaceValues';
import { priceText } from '../pricing/priceChange';
import { marketplaceName } from '../recon/shared';
import { differsFromRule, hasAdjustment, isPinned, pending, readExportPrice, resaveWithPersistent, rowState, valueErrors, valuesOf } from './logic';
import { useValueChange } from './queries';

/** The attribute on each price input; the Adjust table moves focus between rows with it (Tab / Shift+Tab). */
export const PRICE_INPUT_ATTR = 'data-export-price';

/** The row's state: Needs fix, Adjusted (waiting for export), Pinned, Blocked with the reason, Cleared. In words, never colour alone. */
export const ExportStateBadge: React.FC<{ row: ReconRow }> = ({ row }) => {
  const s = rowState(row);
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span data-testid="export-state" data-state={s.key} className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${s.tone}`}>
        <s.Icon className="w-3 h-3" aria-hidden /> {s.label}
      </span>
      {s.detail && <span data-testid="export-state-detail" className="text-[11px] text-gray-700">{s.detail}</span>}
    </span>
  );
};

/** Read-only "Value to export": what the file will write. */
export const ExportValueText: React.FC<{ item: MarketplaceValueItem }> = ({ item }) => (
  <span className="inline-flex flex-col gap-0.5 text-xs">
    <span data-testid="export-available">{item.export.available ? 'Available' : 'Unavailable'}{item.export.availabilitySource === 'override' ? ' (adjusted)' : ''}</span>
    <span data-testid="export-price" className="font-mono">{priceText(item.export.price)} QAR{item.export.priceSource === 'override' ? ' (adjusted)' : ''}</span>
  </span>
);

/**
 * "Value to export" for one product on one marketplace: Available / Unavailable, the price, "Keep until I remove it" and
 * "Remove my adjustment". Shared by the Adjust table and the Quick-edit drawer. Price: Enter saves, Esc puts the saved
 * value back, Tab saves and (in the table) moves to the next row. Each save shows at once and is rolled back on an error.
 */
export const ExportValueEditor: React.FC<{
  row: ReconRow;
  marketplaceId: string;
  canEdit: boolean;
  /** In the table: Tab / Shift+Tab from the price moves to the next / previous row. */
  onTabOut?: (direction: 1 | -1) => void;
}> = ({ row, marketplaceId, canEdit, onTabOut }) => {
  const uid = useId();
  const item = valuesOf(row);
  const change = useValueChange(marketplaceId);
  const [draft, setDraft] = useState(item ? priceText(item.export.price) : '');
  const [inputError, setInputError] = useState<string | null>(null);
  const [keep, setKeep] = useState(item ? isPinned(item) : false);
  const [saved, setSaved] = useState(false);
  const exportPrice = item?.export.price;
  // The saved value changed (our save, a reload, another person): show it unless the user is typing a different one.
  useEffect(() => { if (exportPrice !== undefined) setDraft(priceText(exportPrice)); }, [exportPrice]);
  const pinned = item ? isPinned(item) : false;
  useEffect(() => { setKeep(pinned); }, [pinned]);

  if (!item) return <span className="text-[11px] text-gray-500">Not available on this server yet</span>;
  if (!canEdit) return <ExportValueText item={item} />;

  const name = marketplaceName(marketplaceId);
  const product = row.nameEn;
  const busy = change.isPending;
  const errors = valueErrors(change.error);
  const dirty = draft.trim() !== priceText(item.export.price);

  const save = (values: SetValues, onDone?: () => void) => {
    setSaved(false);
    change.mutate({ kind: 'set', productId: row.productId, values, expected: item.version }, {
      onSuccess: () => { setSaved(true); onDone?.(); },
    });
  };

  const setAvailability = (value: boolean) => {
    if (busy) return;
    const av = item.overrides.availability;
    // Already exported as this value with nothing to change: no call.
    if (item.export.available === value && (!pending(av) || av.persistent === keep)) return;
    save({ availability: { value, persistent: keep } });
  };

  /** true when nothing is left to save (the caller may move on). */
  const savePrice = (): boolean => {
    if (!dirty) { setInputError(null); return true; }
    const r = readExportPrice(draft);
    if (r.error !== undefined) { setInputError(r.error); return false; }
    setInputError(null);
    if (busy) return false;
    save({ price: { value: r.value, persistent: keep } });
    return true;
  };

  const onPriceKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); savePrice(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDraft(priceText(item.export.price)); setInputError(null); }
    else if (e.key === 'Tab' && onTabOut) {
      e.preventDefault();
      if (savePrice()) onTabOut(e.shiftKey ? -1 : 1);
    }
  };

  const toggleKeep = (next: boolean) => {
    setKeep(next);
    // An adjustment already in place is saved again with the new choice (a pin change alone is a real change).
    const again = resaveWithPersistent(item, next);
    if (again && !busy) save(again);
  };

  const removeAdjustment = () => {
    if (busy) return;
    setSaved(false);
    change.mutate({ kind: 'use_catalogue', productId: row.productId, fields: ['availability', 'price'], expected: item.version }, { onSuccess: () => setSaved(true) });
  };

  const priceError = inputError ?? errors.fields.price;
  const message = priceError ?? errors.fields.availability ?? errors.fields.reason ?? errors.general;
  const errorId = `${uid}-err`;
  const btn = (on: boolean) => `inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#027864] focus-visible:z-10 ${on ? 'bg-[#027864] text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`;

  return (
    <div className="space-y-1.5 min-w-[12rem]" data-testid="export-editor">
      <div role="group" aria-label={`Availability to export for ${product} on ${name}`} className="inline-flex rounded-lg border border-gray-300 overflow-hidden divide-x divide-gray-300">
        <button type="button" aria-pressed={item.export.available} disabled={busy} onClick={() => setAvailability(true)} className={btn(item.export.available)}>
          <CheckCircle2 className="w-3 h-3" aria-hidden /> Available
        </button>
        <button type="button" aria-pressed={!item.export.available} disabled={busy} onClick={() => setAvailability(false)} className={btn(!item.export.available)}>
          <CircleSlash className="w-3 h-3" aria-hidden /> Unavailable
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          type="text" inputMode="decimal" autoComplete="off"
          {...{ [PRICE_INPUT_ATTR]: row.productId }}
          aria-label={`Price to export for ${product} on ${name}, QAR`}
          aria-invalid={Boolean(priceError)} aria-describedby={message ? errorId : `${uid}-hint`}
          value={draft} disabled={busy}
          onChange={e => { setDraft(e.target.value); setInputError(null); setSaved(false); }}
          onKeyDown={onPriceKey}
          className={`w-24 h-8 px-2 text-xs font-mono border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#027864] ${priceError ? 'border-red-400' : dirty ? 'border-amber-400' : 'border-gray-300'}`}
        />
        <span className="text-[11px] text-gray-500">QAR</span>
        <span id={`${uid}-hint`} className="sr-only">Press Enter to save, Escape to cancel.</span>
        <span role="status" aria-live="polite" className="text-[11px] text-gray-500">
          {busy ? <span className="inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" aria-hidden />Saving…</span>
            : dirty ? 'Not saved: press Enter' : saved ? 'Saved' : ''}
        </span>
      </div>

      {differsFromRule(item) && (
        <p data-testid="differs-from-rule" className="flex items-center gap-1 text-[11px] text-amber-800">
          <AlertTriangle className="w-3 h-3" aria-hidden /> Differs from the rule price{item.rulePrice !== undefined ? ` (${priceText(item.rulePrice)} QAR)` : ''}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-700">
          <input type="checkbox" checked={keep} disabled={busy} onChange={e => toggleKeep(e.target.checked)} className="accent-[#027864]" aria-describedby={`${uid}-keep`} />
          Keep until I remove it
        </label>
        <span id={`${uid}-keep`} className="sr-only">
          Every export keeps writing this value, even after {name} shows it. Without it, the adjustment clears once {name} shows the value.
        </span>
        {hasAdjustment(item) && (
          <button type="button" onClick={removeAdjustment} disabled={busy} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#027864] hover:underline disabled:opacity-50">
            <RotateCcw className="w-3 h-3" aria-hidden /> Remove my adjustment
          </button>
        )}
      </div>

      {message && <p id={errorId} role="alert" data-testid="export-error" className="text-[11px] text-red-700">{message}</p>}
    </div>
  );
};
