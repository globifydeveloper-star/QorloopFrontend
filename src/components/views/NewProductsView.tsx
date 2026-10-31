import React, { useState } from 'react';
import { realCatalogueEnabled } from '../../lib/features';
import { RealNewProductsView } from '../catalogue/RealNewProductsView';
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ArrowRight,
  Package,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useDemo, expectedPrice, MARKETPLACE_IDS } from '../../demo';
import type { MarketplaceId } from '../../demo';

const MARKETPLACE_LABELS: Record<MarketplaceId, string> = {
  talabat: 'Talabat',
  snoonu: 'Snoonu',
  rafeeq: 'Rafeeq',
  keeta: 'Keeta',
};

const SAMPLE_ARABIC: Record<string, { ar: string; cat: string }> = {
  'Galaxy Smooth Milk 36g': { ar: 'جالاكسي حليب ناعم 36 جم', cat: 'snacks-confectionery' },
  'Mars 51g': { ar: 'مارس 51 جم', cat: 'snacks-confectionery' },
  'Red Bull Energy Drink 250ml': { ar: 'مشروب طاقة ريد بول 250 مل', cat: 'beverages' },
  'Nivea Men Deodorant Spray 150ml': { ar: 'مزيل عرق نيفيا للرجال بخاخ 150 مل', cat: 'personal-care' },
  'Kraft Cheddar Cheese Slices 200g': { ar: 'شرائح جبنة شيدر كرافت 200 جم', cat: 'dairy-eggs' },
  'Lipton Ice Tea Peach 320ml': { ar: 'ليبتون شاي مثلج بالخوخ 320 مل', cat: 'beverages' },
  'Barbican Pomegranate 330ml': { ar: 'باربيكان رمان 330 مل', cat: 'beverages' },
  'Al Rawabi Fresh Milk 2L': { ar: 'حليب الروابي طازج 2 لتر', cat: 'dairy-eggs' },
  'Pedigree Adult Chicken 3kg': { ar: 'بيديجري للكلاب البالغة دجاج 3 كجم', cat: 'pet-care' },
};

const DemoNewProductsView: React.FC = () => {
  const { navigate, showToast } = useApp();
  const { state, updateProduct, activateProducts } = useDemo();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const newProducts = state.products.filter((p) => p.status === 'new');

  const toggleSelectAll = () => {
    if (selectedIds.length === newProducts.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(newProducts.map((p) => p.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleActivate = () => {
    if (selectedIds.length === 0) return;
    const res = activateProducts(selectedIds);
    if (res.activated > 0 && res.skipped.length > 0) {
      showToast(
        `Activated ${res.activated} product${res.activated > 1 ? 's' : ''}. Skipped ${res.skipped.length} (missing Arabic name or category).`,
        'warning'
      );
    } else if (res.activated > 0) {
      showToast(
        `Activated ${res.activated} product${res.activated > 1 ? 's' : ''}. They are now ready for marketplace listing.`,
        'success'
      );
    } else {
      showToast(
        `Could not activate: missing required Arabic name or category.`,
        'error'
      );
    }
    // Deselect activated ones
    setSelectedIds((prev) => prev.filter((id) => res.skipped.includes(state.products.find((p) => p.id === id)?.nameEn || '')));
  };

  const getExpectedPrice = (p: typeof state.products[0], mp: MarketplaceId) => {
    const override = state.markups.find((m) => m.productId === p.id && m.marketplaceId === mp);
    const mpConfig = state.marketplaces.find((m) => m.id === mp);
    const markupPct = override ? override.markupPct : mpConfig?.defaultMarkupPct ?? 0;
    return expectedPrice(p.erpPrice, markupPct);
  };

  const getMissingRequirements = (p: typeof state.products[0]) => {
    const missing: string[] = [];
    if (!p.nameAr || !p.nameAr.trim()) missing.push('Arabic name');
    if (!p.categoryId) missing.push('Category');
    return missing;
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">New Products</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
              {newProducts.length} to activate
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Products imported from ERP that need Qorloop attributes before marketplace export
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('outputs-generate')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-gray-700 hover:text-gray-900 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 shadow-sm transition-colors"
          >
            <span>Go to Generate Files</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleActivate}
            disabled={selectedIds.length === 0}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl shadow-sm transition-colors ${
              selectedIds.length > 0
                ? 'bg-[#027864] hover:bg-[#02604F] text-white cursor-pointer'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Activate Selected ({selectedIds.length})</span>
          </button>
        </div>
      </div>

      {/* Info Banner */}
      <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
        <div className="text-xs text-emerald-900 leading-relaxed">
          <span className="font-semibold">Listing Workflow:</span> Fill in the Arabic name and Qorloop category directly in the table below. Once activated, these items become available to generate in your <strong>New products</strong> marketplace update files.
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        {newProducts.length === 0 ? (
          <div className="p-12 text-center">
            <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-base font-semibold text-gray-900">No new products pending activation</p>
            <p className="text-xs text-gray-500 mt-1">
              All ERP items are currently active or categorized. When a new product is imported via ERP upload, it will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider border-b border-gray-100">
                <tr>
                  <th className="w-10 px-4 py-3.5 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === newProducts.length && newProducts.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300 text-[#027864] focus:ring-[#027864]"
                    />
                  </th>
                  <th className="px-4 py-3.5">Product (ERP)</th>
                  <th className="px-4 py-3.5">Barcode</th>
                  <th className="px-4 py-3.5">ERP Price</th>
                  <th className="px-4 py-3.5 w-64">Arabic Name (Qorloop)</th>
                  <th className="px-4 py-3.5 w-48">Category (Qorloop)</th>
                  <th className="px-4 py-3.5 text-center">Expected Prices</th>
                  <th className="px-4 py-3.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium">
                {newProducts.map((p) => {
                  const missing = getMissingRequirements(p);
                  const isReady = missing.length === 0;

                  return (
                    <tr key={p.id} className="hover:bg-gray-50/70 transition-colors">
                      <td className="px-4 py-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(p.id)}
                          onChange={() => toggleSelect(p.id)}
                          className="rounded border-gray-300 text-[#027864] focus:ring-[#027864]"
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-gray-900">{p.nameEn}</div>
                        <div className="text-[11px] text-gray-400 font-mono mt-0.5">{p.id}</div>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[11px] text-gray-600">
                        {p.barcode || '—'}
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-gray-900 font-mono">
                        {p.erpPrice.toFixed(2)} QAR
                      </td>
                      <td className="px-4 py-3.5">
                        <input
                          type="text"
                          dir="rtl"
                          placeholder="أدخل الاسم بالعربية"
                          value={p.nameAr || ''}
                          onChange={(e) => updateProduct(p.id, { nameAr: e.target.value })}
                          className={`w-full px-2.5 py-1.5 text-xs rounded-lg border focus:ring-1 focus:ring-[#027864] outline-none transition-colors ${
                            !p.nameAr
                              ? 'border-amber-300 bg-amber-50/30 text-gray-900'
                              : 'border-gray-200 bg-white text-gray-900'
                          }`}
                        />
                        {!p.nameAr && SAMPLE_ARABIC[p.nameEn] && (
                          <button
                            type="button"
                            onClick={() => {
                              const s = SAMPLE_ARABIC[p.nameEn];
                              updateProduct(p.id, {
                                nameAr: s.ar,
                                ...(p.categoryId ? {} : { categoryId: s.cat }),
                              });
                            }}
                            className="mt-1 text-[10px] text-[#027864] hover:underline flex items-center gap-1 font-medium"
                          >
                            <span>Quick fill: {SAMPLE_ARABIC[p.nameEn].ar}</span>
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <select
                          value={p.categoryId || ''}
                          onChange={(e) => updateProduct(p.id, { categoryId: e.target.value })}
                          className={`w-full px-2.5 py-1.5 text-xs rounded-lg border focus:ring-1 focus:ring-[#027864] outline-none transition-colors ${
                            !p.categoryId
                              ? 'border-amber-300 bg-amber-50/30 text-gray-900'
                              : 'border-gray-200 bg-white text-gray-900'
                          }`}
                        >
                          <option value="">Select category...</option>
                          {state.categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nameEn}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-center gap-1.5">
                          {MARKETPLACE_IDS.map((mp) => {
                            const exp = getExpectedPrice(p, mp);
                            return (
                              <div
                                key={mp}
                                className="px-2 py-1 bg-gray-50 border border-gray-100 rounded text-[10px] text-center"
                                title={`${MARKETPLACE_LABELS[mp]}: ${exp.toFixed(2)} QAR`}
                              >
                                <span className="text-gray-400 block uppercase font-bold text-[8px]">
                                  {mp.slice(0, 3)}
                                </span>
                                <span className="font-semibold text-gray-800 font-mono">
                                  {exp.toFixed(2)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {isReady ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" />
                            Ready
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                            <AlertCircle className="w-3 h-3" />
                            Needs: {missing.join(', ')}
                          </span>
                        )}
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

/** Real /api/products and /api/categories when VITE_REAL_CATALOGUE=true, the demo store otherwise. */
export const NewProductsView: React.FC = () => (realCatalogueEnabled() ? <RealNewProductsView /> : <DemoNewProductsView />);
