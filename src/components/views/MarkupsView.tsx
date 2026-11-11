import React, { useMemo, useState } from 'react';
import { Plus, Save, Upload, Layers, AlertTriangle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { MarketplaceBadge } from '../common/MarketplaceBadge';
import { PriceSourceChip } from '../common/PriceSourceChip';
import { ProductImage } from '../common/ProductImage';
import { BulkPriceModal } from '../modals/BulkPriceModal';
import {
  MARKETPLACE_IDS,
  applyRounding,
  applyRule,
  describeRule,
  formatQar,
  round2,
} from '../../lib/pricing';
import { MarketplaceId, PriceMode, PriceRounding, PriceRule } from '../../types';
import { realPricingEnabled } from '../../lib/features';
import { RealPricingView } from '../pricing/RealPricingView';

const MODE_OPTIONS: { id: PriceMode; label: string }[] = [
  { id: 'percent', label: 'Markup % on ERP' },
  { id: 'amount', label: '+ Fixed amount (QAR)' },
  { id: 'same', label: 'Same as ERP' },
];

const CATEGORY_MODE_OPTIONS: { id: PriceMode; label: string }[] = [
  ...MODE_OPTIONS,
  { id: 'fixed', label: 'Exact price (QAR)' },
];

/** Real /api/pricing when VITE_REAL_PRICING=true, the demo store otherwise. */
export const MarkupsView: React.FC = () => (realPricingEnabled() ? <RealPricingView /> : <DemoMarkupsView />);

const DemoMarkupsView: React.FC = () => {
  const {
    showToast,
    products,
    pricingSettings,
    updatePricingSettings,
    categoryPriceRules,
    upsertCategoryPriceRule,
    removeCategoryPriceRule,
    getMarketplacePrice,
    bulkUpdatePrices,
  } = useApp();

  // Default rule is edited as a draft and applied on "Save rules"
  const [defaultRule, setDefaultRule] = useState<PriceRule>(pricingSettings.defaultRule);
  const [rounding, setRounding] = useState<PriceRounding>(pricingSettings.rounding);
  const [markups, setMarkups] = useState(pricingSettings.marketplaceRules);

  const [showAddRule, setShowAddRule] = useState(false);
  const allCategories = useMemo(
    () => Array.from(new Set(['Fruits & Vegetables', ...products.map((p) => p.category)])).sort(),
    [products]
  );
  const [newRuleCategory, setNewRuleCategory] = useState('');
  const [newRuleMode, setNewRuleMode] = useState<PriceMode>('percent');
  const [newRuleValue, setNewRuleValue] = useState('10');

  const [modal, setModal] = useState<{ open: boolean; tab: 'rule' | 'upload'; ids: string[] }>({
    open: false,
    tab: 'rule',
    ids: [],
  });

  const exampleProduct = products.find((p) => p.id === '987654') || products[0];
  const examplePrice =
    defaultRule.mode === 'same'
      ? round2(exampleProduct.erpPrice)
      : applyRounding(applyRule(exampleProduct.erpPrice, defaultRule), rounding);

  const overriddenProducts = products.filter((p) => p.priceRule || p.offerPrice !== undefined);

  const handleSave = () => {
    updatePricingSettings({ defaultRule, rounding, marketplaceRules: markups });
    showToast('Pricing rules updated successfully!');
  };

  const handleAddCategoryRule = () => {
    const category = newRuleCategory || allCategories.find((c) => !categoryPriceRules.some((r) => r.category === c)) || allCategories[0];
    const value = parseFloat(newRuleValue);
    if (newRuleMode !== 'same' && Number.isNaN(value)) {
      showToast('Enter a valid value for the rule', 'warning');
      return;
    }
    upsertCategoryPriceRule({
      id: 'cpr-' + Date.now(),
      category,
      rule: { mode: newRuleMode, value: newRuleMode === 'same' ? 0 : value },
    });
    setShowAddRule(false);
    setNewRuleCategory('');
    showToast(`Category rule saved for "${category}"`);
  };

  const setMarketplaceMarkup = (mp: MarketplaceId, patch: Partial<(typeof markups)[MarketplaceId]>) => {
    setMarkups({ ...markups, [mp]: { ...markups[mp], ...patch } });
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-150">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Pricing</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            The price you sell at on marketplaces. Set it once — it applies to Talabat, Snoonu, Rafeeq and
            Keeta. It can be above ERP (markup) or below it (offers).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setModal({ open: true, tab: 'upload', ids: [] })}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-xs"
          >
            <Upload className="w-3.5 h-3.5 text-gray-500" />
            <span>Upload price file</span>
          </button>
          <button
            onClick={() => setModal({ open: true, tab: 'rule', ids: [] })}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg transition-colors shadow-xs"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Bulk update</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6">
          {/* Default rule */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Default marketplace price</h2>
                <p className="text-xs text-gray-500">Used for every product without a category or product price.</p>
              </div>
              <button
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg shadow-xs"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save rules</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Applies to</th>
                    <th className="py-2.5 px-3">Price rule</th>
                    <th className="py-2.5 px-3">Value</th>
                    <th className="py-2.5 px-3">Rounding rule</th>
                    <th className="py-2.5 px-3 text-right">Example</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr className="hover:bg-gray-50">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1">
                        {MARKETPLACE_IDS.map((mp) => (
                          <MarketplaceBadge key={mp} marketplace={mp} showName={false} size="sm" />
                        ))}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-1">All marketplaces</div>
                    </td>
                    <td className="py-3 px-3">
                      <select
                        value={defaultRule.mode}
                        onChange={(e) => {
                          const mode = e.target.value as PriceMode;
                          setDefaultRule({ mode, value: mode === 'percent' ? 10 : mode === 'amount' ? 1 : 0 });
                        }}
                        className="border border-gray-200 rounded-lg p-1.5 text-xs bg-white text-gray-700"
                      >
                        {MODE_OPTIONS.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 px-3">
                      {defaultRule.mode === 'same' ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            step={defaultRule.mode === 'percent' ? 1 : 0.25}
                            value={defaultRule.value}
                            onChange={(e) =>
                              setDefaultRule({ ...defaultRule, value: parseFloat(e.target.value) || 0 })
                            }
                            className="w-20 border border-gray-200 rounded-lg p-1.5 text-xs font-semibold"
                          />
                          <span className="text-gray-400 font-medium">
                            {defaultRule.mode === 'percent' ? '%' : 'QAR'}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <select
                        value={rounding}
                        onChange={(e) => setRounding(e.target.value as PriceRounding)}
                        className="border border-gray-200 rounded-lg p-1.5 text-xs bg-white text-gray-700"
                      >
                        <option value="Exact">Exact</option>
                        <option value="0.25">Round to 0.25 QAR</option>
                        <option value="0.50">Round to 0.50 QAR</option>
                      </select>
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <div className="text-gray-500">{exampleProduct.nameEn}</div>
                      <div className="font-semibold text-gray-900">
                        {formatQar(exampleProduct.erpPrice)} → {formatQar(examplePrice)}
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Category rules */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Category rules</h2>
                <p className="text-xs text-gray-500">
                  Override the default price for a whole category — e.g. fruits & vegetables at ERP + 1.00 QAR.
                </p>
              </div>
              <button
                onClick={() => setShowAddRule(!showAddRule)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 shadow-xs"
              >
                <Plus className="w-3.5 h-3.5 text-gray-500" />
                <span>Add rule</span>
              </button>
            </div>

            {showAddRule && (
              <div className="flex flex-wrap items-end gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs">
                <div className="space-y-1">
                  <div className="font-semibold text-gray-700">Category</div>
                  <select
                    value={newRuleCategory}
                    onChange={(e) => setNewRuleCategory(e.target.value)}
                    className="border border-gray-200 rounded-lg p-1.5 text-xs bg-white text-gray-700"
                  >
                    <option value="">Select category</option>
                    {allCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                        {categoryPriceRules.some((r) => r.category === c) ? ' (has rule)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="font-semibold text-gray-700">Price rule</div>
                  <select
                    value={newRuleMode}
                    onChange={(e) => setNewRuleMode(e.target.value as PriceMode)}
                    className="border border-gray-200 rounded-lg p-1.5 text-xs bg-white text-gray-700"
                  >
                    {CATEGORY_MODE_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                {newRuleMode !== 'same' && (
                  <div className="space-y-1">
                    <div className="font-semibold text-gray-700">Value</div>
                    <input
                      type="number"
                      step="0.01"
                      value={newRuleValue}
                      onChange={(e) => setNewRuleValue(e.target.value)}
                      className="w-24 border border-gray-200 rounded-lg p-1.5 text-xs font-semibold bg-white"
                    />
                  </div>
                )}
                <button
                  onClick={handleAddCategoryRule}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg shadow-xs"
                >
                  Save rule
                </button>
                <button onClick={() => setShowAddRule(false)} className="px-2 py-1.5 text-gray-600 hover:underline">
                  Cancel
                </button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">Price rule</th>
                    <th className="py-2.5 px-3 text-right">Products</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {categoryPriceRules.map((r) => {
                    const count = products.filter((p) => p.category === r.category).length;
                    return (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="py-3 px-3 font-medium text-gray-900">{r.category}</td>
                        <td className="py-3 px-3 font-semibold text-gray-900">{describeRule(r.rule)}</td>
                        <td className="py-3 px-3 text-right text-gray-700">{count}</td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <button
                            onClick={() =>
                              setModal({
                                open: true,
                                tab: 'rule',
                                ids: products.filter((p) => p.category === r.category).map((p) => p.id),
                              })
                            }
                            className="text-[#027864] hover:underline mr-3"
                          >
                            Update prices
                          </button>
                          <button
                            onClick={() => {
                              removeCategoryPriceRule(r.id);
                              showToast('Category rule removed');
                            }}
                            className="text-red-600 hover:underline"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {categoryPriceRules.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 px-3 text-center text-gray-400">
                        No category rules. All products use the default marketplace price.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Product prices & offers */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs space-y-4">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Product prices and offers</h2>
              <p className="text-xs text-gray-500">
                Products with their own price or a temporary offer. Edit from here or from the catalogue.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Product</th>
                    <th className="py-2.5 px-3 text-right">ERP price (QAR)</th>
                    <th className="py-2.5 px-3">Price rule</th>
                    <th className="py-2.5 px-3 text-right">Expected price (QAR)</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {overriddenProducts.map((p) => {
                    const resolved = getMarketplacePrice(p);
                    return (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-3">
                            <ProductImage imageKey={p.imageKey} size="sm" />
                            <span className="font-medium text-gray-900">{p.nameEn}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right text-gray-700">{formatQar(p.erpPrice)}</td>
                        <td className="py-3 px-3 text-gray-700">
                          {p.offerPrice !== undefined ? (
                            <span>
                              Offer {formatQar(p.offerPrice)}
                              {p.offerUntil ? <span className="text-gray-400"> · until {p.offerUntil}</span> : null}
                            </span>
                          ) : (
                            describeRule(p.priceRule)
                          )}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <span className="font-semibold text-gray-900">{formatQar(resolved.price)}</span>
                            <PriceSourceChip source={resolved.source} />
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => setModal({ open: true, tab: 'rule', ids: [p.id] })}
                            className="text-[#027864] hover:underline mr-3"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              bulkUpdatePrices([p.id], {
                                type: p.offerPrice !== undefined ? 'remove-offer' : 'reset',
                                value: 0,
                              });
                              showToast(
                                p.offerPrice !== undefined
                                  ? `Offer removed for "${p.nameEn}"`
                                  : `"${p.nameEn}" now follows the category / default rule`
                              );
                            }}
                            className="text-red-600 hover:underline"
                          >
                            {p.offerPrice !== undefined ? 'End offer' : 'Reset'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {overriddenProducts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-4 px-3 text-center text-gray-400">
                        No product-level prices.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Advanced: per-marketplace pricing */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Advanced: different price per marketplace</h2>
                <p className="text-xs text-gray-500">
                  Only for merchants who sell at different prices on each marketplace. Category and product
                  prices still apply to all marketplaces.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer shrink-0 text-xs font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={pricingSettings.perMarketplaceEnabled}
                  onChange={(e) => {
                    updatePricingSettings({ perMarketplaceEnabled: e.target.checked, marketplaceRules: markups });
                    showToast(
                      e.target.checked
                        ? 'Per-marketplace pricing enabled'
                        : 'Per-marketplace pricing disabled — one price on all marketplaces',
                      e.target.checked ? 'warning' : 'success'
                    );
                  }}
                  className="rounded accent-[#027864] w-4 h-4"
                />
                <span>{pricingSettings.perMarketplaceEnabled ? 'Enabled' : 'Disabled'}</span>
              </label>
            </div>

            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 text-amber-900 border border-amber-200 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600 mt-0.5" />
              <span>
                Most marketplace contracts require the same price on every marketplace. Different prices can be
                flagged by the marketplaces.
              </span>
            </div>

            {pricingSettings.perMarketplaceEnabled && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                    <tr>
                      <th className="py-2.5 px-3">Marketplace</th>
                      <th className="py-2.5 px-3">Default markup (%)</th>
                      <th className="py-2.5 px-3">Rounding rule</th>
                      <th className="py-2.5 px-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {MARKETPLACE_IDS.map((mp) => {
                      const m = markups[mp];
                      return (
                        <tr key={mp} className="hover:bg-gray-50">
                          <td className="py-3 px-3">
                            <MarketplaceBadge marketplace={mp} />
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                value={m.markup}
                                onChange={(e) => setMarketplaceMarkup(mp, { markup: parseFloat(e.target.value) || 0 })}
                                className="w-20 border border-gray-200 rounded-lg p-1.5 text-xs font-semibold"
                              />
                              <span className="text-gray-400 font-medium">%</span>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <select
                              value={m.rounding}
                              onChange={(e) => setMarketplaceMarkup(mp, { rounding: e.target.value as PriceRounding })}
                              className="border border-gray-200 rounded-lg p-1.5 text-xs bg-white text-gray-700"
                            >
                              <option value="Exact">Exact</option>
                              <option value="0.25">Round to 0.25 QAR</option>
                              <option value="0.50">Round to 0.50 QAR</option>
                            </select>
                          </td>
                          <td className="py-3 px-3 text-right">
                            <button
                              onClick={() => setMarketplaceMarkup(mp, { active: !m.active })}
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                                m.active ? 'bg-[#E3FAF3] text-[#027864]' : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {m.active ? 'Active' : 'Disabled'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-[11px] text-gray-500 mt-2">Click "Save rules" above to apply markup changes.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Info Box */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs space-y-3 text-xs">
            <h3 className="font-bold uppercase tracking-wider text-gray-900">How the price is picked</h3>
            <ol className="space-y-2">
              {[
                ['offer', 'Offer price', 'Temporary price, e.g. clearance or near expiry. Can be below ERP.'],
                ['product', 'Product price', 'Set on a single product (exact price, % or + QAR).'],
                ['category', 'Category rule', 'Applies to every product in the category.'],
                ['default', 'Default rule', 'Everything else.'],
              ].map(([source, title, desc], i) => (
                <li key={source} className="flex gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-[#E3FAF3] text-[#027864] font-bold flex items-center justify-center shrink-0 text-[11px]">
                    {i + 1}
                  </span>
                  <div>
                    <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                      {title} <PriceSourceChip source={source as 'offer'} />
                    </div>
                    <div className="text-[11px] text-gray-500 leading-relaxed">{desc}</div>
                  </div>
                </li>
              ))}
            </ol>
            <p className="text-[11px] text-gray-500 leading-relaxed pt-2 border-t border-gray-100">
              The same marketplace price is used on every marketplace, in price reports and in generated price
              files.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs space-y-2 text-xs">
            <h3 className="font-bold uppercase tracking-wider text-gray-900">Summary</h3>
            <div className="flex justify-between py-1">
              <span className="text-gray-500">Products</span>
              <span className="font-semibold text-gray-900">{products.length}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-gray-500">Category rules</span>
              <span className="font-semibold text-gray-900">{categoryPriceRules.length}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-gray-500">Product prices</span>
              <span className="font-semibold text-gray-900">{products.filter((p) => p.priceRule).length}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-gray-500">Active offers</span>
              <span className="font-semibold text-gray-900">
                {products.filter((p) => p.offerPrice !== undefined).length}
              </span>
            </div>
          </div>
        </div>
      </div>

      {modal.open && (
        <BulkPriceModal
          open
          onClose={() => setModal({ ...modal, open: false })}
          productIds={modal.ids}
          initialTab={modal.tab}
        />
      )}
    </div>
  );
};
