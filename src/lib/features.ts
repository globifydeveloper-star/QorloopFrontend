/**
 * Build-time feature flags (public VITE_ variables). Each one moves a screen from the local demo store to the real
 * backend; leave it unset and the screen keeps running on sample data.
 */

/** Uploads, column mapping, review and upload history use /api/uploads. Default off. */
export const realUploadsEnabled = (): boolean => import.meta.env.VITE_REAL_UPLOADS === 'true';

/** Catalogue, product detail, new products and categories use /api/products and /api/categories. Default off. */
export const realCatalogueEnabled = (): boolean => import.meta.env.VITE_REAL_CATALOGUE === 'true';
