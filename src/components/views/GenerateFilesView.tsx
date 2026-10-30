import React, { useMemo, useState } from 'react';
import {
  Info,
  Download,
  MoreHorizontal,
  HelpCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import { MarketplaceBadge } from '../common/MarketplaceBadge';
import { MarketplaceId } from '../../types';
import { MARKETPLACE_IDS, REFERENCE_LABELS, checkProductPrices } from '../../lib/pricing';

// Stock mismatch counts come from the latest stock reconciliation (unchanged demo figures).
const STOCK_MISMATCHES: Record<MarketplaceId, number> = {
  talabat: 32,
  snoonu: 27,
  rafeeq: 40,
  keeta: 0,
};

export const GenerateFilesView: React.FC = () => {
  const {
    outputFiles,
    generateMarketplaceFiles,
    openUploadModal,
    navigate,
    showToast,
    products,
    pricingSettings,
    categoryPriceRules,
    compareReference,
    setCompareReference,
  } = useApp();
  const { can } = useAuth();

  const [selectedMarketplaces, setSelectedMarketplaces] = useState<Record<MarketplaceId, boolean>>({
    talabat: true,
    snoonu: true,
    rafeeq: true,
    keeta: false,
  });

  const [includeMode, setIncludeMode] = useState<Record<MarketplaceId, 'mismatches' | 'all'>>({
    talabat: 'mismatches',
    snoonu: 'mismatches',
    rafeeq: 'mismatches',
    keeta: 'mismatches',
  });

  const [globalContent, setGlobalContent] = useState<'mismatches' | 'all'>('mismatches');
  const [fileFormat, setFileFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [priceRounding, setPriceRounding] = useState('Keep current prices');

  // Price mismatches per marketplace, against the selected reference price.
  const priceMismatches = useMemo(() => {
    const counts: Record<MarketplaceId, number> = { talabat: 0, snoonu: 0, rafeeq: 0, keeta: 0 };
    products.forEach((p) => {
      const checks = checkProductPrices(p, compareReference, pricingSettings, categoryPriceRules);
      MARKETPLACE_IDS.forEach((mp) => {
        if (checks[mp].mismatch) counts[mp]++;
      });
    });
    return counts;
  }, [products, compareReference, pricingSettings, categoryPriceRules]);

  const totalFor = (mp: MarketplaceId) => STOCK_MISMATCHES[mp] + priceMismatches[mp];

  const selectedCount = Object.entries(selectedMarketplaces).filter(
    ([k, v]) => v && k !== 'keeta'
  ).length;

  const handleGenerate = () => {
    const mps = (Object.keys(selectedMarketplaces) as MarketplaceId[]).filter(
      (m) => selectedMarketplaces[m] && m !== 'keeta'
    );
    const counts: Partial<Record<MarketplaceId, number>> = {};
    mps.forEach((mp) => (counts[mp] = totalFor(mp)));
    generateMarketplaceFiles(mps, globalContent, fileFormat, counts);
  };

  const handleDownload = (fileName: string) => {
    showToast(`Downloading ${fileName}...`);
  };

  const activeMarketplaces: MarketplaceId[] = ['talabat', 'snoonu', 'rafeeq'];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-150">
      {/* Breadcrumb & Header */}
      <div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
          <span className="text-blue-600 cursor-pointer hover:underline">Outputs</span>
          <span>/</span>
          <span className="text-gray-700">Generate marketplace files</span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Generate marketplace files
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Create corrected files with the latest stock and price changes. Download and
          upload them to each marketplace portal.
        </p>
      </div>

      {/* Info Notice */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-blue-50/70 text-blue-900 border border-blue-100 text-xs">
        <Info className="w-4 h-4 shrink-0 text-blue-600 mt-0.5" />
        <div>
          <span className="font-semibold">
            Files include only the products that need to be updated (mismatches) by default.
          </span>{' '}
          You can choose to include all products if required by a marketplace. Prices in the files use your{' '}
          <span className="font-semibold">{REFERENCE_LABELS[compareReference]}</span>.
        </div>
      </div>

      {/* Main Grid: Marketplace Selection (3 cols) + File Options (1 col) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* Marketplaces Table (3 Cols) */}
        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-xl p-5 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-gray-900">Select marketplaces</h2>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                <tr>
                  <th className="py-2.5 px-3 w-8">
                    <input
                      type="checkbox"
                      checked={selectedCount === 3}
                      onChange={(e) =>
                        setSelectedMarketplaces({
                          talabat: e.target.checked,
                          snoonu: e.target.checked,
                          rafeeq: e.target.checked,
                          keeta: false,
                        })
                      }
                      className="rounded accent-[#027864]"
                    />
                  </th>
                  <th className="py-2.5 px-3">Marketplace</th>
                  <th className="py-2.5 px-3">Mismatches</th>
                  <th className="py-2.5 px-3">Include in file</th>
                  <th className="py-2.5 px-3">File type</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activeMarketplaces.map((mp) => (
                  <tr key={mp} className="hover:bg-gray-50">
                    <td className="py-3 px-3">
                      <input
                        type="checkbox"
                        checked={selectedMarketplaces[mp]}
                        onChange={(e) =>
                          setSelectedMarketplaces({
                            ...selectedMarketplaces,
                            [mp]: e.target.checked,
                          })
                        }
                        className="rounded accent-[#027864]"
                      />
                    </td>
                    <td className="py-3 px-3">
                      <MarketplaceBadge marketplace={mp} />
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-gray-900 text-sm">{totalFor(mp)}</div>
                      <div className="text-[11px] text-gray-500">
                        {STOCK_MISMATCHES[mp]} stock &nbsp;•&nbsp; {priceMismatches[mp]} price
                      </div>
                    </td>
                    <td className="py-3 px-3 space-y-1">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`${mp}-include`}
                          checked={includeMode[mp] === 'mismatches'}
                          onChange={() =>
                            setIncludeMode({ ...includeMode, [mp]: 'mismatches' })
                          }
                          className="accent-[#027864]"
                        />
                        <span>Mismatches only ({totalFor(mp)})</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-gray-500">
                        <input
                          type="radio"
                          name={`${mp}-include`}
                          checked={includeMode[mp] === 'all'}
                          onChange={() =>
                            setIncludeMode({ ...includeMode, [mp]: 'all' })
                          }
                          className="accent-[#027864]"
                        />
                        <span>All products (12,480)</span>
                      </label>
                    </td>
                    <td className="py-3 px-3 text-gray-600">Excel (.xlsx)</td>
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => navigate('reports-price-discrepancies')}
                        className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 shadow-xs"
                      >
                        Preview changes
                      </button>
                    </td>
                  </tr>
                ))}

                {/* Keeta */}
                <tr className="opacity-75">
                  <td className="py-3 px-3">
                    <input
                      type="checkbox"
                      disabled
                      checked={false}
                      className="rounded opacity-40"
                    />
                  </td>
                  <td className="py-3 px-3">
                    <MarketplaceBadge marketplace="keeta" />
                  </td>
                  <td className="py-3 px-3">
                    <div className="text-gray-400 font-bold">—</div>
                    <div className="text-[11px] text-gray-500">No file uploaded yet</div>
                  </td>
                  <td className="py-3 px-3 text-gray-400">—</td>
                  <td className="py-3 px-3 text-gray-600">Excel (.xlsx)</td>
                  <td className="py-3 px-3 text-right">
                    <button
                      disabled
                      className="px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-50 border border-gray-200 rounded-lg cursor-not-allowed"
                    >
                      Preview changes
                    </button>
                  </td>
                </tr>

                {/* Keeta Upload helper row */}
                <tr>
                  <td colSpan={6} className="py-2.5 px-3 bg-blue-50/40 text-xs">
                    <div className="flex items-center gap-2 text-blue-900">
                      <Info className="w-3.5 h-3.5 text-blue-600" />
                      <span>
                        Upload a Keeta file to see mismatches and generate an output file.
                      </span>
                      {can('uploads.upload') && (
                        <button
                          onClick={() => openUploadModal('keeta')}
                          className="text-[#027864] font-semibold hover:underline"
                        >
                          Upload Keeta file
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Sidebar: File Options */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs space-y-4 text-xs">
          <h2 className="text-sm font-bold text-gray-900">File options</h2>

          {/* Price in file */}
          <div className="space-y-2">
            <label className="block font-semibold text-gray-900">Price in file</label>
            <div className="space-y-2">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="priceReference"
                  checked={compareReference === 'marketplace'}
                  onChange={() => setCompareReference('marketplace')}
                  className="mt-0.5 accent-[#027864]"
                />
                <div>
                  <div className="font-semibold text-gray-900">Marketplace price (default)</div>
                  <div className="text-[11px] text-gray-500">
                    The price you set in Marketplace Price — same on all marketplaces.
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="priceReference"
                  checked={compareReference === 'erp'}
                  onChange={() => setCompareReference('erp')}
                  className="mt-0.5 accent-[#027864]"
                />
                <div>
                  <div className="font-semibold text-gray-900">ERP price</div>
                  <div className="text-[11px] text-gray-500">
                    The price from your latest ERP export.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* File content */}
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <label className="block font-semibold text-gray-900">File content</label>
            <div className="space-y-2">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="globalContent"
                  checked={globalContent === 'mismatches'}
                  onChange={() => setGlobalContent('mismatches')}
                  className="mt-0.5 accent-[#027864]"
                />
                <div>
                  <div className="font-semibold text-gray-900">
                    Mismatches only (default)
                  </div>
                  <div className="text-[11px] text-gray-500">
                    Only products with stock or price changes.
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="globalContent"
                  checked={globalContent === 'all'}
                  onChange={() => setGlobalContent('all')}
                  className="mt-0.5 accent-[#027864]"
                />
                <div>
                  <div className="font-semibold text-gray-900">All products</div>
                  <div className="text-[11px] text-gray-500">
                    Full product list for the selected marketplace.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* File format */}
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <label className="block font-semibold text-gray-900">File format</label>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="format"
                  checked={fileFormat === 'xlsx'}
                  onChange={() => setFileFormat('xlsx')}
                  className="accent-[#027864]"
                />
                <span className="text-gray-900">Excel (.xlsx)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="format"
                  checked={fileFormat === 'csv'}
                  onChange={() => setFileFormat('csv')}
                  className="accent-[#027864]"
                />
                <span className="text-gray-900">CSV (.csv)</span>
              </label>
            </div>
          </div>

          {/* Price rounding */}
          <div className="space-y-1.5 pt-2 border-t border-gray-100">
            <div className="flex items-center gap-1 font-semibold text-gray-900">
              <span>Price rounding</span>
              <HelpCircle className="w-3.5 h-3.5 text-gray-400" />
            </div>
            <select
              value={priceRounding}
              onChange={(e) => setPriceRounding(e.target.value)}
              className="w-full border border-gray-200 rounded-lg p-2 text-xs bg-white text-gray-700"
            >
              <option>Keep current prices</option>
              <option>Round to nearest 0.25 QAR</option>
              <option>Round to nearest 0.50 QAR</option>
            </select>
            <p className="text-[10px] text-gray-400 leading-tight">
              Prices will not be rounded. We'll use the exact values from your catalogue.
            </p>
          </div>

          {/* Action buttons */}
          <div className="space-y-2 pt-3">
            <button
              onClick={handleGenerate}
              className="w-full py-2.5 text-xs font-bold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg transition-colors shadow-xs"
            >
              Generate files ({selectedCount} marketplaces)
            </button>
            <button
              onClick={() => navigate('dashboard')}
              className="w-full py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Section: Recent Output Files */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900">Recent output files</h2>
          <button
            onClick={() => showToast('Displaying all generated archive files')}
            className="text-xs font-medium text-[#027864] hover:underline"
          >
            View all files
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
              <tr>
                <th className="py-2.5 px-3">Generated on</th>
                <th className="py-2.5 px-3">Marketplace</th>
                <th className="py-2.5 px-3">File name</th>
                <th className="py-2.5 px-3 text-right">Products in file</th>
                <th className="py-2.5 px-3 text-right">Changes</th>
                <th className="py-2.5 px-3">Price used</th>
                <th className="py-2.5 px-3">Generated by</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {outputFiles.map((file) => (
                <tr key={file.id} className="hover:bg-gray-50">
                  <td className="py-3 px-3 text-gray-600 whitespace-nowrap">
                    {file.generatedOn}
                  </td>
                  <td className="py-3 px-3">
                    <MarketplaceBadge marketplace={file.marketplace} />
                  </td>
                  <td className="py-3 px-3 font-medium text-gray-900 font-mono">
                    {file.fileName}
                  </td>
                  <td className="py-3 px-3 text-right text-gray-700 font-medium">
                    {file.productsInFile}
                  </td>
                  <td className="py-3 px-3 text-right text-gray-700 font-medium">
                    {file.changes}
                  </td>
                  <td className="py-3 px-3 text-gray-600 whitespace-nowrap">
                    {file.priceReference ? REFERENCE_LABELS[file.priceReference] : 'ERP price'}
                  </td>
                  <td className="py-3 px-3 text-gray-600">{file.generatedBy}</td>
                  <td className="py-3 px-3 text-center">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#E3FAF3] text-[#027864]">
                      {file.status}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <button
                        onClick={() => handleDownload(file.fileName)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 shadow-xs"
                      >
                        <Download className="w-3.5 h-3.5 text-gray-500" />
                        <span>Download</span>
                      </button>
                      <button className="text-gray-400 hover:text-gray-600 p-1">
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
