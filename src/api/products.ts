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
  /** ADR 017: the stock recon and the generated files use (the owner value while an edit exists, else erpStock). */
  catalogueStock?: number;
  /** owner = a manual stock edit is in place. */
  catalogueStockSource?: 'erp' | 'owner';
  /** An ERP stock change met the owner value; it waits to be resolved. */
  stockConflict?: boolean;
  status: ProductStatus;
  inLatestErpFile: boolean;
  updatedAt: string;
  /** Present only for roles with pricing.view: the resolved Marketplace price and the rule step that chose it. */
  marketplacePrice?: MarketplacePrice;
  /**
   * Only when the list was asked with marketplaceId, and only from a backend that has the marketplace columns
   * (docs/products-api.md). Absent means "not available": show nothing extra.
   */
  marketplace?: ProductMarketplaceValues;
  /** Only with compareMarketplaceId: the same values on the second marketplace ("Compare with Talabat and Snoonu"). */
  compareMarketplace?: ProductMarketplaceValues;
}

/** "Only where they differ": compared with each other, not with the catalogue (backend docs/products-api.md). */
export type MarketplacesDiffer = 'any' | 'price' | 'availability';
export const MARKETPLACES_DIFFER: readonly MarketplacesDiffer[] = ['any', 'price', 'availability'];

export type MarketplaceComparison = 'in_sync' | 'mismatch' | 'not_in_file' | 'not_applicable';
/** The list filter: every comparison except not_applicable. */
export type MarketplaceStatusFilter = 'mismatch' | 'in_sync' | 'not_in_file';
export const MARKETPLACE_STATUS_FILTERS: readonly MarketplaceStatusFilter[] = ['mismatch', 'in_sync', 'not_in_file'];
export type MarketplaceStockIssue = 'available_but_out_of_stock' | 'unavailable_but_in_stock';
export type MarketplacePriceIssue = 'marketplace_price_higher' | 'marketplace_price_lower';

/** One product as seen on one marketplace (GET /api/products?marketplaceId=…). */
export interface ProductMarketplaceValues {
  marketplaceId: string;
  /** The comparison the status and issues use (the store default). */
  reference: 'marketplace' | 'erp';
  /** From the marketplace file; null when the product is not in the file. */
  available: boolean | null;
  /** QAR with 3 decimals as text ("12.500"); null when not in the file. */
  price: string | null;
  inFile: boolean;
  /** From the last recompute: right after an upload it can lag by one recompute (backend open gap G32). */
  comparison: MarketplaceComparison;
  stockIssue: MarketplaceStockIssue | null;
  priceIssue: MarketplacePriceIssue | null;
  /** When the file the values came from was uploaded; null when not in the file or not recorded (an older listing). */
  sourceUploadedAt: string | null;
}

const COMPARISONS: readonly MarketplaceComparison[] = ['in_sync', 'mismatch', 'not_in_file', 'not_applicable'];
const STOCK_ISSUES: readonly MarketplaceStockIssue[] = ['available_but_out_of_stock', 'unavailable_but_in_stock'];
const PRICE_ISSUES: readonly MarketplacePriceIssue[] = ['marketplace_price_higher', 'marketplace_price_lower'];
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  (allowed as readonly unknown[]).includes(v) ? (v as T) : null;

/**
 * The marketplace object as the client may trust it, or undefined. Anything not shaped like the contract counts as
 * "not available", so a backend without the columns (or a changed one) shows nothing extra instead of wrong values.
 * Unknown extra fields are ignored, as the contract asks.
 */
export function readMarketplaceValues(v: unknown): ProductMarketplaceValues | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const m = v as Record<string, unknown>;
  const comparison = oneOf(m.comparison, COMPARISONS);
  if (typeof m.marketplaceId !== 'string' || typeof m.inFile !== 'boolean' || !comparison) return undefined;
  const inFile = m.inFile;
  const price = inFile && typeof m.price === 'string' && m.price.trim() !== '' && Number.isFinite(Number(m.price)) ? m.price : null;
  const compared = comparison === 'in_sync' || comparison === 'mismatch';
  return {
    marketplaceId: m.marketplaceId,
    reference: m.reference === 'erp' ? 'erp' : 'marketplace',
    available: inFile && typeof m.available === 'boolean' ? m.available : null,
    price,
    inFile,
    comparison,
    // The contract: issues are null unless something was compared.
    stockIssue: compared ? oneOf(m.stockIssue, STOCK_ISSUES) : null,
    priceIssue: compared ? oneOf(m.priceIssue, PRICE_ISSUES) : null,
    sourceUploadedAt: inFile && typeof m.sourceUploadedAt === 'string' && !Number.isNaN(Date.parse(m.sourceUploadedAt)) ? m.sourceUploadedAt : null,
  };
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
  /** Adds each product's values on this marketplace (it must be enabled for the store, else 400). */
  marketplaceId?: string;
  /** Only with marketplaceId; narrows the items and the tab counts. */
  marketplaceStatus?: MarketplaceStatusFilter;
  /** Only with marketplaceId, and another marketplace: adds compareMarketplace to each product. */
  compareMarketplaceId?: string;
  /** Only with compareMarketplaceId: products where the two marketplaces differ, or that are on only one. */
  marketplacesDiffer?: MarketplacesDiffer;
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
  list: async (query: ProductListQuery = {}, signal?: AbortSignal): Promise<ProductPage> => {
    const marketplaceId = query.marketplaceId || undefined;
    const compareId = marketplaceId && query.compareMarketplaceId && query.compareMarketplaceId !== marketplaceId ? query.compareMarketplaceId : undefined;
    const page = await api<ProductPage>('/api/products', {
      signal,
      query: {
        q: query.q?.trim() || undefined, tab: query.tab, categoryId: query.categoryId, subcategoryId: query.subcategoryId,
        cursor: query.cursor, limit: query.limit,
        marketplaceId, marketplaceStatus: marketplaceId ? query.marketplaceStatus : undefined,
        compareMarketplaceId: compareId, marketplacesDiffer: compareId ? query.marketplacesDiffer : undefined,
      },
    });
    if (!marketplaceId) return page;
    // Values for another marketplace than the one asked for are not this column's.
    const forId = (v: unknown, id: string | undefined) => { const m = id ? readMarketplaceValues(v) : undefined; return m && m.marketplaceId === id ? m : undefined; };
    return {
      ...page,
      items: page.items.map(i => ({
        ...i, marketplace: forId(i.marketplace, marketplaceId),
        ...(compareId ? { compareMarketplace: forId(i.compareMarketplace, compareId) } : {}),
      })),
    };
  },
  get: (id: string, signal?: AbortSignal) => api<ProductDetail>(`/api/products/${enc(id)}`, { signal }),
  /** Replies with the updated product detail. */
  update: (id: string, body: UpdateProductRequest) => api<ProductDetail>(`/api/products/${enc(id)}`, { method: 'PATCH', body }),
  activate: (body: ActivateRequest) => api<ActivateResult>('/api/products/activate', { method: 'POST', body }),
};
