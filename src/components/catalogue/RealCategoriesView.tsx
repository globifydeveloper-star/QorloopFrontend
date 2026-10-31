import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import { categoriesApi } from '../../api/categories';
import { pathFor } from '../../routes/paths';
import { EmptyState, ErrorState, LoadingState } from '../common/States';
import { CategoryNameForm } from './CategoryForms';
import { CATEGORIES_KEY, useCategoryTree } from './shared';

/** The category tree from GET /api/categories (two levels) with product counts. */
export const RealCategoriesView: React.FC = () => {
  const { can } = useAuth();
  const { showToast } = useApp();
  const qc = useQueryClient();
  const tree = useCategoryTree();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const manage = can('categories.manage');

  const create = useMutation({
    mutationFn: (v: { nameEn: string; nameAr: string }) => categoriesApi.create({ nameEn: v.nameEn, nameAr: v.nameAr || undefined }),
    onSuccess: c => {
      void qc.invalidateQueries({ queryKey: CATEGORIES_KEY });
      setAdding(false);
      showToast(`Category "${c.nameEn}" created`, 'success');
    },
  });

  const term = search.trim().toLowerCase();
  const matches = (n: { nameEn: string; nameAr: string | null }) => !term || n.nameEn.toLowerCase().includes(term) || (n.nameAr ?? '').includes(search.trim());
  const shown = (tree.data ?? [])
    .map(c => ({ ...c, children: matches(c) ? c.children : c.children.filter(matches) }))
    .filter(c => matches(c) || c.children.length > 0);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
          <Link to={pathFor('catalogue')} className="text-blue-600 hover:underline">Catalogue</Link><span>/</span><span className="text-gray-700">Categories</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Categories</h1>
            <p className="text-xs text-gray-500 mt-0.5">Categories and their subcategories. A new product needs a category before it can be activated.</p>
          </div>
          {manage && !adding && (
            <button onClick={() => { create.reset(); setAdding(true); }} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg">
              <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New category
            </button>
          )}
        </div>
      </div>

      {manage && adding && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">New category</h2>
          <CategoryNameForm
            label="New category" submitLabel="Create category" idPrefix="new-cat"
            busy={create.isPending} error={create.error} onSubmit={v => create.mutate(v)} onCancel={() => setAdding(false)}
          />
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <label className="relative block max-w-sm">
            <span className="sr-only">Search categories</span>
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search categories" className="w-full h-9 pl-9 pr-3 text-xs border border-gray-300 rounded-lg" />
          </label>
        </div>
        {tree.isPending ? (
          <LoadingState label="Loading categories…" rows={5} />
        ) : tree.isError ? (
          <ErrorState error={tree.error} title="We could not load categories" onRetry={() => void tree.refetch()} />
        ) : shown.length === 0 ? (
          <EmptyState
            title={term ? 'No categories match this search' : 'No categories yet'}
            hint={term ? undefined : manage ? 'Create your first category, then file products under it.' : 'Ask an admin to create categories.'}
          />
        ) : (
          <ul aria-label="Category tree" className="divide-y divide-gray-100">
            {shown.map(c => (
              <li key={c.id}>
                <Link to={pathFor('category-detail', c.id)} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-gray-50">
                  <span>
                    <span className="text-sm font-semibold text-gray-900">{c.nameEn}</span>
                    {c.nameAr && <span dir="rtl" lang="ar" className="ml-2 text-xs text-gray-500">{c.nameAr}</span>}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-gray-500">
                    {c.productCount} product{c.productCount === 1 ? '' : 's'}
                    {c.children.length > 0 && <> · {c.children.length} subcategor{c.children.length === 1 ? 'y' : 'ies'}</>}
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  </span>
                </Link>
                {c.children.length > 0 && (
                  <ul aria-label={`Subcategories of ${c.nameEn}`} className="pb-2">
                    {c.children.map(s => (
                      <li key={s.id}>
                        <Link to={pathFor('category-detail', s.id)} className="flex items-center justify-between gap-3 pl-10 pr-5 py-1.5 hover:bg-gray-50">
                          <span className="text-xs text-gray-800">
                            <span aria-hidden="true" className="text-gray-400 mr-1">└</span>{s.nameEn}
                            {s.nameAr && <span dir="rtl" lang="ar" className="ml-2 text-gray-500">{s.nameAr}</span>}
                          </span>
                          <span className="text-xs text-gray-500">{s.productCount} product{s.productCount === 1 ? '' : 's'}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
