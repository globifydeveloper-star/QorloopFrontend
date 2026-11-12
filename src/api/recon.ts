import { api } from './client';

/**
 * Reconciliation API (/api/recon…). Mirrors the backend's recon module:
 *   packages/shared/src/contracts.ts (reconSummaryQuery, reconRowsQuery)
 *   packages/core/src/recon/status.ts (RECON_REFERENCES, RECON_STATUSES, STOCK_ISSUES)
 *   apps/api/src/recon/recon.service.ts and recon.controller.ts (responses)
 * Every count comes from the stored summary; the client never adds or derives one.
 */

export const RECON_MARKETPLACES = ['talabat', 'snoonu', 'rafeeq', 'keeta'] as const;
export type ReconMarketplaceId = (typeof RECON_MARKETPLACES)[number];

/** What a price is compared with: the resolved Marketplace price, or the ERP price. */
export const RECON_REFERENCES = ['marketplace', 'erp'] as const;
export type ReconReference = (typeof RECON_REFERENCES)[number];

export const RECON_STATUSES = ['in_sync', 'mismatch', 'not_listed', 'missing_from_erp', 'new', 'no_data'] as const;
export type ReconStatus = (typeof RECON_STATUSES)[number];

export const STOCK_ISSUES = ['available_but_out_of_stock', 'unavailable_but_in_stock'] as const;
export type StockIssue = (typeof STOCK_ISSUES)[number];

/** packages/core/src/pricing.ts PRICE_RULE_ORDER. */
export type ReconPriceSource = 'offer' | 'product' | 'subcategory' | 'category' | 'marketplace' | 'default';

export type ReconRowType = 'stock' | 'price' | 'all';

export interface ReconMarketplaceSummary {
  marketplaceId: ReconMarketplaceId;
  /** false: no applied upload yet (the counts mean "no data", not zeros). */
  hasData: boolean;
  stock: number;
  price: number;
  /** stock + price, computed by the backend; a product with both counts once in each. */
  total: number;
  listed: number;
  notListed: number;
  noData: number;
  missingFromErp: number;
  newCount: number;
  lastUploadAt: string | null;
  /** The latest applied upload is older than the store's staleHours setting. */
  stale: boolean;
}

export interface ReconSummary {
  reference: ReconReference;
  /** When the summaries were last recomputed. */
  computedAt: string | null;
  /** Open stock conflicts (ADR 017): the dashboard badge "N stock conflicts". Absent on a backend without the migration. */
  stockConflicts?: number;
  marketplaces: ReconMarketplaceSummary[];
}

export interface ReconRow {
  productId: string;
  barcode: string;
  sku: string | null;
  nameEn: string;
  nameAr: string | null;
  productStatus: string;
  erpStock: number;
  /** ADR 017 (absent on a backend without the migration): the catalogue stock, its source and an open conflict. */
  catalogueStock?: number;
  catalogueStockSource?: 'erp' | 'owner';
  stockConflict?: boolean;
  /** Availability by the catalogue stock (the marketplace reference), next to erpAvailable (the ERP reference). */
  catalogueAvailable?: boolean | null;
  stockIssueVsCatalogue?: StockIssue | null;
  stockIssueVsErp?: StockIssue | null;
  /** For the reference. */
  status: ReconStatus;
  stockIssue: StockIssue | null;
  /** For the reference. */
  priceMismatch: boolean;
  priceMismatchVsErp: boolean;
  priceMismatchVsMarketplace: boolean;
  /** erpPrice or marketplacePrice, by reference. */
  expectedPrice: number | null;
  erpPrice: number | null;
  marketplacePrice: number | null;
  marketplacePriceSource: ReconPriceSource | null;
  /** null: not listed. */
  actualPrice: number | null;
  erpAvailable: boolean | null;
  actualAvailable: boolean | null;
  lastUpdated: string;
  /**
   * PROPOSED (ADR 018, not in the backend yet; read with readValueItem / readMarketplaceSource from ./marketplaceValues):
   * the value the generated file writes, the last marketplace file with this listing, and what each field was compared with.
   */
  marketplaceValues?: unknown;
  marketplaceSource?: unknown;
  stockComparedWith?: 'catalogue' | 'erp' | 'pinned';
  priceComparedWith?: 'catalogue' | 'erp' | 'pinned';
}

export interface ReconRowsPage {
  reference: ReconReference;
  items: ReconRow[];
  nextCursor: string | null;
}

export interface ReconRowsQuery {
  marketplaceId: ReconMarketplaceId;
  type?: ReconRowType;
  status?: ReconStatus;
  reference?: ReconReference;
  cursor?: string;
  /** The backend accepts 1..200 (default 50). */
  limit?: number;
  /** PROPOSED (ADR 018): only rows in this export state; persistent narrows to pinned (true) or fix-once (false) values. */
  exportState?: string;
  persistent?: boolean;
}

export const RECON_PAGE_SIZE = 50;

export const reconApi = {
  /** Without a reference the backend uses the store's comparison default (pricing settings) and says which it used. */
  summary: (reference?: ReconReference, signal?: AbortSignal) =>
    api<ReconSummary>('/api/recon/summary', { signal, query: { reference } }),
  /** Urgent first (available but out of stock, then unavailable but in stock, then price), by keyset cursor. */
  rows: (q: ReconRowsQuery, signal?: AbortSignal) =>
    api<ReconRowsPage>('/api/recon/rows', {
      signal,
      query: { marketplaceId: q.marketplaceId, type: q.type, status: q.status, reference: q.reference, cursor: q.cursor, limit: q.limit,
        exportState: q.exportState, persistent: q.persistent === undefined ? undefined : String(q.persistent) },
    }),
  /** Needs pricing.edit. Queues one coalesced recompute of the store's rows and summaries. */
  recompute: () => api<{ queued: boolean }>('/api/recon/recompute', { method: 'POST' }),
};
