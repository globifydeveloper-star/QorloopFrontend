import React, { useId, useReducer, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import {
  BULK_ACTION_TYPES, BULK_PRICE_LIMIT, BULK_ROUNDINGS, pricingApi,
  type BulkActionType, type BulkApplyResult, type BulkPreview, type BulkPriceRequest, type BulkPriceRow, type BulkRounding, type PricingMarketplaceId,
} from '../../api/pricing';
import { reconApi, type ReconReference } from '../../api/recon';
import { ConfirmDialog } from '../uploads/shared';
import { REFERENCE_LABELS, expectRecompute, marketplaceName } from '../recon/shared';
import { FieldError, PriceSourceChip, inputCls, invalidatePriced, ruleText } from './shared';
import { changeErrors, count, priceText, signedPrice } from './priceChange';
import {
  BULK_ACTION_LABELS, BULK_ROUNDING_LABELS, BULK_START, actionPhrase, actionText, bulkReducer, bulkValueKind, buildBulkRequest, newIdempotencyKey,
  productsText, selectionCount, selectionCountText, selectionProblem, type BulkForm, type MismatchCount, type SelectionCount,
} from './bulkChange';
import { namesText, usePricingMarketplaces } from './InlinePriceEditor';

const VALUE_LABELS = { price: 'Price (QAR)', percent: 'Percent (%)', amount: 'Amount (QAR)' } as const;

/**
 * Bulk price change (POST /api/pricing/bulk/preview and /apply, pricing.bulk): choose the products (the ticked rows or
 * every active product matching the list's filter), the marketplace, the action and its rounding; preview what it would
 * do; confirm the number of products; apply once. Limits are checked before any call. One idempotency key per
 * confirmation of a preview, sent again on every retry of it. Afterwards the lists, the details and the comparison refresh.
 */
export const BulkPriceChangeDialog: React.FC<{
  tickedIds: readonly string[];
  /** The list's current search and category (the status tab is not part of a bulk selection: only active products are priced). */
  filter: BulkForm['filter'];
  /** Active products matching the filter, from the product list's counts; undefined while not known. */
  filterActiveCount?: number;
  /** Cached counts can be stale while the catalogue's first page is loading/refetching. */
  filterCountPending?: boolean;
  /** "Search "milk" · Dairy › Milk", or '' for no filter. */
  filterSummary: string;
  onClose: () => void;
  /** After a successful apply (the ticks can be cleared). */
  onApplied: () => void;
}> = ({ tickedIds, filter, filterActiveCount, filterCountPending = false, filterSummary, onClose, onApplied }) => {
  const uid = useId();
  const qc = useQueryClient();
  const markets = usePricingMarketplaces();
  const [state, dispatch] = useReducer(bulkReducer, BULK_START);
  const inFlight = useRef(false);

  const [choice, setChoice] = useState<PricingMarketplaceId>();
  const marketplaceId = choice && markets.ids.includes(choice) ? choice : markets.ids[0];
  const [scope, setScope] = useState<BulkForm['scope']>(tickedIds.length > 0 ? 'ticked' : 'filter');
  const [action, setAction] = useState<BulkActionType>('increase_percent');
  const [value, setValue] = useState('');
  const [rounding, setRounding] = useState<BulkRounding>('none');
  const [valueError, setValueError] = useState<string>();
  // Part of the filter option: only products listed on the marketplace with a price mismatch there.
  const [onlyMismatches, setOnlyMismatches] = useState(false);
  const mismatchCount = useMismatchCount(marketplaceId, onlyMismatches);

  const filterSelection = { scope: 'filter' as const, tickedIds, marketplaceId, filter, filterActiveCount: filterCountPending ? undefined : filterActiveCount, onlyMismatches, mismatches: mismatchCount.data };
  const filterCount = filterCountPending ? undefined : selectionCount(filterSelection);
  const form: BulkForm | undefined = marketplaceId
    ? { ...filterSelection, scope, marketplaceId, action, value, rounding }
    : undefined;
  const liveSelectionProblem = scope === 'filter' && filterCountPending ? undefined : selectionProblem(scope === 'filter' ? filterSelection : { scope, tickedIds });
  const kind = bulkValueKind(action);
  const mpName = marketplaceId ? marketplaceName(marketplaceId) : 'the marketplace';
  const compared = mismatchCount.data ? `the ${REFERENCE_LABELS[mismatchCount.data.reference]}` : 'the price you compare against';
  const filterCountLabel = filterCount ? selectionCountText(filterCount) : !filterCountPending && onlyMismatches && mismatchCount.isError ? 'not counted' : 'Counting...';
  const applying = state.phase === 'applying';
  const close = () => { if (!applying) onClose(); };

  const runPreview = async (request: BulkPriceRequest) => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: 'preview', request });
    try {
      dispatch({ type: 'previewed', preview: await pricingApi.bulkPreview(request) });
    } catch (error) {
      dispatch({ type: 'previewFailed', error });
    } finally {
      inFlight.current = false;
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || state.phase !== 'choose') return;
    const built = buildBulkRequest(form);
    setValueError(built.errors?.value);
    if (built.request) void runPreview(built.request);
  };

  const runApply = async () => {
    if (state.phase !== 'confirm' || !state.request || !state.preview || inFlight.current) return;
    inFlight.current = true;
    // The same key for every retry of this confirmation: a lost answer is then replayed, never applied twice.
    const key = state.idempotencyKey ?? newIdempotencyKey();
    dispatch({ type: 'apply', newKey: () => key });
    try {
      const result = await pricingApi.bulkApply({ ...state.request, idempotencyKey: key, previewToken: state.preview.previewToken });
      dispatch({ type: 'applied', result });
      invalidatePriced(qc);
      // The backend queues one recompute when this apply changed something (a replay changed nothing new).
      if (!result.replayed && result.willChange > 0) expectRecompute(qc);
      onApplied();
    } catch (error) {
      dispatch({ type: 'applyFailed', error });
    } finally {
      inFlight.current = false;
    }
  };

  const previewError = state.phase === 'choose' ? changeErrors(state.error).general : undefined;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onKeyDown={e => e.key === 'Escape' && state.phase !== 'confirm' && close()}>
      <div role="dialog" aria-modal="true" aria-label="Bulk price change" className="w-full max-w-4xl my-8 rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Bulk price change</h2>
            <p className="text-xs text-gray-500">Change the price of many products at once. You see a preview before anything is changed.</p>
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
                    <input type="radio" name={`${uid}-scope`} value="ticked" checked={scope === 'ticked'} disabled={tickedIds.length === 0} onChange={() => setScope('ticked')} className="mt-1 accent-[#027864]" />
                    <span>
                      <span className="block font-semibold text-gray-900">Ticked rows ({count(tickedIds.length)})</span>
                      <span className="block text-xs text-gray-500">{tickedIds.length === 0 ? 'Tick rows in the list to use this.' : 'Inactive or new ones among them are shown as blocked.'}</span>
                    </span>
                  </label>
                  <label className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${scope === 'filter' ? 'border-[#027864] bg-[#F2F7F6]' : 'border-gray-200'}`}>
                    <input type="radio" name={`${uid}-scope`} value="filter" checked={scope === 'filter'} onChange={() => setScope('filter')} className="mt-1 accent-[#027864]" />
                    <span>
                      <span className="block font-semibold text-gray-900">
                        {filterSummary ? 'Active products matching the current filter' : 'Every active product'}
                        {onlyMismatches ? ` with a price mismatch on ${mpName}` : ''} ({filterCountLabel})
                      </span>
                      <span className="block text-xs text-gray-500">{filterSummary ? `${filterSummary}. ` : ''}Only active products are priced; the status tab is not used.</span>
                    </span>
                  </label>
                </div>
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input
                    type="checkbox" checked={onlyMismatches} disabled={!marketplaceId}
                    onChange={e => { setOnlyMismatches(e.target.checked); if (e.target.checked) setScope('filter'); }}
                    className="mt-1 accent-[#027864]"
                  />
                  <span>
                    <span className="block font-semibold text-gray-900">Only products with a price mismatch on {mpName}</span>
                    <span className="block text-xs text-gray-500">
                      Listed on {mpName} at a price that differs from {compared}, as of the last comparison. Fixes every price mismatch in one change; works with the current search and category.
                    </span>
                  </span>
                </label>
                {onlyMismatches && (
                  <p role="status" data-testid="mismatch-count" className="mt-1 ml-6 text-xs text-gray-700">
                    {filterCountPending ? 'Counting...' : mismatchCount.isPending ? `Counting the price mismatches on ${mpName}…`
                      : mismatchCount.isError ? 'We could not count the price mismatches; the preview shows the number.'
                        : filterCount ? matchText(filterCount, mpName) : ''}
                  </p>
                )}
                {liveSelectionProblem &&<p role="alert" className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">{liveSelectionProblem}</p>}
              </fieldset>

              <fieldset disabled={state.phase === 'previewing'} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <legend className="sr-only">Marketplace and change</legend>
                <div>
                  <label htmlFor={`${uid}-mp`} className="block text-xs font-semibold text-gray-700">Marketplace</label>
                  <select id={`${uid}-mp`} value={marketplaceId ?? ''} disabled={markets.ids.length === 0} onChange={e => setChoice(e.target.value as PricingMarketplaceId)} aria-describedby={`${uid}-mp-hint`} className={`${inputCls()} mt-1`}>
                    {markets.state === 'loading' && <option value="">Loading marketplaces…</option>}
                    {markets.ids.map(m => <option key={m} value={m}>{marketplaceName(m)}</option>)}
                  </select>
                  <p id={`${uid}-mp-hint`} className="mt-1 text-[11px] text-gray-500">Prices are calculated and compared on this marketplace.</p>
                  {markets.state === 'none' && <p role="note" className="mt-1 text-[11px] text-gray-700">No marketplace is enabled for this store yet.</p>}
                </div>
                <div>
                  <label htmlFor={`${uid}-action`} className="block text-xs font-semibold text-gray-700">Change</label>
                  <select id={`${uid}-action`} value={action} onChange={e => { setAction(e.target.value as BulkActionType); setValueError(undefined); }} className={`${inputCls()} mt-1`}>
                    {BULK_ACTION_TYPES.map(t => <option key={t} value={t}>{t === 'match_marketplace' ? `Match the ${mpName} price` : BULK_ACTION_LABELS[t]}</option>)}
                  </select>
                  <p className="mt-1 text-[11px] text-gray-500">{ACTION_HINTS[action](mpName)}</p>
                </div>
                {kind && (
                  <div>
                    <label htmlFor={`${uid}-value`} className="block text-xs font-semibold text-gray-700">{VALUE_LABELS[kind]}</label>
                    <input
                      id={`${uid}-value`} type="number" inputMode="decimal" step="any" value={value}
                      onChange={e => { setValue(e.target.value); setValueError(undefined); }}
                      aria-invalid={Boolean(valueError)} aria-describedby={valueError ? `${uid}-value-err` : undefined}
                      className={`${inputCls(valueError)} mt-1 font-mono`}
                    />
                    <FieldError id={`${uid}-value-err`} message={valueError} />
                  </div>
                )}
                {(kind === 'percent' || kind === 'amount') && (
                  <div>
                    <label htmlFor={`${uid}-rounding`} className="block text-xs font-semibold text-gray-700">Rounding</label>
                    <select id={`${uid}-rounding`} value={rounding} onChange={e => setRounding(e.target.value as BulkRounding)} aria-describedby={`${uid}-rounding-hint`} className={`${inputCls()} mt-1`}>
                      {BULK_ROUNDINGS.map(r => <option key={r} value={r}>{BULK_ROUNDING_LABELS[r]}</option>)}
                    </select>
                    <p id={`${uid}-rounding-hint`} className="mt-1 text-[11px] text-gray-500">The new price is rounded once, halves up. No rounding keeps up to 3 decimals.</p>
                  </div>
                )}
              </fieldset>

              <div role="note" className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600 mt-0.5" aria-hidden />
                <span>
                  <b>The new prices apply to ALL marketplaces</b>, not only {mpName}: each is saved as the product&apos;s own price rule
                  {markets.state === 'known' && markets.ids.length > 1 ? `, which ${namesText(markets.ids)} all use` : ''}. The preview changes nothing.
                </span>
              </div>

              {previewError && <p role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">We could not run the preview: {previewError}</p>}

              <div className="flex justify-end gap-2">
                <button type="button" onClick={close} className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={state.phase === 'previewing' || Boolean(liveSelectionProblem) || !form} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
                  {state.phase === 'previewing' ? 'Running preview…' : 'Preview'}
                </button>
              </div>
            </form>
          )}

          {(state.phase === 'preview' || state.phase === 'confirm' || state.phase === 'applying') && state.preview && (
            <>
              {state.stale && (
                <div role="alert" className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <b>Nothing was changed.</b> {changeErrors(state.error).general} Run the preview again to see the current numbers.
                </div>
              )}
              <PreviewResult preview={state.preview} faded={state.stale} />
              <div className="flex justify-between gap-2">
                <button type="button" disabled={applying} onClick={() => dispatch({ type: 'edit' })} className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">Back</button>
                {state.stale ? (
                  <button type="button" onClick={() => state.request && void runPreview(state.request)} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F]">Preview again</button>
                ) : state.preview.willChange > 0 && (
                  <button type="button" disabled={applying} onClick={() => dispatch({ type: 'confirm' })} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
                    Change {productsText(state.preview.willChange)}…
                  </button>
                )}
              </div>
            </>
          )}

          {state.phase === 'done' && state.result && <Done result={state.result} marketplace={marketplaceName(state.request?.marketplaceId ?? '')} onClose={onClose} />}
        </div>
      </div>

      {(state.phase === 'confirm' || state.phase === 'applying') && state.preview && state.request && (
        <ConfirmDialog
          title="Change prices"
          tone="primary"
          confirmLabel={state.error ? 'Try again' : `Change ${productsText(state.preview.willChange)}`}
          busy={applying}
          onClose={() => { if (!applying) dispatch({ type: 'cancel' }); }}
          onConfirm={() => void runApply()}
        >
          <p>
            This changes the price of <b data-testid="confirm-count">{productsText(state.preview.willChange)}</b>: {actionPhrase(state.preview.action, marketplaceName(state.preview.marketplaceId))}, priced on {marketplaceName(state.preview.marketplaceId)}.
          </p>
          <p className="mt-2">The new prices apply on every marketplace. {state.preview.unchanged + state.preview.blocked > 0 && `${productsText(state.preview.unchanged + state.preview.blocked)} stay as they are.`}</p>
          {applying && <p role="status" className="mt-2 text-xs text-gray-700">Applying… This can take up to a minute. Keep this window open.</p>}
          {state.error !== undefined && !applying && (
            <p role="alert" className="mt-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              We could not confirm the change: {changeErrors(state.error).general} If the connection dropped it may already be applied; trying again is safe and will not apply it twice.
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
};

/** Rows per page of GET /api/recon/rows (its maximum). */
const RECON_ROWS_PAGE = 200;

/**
 * Active products with a price mismatch on the marketplace, from the stored comparison rows: the rows and flag the
 * bulk filter's reconStatus price_mismatch reads (the store's default reference, named in the answer). Pages through
 * GET /api/recon/rows?type=price and stops once above the bulk limit. Under ['recon', 'rows'], so a price change or a
 * recompute invalidates it with the reports.
 */
function useMismatchCount(marketplaceId: PricingMarketplaceId | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['recon', 'rows', 'bulk-mismatch-count', marketplaceId],
    enabled: enabled && Boolean(marketplaceId),
    retry: false,
    queryFn: async ({ signal }): Promise<MismatchCount> => {
      let cursor: string | undefined;
      let active = 0;
      let reference: ReconReference = 'marketplace';
      do {
        const page = await reconApi.rows({ marketplaceId: marketplaceId!, type: 'price', limit: RECON_ROWS_PAGE, cursor }, signal);
        reference = page.reference;
        active += page.items.filter(r => r.productStatus === 'active').length;
        cursor = page.nextCursor ?? undefined;
      } while (cursor && active <= BULK_PRICE_LIMIT);
      return { count: active, more: Boolean(cursor), reference };
    },
  });
}

/** The count line under the mismatch checkbox. */
function matchText(c: SelectionCount, marketplace: string): string {
  if (c.kind === 'exact') return `${productsText(c.value)} ${c.value === 1 ? 'matches' : 'match'}: active, listed on ${marketplace}, with a price mismatch.`;
  if (c.kind === 'moreThan') return `More than ${count(BULK_PRICE_LIMIT)} products match.`;
  return `At most ${productsText(c.value)} match. Price mismatches cannot be counted within a search or category before the preview; the preview shows the exact number.`;
}

const ACTION_HINTS: Record<BulkActionType, (marketplace: string) => string> = {
  set_fixed: () => 'Every selected product gets this exact price.',
  increase_percent: m => `Starts from each product's current price on ${m}; the result is saved as a fixed price.`,
  decrease_percent: m => `Starts from each product's current price on ${m} (at most 90 % off); the result is saved as a fixed price.`,
  increase_amount: m => `Adds the amount to each product's current price on ${m}; the result is saved as a fixed price.`,
  decrease_amount: m => `Takes the amount off each product's current price on ${m}; the result is saved as a fixed price.`,
  match_marketplace: m => `Each product gets its current ${m} listing price as a fixed price. Products not listed on ${m} are blocked.`,
  match_erp: () => "Removes the product's own price rule: the price then follows the category, marketplace and default rules. The preview shows the real new price.",
};

const Stat: React.FC<{ label: string; value: number; testId: string }> = ({ label, value, testId }) => (
  <div className="rounded-xl border border-gray-200 bg-[#F8FBFA] p-3">
    <div className="text-[11px] text-gray-500">{label}</div>
    <div data-testid={testId} className="mt-0.5 text-xl font-bold text-gray-900">{count(value)}</div>
  </div>
);

const PreviewResult: React.FC<{ preview: BulkPreview; faded?: boolean }> = ({ preview: p, faded }) => {
  const name = marketplaceName(p.marketplaceId);
  const others = p.otherMarketplaces.filter(o => o.products > 0);
  return (
    <div role="region" aria-label="Preview" className={`space-y-5 ${faded ? 'opacity-60' : ''}`}>
      <div className="space-y-1">
        {/* The action in plain words, from what the server previewed (its defaults filled in). */}
        <h3 data-testid="preview-heading" className="text-sm font-bold text-gray-900">{actionText(p.action, name)}</h3>
        <p className="text-xs text-gray-600">
          Preview on <b>{name}</b>: {productsText(p.selected)} selected. Nothing has been changed yet.
        </p>
        {'filter' in p.selection && p.selection.filter.reconStatus === 'price_mismatch' && (
          <p data-testid="preview-mismatch-only" className="text-xs text-gray-600">
            Only products listed on {name} with a price mismatch against the {REFERENCE_LABELS[p.reference ?? 'marketplace']}, as of the last comparison.
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Selected" value={p.selected} testId="bulk-selected" />
        <Stat label="Will change" value={p.willChange} testId="bulk-will-change" />
        <Stat label="Already at this price" value={p.unchanged} testId="bulk-unchanged" />
        <Stat label="Blocked" value={p.blocked} testId="bulk-blocked" />
      </div>
      {p.willChange === 0 && (
        <p role="status" className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-700">Nothing to change: no selected product would get a new price.</p>
      )}

      {p.blockedReasons.length > 0 && (
        <section aria-label="Blocked products">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Blocked: left as they are</h3>
          <ul className="mt-2 text-xs text-gray-700 divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {p.blockedReasons.map(r => <li key={r.reason} className="flex justify-between gap-3 px-3 py-2"><span>{r.message}</span><b>{count(r.count)}</b></li>)}
          </ul>
        </section>
      )}

      {others.length > 0 && (
        <section aria-label="Other marketplaces" className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" aria-hidden />
          <div>
            <p><b>This also changes prices on other marketplaces.</b> A product&apos;s own price rule applies on every marketplace:</p>
            <ul className="mt-1 list-disc pl-4">
              {others.map(o => <li key={o.marketplaceId} data-testid="other-marketplace">Also changes {productsText(o.products)} on {marketplaceName(o.marketplaceId)}</li>)}
            </ul>
          </div>
        </section>
      )}

      {(p.largestIncrease || p.largestDecrease) && (
        <section aria-label="Largest changes" className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Largest changes</h3>
          <ul className="text-xs text-gray-700 space-y-1">
            {p.largestIncrease && <li data-testid="largest-increase"><b>Largest increase:</b> <Move row={p.largestIncrease} /></li>}
            {p.largestDecrease && <li data-testid="largest-decrease"><b>Largest decrease:</b> <Move row={p.largestDecrease} /></li>}
          </ul>
        </section>
      )}

      {p.rows.length > 0 && (
        <section aria-label="First products" className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">First {p.rows.length} of {productsText(p.willChange)}</h3>
          <div className="overflow-x-auto border border-gray-100 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider">
                <tr>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-right">Old price (QAR)</th>
                  <th className="px-3 py-2 text-right">New price (QAR)</th>
                  <th className="px-3 py-2 text-right">Change (QAR)</th>
                  <th className="px-3 py-2">New rule</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {p.rows.map(r => (
                  <tr key={r.productId} data-testid="bulk-row">
                    <td className="px-3 py-2"><div className="font-semibold text-gray-900">{r.nameEn || '—'}</div><div className="font-mono text-[11px] text-gray-500">{r.barcode}</div></td>
                    <td className="px-3 py-2 text-right whitespace-nowrap"><span className="font-mono">{priceText(r.oldPrice)}</span> <PriceSourceChip source={r.oldSource} /></td>
                    <td className="px-3 py-2 text-right whitespace-nowrap"><span className="font-mono">{priceText(r.newPrice)}</span> <PriceSourceChip source={r.newSource} /></td>
                    <td className="px-3 py-2 text-right font-mono">{signedPrice(r.difference)}</td>
                    <td className="px-3 py-2">
                      {r.rule ? ruleText(r.rule) : 'Product price rule removed'}
                      <span className="block text-[11px] text-gray-500">{r.previousRule ? `Was: ${ruleText(r.previousRule)}` : 'Had no product price rule'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

const Move: React.FC<{ row: BulkPriceRow }> = ({ row: r }) => (
  <span>{r.nameEn || r.barcode} <span className="font-mono">{priceText(r.oldPrice)} → {priceText(r.newPrice)}</span> QAR ({signedPrice(r.difference)})</span>
);

const Done: React.FC<{ result: BulkApplyResult; marketplace: string; onClose: () => void }> = ({ result: r, marketplace, onClose }) => (
  <div role="status" aria-label="Prices changed" className="space-y-3 text-center py-4">
    <CheckCircle2 className="w-8 h-8 text-[#027864] mx-auto" aria-hidden />
    <div className="text-base font-bold text-gray-900" data-testid="bulk-done">
      {r.replayed ? 'This change had already been applied' : r.willChange > 0 ? `Prices changed on ${productsText(r.willChange)}` : 'Nothing was changed'}
    </div>
    {r.replayed && <p className="text-xs text-gray-600">It was applied earlier from this same confirmation, so nothing was written again.</p>}
    <p className="text-xs text-gray-600" data-testid="bulk-done-counts">
      {count(r.created)} new price {r.created === 1 ? 'rule' : 'rules'}, {count(r.replaced)} replaced, {count(r.removed)} removed.
      {' '}{count(r.unchanged)} already at this price, {count(r.blocked)} blocked. Priced on {marketplace}.
    </p>
    <p className="text-xs text-gray-600">The comparison will refresh shortly; the dashboard and the price report update when it has run.</p>
    <button onClick={onClose} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F]">Done</button>
  </div>
);
