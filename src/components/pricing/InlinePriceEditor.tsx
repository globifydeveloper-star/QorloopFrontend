import React, { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { productsApi, type ProductDetail } from '../../api/products';
import {
  PRICING_MARKETPLACES, pricingApi,
  type InlinePriceMode, type InlinePriceRemoveQuery, type InlinePriceRequest, type InlinePricing, type PriceRule, type PricingMarketplaceId,
} from '../../api/pricing';
import { ErrorState, LoadingState } from '../common/States';
import { expectRecompute, marketplaceName, useReconSummary } from '../recon/shared';
import { productKey } from '../catalogue/shared';
import { Chain, FieldError, PriceSourceChip, inputCls, invalidatePriced, ruleText } from './shared';
import { changeErrors, isStale, priceText, readInlineValue } from './priceChange';

/**
 * The marketplaces a price can be set on: the store's enabled ones, which the comparison summary lists (one row per
 * enabled marketplace). Without the summary (no access, an error) every marketplace is offered and the server refuses
 * a disabled one in plain words.
 */
export function usePricingMarketplaces(): { ids: PricingMarketplaceId[]; state: 'loading' | 'known' | 'none' | 'unknown' } {
  const summary = useReconSummary();
  if (summary.isPending) return { ids: [], state: 'loading' };
  if (!summary.data) return { ids: [...PRICING_MARKETPLACES], state: 'unknown' };
  const ids = summary.data.marketplaces.map(m => m.marketplaceId);
  return ids.length ? { ids, state: 'known' } : { ids: [], state: 'none' };
}

/** "Talabat", "Talabat and Snoonu", "Talabat, Snoonu and Keeta". */
export function namesText(ids: readonly string[]): string {
  const names = ids.map(marketplaceName);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

interface Draft { mode: InlinePriceMode; value: string }
/** The editor starts from the product's own rule when it is a fixed price or a percent; otherwise empty, fixed. */
const draftFrom = (rule: PriceRule | null): Draft =>
  rule && (rule.mode === 'fixed' || rule.mode === 'percent') ? { mode: rule.mode, value: String(rule.value) } : { mode: 'fixed', value: '' };

/**
 * Inline price edit of one product, seen from one marketplace (PUT/DELETE /api/pricing/products/:id, pricing.edit):
 * a fixed price or a percent over the ERP price, saved as the product's own rule, so it applies on EVERY marketplace;
 * the screen says so before saving and lists the price on each enabled marketplace after.
 * Concurrency: sends the rule version it shows; a 409 reloads the product and shows the newer value.
 */
export const InlinePriceEditor: React.FC<{
  product: ProductDetail;
  /** Refetch the product (after a 409); resolves with the fresh copy. */
  onReload: () => Promise<ProductDetail | undefined>;
  /** In a list row nothing else explains the price: show the current rule chain too. */
  showChain?: boolean;
  onClose?: () => void;
  /** The marketplace selected at first (the one a mismatch row was seen on); ignored when it is not enabled. */
  initialMarketplace?: PricingMarketplaceId;
  /** Told whether the form holds a price that differs from the saved rule (the quick edit drawer asks before discarding it). */
  onDirtyChange?: (dirty: boolean) => void;
}> = ({ product: p, onReload, showChain, onClose, initialMarketplace, onDirtyChange }) => {
  const uid = useId();
  const qc = useQueryClient();
  const { showToast } = useApp();
  const markets = usePricingMarketplaces();
  const rule = p.pricing?.productRule ?? null;
  const [choice, setChoice] = useState<PricingMarketplaceId | undefined>(initialMarketplace);
  const mp = choice && markets.ids.includes(choice) ? choice : markets.ids[0];
  const [draft, setDraft] = useState<Draft>(() => draftFrom(rule));
  const saved = draftFrom(rule);
  const dirty = draft.value.trim() !== '' && (draft.mode !== saved.mode || draft.value.trim() !== saved.value);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const [local, setLocal] = useState<string>();
  const [done, setDone] = useState<{ kind: 'set' | 'removed'; result: InlinePricing }>();
  const [stale, setStale] = useState<'reloading' | 'reloaded'>();

  const settle = (kind: 'set' | 'removed', r: InlinePricing) => {
    setDone({ kind, result: r });
    setStale(undefined);
    // The rule version the next save sends, at once (the refetch below brings the rest of the product).
    qc.setQueryData<ProductDetail>(productKey(p.id), old => (old?.pricing ? { ...old, pricing: { ...old.pricing, productRule: r.rule } } : old));
    if (r.changed) {
      invalidatePriced(qc);
      expectRecompute(qc);
    }
    showToast(!r.changed ? 'Nothing changed' : kind === 'set' ? 'Price saved' : 'Product price rule removed', r.changed ? 'success' : 'info');
  };
  const failed = async (e: unknown) => {
    if (!isStale(e)) return;
    setDone(undefined);
    setStale('reloading');
    const fresh = await onReload().catch(() => undefined);
    setDraft(draftFrom(fresh?.pricing?.productRule ?? null));
    setLocal(undefined);
    setStale('reloaded');
  };
  const save = useMutation({
    mutationFn: (body: InlinePriceRequest) => pricingApi.setInlinePrice(p.id, body),
    onSuccess: r => settle('set', r),
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: (q: InlinePriceRemoveQuery) => pricingApi.removeInlinePrice(p.id, q),
    onSuccess: r => settle('removed', r),
    onError: failed,
  });
  const busy = save.isPending || remove.isPending || stale === 'reloading';
  const error = save.error ?? remove.error;
  const errors = isStale(error) ? { fields: {} as Record<string, string> } : changeErrors(error, ['value', 'marketplaceId']);

  const notActive = p.status !== 'active';
  const offerActive = p.marketplacePrice?.source === 'offer';
  const blocked = notActive || offerActive || !mp;
  const current = mp ? p.pricing?.marketplaces.find(m => m.marketplaceId === mp) ?? p.marketplacePrice : undefined;
  const name = mp ? marketplaceName(mp) : 'the marketplace';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || blocked || !mp) return;
    const read = readInlineValue(draft.mode, draft.value);
    setLocal(read.error);
    if (read.error !== undefined) return;
    remove.reset();
    setStale(undefined);
    save.mutate({ marketplaceId: mp, mode: draft.mode, value: read.value, expectedRuleUpdatedAt: rule?.updatedAt ?? null });
  };
  const removeRule = () => {
    if (busy || blocked || !rule || !mp) return;
    save.reset();
    setStale(undefined);
    remove.mutate({ marketplaceId: mp, expectedRuleUpdatedAt: rule.updatedAt });
  };
  const valueError = local ?? errors.fields.value;

  return (
    <div className="space-y-3">
      <form aria-label="Change the price" onSubmit={submit} className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">Change the price</h3>
            <p className="text-xs text-gray-500" data-testid="inline-current">
              {rule ? `Product price rule now: ${ruleText(rule)}.` : 'No product price rule now: the category, marketplace or default rule sets the price.'}
              {current && <> Price on {name} now: <span className="font-mono text-gray-800">{priceText(current.price)}</span> QAR.</>}
            </p>
          </div>
          {onClose && (
            <button type="button" onClick={onClose} disabled={busy} aria-label="Close the price editor" className="text-gray-400 hover:text-gray-600 disabled:opacity-40">
              <X className="w-4 h-4" aria-hidden />
            </button>
          )}
        </div>

        {stale && (
          <div role="alert" className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
            <b>Someone else changed this price after you opened it.</b> Your change was not saved.{' '}
            {stale === 'reloading' ? 'Loading the newer value…' : (
              <>The newer value is shown now: <b data-testid="inline-newer">{rule ? ruleText(rule) : 'no product price rule'}{current ? `, ${priceText(current.price)} QAR on ${name}` : ''}</b>. Check it, then save again if you still want your price.</>
            )}
          </div>
        )}

        <div role="note" aria-label="Applies to all marketplaces" className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600 mt-0.5" aria-hidden />
          <span>
            <b>This price applies to ALL marketplaces for this product</b>, not only {name}. It is saved as the product&apos;s own price rule,
            {markets.state === 'known' ? ` so ${namesText(markets.ids)} all use it.` : ' so every marketplace your store uses gets it.'}
          </span>
        </div>

        {notActive && <p role="note" className="text-xs text-gray-700">Only active products can be priced. Activate this product first.</p>}
        {offerActive && <p role="note" className="text-xs text-gray-700">A current offer sets this price, so a price set here would not show. Change or remove the offer first.</p>}
        {markets.state === 'none' && <p role="note" className="text-xs text-gray-700">No marketplace is enabled for this store yet, so there is nowhere to price this product.</p>}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor={`${uid}-mp`} className="block text-xs font-semibold text-gray-700">Marketplace</label>
            <select
              id={`${uid}-mp`} value={mp ?? ''} disabled={busy || markets.ids.length === 0} onChange={e => setChoice(e.target.value as PricingMarketplaceId)}
              aria-invalid={Boolean(errors.fields.marketplaceId)} aria-describedby={errors.fields.marketplaceId ? `${uid}-mp-err` : `${uid}-mp-hint`}
              className={`${inputCls(errors.fields.marketplaceId)} mt-1`}
            >
              {markets.state === 'loading' && <option value="">Loading marketplaces…</option>}
              {markets.ids.map(m => <option key={m} value={m}>{marketplaceName(m)}</option>)}
            </select>
            <p id={`${uid}-mp-hint`} className="mt-1 text-[11px] text-gray-500">The price is checked and shown for this marketplace.</p>
            <FieldError id={`${uid}-mp-err`} message={errors.fields.marketplaceId} />
          </div>
          <fieldset disabled={busy}>
            <legend className="block text-xs font-semibold text-gray-700">Set the price as</legend>
            <div className="mt-1.5 space-y-1 text-sm">
              {([['fixed', 'Fixed price'], ['percent', 'Percent over the ERP price']] as const).map(([m, label]) => (
                <label key={m} className="flex items-center gap-2">
                  <input type="radio" name={`${uid}-mode`} value={m} checked={draft.mode === m} onChange={() => { setDraft(d => ({ ...d, mode: m })); setLocal(undefined); }} className="accent-[#027864]" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={`${uid}-value`} className="block text-xs font-semibold text-gray-700">{draft.mode === 'fixed' ? 'New price (QAR)' : 'Percent over ERP price (%)'}</label>
            <input
              id={`${uid}-value`} type="number" inputMode="decimal" step="any" value={draft.value} disabled={busy}
              onChange={e => { setDraft(d => ({ ...d, value: e.target.value })); setLocal(undefined); }}
              aria-invalid={Boolean(valueError)} aria-describedby={valueError ? `${uid}-value-err` : `${uid}-value-hint`}
              className={`${inputCls(valueError)} mt-1 font-mono`}
            />
            <p id={`${uid}-value-hint`} className="mt-1 text-[11px] text-gray-500">
              {draft.mode === 'fixed'
                ? 'Used exactly as entered (up to 3 decimals).'
                : `ERP price ${priceText(p.erpPrice)} QAR. 10 means ERP price + 10 %, −10 means 10 % below. Rounded with your store's rounding.`}
            </p>
            <FieldError id={`${uid}-value-err`} message={valueError} />
          </div>
        </div>

        {errors.general && <p role="alert" className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">{errors.general}</p>}

        <div className="flex flex-wrap justify-end gap-2">
          {rule && (
            <button type="button" onClick={removeRule} disabled={busy || blocked} className="h-9 px-3 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">
              {remove.isPending ? 'Removing…' : 'Remove the product price rule'}
            </button>
          )}
          <button type="submit" disabled={busy || blocked} className="h-9 px-3 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
            {save.isPending ? 'Saving…' : 'Save price'}
          </button>
        </div>
      </form>

      {done ? <InlineResult kind={done.kind} result={done.result} /> : showChain && p.pricing && <Chain chain={p.pricing.chain} label="Current price rule chain" />}
    </div>
  );
};

/** What the server answered: the price on the marketplace before and after, on every enabled marketplace, and why. */
const InlineResult: React.FC<{ kind: 'set' | 'removed'; result: InlinePricing }> = ({ kind, result: r }) => {
  const name = marketplaceName(r.marketplaceId);
  const now = `${name}: ${priceText(r.resolved.price)} QAR`;
  const was = ` (was ${priceText(r.previous.price)} QAR).`;
  const headline = kind === 'set'
    ? (r.changed ? `Price saved. ${now}${was}` : `Nothing changed: the product already had this price rule. ${now}.`)
    : (r.changed ? `Product price rule removed. ${now}${was}` : `This product had no price rule of its own, so nothing changed. ${now}.`);
  return (
    <section aria-label="Price change result" aria-live="polite" className="space-y-3 rounded-lg border border-[#027864]/30 bg-[#F8FBFA] p-3">
      <p className="flex flex-wrap items-center gap-2 text-xs text-gray-800">
        <CheckCircle2 className="w-4 h-4 text-[#027864] shrink-0" aria-hidden />
        <span data-testid="inline-result">{headline}</span>
        <PriceSourceChip source={r.resolved.source} />
      </p>
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Price on each marketplace</h4>
        <ul aria-label="Price on each marketplace" className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-700">
          {r.marketplaces.map(m => (
            <li key={m.marketplaceId} data-testid="marketplace-price-row" className="inline-flex items-center gap-2">
              <b>{marketplaceName(m.marketplaceId)}</b><span className="font-mono">{priceText(m.price)}</span><span>QAR</span><PriceSourceChip source={m.source} />
            </li>
          ))}
        </ul>
      </div>
      <Chain chain={r.chain} label={`Price rule chain on ${name}`} />
    </section>
  );
};

/** The editor under a catalogue row: loads the product (its rule version, offer and chain) when it opens. */
export const RowPriceEditor: React.FC<{
  productId: string; onClose?: () => void; showChain?: boolean;
  initialMarketplace?: PricingMarketplaceId; onDirtyChange?: (dirty: boolean) => void;
}> = ({ productId, onClose, showChain = true, initialMarketplace, onDirtyChange }) => {
  const q = useQuery({ queryKey: productKey(productId), queryFn: ({ signal }) => productsApi.get(productId, signal), retry: false });
  if (q.isPending) return <LoadingState label="Loading the product's price…" rows={2} />;
  if (q.isError) return <ErrorState error={q.error} title="We could not load this product's price" onRetry={() => void q.refetch()} />;
  if (!q.data.pricing) return <p className="p-3 text-xs text-gray-600">You cannot see this product&apos;s pricing.</p>;
  return (
    <InlinePriceEditor
      product={q.data} onReload={async () => (await q.refetch()).data} showChain={showChain} onClose={onClose}
      initialMarketplace={initialMarketplace} onDirtyChange={onDirtyChange}
    />
  );
};
