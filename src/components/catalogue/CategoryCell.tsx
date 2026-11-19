import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import type { Category, CategoryNode } from '../../api/categories';
import { productsApi, type ProductItem, type UpdateProductRequest } from '../../api/products';
import { useApp } from '../../context/AppContext';
import { CATEGORIES_KEY, CONFLICT_TEXT, CategoryOptions, isConflict, productErrors, storeProduct } from './shared';

/**
 * The catalogue's Category cell. Read-only it shows "Category › Subcategory" or "No category"; with products.edit the
 * same text is a button that opens a Category and a Subcategory picker for this one product. Saving sends only what
 * changed, with expectedUpdatedAt (a 409 asks to reload), and patches the row in place. One product at a time: the API
 * has no bulk "set category" call yet.
 */
export const CategoryCell: React.FC<{
  product: ProductItem;
  tree: CategoryNode[] | undefined;
  names: Map<string, Category>;
  editable: boolean;
}> = ({ product: p, tree, names, editable }) => {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    // Back on the cell's button after Save, Cancel or Escape, so the keyboard stays in the row.
    if (wasOpen.current && !open) button.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const cat = p.categoryId ? names.get(p.categoryId) : undefined;
  const sub = p.subcategoryId ? names.get(p.subcategoryId) : undefined;
  const label = cat ? <>{cat.nameEn}{sub && <span className="text-gray-500"> › {sub.nameEn}</span>}</>
    : p.categoryId ? <span className="text-gray-400">—</span>
      : <span className="text-amber-700">No category</span>;

  if (!editable) return label;
  if (open) return <CategoryEditor product={p} tree={tree} names={names} onClose={() => setOpen(false)} />;
  return (
    <button
      ref={button} type="button" onClick={() => setOpen(true)}
      aria-label={`Change the category of ${p.nameEn}`}
      className="group inline-flex items-center gap-1.5 text-left rounded hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#027864]"
    >
      <span>{label}</span>
      <Pencil className="w-3 h-3 shrink-0 text-gray-400 group-hover:text-[#027864]" aria-hidden="true" />
    </button>
  );
};

const CategoryEditor: React.FC<{
  product: ProductItem;
  tree: CategoryNode[] | undefined;
  names: Map<string, Category>;
  onClose: () => void;
}> = ({ product: p, tree, names, onClose }) => {
  const qc = useQueryClient();
  const { showToast } = useApp();
  const [categoryId, setCategoryId] = useState(p.categoryId ?? '');
  const [subcategoryId, setSubcategoryId] = useState(p.subcategoryId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ conflict: boolean; message?: string } | null>(null);

  const subcategories = tree?.find(c => c.id === categoryId)?.children ?? [];
  const changes: UpdateProductRequest = {};
  if (categoryId !== (p.categoryId ?? '')) changes.categoryId = categoryId || null;
  if (subcategoryId !== (p.subcategoryId ?? '')) changes.subcategoryId = subcategoryId || null;
  const dirty = Object.keys(changes).length > 0;

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await productsApi.update(p.id, { ...changes, expectedUpdatedAt: p.updatedAt });
      // The row keeps its place (also when it no longer matches a category filter); the category counts refresh.
      storeProduct(qc, updated);
      void qc.invalidateQueries({ queryKey: CATEGORIES_KEY });
      void qc.invalidateQueries({ queryKey: ['activity'] });
      showToast('Category saved', 'success');
      onClose();
    } catch (e) {
      if (isConflict(e)) setError({ conflict: true });
      else {
        const errs = productErrors(e);
        setError({ conflict: false, message: errs.fields.categoryId ?? errs.fields.subcategoryId ?? errs.general });
      }
    } finally {
      setSaving(false);
    }
  };

  const reload = () => {
    void qc.invalidateQueries({ queryKey: ['products', 'list'] });
    onClose();
  };

  const select = 'h-8 w-full px-2 text-xs border border-gray-300 rounded-lg bg-white disabled:bg-gray-50 disabled:text-gray-500';
  return (
    <div
      role="group" aria-label={`Category of ${p.nameEn}`} className="min-w-[200px] space-y-1.5"
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
    >
      <label className="block">
        <span className="sr-only">{`Category of ${p.nameEn}`}</span>
        <select
          autoFocus value={categoryId} disabled={saving}
          onChange={e => { setCategoryId(e.target.value); setSubcategoryId(''); }}
          className={select}
        >
          <option value="">No category</option>
          {/* Keep the current value visible even before the tree has loaded. */}
          {!tree && p.categoryId && <option value={p.categoryId}>{names.get(p.categoryId)?.nameEn ?? 'Current category'}</option>}
          <CategoryOptions tree={tree} />
        </select>
      </label>
      <label className="block">
        <span className="sr-only">{`Subcategory of ${p.nameEn}`}</span>
        <select
          value={subcategoryId} disabled={saving || !categoryId || subcategories.length === 0}
          onChange={e => setSubcategoryId(e.target.value)}
          className={select}
        >
          <option value="">{categoryId && subcategories.length === 0 ? 'No subcategories' : 'No subcategory'}</option>
          {!tree && p.subcategoryId && <option value={p.subcategoryId}>{names.get(p.subcategoryId)?.nameEn ?? 'Current subcategory'}</option>}
          {subcategories.map(s => <option key={s.id} value={s.id}>{s.nameEn}</option>)}
        </select>
      </label>
      {error && (
        <p role="alert" className="text-[11px] text-red-700">
          {error.conflict
            ? <>{CONFLICT_TEXT}. <button type="button" onClick={reload} className="font-semibold underline">Reload</button></>
            : error.message ?? 'Could not save the category.'}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button" onClick={() => void save()} disabled={!dirty || saving}
          className="h-7 px-2.5 rounded-lg text-[11px] font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onClose} disabled={saving} className="h-7 px-2.5 rounded-lg text-[11px] font-semibold border border-gray-300 bg-white hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </div>
  );
};
