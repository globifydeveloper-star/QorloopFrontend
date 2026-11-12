import type { ViewType } from '../../types';
import { VIEW_PERMISSION } from '../../routes/paths';
import { realMarketplaceValuesEnabled, realSettingsEnabled } from '../../lib/features';

/**
 * The sidebar menu, in two groups. Which items a user sees is decided by permissions, never by role names.
 *
 * Each item needs two things:
 * - the permission that guards its screen (VIEW_PERMISSION, unchanged: a direct link still works the same way), and
 * - `menuPermission`: the permission for the work the item is for. A role that can only read (the Analyst holds
 *   uploads.view, files.view, products.view, pricing.view, settings.view and team.view) does not get Uploads,
 *   Generated files, Catalogue, Pricing, Settings or Team in its menu, but can still open those screens by link.
 *
 * The server still enforces every permission; this is only what the menu shows.
 */
export type NavGroupId = 'daily' | 'admin';

export interface NavEntry {
  label: string;
  view: ViewType;
  /** Permission for the item's own work. Omitted: the screen's own guard (VIEW_PERMISSION) is enough. */
  menuPermission?: string;
  /** Other views that keep this item highlighted (a report tab, a product page under Catalogue). */
  alsoActiveFor?: ViewType[];
  /** An extra build-time condition that already applied before the regrouping (Activity needs real settings). */
  enabled?: () => boolean;
}

export interface NavGroup {
  id: NavGroupId;
  title: string;
  items: NavEntry[];
}

/**
 * Review slot: the Daily work group gets a "Review" item (between Uploads and Generated files) once the app has a
 * /review/:marketplaceId route. The route does not exist yet, so the slot stays empty; add the entry here then.
 */
export const REVIEW_NAV_SLOT: NavEntry | null = null;

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'daily',
    title: 'Daily work',
    items: [
      { label: 'Dashboard', view: 'dashboard' },
      // The main screen: update the marketplace values and export the files (real backend only).
      { label: 'Update files', view: 'update-files', enabled: realMarketplaceValuesEnabled },
      { label: 'Uploads', view: 'uploads', menuPermission: 'uploads.upload', alsoActiveFor: ['upload-review', 'column-mapping'] },
      ...(REVIEW_NAV_SLOT ? [REVIEW_NAV_SLOT] : []),
      { label: 'Generated files', view: 'outputs-generate', menuPermission: 'files.generate' },
      { label: 'How it works', view: 'how-it-works' },
    ],
  },
  {
    id: 'admin',
    title: 'Admin',
    items: [
      {
        label: 'Catalogue', view: 'catalogue', menuPermission: 'products.edit',
        alsoActiveFor: ['product-detail', 'new-product', 'new-products', 'stock-conflicts', 'categories', 'category-detail'],
      },
      { label: 'Pricing', view: 'markups', menuPermission: 'pricing.edit' },
      { label: 'Reports', view: 'reports', menuPermission: 'reports.view', alsoActiveFor: ['reports-stock', 'reports-price-discrepancies', 'reports-price-mismatches'] },
      { label: 'Activity', view: 'activity', menuPermission: 'activity.view', enabled: realSettingsEnabled },
      { label: 'Templates', view: 'templates', menuPermission: 'uploads.map' },
      { label: 'Team', view: 'team', menuPermission: 'team.invite' },
      { label: 'Settings', view: 'settings', menuPermission: 'settings.edit' },
      { label: 'Help & onboarding', view: 'onboarding', menuPermission: 'settings.edit' },
    ],
  },
];

export const isEntryActive = (entry: NavEntry, current: ViewType) => entry.view === current || Boolean(entry.alsoActiveFor?.includes(current));

/** The groups and items this user sees; a group with no visible item is left out. */
export function visibleNav(can: (permission: string) => boolean): NavGroup[] {
  const shows = (e: NavEntry) => {
    const guard = VIEW_PERMISSION[e.view];
    return (!e.enabled || e.enabled()) && (!guard || can(guard)) && (!e.menuPermission || can(e.menuPermission));
  };
  return NAV_GROUPS.map(g => ({ ...g, items: g.items.filter(shows) })).filter(g => g.items.length > 0);
}

/** Where the Admin group's open/closed choice is kept, per user. */
export const adminOpenKey = (userId: string) => `qorloop.nav.adminOpen.${userId}`;

export function readAdminOpen(userId: string | undefined): boolean {
  if (!userId) return false;
  try {
    return window.localStorage.getItem(adminOpenKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function writeAdminOpen(userId: string | undefined, open: boolean): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(adminOpenKey(userId), open ? '1' : '0');
  } catch {
    // Storage blocked (private window, policy): the group still works, it just is not remembered.
  }
}
