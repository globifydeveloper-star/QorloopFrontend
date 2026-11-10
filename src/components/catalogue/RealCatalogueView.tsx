import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FolderTree, Search, Sparkles, Upload } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import { PRODUCT_TABS, type MarketplaceStatusFilter, type ProductTab } from '../../api/products';
import { settingsApi } from '../../api/settings';
import { indexCategories, type Category } from '../../api/categories';
import { pathFor } from '../../routes/paths';
import { EmptyState, ErrorState, LoadingState } from '../common/States';
import { ProductStatusPill, qar, useCategoryTree, useDebounced, useProductCounts, useProductList } from './shared';
import {
  ComparedBadge, MarketplaceAvailabilityCell, MarketplacePriceCell, StackedMarketplaceValues, marketplaceNote, newestUpload,
} from './MarketplaceColumns';
import { marketplaceName, useReconSummary } from '../recon/shared';
import { realPricingEnabled, realReconEnabled, realSettingsEnabled } from '../../lib/features';
import { money2 } from '../../lib/format';
import { PriceSourceChip } from '../pricing/shared';
import { RowPriceEditor } from '../pricing/InlinePriceEditor';
import { BulkPriceChangeDialog } from '../pricing/BulkPriceChangeDialog';
import { CatalogueStockCell } from '../stock/StockCell';
import { BulkStockDialog } from '../stock/BulkStockDialog';

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

  // "View marketplace": the enabled marketplaces that have a file. Settings list them for settings.view; otherwise the
  // recon summary does (recon.view). Neither readable, or none with a file: no selector.
  const fromSettings = realSettingsEnabled() && can('settings.view');
  const enabled = useQuery({
    queryKey: ['settings', 'marketplaces'], queryFn: ({ signal }) => settingsApi.marketplaces(signal), enabled: fromSettings, retry: false,
  });
  const summary = useReconSummary(undefined, { enabled: realReconEnabled() && can('recon.view') });
  const choices: { marketplaceId: string; lastUploadAt: string | null }[] =
    (enabled.data?.items ?? summary.data?.marketplaces ?? []).filter(m => m.hasData);
  // The choice lives in the URL (?marketplace=talabat&mismatches=1); one that is not offered counts as None.
  const [params, setParams] = useSearchParams();
  const chosen = choices.find(c => c.marketplaceId === params.get('marketplace'));
  const marketplaceId = chosen?.marketplaceId ?? '';
  const onlyMismatches = Boolean(marketplaceId) && params.get('mismatches') === '1';
  const marketplaceStatus: MarketplaceStatusFilter | '' = onlyMismatches ? 'mismatch' : '';
  const setView = (id: string, mismatches: boolean) => setParams(prev => {
    const next = new URLSearchParams(prev);
    if (id) next.set('marketplace', id); else next.delete('marketplace');
    if (id && mismatches) next.set('mismatches', '1'); else next.delete('mismatches');
    return next;
  }, { replace: true });

  const filter = useMemo(() => ({
    q, tab,
    categoryId: category.startsWith('c:') ? category.slice(2) : undefined,
    subcategoryId: category.startsWith('s:') ? category.slice(2) : undefined,
    ...(marketplaceId ? { marketplaceId, ...(marketplaceStatus ? { marketplaceStatus } : {}) } : {}),
  }), [q, tab, category, marketplaceId, marketplaceStatus]);
  const list = useProductList(filter);
  const tree = useCategoryTree();
  const names = useMemo(() => indexCategories(tree.data), [tree.data]);

  const items = list.data?.pages.flatMap(p => p.items) ?? [];
  const counts = list.data?.pages[0]?.counts;
  const filtered = Boolean(q || category || onlyMismatches);
  const marketplaceProblem = marketplaceId ? list.data?.pages[0]?.marketplaceProblem : undefined;
  // A missing marketplace object means "not available": no extra columns.
  const showMarketplace = Boolean(marketplaceId) && !marketplaceProblem && items.some(p => p.marketplace);
  const marketplaceMissing = Boolean(marketplaceId) && !marketplaceProblem && items.length > 0 && !showMarketplace && !list.isPlaceholderData;
  const mpName = marketplaceId ? marketplaceName(marketplaceId) : '';
  // The latest file of that marketplace (settings or summary), else the newest one among the shown rows.
  const latestUpload = showMarketplace ? chosen?.lastUploadAt ?? newestUpload(items) : null;
  // A new comparison changes the stored statuses the list shows: refetch it once the summary moves on.
  const qc = useQueryClient();
  const computedAt = summary.data?.computedAt ?? null;
  const seenComputedAt = useRef(computedAt);
  useEffect(() => {
    if (seenComputedAt.current && computedAt && computedAt !== seenComputedAt.current && marketplaceId) {
      void qc.invalidateQueries({ queryKey: ['products', 'list'] });
    }
    seenComputedAt.current = computedAt;
  }, [computedAt, marketplaceId, qc]);
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
  // Bulk stock edit (catalogue.stock_edit) uses the same ticks; its filter selection takes products of any status.
  const canStockBulk = can('catalogue.stock_edit');
  const canTick = canBulk || canStockBulk;
  const [stockBulkOpen, setStockBulkOpen] = useState(false);
  // The bulk changes take no marketplace status: with that filter on, the list's counts are narrowed, so count apart.
  const narrowedByStatus = Boolean(marketplaceId && marketplaceStatus && !marketplaceProblem);
  const plainCounts = useProductCounts(
    { q: filter.q, tab: 'all', categoryId: filter.categoryId, subcategoryId: filter.subcategoryId },
    narrowedByStatus && (bulkOpen || stockBulkOpen),
  );
  const bulkCounts = narrowedByStatus ? plainCounts.data : counts;
  const bulkCountPending = narrowedByStatus
    ? plainCounts.isPending || plainCounts.isFetching
    : list.isPending || list.isPlaceholderData || (list.isFetching && !list.isFetchingNextPage);
  const columns = 7 + (showPrice ? 1 : 0) + (canEditPrice ? 1 : 0) + (canTick ? 1 : 0) + (showMarketplace ? 3 : 0);

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
          {/* The product list has no stock-conflict filter (GET /api/products takes none), so the conflicts have their own page. */}
          <Link to={pathFor('stock-conflicts')} className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            <AlertTriangle className="w-3.5 h-3.5 text-gray-500" /> Stock conflicts
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

        {canTick && (
          <div role="toolbar" aria-label={canBulk ? 'Bulk price change' : 'Bulk stock edit'} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-gray-100 bg-[#F8FBFA] text-xs text-gray-600">
            <span data-testid="ticked-count">
              {ticked.size > 0 ? `${ticked.size} ${ticked.size === 1 ? 'product' : 'products'} ticked`
                : canBulk ? 'Tick rows to change their prices together, or change every active product matching the filter.'
                  : 'Tick rows to change their stock together, or change every product matching the filter.'}
              {narrowedByStatus && ` A bulk change uses the search and category only, not "Only mismatches on ${mpName}".`}
            </span>
            <span className="flex items-center gap-2">
              {ticked.size > 0 && (
                <button type="button" onClick={() => setTick({ key: filterKey, ids: new Set() })} className="h-8 px-3 rounded-lg font-semibold border border-gray-300 bg-white hover:bg-gray-50">Clear ticks</button>
              )}
              {canStockBulk && (
                <button type="button" onClick={() => setStockBulkOpen(true)} disabled={!list.data} className="h-8 px-3 rounded-lg font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">
                  Bulk stock edit…
                </button>
              )}
              {canBulk && (
                <button type="button" onClick={() => setBulkOpen(true)} disabled={!list.data} className="h-8 px-3 rounded-lg font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
                  Bulk price change…
                </button>
              )}
            </span>
          </div>
        )}

        {choices.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-2.5 border-b border-gray-100 text-xs">
            <label className="flex items-center gap-2">
              <span className="font-semibold text-gray-700">View marketplace</span>
              <select
                value={marketplaceId}
                onChange={e => setView(e.target.value, onlyMismatches)}
                className="h-8 px-2 text-xs border border-gray-300 rounded-lg bg-white"
              >
                <option value="">None</option>
                {choices.map(c => <option key={c.marketplaceId} value={c.marketplaceId}>{marketplaceName(c.marketplaceId)}</option>)}
              </select>
            </label>
            {marketplaceId && !marketplaceProblem && (
              <label className="inline-flex items-center gap-2 text-gray-700">
                <input type="checkbox" checked={onlyMismatches} onChange={e => setView(marketplaceId, e.target.checked)} className="accent-[#027864]" />
                {`Only mismatches on ${mpName}`}
              </label>
            )}
          </div>
        )}
        {marketplaceProblem && (
          <div role="status" className="px-4 py-2.5 border-b border-gray-100 bg-amber-50 text-xs text-amber-800">
            {`${mpName} values cannot be shown: ${/[.!?]$/.test(marketplaceProblem) ? marketplaceProblem : `${marketplaceProblem}.`} The list below is the catalogue without them.`}
          </div>
        )}
        {marketplaceMissing && (
          <div role="status" className="px-4 py-2.5 border-b border-gray-100 bg-amber-50 text-xs text-amber-800">
            {`${mpName} values are not available from this server yet; the list below is the catalogue without them.`}
          </div>
        )}
        {showMarketplace && (
          <p data-testid="marketplace-note" className="px-4 py-2.5 border-b border-gray-100 text-[11px] text-gray-500">
            {marketplaceNote(marketplaceId, latestUpload, computedAt)}
          </p>
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
                  {canTick && (
                    <th className="pl-4 py-3 w-8">
                      <input type="checkbox" aria-label="Tick every row shown" checked={allTicked} onChange={e => toggle(items.map(p => p.id), e.target.checked)} className="accent-[#027864]" />
                    </th>
                  )}
                  <th className="px-4 py-3">Barcode</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 text-right">{showPrice ? 'ERP price (QAR)' : 'ERP price'}</th>
                  {showPrice && <th className="px-4 py-3">Marketplace price (QAR)</th>}
                  <th className="px-4 py-3 text-right">ERP stock</th>
                  <th className="px-4 py-3 text-right">Catalogue stock</th>
                  {showMarketplace && <th className="hidden md:table-cell px-4 py-3">{`Availability on ${mpName}`}</th>}
                  {showMarketplace && <th className="hidden md:table-cell px-4 py-3 text-right">{`Price on ${mpName}`}</th>}
                  {showMarketplace && <th className="hidden md:table-cell px-4 py-3">Compared</th>}
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
                      {canTick && (
                        <td className="pl-4 py-3">
                          <input type="checkbox" aria-label={`Tick ${p.nameEn}`} checked={ticked.has(p.id)} onChange={e => toggle([p.id], e.target.checked)} className="accent-[#027864]" />
                        </td>
                      )}
                      <td className="px-4 py-3 font-mono text-[11px] text-gray-900 whitespace-nowrap">{p.barcode}</td>
                      <td className="px-4 py-3 min-w-[220px]">
                        <Link to={pathFor('product-detail', p.id)} className="font-semibold text-gray-900 hover:text-[#027864] hover:underline">{p.nameEn}</Link>
                        {p.nameAr ? <div dir="rtl" lang="ar" className="text-[11px] text-gray-500 text-left">{p.nameAr}</div>
                          : <div className="text-[11px] text-amber-700">No Arabic name</div>}
                        {showMarketplace && <StackedMarketplaceValues m={p.marketplace} name={mpName} latest={latestUpload} />}
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
                      <td className="px-4 py-3 text-right whitespace-nowrap"><CatalogueStockCell catalogueStock={p.catalogueStock} source={p.catalogueStockSource} conflict={p.stockConflict} /></td>
                      {showMarketplace && <td className="hidden md:table-cell px-4 py-3 whitespace-nowrap" data-testid="mp-availability-cell"><MarketplaceAvailabilityCell m={p.marketplace} /></td>}
                      {showMarketplace && <td className="hidden md:table-cell px-4 py-3 text-right whitespace-nowrap" data-testid="mp-price-cell"><MarketplacePriceCell m={p.marketplace} latest={latestUpload} /></td>}
                      {showMarketplace && <td className="hidden md:table-cell px-4 py-3" data-testid="mp-compared-cell"><ComparedBadge m={p.marketplace} /></td>}
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
          filterActiveCount={bulkCountPending ? undefined : bulkCounts?.active}
          filterCountPending={bulkCountPending}
          filterSummary={filterSummary}
          onClose={() => setBulkOpen(false)}
          onApplied={() => setTick({ key: filterKey, ids: new Set() })}
        />
      )}
      {stockBulkOpen && (
        <BulkStockDialog
          tickedIds={[...ticked]}
          filter={bulkFilter}
          // The list's "All" count for this search and category: a stock filter selection takes any status.
          filterCount={bulkCountPending ? undefined : bulkCounts?.all}
          filterSummary={filterSummary}
          onClose={() => setStockBulkOpen(false)}
          onApplied={() => setTick({ key: filterKey, ids: new Set() })}
        />
      )}
    </div>
  );
};
