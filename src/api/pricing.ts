import { api } from './client';
import type { CategoryName } from './products';

/**
 * Pricing API (/api/pricing…, /api/products/:id/{price-rule,offer}). Mirrors the backend's pricing module:
 *   packages/shared/src/contracts.ts (priceRule, updatePricingSettings, categoryPriceRule, categoryPriceRuleKey, productOffer, adoptPrices)
 *   packages/core/src/pricing.ts (PRICE_RULE_ORDER, chain statuses), packages/core/src/price-adoption.ts (modes, skip reasons)
 *   apps/api/src/pricing/pricing.service.ts, pricing.data.ts and price-adoption.ts (responses)
 */

const enc = encodeURIComponent;

export const RULE_MODES = ['percent', 'amount', 'fixed', 'same'] as const;
export type RuleMode = (typeof RULE_MODES)[number];
export const ROUNDING_OPTIONS = ['exact', '0.05', '0.25', '0.50'] as const;
export type RoundingOption = (typeof ROUNDING_OPTIONS)[number];
export const PRICE_SOURCES = ['offer', 'product', 'subcategory', 'category', 'marketplace', 'default'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];
export type CompareReferenceDefault = 'marketplace' | 'erp';
export const PRICING_MARKETPLACES = ['talabat', 'snoonu', 'rafeeq', 'keeta'] as const;
export type PricingMarketplaceId = (typeof PRICING_MARKETPLACES)[number];

/** Flat {mode, value}; 'same' has no value on the wire, in either direction. */
export type PriceRule = { mode: 'same' } | { mode: Exclude<RuleMode, 'same'>; value: number };

export interface MarketplaceRule { marketplaceId: PricingMarketplaceId; mode: RuleMode; value?: number; rounding: RoundingOption }

export interface PricingSettings {
  defaultRule: PriceRule;
  rounding: RoundingOption;
  perMarketplaceEnabled: boolean;
  compareReferenceDefault: CompareReferenceDefault;
  marketplaceRules: MarketplaceRule[];
  /** The rule order, first wins. */
  order: PriceSource[];
  updatedAt: string | null;
}

export interface UpdatePricingSettings {
  defaultRule?: PriceRule;
  rounding?: RoundingOption;
  perMarketplaceEnabled?: boolean;
  compareReferenceDefault?: CompareReferenceDefault;
  /** The full set: a marketplace left out loses its rule. */
  marketplaceRules?: MarketplaceRule[];
}

export type CategoryRule = PriceRule & {
  categoryId: string;
  subcategoryId: string | null;
  category: CategoryName | null;
  subcategory: CategoryName | null;
  updatedAt: string;
};

export type SetCategoryRule = PriceRule & { categoryId: string; subcategoryId?: string | null };

// ── Product pricing (GET /api/products/:id with pricing.view, and every product rule / offer change) ──

export interface MarketplacePrice { price: number; source: PriceSource }

export type ChainStatus = 'applied' | 'overridden' | 'not_set' | 'expired' | 'scheduled' | 'disabled';
export type OfferState = 'valid' | 'scheduled' | 'expired';

export interface PriceChainStep {
  source: PriceSource;
  status: ChainStatus;
  price?: number;
  rule?: PriceRule;
  /** Only for percent and amount rules (calculated prices). */
  rounding?: RoundingOption;
  offer?: { price: number; validFrom: string | null; validUntil: string | null };
}

export interface ProductPricing {
  order: PriceSource[];
  productRule: (PriceRule & { updatedAt: string }) | null;
  offer: { price: number; validFrom: string | null; validUntil: string | null; updatedAt: string; state: OfferState } | null;
  chain: PriceChainStep[];
  /** Per-marketplace prices, only when per-marketplace pricing is on. */
  marketplaces: { marketplaceId: string; price: number; source: PriceSource }[];
}

export interface ProductPricingView { marketplacePrice: MarketplacePrice; pricing: ProductPricing }

export interface ProductOfferInput { price: number; validFrom?: string | null; validUntil?: string | null }

// ── Adopting the current marketplace prices ──

export const ADOPT_MODES = ['fixed', 'percent'] as const;
export type AdoptMode = (typeof ADOPT_MODES)[number];
export const ADOPT_SKIP_REASONS = [
  'no_listing', 'non_positive_erp_price', 'non_positive_listing_price', 'has_rule', 'has_offer', 'offer_active', 'unchanged', 'unverifiable',
] as const;
export type AdoptSkipReason = (typeof ADOPT_SKIP_REASONS)[number];

export interface AdoptRequest {
  sourceMarketplaceId: PricingMarketplaceId;
  mode: AdoptMode;
  /** Never overwrite a product's own rule or offer. */
  onlyWithoutRule: boolean;
  scope: { all: true } | { categoryId: string; subcategoryId?: string };
}

export interface AdoptCounts {
  products: number;
  adopted: number;
  /** Products that had no rule. */
  created: number;
  /** Products whose own rule is replaced (onlyWithoutRule false). */
  replaced: number;
  /** percent mode: products given a fixed rule because no percent reaches the listing price. */
  fixedFallback: number;
  fallbacks: { rounding: number; range: number };
  skipped: Record<AdoptSkipReason, number>;
  conflicts: { products: number; byMarketplace: Partial<Record<PricingMarketplaceId, number>> };
}

export interface AdoptRow {
  productId: string;
  nameEn: string;
  barcode: string;
  erpPrice: number;
  currentPrice: number;
  currentSource: PriceSource;
  newPrice: number;
  /** newPrice - currentPrice. */
  difference: number;
  rule: PriceRule;
  fallback: 'rounding' | 'range' | null;
  previousRule: PriceRule | null;
}

export interface AdoptConflictExample {
  productId: string; nameEn: string; barcode: string; marketplaceId: PricingMarketplaceId; sourcePrice: number; otherPrice: number;
}

export type AdoptPreview = Omit<AdoptCounts, 'adopted' | 'conflicts'> & {
  sourceMarketplaceId: PricingMarketplaceId;
  mode: AdoptMode;
  onlyWithoutRule: boolean;
  scope: AdoptRequest['scope'];
  willAdopt: number;
  conflicts: AdoptCounts['conflicts'] & { examples: AdoptConflictExample[] };
  /** At most 10. */
  largestDifferences: AdoptRow[];
  /** The first products adopted, in list order (at most 10). */
  rows: AdoptRow[];
};

export const pricingApi = {
  settings: (signal?: AbortSignal) => api<PricingSettings>('/api/pricing/settings', { signal }),
  updateSettings: (body: UpdatePricingSettings) => api<PricingSettings>('/api/pricing/settings', { method: 'PUT', body }),
  categoryRules: (signal?: AbortSignal) => api<CategoryRule[]>('/api/pricing/category-rules', { signal }),
  setCategoryRule: (body: SetCategoryRule) => api<PriceRule & { categoryId: string; subcategoryId: string | null }>('/api/pricing/category-rules', { method: 'PUT', body }),
  /** 404 when there is none. */
  deleteCategoryRule: (categoryId: string, subcategoryId?: string | null) =>
    api<{ categoryId: string; subcategoryId: string | null; deleted: true }>('/api/pricing/category-rules', {
      method: 'DELETE', query: { categoryId, subcategoryId: subcategoryId ?? undefined },
    }),
  /** Writes nothing. */
  adoptPreview: (body: AdoptRequest) => api<AdoptPreview>('/api/pricing/adopt/preview', { method: 'POST', body }),
  /** One transaction; a repeat adopts nothing. */
  adoptApply: (body: AdoptRequest) => api<AdoptCounts>('/api/pricing/adopt/apply', { method: 'POST', body }),
  setProductRule: (id: string, rule: PriceRule) => api<ProductPricingView>(`/api/products/${enc(id)}/price-rule`, { method: 'PUT', body: rule }),
  deleteProductRule: (id: string) => api<ProductPricingView>(`/api/products/${enc(id)}/price-rule`, { method: 'DELETE' }),
  setOffer: (id: string, offer: ProductOfferInput) => api<ProductPricingView>(`/api/products/${enc(id)}/offer`, { method: 'PUT', body: offer }),
  deleteOffer: (id: string) => api<ProductPricingView>(`/api/products/${enc(id)}/offer`, { method: 'DELETE' }),
};
