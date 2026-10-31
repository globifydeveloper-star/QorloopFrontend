import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import { ASSIGN_ERP_MAX, categoriesApi, inUseSummary, type Category, type CategoryNode } from '../../api/categories';
import { matchView, pathFor } from '../../routes/paths';
import { EmptyState, ErrorState, LoadingState } from '../common/States';
import { ConfirmDialog } from '../uploads/shared';
import { CategoryNameForm } from './CategoryForms';
import {
  CATEGORIES_KEY, ERP_SUGGESTIONS_KEY, PRODUCTS_KEY, ProductStatusPill, catalogueErrorText, qar, useCategoryTree, useProductList,
} from './shared';

/** One category (or subcategory) from the tree: rename, delete, subcategories, ERP suggestions and its products. */
export const RealCategoryDetailView: React.FC = () => {
  const id = matchView(useLocation().pathname)?.id ?? '';
  const tree = useCategoryTree();

  const found = useMemo(() => {
    for (const c of tree.data ?? []) {
      if (c.id === id) return { category: c as Category, node: c as CategoryNode | undefined, parent: undefined as CategoryNode | undefined };
      const s = c.children.find(x => x.id === id);
      if (s) return { category: s, node: undefined, parent: c };
    }
    return undefined;
  }, [tree.data, id]);

  const crumbs = (
    <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
      <Link to={pathFor('catalogue')} className="text-blue-600 hover:underline">Catalogue</Link><span>/</span>
      <Link to={pathFor('categories')} className="text-blue-600 hover:underline">Categories</Link>
      {found?.parent && <><span>/</span><Link to={pathFor('category-detail', found.parent.id)} className="text-blue-600 hover:underline">{found.parent.nameEn}</Link></>}
      {found && <><span>/</span><span className="text-gray-700">{found.category.nameEn}</span></>}
    </div>
  );

  if (tree.isPending) return <div className="p-8 max-w-5xl mx-auto"><LoadingState label="Loading category…" rows={5} /></div>;
  if (tree.isError) return <div className="p-8 max-w-5xl mx-auto"><ErrorState error={tree.error} title="We could not load this category" onRetry={() => void tree.refetch()} /></div>;
  if (!found) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        {crumbs}
        <EmptyState title="Category not found" hint="It may have been deleted." action={<Link to={pathFor('categories')} className="text-xs font-semibold text-[#027864] hover:underline">Back to categories</Link>} />
      </div>
    );
  }
  return <Detail key={found.category.id} category={found.category} node={found.node} parent={found.parent} crumbs={crumbs} />;
};

const Detail: React.FC<{ category: Category; node?: CategoryNode; parent?: CategoryNode; crumbs: React.ReactNode }> = ({ category: c, node, parent, crumbs }) => {
  const { can } = useAuth();
  const { showToast } = useApp();
  const qc = useQueryClient();
  const go = useNavigate();
  const manage = can('categories.manage');
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const refreshTree = () => void qc.invalidateQueries({ queryKey: CATEGORIES_KEY });

  const rename = useMutation({
    mutationFn: (v: { nameEn: string; nameAr: string }) => categoriesApi.update(c.id, { nameEn: v.nameEn, nameAr: v.nameAr || null }),
    onSuccess: () => { refreshTree(); setRenaming(false); showToast('Category renamed', 'success'); },
  });
  const remove = useMutation({
    mutationFn: () => categoriesApi.remove(c.id),
    onSuccess: () => {
      refreshTree();
      setConfirmDelete(false);
      showToast(`Category "${c.nameEn}" deleted`, 'success');
      go(parent ? pathFor('category-detail', parent.id) : pathFor('categories'));
    },
    onError: () => setConfirmDelete(false),
  });
  const createSub = useMutation({
    mutationFn: (v: { nameEn: string; nameAr: string }) => categoriesApi.create({ nameEn: v.nameEn, nameAr: v.nameAr || undefined, parentId: c.id }),
    onSuccess: s => { refreshTree(); setAddingSub(false); showToast(`Subcategory "${s.nameEn}" created`, 'success'); },
  });
  const inUse = inUseSummary(remove.error);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div>
        {crumbs}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">{c.nameEn}</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {c.nameAr && <span dir="rtl" lang="ar" className="mr-2">{c.nameAr}</span>}
              {parent ? `Subcategory of ${parent.nameEn}` : 'Top-level category'} · {c.productCount} product{c.productCount === 1 ? '' : 's'}
            </p>
          </div>
          {manage && !renaming && (
            <div className="flex gap-2">
              <button onClick={() => { rename.reset(); setRenaming(true); }} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-gray-300 bg-white rounded-lg hover:bg-gray-50">
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Rename
              </button>
              <button onClick={() => { remove.reset(); setConfirmDelete(true); }} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-red-200 text-red-700 bg-white rounded-lg hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {remove.error && (
        <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
          {inUse
            ? <><b>This category cannot be deleted while it is in use:</b> {inUse}. Move or remove them first.</>
            : catalogueErrorText(remove.error)}
        </div>
      )}

      {manage && renaming && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">Rename category</h2>
          <CategoryNameForm
            label="Rename category" submitLabel="Save name" idPrefix="rename" initial={c}
            busy={rename.isPending} error={rename.error} onSubmit={v => rename.mutate(v)} onCancel={() => setRenaming(false)}
          />
        </div>
      )}

      {node && (
        <section aria-label="Subcategories" className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Subcategories ({node.children.length})</h2>
            {manage && !addingSub && (
              <button onClick={() => { createSub.reset(); setAddingSub(true); }} className="inline-flex items-center gap-1 text-xs font-semibold text-[#027864] hover:underline">
                <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add subcategory
              </button>
            )}
          </div>
          {manage && addingSub && (
            <div className="p-4 border-b border-gray-100">
              <CategoryNameForm
                label="New subcategory" submitLabel="Create subcategory" idPrefix="new-sub"
                busy={createSub.isPending} error={createSub.error} onSubmit={v => createSub.mutate(v)} onCancel={() => setAddingSub(false)}
              />
            </div>
          )}
          {node.children.length === 0 ? (
            <p className="px-5 py-4 text-xs text-gray-500">No subcategories.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {node.children.map(s => (
                <li key={s.id}>
                  <Link to={pathFor('category-detail', s.id)} className="flex justify-between px-5 py-2.5 text-xs hover:bg-gray-50">
                    <span className="font-semibold text-gray-900">{s.nameEn}{s.nameAr && <span dir="rtl" lang="ar" className="ml-2 font-normal text-gray-500">{s.nameAr}</span>}</span>
                    <span className="text-gray-500">{s.productCount} product{s.productCount === 1 ? '' : 's'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Products can only be filed from the ERP under a top-level category. */}
      {node && manage && <ErpSuggestions category={c} />}

      <CategoryProducts category={c} isSub={Boolean(parent)} />

      {confirmDelete && (
        <ConfirmDialog title={`Delete "${c.nameEn}"?`} confirmLabel="Delete category" busy={remove.isPending} onConfirm={() => remove.mutate()} onClose={() => setConfirmDelete(false)}>
          The category is removed for good. Qorloop refuses while products, subcategories, marketplace mappings or price rules still use it.
        </ConfirmDialog>
      )}
    </div>
  );
};

const ErpSuggestions: React.FC<{ category: Category }> = ({ category: c }) => {
  const qc = useQueryClient();
  const { showToast } = useApp();
  const q = useQuery({ queryKey: ERP_SUGGESTIONS_KEY, queryFn: ({ signal }) => categoriesApi.erpSuggestions(signal), retry: false });
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [result, setResult] = useState<number | null>(null);
  const assign = useMutation({
    mutationFn: () => categoriesApi.assignFromErp(c.id, [...picked]),
    onSuccess: r => {
      setResult(r.updated);
      setPicked(new Set());
      showToast(`${r.updated} product${r.updated === 1 ? '' : 's'} filed under ${c.nameEn}`, 'success');
      void qc.invalidateQueries({ queryKey: ERP_SUGGESTIONS_KEY });
      void qc.invalidateQueries({ queryKey: CATEGORIES_KEY });
      void qc.invalidateQueries({ queryKey: PRODUCTS_KEY });
    },
  });
  const toggle = (t: string) => setPicked(s => {
    const n = new Set(s);
    if (n.has(t)) n.delete(t); else if (n.size < ASSIGN_ERP_MAX) n.add(t);
    return n;
  });
  const items = q.data ?? [];

  return (
    <section aria-label="ERP category suggestions" className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">ERP category suggestions</h2>
        <p className="text-xs text-gray-500">The ERP&apos;s own category texts. Assigning one files its products that have no category yet under {c.nameEn}; products that already have a category are left alone.</p>
      </div>
      {q.isPending ? (
        <LoadingState label="Loading ERP categories…" rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} title="We could not load ERP categories" onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="No ERP categories" hint="None of your products has an ERP category text." />
      ) : (
        <>
          <ul className="max-h-72 overflow-y-auto divide-y divide-gray-100">
            {items.map(s => (
              <li key={s.erpCategory}>
                <label className={`flex items-center gap-3 px-5 py-2 text-xs ${s.unassigned === 0 ? 'text-gray-400' : 'cursor-pointer hover:bg-gray-50'}`}>
                  <input
                    type="checkbox" checked={picked.has(s.erpCategory)} onChange={() => toggle(s.erpCategory)}
                    disabled={s.unassigned === 0 || (!picked.has(s.erpCategory) && picked.size >= ASSIGN_ERP_MAX)}
                  />
                  <span className="flex-1 font-semibold">{s.erpCategory}</span>
                  <span>{s.unassigned} without a category · {s.products} in total</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap items-center gap-3">
            <button
              onClick={() => { setResult(null); assign.mutate(); }}
              disabled={picked.size === 0 || assign.isPending}
              className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50"
            >
              {assign.isPending ? 'Assigning…' : `Assign selected ERP categories to this category${picked.size ? ` (${picked.size})` : ''}`}
            </button>
            {picked.size >= ASSIGN_ERP_MAX && <span className="text-xs text-amber-800">You can assign up to {ASSIGN_ERP_MAX} at a time.</span>}
            {result !== null && (
              <span role="status" className="inline-flex items-center gap-1 text-xs text-[#027864] font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> {result} product{result === 1 ? '' : 's'} filed under {c.nameEn}.
              </span>
            )}
            {assign.error && <span role="alert" className="text-xs text-red-700">{catalogueErrorText(assign.error)}</span>}
          </div>
        </>
      )}
    </section>
  );
};

const CategoryProducts: React.FC<{ category: Category; isSub: boolean }> = ({ category: c, isSub }) => {
  const filter = useMemo(() => ({ q: '', tab: 'all' as const, ...(isSub ? { subcategoryId: c.id } : { categoryId: c.id }) }), [c.id, isSub]);
  const list = useProductList(filter);
  const items = list.data?.pages.flatMap(p => p.items) ?? [];
  return (
    <section aria-label="Products in this category" className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">Products{list.data ? ` (${list.data.pages[0].counts.all})` : ''}</h2>
      </div>
      {list.isPending ? (
        <LoadingState label="Loading products…" rows={4} />
      ) : list.isError && !list.data ? (
        <ErrorState error={list.error} title="We could not load the products" onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="No products in this category" />
      ) : (
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider">
            <tr><th className="px-5 py-2.5">Barcode</th><th className="px-5 py-2.5">Name</th><th className="px-5 py-2.5 text-right">ERP price</th><th className="px-5 py-2.5 text-right">ERP stock</th><th className="px-5 py-2.5">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map(p => (
              <tr key={p.id}>
                <td className="px-5 py-2.5 font-mono text-[11px]">{p.barcode}</td>
                <td className="px-5 py-2.5"><Link to={pathFor('product-detail', p.id)} className="font-semibold text-gray-900 hover:underline">{p.nameEn}</Link></td>
                <td className="px-5 py-2.5 text-right font-mono">{qar(p.erpPrice)}</td>
                <td className="px-5 py-2.5 text-right font-mono">{p.erpStock}</td>
                <td className="px-5 py-2.5"><ProductStatusPill status={p.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.hasNextPage && (
        <div className="p-3 border-t border-gray-100 text-center">
          <button onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className="h-8 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white disabled:opacity-50">
            {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </section>
  );
};
