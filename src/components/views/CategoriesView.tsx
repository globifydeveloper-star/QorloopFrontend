import React, { useState } from 'react';
import { realCatalogueEnabled } from '../../lib/features';
import { RealCategoriesView } from '../catalogue/RealCategoriesView';
import {
  Search,
  Upload,
  Plus,
  MoreHorizontal,
  Info,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useDemo } from '../../demo';

const DemoCategoriesView: React.FC = () => {
  const { navigate, showToast } = useApp();
  const { state } = useDemo();
  const categories = state.categories;
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Inactive'>('All');

  const filteredCategories = categories.filter((c: any) => {
    if (statusFilter !== 'All' && c.status !== statusFilter) return false;
    if (
      searchTerm &&
      !c.nameEn.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !c.nameAr.includes(searchTerm)
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-150">
      {/* Breadcrumb & Header */}
      <div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
          <button
            onClick={() => navigate('catalogue')}
            className="hover:text-gray-800 text-blue-600 hover:underline"
          >
            Catalogue
          </button>
          <span>/</span>
          <span className="text-gray-700">Categories</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              Categories
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Organise your products into categories. Categories are used for marketplace listings and reports.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => showToast('Import categories file modal')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-xs"
            >
              <Upload className="w-3.5 h-3.5 text-gray-500" />
              <span>Import categories</span>
            </button>

            <button
              onClick={() => showToast('Add new category modal')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg transition-colors shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add category</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Table (3 Cols) + Right Sidebar (1 Col) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* Table Area */}
        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
          {/* Controls Bar */}
          <div className="p-3.5 border-b border-gray-200 flex items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search categories..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#027864]"
              />
            </div>

            <select className="text-xs border border-gray-200 rounded-lg py-1.5 px-2 bg-white text-gray-700">
              <option>Show 25 rows</option>
              <option>Show 50 rows</option>
            </select>
          </div>

          {/* Categories Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                <tr>
                  <th className="py-2.5 px-3 w-8">
                    <input type="checkbox" className="rounded accent-[#027864]" />
                  </th>
                  <th className="py-2.5 px-3">Category name</th>
                  <th className="py-2.5 px-3">Arabic name</th>
                  <th className="py-2.5 px-3 text-right">Products</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3">Last updated</th>
                  <th className="py-2.5 px-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredCategories.map((c: any) => (
                  <tr
                    key={c.id}
                    onClick={() => navigate('category-detail', { categoryId: c.id })}
                    className="hover:bg-gray-50/80 cursor-pointer transition-colors group"
                  >
                    <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="rounded accent-[#027864]" />
                    </td>
                    <td className="py-3 px-3 font-medium text-gray-900 group-hover:text-[#027864]">
                      <div className="flex items-center gap-2.5">
                        <span className="text-lg leading-none">{c.icon}</span>
                        <span>{c.nameEn}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-gray-600 font-arabic text-right sm:text-left">
                      {c.nameAr}
                    </td>
                    <td className="py-3 px-3 text-right font-medium text-gray-800">
                      {c.productCount.toLocaleString()}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          c.status === 'Active'
                            ? 'bg-[#E3FAF3] text-[#027864]'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-gray-500 whitespace-nowrap">
                      {c.updatedAt} <br />
                      <span className="text-[10px]">by {c.updatedBy}</span>
                    </td>
                    <td
                      className="py-3 px-3 text-right"
                      onClick={(e) => {
                        e.stopPropagation();
                        showToast(`Actions for ${c.nameEn}`);
                      }}
                    >
                      <button className="text-gray-400 hover:text-gray-600 p-1">
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          <div className="p-3 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
            <span>Showing 1 to {filteredCategories.length} of {categories.length} categories</span>
            <div className="flex items-center gap-1">
              <button className="px-2 py-1 rounded bg-[#E3FAF3] font-bold text-[#027864]">
                1
              </button>
            </div>
          </div>
        </div>

        {/* Right Filter Sidebar */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <h3 className="font-bold uppercase tracking-wider text-gray-900">
                Filters
              </h3>
              <button
                onClick={() => {
                  setStatusFilter('All');
                  setSearchTerm('');
                }}
                className="text-[#027864] hover:underline font-medium"
              >
                Clear all
              </button>
            </div>

            {/* Status Checkbox */}
            <div className="space-y-1.5">
              <div className="font-semibold text-gray-900">Status</div>
              <label className="flex items-center justify-between text-gray-700 cursor-pointer">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={statusFilter === 'Active' || statusFilter === 'All'}
                    onChange={() => setStatusFilter(statusFilter === 'Active' ? 'All' : 'Active')}
                    className="rounded accent-[#027864]"
                  />
                  <span>Active</span>
                </div>
                <span className="text-gray-400 text-[11px]">12</span>
              </label>

              <label className="flex items-center justify-between text-gray-700 cursor-pointer">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={statusFilter === 'Inactive'}
                    onChange={() => setStatusFilter(statusFilter === 'Inactive' ? 'All' : 'Inactive')}
                    className="rounded accent-[#027864]"
                  />
                  <span>Inactive</span>
                </div>
                <span className="text-gray-400 text-[11px]">1</span>
              </label>
            </div>

            {/* Product count */}
            <div className="space-y-1.5">
              <div className="font-semibold text-gray-900">Product count</div>
              <label className="flex items-center justify-between text-gray-700 cursor-pointer">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="rounded accent-[#027864]" />
                  <span>More than 1,000</span>
                </div>
                <span className="text-gray-400 text-[11px]">5</span>
              </label>
              <label className="flex items-center justify-between text-gray-700 cursor-pointer">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="rounded accent-[#027864]" />
                  <span>101 to 1,000</span>
                </div>
                <span className="text-gray-400 text-[11px]">6</span>
              </label>
              <label className="flex items-center justify-between text-gray-700 cursor-pointer">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="rounded accent-[#027864]" />
                  <span>10 to 100</span>
                </div>
                <span className="text-gray-400 text-[11px]">2</span>
              </label>
              <label className="flex items-center justify-between text-gray-700 cursor-pointer">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="rounded accent-[#027864]" />
                  <span>Fewer than 10</span>
                </div>
                <span className="text-gray-400 text-[11px]">0</span>
              </label>
            </div>
          </div>

          {/* Tips Box */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs space-y-2 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-gray-900">
              <Info className="w-4 h-4 text-blue-600" />
              <span>Tips</span>
            </div>
            <ul className="list-disc pl-4 space-y-1.5 text-gray-600 text-[11px]">
              <li>Categories are used to organise products across marketplaces.</li>
              <li>Add Arabic names for better marketplace listings.</li>
              <li>You can map your ERP categories to these later.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Real /api/products and /api/categories when VITE_REAL_CATALOGUE=true, the demo store otherwise. */
export const CategoriesView: React.FC = () => (realCatalogueEnabled() ? <RealCategoriesView /> : <DemoCategoriesView />);
