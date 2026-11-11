import React, { useMemo, useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  Search,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ProductImage } from '../common/ProductImage';
import { MarketplacePill } from '../common/MarketplaceBadge';
import { CompareAgainstToggle } from '../common/CompareAgainstToggle';
import { AdvancedDisclosure } from '../common/AdvancedDisclosure';
import {
  MARKETPLACE_IDS,
  MARKETPLACE_NAMES,
  REFERENCE_IN_TEXT,
  checkProductPrices,
  formatDiff,
  formatQar,
} from '../../lib/pricing';
import { MarketplaceId } from '../../types';

export const PriceMismatchesView: React.FC = () => {
  const {
    navigate,
    showToast,
    products,
    pricingSettings,
    categoryPriceRules,
    compareReference,
    getMarketplacePrice,
  } = useApp();
  const [activeTab, setActiveTab] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // One row per product × marketplace where the listed price differs from the reference price.
  const priceMismatches = useMemo(
    () =>
      products.flatMap((p) => {
        const checks = checkProductPrices(p, compareReference, pricingSettings, categoryPriceRules);
        const mpPrice = getMarketplacePrice(p).price;
        return MARKETPLACE_IDS.filter((mp) => checks[mp].mismatch).map((mp) => ({
          id: p.id,
          nameEn: p.nameEn,
          nameAr: p.nameAr,
          imageKey: p.imageKey,
          barcode: p.barcode,
          category: p.category,
          brand: p.brand,
          erpPrice: p.erpPrice,
          marketplacePrice: mpPrice,
          listedPrice: checks[mp].actual as number,
          diff: checks[mp].diff,
          marketplace: mp as MarketplaceId,
          updatedAt: checks[mp].lastUpdated || 'No file',
        }));
      }),
    [products, compareReference, pricingSettings, categoryPriceRules, getMarketplacePrice]
  );

  const countFor = (mp: MarketplaceId) => priceMismatches.filter((m) => m.marketplace === mp).length;

  const filtered = priceMismatches.filter((item) => {
    if (activeTab !== 'all' && item.marketplace !== activeTab) return false;
    if (
      searchTerm &&
      !item.nameEn.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !item.barcode.includes(searchTerm)
    ) {
      return false;
    }
    return true;
  });

  const referenceInText = REFERENCE_IN_TEXT[compareReference];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-150">
      {/* Breadcrumb & Header */}
      <div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
          <button
            onClick={() => navigate('reports')}
            className="hover:text-gray-800 text-blue-600 hover:underline"
          >
            Reports
          </button>
          <span>/</span>
          <span className="text-gray-700">Price report</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              Price mismatches
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Products where the price listed on a marketplace does not match {referenceInText}.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => showToast('Exported price mismatches to CSV')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-xs"
            >
              <Download className="w-3.5 h-3.5 text-gray-500" />
              <span>Export</span>
            </button>

            <button
              onClick={() => navigate('outputs-generate')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg transition-colors shadow-xs"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Generate price file</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-gray-200 text-xs">
        <button
          onClick={() => setActiveTab('all')}
          className={`pb-3 font-semibold border-b-2 transition-colors ${
            activeTab === 'all'
              ? 'border-[#027864] text-[#027864]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          All ({priceMismatches.length})
        </button>
        {MARKETPLACE_IDS.map((mp) => (
          <button
            key={mp}
            onClick={() => setActiveTab(mp)}
            className={`pb-3 font-semibold border-b-2 transition-colors ${
              activeTab === mp
                ? 'border-[#027864] text-[#027864]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {MARKETPLACE_NAMES[mp]} ({countFor(mp)})
          </button>
        ))}
      </div>

      {/* Main Grid: Table (3 cols) + Filter Sidebar (1 col) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* Table Area */}
        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
          <div className="p-3.5 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by product name or barcode..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#027864]"
              />
            </div>

            <div className="flex items-center gap-3">
              <AdvancedDisclosure id="price-report-advanced"><CompareAgainstToggle /></AdvancedDisclosure>
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
                  <th className="py-2.5 px-3 text-right">ERP price (QAR)</th>
                  <th className="py-2.5 px-3 text-right">Expected price (QAR)</th>
                  <th className="py-2.5 px-3 text-right">Listed price (QAR)</th>
                  <th className="py-2.5 px-3 text-right">Difference</th>
                  <th className="py-2.5 px-3">Marketplace</th>
                  <th className="py-2.5 px-3">Last updated</th>
                  <th className="py-2.5 px-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((item) => (
                  <tr
                    key={item.id + item.marketplace}
                    onClick={() => navigate('product-detail', { productId: item.id })}
                    className="hover:bg-gray-50/70 cursor-pointer group"
                  >
                    <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="rounded accent-[#027864]" />
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-3">
                        <ProductImage imageKey={item.imageKey} size="sm" />
                        <div>
                          <div className="font-medium text-gray-900 group-hover:text-[#027864] transition-colors leading-tight">
                            {item.nameEn}
                          </div>
                          <div className="text-[11px] text-gray-500 font-arabic leading-tight">
                            {item.nameAr}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-gray-600">
                      {item.barcode}
                    </td>
                    <td
                      className={`py-3 px-3 text-right ${
                        compareReference === 'erp' ? 'font-bold text-gray-900' : 'font-medium text-gray-500'
                      }`}
                    >
                      {formatQar(item.erpPrice)}
                    </td>
                    <td
                      className={`py-3 px-3 text-right ${
                        compareReference === 'marketplace' ? 'font-bold text-gray-900' : 'font-medium text-gray-500'
                      }`}
                    >
                      {formatQar(item.marketplacePrice)}
                    </td>
                    <td className="py-3 px-3 text-right font-medium text-gray-800">
                      {formatQar(item.listedPrice)}
                    </td>
                    <td className="py-3 px-3 text-right font-bold">
                      <span
                        className={
                          item.diff > 0 ? 'text-red-600' : 'text-emerald-600'
                        }
                      >
                        {formatDiff(item.diff)}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <MarketplacePill marketplace={item.marketplace} />
                    </td>
                    <td className="py-3 px-3 text-gray-500 whitespace-nowrap">
                      {item.updatedAt}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button className="text-gray-400 hover:text-gray-600 p-1">
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-8 px-3 text-center text-gray-400">
                      No price mismatches against {referenceInText}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="p-3 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
            <span>
              Showing {filtered.length === 0 ? 0 : 1} to {filtered.length} of {priceMismatches.length} price mismatches
            </span>
            <div className="flex items-center gap-1">
              <button className="p-1 rounded hover:bg-gray-100 disabled:opacity-40">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button className="px-2 py-1 rounded bg-[#E3FAF3] font-bold text-[#027864]">
                1
              </button>
              <button className="p-1 rounded hover:bg-gray-100">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Filter Sidebar */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs space-y-4 text-xs">
            <h3 className="font-bold uppercase tracking-wider text-gray-900 border-b border-gray-100 pb-2">
              Filters
            </h3>

            {/* Marketplace */}
            <div className="space-y-1.5">
              <div className="font-semibold text-gray-900">Marketplace</div>
              {MARKETPLACE_IDS.map((mp) => (
                <label key={mp} className="flex items-center justify-between text-gray-700 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={activeTab === 'all' || activeTab === mp}
                      onChange={() => setActiveTab(activeTab === mp ? 'all' : mp)}
                      className="rounded accent-[#027864]"
                    />
                    <span>{MARKETPLACE_NAMES[mp]}</span>
                  </div>
                  <span className="text-gray-400 text-[11px]">{countFor(mp)}</span>
                </label>
              ))}
            </div>

            {/* Difference ranges */}
            <div className="space-y-1.5">
              <div className="font-semibold text-gray-900">Difference</div>
              {[
                ['More than +1.00', (d: number) => d > 1],
                ['+0.26 to +1.00', (d: number) => d > 0.25 && d <= 1],
                ['+0.01 to +0.25', (d: number) => d > 0 && d <= 0.25],
                ['-0.25 to -0.01', (d: number) => d < 0 && d >= -0.25],
                ['-1.00 to -0.26', (d: number) => d < -0.25 && d >= -1],
                ['More than -1.00', (d: number) => d < -1],
              ].map(([label, test]) => (
                <label key={label as string} className="flex items-center justify-between text-gray-700 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" className="rounded accent-[#027864]" />
                    <span>{label as string}</span>
                  </div>
                  <span className="text-gray-400 text-[11px]">
                    {priceMismatches.filter((m) => (test as (d: number) => boolean)(m.diff)).length}
                  </span>
                </label>
              ))}
            </div>

            {/* Product details */}
            <div className="space-y-1">
              <div className="font-semibold text-gray-900">Category</div>
              <select className="w-full border border-gray-200 rounded-lg p-2 text-xs bg-white text-gray-700">
                <option>All categories</option>
                <option>Soft Drinks</option>
                <option>Dairy</option>
                <option>Snacks</option>
                <option>Confectionery</option>
              </select>
            </div>

            <div className="space-y-1">
              <div className="font-semibold text-gray-900">Brand</div>
              <select className="w-full border border-gray-200 rounded-lg p-2 text-xs bg-white text-gray-700">
                <option>All brands</option>
                <option>Pepsi</option>
                <option>Baladna</option>
                <option>Lay's</option>
                <option>Almarai</option>
              </select>
            </div>

            <div className="pt-2 space-y-2">
              <button
                onClick={() => showToast('Price filters applied')}
                className="w-full py-2 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg transition-colors shadow-xs"
              >
                Apply filters
              </button>
              <button
                onClick={() => {
                  setActiveTab('all');
                  setSearchTerm('');
                  showToast('Price filters reset');
                }}
                className="w-full text-center text-xs text-gray-600 hover:text-gray-900 hover:underline"
              >
                Clear filters
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
