import React, { useState } from 'react';
import { realCatalogueEnabled } from '../../lib/features';
import { RealProductDetailView } from '../catalogue/RealProductDetailView';
import {
  Copy,
  Plus,
  ChevronDown,
  MoreHorizontal,
  Tag,
  FolderTree,
  Languages,
  BarChart2,
  MinusCircle,
  Trash2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ProductImage } from '../common/ProductImage';
import { MarketplaceBadge } from '../common/MarketplaceBadge';
import { PriceSourceChip } from '../common/PriceSourceChip';
import { BulkPriceModal } from '../modals/BulkPriceModal';
import { formatDiff, formatQar } from '../../lib/pricing';

const DemoProductDetailView: React.FC = () => {
  const { products, selectedProductId, updateProduct, deleteProduct, navigate, showToast, getMarketplacePrice } =
    useApp();
  const [activeTab, setActiveTab] = useState<'status' | 'details' | 'category' | 'markups' | 'history'>('status');
  const [historyTab, setHistoryTab] = useState<'recent' | 'stock' | 'price'>('recent');
  const [priceModalOpen, setPriceModalOpen] = useState(false);

  const product = products.find((p) => p.id === selectedProductId) || products[0];
  const marketplacePrice = getMarketplacePrice(product);
  const priceDiff = marketplacePrice.price - product.erpPrice;

  const handleCopyBarcode = () => {
    navigator.clipboard?.writeText(product.barcode);
    showToast(`Copied barcode ${product.barcode} to clipboard!`, 'info');
  };

  const handleToggleActive = () => {
    const newStatus = product.status === 'Active' ? 'Inactive' : 'Active';
    updateProduct({ ...product, status: newStatus });
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-150">
      {/* Breadcrumb & Actions Bar */}
      <div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
          <button
            onClick={() => navigate('catalogue')}
            className="hover:text-gray-800 text-blue-600 hover:underline"
          >
            Catalogue
          </button>
          <span>/</span>
          <span className="text-gray-700">{product.nameEn}</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              {product.nameEn}
            </h1>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                product.status === 'Active'
                  ? 'bg-[#E3FAF3] text-[#027864]'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {product.status}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => showToast('More actions menu')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-xs"
            >
              <span>More actions</span>
              <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
            </button>

            <button
              onClick={() => navigate('new-product')}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Edit product</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
          <div className="flex items-center gap-1">
            <span>Barcode</span>
            <span className="font-mono text-gray-700">{product.barcode}</span>
            <button
              onClick={handleCopyBarcode}
              className="text-gray-400 hover:text-gray-600 p-0.5"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <span>|</span>
          <div>
            Category <span className="font-medium text-gray-700">{product.category}</span>
          </div>
          <span>|</span>
          <div>
            Brand <span className="font-medium text-gray-700">{product.brand}</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Left Details & Right Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* Left 3 Columns: Hero card, Marketplace Status Table, Audit Log */}
        <div className="lg:col-span-3 space-y-6">
          {/* Top Hero Info Card */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs flex flex-col sm:flex-row items-center gap-6">
            <div className="w-28 h-28 bg-gray-50 border border-gray-100 rounded-lg p-2 flex items-center justify-center shrink-0">
              <ProductImage imageKey={product.imageKey} size="lg" />
            </div>

            <div className="flex-1 w-full space-y-3">
              <div>
                <h2 className="text-base font-bold text-gray-900">{product.nameEn}</h2>
                <div className="text-xs text-gray-500 font-arabic mt-0.5">
                  {product.nameAr}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1 border-t border-gray-100">
                <div>
                  <div className="text-gray-400">Barcode</div>
                  <div className="font-mono text-gray-800 font-medium flex items-center gap-1">
                    {product.barcode}
                    <button onClick={handleCopyBarcode}>
                      <Copy className="w-3 h-3 text-gray-400 hover:text-gray-600" />
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-gray-400">Category</div>
                  <div className="text-gray-800 font-medium">{product.category}</div>
                </div>

                <div>
                  <div className="text-gray-400">Brand</div>
                  <div className="text-gray-800 font-medium">{product.brand}</div>
                </div>

                <div>
                  <div className="text-gray-400">Status</div>
                  <div className="inline-flex items-center px-1.5 py-0.2 rounded text-[11px] font-semibold bg-[#E3FAF3] text-[#027864]">
                    {product.status}
                  </div>
                </div>

                <div>
                  <div className="text-gray-400">ERP price (QAR)</div>
                  <div className="font-bold text-gray-900">
                    {product.erpPrice.toFixed(2)}
                  </div>
                </div>

                <div>
                  <div className="text-gray-400">Cost price (QAR)</div>
                  <div className="font-medium text-gray-700">
                    {product.costPrice.toFixed(2)}
                  </div>
                </div>

                <div>
                  <div className="text-gray-400">Marketplace price (QAR)</div>
                  <button
                    onClick={() => setPriceModalOpen(true)}
                    className="flex items-center gap-1.5 hover:underline"
                    title="Edit marketplace price"
                  >
                    <span className="font-bold text-gray-900">{formatQar(marketplacePrice.price)}</span>
                    <span
                      className={`text-[10px] ${
                        priceDiff < -0.004 ? 'text-emerald-600 font-semibold' : 'text-gray-400'
                      }`}
                    >
                      {formatDiff(priceDiff)}
                    </span>
                  </button>
                </div>

                <div>
                  <div className="text-gray-400">Price source</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <PriceSourceChip source={marketplacePrice.source} />
                    {product.offerUntil && marketplacePrice.source === 'offer' && (
                      <span className="text-[10px] text-gray-500">until {product.offerUntil}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-6 border-b border-gray-200 text-xs">
            <button
              onClick={() => setActiveTab('status')}
              className={`pb-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'status'
                  ? 'border-[#027864] text-[#027864]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Marketplace status and pricing
            </button>
            <button
              onClick={() => setActiveTab('details')}
              className={`pb-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'details'
                  ? 'border-[#027864] text-[#027864]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Product details
            </button>
            <button
              onClick={() => setActiveTab('category')}
              className={`pb-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'category'
                  ? 'border-[#027864] text-[#027864]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Category and attributes
            </button>
            <button
              onClick={() => {
                setActiveTab('markups');
                setPriceModalOpen(true);
              }}
              className={`pb-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'markups'
                  ? 'border-[#027864] text-[#027864]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Marketplace price
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`pb-3 font-semibold border-b-2 transition-colors ${
                activeTab === 'history'
                  ? 'border-[#027864] text-[#027864]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              History
            </button>
          </div>

          {/* Marketplace Status Table */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Marketplace</th>
                  <th className="py-2.5 px-3">Listing status</th>
                  <th className="py-2.5 px-3">Marketplace price (QAR)</th>
                  <th className="py-2.5 px-3">Stock quantity</th>
                  <th className="py-2.5 px-3">Last updated</th>
                  <th className="py-2.5 px-3">Notes</th>
                  <th className="py-2.5 px-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {/* Talabat */}
                <tr className="hover:bg-gray-50/70">
                  <td className="py-3 px-3">
                    <MarketplaceBadge marketplace="talabat" />
                  </td>
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#E3FAF3] text-[#027864]">
                      Listed
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                      <span>2.75</span>
                      <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1 py-0.2 rounded">
                        +0.25
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                      <span>80</span>
                      <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1 py-0.2 rounded">
                        -40
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-gray-500">05 Oct 2026 18:40</td>
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                      Price and stock mismatch
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <button className="text-gray-400 hover:text-gray-600 p-1">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </td>
                </tr>

                {/* Snoonu */}
                <tr className="hover:bg-gray-50/70">
                  <td className="py-3 px-3">
                    <MarketplaceBadge marketplace="snoonu" />
                  </td>
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#E3FAF3] text-[#027864]">
                      Listed
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                      <span>2.50</span>
                      <span className="text-gray-400">—</span>
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                      <span>120</span>
                      <span className="text-gray-400">—</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-gray-500">06 Oct 2026 08:55</td>
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#E3FAF3] text-[#027864]">
                      In sync
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <button className="text-gray-400 hover:text-gray-600 p-1">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </td>
                </tr>

                {/* Rafeeq */}
                <tr className="hover:bg-gray-50/70">
                  <td className="py-3 px-3">
                    <MarketplaceBadge marketplace="rafeeq" />
                  </td>
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#E3FAF3] text-[#027864]">
                      Listed
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                      <span>2.75</span>
                      <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1 py-0.2 rounded">
                        +0.25
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                      <span>60</span>
                      <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1 py-0.2 rounded">
                        -20
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-gray-500">06 Oct 2026 07:30</td>
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                      Price and stock mismatch
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <button className="text-gray-400 hover:text-gray-600 p-1">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </td>
                </tr>

                {/* Keeta */}
                <tr className="hover:bg-gray-50/70">
                  <td className="py-3 px-3">
                    <MarketplaceBadge marketplace="keeta" />
                  </td>
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600">
                      Not listed
                    </span>
                  </td>
                  <td className="py-3 px-3 text-gray-400">—</td>
                  <td className="py-3 px-3 text-gray-400">—</td>
                  <td className="py-3 px-3 text-gray-400">—</td>
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600">
                      No file uploaded yet
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <button className="text-gray-400 hover:text-gray-600 p-1">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Lower Changes History Section */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
            <div className="flex items-center gap-6 border-b border-gray-200 px-4 text-xs">
              <button
                onClick={() => setHistoryTab('recent')}
                className={`py-3 font-semibold border-b-2 transition-colors ${
                  historyTab === 'recent'
                    ? 'border-[#027864] text-[#027864]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Recent changes
              </button>
              <button
                onClick={() => setHistoryTab('stock')}
                className={`py-3 font-semibold border-b-2 transition-colors ${
                  historyTab === 'stock'
                    ? 'border-[#027864] text-[#027864]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Stock history
              </button>
              <button
                onClick={() => setHistoryTab('price')}
                className={`py-3 font-semibold border-b-2 transition-colors ${
                  historyTab === 'price'
                    ? 'border-[#027864] text-[#027864]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Price history
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Date and time</th>
                    <th className="py-2.5 px-3">Source</th>
                    <th className="py-2.5 px-3">Change type</th>
                    <th className="py-2.5 px-3">Field</th>
                    <th className="py-2.5 px-3">Old value</th>
                    <th className="py-2.5 px-3">New value</th>
                    <th className="py-2.5 px-3">Updated by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr className="hover:bg-gray-50">
                    <td className="py-2.5 px-3 text-gray-600">06 Oct 2026 09:12</td>
                    <td className="py-2.5 px-3 font-medium text-gray-900">ERP (RetailOne)</td>
                    <td className="py-2.5 px-3 text-blue-600 font-medium">Price change</td>
                    <td className="py-2.5 px-3 text-gray-600">ERP price</td>
                    <td className="py-2.5 px-3 text-gray-500">2.25</td>
                    <td className="py-2.5 px-3 font-semibold text-gray-900">2.50</td>
                    <td className="py-2.5 px-3 text-gray-600">Omar Haddad</td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="py-2.5 px-3 text-gray-600">05 Oct 2026 18:40</td>
                    <td className="py-2.5 px-3 font-medium text-gray-900">Talabat file</td>
                    <td className="py-2.5 px-3 text-purple-600 font-medium">Stock change</td>
                    <td className="py-2.5 px-3 text-gray-600">Stock quantity</td>
                    <td className="py-2.5 px-3 text-gray-500">120</td>
                    <td className="py-2.5 px-3 font-semibold text-gray-900">80</td>
                    <td className="py-2.5 px-3 text-gray-600">Omar Haddad</td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="py-2.5 px-3 text-gray-600">05 Oct 2026 18:40</td>
                    <td className="py-2.5 px-3 font-medium text-gray-900">Talabat file</td>
                    <td className="py-2.5 px-3 text-blue-600 font-medium">Price change</td>
                    <td className="py-2.5 px-3 text-gray-600">Marketplace price</td>
                    <td className="py-2.5 px-3 text-gray-500">2.50</td>
                    <td className="py-2.5 px-3 font-semibold text-gray-900">2.75</td>
                    <td className="py-2.5 px-3 text-gray-600">Omar Haddad</td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="py-2.5 px-3 text-gray-600">02 Oct 2026 11:20</td>
                    <td className="py-2.5 px-3 font-medium text-gray-900">Manual</td>
                    <td className="py-2.5 px-3 text-emerald-600 font-medium">Marketplace price change</td>
                    <td className="py-2.5 px-3 text-gray-600">Default rule</td>
                    <td className="py-2.5 px-3 text-gray-500">+15% on ERP</td>
                    <td className="py-2.5 px-3 font-semibold text-gray-900">+10% on ERP</td>
                    <td className="py-2.5 px-3 text-gray-600">Rahul Menon</td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="py-2.5 px-3 text-gray-600">28 Sep 2026 09:05</td>
                    <td className="py-2.5 px-3 font-medium text-gray-900">Snoonu file</td>
                    <td className="py-2.5 px-3 text-purple-600 font-medium">Stock change</td>
                    <td className="py-2.5 px-3 text-gray-600">Stock quantity</td>
                    <td className="py-2.5 px-3 text-gray-500">100</td>
                    <td className="py-2.5 px-3 font-semibold text-gray-900">120</td>
                    <td className="py-2.5 px-3 text-gray-600">Omar Haddad</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Sidebar: Product Images, Additional Details, Quick Actions */}
        <div className="space-y-4">
          {/* Product Images Card */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">
              Product images
            </h3>

            <div className="flex items-center gap-3">
              <div className="w-16 h-16 border border-gray-200 rounded-lg p-1 bg-white flex items-center justify-center">
                <ProductImage imageKey={product.imageKey} size="md" />
              </div>

              <button
                onClick={() => showToast('Image upload file dialog')}
                className="w-16 h-16 border-2 border-dashed border-gray-300 hover:border-gray-400 rounded-lg flex flex-col items-center justify-center text-gray-500 hover:text-gray-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span className="text-[10px] mt-0.5">Add image</span>
              </button>
            </div>
          </div>

          {/* Additional details */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs space-y-2.5 text-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">
              Additional details
            </h3>

            <div className="space-y-1.5 divide-y divide-gray-50">
              <div className="flex justify-between py-1">
                <span className="text-gray-500">Product ID</span>
                <span className="font-mono text-gray-900">{product.id}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500">SKU</span>
                <span className="font-mono text-gray-900">{product.sku}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500">Size</span>
                <span className="text-gray-900">{product.size} {product.unit}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500">Pack size</span>
                <span className="text-gray-900">{product.packSize}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500">Unit</span>
                <span className="text-gray-900">Can</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500">Created</span>
                <span className="text-gray-900">{product.createdAt}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500">Updated</span>
                <span className="text-gray-900 text-right leading-tight">
                  {product.updatedAt} <br />
                  <span className="text-gray-500 text-[10px]">by {product.updatedBy}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Quick Actions Card */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs space-y-2 text-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">
              Quick actions
            </h3>

            <div className="space-y-1">
              <button
                onClick={() => setPriceModalOpen(true)}
                className="w-full flex items-center gap-2.5 py-1.5 px-2 rounded-lg text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors text-left"
              >
                <Tag className="w-4 h-4 text-gray-500" />
                <span>Edit marketplace price</span>
              </button>

              <button
                onClick={() => showToast('Category assignment modal')}
                className="w-full flex items-center gap-2.5 py-1.5 px-2 rounded-lg text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors text-left"
              >
                <FolderTree className="w-4 h-4 text-gray-500" />
                <span>Update category</span>
              </button>

              <button
                onClick={() => showToast('Edit Arabic name modal')}
                className="w-full flex items-center gap-2.5 py-1.5 px-2 rounded-lg text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors text-left"
              >
                <Languages className="w-4 h-4 text-gray-500" />
                <span>Edit Arabic name</span>
              </button>

              <button
                onClick={() => navigate('reports-price-discrepancies')}
                className="w-full flex items-center gap-2.5 py-1.5 px-2 rounded-lg text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors text-left"
              >
                <BarChart2 className="w-4 h-4 text-gray-500" />
                <span>View in reports</span>
              </button>

              <button
                onClick={handleToggleActive}
                className="w-full flex items-center gap-2.5 py-1.5 px-2 rounded-lg text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors text-left"
              >
                <MinusCircle className="w-4 h-4 text-gray-500" />
                <span>Mark as {product.status === 'Active' ? 'inactive' : 'active'}</span>
              </button>

              <button
                onClick={() => {
                  if (confirm(`Are you sure you want to delete "${product.nameEn}"?`)) {
                    deleteProduct(product.id);
                  }
                }}
                className="w-full flex items-center gap-2.5 py-1.5 px-2 rounded-lg text-red-600 hover:bg-red-50 transition-colors text-left font-medium"
              >
                <Trash2 className="w-4 h-4 text-red-600" />
                <span>Delete product</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {priceModalOpen && (
        <BulkPriceModal
          open
          onClose={() => {
            setPriceModalOpen(false);
            if (activeTab === 'markups') setActiveTab('status');
          }}
          productIds={[product.id]}
        />
      )}
    </div>
  );
};

/** Real /api/products and /api/categories when VITE_REAL_CATALOGUE=true, the demo store otherwise. */
export const ProductDetailView: React.FC = () => (realCatalogueEnabled() ? <RealProductDetailView /> : <DemoProductDetailView />);
