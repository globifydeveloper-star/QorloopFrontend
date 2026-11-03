import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderTree, Search, Sparkles, Upload } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import { PRODUCT_TABS, type ProductTab } from '../../api/products';
import { indexCategories, type Category } from '../../api/categories';
import { pathFor } from '../../routes/paths';
import { EmptyState, ErrorState, LoadingState } from '../common/States';
import { ProductStatusPill, qar, useCategoryTree, useDebounced, useProductList } from './shared';
import { realPricingEnabled } from '../../lib/features';
import { money2 } from '../../lib/format';
import { PriceSourceChip } from '../pricing/shared';
import { RowPriceEditor } from '../pricing/InlinePriceEditor';
import { BulkPriceChangeDialog } from '../pricing/BulkPriceChangeDialog';

const TAB_LABELS: Record<ProductTab, string> = {
  all: 'All', active: 'Active', inactive: 'Inactive', new: 'New', missing: 'Missing from ERP',
};
const NONE: ReadonlySet<string> = new Set();

/** 'Search "milk" · Dairy › Milk', or '' when the list is not filtered (the status tab is left out on purpose). */
function describeFilter(q: string, categoryId: string | undefined, subcategoryId: string | undefined, names: Map<string, Category>): string {
  const sub = subcategoryId ? names.get(subcategoryId) : undefined;
  const cat = categoryId ? names.get(categoryId) : sub?.parentId ? names.get(sub.parentId) : undefined;
  const where = sub ? `${cat?.nameEn ?? 'Category'} › ${sub.nameEn}` : cat ? cat.nameEn : subcategoryId || categoryId ? 'the chosen category' : '';
  return [q ? `Search "${q}"` : '', where].filter(Boolean).join(' · ');
}

/** CAT-001: the catalogue from GET /api/products, with per-tab counts from the backend. */
export const RealCatalogueView: React.FC = () => {
  const { openUploadModal } = useApp();
  const { can } = useAuth();
  const [tab, setTab] = useState<ProductTab>('all');
  const [search, setSearch] = useState('');
  // "" = all; "c:<id>" = a category; "s:<id>" = a subcategory
  const [category, setCategory] = useState('');
  const q = useDebounced(search.trim());

  const filter = useMemo(() => ({
    q, tab,
    categoryId: category.startsWith('c:') ? category.slice(2) : undefined,
    subcategoryId: category.startsWith('s:') ? category.slice(2) : undefined,
  }), [q, tab, category]);
  const list = useProductList(filter);
  const tree = useCategoryTree();
  const names = useMemo(() => indexCategories(tree.data), [tree.data]);

  const items = list.data?.pages.flatMap(p => p.items) ?? [];
  const counts = list.data?.pages[0]?.counts;
  const filtered = Boolean(q || category);
  // The backend adds marketplacePrice only for pricing.view.
  const showPrice = realPricingEnabled() && can('pricing.view');
  // Inline price edit (pricing.edit): one row's editor open at a time, under the row.
  const canEditPrice = showPrice && can('pricing.edit');
  const [editing, setEditing] = useState<string | null>(null);
  // Bulk price change (pricing.bulk): ticked rows belong to the filter they were ticked under.
  const canBulk = showPrice && can('pricing.bulk');
  const filterKey = JSON.stringify(filter);
  const [tick, setTick] = useState<{ key: string; ids: ReadonlySet<string> }>({ key: filterKey, ids: new Set() });
  const ticked = tick.key === filterKey ? tick.ids : NONE;
  const toggle = (ids: string[], on: boolean) => setTick(() => {
    const next = new Set(ticked);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    return { key: filterKey, ids: next };
  });
  const allTicked = items.length > 0 && items.every(p => ticked.has(p.id));
  const [bulkOpen, setBulkOpen] = useState(false);
  const bulkFilter = { q: filter.q || undefined, categoryId: filter.categoryId, subcategoryId: filter.subcategoryId };
  const filterSummary = describeFilter(filter.q, filter.categoryId, filter.subcategoryId, names);
  const columns = 6 + (showPrice ? 1 : 0) + (canEditPrice ? 1 : 0) + (canBulk ? 1 : 0);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Catalogue</h1>
          <p className="text-xs text-gray-500 mt-0.5">All products in your Qorloop catalogue. Keep Arabic names, categories and status up to date.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to={pathFor('categories')} className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            <FolderTree className="w-3.5 h-3.5 text-gray-500" /> Categories
          </Link>
          <Link to={pathFor('new-products')} className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            <Sparkles className="w-3.5 h-3.5 text-gray-500" /> New products
          </Link>
          {can('uploads.upload') && (
            <button onClick={() => openUploadModal('erp')} className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg">
              <Upload className="w-3.5 h-3.5" /> Import from ERP
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div role="tablist" aria-label="Product status" className="flex flex-wrap gap-1 px-4 pt-3 border-b border-gray-100">
          {PRODUCT_TABS.map(t => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${tab === t ? 'border-[#027864] text-[#027864]' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
            >
              {TAB_LABELS[t]}{counts ? ` (${counts[t]})` : ''}
            </button>
          ))}
        </div>

        <div className="flex flex-col md:flex-row gap-3 p-4 border-b border-gray-100">
          <label className="relative flex-1">
            <span className="sr-only">Search products</span>
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by English name, barcode or SKU"
              className="w-full h-9 pl-9 pr-3 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#027864]/30"
            />
          </label>
          <label className="md:w-64">
            <span className="sr-only">Category</span>
            <select value={category} onChange={e => setCategory(e.target.value)} className="w-full h-9 px-2 text-xs border border-gray-300 rounded-lg bg-white">
              <option value="">All categories</option>
              {(tree.data ?? []).map(c => (
                <React.Fragment key={c.id}>
                  <option value={`c:${c.id}`}>{c.nameEn}</option>
                  {c.children.map(s => <option key={s.id} value={`s:${s.id}`}>{`   ${c.nameEn} › ${s.nameEn}`}</option>)}
                </React.Fragment>
              ))}
            </select>
          </label>
        </div>

        {canBulk && (
          <div role="toolbar" aria-label="Bulk price change" className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-gray-100 bg-[#F8FBFA] text-xs text-gray-600">
            <span data-testid="ticked-count">
              {ticked.size > 0 ? `${ticked.size} ${ticked.size === 1 ? 'product' : 'products'} ticked` : 'Tick rows to change their prices together, or change every active product matching the filter.'}
            </span>
            <span className="flex items-center gap-2">
              {ticked.size > 0 && (
                <button type="button" onClick={() => setTick({ key: filterKey, ids: new Set() })} className="h-8 px-3 rounded-lg font-semibold border border-gray-300 bg-white hover:bg-gray-50">Clear ticks</button>
              )}
              <button type="button" onClick={() => setBulkOpen(true)} disabled={!list.data} className="h-8 px-3 rounded-lg font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
                Bulk price change…
              </button>
            </span>
          </div>
        )}

        {list.isPending ? (
          <LoadingState label="Loading products…" rows={8} />
        ) : list.isError && !list.data ? (
          <ErrorState error={list.error} title="We could not load the catalogue" onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={filtered ? 'No products match this search' : tab === 'all' ? 'No products yet' : `No ${TAB_LABELS[tab].toLowerCase()} products`}
            hint={filtered ? 'Try another name, barcode or category.' : tab === 'all' ? 'Import an ERP file to add your products.' : undefined}
          />
        ) : (
          <div className="overflow-x-auto" aria-busy={list.isFetching}>
            <table className={`w-full text-left text-xs ${list.isPlaceholderData ? 'opacity-60' : ''}`}>
              <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider border-b border-gray-100">
                <tr>
                  {canBulk && (
                    <th className="pl-4 py-3 w-8">
                      <input type="checkbox" aria-label="Tick every row shown" checked={allTicked} onChange={e => toggle(items.map(p => p.id), e.target.checked)} className="accent-[#027864]" />
                    </th>
                  )}
                  <th className="px-4 py-3">Barcode</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 text-right">{showPrice ? 'ERP price (QAR)' : 'ERP price'}</th>
                  {showPrice && <th className="px-4 py-3">Marketplace price (QAR)</th>}
                  <th className="px-4 py-3 text-right">ERP stock</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Category</th>
                  {canEditPrice && <th className="px-4 py-3"><span className="sr-only">Price actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {items.map(p => {
                  const cat = p.categoryId ? names.get(p.categoryId) : undefined;
                  const sub = p.subcategoryId ? names.get(p.subcategoryId) : undefined;
                  return (
                    <React.Fragment key={p.id}>
                    <tr className={ticked.has(p.id) ? 'bg-[#F2F7F6]' : 'hover:bg-gray-50'}>
                      {canBulk && (
                        <td className="pl-4 py-3">
                          <input type="checkbox" aria-label={`Tick ${p.nameEn}`} checked={ticked.has(p.id)} onChange={e => toggle([p.id], e.target.checked)} className="accent-[#027864]" />
                        </td>
                      )}
                      <td className="px-4 py-3 font-mono text-[11px] text-gray-900 whitespace-nowrap">{p.barcode}</td>
                      <td className="px-4 py-3 min-w-[220px]">
                        <Link to={pathFor('product-detail', p.id)} className="font-semibold text-gray-900 hover:text-[#027864] hover:underline">{p.nameEn}</Link>
                        {p.nameAr ? <div dir="rtl" lang="ar" className="text-[11px] text-gray-500 text-left">{p.nameAr}</div>
                          : <div className="text-[11px] text-amber-700">No Arabic name</div>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono whitespace-nowrap">{showPrice ? money2(p.erpPrice) : qar(p.erpPrice)}</td>
                      {showPrice && (
                        <td className="px-4 py-3 whitespace-nowrap" data-testid="marketplace-price">
                          {p.marketplacePrice
                            ? <span className="inline-flex items-center gap-2"><span className="font-mono">{money2(p.marketplacePrice.price)}</span><PriceSourceChip source={p.marketplacePrice.source} /></span>
                            : <span className="text-gray-400">—</span>}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right font-mono">{p.erpStock}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <ProductStatusPill status={p.status} />
                        {!p.inLatestErpFile && <div className="mt-1 text-[11px] text-amber-700">Not in latest ERP file</div>}
                      </td>
                      <td className="px-4 py-3">
                        {cat ? <>{cat.nameEn}{sub && <span className="text-gray-500"> › {sub.nameEn}</span>}</>
                          : p.categoryId ? <span className="text-gray-400">—</span>
                            : <span className="text-amber-700">No category</span>}
                      </td>
                      {canEditPrice && (
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            type="button" onClick={() => setEditing(editing === p.id ? null : p.id)} aria-expanded={editing === p.id}
                            aria-label={`Change the price of ${p.nameEn}`} className="font-semibold text-[#027864] hover:underline"
                          >
                            Change price
                          </button>
                        </td>
                      )}
                    </tr>
                    {canEditPrice && editing === p.id && (
                      <tr aria-label={`Price editor for ${p.nameEn}`}>
                        <td colSpan={columns} className="px-4 py-4 bg-[#F8FBFA] border-t border-gray-100">
                          <RowPriceEditor productId={p.id} onClose={() => setEditing(null)} />
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {list.isFetchNextPageError && (
          <div role="alert" className="px-4 py-3 text-xs text-red-700 border-t border-gray-100 flex items-center gap-3">
            We could not load more products.
            <button onClick={() => void list.fetchNextPage()} className="font-semibold underline">Try again</button>
          </div>
        )}
        {list.hasNextPage && !list.isFetchNextPageError && (
          <div className="p-4 border-t border-gray-100 text-center">
            <button
              onClick={() => void list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
              className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>

      {bulkOpen && (
        <BulkPriceChangeDialog
          tickedIds={[...ticked]}
          filter={bulkFilter}
          // The list's own count for this search and category: exactly the active products a filter selection takes.
          filterActiveCount={list.isPlaceholderData ? undefined : counts?.active}
          filterCountPending={list.isPending || list.isPlaceholderData || (list.isFetching && !list.isFetchingNextPage)}
          filterSummary={filterSummary}
          onClose={() => setBulkOpen(false)}
          onApplied={() => setTick({ key: filterKey, ids: new Set() })}
        />
      )}
    </div>
  );
};
