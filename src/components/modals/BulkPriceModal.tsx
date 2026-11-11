import React, { useMemo, useRef, useState } from 'react';
import { X, Download, Upload, Tag, Info, AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  BULK_ACTION_LABELS,
  BulkPriceActionType,
  ParsedPriceFile,
  bulkActionNeedsValue,
  buildPriceTemplateCsv,
  downloadTextFile,
  formatDiff,
  formatQar,
  getBulkPatch,
  parsePriceCsv,
  resolveMarketplacePrice,
} from '../../lib/pricing';
import { ProductImage } from '../common/ProductImage';

type Scope = 'selected' | 'category' | 'all';

interface BulkPriceModalProps {
  open: boolean;
  onClose: () => void;
  /** Products pre-selected by the caller (catalogue selection or a single product). */
  productIds?: string[];
  initialTab?: 'rule' | 'upload';
  initialCategory?: string;
  onApplied?: () => void;
}

const PREVIEW_ROWS = 8;

export const BulkPriceModal: React.FC<BulkPriceModalProps> = ({
  open,
  onClose,
  productIds = [],
  initialTab = 'rule',
  initialCategory,
  onApplied,
}) => {
  const {
    products,
    pricingSettings,
    categoryPriceRules,
    bulkUpdatePrices,
    importMarketplacePrices,
    showToast,
  } = useApp();

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category))).sort(),
    [products]
  );

  const [tab, setTab] = useState<'rule' | 'upload'>(initialTab);
  const [scope, setScope] = useState<Scope>(
    productIds.length > 0 ? 'selected' : initialCategory ? 'category' : 'all'
  );
  const [category, setCategory] = useState<string>(initialCategory || categories[0] || '');
  const [actionType, setActionType] = useState<BulkPriceActionType>('percent');
  const [value, setValue] = useState<string>('10');
  const [offerUntil, setOfferUntil] = useState<string>('');
  const [parsed, setParsed] = useState<ParsedPriceFile | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const single = productIds.length === 1;

  const targets = useMemo(() => {
    if (scope === 'selected') return products.filter((p) => productIds.includes(p.id));
    if (scope === 'category') return products.filter((p) => p.category === category);
    return products;
  }, [scope, products, productIds, category]);

  const numericValue = parseFloat(value);
  const needsValue = bulkActionNeedsValue(actionType);
  const valueValid = !needsValue || (!Number.isNaN(numericValue) && (actionType === 'adjust' || actionType === 'percent' || actionType === 'amount' || numericValue >= 0));

  const preview = useMemo(() => {
    if (!valueValid) return [];
    return targets.map((p) => {
      const current = resolveMarketplacePrice(p, pricingSettings, categoryPriceRules).price;
      const patch = getBulkPatch(
        p,
        { type: actionType, value: needsValue ? numericValue : 0, offerUntil },
        pricingSettings,
        categoryPriceRules
      );
      const next = resolveMarketplacePrice({ ...p, ...patch }, pricingSettings, categoryPriceRules).price;
      return { product: p, current, next };
    });
  }, [targets, actionType, numericValue, needsValue, valueValid, offerUntil, pricingSettings, categoryPriceRules]);

  const changedCount = preview.filter((r) => Math.abs(r.next - r.current) >= 0.005).length;

  const filePreview = useMemo(() => {
    if (!parsed) return [];
    const byBarcode = new Map(products.map((p) => [p.barcode, p]));
    return parsed.rows.map((r) => {
      const p = byBarcode.get(r.barcode);
      return {
        row: r,
        product: p,
        current: p ? resolveMarketplacePrice(p, pricingSettings, categoryPriceRules).price : undefined,
      };
    });
  }, [parsed, products, pricingSettings, categoryPriceRules]);

  if (!open) return null;

  const handleApplyRule = () => {
    if (!valueValid || targets.length === 0) return;
    bulkUpdatePrices(
      targets.map((p) => p.id),
      { type: actionType, value: needsValue ? numericValue : 0, offerUntil: offerUntil || undefined }
    );
    showToast(
      single
        ? `Price updated for "${targets[0].nameEn}"`
        : `Price updated for ${targets.length} products`
    );
    onApplied?.();
    onClose();
  };

  const handleDownloadTemplate = () => {
    const list = scope === 'all' ? products : targets;
    downloadTextFile('Qorloop_Marketplace_Price_Template.csv', buildPriceTemplateCsv(list, pricingSettings, categoryPriceRules));
    showToast(`Template downloaded with ${list.length} products`, 'info');
  };

  const handleFile = (file?: File) => {
    if (!file) return;
    setFileName(file.name);
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setParsed({ rows: [], skipped: 0, error: 'Please upload a .csv file (in Excel: File → Save As → CSV).' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setParsed(parsePriceCsv(String(reader.result || '')));
    reader.readAsText(file);
  };

  const handleApplyFile = () => {
    if (!parsed || parsed.rows.length === 0) return;
    const { updated, notFound } = importMarketplacePrices(parsed.rows);
    showToast(
      `Price updated for ${updated} products${notFound ? ` · ${notFound} barcodes not found` : ''}`
    );
    onApplied?.();
    onClose();
  };

  const matchedCount = filePreview.filter((r) => r.product).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-white rounded-xl shadow-xl border border-gray-200 max-h-[90vh] flex flex-col animate-in fade-in duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <h2 className="text-base font-bold text-gray-900">
              {single ? 'Edit marketplace price' : 'Bulk update marketplace price'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {single
                ? targets[0]?.nameEn
                : 'The same price applies on Talabat, Snoonu, Rafeeq and Keeta.'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        {!single && (
          <div className="flex items-center gap-6 border-b border-gray-200 px-5 text-xs">
            <button
              onClick={() => setTab('rule')}
              className={`py-3 font-semibold border-b-2 transition-colors ${tab === 'rule' ? 'border-[#027864] text-[#027864]' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              Set price
            </button>
            <button
              onClick={() => setTab('upload')}
              className={`py-3 font-semibold border-b-2 transition-colors ${tab === 'upload' ? 'border-[#027864] text-[#027864]' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              Upload price file
            </button>
          </div>
        )}

        <div className="p-5 space-y-4 overflow-y-auto text-xs">
          {tab === 'rule' && (
            <>
              {/* Scope */}
              {!single && (
                <div className="space-y-1.5">
                  <div className="font-semibold text-gray-900">Apply to</div>
                  <div className="flex flex-wrap items-center gap-4">
                    {productIds.length > 0 && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" checked={scope === 'selected'} onChange={() => setScope('selected')} className="accent-[#027864]" />
                        <span>Selected products ({productIds.length})</span>
                      </label>
                    )}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" checked={scope === 'category'} onChange={() => setScope('category')} className="accent-[#027864]" />
                      <span>Category</span>
                    </label>
                    {scope === 'category' && (
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="border border-gray-200 rounded-lg p-1.5 text-xs bg-white text-gray-700"
                      >
                        {categories.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    )}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} className="accent-[#027864]" />
                      <span>All products ({products.length})</span>
                    </label>
                  </div>
                </div>
              )}

              {/* Action */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1">
                  <div className="font-semibold text-gray-900">Price change</div>
                  <select
                    value={actionType}
                    onChange={(e) => {
                      const t = e.target.value as BulkPriceActionType;
                      setActionType(t);
                      if (t === 'percent') setValue('10');
                      else if (t === 'amount' || t === 'adjust') setValue('1.00');
                      else if (t === 'fixed' || t === 'offer') setValue(single ? formatQar(preview[0]?.current) : '');
                    }}
                    className="w-full border border-gray-200 rounded-lg p-2 text-xs bg-white text-gray-700"
                  >
                    {(Object.keys(BULK_ACTION_LABELS) as BulkPriceActionType[]).map((t) => (
                      <option key={t} value={t}>
                        {BULK_ACTION_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                {needsValue && (
                  <div className="space-y-1">
                    <div className="font-semibold text-gray-900">
                      {actionType === 'percent' ? 'Markup (%)' : 'Amount (QAR)'}
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      className={`w-full border rounded-lg p-2 text-xs font-semibold ${valueValid ? 'border-gray-200' : 'border-red-300 bg-red-50'
                        }`}
                    />
                  </div>
                )}
              </div>

              {actionType === 'offer' && (
                <div className="space-y-1">
                  <div className="font-semibold text-gray-900">Offer valid until (optional)</div>
                  <input
                    type="text"
                    placeholder="e.g. 25 Oct 2026"
                    value={offerUntil}
                    onChange={(e) => setOfferUntil(e.target.value)}
                    className="w-48 border border-gray-200 rounded-lg p-2 text-xs"
                  />
                </div>
              )}

              {actionType === 'adjust' && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-50/70 text-blue-900 border border-blue-100">
                  <Info className="w-3.5 h-3.5 shrink-0 text-blue-600 mt-0.5" />
                  <span>Use a negative amount to reduce prices. The result is saved as an exact price per product.</span>
                </div>
              )}

              {/* Preview */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                  <span className="font-semibold text-gray-900">Preview</span>
                  <span className="text-gray-500">
                    {targets.length} products · {changedCount} price changes
                  </span>
                </div>
                <table className="w-full text-left text-xs">
                  <thead className="text-gray-500 border-b border-gray-100">
                    <tr>
                      <th className="py-2 px-3 font-medium">Product</th>
                      <th className="py-2 px-3 font-medium text-right">ERP</th>
                      <th className="py-2 px-3 font-medium text-right">Current</th>
                      <th className="py-2 px-3 font-medium text-right">New</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.slice(0, PREVIEW_ROWS).map(({ product, current, next }) => {
                      const changed = Math.abs(next - current) >= 0.005;
                      return (
                        <tr key={product.id}>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <ProductImage imageKey={product.imageKey} size="sm" />
                              <span className="font-medium text-gray-900">{product.nameEn}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right text-gray-600">{formatQar(product.erpPrice)}</td>
                          <td className="py-2 px-3 text-right text-gray-600">{formatQar(current)}</td>
                          <td className="py-2 px-3 text-right">
                            <span className={`font-bold ${changed ? 'text-[#027864]' : 'text-gray-800'}`}>
                              {formatQar(next)}
                            </span>
                            {changed && (
                              <span className="ml-1 text-[10px] text-gray-500">({formatDiff(next - current)})</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {preview.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-4 px-3 text-center text-gray-400">
                          {valueValid ? 'No products in this selection.' : 'Enter a valid amount to see the preview.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {preview.length > PREVIEW_ROWS && (
                  <div className="px-3 py-2 border-t border-gray-100 text-gray-500">
                    + {preview.length - PREVIEW_ROWS} more products
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'upload' && (
            <>
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-blue-50/70 text-blue-900 border border-blue-100">
                <Info className="w-4 h-4 shrink-0 text-blue-600 mt-0.5" />
                <div>
                  Download the template, fill the <span className="font-semibold">New marketplace price</span> column
                  and upload it back. Rows left empty are skipped. Products are matched by barcode.
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={handleDownloadTemplate}
                  className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:bg-gray-50 text-left"
                >
                  <Download className="w-5 h-5 text-[#027864]" />
                  <div>
                    <div className="font-semibold text-gray-900">Download template</div>
                    <div className="text-[11px] text-gray-500">
                      {scope === 'all' ? `All ${products.length} products` : `${targets.length} products`} with current prices (.csv)
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-3 p-4 border-2 border-dashed border-gray-300 rounded-xl hover:border-gray-400 text-left"
                >
                  <Upload className="w-5 h-5 text-gray-500" />
                  <div>
                    <div className="font-semibold text-gray-900">{fileName || 'Upload price file'}</div>
                    <div className="text-[11px] text-gray-500">CSV · Barcode + New marketplace price</div>
                  </div>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    handleFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>

              {parsed?.error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 text-red-800 border border-red-100">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{parsed.error}</span>
                </div>
              )}

              {parsed && !parsed.error && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                    <span className="font-semibold text-gray-900">Review</span>
                    <span className="text-gray-500">
                      {matchedCount} matched · {parsed.rows.length - matchedCount} not found · {parsed.skipped} skipped
                    </span>
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead className="text-gray-500 border-b border-gray-100">
                      <tr>
                        <th className="py-2 px-3 font-medium">Barcode</th>
                        <th className="py-2 px-3 font-medium">Product</th>
                        <th className="py-2 px-3 font-medium text-right">Current</th>
                        <th className="py-2 px-3 font-medium text-right">New</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filePreview.slice(0, PREVIEW_ROWS).map(({ row, product, current }) => (
                        <tr key={row.barcode}>
                          <td className="py-2 px-3 font-mono text-gray-600">{row.barcode}</td>
                          <td className="py-2 px-3">
                            {product ? (
                              <span className="font-medium text-gray-900">{product.nameEn}</span>
                            ) : (
                              <span className="text-red-600">Not in catalogue</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right text-gray-600">{formatQar(current)}</td>
                          <td className="py-2 px-3 text-right font-bold text-[#027864]">{formatQar(row.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filePreview.length > PREVIEW_ROWS && (
                    <div className="px-3 py-2 border-t border-gray-100 text-gray-500">
                      + {filePreview.length - PREVIEW_ROWS} more rows
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          {tab === 'rule' ? (
            <button
              onClick={handleApplyRule}
              disabled={!valueValid || targets.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Tag className="w-3.5 h-3.5" />
              <span>{single ? 'Save price' : `Apply to ${targets.length} products`}</span>
            </button>
          ) : (
            <button
              onClick={handleApplyFile}
              disabled={!parsed || !!parsed.error || matchedCount === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Update {matchedCount} prices</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
