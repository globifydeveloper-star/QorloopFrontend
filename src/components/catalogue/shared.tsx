import React, { useEffect, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleSlash, Sparkles } from 'lucide-react';
import { ApiError } from '../../api/client';
import { PRODUCTS_PAGE_SIZE, productsApi, type ProductDetail, type ProductItem, type ProductPage, type ProductStatus, type ProductTab } from '../../api/products';
import { categoriesApi, type CategoryNode } from '../../api/categories';
import { formatQar } from '../../lib/pricing';

export const PRODUCTS_KEY = ['products'] as const;
export const productKey = (id: string) => ['products', 'detail', id] as const;
export const CATEGORIES_KEY = ['categories', 'tree'] as const;
export const ERP_SUGGESTIONS_KEY = ['categories', 'erp-suggestions'] as const;

export interface ProductFilter {
  q: string;
  tab: ProductTab;
  categoryId?: string;
  subcategoryId?: string;
}
const productListKey = (f: ProductFilter) => ['products', 'list', f] as const;

/** GET /api/products, one page per 'Load more' (keyset cursor). Keeps the previous result on screen while a filter changes. */
export function useProductList(filter: ProductFilter) {
  return useInfiniteQuery({
    queryKey: productListKey(filter),
    queryFn: ({ pageParam, signal }) => productsApi.list({ ...filter, cursor: pageParam, limit: PRODUCTS_PAGE_SIZE }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Writes an updated product into every cached list page and its detail entry, so rows keep their place. */
export function storeProduct(qc: QueryClient, p: ProductDetail) {
  qc.setQueryData(productKey(p.id), p);
  qc.setQueriesData<InfiniteData<ProductPage>>({ queryKey: ['products', 'list'] }, data => data && {
    ...data,
    pages: data.pages.map(pg => ({ ...pg, items: pg.items.map(i => (i.id === p.id ? { ...i, ...pick(p) } : i)) })),
  });
}
const pick = (p: ProductDetail): ProductItem => {
  const { size: _s, erpActive: _a, createdAt: _c, category: _cat, subcategory: _sub, listings: _l, ...item } = p;
  return item;
};

export function useCategoryTree() {
  return useQuery({ queryKey: CATEGORIES_KEY, queryFn: ({ signal }) => categoriesApi.tree(signal), retry: false, staleTime: 30_000 });
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const STATUS_LABELS: Record<ProductStatus, string> = { new: 'New', active: 'Active', inactive: 'Inactive' };

/** Status in words with an icon, so it never depends on colour alone. */
export const ProductStatusPill: React.FC<{ status: ProductStatus }> = ({ status }) => {
  const [tone, Icon] =
    status === 'active' ? ['bg-[#E3FAF3] text-[#027864] border-[#027864]/30', CheckCircle2]
      : status === 'new' ? ['bg-blue-50 text-blue-700 border-blue-200', Sparkles]
        : ['bg-gray-100 text-gray-700 border-gray-300', CircleSlash];
  return (
    <span data-testid="status-pill" className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${tone}`}>
      <Icon className="w-3 h-3" aria-hidden="true" />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
};

export const qar = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `QAR ${formatQar(n)}`);

export const isConflict = (e: unknown) => e instanceof ApiError && e.status === 409;
export const CONFLICT_TEXT = 'This product changed; reload';

export function catalogueErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return 'You do not have permission to do this.';
    return e.message;
  }
  return e instanceof Error && e.message ? `Something went wrong: ${e.message}` : 'Something went wrong. Please try again.';
}

/** Product form field for each backend error path (Zod paths and the readiness gaps). */
const PRODUCT_FIELD: Record<string, ProductField> = {
  nameAr: 'nameAr', categoryId: 'categoryId', category: 'categoryId', subcategoryId: 'subcategoryId', subcategory: 'subcategoryId', status: 'status',
};
export type ProductField = 'nameAr' | 'categoryId' | 'subcategoryId' | 'status';

/** Field messages from a 400's details, plus the overall message when no detail names a field. */
export function productErrors(e: unknown): { fields: Partial<Record<ProductField, string>>; general?: string } {
  if (!(e instanceof ApiError)) return { fields: {}, general: catalogueErrorText(e) };
  const fields: Partial<Record<ProductField, string>> = {};
  for (const d of e.details) {
    const f = d.path ? PRODUCT_FIELD[d.path] : undefined;
    if (f && !fields[f] && d.message) fields[f] = d.message;
  }
  const general = Object.keys(fields).length ? (e.message === 'Validation failed' ? undefined : e.message) : catalogueErrorText(e);
  return { fields, general };
}

/** <option>s for the top-level categories. */
export const CategoryOptions: React.FC<{ tree: CategoryNode[] | undefined }> = ({ tree }) => (
  <>{(tree ?? []).map(c => <option key={c.id} value={c.id}>{c.nameEn}</option>)}</>
);

export const FieldError: React.FC<{ id: string; message?: string }> = ({ id, message }) =>
  message ? <p id={id} role="alert" className="mt-1 text-[11px] text-red-700">{message}</p> : null;

export const NotAvailableYet: React.FC<{ title: string; hint: string }> = ({ title, hint }) => (
  <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm" aria-label={title}>
    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">{title}</h3>
    <p className="mt-2 text-sm font-semibold text-gray-700">Not available yet</p>
    <p className="text-xs text-gray-500 mt-0.5">{hint}</p>
  </section>
);
