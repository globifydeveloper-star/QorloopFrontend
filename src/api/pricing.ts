import { api } from './client';
import type { CategoryName } from './products';

/**
 * Pricing API (/api/pricing…, /api/products/:id/{price-rule,offer}). Mirrors the backend's pricing module:
 *   packages/shared/src/contracts.ts (priceRule, updatePricingSettings, categoryPriceRule, categoryPriceRuleKey, productOffer, adoptPrices)
 *   packages/core/src/pricing.ts (PRICE_RULE_ORDER, chain statuses), packages/core/src/price-adoption.ts (modes, skip reasons)
 *   apps/api/src/pricing/pricing.service.ts, pricing.data.ts and price-adoption.ts (responses)
 *   inline edit and bulk changes: contracts.ts (inlinePrice, inlinePriceRemove, bulkPricePreview, bulkPriceApply),
 *   core price-change.ts (limits, actions, block reasons), bulk-pricing.ts and docs/decisions/013-bulk-price-changes.md
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

// ── Inline price edit of one product, seen from one marketplace (PUT/DELETE /api/pricing/products/:id) ──
// Mirrors contracts.ts inlinePrice / inlinePriceRemove and pricing.data.ts marketplacePricingView (ADR 013).

/** The highest price an inline or bulk change may set (core price-change.ts PRICE_CHANGE_MAX). */
export const PRICE_CHANGE_MAX = 100_000;
/** Inline percent: over the ERP price, rounded by the store's rounding step. */
export const INLINE_PERCENT_MIN = -90;
export const INLINE_PERCENT_MAX = 1000;

export type InlinePriceMode = 'fixed' | 'percent';

export interface InlinePriceRequest {
  /** Must be enabled for the store: the price is validated, computed and shown on it. */
  marketplaceId: PricingMarketplaceId;
  mode: InlinePriceMode;
  /** fixed: 0 < value <= 100,000 QAR; percent: -90..1000. At most 3 decimals. */
  value: number;
  /** rule.updatedAt as last seen; null = "I saw no rule"; omitted = no check. A different current rule answers 409. */
  expectedRuleUpdatedAt?: string | null;
}

export interface InlinePriceRemoveQuery {
  marketplaceId: PricingMarketplaceId;
  /** rule.updatedAt as last seen (no null on a query string: omit it when there was no rule). */
  expectedRuleUpdatedAt?: string;
}

/** The answer of both inline calls: the product's price on marketplaceId before and after, and on every enabled marketplace. */
export interface InlinePricing {
  productId: string;
  marketplaceId: PricingMarketplaceId;
  erpPrice: number;
  /** The price on marketplaceId before this request. */
  previous: MarketplacePrice;
  /** The price on marketplaceId now (the per-marketplace step included). */
  resolved: MarketplacePrice;
  /** The product's own rule; its updatedAt is the next expectedRuleUpdatedAt. */
  rule: (PriceRule & { updatedAt: string }) | null;
  /** The rule order for marketplaceId. */
  chain: PriceChainStep[];
  /** The price on every enabled marketplace: a product rule applies to all of them. */
  marketplaces: { marketplaceId: PricingMarketplaceId; price: number; source: PriceSource }[];
  /** false when the rule was already this one (or, on DELETE, there was none). */
  changed: boolean;
}

// ── Bulk price changes (POST /api/pricing/bulk/preview and /apply; pricing.bulk) ──
// Mirrors contracts.ts bulkSelection / bulkAction / bulkPricePreview / bulkPriceApply, core price-change.ts and
// apps/api/src/pricing/bulk-pricing.ts (responses).

/** Products one bulk change may touch, whatever the outcome (BULK_PRICE_LIMIT). */
export const BULK_PRICE_LIMIT = 5_000;
/** Explicit ids per request (the API's 32 KB body limit); larger selections use a filter. */
export const BULK_PRODUCT_IDS_MAX = 500;
export const BULK_PERCENT_INCREASE_MAX = 1000;
export const BULK_PERCENT_DECREASE_MAX = 90;
/** none keeps whole fils (0.001 QAR); otherwise the nearest step, halves up. */
export const BULK_ROUNDINGS = ['none', '0.05', '0.25'] as const;
export type BulkRounding = (typeof BULK_ROUNDINGS)[number];

export const BULK_ACTION_TYPES = [
  'set_fixed', 'increase_percent', 'decrease_percent', 'increase_amount', 'decrease_amount', 'match_marketplace', 'match_erp',
] as const;
export type BulkActionType = (typeof BULK_ACTION_TYPES)[number];

export type BulkAction =
  | { type: 'set_fixed'; price: number }
  | { type: 'increase_percent' | 'decrease_percent'; percent: number; rounding: BulkRounding }
  | { type: 'increase_amount' | 'decrease_amount'; amount: number; rounding: BulkRounding }
  | { type: 'match_marketplace' }
  | { type: 'match_erp' };

/** A recon status of the stored row on the operation's marketplace, or price_mismatch for the reference. */
export type BulkReconFilter = 'price_mismatch' | 'in_sync' | 'mismatch' | 'not_listed' | 'missing_from_erp' | 'new' | 'no_data';

export type BulkSelection =
  /** Explicit products (ticked rows): 1..500; unknown ids count as blocked not_found, inactive ones as not_active. */
  | { productIds: string[] }
  /** Every ACTIVE product matching all given conditions ({} = every active product); at most BULK_PRICE_LIMIT. */
  | { filter: {
    /** The product list's search. */
    q?: string;
    categoryId?: string;
    subcategoryId?: string;
    listed?: boolean;
    reconStatus?: BulkReconFilter;
    reference?: CompareReferenceDefault;
  } };

export interface BulkPriceRequest {
  marketplaceId: PricingMarketplaceId;
  selection: BulkSelection;
  action: BulkAction;
}

export interface BulkApplyRequest extends BulkPriceRequest {
  /** One per intended change (8-100 of A-Za-z0-9_-): the same key and body answers the first result again. */
  idempotencyKey: string;
  /** From the preview: 409 when the re-planned writes differ. */
  previewToken?: string;
}

export const BULK_BLOCK_REASONS = [
  'not_found', 'not_active', 'offer_active', 'no_listing', 'non_positive_listing_price', 'non_positive_erp_price',
  'price_not_positive', 'price_too_high', 'unverifiable',
] as const;
export type BulkBlockReason = (typeof BULK_BLOCK_REASONS)[number];

export interface BulkCounts {
  /** willChange + unchanged + blocked. */
  selected: number;
  willChange: number;
  unchanged: number;
  blocked: number;
  /** Only reasons with a count; message is plain words from the server. */
  blockedReasons: { reason: BulkBlockReason; message: string; count: number }[];
  /** Changed products whose price also moves on another enabled marketplace (a product rule applies to all). */
  otherMarketplaces: { marketplaceId: PricingMarketplaceId; products: number }[];
}

export interface BulkPriceRow {
  productId: string;
  nameEn: string;
  barcode: string;
  marketplaceId: PricingMarketplaceId;
  /** Resolved price on marketplaceId now. */
  oldPrice: number;
  oldSource: PriceSource;
  newPrice: number;
  newSource: PriceSource;
  /** newPrice - oldPrice. */
  difference: number;
  previousRule: PriceRule | null;
  /** null = the product rule is removed (match_erp). */
  rule: PriceRule | null;
}

export interface BulkPreview extends BulkCounts {
  marketplaceId: PricingMarketplaceId;
  action: BulkAction;
  selection: BulkSelection;
  /** Only with a reconStatus filter: the reference it read. */
  reference?: CompareReferenceDefault;
  limit: number;
  largestIncrease: BulkPriceRow | null;
  largestDecrease: BulkPriceRow | null;
  /** The first changes (at most 10), in product list order. */
  rows: BulkPriceRow[];
  /** Send it with apply. */
  previewToken: string;
}

export interface BulkApplyResult extends BulkCounts {
  /** The 'pricing.bulk_applied' audit event. */
  operationId: string;
  /** true: this idempotency key was already applied; nothing was written again. */
  replayed: boolean;
  appliedAt: string;
  /** Rules created (the product had none). */
  created: number;
  replaced: number;
  /** Rules removed (match_erp). */
  removed: number;
}

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
  /** pricing.edit. Active products only; 400 for a disabled marketplace, a running offer or a price out of range; 409 stale. */
  setInlinePrice: (id: string, body: InlinePriceRequest) =>
    api<InlinePricing>(`/api/pricing/products/${enc(id)}`, { method: 'PUT', body }),
  /** pricing.edit. Removes the product's own rule; with no rule it answers changed: false. */
  removeInlinePrice: (id: string, q: InlinePriceRemoveQuery) =>
    api<InlinePricing>(`/api/pricing/products/${enc(id)}`, {
      method: 'DELETE', query: { marketplaceId: q.marketplaceId, expectedRuleUpdatedAt: q.expectedRuleUpdatedAt },
    }),
  /** pricing.bulk. Writes nothing. */
  bulkPreview: (body: BulkPriceRequest) => api<BulkPreview>('/api/pricing/bulk/preview', { method: 'POST', body }),
  /** pricing.bulk. Re-planned from current data; a replay of the same key and body answers replayed: true. */
  bulkApply: (body: BulkApplyRequest) => api<BulkApplyResult>('/api/pricing/bulk/apply', { method: 'POST', body }),
};
