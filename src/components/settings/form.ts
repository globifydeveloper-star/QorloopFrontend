import type { StoreSettings, UpdateStoreSettings } from '../../api/settings';

export interface SettingsDraft {
  name: string; priceTolerance: string; stockThreshold: string; staleDays: string;
  analystCanExport: boolean; mfaRequiredForAll: boolean;
}
export const settingsDraft = (s: StoreSettings): SettingsDraft => ({
  name: s.profile.name, priceTolerance: String(s.thresholds.priceTolerance), stockThreshold: String(s.thresholds.stockThreshold),
  staleDays: String(s.thresholds.staleHours / 24), ...s.security,
});

/** Build only documented changed fields. Never include the Owner-only policy for another role. */
export function settingsChanges(s: StoreSettings, d: SettingsDraft, editable: boolean, security: boolean) {
  const errors: Record<string, string> = {};
  const body: UpdateStoreSettings = { expectedRevision: s.revision };
  if (!editable) return { errors, body, dirty: false };
  const name = d.name.trim();
  if (!name || name.length > 100) errors.name = 'Enter a store name with 1 to 100 characters.';
  const price = Number(d.priceTolerance);
  if (!d.priceTolerance.trim() || !Number.isFinite(price) || price < 0 || price > 100000 || Math.abs(price * 1000 - Math.round(price * 1000)) >= 1e-6)
    errors.priceTolerance = 'Enter 0 to 100000 QAR, with at most 3 decimal places.';
  const stock = Number(d.stockThreshold);
  if (!d.stockThreshold.trim() || !Number.isInteger(stock) || stock < 0 || stock > 2147483647)
    errors.stockThreshold = 'Enter a whole number from 0 to 2147483647.';
  const hours = Number(d.staleDays) * 24;
  if (!d.staleDays.trim() || !Number.isFinite(hours) || Math.abs(hours - Math.round(hours)) > 1e-6 || Math.round(hours) < 1 || Math.round(hours) > 8760)
    errors.staleDays = 'Enter days equal to a whole number of hours, from 1 hour to 365 days.';
  if (name !== s.profile.name) body.profile = { name };
  const thresholds: NonNullable<UpdateStoreSettings['thresholds']> = {};
  if (price !== s.thresholds.priceTolerance) thresholds.priceTolerance = price;
  if (stock !== s.thresholds.stockThreshold) thresholds.stockThreshold = stock;
  if (Math.round(hours) !== s.thresholds.staleHours) thresholds.staleHours = Math.round(hours);
  if (Object.keys(thresholds).length) body.thresholds = thresholds;
  const policies: NonNullable<UpdateStoreSettings['security']> = {};
  if (d.analystCanExport !== s.security.analystCanExport) policies.analystCanExport = d.analystCanExport;
  if (security && d.mfaRequiredForAll !== s.security.mfaRequiredForAll) policies.mfaRequiredForAll = d.mfaRequiredForAll;
  if (Object.keys(policies).length) body.security = policies;
  return { body, errors, dirty: Object.keys(body).length > 1 };
}
