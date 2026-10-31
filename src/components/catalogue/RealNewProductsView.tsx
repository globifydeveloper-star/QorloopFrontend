import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import { ACTIVATE_MAX_IDS, productsApi, readinessGaps, type ActivateRequest, type ActivateResult, type ProductItem, type UpdateProductRequest } from '../../api/products';
import { pathFor } from '../../routes/paths';
import { EmptyState, ErrorState, LoadingState } from '../common/States';
import { ConfirmDialog } from '../uploads/shared';
import {
  CATEGORIES_KEY, CONFLICT_TEXT, CategoryOptions, FieldError, PRODUCTS_KEY, catalogueErrorText, isConflict, productErrors,
  storeProduct, useCategoryTree, useProductList, type ProductField,
} from './shared';

interface Draft { nameAr: string; categoryId: string }
interface RowError { fields: Partial<Record<ProductField, string>>; general?: string; conflict?: boolean }
/** The activation outcome, with the names of skipped rows captured before the list refreshes. */
interface Outcome extends ActivateResult { names: Record<string, { nameEn: string; barcode: string }> }

const FILTER = { q: '', tab: 'new' as const };

/** CAT-004: products with status `new`. Give them an Arabic name and a category, then activate the ready ones. */
export const RealNewProductsView: React.FC = () => {
  const { showToast } = useApp();
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useProductList(FILTER);
  const tree = useCategoryTree();
  const editable = can('products.edit');
  const canActivate = can('products.activate');

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, RowError>>({});
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [activating, setActivating] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);

  const items = useMemo(() => list.data?.pages.flatMap(p => p.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.counts.new ?? 0;
  const draftOf = (p: ProductItem): Draft => drafts[p.id] ?? { nameAr: p.nameAr ?? '', categoryId: p.categoryId ?? '' };
  const changesOf = (p: ProductItem): UpdateProductRequest => {
    const d = draftOf(p);
    const c: UpdateProductRequest = {};
    if (d.nameAr.trim() !== (p.nameAr ?? '')) c.nameAr = d.nameAr.trim();
    if (d.categoryId !== (p.categoryId ?? '')) c.categoryId = d.categoryId || null;
    return c;
  };
  const isDirty = (p: ProductItem) => Object.keys(changesOf(p)).length > 0;
  const selectedDirty = items.some(p => selected.has(p.id) && isDirty(p));

  const setDraft = (p: ProductItem, patch: Partial<Draft>) => setDrafts(d => ({ ...d, [p.id]: { ...draftOf(p), ...patch } }));
  const clearRow = (id: string) => {
    setDrafts(({ [id]: _, ...rest }) => rest);
    setRowErrors(({ [id]: _, ...rest }) => rest);
  };

  const saveRow = async (p: ProductItem) => {
    setSaving(s => new Set(s).add(p.id));
    setRowErrors(({ [p.id]: _, ...rest }) => rest);
    try {
      const updated = await productsApi.update(p.id, { ...changesOf(p), expectedUpdatedAt: p.updatedAt });
      storeProduct(qc, updated);
      clearRow(p.id);
      void qc.invalidateQueries({ queryKey: CATEGORIES_KEY });
    } catch (e) {
      setRowErrors(r => ({ ...r, [p.id]: isConflict(e) ? { fields: {}, conflict: true } : productErrors(e) }));
    } finally {
      setSaving(s => { const n = new Set(s); n.delete(p.id); return n; });
    }
  };

  const reload = async () => {
    setDrafts({});
    setRowErrors({});
    await list.refetch();
  };

  const activate = async (body: ActivateRequest) => {
    const names: Outcome['names'] = Object.fromEntries(items.map(p => [p.id, { nameEn: p.nameEn, barcode: p.barcode }]));
    setActivating(true);
    setActivateError(null);
    try {
      // The backend takes at most 500 ids per call.
      const batches = 'ids' in body
        ? Array.from({ length: Math.ceil(body.ids.length / ACTIVATE_MAX_IDS) }, (_, i) => ({ ids: body.ids.slice(i * ACTIVATE_MAX_IDS, (i + 1) * ACTIVATE_MAX_IDS) }))
        : [body];
      const total: ActivateResult = { activated: 0, skipped: [], skippedCount: 0 };
      for (const b of batches) {
        const r = await productsApi.activate(b);
        total.activated += r.activated;
        total.skipped.push(...r.skipped);
        total.skippedCount += r.skippedCount;
      }
      setOutcome({ ...total, names });
      setSelected(new Set());
      showToast(`Activated ${total.activated} product${total.activated === 1 ? '' : 's'}${total.skippedCount ? `; skipped ${total.skippedCount}` : ''}`, total.skippedCount ? 'warning' : 'success');
    } catch (e) {
      setActivateError(catalogueErrorText(e));
    } finally {
      setActivating(false);
      setConfirmAll(false);
      // Some may have been activated before a later batch failed: refresh either way.
      void qc.invalidateQueries({ queryKey: PRODUCTS_KEY });
      void qc.invalidateQueries({ queryKey: CATEGORIES_KEY });
    }
  };

  const allVisibleSelected = items.length > 0 && items.every(p => selected.has(p.id));
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(items.map(p => p.id)));

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <Link to={pathFor('catalogue')} className="text-blue-600 hover:underline">Catalogue</Link><span>/</span><span className="text-gray-700">New products</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">New products</h1>
          <p className="text-xs text-gray-500 mt-0.5">Products from the ERP that are not live yet. A product is ready once it has an Arabic name and a category.</p>
        </div>
        {canActivate && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => void activate({ ids: [...selected] })}
              disabled={activating || selected.size === 0 || selectedDirty}
              className="h-9 px-4 rounded-lg text-xs font-semibold border border-[#027864] text-[#027864] bg-white hover:bg-[#E3FAF3] disabled:opacity-50"
            >
              Activate selected{selected.size ? ` (${selected.size})` : ''}
            </button>
            <button
              onClick={() => setConfirmAll(true)}
              disabled={activating || total === 0}
              className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50"
            >
              Activate all ready
            </button>
          </div>
        )}
      </div>
      {selectedDirty && <p role="status" className="text-xs text-amber-800">Save or discard the edits in the selected rows before activating them.</p>}
      {activateError && <p role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">{activateError}</p>}

      {outcome && (
        <section aria-label="Activation result" className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#027864]" aria-hidden="true" />
              Activated {outcome.activated} product{outcome.activated === 1 ? '' : 's'}. Skipped {outcome.skippedCount}.
            </p>
            <button onClick={() => setOutcome(null)} className="text-xs font-semibold text-gray-500 hover:text-gray-800">Dismiss</button>
          </div>
          {outcome.skipped.length > 0 && (
            <>
              <table className="w-full text-left text-xs">
                <caption className="text-left text-xs text-gray-500 pb-2">
                  Skipped products and why{outcome.skippedCount > outcome.skipped.length ? ` (showing the first ${outcome.skipped.length} of ${outcome.skippedCount})` : ''}
                </caption>
                <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider">
                  <tr><th className="px-3 py-2">Product</th><th className="px-3 py-2">Barcode</th><th className="px-3 py-2">Reason</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {outcome.skipped.map(s => (
                    <tr key={s.id}>
                      <td className="px-3 py-2">
                        <Link to={pathFor('product-detail', s.id)} className="font-semibold text-gray-900 hover:underline">{outcome.names[s.id]?.nameEn ?? s.id}</Link>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px]">{outcome.names[s.id]?.barcode ?? '—'}</td>
                      <td className="px-3 py-2 text-amber-800"><AlertCircle className="inline w-3 h-3 mr-1" aria-hidden="true" />{s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">{list.data ? `${total} new product${total === 1 ? '' : 's'}` : 'New products'}</h2>
        </div>
        {list.isPending ? (
          <LoadingState label="Loading new products…" rows={6} />
        ) : list.isError && !list.data ? (
          <ErrorState error={list.error} title="We could not load new products" onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState title="No new products" hint="New products appear here after an ERP upload adds them." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider border-b border-gray-100">
                <tr>
                  {canActivate && (
                    <th className="px-4 py-3 w-8"><input type="checkbox" aria-label="Select all shown" checked={allVisibleSelected} onChange={toggleAll} /></th>
                  )}
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Arabic name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Ready</th>
                  <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {items.map(p => {
                  const d = draftOf(p);
                  const err = rowErrors[p.id];
                  const gaps = readinessGaps(p);
                  const busy = saving.has(p.id);
                  return (
                    <tr key={p.id} className="align-top" data-testid={`row-${p.id}`}>
                      {canActivate && (
                        <td className="px-4 py-3"><input type="checkbox" aria-label={`Select ${p.nameEn}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></td>
                      )}
                      <td className="px-4 py-3 min-w-[200px]">
                        <Link to={pathFor('product-detail', p.id)} className="font-semibold text-gray-900 hover:underline">{p.nameEn}</Link>
                        <div className="font-mono text-[11px] text-gray-500">{p.barcode}</div>
                        {p.erpCategory && <div className="text-[11px] text-gray-500">ERP category: {p.erpCategory}</div>}
                      </td>
                      <td className="px-4 py-3 min-w-[200px]">
                        {editable ? (
                          <>
                            <input
                              dir="rtl" lang="ar" value={d.nameAr} maxLength={200} disabled={busy}
                              aria-label={`Arabic name for ${p.nameEn}`}
                              aria-invalid={Boolean(err?.fields.nameAr)}
                              onChange={e => setDraft(p, { nameAr: e.target.value })}
                              className={`w-full h-8 px-2 text-sm border rounded-lg ${err?.fields.nameAr ? 'border-red-400' : 'border-gray-300'}`}
                            />
                            <FieldError id={`err-nameAr-${p.id}`} message={err?.fields.nameAr} />
                          </>
                        ) : <span dir="rtl" lang="ar">{p.nameAr ?? '—'}</span>}
                      </td>
                      <td className="px-4 py-3 min-w-[180px]">
                        {editable ? (
                          <>
                            <select
                              value={d.categoryId} disabled={busy}
                              aria-label={`Category for ${p.nameEn}`}
                              aria-invalid={Boolean(err?.fields.categoryId)}
                              onChange={e => setDraft(p, { categoryId: e.target.value })}
                              className={`w-full h-8 px-2 text-xs border rounded-lg bg-white ${err?.fields.categoryId ? 'border-red-400' : 'border-gray-300'}`}
                            >
                              <option value="">No category</option>
                              <CategoryOptions tree={tree.data} />
                            </select>
                            <FieldError id={`err-categoryId-${p.id}`} message={err?.fields.categoryId} />
                          </>
                        ) : (tree.data?.find(c => c.id === p.categoryId)?.nameEn ?? '—')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {gaps.length === 0 ? (
                          <span className="inline-flex items-center gap-1 text-[#027864] font-semibold"><CheckCircle2 className="w-3 h-3" aria-hidden="true" />Ready</span>
                        ) : (
                          <span className="inline-flex flex-col text-amber-800">
                            <span className="inline-flex items-center gap-1 font-semibold"><AlertCircle className="w-3 h-3" aria-hidden="true" />Not ready</span>
                            {gaps.map(g => <span key={g} className="text-[11px]">{g}</span>)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right space-y-1">
                        {editable && isDirty(p) && !err?.conflict && (
                          <div className="flex justify-end gap-1">
                            <button onClick={() => clearRow(p.id)} disabled={busy} className="h-8 px-2 rounded-lg text-xs font-semibold border border-gray-300 bg-white disabled:opacity-50">Discard</button>
                            <button onClick={() => void saveRow(p)} disabled={busy} className="h-8 px-3 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
                              {busy ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        )}
                        {err?.conflict && (
                          <div role="alert" className="text-[11px] text-amber-900">
                            {CONFLICT_TEXT}.{' '}
                            <button onClick={() => void reload()} className="inline-flex items-center gap-0.5 font-semibold underline"><RefreshCw className="w-3 h-3" aria-hidden="true" />Reload</button>
                          </div>
                        )}
                        {err?.general && <p role="alert" className="text-[11px] text-red-700 max-w-[220px] whitespace-normal text-left">{err.general}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.isFetchNextPageError && (
          <div role="alert" className="px-4 py-3 text-xs text-red-700 border-t border-gray-100">
            We could not load more products. <button onClick={() => void list.fetchNextPage()} className="font-semibold underline">Try again</button>
          </div>
        )}
        {list.hasNextPage && !list.isFetchNextPageError && (
          <div className="p-4 border-t border-gray-100 text-center">
            <button onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">
              {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>

      {confirmAll && (
        <ConfirmDialog
          title="Activate all ready products?"
          confirmLabel="Activate all ready"
          tone="primary"
          busy={activating}
          onConfirm={() => void activate({ all: true })}
          onClose={() => setConfirmAll(false)}
        >
          Every new product that has an Arabic name and a category goes live ({total} new in total, including ones not shown yet). Products that are not ready are skipped and listed with the reason.
        </ConfirmDialog>
      )}
    </div>
  );
};
