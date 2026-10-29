import React from 'react';
import { Search, Bell, ChevronRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import { ViewType } from '../../types';

const VIEW_TITLES: Partial<Record<ViewType, [string, string]>> = {
  dashboard: ['Workspace', 'Dashboard'],
  uploads: ['Workspace', 'Uploads'],
  'upload-review': ['Uploads', 'Review upload'],
  'column-mapping': ['Uploads', 'Match columns'],
  reports: ['Reports', 'Stock mismatches'],
  'reports-stock': ['Reports', 'Stock mismatches'],
  'reports-price-discrepancies': ['Reports', 'Price discrepancies'],
  'reports-price-mismatches': ['Reports', 'Price mismatches'],
  catalogue: ['Catalogue', 'All products'],
  'product-detail': ['Catalogue', 'Product'],
  'new-product': ['Catalogue', 'New products'],
  'new-products': ['Catalogue', 'New products'],
  categories: ['Catalogue', 'Categories'],
  'category-detail': ['Catalogue', 'Category'],
  markups: ['Catalogue', 'Marketplace price'],
  'category-mapping': ['Catalogue', 'Category mapping'],
  templates: ['Outputs', 'Templates'],
  'outputs-generate': ['Outputs', 'Generated files'],
  settings: ['Workspace', 'Settings'],
  team: ['Settings', 'Team'],
};

export const Header: React.FC = () => {
  const { navigate, currentView } = useApp();
  const { me } = useAuth();

  const [section, page] = VIEW_TITLES[currentView] || ['Workspace', me?.tenant.name ?? ''];

  return (
    <header className="bg-white/90 backdrop-blur border-b border-gray-200 px-8 h-[68px] flex items-center justify-between gap-6 sticky top-0 z-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-gray-500 min-w-0">
        <span className="truncate">{section}</span>
        <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
        <span className="font-semibold text-gray-900 truncate">{page}</span>
      </div>

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
