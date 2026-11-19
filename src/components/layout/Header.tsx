import React from 'react';
import { Search, Bell, ChevronRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import { ViewType } from '../../types';
import { VIEW_PERMISSION } from '../../routes/paths';

/** A parent crumb: its label and the screen it opens. Every parent is a real screen, so every crumb can be clicked. */
type Crumb = { label: string; view: ViewType };

const WORKSPACE: Crumb = { label: 'Workspace', view: 'dashboard' };
const UPLOADS: Crumb = { label: 'Uploads', view: 'uploads' };
const REPORTS: Crumb = { label: 'Reports', view: 'reports-stock' };
const CATALOGUE: Crumb = { label: 'Catalogue', view: 'catalogue' };
const CATEGORIES: Crumb = { label: 'Categories', view: 'categories' };
const SETTINGS: Crumb = { label: 'Settings', view: 'settings' };

export const VIEW_TITLES: Record<ViewType, [Crumb, string]> = {
  dashboard: [WORKSPACE, 'Dashboard'],
  uploads: [WORKSPACE, 'Uploads'],
  'upload-review': [UPLOADS, 'Review upload'],
  'column-mapping': [UPLOADS, 'Match columns'],
  'update-files': [WORKSPACE, 'Update files'],
  'how-it-works': [WORKSPACE, 'How it works'],
  reports: [REPORTS, 'Stock mismatches'],
  'reports-stock': [REPORTS, 'Stock mismatches'],
  'reports-price-discrepancies': [REPORTS, 'Price discrepancies'],
  'reports-price-mismatches': [REPORTS, 'Price mismatches'],
  catalogue: [CATALOGUE, 'All products'],
  'product-detail': [CATALOGUE, 'Product'],
  'new-product': [CATALOGUE, 'New products'],
  'new-products': [CATALOGUE, 'New products'],
  'stock-conflicts': [CATALOGUE, 'Stock conflicts'],
  categories: [CATALOGUE, 'Categories'],
  'category-detail': [CATEGORIES, 'Category'],
  markups: [WORKSPACE, 'Pricing'],
  templates: [SETTINGS, 'Templates'],
  'outputs-generate': [WORKSPACE, 'Generated files'],
  settings: [WORKSPACE, 'Settings'],
  activity: [WORKSPACE, 'Activity'],
  team: [SETTINGS, 'Team'],
  onboarding: [WORKSPACE, 'Help & onboarding'],
};

export const Header: React.FC = () => {
  const { navigate, currentView } = useApp();
  const { can } = useAuth();

  const [parent, page] = VIEW_TITLES[currentView] ?? [WORKSPACE, ''];
  // A parent is a link unless it is this very screen or a screen this role cannot open (the server still enforces it).
  const guard = VIEW_PERMISSION[parent.view];
  const linkable = parent.view !== currentView && (!guard || can(guard));

  return (
    <header className="bg-white/90 backdrop-blur border-b border-gray-200 px-8 h-[68px] flex items-center justify-between gap-6 sticky top-0 z-10">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] text-gray-500 min-w-0">
        {linkable ? (
          <button
            type="button"
            onClick={() => navigate(parent.view)}
            className="truncate rounded hover:text-gray-900 hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D9A9]/50"
          >
            {parent.label}
          </button>
        ) : (
          <span className="truncate">{parent.label}</span>
        )}
        <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0" aria-hidden />
        <span aria-current="page" className="font-semibold text-gray-900 truncate">{page}</span>
      </nav>

      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="hidden lg:flex items-center gap-2.5 w-[340px] h-10 px-3 rounded-[10px] border border-gray-200 bg-gray-50 text-[13px] text-gray-400">
          <Search className="w-4 h-4" />
          <span className="flex-1 truncate">Search products, barcodes, files…</span>
          <kbd className="text-[11px] font-sans px-1.5 rounded-md border border-gray-200 bg-white text-gray-500">⌘K</kbd>
        </div>

        {/* Notifications */}
        <button
          onClick={() => navigate('dashboard')}
          title="Notifications"
          aria-label="Notifications"
          className="relative w-10 h-10 rounded-[10px] border border-gray-200 bg-white flex items-center justify-center text-gray-600 hover:bg-gray-50"
        >
          <Bell className="w-[18px] h-[18px]" />
        </button>
      </div>
    </header>
  );
};
