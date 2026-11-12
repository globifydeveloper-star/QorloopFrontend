import React, { useEffect, useId, useState } from 'react';
import { useIsMutating, useMutation, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ApiError } from '../../api/client';
import { friendlyError } from '../../api/errors';
import { marketplaceAvailabilityApi, type MarketplaceAvailabilityState, type MarketplaceListing, type MarketplaceListingsFilter, type MarketplaceListingsPage } from '../../api/marketplaceListings';
import { MarketplaceAvailability, marketplaceName } from '../recon/shared';

const LIST_KEY = ['products', 'marketplace-listings'] as const;
type Pages = InfiniteData<MarketplaceListingsPage>;
type Change = { kind: 'set'; value: boolean; persistent: boolean } | { kind: 'reset' };

/** A catalogue product may have several listings; its adjustment applies to all of them on this marketplace. */
function patch(qc: QueryClient, marketplaceId: string, productId: string, update: (state: MarketplaceAvailabilityState) => MarketplaceAvailabilityState) {
  qc.setQueriesData<Pages>({ queryKey: LIST_KEY, predicate: query => (query.queryKey[2] as MarketplaceListingsFilter)?.marketplaceId === marketplaceId }, data => data && ({
    ...data, pages: data.pages.map(page => ({ ...page, items: page.items.map(item => item.product?.id === productId && item.availabilityAdjustment
      ? { ...item, availabilityAdjustment: update(item.availabilityAdjustment) } : item) })),
  }));
}

export const MarketplaceAvailabilityEditor: React.FC<{
  item: MarketplaceListing; marketplaceId: string; canEdit: boolean; refreshRequired?: boolean;
}> = ({ item, marketplaceId, canEdit, refreshRequired }) => {
  const uid = useId();
  const qc = useQueryClient();
  const state = item.availabilityAdjustment;
  const name = marketplaceName(marketplaceId);
  const label = item.name ?? item.product?.nameEn ?? item.marketplaceProductId;
  const productId = item.product?.id ?? '';
  const mutationKey = ['marketplace-availability', marketplaceId, productId];
  const busy = useIsMutating({ mutationKey }) > 0;
  const [keep, setKeep] = useState(state?.override?.persistent ?? false);
  const pinned = state?.override?.persistent ?? false;
  useEffect(() => { setKeep(pinned); }, [pinned]);
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({
    mutationKey,
    mutationFn: (change: Change) => change.kind === 'set'
      ? marketplaceAvailabilityApi.set(marketplaceId, productId, change.value, change.persistent, state!.version)
      : marketplaceAvailabilityApi.reset(marketplaceId, productId, state!.version),
    onMutate: async change => {
      setSaved(false);
      await qc.cancelQueries({ queryKey: LIST_KEY, predicate: query => (query.queryKey[2] as MarketplaceListingsFilter)?.marketplaceId === marketplaceId });
      const before = new Map(qc.getQueriesData<Pages>({ queryKey: LIST_KEY }).flatMap(([key, data]) => {
        const found = (key[2] as MarketplaceListingsFilter)?.marketplaceId === marketplaceId
          ? data?.pages.flatMap(p => p.items).find(i => i.product?.id === productId)?.availabilityAdjustment : null;
        return found ? [[JSON.stringify(key), found] as const] : [];
      }));
      patch(qc, marketplaceId, productId, current => ({ ...current, override: change.kind === 'reset' ? null : { value: change.value, persistent: change.persistent } }));
      return { before };
    },
    onError: async (error, _change, context) => {
      // Restore only this product, so another row's successful save is never rolled back with it.
      for (const [key, previous] of context?.before ?? []) {
        qc.setQueryData<Pages>(JSON.parse(key), data => data && ({ ...data, pages: data.pages.map(p => ({ ...p, items: p.items.map(i => i.product?.id === productId ? { ...i, availabilityAdjustment: previous } : i) })) }));
      }
      setKeep(context?.before.values().next().value?.override?.persistent ?? false);
      if (error instanceof ApiError && error.status === 409) await qc.invalidateQueries({ queryKey: LIST_KEY });
    },
    onSuccess: async (result, change) => {
      if (result.item) {
        const av = result.item.values.availability;
        patch(qc, marketplaceId, productId, current => ({ ...current, version: result.item!.version, override: av?.state === 'pending' ? { value: av.value, persistent: av.persistent } : null }));
      } else {
        // A newly uploaded product may not have a stored comparison yet. Read the saved version from the listings API.
        await qc.invalidateQueries({ queryKey: LIST_KEY });
      }
      if (change.kind === 'reset') setKeep(false);
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ['recon'] });
      void qc.invalidateQueries({ queryKey: ['activity'] });
      void qc.invalidateQueries({ queryKey: ['products', 'detail', productId] });
    },
  });
  const available = state?.override?.value ?? state?.catalogueAvailable ?? item.available;
  const reason = !item.product ? 'Match this listing to a catalogue product first.' : !state ? 'Refresh the listings to load availability controls.'
    : refreshRequired ? 'Refresh the listings before making another change.' : state.blockedReason;
  const change = (request: Change) => {
    if (!canEdit || !state || !productId || qc.isMutating({ mutationKey }) > 0 || refreshRequired || (request.kind === 'set' && reason)) return;
    mutation.mutate(request);
  };
  const error = mutation.error instanceof ApiError && mutation.error.status === 409
    ? 'Someone changed this marketplace adjustment. Check the refreshed values and try again.'
    : mutation.error instanceof ApiError && mutation.error.details.length ? mutation.error.details.map(d => d.message).join(' ')
      : mutation.error ? `${friendlyError(mutation.error).title}. ${friendlyError(mutation.error).message}` : null;

  return <div className="min-w-60 space-y-2" aria-busy={busy}>
    <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px]" data-testid="marketplace-current-availability">
      {name} now: <MarketplaceAvailability value={item.available} />
    </span>
    {canEdit ? <>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-gray-700">
          <input type="checkbox" role="switch" checked={available} disabled={busy || Boolean(reason)}
            aria-label={`Available / Unavailable for ${label} on ${name}`} aria-describedby={reason ? `${uid}-reason` : error ? `${uid}-error` : `${uid}-hint`}
            onChange={e => change({ kind: 'set', value: e.target.checked, persistent: keep })} className="peer sr-only" />
          <span aria-hidden className="inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-gray-300 p-0.5 peer-checked:bg-[#027864] peer-focus-visible:ring-2 peer-focus-visible:ring-[#027864] peer-focus-visible:ring-offset-2 peer-disabled:opacity-50 peer-checked:[&>span]:translate-x-4">
            <span className="h-4 w-4 rounded-full bg-white transition-transform motion-reduce:transition-none" />
          </span>
          Available / Unavailable: {available ? 'Available' : 'Unavailable'}
        </label>
        <button type="button" disabled={busy || !state?.override || refreshRequired} onClick={() => change({ kind: 'reset' })}
          className="text-[11px] font-semibold text-[#027864] hover:underline disabled:opacity-50">Use catalogue value</button>
      </div>
      <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
        <input type="checkbox" checked={keep} disabled={busy || Boolean(reason)} aria-describedby={`${uid}-hint`}
          onChange={e => {
            const next = e.target.checked;
            setKeep(next);
            if (state?.override) change({ kind: 'set', value: state.override.value, persistent: next });
          }} className="accent-[#027864]" /> Keep until I remove it
      </label>
      <span id={`${uid}-hint`} className="sr-only">Changes only the {name} export. Without Keep, a later matching marketplace upload clears the adjustment.</span>
      {reason && <p id={`${uid}-reason`} className="text-[11px] text-amber-800">{reason}</p>}
    </> : <p className="text-[11px] text-gray-600">To export: {available ? 'Available' : 'Unavailable'}{state?.override ? ' (adjusted)' : ''}</p>}
    <p role="status" aria-live="polite" className="text-[11px] text-gray-500">
      {busy ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Saving…</span>
        : saved ? `Saved for ${name} export${state?.override?.persistent ? ' · Pinned' : ''}` : state?.override ? reason ? 'Adjustment currently blocked' : state.override.persistent ? 'Pinned for export' : 'Adjusted for export' : ''}
    </p>
    {error && <p role="alert" id={`${uid}-error`} className="text-[11px] text-red-700">{error}</p>}
  </div>;
};
