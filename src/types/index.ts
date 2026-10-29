export type ViewType =
  | 'dashboard'
  | 'uploads'
  | 'upload-review'
  | 'reports'
  | 'reports-stock'
  | 'reports-price-discrepancies'
  | 'reports-price-mismatches'
  | 'catalogue'
  | 'product-detail'
  | 'new-product'
  | 'categories'
  | 'category-detail'
  | 'markups'
  | 'category-mapping'
  | 'templates'
  | 'outputs-generate'
  | 'onboarding'
  | 'settings'
  | 'column-mapping'
  | 'new-products'
  | 'team';

export type MarketplaceId = 'talabat' | 'snoonu' | 'rafeeq' | 'keeta';

export interface MarketplaceConfig {
  id: MarketplaceId;
  name: string;
  shortName: string;
  initial: string;
  bgColor: string;
  textColor: string;
  status: 'active' | 'warning' | 'empty';
  updatedAt?: string;
  warningNote?: string;
}

export interface MarketplaceStatus {
  listed: boolean;
  price?: number;
  expectedPrice?: number;
  priceDiff?: number;
  stock?: number;
  erpStock?: number;
  stockDiff?: number;
  lastUpdated?: string;
  note?: 'Price and stock mismatch' | 'In sync' | 'Price mismatch' | 'Stock mismatch' | 'No file uploaded yet';
  /** @deprecated Per-marketplace pricing now lives in PricingSettings.marketplaceRules (advanced mode). */
  customMarkup?: number;
}

// ---------------------------------------------------------------------------
// Marketplace Price
// One price the retailer sells at on every marketplace. It is resolved in this
// order: offer price → product rule → category rule → (per-marketplace rule,
// advanced only) → default rule.
// ---------------------------------------------------------------------------

/**
 * percent: ERP × (1 + value / 100)
 * amount:  ERP + value (QAR)
 * fixed:   exactly value (QAR)
 * same:    same as ERP price
 */
export type PriceMode = 'percent' | 'amount' | 'fixed' | 'same';

export interface PriceRule {
  mode: PriceMode;
  value: number;
}

export type PriceSource = 'offer' | 'product' | 'category' | 'marketplace' | 'default';

/** What price reports and generated files compare marketplaces against. */
export type CompareReference = 'marketplace' | 'erp';

export type PriceRounding = 'Exact' | '0.25' | '0.50';

export interface MarketplacePriceRule {
  markup: number; // %
  rounding: PriceRounding;
  active: boolean;
}

export interface PricingSettings {
  defaultRule: PriceRule;
  rounding: PriceRounding;
  /** Advanced: allow a different price per marketplace. Off by default (price parity). */
  perMarketplaceEnabled: boolean;
  marketplaceRules: Record<MarketplaceId, MarketplacePriceRule>;
}

export interface CategoryPriceRule {
  id: string;
  category: string;
  rule: PriceRule;
}

export interface Product {
  id: string;
  sku: string;
  nameEn: string;
  nameAr: string;
  barcode: string;
  category: string;
  subcategory?: string;
  brand: string;
  size: string;
  unit: string;
  packSize: number;
  erpPrice: number;
  costPrice: number;
  /** @deprecated Use priceRule / Marketplace Price instead. Kept for older screens. */
  defaultMarkup: number;
  sellingPrice: number;
  erpStock: number;
  status: 'Active' | 'Inactive';
  isNew?: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  imageKey: string;
  marketplaces: Record<MarketplaceId, MarketplaceStatus>;
  /** Product-level Marketplace Price rule (overrides category and default rules). */
  priceRule?: PriceRule;
  /** Temporary offer price (clearance, near expiry). Can be below ERP. Wins over every rule. */
  offerPrice?: number;
  offerUntil?: string;
}

export interface CategoryItem {
  id: string;
  nameEn: string;
  nameAr: string;
  icon: string;
  productCount: number;
  activeCount: number;
  inactiveCount: number;
  status: 'Active' | 'Inactive';
  updatedAt: string;
  updatedBy: string;
  parentCategory?: string;
  subcategories: {
    id: string;
    name: string;
    count: number;
    icon?: string;
  }[];
}

export interface OutputFileRecord {
  id: string;
  generatedOn: string;
  marketplace: MarketplaceId;
  fileName: string;
  productsInFile: number;
  changes: number;
  generatedBy: string;
  status: 'Ready' | 'Processing' | 'Failed';
  fileType: 'Excel (.xlsx)' | 'CSV (.csv)';
  /** Which price the file was generated with. */
  priceReference?: CompareReference;
}

export interface TeamMember {
  id: string;
  email: string;
  role: 'Catalogue Manager' | 'Store Admin' | 'Viewer';
  status: 'Invited' | 'Active';
  invitedAt: string;
}
