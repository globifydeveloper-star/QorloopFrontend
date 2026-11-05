import { api } from './client';
import type { MarketplacePrice, ProductPricing } from './pricing';

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
  /** Present only for roles with pricing.view: the resolved Marketplace price and the rule step that chose it. */
  marketplacePrice?: MarketplacePrice;
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
  /** Present only for roles with pricing.view: the rule chain that explains marketplacePrice. */
  pricing?: ProductPricing;
  /** Derived by the backend (a blank Arabic name counts as missing). Informational only: activation does not check it today. */
  arabicNameMissing: boolean;
  /** Derived by the backend. Informational only: activation does not check it today. */
  categoryMissing: boolean;
}

export interface UpdateProductRequest {
  /** Empty string clears it. */
  nameAr?: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  /** `new` cannot be set. Activating (also re-activating) needs products.activate; it does not need an Arabic name or a category. */
  status?: 'active' | 'inactive';
  /** The product's updatedAt as loaded: the backend answers 409 when it has changed since. */
  expectedUpdatedAt?: string;
}

export type ActivateRequest = { ids: string[] } | { all: true };

export interface ActivateResult {
  activated: number;
  /** How many of the activated products have no Arabic name (informational, never blocks). */
  arabicNameMissing: number;
  /** How many of the activated products have no category (informational, never blocks). */
  categoryMissing: number;
  /** The first 200 skipped products: unknown ids ("Not found") and products that are not new ("Not a new product"). */
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
