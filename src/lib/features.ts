/**
 * Build-time feature flags (public VITE_ variables). Each one moves a screen from the local demo store to the real
 * backend; leave it unset and the screen keeps running on sample data.
 */

/** Uploads, column mapping, review and upload history use /api/uploads. Default off. */
export const realUploadsEnabled = (): boolean => import.meta.env.VITE_REAL_UPLOADS === 'true';

/** Catalogue, product detail, new products and categories use /api/products and /api/categories. Default off. */
export const realCatalogueEnabled = (): boolean => import.meta.env.VITE_REAL_CATALOGUE === 'true';

/** Dashboard and the Stock / Price reports use /api/recon (summary, rows, recompute). Default off. */
export const realReconEnabled = (): boolean => import.meta.env.VITE_REAL_RECON === 'true';

/**
 * Marketplace Price settings, category rules, the adopt-prices wizard, and the marketplace price / rule chain / product
 * rule / offer on the real catalogue use /api/pricing and /api/products/:id/{price-rule,offer}. Default off.
 */
export const realPricingEnabled = (): boolean => import.meta.env.VITE_REAL_PRICING === 'true';

/** Generate marketplace files and the generated-files history use /api/generated-files. Default off. */
export const realFilesEnabled = (): boolean => import.meta.env.VITE_REAL_FILES === 'true';

/** Store settings, activity log and real product history. Default off. */
export const realSettingsEnabled = (): boolean => import.meta.env.VITE_REAL_SETTINGS === 'true';

/** Derived Owner/Admin get-started checklist from /api/onboarding. Default off. */
export const realOnboardingEnabled = (): boolean => import.meta.env.VITE_REAL_ONBOARDING === 'true';

/**
 * "Update marketplace files" (/update-files) and the "Value to export" editor use the PROPOSED /api/marketplace-values
 * endpoints (ADR 018; not in the backend yet) next to /api/recon and /api/generated-files. Default off.
 */
export const realMarketplaceValuesEnabled = (): boolean => import.meta.env.VITE_REAL_MARKETPLACE_VALUES === 'true';
