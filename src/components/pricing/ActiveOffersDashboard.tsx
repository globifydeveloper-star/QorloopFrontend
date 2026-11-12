import React from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { activeOffersApi } from '../../api/activeOffers';
import { pathFor } from '../../routes/paths';
import { money2, qatarDateTime } from '../../lib/format';

/** A current offer overrides the regular price on every enabled marketplace. */
export const ActiveOffersDashboard: React.FC = () => {
  const offers = useInfiniteQuery({
    queryKey: ['pricing', 'active-offers'],
    queryFn: ({ pageParam, signal }) => activeOffersApi.list(pageParam, 20, signal),
    initialPageParam: 1,
    getNextPageParam: last => last.page * last.limit < last.total ? last.page + 1 : undefined,
    refetchInterval: 60_000,
    retry: false,
  });
  const first = offers.data?.pages[0];
  const rows = offers.data?.pages.flatMap(p => p.items) ?? [];

  return (
    <section aria-label="Offers running now" className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Offers running now</h2>
          <p className="mt-1 text-xs text-gray-500">Current offers on active products. An offer price applies across marketplaces where the product is listed.</p>
        </div>
        {first && <span className="rounded-full bg-[#E8F5F1] px-3 py-1 text-xs font-semibold text-[#02604F]">{first.total} running</span>}
      </div>

      {offers.isPending ? <p role="status" className="mt-4 text-xs text-gray-500">Loading offers…</p>
        : offers.isError && !first ? (
          <p role="alert" className="mt-4 text-xs text-red-700">We could not load the offers. <button type="button" onClick={() => void offers.refetch()} className="font-semibold underline">Try again</button></p>
        ) : first?.total === 0 ? (
          <p className="mt-4 text-xs text-gray-500">No offers are running now.</p>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-gray-200 text-gray-500"><tr>
                  <th scope="col" className="py-2 pr-4">Product</th>
                  <th scope="col" className="py-2 pr-4 text-right">ERP price (QAR)</th>
                  <th scope="col" className="py-2 pr-4 text-right">Offer price (QAR)</th>
                  <th scope="col" className="py-2 pr-4">Started (Qatar time)</th>
                  <th scope="col" className="py-2">Ends (Qatar time)</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map(o => <tr key={o.productId}>
                    <td className="py-2 pr-4"><Link to={pathFor('product-detail', o.productId)} className="font-semibold text-[#027864] hover:underline">{o.nameEn}</Link><span className="block font-mono text-gray-500">{o.barcode}</span></td>
                    <td className="py-2 pr-4 text-right font-mono whitespace-nowrap">{money2(o.erpPrice)}</td>
                    <td className="py-2 pr-4 text-right font-mono font-semibold whitespace-nowrap">{money2(o.price)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{o.validFrom ? qatarDateTime(o.validFrom) : 'No start date'}</td>
                    <td className="py-2 whitespace-nowrap">{o.validUntil ? qatarDateTime(o.validUntil) : 'No end date'}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            {offers.isFetchNextPageError && <p role="alert" className="mt-3 text-xs text-red-700">We could not load more offers. <button type="button" onClick={() => void offers.fetchNextPage()} className="font-semibold underline">Try again</button></p>}
            {offers.hasNextPage && <button type="button" disabled={offers.isFetchingNextPage} onClick={() => void offers.fetchNextPage()} className="mt-4 rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 disabled:opacity-50">{offers.isFetchingNextPage ? 'Loading…' : `Show more (${rows.length} of ${first?.total ?? 0})`}</button>}
          </>
        )}
    </section>
  );
};
