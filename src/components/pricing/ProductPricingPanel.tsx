import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import type { ProductDetail } from '../../api/products';
import { pricingApi, type MarketplacePrice, type ProductPricing, type ProductPricingView } from '../../api/pricing';
import { fromQatarInput, money2, qatarDateTime, toQatarInput } from '../../lib/format';
import { marketplaceName } from '../recon/shared';
import { productKey } from '../catalogue/shared';
import { Chain, FieldError, OFFER_STATE_META, PriceSourceChip, fieldErrors, inputCls, pricingErrorText } from './shared';
import { InlinePriceEditor } from './InlinePriceEditor';

type Priced = ProductDetail & { marketplacePrice: MarketplacePrice; pricing: ProductPricing };

/**
 * The resolved marketplace price, the rule chain that explains it, the price editor (the product's own rule, via
 * /api/pricing/products/:id) and the offer (pricing.edit). The older rule form (/api/products/:id/price-rule) is gone.
 */
export const ProductPricingPanel: React.FC<{ product: Priced; onReload: () => Promise<ProductDetail | undefined> }> = ({ product: p, onReload }) => {
  const { can } = useAuth();
  const editable = can('pricing.edit');
  const qc = useQueryClient();
  /** Every rule/offer change answers with the new pricing view: write it into the product, refresh the lists and the comparison. */
  const store = (v: ProductPricingView) => {
    qc.setQueryData<ProductDetail>(productKey(p.id), old => old && { ...old, marketplacePrice: v.marketplacePrice, pricing: v.pricing });
    void qc.invalidateQueries({ queryKey: ['products', 'list'] });
    void qc.invalidateQueries({ queryKey: ['recon', 'summary'] });
    void qc.invalidateQueries({ queryKey: ['recon', 'rows'] });
    void qc.invalidateQueries({ queryKey: ['pricing', 'active-offers'] });
  };

  return (
    <section aria-label="Marketplace price" className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Marketplace price (QAR)</h2>
          <div className="mt-1 flex items-center gap-2">
            <span data-testid="marketplace-price" className="text-2xl font-bold font-mono text-gray-900">{money2(p.marketplacePrice.price)}</span>
            <PriceSourceChip source={p.marketplacePrice.source} />
          </div>
        </div>
        <div className="text-xs text-gray-500">ERP price (QAR) <span className="font-mono text-gray-800">{money2(p.erpPrice)}</span></div>
      </div>

      {p.pricing.marketplaces.length > 0 && (
        <ul aria-label="Per-marketplace prices" className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-700">
          {p.pricing.marketplaces.map(m => (
            <li key={m.marketplaceId} className="inline-flex items-center gap-2"><b>{marketplaceName(m.marketplaceId)}</b><span className="font-mono">{money2(m.price)}</span><PriceSourceChip source={m.source} /></li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="px-5 py-4 border-b border-gray-100">
          <InlinePriceEditor product={p} onReload={onReload} />
        </div>
      )}

      <Chain chain={p.pricing.chain} />

      {/* The product's own rule is changed with the price editor above; only the offer is edited here. */}
      <div className="border-t border-gray-100">
        {/* Remounted when the server copy changes, so a save replaces the draft. */}
        <OfferForm key={`offer:${p.pricing.offer?.updatedAt ?? 'none'}`} product={p} editable={editable} onSaved={store} />
      </div>
    </section>
  );
};

const OfferForm: React.FC<{ product: Priced; editable: boolean; onSaved: (v: ProductPricingView) => void }> = ({ product: p, editable, onSaved }) => {
  const { showToast } = useApp();
  const offer = p.pricing.offer;
  const [price, setPrice] = useState(offer ? String(offer.price) : '');
  const [from, setFrom] = useState(toQatarInput(offer?.validFrom));
  const [until, setUntil] = useState(toQatarInput(offer?.validUntil));
  const [local, setLocal] = useState<string>();
  const save = useMutation({
    mutationFn: () => pricingApi.setOffer(p.id, { price: Number(price), validFrom: fromQatarInput(from), validUntil: fromQatarInput(until) }),
    onSuccess: v => { onSaved(v); showToast('Offer saved', 'success'); },
  });
  const clear = useMutation({
    mutationFn: () => pricingApi.deleteOffer(p.id),
    onSuccess: v => { onSaved(v); showToast('Offer cleared', 'success'); },
  });
  const errors = fieldErrors(save.error, ['price', 'validFrom', 'validUntil']);
  const priceError = local ?? errors.fields.price;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(price.trim());
    const err = !price.trim() ? 'Enter a price' : !Number.isFinite(n) ? 'Enter a number' : undefined;
    setLocal(err);
    if (!err && !save.isPending) { clear.reset(); save.mutate(); }
  };
  const state = offer ? OFFER_STATE_META[offer.state] : undefined;

  return (
    <form aria-label="Offer" onSubmit={submit} className="p-5 space-y-3">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">Offer</h3>
        {offer && state ? (
          <p className="text-xs text-gray-600 flex flex-wrap items-center gap-1.5">
            <span data-testid="offer-state" className={`inline-flex items-center gap-1 font-semibold ${state.tone}`}><state.Icon className="w-3.5 h-3.5" aria-hidden />{state.label}</span>
            <span>{money2(offer.price)} QAR · {offer.validFrom ? `from ${qatarDateTime(offer.validFrom)}` : 'no start date'} · {offer.validUntil ? `until ${qatarDateTime(offer.validUntil)}` : 'no end date'}</span>
          </p>
        ) : <p className="text-xs text-gray-500">No offer. A running offer wins over every rule.</p>}
      </div>
      {editable && (
        <>
          {errors.general && <p role="alert" className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">{errors.general}</p>}
          {clear.isError && <p role="alert" className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">{pricingErrorText(clear.error)}</p>}
          <div>
            <label htmlFor="offer-price" className="block text-xs font-semibold text-gray-700">Offer price (QAR)</label>
            <input id="offer-price" type="number" inputMode="decimal" step="any" value={price} onChange={e => { setPrice(e.target.value); setLocal(undefined); }}
              aria-invalid={Boolean(priceError)} aria-describedby={priceError ? 'offer-price-err' : undefined} className={`${inputCls(priceError)} mt-1 font-mono`} />
            <FieldError id="offer-price-err" message={priceError} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="offer-from" className="block text-xs font-semibold text-gray-700">Starts (Qatar time, optional)</label>
              <input id="offer-from" type="datetime-local" value={from} onChange={e => setFrom(e.target.value)}
                aria-invalid={Boolean(errors.fields.validFrom)} aria-describedby={errors.fields.validFrom ? 'offer-from-err' : undefined} className={`${inputCls(errors.fields.validFrom)} mt-1`} />
              <FieldError id="offer-from-err" message={errors.fields.validFrom} />
            </div>
            <div>
              <label htmlFor="offer-until" className="block text-xs font-semibold text-gray-700">Ends (Qatar time, optional)</label>
              <input id="offer-until" type="datetime-local" value={until} onChange={e => setUntil(e.target.value)}
                aria-invalid={Boolean(errors.fields.validUntil)} aria-describedby={errors.fields.validUntil ? 'offer-until-err' : undefined} className={`${inputCls(errors.fields.validUntil)} mt-1`} />
              <FieldError id="offer-until-err" message={errors.fields.validUntil} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            {offer && (
              <button type="button" disabled={clear.isPending || save.isPending} onClick={() => { save.reset(); clear.mutate(); }} className="h-9 px-3 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">
                {clear.isPending ? 'Clearing…' : 'Clear offer'}
              </button>
            )}
            <button type="submit" disabled={save.isPending || clear.isPending} className="h-9 px-3 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
              {save.isPending ? 'Saving…' : offer ? 'Save offer' : 'Set offer'}
            </button>
          </div>
        </>
      )}
    </form>
  );
};
