import { api } from './client';

/** Mirrors backend GET/POST /api/store/reset (ADR 022). Owner only (permission store.reset). */
export interface StoreResetCounts {
  products: number;
  categories: number;
  uploads: number;
  generatedFiles: number;
  marketplaceListings: number;
  comparisonRows: number;
  priceRules: number;
  offers: number;
  exportValues: number;
  stockEdits: number;
  notifications: number;
  activityEntries: number;
  totalRows: number;
}
export interface StoreResetPreview {
  store: { name: string; slug: string };
  deletes: StoreResetCounts;
  inFlightUploads: number;
  blockedReason: string | null;
}
export interface StoreResetResult {
  eventId: string;
  deleted: StoreResetCounts;
  storageCleanup: 'queued' | 'not_queued';
}
export const STORE_RESET_KEY = ['store', 'reset'] as const;
export const storeResetApi = {
  preview: (signal?: AbortSignal) => api<StoreResetPreview>('/api/store/reset', { signal }),
  /** Needs a fresh single-use code: the API client opens "Confirm it's you" and sends this again. */
  reset: (confirmSlug: string) => api<StoreResetResult>('/api/store/reset', { method: 'POST', body: { confirmSlug } }),
};
