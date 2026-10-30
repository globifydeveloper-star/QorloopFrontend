import type { ViewType } from '../types';
import { realUploadsEnabled } from '../lib/features';

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
  categories: '/categories',
  'category-detail': '/categories/:id',
  markups: '/pricing',
  'category-mapping': '/settings/category-mapping',
  templates: '/settings/file-mappings',
  'outputs-generate': '/files',
  onboarding: '/onboarding',
  settings: '/settings',
  team: '/settings/team',
};

export function pathFor(view: ViewType, id?: string): string {
  const p = PATHS[view];
  return p.includes(':id') ? p.replace(':id', encodeURIComponent(id ?? '')) : p;
}

/** Canonical view for each static path (a few views share a URL). */
const STATIC: [string, ViewType][] = [
  ['/', 'dashboard'], ['/uploads', 'uploads'], ['/uploads/review', 'upload-review'], ['/uploads/mapping', 'column-mapping'],
  ['/reports/stock', 'reports-stock'], ['/reports/price', 'reports-price-discrepancies'],
  ['/catalogue', 'catalogue'], ['/catalogue/new', 'new-products'], ['/categories', 'categories'],
  ['/pricing', 'markups'], ['/settings/category-mapping', 'category-mapping'], ['/settings/file-mappings', 'templates'],
  ['/files', 'outputs-generate'], ['/onboarding', 'onboarding'], ['/settings', 'settings'], ['/settings/team', 'team'],
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
]);

/** UI hint only (the server decides): permission a role needs to see each screen in the navigation. */
export const VIEW_PERMISSION: Partial<Record<ViewType, string>> = {
  uploads: 'uploads.view', 'upload-review': 'uploads.view', 'column-mapping': 'uploads.map',
  'reports-stock': 'reports.view', 'reports-price-discrepancies': 'reports.view',
  catalogue: 'products.view', 'product-detail': 'products.view', 'new-products': 'products.view',
  markups: 'pricing.view', 'category-mapping': 'categories.manage', templates: 'uploads.view',
  'outputs-generate': 'files.view', settings: 'settings.view', team: 'team.view',
};
