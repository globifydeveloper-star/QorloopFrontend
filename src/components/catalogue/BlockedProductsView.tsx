import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { PRODUCT_BLOCK_REASON_LABELS, type ProductItem } from '../../api/products';
import { pathFor } from '../../routes/paths';
import { qatarDateTime } from '../../lib/format';
import { EmptyState, ErrorState, LoadingState } from '../common/States';
import { useDebounced, useProductList, type ProductFilter } from './shared';
import { BLOCK_EXPLAINED, BLOCK_PERMISSION, UnblockDialog, productsText, type BlockTarget } from './blocking';

const NONE: ReadonlySet<string> = new Set();

/** A 400 about `blocked`: a backend without blocking (its strict query rejects the key). */
const unsupported = (e: unknown) =>
  e instanceof ApiError && e.status === 400 && (/blocked/i.test(e.message) || e.details.some(d => /blocked/i.test(`${d.path ?? ''} ${d.message}`)));

/**
 * The Blocked tab: GET /api/products?blocked=only with the same search as the catalogue. Name, barcode, reason, when and
 * by whom; Unblock one or the ticked rows (products.block).
 */
export const BlockedProductsView: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { can } = useAuth();
  const canUnblock = can(BLOCK_PERMISSION);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const filter = useMemo<ProductFilter>(() => ({ q, tab: 'all', blocked: 'only' }), [q]);
  const list = useProductList(filter);
  // The backend sends only blocked products here; anything else is not this tab's.
  const items: ProductItem[] = (list.data?.pages.flatMap(p => p.items) ?? []).filter(p => p.isBlocked !== false);
  const [tick, setTick] = useState<{ q: string; ids: ReadonlySet<string> }>({ q, ids: new Set() });
  const ticked = tick.q === q ? tick.ids : NONE;
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(ticked);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    setTick({ q, ids: next });
  };
  const allTicked = items.length > 0 && items.every(p => ticked.has(p.id));
  const [unblocking, setUnblocking] = useState<BlockTarget[] | null>(null);
  const total = list.data?.pages[0]?.counts.blocked ?? list.data?.pages[0]?.counts.all;

  return (
    <section aria-label="Blocked products" className={embedded ? '' : 'bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden'}>
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        {!embedded && <h2 className="text-sm font-bold text-gray-900">Blocked products</h2>}
        <p className="text-xs text-gray-500 mt-0.5">{BLOCK_EXPLAINED}</p>
      </div>
      <div className="p-4 border-b border-gray-100">
        <label className="relative block">
          <span className="sr-only">Search blocked products</span>
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by English name, barcode or SKU"
            className="w-full h-9 pl-9 pr-3 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#027864]/30"
          />
        </label>
      </div>
      {canUnblock && items.length > 0 && (
        <div role="toolbar" aria-label="Unblock" className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-gray-100 bg-[#F8FBFA] text-xs text-gray-600">
          <span data-testid="blocked-ticked-count">{ticked.size > 0 ? `${productsText(ticked.size)} ticked` : 'Tick rows to unblock them together.'}</span>
          <span className="flex items-center gap-2">
            {ticked.size > 0 && (
              <button type="button" onClick={() => setTick({ q, ids: new Set() })} className="h-8 px-3 rounded-lg font-semibold border border-gray-300 bg-white hover:bg-gray-50">Clear ticks</button>
            )}
            <button
              type="button" disabled={ticked.size === 0} onClick={() => setUnblocking(items.filter(p => ticked.has(p.id)))}
              className="h-8 px-3 rounded-lg font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50"
            >
              {ticked.size > 0 ? `Unblock ${productsText(ticked.size)}…` : 'Unblock…'}
            </button>
          </span>
        </div>
      )}

      {list.isPending ? (
        <LoadingState label="Loading blocked products…" rows={5} />
      ) : list.isError && !list.data ? (
        unsupported(list.error)
          ? <EmptyState title="Blocking is not available yet" hint="This server cannot block products yet." />
          : <ErrorState error={list.error} title="We could not load the blocked products" onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={q ? 'No blocked products match this search' : 'No blocked products'}
          hint={q ? 'Try another name, barcode or SKU.' : 'Block old or seasonal products from the Catalogue tab to leave them out of every check.'}
        />
      ) : (
        <div className="overflow-x-auto" aria-busy={list.isFetching}>
          <table aria-label="Blocked products" className={`w-full text-left text-xs ${list.isPlaceholderData ? 'opacity-60' : ''}`}>
            <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider border-b border-gray-100">
              <tr>
                {canUnblock && (
                  <th className="pl-4 py-3 w-8">
                    <input type="checkbox" aria-label="Tick every blocked row shown" checked={allTicked} onChange={e => toggle(items.map(p => p.id), e.target.checked)} className="accent-[#027864]" />
                  </th>
                )}
                <th scope="col" className="px-4 py-3">Name</th>
                <th scope="col" className="px-4 py-3">Barcode</th>
                <th scope="col" className="px-4 py-3">Reason</th>
                <th scope="col" className="px-4 py-3">Blocked on (Qatar time)</th>
                <th scope="col" className="px-4 py-3">Blocked by</th>
                {canUnblock && <th className="px-4 py-3"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-700">
              {items.map(p => (
                <tr key={p.id} className={ticked.has(p.id) ? 'bg-[#F2F7F6]' : 'hover:bg-gray-50'}>
                  {canUnblock && (
                    <td className="pl-4 py-3">
                      <input type="checkbox" aria-label={`Tick ${p.nameEn}`} checked={ticked.has(p.id)} onChange={e => toggle([p.id], e.target.checked)} className="accent-[#027864]" />
                    </td>
                  )}
                  <td className="px-4 py-3 min-w-[200px]">
                    <Link to={pathFor('product-detail', p.id)} className="font-semibold text-gray-900 hover:text-[#027864] hover:underline">{p.nameEn}</Link>
                    {p.nameAr && <div dir="rtl" lang="ar" className="text-[11px] text-gray-500 text-left">{p.nameAr}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-gray-900 whitespace-nowrap">{p.barcode}</td>
                  <td className="px-4 py-3 whitespace-nowrap" data-testid="blocked-reason">{p.blockedReason ? PRODUCT_BLOCK_REASON_LABELS[p.blockedReason] ?? p.blockedReason : '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap" data-testid="blocked-at">{qatarDateTime(p.blockedAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap" data-testid="blocked-by">{p.blockedBy?.name ?? '—'}</td>
                  {canUnblock && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button type="button" onClick={() => setUnblocking([p])} aria-label={`Unblock ${p.nameEn}`} className="font-semibold text-[#027864] hover:underline">Unblock</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.data && total !== undefined && (
        <div role="status" className="border-t border-gray-100 px-4 py-3 text-[11px] text-gray-500">{`${items.length.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} blocked products loaded`}</div>
      )}
      {list.isFetchNextPageError && (
        <div role="alert" className="px-4 py-3 text-xs text-red-700 border-t border-gray-100 flex items-center gap-3">
          We could not load more blocked products.
          <button onClick={() => void list.fetchNextPage()} className="font-semibold underline">Try again</button>
        </div>
      )}
      {list.hasNextPage && !list.isFetchNextPageError && (
        <div className="p-4 border-t border-gray-100 text-center">
          <button onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">
            {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {unblocking && (
        <UnblockDialog products={unblocking} onClose={() => setUnblocking(null)} onUnblocked={() => setTick({ q, ids: new Set() })} />
      )}
    </section>
  );
};
