import React, { useEffect, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleSlash, Sparkles } from 'lucide-react';
import { ApiError } from '../../api/client';
import {
  PRODUCTS_PAGE_SIZE, productsApi, type MarketplaceStatusFilter, type MarketplacesDiffer, type ProductDetail, type ProductItem, type ProductPage, type ProductStatus,
  type ProductTab,
} from '../../api/products';
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
  /** Asks for each product's values on this marketplace (GET /api/products?marketplaceId=). */
  marketplaceId?: string;
  marketplaceStatus?: MarketplaceStatusFilter;
  /** A second marketplace next to the first ("Compare with Talabat and Snoonu"). */
  compareMarketplaceId?: string;
  /** Only with compareMarketplaceId: where the two differ, or a product is on only one. */
  marketplacesDiffer?: MarketplacesDiffer;
}
const productListKey = (f: ProductFilter) => ['products', 'list', f] as const;

/**
 * A list page, plus why the marketplace values could not be shown when the backend refused them, or (compareProblem)
 * why the second marketplace could not be, while the first one still shows.
 */
export type CataloguePage = ProductPage & { marketplaceProblem?: string; compareProblem?: string };

/** A 400 about the second marketplace: not enabled, or a backend that cannot compare two yet (unknown keys). */
function compareRefusal(e: unknown): string | undefined {
  if (!(e instanceof ApiError) || e.status !== 400) return undefined;
  const about = (s: string | undefined) => /compareMarketplaceId|marketplacesDiffer/.test(s ?? '');
  const d = e.details.find(x => about(x.path) || about(x.message));
  if (d) return d.path === 'compareMarketplaceId' ? d.message : 'This server cannot compare two marketplaces yet.';
  return about(e.message) ? 'This server cannot compare two marketplaces yet.' : undefined;
}

/**
 * A 400 about the marketplace parameters: the marketplace is not enabled for the store, or the backend predates the
 * marketplace columns (its strict query rejects the unknown keys).
 */
function marketplaceRefusal(e: unknown): string | undefined {
  if (!(e instanceof ApiError) || e.status !== 400) return undefined;
  const d = e.details.find(x => /marketplace/i.test(x.path ?? '') || /marketplace/i.test(x.message));
  if (d) return d.path === 'marketplaceId' || d.path === 'marketplaceStatus' ? d.message : 'This server does not offer marketplace values in the catalogue yet.';
  return /marketplace/i.test(e.message) ? 'This server does not offer marketplace values in the catalogue yet.' : undefined;
}

async function listPage(filter: ProductFilter, cursor: string | undefined, signal: AbortSignal): Promise<CataloguePage> {
  try {
    return await productsApi.list({ ...filter, cursor, limit: PRODUCTS_PAGE_SIZE }, signal);
  } catch (e) {
    // The second marketplace first: then the first one still shows, and the view says why the second is missing.
    const compareProblem = filter.compareMarketplaceId ? compareRefusal(e) : undefined;
    if (compareProblem) {
      const { compareMarketplaceId: _c, marketplacesDiffer: _d, ...one } = filter;
      return { ...(await listPage(one, cursor, signal)), compareProblem };
    }
    const problem = filter.marketplaceId ? marketplaceRefusal(e) : undefined;
    if (!problem) throw e;
    // Show the catalogue without marketplace values rather than an error page; the view says why.
    const { marketplaceId: _m, marketplaceStatus: _s, compareMarketplaceId: _c, marketplacesDiffer: _d, ...plain } = filter;
    const page = await productsApi.list({ ...plain, cursor, limit: PRODUCTS_PAGE_SIZE }, signal);
    return { ...page, marketplaceProblem: problem };
  }
}

/**
 * The tab counts for a search and category alone. With a marketplace status filter the list's own counts are narrowed
 * by it, but the bulk changes take no marketplace status, so their counts come from here.
 */
export function useProductCounts(filter: Omit<ProductFilter, 'marketplaceId' | 'marketplaceStatus'>, enabled: boolean) {
  return useQuery({
    queryKey: ['products', 'counts', filter] as const,
    queryFn: ({ signal }) => productsApi.list({ ...filter, limit: 1 }, signal).then(p => p.counts),
    enabled,
    retry: false,
  });
}

/** GET /api/products, one page per 'Load more' (keyset cursor). Keeps the previous result on screen while a filter changes. */
export function useProductList(filter: ProductFilter) {
  return useInfiniteQuery({
    queryKey: productListKey(filter),
    queryFn: ({ pageParam, signal }) => listPage(filter, pageParam, signal),
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
  const { size: _s, erpActive: _a, createdAt: _c, category: _cat, subcategory: _sub, listings: _l, pricing: _pr, arabicNameMissing: _am, categoryMissing: _cm, ...item } = p;
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
