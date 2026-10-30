import React, { useState } from 'react';
import {
  Search,
  Filter,
  Columns,
  ChevronDown,
  Plus,
  Upload,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Tag,
  Pencil,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import { ProductImage } from '../common/ProductImage';
import { PriceSourceChip } from '../common/PriceSourceChip';
import { BulkPriceModal } from '../modals/BulkPriceModal';
import { formatDiff, formatQar } from '../../lib/pricing';

export const CatalogueView: React.FC = () => {
  const { products, navigate, openUploadModal, showToast, getMarketplacePrice } = useApp();
  const { can } = useAuth();
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'inactive' | 'new'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('All categories');
  const [selectedBrand, setSelectedBrand] = useState('All brands');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [priceModal, setPriceModal] = useState<{
    open: boolean;
    ids: string[];
    tab: 'rule' | 'upload';
    category?: string;
  }>({ open: false, ids: [], tab: 'rule' });

  const filteredProducts = products.filter((p) => {
    if (activeTab === 'active' && p.status !== 'Active') return false;
    if (activeTab === 'inactive' && p.status !== 'Inactive') return false;
    if (activeTab === 'new' && !p.isNew) return false;

    if (
      searchTerm &&
      !p.nameEn.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !p.nameAr.includes(searchTerm) &&
      !p.barcode.includes(searchTerm)
    ) {
      return false;
    }

    if (selectedCategory !== 'All categories' && p.category !== selectedCategory) {
      return false;
    }

    if (selectedBrand !== 'All brands' && p.brand !== selectedBrand) {
      return false;
    }

    return true;
  });

  const allVisibleSelected =
    filteredProducts.length > 0 && filteredProducts.every((p) => selectedIds.includes(p.id));

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => prev.filter((id) => !filteredProducts.some((p) => p.id === id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...filteredProducts.map((p) => p.id)])));
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-150">
      {/* Title & Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Catalogue
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            All products in your Qorloop catalogue. Keep product details, categories and status
            up to date.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setPriceModal({ open: true, ids: [], tab: 'upload' })}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-xs"
          >
            <Tag className="w-3.5 h-3.5 text-gray-500" />
            <span>Bulk price update</span>
          </button>

          {can('uploads.upload') && (
            <button
              onClick={() => openUploadModal('erp')}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-xs"
            >
              <Upload className="w-3.5 h-3.5 text-gray-500" />
              <span>Import from ERP</span>
            </button>
          )}

          <button
            onClick={() => navigate('new-product')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5 text-white" />
            <span>Add product</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-gray-200 text-xs">
        <button
          onClick={() => setActiveTab('all')}
          className={`pb-3 font-semibold border-b-2 transition-colors ${activeTab === 'all'
              ? 'border-[#027864] text-[#027864]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
        >
          All products (12,480)
        </button>
        <button
          onClick={() => setActiveTab('active')}
          className={`pb-3 font-semibold border-b-2 transition-colors ${activeTab === 'active'
              ? 'border-[#027864] text-[#027864]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
        >
          Active (12,168)
        </button>
        <button
          onClick={() => setActiveTab('inactive')}
          className={`pb-3 font-semibold border-b-2 transition-colors ${activeTab === 'inactive'
              ? 'border-[#027864] text-[#027864]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
        >
          Inactive (312)
        </button>
        <button
          onClick={() => setActiveTab('new')}
          className={`pb-3 font-semibold border-b-2 transition-colors ${activeTab === 'new'
              ? 'border-[#027864] text-[#027864]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
        >
          New (18)
        </button>
      </div>

      {/* Main Content Grid: Table + Right Filter Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* Table Area (3 cols or 4 cols if filters hidden) */}
        <div
          className={`${showFilters ? 'lg:col-span-3' : 'lg:col-span-4'
            } bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden`}
        >
          {/* Controls Bar */}
          <div className="p-3.5 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by product name or barcode..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#027864]"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors ${showFilters
                    ? 'bg-gray-100 text-gray-900 border-gray-300'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
              >
                <Filter className="w-3.5 h-3.5 text-gray-500" />
                <span>Filters</span>
              </button>

              <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                <Columns className="w-3.5 h-3.5 text-gray-500" />
                <span>Columns</span>
                <ChevronDown className="w-3 h-3 text-gray-400" />
              </button>

              <select className="text-xs border border-gray-200 rounded-lg py-1.5 px-2 bg-white text-gray-700">
                <option>Show 25 rows</option>
                <option>Show 50 rows</option>
              </select>
            </div>
          </div>

          {/* Bulk selection bar */}
          {selectedIds.length > 0 && (
            <div className="px-3.5 py-2.5 border-b border-gray-200 bg-[#E3FAF3] flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-[#027864]">{selectedIds.length} selected</span>
                {selectedCategory !== 'All categories' && !allVisibleSelected && (
                  <button onClick={toggleAllVisible} className="text-[#027864] hover:underline">
                    Select all {filteredProducts.length} in {selectedCategory}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPriceModal({ open: true, ids: selectedIds, tab: 'rule' })}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg shadow-xs"
                >
                  <Tag className="w-3.5 h-3.5" />
                  <span>Update marketplace price</span>
                </button>
                <button
                  onClick={() => setSelectedIds([])}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <X className="w-3 h-3 text-gray-500" />
                  <span>Clear</span>
                </button>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                <tr>
                  <th className="py-2.5 px-3 w-8">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      className="rounded accent-[#027864]"
                    />
                  </th>
                  <th className="py-2.5 px-3 font-semibold">Product</th>
                  <th className="py-2.5 px-3 font-semibold">Barcode</th>
                  <th className="py-2.5 px-3 font-semibold">Category</th>
                  <th className="py-2.5 px-3 font-semibold">Brand</th>
                  <th className="py-2.5 px-3 font-semibold text-right">ERP price (QAR)</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Marketplace price (QAR)</th>
                  <th className="py-2.5 px-3 font-semibold text-center">Status</th>
                  <th className="py-2.5 px-3 font-semibold">Updated</th>
                  <th className="py-2.5 px-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredProducts.map((p) => {
                  const mp = getMarketplacePrice(p);
                  const diff = mp.price - p.erpPrice;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => navigate('product-detail', { productId: p.id })}
                      className={`hover:bg-gray-50/80 cursor-pointer transition-colors group ${selectedIds.includes(p.id) ? 'bg-[#F1FBF8]' : ''
                        }`}
                    >
                      <td
                        className="py-3 px-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(p.id)}
                          onChange={() => toggleSelected(p.id)}
                          className="rounded accent-[#027864]"
                        />
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-3">
                          <ProductImage imageKey={p.imageKey} size="sm" />
                          <div>
                            <div className="font-medium text-gray-900 group-hover:text-[#027864] transition-colors leading-tight">
                              {p.nameEn}
                            </div>
                            <div className="text-[11px] text-gray-500 font-arabic leading-tight">
                              {p.nameAr}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono text-gray-600">
                        {p.barcode}
                      </td>
                      <td className="py-3 px-3 text-gray-700">{p.category}</td>
                      <td className="py-3 px-3 text-gray-700">{p.brand}</td>
                      <td className="py-3 px-3 text-right font-semibold text-gray-900">
                        {p.erpPrice.toFixed(2)}
                      </td>
                      <td
                        className="py-3 px-3 text-right"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPriceModal({ open: true, ids: [p.id], tab: 'rule' });
                        }}
                        title="Edit marketplace price"
                      >
                        <div className="inline-flex flex-col items-end gap-0.5 rounded-md px-1.5 py-0.5 -mx-1.5 hover:bg-[#E3FAF3] group/price">
                          <div className="flex items-center gap-1">
                            <Pencil className="w-3 h-3 text-gray-300 group-hover/price:text-[#027864]" />
                            <span className="font-semibold text-gray-900">{formatQar(mp.price)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span
                              className={`text-[10px] ${diff < -0.004 ? 'text-emerald-600 font-semibold' : 'text-gray-400'
                                }`}
                            >
                              {formatDiff(diff)}
                            </span>
                            <PriceSourceChip source={mp.source} />
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${p.status === 'Active'
                              ? 'bg-[#E3FAF3] text-[#027864]'
                              : 'bg-gray-100 text-gray-600'
                            }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-gray-500 whitespace-nowrap">
                        {p.updatedAt}
                      </td>
                      <td
                        className="py-3 px-3 text-right"
                        onClick={(e) => {
                          e.stopPropagation();
                          showToast(`Actions for ${p.nameEn}`);
                        }}
                      >
                        <button className="text-gray-400 hover:text-gray-600 p-1">
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table Pagination */}
          <div className="p-3 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
            <span>Showing 1 to {filteredProducts.length} of 12,480 products</span>
            <div className="flex items-center gap-1">
              <button className="p-1 rounded hover:bg-gray-100 disabled:opacity-40">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button className="px-2 py-1 rounded bg-[#E3FAF3] font-bold text-[#027864]">
                1
              </button>
              <button className="px-2 py-1 rounded hover:bg-gray-100">2</button>
              <button className="px-2 py-1 rounded hover:bg-gray-100">3</button>
              <button className="px-2 py-1 rounded hover:bg-gray-100">4</button>
              <button className="px-2 py-1 rounded hover:bg-gray-100">5</button>
              <span className="px-1">...</span>
              <button className="px-2 py-1 rounded hover:bg-gray-100">500</button>
              <button className="p-1 rounded hover:bg-gray-100">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Filter Sidebar */}
        {showFilters && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">
                Filters
              </h3>
              <button
                onClick={() => {
                  setSelectedCategory('All categories');
                  setSelectedBrand('All brands');
                  setSearchTerm('');
                  showToast('Filters cleared');
                }}
                className="text-xs text-[#027864] hover:underline font-medium"
              >
                Clear all
              </button>
            </div>

            {/* Status Checkboxes */}
            <div className="space-y-1.5 text-xs">
              <div className="font-semibold text-gray-900">Status</div>
              <label className="flex items-center justify-between text-gray-700 cursor-pointer">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    defaultChecked
                    className="rounded accent-[#027864]"
                  />
                  <span>Active</span>
                </div>
                <span className="text-gray-400 text-[11px]">12,168</span>
              </label>
              <label className="flex items-center justify-between text-gray-700 cursor-pointer">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="rounded accent-[#027864]" />
                  <span>Inactive</span>
                </div>
                <span className="text-gray-400 text-[11px]">312</span>
              </label>
              <label className="flex items-center justify-between text-gray-700 cursor-pointer">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="rounded accent-[#027864]" />
                  <span>New</span>
                </div>
                <span className="text-gray-400 text-[11px]">18</span>
              </label>
            </div>

            {/* Category Dropdown */}
            <div className="space-y-1 text-xs">
              <div className="font-semibold text-gray-900">Category</div>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full border border-gray-200 rounded-lg p-2 text-xs bg-white text-gray-700"
              >
                <option>All categories</option>
                <option>Fruits & Vegetables</option>
                <option>Soft Drinks</option>
                <option>Dairy</option>
                <option>Snacks</option>
                <option>Confectionery</option>
                <option>Water</option>
                <option>Hot Beverages</option>
                <option>Cooking & Baking</option>
              </select>
              {selectedCategory !== 'All categories' && (
                <button
                  onClick={() =>
                    setPriceModal({ open: true, ids: [], tab: 'rule', category: selectedCategory })
                  }
                  className="text-[#027864] hover:underline font-medium"
                >
                  Update prices for {selectedCategory}
                </button>
              )}
            </div>

            {/* Brand Dropdown */}
            <div className="space-y-1 text-xs">
              <div className="font-semibold text-gray-900">Brand</div>
              <select
                value={selectedBrand}
                onChange={(e) => setSelectedBrand(e.target.value)}
                className="w-full border border-gray-200 rounded-lg p-2 text-xs bg-white text-gray-700"
              >
                <option>All brands</option>
                <option>Pepsi</option>
                <option>Baladna</option>
                <option>Lay's</option>
                <option>Almarai</option>
                <option>Snickers</option>
                <option>Al Ain</option>
                <option>Coca-Cola</option>
                <option>Nescafe</option>
                <option>Maggi</option>
                <option>Pringles</option>
              </select>
            </div>

            {/* Marketplace Status */}
            <div className="space-y-1.5 text-xs">
              <div className="font-semibold text-gray-900">Marketplace status</div>
              <label className="flex items-center justify-between text-gray-700 cursor-pointer">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="rounded accent-[#027864]" />
                  <span>Listed on all</span>
                </div>
                <span className="text-gray-400 text-[11px]">9,842</span>
              </label>
              <label className="flex items-center justify-between text-gray-700 cursor-pointer">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="rounded accent-[#027864]" />
                  <span>Missing on one or more</span>
                </div>
                <span className="text-gray-400 text-[11px]">2,301</span>
              </label>
              <label className="flex items-center justify-between text-gray-700 cursor-pointer">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="rounded accent-[#027864]" />
                  <span>Not listed on any</span>
                </div>
                <span className="text-gray-400 text-[11px]">337</span>
              </label>
            </div>

            {/* Price (QAR) Min / Max */}
            <div className="space-y-1.5 text-xs">
              <div className="font-semibold text-gray-900">Price (QAR)</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  placeholder="Min"
                  className="w-full border border-gray-200 rounded-lg p-1.5 text-xs bg-white"
                />
                <input
                  type="number"
                  placeholder="Max"
                  className="w-full border border-gray-200 rounded-lg p-1.5 text-xs bg-white"
                />
              </div>
            </div>

            {/* Recently updated */}
            <div className="space-y-1 text-xs">
              <div className="font-semibold text-gray-900">Recently updated</div>
              <select className="w-full border border-gray-200 rounded-lg p-2 text-xs bg-white text-gray-700">
                <option>Any time</option>
                <option>Today</option>
                <option>Past 7 days</option>
                <option>Past 30 days</option>
              </select>
            </div>

            <button
              onClick={() => showToast('Filters applied')}
              className="w-full py-2 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg transition-colors shadow-xs"
            >
              Apply filters
            </button>
          </div>
        )}
      </div>

      {priceModal.open && (
        <BulkPriceModal
          open
          onClose={() => setPriceModal({ ...priceModal, open: false })}
          productIds={priceModal.ids}
          initialTab={priceModal.tab}
          initialCategory={priceModal.category}
          onApplied={() => setSelectedIds([])}
        />
      )}
    </div>
  );
};
