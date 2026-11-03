import { api } from './client';
import type { PricingMarketplaceId, PricingSettings, UpdatePricingSettings } from './pricing';

/** Mirrors backend updateTenantSettings and GET /api/settings; revision is opaque. */
export interface StoreSettings {
  profile: { name: string };
  timeZone: 'Asia/Qatar';
  currency: 'QAR';
  thresholds: { priceTolerance: number; stockThreshold: number; staleHours: number };
  security: { mfaRequiredForAll: boolean; analystCanExport: boolean };
  pricing: PricingSettings;
  revision: string;
}
export interface UpdateStoreSettings {
  expectedRevision: string;
  profile?: { name: string };
  thresholds?: Partial<StoreSettings['thresholds']>;
  security?: Partial<StoreSettings['security']>;
  pricing?: UpdatePricingSettings;
}
export interface EnabledMarketplace {
  marketplaceId: PricingMarketplaceId;
  enabled: true;
  hasData: boolean;
  lastUploadAt: string | null;
  ageHours: number | null;
}
export const SETTINGS_KEY = ['settings'] as const;
export const settingsApi = {
  get: (signal?: AbortSignal) => api<StoreSettings>('/api/settings', { signal }),
  update: (body: UpdateStoreSettings) => api<StoreSettings>('/api/settings', { method: 'PUT', body }),
  marketplaces: (signal?: AbortSignal) => api<{ items: EnabledMarketplace[] }>('/api/settings/marketplaces', { signal }),
};
