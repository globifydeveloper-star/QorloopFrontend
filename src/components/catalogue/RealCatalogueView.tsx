import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderTree, Search, Sparkles, Upload } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import { PRODUCT_TABS, type ProductTab } from '../../api/products';
import { indexCategories } from '../../api/categories';
import { pathFor } from '../../routes/paths';
import { EmptyState, ErrorState, LoadingState } from '../common/States';
import { ProductStatusPill, qar, useCategoryTree, useDebounced, useProductList } from './shared';

const TAB_LABELS: Record<ProductTab, string> = {
  all: 'All', active: 'Active', inactive: 'Inactive', new: 'New', missing: 'Missing from ERP',
};

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
                  <th className="px-4 py-3">Barcode</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 text-right">ERP price</th>
                  <th className="px-4 py-3 text-right">ERP stock</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Category</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {items.map(p => {
                  const cat = p.categoryId ? names.get(p.categoryId) : undefined;
                  const sub = p.subcategoryId ? names.get(p.subcategoryId) : undefined;
                  return (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-[11px] text-gray-900 whitespace-nowrap">{p.barcode}</td>
                      <td className="px-4 py-3 min-w-[220px]">
                        <Link to={pathFor('product-detail', p.id)} className="font-semibold text-gray-900 hover:text-[#027864] hover:underline">{p.nameEn}</Link>
                        {p.nameAr ? <div dir="rtl" lang="ar" className="text-[11px] text-gray-500 text-left">{p.nameAr}</div>
                          : <div className="text-[11px] text-amber-700">No Arabic name</div>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono whitespace-nowrap">{qar(p.erpPrice)}</td>
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
                    </tr>
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
    </div>
  );
};
