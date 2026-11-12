import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { RefreshCw, Search, Upload } from 'lucide-react';
import { marketplaceListingsApi, type MarketplaceListingsFilter } from '../../api/marketplaceListings';
import type { ReconMarketplaceId } from '../../api/recon';
import { useAuth } from '../../auth/AuthContext';
import { useApp } from '../../context/AppContext';
import { pathFor } from '../../routes/paths';
import { money2 } from '../../lib/format';
import { EmptyState, ErrorState, LoadingState } from '../common/States';
import { marketplaceName, qatarDateTime } from '../recon/shared';
import { useDebounced } from './shared';
import { MarketplaceAvailabilityEditor } from './MarketplaceAvailabilityEditor';

/** Reads actual listings, including unmatched ones, independently of ERP imports and comparison runs. */
export const MarketplaceCatalogue: React.FC<{ marketplaceId: ReconMarketplaceId }> = ({ marketplaceId }) => {
  const { can } = useAuth();
  const { openUploadModal } = useApp();
  const name = marketplaceName(marketplaceId);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [availability, setAvailability] = useState<MarketplaceListingsFilter['availability']>('all');
  const [match, setMatch] = useState<MarketplaceListingsFilter['match']>('all');
  const filter = { marketplaceId, q, availability, match };
  const list = useInfiniteQuery({
    queryKey: ['products', 'marketplace-listings', filter],
    queryFn: ({ pageParam, signal }) => marketplaceListingsApi.list(filter, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextCursor ?? undefined,
    retry: false,
  });
  const items = list.data?.pages.flatMap(p => p.items) ?? [];
  const first = list.data?.pages[0];
  const filtered = Boolean(q || availability !== 'all' || match !== 'all');
  const upload = () => openUploadModal(marketplaceId);

  return <section aria-label={`${name} catalogue`} className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-gray-900">{name} catalogue</h2>
        <p className="text-xs text-gray-500">All listings from your applied {name} files, including products not matched to the master catalogue.</p>
        <p className="mt-1 text-[11px] text-gray-500">Availability changes apply to the next {name} export. Upload the generated file to update the marketplace.</p>
        {first?.latestUpload && <p className="mt-1 text-[11px] text-gray-500">Latest file: {first.latestUpload.fileName} · Applied {qatarDateTime(first.latestUpload.appliedAt)} (Qatar time)</p>}
      </div>
      <div className="flex items-center gap-2">
        {can('files.view') && <Link to={pathFor('outputs-generate')} className="inline-flex items-center h-9 px-3 rounded-lg border border-gray-300 bg-white text-xs font-semibold">Generate updated file</Link>}
        <button type="button" onClick={() => void list.refetch()} disabled={list.isFetching}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-300 bg-white text-xs font-semibold disabled:opacity-50">
          <RefreshCw className="w-3.5 h-3.5" aria-hidden /> Refresh
        </button>
        {can('uploads.upload') && <button type="button" onClick={upload}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-[#027864] text-white text-xs font-semibold hover:bg-[#02604F]">
          <Upload className="w-3.5 h-3.5" aria-hidden /> Upload {name} file
        </button>}
      </div>
    </div>
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex flex-wrap gap-3 p-4 border-b border-gray-100">
        <label className="relative flex-1 min-w-52">
          <span className="sr-only">Search {name} listings</span>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, barcode or marketplace ID"
            className="h-9 w-full pl-9 pr-3 text-xs rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#027864]/30" />
        </label>
        <label><span className="sr-only">Marketplace availability</span>
          <select value={availability} onChange={e => setAvailability(e.target.value as typeof availability)} className="h-9 px-3 text-xs rounded-lg border border-gray-300 bg-white">
            <option value="all">All availability</option><option value="available">Available</option><option value="unavailable">Unavailable</option>
          </select>
        </label>
        <label><span className="sr-only">Catalogue match</span>
          <select value={match} onChange={e => setMatch(e.target.value as typeof match)} className="h-9 px-3 text-xs rounded-lg border border-gray-300 bg-white">
            <option value="all">All listings</option><option value="matched">Matched to catalogue</option><option value="unmatched">Not in catalogue</option>
          </select>
        </label>
      </div>
      {list.isPending ? <LoadingState label={`Loading ${name} listings…`} rows={6} />
        : list.isError && !list.data ? <ErrorState error={list.error} title={`We could not load the ${name} catalogue`} onRetry={() => void list.refetch()} />
          : items.length === 0 ? <EmptyState title={filtered ? 'No listings match these filters' : `No ${name} listings yet`}
            hint={filtered ? 'Try another search, availability or catalogue match.' : `Upload and apply a ${name} file to view its products here.`} />
            : <div className="overflow-x-auto" aria-busy={list.isFetching}>
              <table className="w-full text-left text-xs" aria-label={`${name} product listings`}>
                <thead className="bg-[#F2F7F6] text-[10px] uppercase text-gray-500"><tr>
                  {['Product and barcodes', 'Marketplace ID', 'Price (QAR)', 'Availability to export', 'Master catalogue', 'Updated (Qatar time)'].map(label => <th key={label} scope="col" className="px-4 py-3">{label}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-gray-100">{items.map(item => <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 min-w-48"><div className="font-semibold text-gray-900">{item.name ?? item.product?.nameEn ?? 'Unnamed listing'}</div>
                    <div className="font-mono text-[11px] text-gray-500">{item.barcodes.join(', ') || 'No barcode'}</div>
                    {item.sourceFile && <div className="text-[11px] text-gray-500">From {item.sourceFile.fileName}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono">{item.marketplaceProductId}</td>
                  <td className="px-4 py-3 font-mono whitespace-nowrap">{money2(item.price)}</td>
                  <td className="px-4 py-3"><MarketplaceAvailabilityEditor item={item} marketplaceId={marketplaceId} canEdit={can('marketplace.values_edit')} refreshRequired={list.isRefetchError} /></td>
                  <td className="px-4 py-3">{item.product
                    ? <Link to={pathFor('product-detail', item.product.id)} className="font-semibold text-[#027864] hover:underline">{item.product.nameEn}</Link>
                    : <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">Not in catalogue</span>}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500">{qatarDateTime(item.updatedAt)}</td>
                </tr>)}</tbody>
              </table>
            </div>}
      {first && <div role="status" className="border-t border-gray-100 px-4 py-3 text-[11px] text-gray-500">{items.length.toLocaleString()} of {first.total.toLocaleString()} listings loaded</div>}
      {list.isError && list.data && <div role="alert" className="px-4 pb-3 text-xs text-red-700">
        We could not {list.isFetchNextPageError ? 'load more listings' : 'refresh the listings'}. <button type="button" className="underline font-semibold" onClick={() => void (list.isFetchNextPageError ? list.fetchNextPage() : list.refetch())}>Try again</button>
      </div>}
      {list.hasNextPage && !list.isFetchNextPageError && <div className="px-4 pb-4 text-center"><button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}
        className="h-9 px-4 rounded-lg border border-gray-300 bg-white text-xs font-semibold disabled:opacity-50">{list.isFetchingNextPage ? 'Loading…' : 'Load more'}</button></div>}
    </div>
  </section>;
};
