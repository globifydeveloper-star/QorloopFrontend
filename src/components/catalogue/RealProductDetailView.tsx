import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleSlash, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';
import { productsApi, type ProductDetail, type UpdateProductRequest } from '../../api/products';
import { MARKETPLACE_NAMES } from '../../lib/pricing';
import { matchView, pathFor } from '../../routes/paths';
import { ErrorState, LoadingState } from '../common/States';
import {
  CATEGORIES_KEY, CONFLICT_TEXT, CategoryOptions, FieldError, NotAvailableYet, ProductStatusPill, isConflict, productErrors,
  productKey, qar, storeProduct, useCategoryTree,
} from './shared';

/** CAT-002: one product from GET /api/products/:id; the Qorloop-owned fields are edited with PATCH. */
export const RealProductDetailView: React.FC = () => {
  const id = matchView(useLocation().pathname)?.id ?? '';
  const q = useQuery({ queryKey: productKey(id), queryFn: ({ signal }) => productsApi.get(id, signal), enabled: Boolean(id), retry: false });

  if (q.isPending) return <div className="p-8 max-w-7xl mx-auto"><LoadingState label="Loading product…" rows={6} /></div>;
  if (q.isError) {
    const missing = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400);
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <ErrorState error={q.error} title={missing ? 'Product not found' : 'We could not load this product'} onRetry={missing ? undefined : () => void q.refetch()} />
        <p className="text-center"><Link to={pathFor('catalogue')} className="text-xs font-semibold text-[#027864] hover:underline">Back to catalogue</Link></p>
      </div>
    );
  }
  const p = q.data;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
          <Link to={pathFor('catalogue')} className="text-blue-600 hover:underline">Catalogue</Link>
          <span>/</span>
          <span className="text-gray-700">{p.nameEn}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{p.nameEn}</h1>
          <ProductStatusPill status={p.status} />
        </div>
        <p className="text-xs text-gray-500 mt-0.5 font-mono">Barcode {p.barcode}{p.sku ? ` · SKU ${p.sku}` : ''}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Remounted whenever the server copy changes, so a reload replaces the draft. */}
          <EditForm key={`${p.id}:${p.updatedAt}`} product={p} onReload={() => void q.refetch()} reloading={q.isFetching} />
          <Listings product={p} />
        </div>
        <div className="space-y-6">
          <ErpData product={p} />
          <NotAvailableYet title="Marketplace price rules" hint="Price rules for this product are not connected to the server yet." />
          <NotAvailableYet title="Price discrepancies" hint="Discrepancy checks for this product are not connected to the server yet." />
          <NotAvailableYet title="Change history" hint="The change history is not connected to the server yet." />
        </div>
      </div>
    </div>
  );
};

const EditForm: React.FC<{ product: ProductDetail; onReload: () => void; reloading: boolean }> = ({ product: p, onReload, reloading }) => {
  const { can } = useAuth();
  const { showToast } = useApp();
  const qc = useQueryClient();
  const tree = useCategoryTree();
  const editable = can('products.edit');
  const canActivate = can('products.activate');

  const [nameAr, setNameAr] = useState(p.nameAr ?? '');
  const [categoryId, setCategoryId] = useState(p.categoryId ?? '');
  const [subcategoryId, setSubcategoryId] = useState(p.subcategoryId ?? '');
  const [status, setStatus] = useState<string>(p.status);
  const subcategories = tree.data?.find(c => c.id === categoryId)?.children ?? [];

  const changes: UpdateProductRequest = {};
  if (nameAr.trim() !== (p.nameAr ?? '')) changes.nameAr = nameAr.trim();
  if (categoryId !== (p.categoryId ?? '')) changes.categoryId = categoryId || null;
  if (subcategoryId !== (p.subcategoryId ?? '')) changes.subcategoryId = subcategoryId || null;
  if (status !== p.status && (status === 'active' || status === 'inactive')) changes.status = status;
  const dirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: () => productsApi.update(p.id, { ...changes, expectedUpdatedAt: p.updatedAt }),
    onSuccess: updated => {
      storeProduct(qc, updated);
      void qc.invalidateQueries({ queryKey: ['products', 'list'] });
      void qc.invalidateQueries({ queryKey: CATEGORIES_KEY });
      showToast('Product saved', 'success');
    },
  });
  const conflict = isConflict(save.error);
  const errors = save.error && !conflict ? productErrors(save.error) : { fields: {} as ReturnType<typeof productErrors>['fields'] };
  const input = 'w-full h-9 px-3 text-sm border rounded-lg bg-white disabled:bg-gray-50 disabled:text-gray-600';
  const border = (f?: string) => (f ? 'border-red-400' : 'border-gray-300');

  return (
    <form
      className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4"
      aria-label="Qorloop details"
      onSubmit={e => { e.preventDefault(); if (dirty && !save.isPending) save.mutate(); }}
    >
      <div>
        <h2 className="text-sm font-bold text-gray-900">Qorloop details</h2>
        <p className="text-xs text-gray-500">{editable ? 'These fields belong to Qorloop; ERP uploads never overwrite them.' : 'You can view this product but not edit it.'}</p>
      </div>

      {conflict && (
        <div role="alert" className="flex items-center justify-between gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
          <span><b>{CONFLICT_TEXT}.</b> Someone else saved this product after you opened it. Reloading shows their version; your unsaved edits are dropped.</span>
          <button type="button" onClick={onReload} disabled={reloading} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-amber-300 bg-white font-semibold disabled:opacity-50">
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Reload
          </button>
        </div>
      )}
      {errors.general && <p role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">{errors.general}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label htmlFor="pd-nameAr" className="block text-xs font-semibold text-gray-700">Arabic name</label>
          <input
            id="pd-nameAr" dir="rtl" lang="ar" value={nameAr} maxLength={200} disabled={!editable}
            onChange={e => setNameAr(e.target.value)}
            aria-invalid={Boolean(errors.fields.nameAr)} aria-describedby={errors.fields.nameAr ? 'err-nameAr' : undefined}
            className={`${input} ${border(errors.fields.nameAr)} mt-1`}
          />
          <FieldError id="err-nameAr" message={errors.fields.nameAr} />
        </div>
        <div>
          <label htmlFor="pd-categoryId" className="block text-xs font-semibold text-gray-700">Category</label>
          <select
            id="pd-categoryId" value={categoryId} disabled={!editable}
            onChange={e => { setCategoryId(e.target.value); setSubcategoryId(''); }}
            aria-invalid={Boolean(errors.fields.categoryId)} aria-describedby={errors.fields.categoryId ? 'err-categoryId' : undefined}
            className={`${input} ${border(errors.fields.categoryId)} mt-1`}
          >
            <option value="">No category</option>
            {/* Keep the current value visible even before the tree has loaded. */}
            {!tree.data && p.category && <option value={p.category.id}>{p.category.nameEn}</option>}
            <CategoryOptions tree={tree.data} />
          </select>
          <FieldError id="err-categoryId" message={errors.fields.categoryId} />
        </div>
        <div>
          <label htmlFor="pd-subcategoryId" className="block text-xs font-semibold text-gray-700">Subcategory</label>
          <select
            id="pd-subcategoryId" value={subcategoryId} disabled={!editable || !categoryId}
            onChange={e => setSubcategoryId(e.target.value)}
            aria-invalid={Boolean(errors.fields.subcategoryId)} aria-describedby={errors.fields.subcategoryId ? 'err-subcategoryId' : undefined}
            className={`${input} ${border(errors.fields.subcategoryId)} mt-1`}
          >
            <option value="">No subcategory</option>
            {!tree.data && p.subcategory && <option value={p.subcategory.id}>{p.subcategory.nameEn}</option>}
            {subcategories.map(s => <option key={s.id} value={s.id}>{s.nameEn}</option>)}
          </select>
          <FieldError id="err-subcategoryId" message={errors.fields.subcategoryId} />
        </div>
        <div>
          <label htmlFor="pd-status" className="block text-xs font-semibold text-gray-700">Status</label>
          <select
            id="pd-status" value={status} disabled={!editable}
            onChange={e => setStatus(e.target.value)}
            aria-invalid={Boolean(errors.fields.status)} aria-describedby={errors.fields.status ? 'err-status' : undefined}
            className={`${input} ${border(errors.fields.status)} mt-1`}
          >
            {p.status === 'new' && <option value="new">New (not active yet)</option>}
            <option value="active" disabled={p.status !== 'active' && !canActivate}>
              {p.status !== 'active' && !canActivate ? 'Active (you cannot activate products)' : 'Active'}
            </option>
            <option value="inactive">Inactive</option>
          </select>
          <FieldError id="err-status" message={errors.fields.status} />
        </div>
      </div>
      {tree.isError && <p className="text-[11px] text-red-700">We could not load the category list. <button type="button" className="underline" onClick={() => void tree.refetch()}>Try again</button></p>}

      {editable && (
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button" disabled={!dirty || save.isPending}
            onClick={() => { setNameAr(p.nameAr ?? ''); setCategoryId(p.categoryId ?? ''); setSubcategoryId(p.subcategoryId ?? ''); setStatus(p.status); save.reset(); }}
            className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            Discard changes
          </button>
          <button type="submit" disabled={!dirty || save.isPending || conflict} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </form>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex justify-between gap-3 py-1.5 text-xs">
    <dt className="text-gray-500">{label}</dt>
    <dd className="text-gray-900 font-medium text-right">{children}</dd>
  </div>
);
const YesNo: React.FC<{ value: boolean; yes?: string; no?: string }> = ({ value, yes = 'Yes', no = 'No' }) => (
  <span className="inline-flex items-center gap-1">
    {value ? <CheckCircle2 className="w-3 h-3 text-[#027864]" aria-hidden="true" /> : <CircleSlash className="w-3 h-3 text-gray-500" aria-hidden="true" />}
    {value ? yes : no}
  </span>
);

const ErpData: React.FC<{ product: ProductDetail }> = ({ product: p }) => (
  <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm" aria-label="From the ERP">
    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">From the ERP</h3>
    <p className="text-[11px] text-gray-500 mb-2">Read only. These values change with each ERP upload.</p>
    <dl className="divide-y divide-gray-100">
      <Row label="Barcode"><span className="font-mono">{p.barcode}</span></Row>
      <Row label="SKU">{p.sku ?? '—'}</Row>
      <Row label="Brand">{p.brand ?? '—'}</Row>
      <Row label="Size">{p.size ?? '—'}</Row>
      <Row label="ERP category">{p.erpCategory ?? '—'}</Row>
      <Row label="ERP price"><span className="font-mono">{qar(p.erpPrice)}</span></Row>
      {p.costPrice !== undefined && <Row label="Cost price"><span className="font-mono">{qar(p.costPrice)}</span></Row>}
      <Row label="ERP stock"><span className="font-mono">{p.erpStock}</span></Row>
      <Row label="Active in ERP"><YesNo value={p.erpActive} /></Row>
      <Row label="In latest ERP file"><YesNo value={p.inLatestErpFile} /></Row>
      <Row label="Updated">{new Date(p.updatedAt).toLocaleString()}</Row>
    </dl>
  </section>
);

const Listings: React.FC<{ product: ProductDetail }> = ({ product: p }) => (
  <section className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden" aria-label="Marketplace listings">
    <div className="px-5 py-4 border-b border-gray-100">
      <h2 className="text-sm font-bold text-gray-900">Marketplace listings ({p.listings.length})</h2>
      <p className="text-xs text-gray-500">From the latest marketplace files.</p>
    </div>
    {p.listings.length === 0 ? (
      <p className="p-5 text-xs text-gray-500">This product is not matched to any marketplace listing yet.</p>
    ) : (
      <table className="w-full text-left text-xs">
        <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider">
          <tr>
            <th className="px-5 py-2.5">Marketplace</th>
            <th className="px-5 py-2.5">Marketplace ID</th>
            <th className="px-5 py-2.5 text-right">Price</th>
            <th className="px-5 py-2.5">Availability</th>
            <th className="px-5 py-2.5">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {p.listings.map(l => (
            <tr key={`${l.marketplaceId}:${l.marketplaceProductId ?? ''}`}>
              <td className="px-5 py-2.5 font-semibold">{MARKETPLACE_NAMES[l.marketplaceId as keyof typeof MARKETPLACE_NAMES] ?? l.marketplaceId}</td>
              <td className="px-5 py-2.5 font-mono text-[11px]">{l.marketplaceProductId ?? '—'}</td>
              <td className="px-5 py-2.5 text-right font-mono">{qar(l.price)}</td>
              <td className="px-5 py-2.5"><YesNo value={l.available} yes="Available" no="Unavailable" /></td>
              <td className="px-5 py-2.5 text-gray-500">{new Date(l.updatedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </section>
);
