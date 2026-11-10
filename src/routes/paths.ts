import type { ViewType } from '../types';
import { realCatalogueEnabled, realFilesEnabled, realOnboardingEnabled, realPricingEnabled, realReconEnabled, realSettingsEnabled, realUploadsEnabled, realMarketplaceValuesEnabled } from '../lib/features';

/**
 * Real URLs for every screen. The existing views still call `navigate('<view>')`; AppContext translates that
 * to these paths, so Back, refresh and deep links work without rewriting each view.
 */
const PATHS: Record<ViewType, string> = {
  dashboard: '/',
  uploads: '/uploads',
  'upload-review': '/uploads/review',
  'column-mapping': '/uploads/mapping',
  reports: '/reports/stock',
  'reports-stock': '/reports/stock',
  'reports-price-discrepancies': '/reports/price',
  'reports-price-mismatches': '/reports/price',
  catalogue: '/catalogue',
  'product-detail': '/catalogue/:id',
  'new-product': '/catalogue/new',
  'new-products': '/catalogue/new',
  'stock-conflicts': '/catalogue/stock-conflicts',
  categories: '/categories',
  'category-detail': '/categories/:id',
  markups: '/pricing',
  templates: '/settings/file-mappings',
  'outputs-generate': '/files',
  onboarding: '/onboarding',
  settings: '/settings',
  activity: '/activity',
  team: '/settings/team',
  'how-it-works': '/how-it-works',
  'update-files': '/update-files',
};

export function pathFor(view: ViewType, id?: string): string {
  const p = PATHS[view];
  return p.includes(':id') ? p.replace(':id', encodeURIComponent(id ?? '')) : p;
}

/** URLs of screens that were removed. A bookmark or an old link to one goes to the Dashboard, never a blank page. */
export const RETIRED_PATHS: readonly string[] = ['/settings/category-mapping'];

/** Canonical view for each static path (a few views share a URL). */
const STATIC: [string, ViewType][] = [
  ['/', 'dashboard'], ['/uploads', 'uploads'], ['/uploads/review', 'upload-review'], ['/uploads/mapping', 'column-mapping'],
  ['/reports/stock', 'reports-stock'], ['/reports/price', 'reports-price-discrepancies'],
  ['/catalogue', 'catalogue'], ['/catalogue/new', 'new-products'], ['/catalogue/stock-conflicts', 'stock-conflicts'], ['/categories', 'categories'],
  ['/pricing', 'markups'], ['/settings/file-mappings', 'templates'],
  ['/files', 'outputs-generate'], ['/onboarding', 'onboarding'], ['/settings', 'settings'], ['/settings/team', 'team'],
  ['/activity', 'activity'], ['/how-it-works', 'how-it-works'], ['/update-files', 'update-files'],
];

export function matchView(pathname: string): { view: ViewType; id?: string } | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const hit = STATIC.find(([p]) => p === path);
  if (hit) return { view: hit[1] };
  let m = /^\/catalogue\/([^/]+)$/.exec(path);
  if (m) return { view: 'product-detail', id: decodeURIComponent(m[1]) };
  m = /^\/categories\/([^/]+)$/.exec(path);
  if (m) return { view: 'category-detail', id: decodeURIComponent(m[1]) };
  return null;
}

/**
 * Screens that read and write the real backend. Everything else still shows sample data from the demo
 * store until its endpoints exist; the shell says so on those screens instead of pretending.
 */
export const CONNECTED_VIEWS: ReadonlySet<ViewType> = new Set<ViewType>([
  'team',
  ...(realUploadsEnabled() ? (['uploads', 'upload-review', 'column-mapping'] as const) : []),
  ...(realCatalogueEnabled() ? (['catalogue', 'product-detail', 'new-products', 'stock-conflicts', 'categories', 'category-detail'] as const) : []),
  ...(realReconEnabled() ? (['dashboard', 'reports', 'reports-stock', 'reports-price-discrepancies'] as const) : []),
  ...(realPricingEnabled() ? (['markups'] as const) : []),
  ...(realFilesEnabled() ? (['outputs-generate'] as const) : []),
  ...(realSettingsEnabled() ? (['settings', 'activity'] as const) : []),
  ...(realOnboardingEnabled() ? (['onboarding'] as const) : []),
  ...(realMarketplaceValuesEnabled() ? (['update-files'] as const) : []),
]);

/**
 * Screens with fixed help text and no store data at all (no API call, no demo store), so the "Sample data" note does
 * not apply. They are open to every signed-in role: none of them is in VIEW_PERMISSION.
 */
export const STATIC_CONTENT_VIEWS: ReadonlySet<ViewType> = new Set<ViewType>(['how-it-works']);

/** UI hint only (the server decides): permission a role needs to see each screen in the navigation. */
export const VIEW_PERMISSION: Partial<Record<ViewType, string>> = {
  uploads: 'uploads.view', 'upload-review': 'uploads.view', 'column-mapping': 'uploads.map',
  'reports-stock': 'reports.view', 'reports-price-discrepancies': 'reports.view',
  catalogue: 'products.view', 'product-detail': 'products.view', 'new-products': 'products.view',
  categories: 'products.view', 'category-detail': 'products.view', 'stock-conflicts': 'products.view',
  markups: 'pricing.view', templates: 'uploads.view',
  'outputs-generate': 'files.view', settings: 'settings.view', team: 'team.view',
  activity: 'activity.view',
  onboarding: 'settings.view',
  'update-files': 'recon.view',
};
