import React, { useState } from 'react';
import { realCatalogueEnabled } from '../../lib/features';
import { RealCategoryDetailView } from '../catalogue/RealCategoryDetailView';
import {
  ChevronDown,
  Upload,
  Trash2,
  Plus,
  Search,
  Filter,
  Columns,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ProductImage } from '../common/ProductImage';
import { MarketplaceBadge } from '../common/MarketplaceBadge';
import { useDemo } from '../../demo';

const DemoCategoryDetailView: React.FC = () => {
  const { selectedCategoryId, navigate, showToast } = useApp();
  const { state } = useDemo();
  const categories = state.categories;
  const products = state.products;

  const category =
    categories.find((c: any) => c.id === selectedCategoryId) ||
    categories.find((c: any) => c.id === 'c003') ||
    categories[0] || { id: 'c001', nameEn: 'Beverages', nameAr: 'المشروبات' };

  const [nameEn, setNameEn] = useState(category.nameEn);
  const [nameAr, setNameAr] = useState(category.nameAr);
  const [parentCategory, setParentCategory] = useState('None (Top level)');
  const [isActive, setIsActive] = useState(true);
  const [activeTab, setActiveTab] = useState<'products' | 'subcategories' | 'marketplaces'>('products');
  const [searchTerm, setSearchTerm] = useState('');

  // Products belonging to category
  const categoryProducts = products.filter(
    (p: any) =>
      p.categoryId === category.id ||
      p.erpCategory === category.nameEn
  );

  const handleSaveChanges = () => {
    showToast(`Category "${nameEn}" updated successfully!`, 'success');
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-150">
      {/* Breadcrumbs & Header */}
      <div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
          <button
            onClick={() => navigate('catalogue')}
            className="hover:text-gray-800 text-blue-600 hover:underline"
          >
            Catalogue
          </button>
          <span>/</span>
          <button
            onClick={() => navigate('categories')}
            className="hover:text-gray-800 text-blue-600 hover:underline"
          >
            Categories
          </button>
          <span>/</span>
          <span className="text-gray-700">{category.nameEn}</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              {category.nameEn}
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              View and edit category details, image and product assignment.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => showToast('More actions')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-xs"
            >
              <span>More actions</span>
              <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
            </button>

            <button
              onClick={handleSaveChanges}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg transition-colors shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Save changes</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Form (3 cols) + Sidebar Stats & Subcategories (1 col) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* Left Form (3 Cols) */}
        <div className="lg:col-span-3 space-y-6">
          {/* Category Information Card */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-gray-900">Category information</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Text Fields (2 cols) */}
              <div className="md:col-span-2 space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-medium text-gray-900 mb-1">
                      Category name (English) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={nameEn}
                      onChange={(e) => setNameEn(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg p-2 text-xs bg-white focus:ring-1 focus:ring-[#027864]"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-gray-900 mb-1">
                      Category name (Arabic) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={nameAr}
                      onChange={(e) => setNameAr(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg p-2 text-xs bg-white text-right font-arabic focus:ring-1 focus:ring-[#027864]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-medium text-gray-900 mb-1">
                      Parent category
                    </label>
                    <select
                      value={parentCategory}
                      onChange={(e) => setParentCategory(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg p-2 text-xs bg-white"
                    >
                      <option>None (Top level)</option>
                      <option>Food & Grocery</option>
                      <option>Packaged Foods</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-gray-900 mb-1">Status</label>
                    <div className="flex items-center gap-3 mt-1.5">
                      <button
                        type="button"
                        onClick={() => setIsActive(!isActive)}
                        className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors duration-200 ease-in-out ${
                          isActive ? 'bg-[#027864]' : 'bg-gray-200'
                        }`}
                      >
                        <div
                          className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                            isActive ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                      <span className="text-xs font-semibold text-gray-900">
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-500 mt-1">
                      Inactive categories will not be shown in marketplace listings.
                    </div>
                  </div>
                </div>
              </div>

              {/* Category Image Widget (1 col) */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-900">
                  Category image
                </label>
                <div className="border border-gray-200 rounded-xl p-4 bg-white flex flex-col items-center justify-center">
                  <div className="w-24 h-24 flex items-center justify-center text-4xl">
                    🍿
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => showToast('Image selector opened')}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    <Upload className="w-3.5 h-3.5 text-gray-500" />
                    <span>Change image</span>
                  </button>

                  <button
                    onClick={() => showToast('Image removed', 'info')}
                    className="inline-flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-medium text-red-600 bg-white border border-gray-300 rounded-lg hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove</span>
                  </button>
                </div>
                <div className="text-[10px] text-gray-400 text-center leading-tight">
                  Recommended: 1000 × 1000 px (JPG or PNG) <br /> Max size: 5 MB
                </div>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-6 border-b border-gray-200 text-xs">
            <button
              onClick={() => setActiveTab('products')}
              className={`pb-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'products'
                  ? 'border-[#027864] text-[#027864]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Products (1,645)
            </button>
            <button
              onClick={() => setActiveTab('subcategories')}
              className={`pb-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'subcategories'
                  ? 'border-[#027864] text-[#027864]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Subcategories (4)
            </button>
            <button
              onClick={() => setActiveTab('marketplaces')}
              className={`pb-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'marketplaces'
                  ? 'border-[#027864] text-[#027864]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Marketplaces (3)
            </button>
          </div>

          {/* Products Table in Category */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
            <div className="p-3.5 border-b border-gray-200 flex items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search products by name or barcode..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#027864]"
                />
              </div>

              <div className="flex items-center gap-2">
                <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg bg-white text-gray-700 hover:bg-gray-50">
                  <Filter className="w-3.5 h-3.5 text-gray-500" />
                  <span>Filters</span>
                </button>
                <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg bg-white text-gray-700 hover:bg-gray-50">
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

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3 w-8">
                      <input type="checkbox" className="rounded accent-[#027864]" />
                    </th>
                    <th className="py-2.5 px-3">Product</th>
                    <th className="py-2.5 px-3">Barcode</th>
                    <th className="py-2.5 px-3">Brand</th>
                    <th className="py-2.5 px-3 text-right">Price (QAR)</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                    <th className="py-2.5 px-3">Last updated</th>
                    <th className="py-2.5 px-3 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {categoryProducts.map((p: any) => (
                    <tr
                      key={p.id}
                      onClick={() => navigate('product-detail', { productId: p.id })}
                      className="hover:bg-gray-50/70 cursor-pointer group"
                    >
                      <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="rounded accent-[#027864]" />
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
                      <td className="py-3 px-3 text-gray-700">{p.brand}</td>
                      <td className="py-3 px-3 text-right font-semibold text-gray-900">
                        {p.erpPrice.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#E3FAF3] text-[#027864]">
                          Active
                        </span>
                      </td>
                      <td className="py-3 px-3 text-gray-500 whitespace-nowrap">
                        {p.updatedAt}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button className="text-gray-400 hover:text-gray-600 p-1">
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-3 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
              <span>Showing 1 to 8 of 1,645 products</span>
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
                <button className="px-2 py-1 rounded hover:bg-gray-100">66</button>
                <button className="p-1 rounded hover:bg-gray-100">
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="space-y-4">
          {/* Category Stats */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs space-y-2 text-xs">
            <h3 className="font-bold uppercase tracking-wider text-gray-900">
              Category stats
            </h3>
            <div className="space-y-1.5 divide-y divide-gray-50 pt-1">
              <div className="flex justify-between py-1">
                <span className="text-gray-500">Total products</span>
                <span className="font-semibold text-gray-900">1,645</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500">Active products</span>
                <span className="text-gray-900">1,620</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500">Inactive products</span>
                <span className="text-gray-900">25</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500">Marketplaces listed</span>
                <span className="text-gray-900">3</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500">Created</span>
                <span className="text-gray-900">12 Aug 2024 10:15</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500">Last updated</span>
                <span className="text-gray-900 text-right leading-tight">
                  06 Oct 2026 08:50 <br />
                  <span className="text-[10px] text-gray-500">by Omar Haddad</span>
                </span>
              </div>
            </div>
          </div>

          {/* Subcategories (4) */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900">Subcategories (4)</h3>
              <button
                onClick={() => showToast('Add subcategory dialog')}
                className="flex items-center gap-1 text-[11px] font-semibold text-[#027864] hover:underline"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add subcategory</span>
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 rounded-lg border border-gray-100 hover:bg-gray-50">
                <div className="flex items-center gap-2">
                  <ProductImage imageKey="lays" size="sm" />
                  <div>
                    <div className="font-semibold text-gray-900">Chips & Crisps</div>
                    <div className="text-[11px] text-gray-500">421 products</div>
                  </div>
                </div>
                <MoreHorizontal className="w-4 h-4 text-gray-400" />
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg border border-gray-100 hover:bg-gray-50">
                <div className="flex items-center gap-2">
                  <ProductImage imageKey="snickers" size="sm" />
                  <div>
                    <div className="font-semibold text-gray-900">Chocolate & Bars</div>
                    <div className="text-[11px] text-gray-500">538 products</div>
                  </div>
                </div>
                <MoreHorizontal className="w-4 h-4 text-gray-400" />
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg border border-gray-100 hover:bg-gray-50">
                <div className="flex items-center gap-2">
                  <ProductImage imageKey="oreo" size="sm" />
                  <div>
                    <div className="font-semibold text-gray-900">Biscuits & Cookies</div>
                    <div className="text-[11px] text-gray-500">356 products</div>
                  </div>
                </div>
                <MoreHorizontal className="w-4 h-4 text-gray-400" />
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg border border-gray-100 hover:bg-gray-50">
                <div className="flex items-center gap-2">
                  <ProductImage imageKey="haribo" size="sm" />
                  <div>
                    <div className="font-semibold text-gray-900">Candy & Sweets</div>
                    <div className="text-[11px] text-gray-500">330 products</div>
                  </div>
                </div>
                <MoreHorizontal className="w-4 h-4 text-gray-400" />
              </div>
            </div>
          </div>

          {/* Marketplaces (3) */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900">Marketplaces (3)</h3>
              <button
                onClick={() => navigate('category-mapping')}
                className="text-[11px] font-semibold text-[#027864] hover:underline"
              >
                Manage
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between py-1.5 px-2 border border-gray-100 rounded-lg">
                <MarketplaceBadge marketplace="talabat" />
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#E3FAF3] text-[#027864]">
                  Listed
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 px-2 border border-gray-100 rounded-lg">
                <MarketplaceBadge marketplace="snoonu" />
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#E3FAF3] text-[#027864]">
                  Listed
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 px-2 border border-gray-100 rounded-lg">
                <MarketplaceBadge marketplace="rafeeq" />
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#E3FAF3] text-[#027864]">
                  Listed
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Real /api/products and /api/categories when VITE_REAL_CATALOGUE=true, the demo store otherwise. */
export const CategoryDetailView: React.FC = () => (realCatalogueEnabled() ? <RealCategoryDetailView /> : <DemoCategoryDetailView />);
