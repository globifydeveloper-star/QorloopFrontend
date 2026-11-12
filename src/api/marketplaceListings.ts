import { api } from './client';
import type { ReconMarketplaceId } from './recon';

export interface MarketplaceAvailabilityState {
  catalogueAvailable: boolean;
  override: { value: boolean; persistent: boolean } | null;
  version: { id: string; version: number } | null;
  blockedReason: string | null;
}

export interface MarketplaceListing {
  id: string;
  marketplaceProductId: string;
  name: string | null;
  barcodes: string[];
  price: number;
  available: boolean;
  updatedAt: string;
  product: { id: string; nameEn: string; barcode: string } | null;
  sourceFile: { id: string; fileName: string } | null;
  availabilityAdjustment: MarketplaceAvailabilityState | null;
}
export interface MarketplaceListingsPage {
  items: MarketplaceListing[];
  total: number;
  nextCursor: string | null;
  latestUpload: { id: string; fileName: string; appliedAt: string } | null;
}
export interface MarketplaceListingsFilter {
  marketplaceId: ReconMarketplaceId;
  q?: string;
  availability: 'all' | 'available' | 'unavailable';
  match: 'all' | 'matched' | 'unmatched';
}
export const marketplaceListingsApi = {
  list: (filter: MarketplaceListingsFilter, cursor?: string, signal?: AbortSignal) =>
    api<MarketplaceListingsPage>('/api/products/marketplace-listings', {
      signal, query: { ...filter, q: filter.q?.trim() || undefined, cursor, limit: 50 },
    }),
};

export interface AvailabilityChange {
  changed: boolean;
  item: {
    version: MarketplaceAvailabilityState['version'];
    values: { availability: { value: boolean; persistent: boolean; state: 'pending' | 'cleared' } | null };
  } | null;
}
const valuePath = (marketplaceId: string, productId: string) => `/api/marketplace-values/${encodeURIComponent(marketplaceId)}/products/${encodeURIComponent(productId)}`;
export const marketplaceAvailabilityApi = {
  set: (marketplaceId: string, productId: string, value: boolean, persistent: boolean, expected: MarketplaceAvailabilityState['version']) =>
    api<AvailabilityChange>(valuePath(marketplaceId, productId), { method: 'PUT', body: { values: { availability: { value, persistent } }, expected } }),
  reset: (marketplaceId: string, productId: string, expected: MarketplaceAvailabilityState['version']) =>
    api<AvailabilityChange>(valuePath(marketplaceId, productId), { method: 'DELETE', query: { fields: 'availability', ...(expected ? { expectedId: expected.id, expectedVersion: expected.version } : {}) } }),
};
