import { api } from './client';

/**
 * Products API (GET/PATCH /api/products…, POST /api/products/activate). Mirrors the backend's products module:
 *   packages/shared/src/contracts.ts (productListQuery, updateProduct, activateProducts)
 *   apps/api/src/products/products.service.ts (responses)
 */

const enc = encodeURIComponent;

export type ProductStatus = 'new' | 'active' | 'inactive';
/** `missing` = not in the latest full ERP file. */
export type ProductTab = 'all' | 'active' | 'inactive' | 'new' | 'missing';
export const PRODUCT_TABS: readonly ProductTab[] = ['all', 'active', 'inactive', 'new', 'missing'];
/** The backend accepts 1..200 (default 50). */
export const PRODUCTS_PAGE_SIZE = 50;
/** POST /api/products/activate takes at most this many ids per call. */
export const ACTIVATE_MAX_IDS = 500;

export interface ProductItem {
  id: string;
  barcode: string;
  sku: string | null;
  nameEn: string;
  nameAr: string | null;
  brand: string | null;
  /** The ERP's own category text (a hint, not a Qorloop category). */
  erpCategory: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  erpPrice: number;
  /** Present only for roles that may change prices. */
  costPrice?: number | null;
  erpStock: number;
  status: ProductStatus;
  inLatestErpFile: boolean;
  updatedAt: string;
}

export type TabCounts = Record<ProductTab, number>;

export interface ProductPage {
  items: ProductItem[];
  nextCursor: string | null;
  /** One count per tab for the same search and category filter. */
  counts: TabCounts;
}

export interface ProductListQuery {
  /** English name (contains), barcode (prefix) or SKU (exact). */
  q?: string;
  tab?: ProductTab;
  categoryId?: string;
  subcategoryId?: string;
  cursor?: string;
  limit?: number;
}

export interface CategoryName {
  id: string;
  nameEn: string;
  nameAr: string | null;
}

export interface ProductListing {
  marketplaceId: string;
  marketplaceProductId: string | null;
  price: number;
  available: boolean;
  updatedAt: string;
}

export interface ProductDetail extends ProductItem {
  size: string | null;
  erpActive: boolean;
  createdAt: string;
  category: CategoryName | null;
  subcategory: CategoryName | null;
  listings: ProductListing[];
}

export interface UpdateProductRequest {
  /** Empty string clears it. */
  nameAr?: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  /** `new` cannot be set. Activating needs products.activate and a ready product. */
  status?: 'active' | 'inactive';
  /** The product's updatedAt as loaded: the backend answers 409 when it has changed since. */
  expectedUpdatedAt?: string;
}

export type ActivateRequest = { ids: string[] } | { all: true };

export interface ActivateResult {
  activated: number;
  /** The first 200 skipped products. */
  skipped: { id: string; reason: string }[];
  skippedCount: number;
}

export const productsApi = {
  list: (query: ProductListQuery = {}, signal?: AbortSignal) =>
    api<ProductPage>('/api/products', {
      signal,
      query: {
        q: query.q?.trim() || undefined, tab: query.tab, categoryId: query.categoryId, subcategoryId: query.subcategoryId,
        cursor: query.cursor, limit: query.limit,
      },
    }),
  get: (id: string, signal?: AbortSignal) => api<ProductDetail>(`/api/products/${enc(id)}`, { signal }),
  /** Replies with the updated product detail. */
  update: (id: string, body: UpdateProductRequest) => api<ProductDetail>(`/api/products/${enc(id)}`, { method: 'PATCH', body }),
  activate: (body: ActivateRequest) => api<ActivateResult>('/api/products/activate', { method: 'POST', body }),
};

/** Same default rule as the backend (Arabic name and category); the backend decides, this only labels rows. */
export function readinessGaps(p: Pick<ProductItem, 'nameAr' | 'categoryId'>): string[] {
  const gaps: string[] = [];
  if (!p.nameAr?.trim()) gaps.push('Arabic name missing');
  if (!p.categoryId) gaps.push('Category missing');
  return gaps;
}
