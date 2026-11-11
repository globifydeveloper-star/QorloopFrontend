import React, { useMemo, useState } from 'react';
import { RealReconReportView } from '../recon/RealReconReportView';
import { realReconEnabled } from '../../lib/features';
import {
  Download,
  Sparkles,
  Search,
  Filter,
  RotateCw,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Info,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ProductImage } from '../common/ProductImage';
import { CompareAgainstToggle } from '../common/CompareAgainstToggle';
import {
  MARKETPLACE_IDS,
  MARKETPLACE_NAMES,
  PriceCheck,
  REFERENCE_IN_TEXT,
  checkProductPrices,
  formatDiff,
  formatQar,
} from '../../lib/pricing';
import { MarketplaceId } from '../../types';

const MP_HEADER: Record<MarketplaceId, { bg: string; text: string; letter: string }> = {
  talabat: { bg: 'bg-[#FF5A00]', text: 'text-white', letter: 't' },
  snoonu: { bg: 'bg-[#EE1C24]', text: 'text-white', letter: 'S' },
  rafeeq: { bg: 'bg-[#5B2C90]', text: 'text-white', letter: 'R' },
  keeta: { bg: 'bg-[#FFD200]', text: 'text-black', letter: 'K' },
};

const DemoPriceDiscrepanciesView: React.FC = () => {
  const {
    navigate,
    showToast,
    products,
    pricingSettings,
    categoryPriceRules,
    compareReference,
    getMarketplacePrice,
  } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMarketplace, setSelectedMarketplace] = useState('All marketplaces');
  const [direction, setDirection] = useState('All differences');
  const [minDiff, setMinDiff] = useState('');

  // Every product with at least one marketplace price that differs from the reference price.
  const discrepancies = useMemo(
    () =>
      products
        .map((p) => {
          const checks = checkProductPrices(p, compareReference, pricingSettings, categoryPriceRules);
          const mismatches = MARKETPLACE_IDS.filter((mp) => checks[mp].mismatch);
          const lower = mismatches.filter((mp) => checks[mp].diff < 0).map((mp) => MARKETPLACE_NAMES[mp]);
          const higher = mismatches.filter((mp) => checks[mp].diff > 0).map((mp) => MARKETPLACE_NAMES[mp]);
          const comment =
            [lower.length ? `Lower on ${lower.join(', ')}` : '', higher.length ? `Higher on ${higher.join(', ')}` : '']
              .filter(Boolean)
              .join(' · ') || '—';
          return { product: p, checks, mismatches, comment };
        })
        .filter((r) => r.mismatches.length > 0),
    [products, compareReference, pricingSettings, categoryPriceRules]
  );

  const filtered = discrepancies.filter(({ product: d, checks, mismatches }) => {
    if (
      searchTerm &&
      !d.nameEn.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !d.nameAr.includes(searchTerm) &&
      !d.barcode.includes(searchTerm)
    ) {
      return false;
    }
    const relevant: PriceCheck[] = mismatches
      .filter((mp) => selectedMarketplace === 'All marketplaces' || MARKETPLACE_NAMES[mp] === selectedMarketplace)
      .map((mp) => checks[mp]);
    if (relevant.length === 0) return false;
    const threshold = parseFloat(minDiff);
    return relevant.some((c) => {
      if (direction === 'Marketplace lower' && c.diff >= 0) return false;
      if (direction === 'Marketplace higher' && c.diff <= 0) return false;
      if (!Number.isNaN(threshold) && Math.abs(c.diff) < threshold) return false;
      return true;
    });
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
          <span className="text-gray-700">Price discrepancies</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              Price discrepancies
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Expected price = {compareReference === 'marketplace' ? 'My pricing (same on all marketplaces)' : 'ERP price'}. Tolerance 0.00 QAR.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => showToast('Discrepancies report exported')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-xs"
            >
              <Download className="w-3.5 h-3.5 text-gray-500" />
              <span>Download report</span>
            </button>

            <button
              onClick={() => navigate('outputs-generate')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg transition-colors shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Generate price files</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-gray-200 text-xs">
        <button
          onClick={() => navigate('reports-stock')}
          className="pb-3 font-semibold text-gray-500 hover:text-gray-700 transition-colors"
        >
          Stock (84)
        </button>
        <button
          className="pb-3 font-semibold border-b-2 border-[#027864] text-[#027864] transition-colors"
        >
          Price ({discrepancies.length})
        </button>
        <button
          onClick={() => navigate('outputs-generate')}
          className="pb-3 font-semibold text-gray-500 hover:text-gray-700 transition-colors"
        >
          Generated files (12)
        </button>
      </div>

      {/* Info Notice Banner */}
      <div className="bg-blue-50/70 border border-blue-100 rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-blue-900">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-600 shrink-0" />
          <div>
            <span className="font-semibold">Data from latest uploads:</span>{' '}
            <span className="text-blue-800">
              ERP export: 06 Oct 2026 09:12 &nbsp;|&nbsp; Talabat: 05 Oct 2026 18:40 &nbsp;|&nbsp; Snoonu: 05 Oct 2026 17:25 &nbsp;|&nbsp; Rafeeq: 05 Oct 2026 16:10 &nbsp;|&nbsp; Keeta: No file yet
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
          <button
            onClick={() => showToast('Data refreshed with latest marketplace uploads')}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-white text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 shadow-xs"
          >
            <RotateCw className="w-3 h-3 text-gray-500" />
            <span>Refresh data</span>
          </button>
          <span className="text-[10px] text-gray-500">Last updated 06 Oct 2026 09:15</span>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-xs flex flex-wrap items-center gap-3 text-xs">
        <CompareAgainstToggle />

        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by product name, barcode or SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#027864]"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-gray-500">Marketplace</span>
          <select
            value={selectedMarketplace}
            onChange={(e) => setSelectedMarketplace(e.target.value)}
            className="border border-gray-200 rounded-lg py-1.5 px-2 bg-white text-gray-700"
          >
            <option>All marketplaces</option>
            <option>Talabat</option>
            <option>Snoonu</option>
            <option>Rafeeq</option>
            <option>Keeta</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-gray-500">Direction</span>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            className="border border-gray-200 rounded-lg py-1.5 px-2 bg-white text-gray-700"
          >
            <option>All differences</option>
            <option>Marketplace lower</option>
            <option>Marketplace higher</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-gray-500">Difference above (QAR)</span>
          <input
            type="text"
            placeholder="e.g. 0.50"
            value={minDiff}
            onChange={(e) => setMinDiff(e.target.value)}
            className="w-24 border border-gray-200 rounded-lg py-1.5 px-2 bg-white text-gray-700"
          />
        </div>

        <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg bg-white text-gray-700 hover:bg-gray-50">
          <Filter className="w-3.5 h-3.5 text-gray-500" />
          <span>Filters</span>
        </button>
      </div>

      {/* Discrepancies Matrix Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
              <tr>
                <th className="py-2.5 px-3 w-8" rowSpan={2}>
                  <input type="checkbox" className="rounded accent-[#027864]" />
                </th>
                <th className="py-2.5 px-3" rowSpan={2}>Barcode / SKU</th>
                <th className="py-2.5 px-3" rowSpan={2}>Product</th>
                <th className="py-2.5 px-3 text-right" rowSpan={2}>ERP price (QAR)</th>
                <th className="py-2.5 px-3 text-right" rowSpan={2}>Expected price (QAR)</th>

                {/* Marketplace Group Headers */}
                {MARKETPLACE_IDS.map((mp) => (
                  <th key={mp} className="py-1.5 px-3 text-center border-l border-gray-200" colSpan={2}>
                    <div className="inline-flex items-center gap-1.5">
                      <span className={`w-4 h-4 ${MP_HEADER[mp].bg} ${MP_HEADER[mp].text} rounded text-[10px] font-bold flex items-center justify-center`}>
                        {MP_HEADER[mp].letter}
                      </span>
                      <span>{MARKETPLACE_NAMES[mp]}</span>
                    </div>
                  </th>
                ))}

                <th className="py-2.5 px-3" rowSpan={2}>Comment</th>
                <th className="py-2.5 px-3 w-8" rowSpan={2}>Actions</th>
              </tr>
              <tr className="border-t border-gray-200 text-[11px] text-gray-500">
                {MARKETPLACE_IDS.map((mp) => (
                  <React.Fragment key={mp}>
                    <th className="py-1 px-2 text-center border-l border-gray-200">Expected</th>
                    <th className="py-1 px-2 text-center">Actual</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(({ product: item, checks, comment }) => {
                const mpPrice = getMarketplacePrice(item);
                return (
                  <tr
                    key={item.id}
                    onClick={() => navigate('product-detail', { productId: item.id })}
                    className="hover:bg-gray-50/70 cursor-pointer group"
                  >
                    <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="rounded accent-[#027864]" />
                    </td>
                    <td className="py-3 px-3 font-mono text-gray-600">
                      {item.barcode}
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
                      {formatQar(mpPrice.price)}
                    </td>

                    {MARKETPLACE_IDS.map((mp) => {
                      const c = checks[mp];
                      if (!c.listed) {
                        return (
                          <React.Fragment key={mp}>
                            <td className="py-3 px-2 text-center border-l border-gray-100 text-gray-400">—</td>
                            <td className="py-3 px-2 text-center text-gray-400">—</td>
                          </React.Fragment>
                        );
                      }
                      return (
                        <React.Fragment key={mp}>
                          <td className="py-3 px-2 text-center border-l border-gray-100 text-gray-600">
                            {formatQar(c.expected)}
                          </td>
                          <td className="py-3 px-2 text-center">
                            {c.mismatch ? (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-bold bg-[#FEF2F2] text-[#B91C1C]">
                                {formatQar(c.actual)} <br />
                                <span className="text-[10px]">{formatDiff(c.diff)}</span>
                              </span>
                            ) : (
                              <span className="text-gray-800">{formatQar(c.actual)}</span>
                            )}
                          </td>
                        </React.Fragment>
                      );
                    })}

                    <td className="py-3 px-3 text-gray-700 whitespace-nowrap">
                      {comment}
                    </td>

                    <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => navigate('product-detail', { productId: item.id })}
                        title="Open product"
                        className="text-gray-400 hover:text-gray-600 p-1"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={16} className="py-8 px-3 text-center text-gray-400">
                    No price discrepancies against {referenceInText}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-3 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
          <span>
            Showing {filtered.length === 0 ? 0 : 1} to {filtered.length} of {discrepancies.length} products · compared against {referenceInText}
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
    </div>
  );
};

/** Real /api/recon when VITE_REAL_RECON=true, the demo store otherwise. */
export const PriceDiscrepanciesView: React.FC = () => (realReconEnabled() ? <RealReconReportView kind="price" /> : <DemoPriceDiscrepanciesView />);
