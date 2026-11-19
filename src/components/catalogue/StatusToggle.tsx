import React, { useState } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { productsApi, type ProductItem, type ProductPage, type ProductStatus } from '../../api/products';
import { useApp } from '../../context/AppContext';
import { CONFLICT_TEXT, isConflict, productErrors, storeProduct } from './shared';

/**
 * The catalogue's Active / Inactive switch (PATCH /api/products/:id { status }). Turning a product on needs
 * products.activate as well as products.edit (a `new` product is activated this way too); turning it off needs
 * products.edit. The row keeps its place, also on the Active or Inactive tab, and that tab's counts move by one;
 * the reports refresh, because inactive products are left out of the comparison and the files.
 */
export const StatusToggle: React.FC<{ product: ProductItem; canEdit: boolean; canActivate: boolean }> = ({ product: p, canEdit, canActivate }) => {
  const qc = useQueryClient();
  const { showToast } = useApp();
  const [saving, setSaving] = useState(false);
  const on = p.status === 'active';
  const blockedReason = !canEdit ? 'You cannot edit products.' : !on && !canActivate ? 'You cannot activate products.' : undefined;
  if (!canEdit) return null;

  const toggle = async () => {
    if (saving || blockedReason) return;
    const next = on ? 'inactive' : 'active';
    setSaving(true);
    try {
      const updated = await productsApi.update(p.id, { status: next, expectedUpdatedAt: p.updatedAt });
      moveCount(qc, p.id, p.status, updated.status);
      storeProduct(qc, updated);
      void qc.invalidateQueries({ queryKey: ['products', 'counts'] });
      void qc.invalidateQueries({ queryKey: ['recon'] });
      void qc.invalidateQueries({ queryKey: ['activity'] });
      showToast(`${p.nameEn} is now ${next === 'active' ? 'active' : 'inactive'}`, 'success');
    } catch (e) {
      showToast(isConflict(e) ? `${CONFLICT_TEXT}: ${p.nameEn}` : productErrors(e).general ?? productErrors(e).fields.status ?? 'Could not change the status.', 'error');
      if (isConflict(e)) void qc.invalidateQueries({ queryKey: ['products', 'list'] });
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button" role="switch" aria-checked={on} onClick={() => void toggle()}
      disabled={saving || Boolean(blockedReason)} title={blockedReason}
      aria-label={`Active: ${p.nameEn}`}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#027864] ${on ? 'bg-[#027864] border-[#027864]' : 'bg-gray-200 border-gray-300'}`}
    >
      <span aria-hidden="true" className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
};

/** Moves one product between the status counts of every cached list page it appears in ("all" does not change). */
function moveCount(qc: ReturnType<typeof useQueryClient>, id: string, from: ProductStatus, to: ProductStatus) {
  if (from === to) return;
  qc.setQueriesData<InfiniteData<ProductPage>>({ queryKey: ['products', 'list'] }, data => {
    if (!data?.pages[0]?.counts || !data.pages.some(pg => pg.items.some(i => i.id === id))) return data;
    const c = { ...data.pages[0].counts };
    c[from] = Math.max(0, c[from] - 1);
    c[to] = c[to] + 1;
    return { ...data, pages: [{ ...data.pages[0], counts: c }, ...data.pages.slice(1)] };
  });
}
