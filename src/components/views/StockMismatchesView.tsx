import React, { useState, useMemo } from 'react';
import { RealReconReportView } from '../recon/RealReconReportView';
import { realReconEnabled } from '../../lib/features';
import {
  Download,
  Search,
  Filter,
  AlertTriangle,
  AlertCircle,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Info,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ProductImage } from '../common/ProductImage';
import { MarketplaceBadge } from '../common/MarketplaceBadge';
import {
  useDemo,
  stockMismatches,
  relative,
  MARKETPLACE_IDS,
} from '../../demo';
import type { MarketplaceId, ReconRow } from '../../demo';

const MP_NAMES: Record<MarketplaceId, string> = {
  talabat: 'Talabat',
  snoonu: 'Snoonu',
  rafeeq: 'Rafeeq',
  keeta: 'Keeta',
};

const DemoStockMismatchesView: React.FC = () => {
  const { navigate } = useApp();
  const { state, summary } = useDemo();

  const [activeTab, setActiveTab] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [issueFilter, setIssueFilter] = useState<'all' | 'available_but_out_of_stock' | 'unavailable_but_in_stock'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Total counts across all marketplaces
  const totalStockIssues = Object.values(summary).reduce((acc, s) => acc + s.stock, 0);
  const totalPriceIssues = Object.values(summary).reduce((acc, s) => acc + s.price, 0);

  // Get raw mismatches
  const rawRows = useMemo(() => {
    const mpArg = activeTab === 'all' ? undefined : (activeTab as MarketplaceId);
    const rows = stockMismatches(state, mpArg);

    // Sort: available_but_out_of_stock FIRST (urgent: red), then unavailable_but_in_stock (amber)
    return rows.sort((a, b) => {
      if (a.stockIssue === 'available_but_out_of_stock' && b.stockIssue !== 'available_but_out_of_stock') {
        return -1;
      }
      if (b.stockIssue === 'available_but_out_of_stock' && a.stockIssue !== 'available_but_out_of_stock') {
        return 1;
      }
      return 0;
    });
  }, [state, activeTab]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return rawRows.filter((r) => {
      // Search
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const matches =
          r.product.nameEn.toLowerCase().includes(q) ||
          (r.product.nameAr && r.product.nameAr.includes(q)) ||
          r.product.barcode.toLowerCase().includes(q) ||
          r.product.id.toLowerCase().includes(q);
        if (!matches) return false;
      }

      // Issue type
      if (issueFilter !== 'all' && r.stockIssue !== issueFilter) {
        return false;
      }

      // Category
      if (categoryFilter !== 'all' && r.product.categoryId !== categoryFilter) {
        return false;
      }

      return true;
    });
  }, [rawRows, searchTerm, issueFilter, categoryFilter]);

  const getErpStatus = (r: ReconRow) => {
    if (!r.product.inLatestErpFile) return { label: 'Missing from ERP', color: 'text-gray-500 bg-gray-100' };
    if (!r.product.erpActive) return { label: 'Inactive', color: 'text-gray-500 bg-gray-100' };
    if (r.product.erpStock > 0) return { label: 'In stock', color: 'text-emerald-700 bg-emerald-50' };
    return { label: 'Out of stock', color: 'text-red-700 bg-red-50' };
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Stock & Availability</h1>
          <p className="text-sm text-gray-500 mt-1">
            Compare ERP warehouse availability against marketplace listing status
          </p>
        </div>

        <button
          onClick={() => navigate('outputs-generate')}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#027864] hover:bg-[#02604F] text-white text-sm font-semibold rounded-xl shadow-sm transition-colors"
        >
          <Download className="w-4 h-4" />
          <span>Generate stock file</span>
        </button>
      </div>

      {/* Primary Navigation Tabs */}
      <div className="flex items-center gap-6 border-b border-gray-200">
        <button className="pb-3 text-sm font-bold text-[#027864] border-b-2 border-[#027864] flex items-center gap-2">
          <span>Stock issues</span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-800 font-semibold">
            {totalStockIssues}
          </span>
        </button>
        <button
          onClick={() => navigate('reports-price-discrepancies')}
          className="pb-3 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-2"
        >
          <span>Price discrepancies</span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 font-semibold">
            {totalPriceIssues}
          </span>
        </button>
        <button
          onClick={() => navigate('outputs-generate')}
          className="pb-3 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-2"
        >
          <span>Generated files</span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 font-semibold">
            {state.generatedFiles.length}
          </span>
        </button>
      </div>

      {/* Marketplace Selector Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === 'all'
              ? 'bg-gray-900 text-white'
              : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span>All Marketplaces</span>
          <span
            className={`px-1.5 py-0.2 rounded text-[10px] ${
              activeTab === 'all' ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {totalStockIssues}
          </span>
        </button>

        {state.marketplaces.filter((m) => m.enabled).map((m) => {
          const mp = m.id;
          const s = summary[mp];
          const isSelected = activeTab === mp;

          return (
            <button
              key={mp}
              onClick={() => setActiveTab(mp)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 ${
                isSelected
                  ? 'bg-gray-900 text-white'
                  : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span>{MP_NAMES[mp]}</span>
              <span
                className={`px-1.5 py-0.2 rounded text-[10px] ${
                  isSelected ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {s?.stock ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search product name, barcode or SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs border border-gray-200 rounded-xl focus:ring-1 focus:ring-[#027864] outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={issueFilter}
              onChange={(e) => setIssueFilter(e.target.value as any)}
              className="px-3 py-2 text-xs border border-gray-200 rounded-xl focus:ring-1 focus:ring-[#027864] outline-none bg-white text-gray-700 font-medium"
            >
              <option value="all">All issue types</option>
              <option value="available_but_out_of_stock">Out of stock in ERP (Urgent)</option>
              <option value="unavailable_but_in_stock">In stock in ERP (Lost sales)</option>
            </select>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-gray-200 rounded-xl focus:ring-1 focus:ring-[#027864] outline-none bg-white text-gray-700 font-medium"
            >
              <option value="all">All categories</option>
              {state.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameEn}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-xs text-gray-500 font-medium">
          Showing <span className="font-semibold text-gray-900">{filteredRows.length}</span> issues
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        {filteredRows.length === 0 ? (
          <div className="p-12 text-center">
            <Info className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-gray-900">No stock mismatches found</p>
            <p className="text-xs text-gray-400 mt-1">
              Stock availability between ERP and marketplaces is fully synchronized
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3.5">Product</th>
                  <th className="px-4 py-3.5">Barcode</th>
                  <th className="px-4 py-3.5 text-right">ERP Stock</th>
                  <th className="px-4 py-3.5 text-center">ERP Status</th>
                  <th className="px-4 py-3.5 text-center">Marketplace Status</th>
                  <th className="px-4 py-3.5">Issue</th>
                  <th className="px-4 py-3.5 text-center">Marketplace</th>
                  <th className="px-4 py-3.5">Last Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-600 font-medium">
                {filteredRows.map((r) => {
                  const erpStatus = getErpStatus(r);
                  const isUrgent = r.stockIssue === 'available_but_out_of_stock';
                  const mpName = MP_NAMES[r.marketplaceId];

                  return (
                    <tr
                      key={`${r.product.id}-${r.marketplaceId}`}
                      onClick={() => navigate('product-detail', { id: r.product.id })}
                      className="hover:bg-gray-50/80 cursor-pointer transition-colors"
                    >
                      {/* Product */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <ProductImage
                            imageKey={r.product.brand?.toLowerCase() || 'default'}
                            className="w-9 h-9 rounded-lg border border-gray-100 p-0.5 object-contain shrink-0 bg-white"
                          />
                          <div>
                            <div className="font-semibold text-gray-900 hover:text-[#027864] transition-colors">
                              {r.product.nameEn}
                            </div>
                            {r.product.nameAr && (
                              <div className="text-[11px] text-gray-400 mt-0.5" dir="rtl">
                                {r.product.nameAr}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Barcode */}
                      <td className="px-4 py-3.5 font-mono text-[11px] text-gray-600 whitespace-nowrap">
                        {r.product.barcode || '—'}
                      </td>

                      {/* ERP Stock Quantity */}
                      <td className="px-4 py-3.5 text-right font-mono font-semibold text-gray-900 whitespace-nowrap">
                        {r.product.erpStock.toLocaleString()}
                      </td>

                      {/* ERP Status */}
                      <td className="px-4 py-3.5 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${erpStatus.color}`}
                        >
                          {erpStatus.label}
                        </span>
                      </td>

                      {/* Marketplace Status */}
                      <td className="px-4 py-3.5 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            r.actualAvailable
                              ? 'text-emerald-700 bg-emerald-50'
                              : 'text-gray-600 bg-gray-100'
                          }`}
                        >
                          {r.actualAvailable ? 'Available' : 'Unavailable'}
                        </span>
                      </td>

                      {/* Issue Description */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {isUrgent ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                            <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                            <span>Available on {mpName}, out of stock in ERP</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span>Unavailable on {mpName}, in stock in ERP</span>
                          </span>
                        )}
                      </td>

                      {/* Marketplace */}
                      <td className="px-4 py-3.5 text-center whitespace-nowrap">
                        <MarketplaceBadge marketplace={r.marketplaceId} />
                      </td>

                      {/* Last Updated */}
                      <td className="px-4 py-3.5 text-[11px] text-gray-500 whitespace-nowrap">
                        {r.lastUpdated ? relative(r.lastUpdated, state.now) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

/** Real /api/recon when VITE_REAL_RECON=true, the demo store otherwise. */
export const StockMismatchesView: React.FC = () => (realReconEnabled() ? <RealReconReportView kind="stock" /> : <DemoStockMismatchesView />);
