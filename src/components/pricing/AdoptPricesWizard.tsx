import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import {
  ADOPT_SKIP_REASONS, PRICING_MARKETPLACES, pricingApi,
  type AdoptCounts, type AdoptMode, type AdoptPreview, type AdoptRequest, type AdoptRow, type AdoptSkipReason, type PricingMarketplaceId,
} from '../../api/pricing';
import { money2 } from '../../lib/format';
import { marketplaceName } from '../recon/shared';
import { ConfirmDialog } from '../uploads/shared';
import { PriceSourceChip, invalidatePriced, pricingErrorText, ruleText } from './shared';

/** Plain-language reason a product was not adopted (price-adoption.ts ADOPT_SKIP_REASONS). */
export const SKIP_LABELS: Record<AdoptSkipReason, (source: string) => string> = {
  no_listing: s => `Not listed on ${s}`,
  non_positive_erp_price: () => 'ERP price is zero or missing',
  non_positive_listing_price: s => `${s} price is zero`,
  has_rule: () => 'Already has its own price rule (kept as it is)',
  has_offer: () => 'Has an offer (kept as it is)',
  offer_active: () => 'An offer is running now, so a rule would not change the price',
  unchanged: () => 'Already priced this way',
  unverifiable: () => 'No rule can reproduce this price exactly',
};

const MODE_COPY: Record<AdoptMode, { label: string; hint: string }> = {
  fixed: { label: 'Fixed price', hint: 'Each product gets a fixed price equal to its current listing price.' },
  percent: {
    label: 'Percent of ERP price',
    hint: 'Each product gets a percent of its ERP price, so it follows future ERP price changes. When your rounding cannot reach the listing price, a fixed price is used instead.',
  },
};

type Step = 'choose' | 'preview' | 'done';

/** Adopt the source marketplace's current listing prices as product rules: choose, preview, confirm, apply. */
export const AdoptPricesWizard: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('choose');
  const [source, setSource] = useState<PricingMarketplaceId>('talabat');
  const [mode, setMode] = useState<AdoptMode>('fixed');
  const [confirming, setConfirming] = useState(false);
  // Earlier rules and offers are never overwritten from this wizard; the whole catalogue is in scope.
  const request: AdoptRequest = { sourceMarketplaceId: source, mode, onlyWithoutRule: true, scope: { all: true } };

  const preview = useMutation({ mutationFn: (body: AdoptRequest) => pricingApi.adoptPreview(body), onSuccess: () => setStep('preview') });
  const apply = useMutation({
    mutationFn: (body: AdoptRequest) => pricingApi.adoptApply(body),
    onSuccess: () => { setConfirming(false); setStep('done'); invalidatePriced(qc); },
    onError: () => setConfirming(false),
  });
  const busy = preview.isPending || apply.isPending;
  const close = () => { if (!apply.isPending) onClose(); };
  const name = marketplaceName(source);

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onKeyDown={e => e.key === 'Escape' && !confirming && close()}>
      <div role="dialog" aria-modal="true" aria-label="Adopt current marketplace prices" className="w-full max-w-4xl my-8 rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Adopt current marketplace prices</h2>
            <p className="text-xs text-gray-500">Create product price rules so the price your pricing rules give each product matches what a marketplace shows today.</p>
          </div>
          <button onClick={close} disabled={apply.isPending} aria-label="Close" className="text-gray-400 hover:text-gray-600 disabled:opacity-40"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {step === 'choose' && (
            <form aria-label="Choose source and mode" onSubmit={e => { e.preventDefault(); if (!busy) preview.mutate(request); }} className="space-y-5">
              <fieldset>
                <legend className="text-xs font-semibold text-gray-700">Source marketplace</legend>
                <div className="mt-2 flex flex-wrap gap-3">
                  {PRICING_MARKETPLACES.map(m => (
                    <label key={m} className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${source === m ? 'border-[#027864] bg-[#F2F7F6]' : 'border-gray-200'}`}>
                      <input type="radio" name="adopt-source" value={m} checked={source === m} onChange={() => setSource(m)} className="accent-[#027864]" />
                      {marketplaceName(m)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-xs font-semibold text-gray-700">Rule to create</legend>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(Object.keys(MODE_COPY) as AdoptMode[]).map(m => (
                    <label key={m} className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${mode === m ? 'border-[#027864] bg-[#F2F7F6]' : 'border-gray-200'}`}>
                      <input type="radio" name="adopt-mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-1 accent-[#027864]" />
                      <span><span className="block font-semibold text-gray-900">{MODE_COPY[m].label}</span><span className="block text-xs text-gray-500">{MODE_COPY[m].hint}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="text-xs text-gray-600">Products that already have their own price rule or an offer are skipped: earlier rules are not overwritten. The preview changes nothing.</p>
              {preview.isError && <p role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">We could not run the preview: {pricingErrorText(preview.error)}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={close} className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={busy} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
                  {preview.isPending ? 'Running preview…' : 'Run preview'}
                </button>
              </div>
            </form>
          )}

          {step === 'preview' && preview.data && (
            <>
              <PreviewResult preview={preview.data} />
              {apply.isPending && (
                <div role="status" aria-label="Adopting prices" className="space-y-2">
                  <div className="text-xs font-semibold text-gray-800">Adopting prices… This can take up to a minute for a large catalogue. Keep this window open.</div>
                  <div role="progressbar" aria-label="Adopting prices" className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full w-1/3 bg-[#027864] animate-pulse rounded-full" />
                  </div>
                </div>
              )}
              {apply.isError && <p role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">We could not adopt the prices: {pricingErrorText(apply.error)} Nothing was changed.</p>}
              <div className="flex justify-between gap-2">
                <button type="button" disabled={busy} onClick={() => { apply.reset(); setStep('choose'); }} className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">Back</button>
                {preview.data.willAdopt > 0 && (
                  <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
                    Adopt {preview.data.willAdopt} {preview.data.willAdopt === 1 ? 'price' : 'prices'}…
                  </button>
                )}
              </div>
            </>
          )}

          {step === 'done' && apply.data && <Done counts={apply.data} source={name} onClose={onClose} />}
        </div>
      </div>

      {confirming && preview.data && (
        <ConfirmDialog
          title="Create price rules"
          tone="primary"
          confirmLabel={`Create ${preview.data.willAdopt} ${preview.data.willAdopt === 1 ? 'rule' : 'rules'}`}
          busy={apply.isPending}
          onClose={() => !apply.isPending && setConfirming(false)}
          onConfirm={() => apply.mutate(request)}
        >
          <p>
            This creates <b>{preview.data.willAdopt}</b> product price {preview.data.willAdopt === 1 ? 'rule' : 'rules'} ({MODE_COPY[preview.data.mode].label.toLowerCase()})
            from {marketplaceName(preview.data.sourceMarketplaceId)}&apos;s current prices.
          </p>
          <p className="mt-2">Earlier rules are not overwritten: products with their own price rule or an offer keep them.</p>
          {preview.data.conflicts.products > 0 && (
            <p className="mt-2 text-amber-800">{preview.data.conflicts.products} of these products have a different price on another marketplace.</p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; testId?: string }> = ({ label, value, testId }) => (
  <div className="rounded-xl border border-gray-200 bg-[#F8FBFA] p-3">
    <div className="text-[11px] text-gray-500">{label}</div>
    <div data-testid={testId} className="mt-0.5 text-xl font-bold text-gray-900">{value}</div>
  </div>
);

const PreviewResult: React.FC<{ preview: AdoptPreview }> = ({ preview: p }) => {
  const name = marketplaceName(p.sourceMarketplaceId);
  const skipped = ADOPT_SKIP_REASONS.filter(r => p.skipped[r] > 0);
  const others = Object.entries(p.conflicts.byMarketplace).filter(([, n]) => (n ?? 0) > 0);

  return (
    <div aria-label="Preview" role="region" className="space-y-5">
      <p className="text-xs text-gray-600">Preview for <b>{name}</b>, {MODE_COPY[p.mode].label.toLowerCase()}. Nothing has been changed yet.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Products checked" value={p.products} testId="preview-products" />
        <Stat label="Rules to create" value={p.willAdopt} testId="preview-will-adopt" />
        <Stat label="Skipped" value={ADOPT_SKIP_REASONS.reduce((n, r) => n + p.skipped[r], 0)} testId="preview-skipped" />
        <Stat label="Price differs elsewhere" value={p.conflicts.products} testId="preview-conflicts" />
      </div>
      {p.mode === 'percent' && p.fixedFallback > 0 && (
        <p className="text-xs text-gray-600" data-testid="preview-fallbacks">
          {p.fixedFallback} {p.fixedFallback === 1 ? 'product gets' : 'products get'} a fixed price instead of a percent
          ({p.fallbacks.rounding} because the rounding cannot reach the price, {p.fallbacks.range} because the percent would be outside −90 % to +1000 %).
        </p>
      )}
      {p.willAdopt === 0 && (
        <p role="status" className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-700">Nothing to adopt: no product would get a new rule from {name}&apos;s prices.</p>
      )}

      {skipped.length > 0 && (
        <section aria-label="Skipped products">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Skipped</h3>
          <ul className="mt-2 text-xs text-gray-700 divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {skipped.map(r => (
              <li key={r} className="flex justify-between px-3 py-2"><span>{SKIP_LABELS[r](name)}</span><b>{p.skipped[r]}</b></li>
            ))}
          </ul>
        </section>
      )}

      {p.conflicts.products > 0 && (
        <section aria-label="Price differs on other marketplaces" className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Price differs on other marketplaces</h3>
          <p className="flex items-start gap-2 text-xs text-amber-900">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" aria-hidden />
            <span>
              {p.conflicts.products} adopted {p.conflicts.products === 1 ? 'product is' : 'products are'} listed at a different price elsewhere
              {others.length > 0 && <> ({others.map(([m, n]) => `${marketplaceName(m)} ${n}`).join(', ')})</>}. Those marketplaces will show a price mismatch.
              {p.conflicts.examples.length > 0 && ` First ${p.conflicts.examples.length} shown.`}
            </span>
          </p>
          {p.conflicts.examples.length > 0 && (
            <Table head={['Product', 'Marketplace', `${name} price (QAR)`, 'Other price (QAR)']}>
              {p.conflicts.examples.map(c => (
                <tr key={`${c.productId}:${c.marketplaceId}`}>
                  <ProductCell nameEn={c.nameEn} barcode={c.barcode} />
                  <td className="px-3 py-2">{marketplaceName(c.marketplaceId)}</td>
                  <td className="px-3 py-2 text-right font-mono">{money2(c.sourcePrice)}</td>
                  <td className="px-3 py-2 text-right font-mono">{money2(c.otherPrice)}</td>
                </tr>
              ))}
            </Table>
          )}
        </section>
      )}

      {p.largestDifferences.length > 0 && (
        <section aria-label="Largest changes" className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Largest changes</h3>
          <AdoptRows rows={p.largestDifferences} />
        </section>
      )}
      {p.rows.length > 0 && (
        <section aria-label="First products" className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">First products</h3>
          <AdoptRows rows={p.rows} />
        </section>
      )}
    </div>
  );
};

const Table: React.FC<{ head: string[]; children: React.ReactNode }> = ({ head, children }) => (
  <div className="overflow-x-auto border border-gray-100 rounded-lg">
    <table className="w-full text-left text-xs">
      <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider">
        <tr>{head.map((h, i) => <th key={h} className={`px-3 py-2 ${i > 0 && h.endsWith('(QAR)') ? 'text-right' : ''}`}>{h}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-gray-100 text-gray-700">{children}</tbody>
    </table>
  </div>
);

const ProductCell: React.FC<{ nameEn: string; barcode: string }> = ({ nameEn, barcode }) => (
  <td className="px-3 py-2"><div className="font-semibold text-gray-900">{nameEn || '—'}</div><div className="font-mono text-[11px] text-gray-500">{barcode}</div></td>
);

const AdoptRows: React.FC<{ rows: AdoptRow[] }> = ({ rows }) => (
  <Table head={['Product', 'ERP price (QAR)', 'Current price (QAR)', 'New price (QAR)', 'Change (QAR)', 'New rule']}>
    {rows.map(r => (
      <tr key={r.productId} data-testid="adopt-row">
        <ProductCell nameEn={r.nameEn} barcode={r.barcode} />
        <td className="px-3 py-2 text-right font-mono">{money2(r.erpPrice)}</td>
        <td className="px-3 py-2 text-right"><span className="font-mono">{money2(r.currentPrice)}</span> <PriceSourceChip source={r.currentSource} /></td>
        <td className="px-3 py-2 text-right font-mono">{money2(r.newPrice)}</td>
        <td className="px-3 py-2 text-right font-mono" data-testid="adopt-difference">{r.difference > 0 ? '+' : r.difference < 0 ? '−' : ''}{money2(Math.abs(r.difference))}</td>
        <td className="px-3 py-2">{ruleText(r.rule)}{r.fallback && <span className="block text-[11px] text-gray-500">Fixed instead of percent ({r.fallback === 'rounding' ? 'rounding' : 'out of range'})</span>}</td>
      </tr>
    ))}
  </Table>
);

const Done: React.FC<{ counts: AdoptCounts; source: string; onClose: () => void }> = ({ counts: c, source, onClose }) => (
  <div role="status" aria-label="Prices adopted" className="space-y-3 text-center py-4">
    <CheckCircle2 className="w-8 h-8 text-[#027864] mx-auto" aria-hidden />
    <div className="text-base font-bold text-gray-900">
      {c.adopted > 0 ? `${c.adopted} price ${c.adopted === 1 ? 'rule' : 'rules'} created from ${source}` : 'Nothing was adopted: the prices already match'}
    </div>
    {c.adopted > 0 && <p className="text-xs text-gray-600">{c.created} new {c.created === 1 ? 'rule' : 'rules'}{c.replaced ? `, ${c.replaced} replaced` : ''}; earlier rules were kept.</p>}
    <p className="text-xs text-gray-600">The reconciliation will refresh shortly; the dashboard and reports update when it has run.</p>
    <button onClick={onClose} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F]">Done</button>
  </div>
);
