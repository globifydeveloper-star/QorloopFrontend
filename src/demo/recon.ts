// The mismatch engine. Every screen reads its numbers from here, so they always agree.
import { expectedPrice, round2 } from './pricing';
import { DemoState, Listing, Marketplace, MarketplaceId, Product, UploadRecord } from './types';

export type RowStatus =
  | 'in_sync'
  | 'mismatch' // price and/or availability differs
  | 'not_listed' // active product with no listing on this marketplace
  | 'missing_from_erp' // listed, but not in the latest ERP file
  | 'new' // arrived from the ERP, not activated yet
  | 'no_data'; // marketplace has no file yet

export type StockIssue =
  | 'unavailable_but_in_stock' // lost sales
  | 'available_but_out_of_stock' // customers can order stock that doesn't exist
  | null;

export interface ReconRow {
  product: Product;
  marketplaceId: MarketplaceId;
  listing: Listing | null;
  markupPct: number;
  markupIsOverride: boolean;
  expectedPrice: number;
  actualPrice: number | null;
  priceDiff: number | null; // actual - expected
  priceMismatch: boolean;
  erpAvailable: boolean;
  actualAvailable: boolean | null;
  stockIssue: StockIssue;
  status: RowStatus;
  lastUpdated: string | null; // upload time of the marketplace file
}

export interface MarketplaceSummary {
  marketplaceId: MarketplaceId;
  name: string;
  hasData: boolean;
  lastUpload: UploadRecord | null;
  isStale: boolean;
  hoursOld: number | null;
  stock: number;
  price: number;
  total: number; // stock + price (a product wrong on both counts once in each)
  productsWithIssues: number;
  notListed: number;
  missingFromErp: number;
  listed: number;
  inSync: number;
}

export function latestUpload(state: DemoState, source: UploadRecord['source']): UploadRecord | null {
  return (
    state.uploads
      .filter((u) => u.source === source && u.status === 'applied')
      .sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt))[0] ?? null
  );
}

export function hoursBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 3_600_000;
}

export function isStale(state: DemoState, source: UploadRecord['source']): boolean {
  const u = latestUpload(state, source);
  return !u || hoursBetween(u.uploadedAt, state.now) > state.settings.staleHours;
}

export function markupFor(state: DemoState, productId: string, mp: Marketplace): { pct: number; override: boolean } {
  const o = state.markups.find((m) => m.productId === productId && m.marketplaceId === mp.id);
  return o ? { pct: o.markupPct, override: true } : { pct: mp.defaultMarkupPct, override: false };
}

export function erpAvailable(state: DemoState, p: Product): boolean {
  return p.status === 'active' && p.erpActive && p.inLatestErpFile && p.erpStock > state.settings.stockThreshold;
}

/** Build a lookup so rows can be computed in O(1). */
function listingIndex(state: DemoState): Map<string, Listing> {
  const m = new Map<string, Listing>();
  for (const l of state.listings) m.set(l.productId + '|' + l.marketplaceId, l);
  return m;
}

export function reconRow(state: DemoState, product: Product, mpId: MarketplaceId, idx?: Map<string, Listing>): ReconRow {
  const mp = state.marketplaces.find((m) => m.id === mpId)!;
  const listing = (idx ?? listingIndex(state)).get(product.id + '|' + mpId) ?? null;
  const { pct, override } = markupFor(state, product.id, mp);
  const exp = expectedPrice(product.erpPrice, pct, state.settings.roundingStep);
  const up = latestUpload(state, mpId);
  const avail = erpAvailable(state, product);
  const base: ReconRow = {
    product, marketplaceId: mpId, listing, markupPct: pct, markupIsOverride: override, expectedPrice: exp,
    actualPrice: listing?.price ?? null, priceDiff: listing ? round2(listing.price - exp) : null, priceMismatch: false,
    erpAvailable: avail, actualAvailable: listing?.available ?? null, stockIssue: null, status: 'in_sync',
    lastUpdated: up?.uploadedAt ?? null,
  };

  if (!up) return { ...base, status: 'no_data', actualPrice: null, priceDiff: null, actualAvailable: null };
  if (product.status === 'new') return { ...base, status: 'new' };
  if (!listing) {
    const shouldBeListed = product.status === 'active' && product.inLatestErpFile && product.erpActive;
    return { ...base, status: shouldBeListed ? 'not_listed' : 'in_sync' };
  }
  if (!product.inLatestErpFile) {
    // Still sold on the marketplace although the ERP no longer has it.
    return { ...base, status: 'missing_from_erp', stockIssue: listing.available ? 'available_but_out_of_stock' : null };
  }

  const priceMismatch = Math.abs(listing.price - exp) > state.settings.priceTolerance + 1e-9;
  let stockIssue: StockIssue = null;
  if (avail && !listing.available) stockIssue = 'unavailable_but_in_stock';
  if (!avail && listing.available) stockIssue = 'available_but_out_of_stock';
  return { ...base, priceMismatch, stockIssue, status: priceMismatch || stockIssue ? 'mismatch' : 'in_sync' };
}

/** All product × marketplace rows. */
export function allRows(state: DemoState): ReconRow[] {
  const idx = listingIndex(state);
  const rows: ReconRow[] = [];
  const enabledMps = state.marketplaces.filter((m) => m.enabled);
  for (const p of state.products) for (const mp of enabledMps) rows.push(reconRow(state, p, mp.id, idx));
  return rows;
}

export function rowsForProduct(state: DemoState, productId: string): ReconRow[] {
  const p = state.products.find((x) => x.id === productId);
  if (!p) return [];
  const idx = listingIndex(state);
  return state.marketplaces.filter((m) => m.enabled).map((mp) => reconRow(state, p, mp.id, idx));
}

export function stockMismatches(state: DemoState, mp?: MarketplaceId): ReconRow[] {
  return allRows(state).filter((r) => r.stockIssue && r.status !== 'missing_from_erp' && (!mp || r.marketplaceId === mp));
}

export function priceMismatches(state: DemoState, mp?: MarketplaceId): ReconRow[] {
  return allRows(state).filter((r) => r.priceMismatch && (!mp || r.marketplaceId === mp));
}

export function summarize(state: DemoState): Record<MarketplaceId, MarketplaceSummary> {
  const rows = allRows(state);
  const out = {} as Record<MarketplaceId, MarketplaceSummary>;
  for (const mp of state.marketplaces.filter((m) => m.enabled)) {
    const r = rows.filter((x) => x.marketplaceId === mp.id);
    const up = latestUpload(state, mp.id);
    const hasData = !!up;
    const stock = r.filter((x) => x.stockIssue && x.status !== 'missing_from_erp').length;
    const price = r.filter((x) => x.priceMismatch).length;
    out[mp.id] = {
      marketplaceId: mp.id,
      name: mp.name,
      hasData,
      lastUpload: up,
      isStale: hasData && isStale(state, mp.id),
      hoursOld: up ? Math.round(hoursBetween(up.uploadedAt, state.now)) : null,
      stock,
      price,
      total: stock + price,
      productsWithIssues: r.filter((x) => x.status === 'mismatch').length,
      notListed: r.filter((x) => x.status === 'not_listed').length,
      missingFromErp: r.filter((x) => x.status === 'missing_from_erp').length,
      listed: r.filter((x) => x.listing).length,
      inSync: r.filter((x) => x.status === 'in_sync' && x.listing).length,
    };
  }
  return out;
}

export interface AttentionItem {
  id: string;
  tone: 'info' | 'warning' | 'error';
  title: string;
  detail: string;
  action: { label: string; target: 'new-products' | 'upload' | 'missing' | 'templates'; source?: UploadRecord['source'] };
}

/** "Needs attention" list for the dashboard, computed from data. */
export function needsAttention(state: DemoState): AttentionItem[] {
  const items: AttentionItem[] = [];
  const enabledSet = new Set(state.marketplaces.filter((m) => m.enabled).map((m) => m.id));

  if (!latestUpload(state, 'erp')) {
    items.push({ id: 'no-erp', tone: 'error', title: 'Upload your ERP file to start', detail: 'Qorloop compares your marketplace prices and stock against your ERP item list. Nothing can be checked until it is uploaded.', action: { label: 'Upload ERP file', target: 'upload', source: 'erp' } });
  }

  const newCount = state.products.filter((p) => p.status === 'new').length;
  if (newCount) items.push({ id: 'new', tone: 'info', title: `${newCount} new products from the ERP`, detail: 'Add Arabic name, category and markup, then activate them for marketplaces.', action: { label: 'Review', target: 'new-products' } });

  for (const src of ['erp', 'talabat', 'snoonu', 'rafeeq', 'keeta'] as const) {
    if (src !== 'erp' && !enabledSet.has(src)) continue;
    const u = latestUpload(state, src);
    const name = src === 'erp' ? `ERP (${state.tenant.erpName})` : state.marketplaces.find((m) => m.id === src)!.name;
    if (u && isStale(state, src)) {
      items.push({ id: 'stale-' + src, tone: 'warning', title: `${name} data is ${Math.round(hoursBetween(u.uploadedAt, state.now))} hours old`, detail: `Upload the latest ${name} file to keep mismatch counts accurate.`, action: { label: `Upload ${src === 'erp' ? 'ERP' : name} file`, target: 'upload', source: src } });
    }
  }

  const missing = state.products.filter((p) => !p.inLatestErpFile && state.listings.some((l) => l.productId === p.id && enabledSet.has(l.marketplaceId))).length;
  if (missing) items.push({ id: 'missing', tone: 'error', title: `${missing} products missing from the latest ERP file`, detail: 'They are still listed on marketplaces but no longer in your ERP file.', action: { label: 'Review', target: 'missing' } });

  for (const t of state.outputTemplates) {
    if (!enabledSet.has(t.marketplaceId)) continue;
    if (!t.configured && latestUpload(state, t.marketplaceId)) {
      const name = state.marketplaces.find((m) => m.id === t.marketplaceId)!.name;
      items.push({ id: 'tpl-' + t.marketplaceId, tone: 'warning', title: `${name} output template missing`, detail: `Add ${name}'s upload template so Qorloop can generate files for it.`, action: { label: 'Add template', target: 'templates' } });
    }
  }

  // Category mapping is not a dashboard task: Qorloop asks for a missing marketplace category
  // inline, only when someone generates a new-products file (Generate files → preview).
  return items;
}
