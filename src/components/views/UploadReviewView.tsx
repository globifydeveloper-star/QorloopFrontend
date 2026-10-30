import React, { useState, useMemo } from 'react';
import {
  CheckCircle2,
  Search,
  Info,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useDemo, money } from '../../demo';
import { realUploadsEnabled } from '../../lib/features';
import { RealUploadReviewView } from '../uploads/RealUploadReviewView';

const DemoUploadReviewView: React.FC = () => {
  const { navigate, showToast } = useApp();
  const { pendingReview, confirmReview, discardReview, state } = useDemo();
  const [activeTab, setActiveTab] = useState<'price' | 'stock' | 'availability' | 'new' | 'missing' | 'unmatched' | 'errors'>('price');
  const [searchTerm, setSearchTerm] = useState('');

  if (!pendingReview) {
    return (
      <div className="p-8 max-w-7xl mx-auto animate-in fade-in duration-150">
        <p className="text-sm text-gray-500">No upload to review. Go to the <button onClick={() => navigate('dashboard')} className="text-[#027864] hover:underline font-medium">dashboard</button> and upload a file.</p>
      </div>
    );
  }

  const { upload, summary: reviewSummary } = pendingReview;
  const isErp = upload.source === 'erp';
  const sourceName = upload.source === 'erp' ? `ERP (${state.tenant.erpName})` : state.marketplaces.find((m) => m.id === upload.source)?.name || upload.source;

  // Template detection info
  const template = upload.templateId ? state.inputTemplates.find((t) => t.id === upload.templateId) : null;

  const handleConfirm = () => {
    const msg = [];
    if (reviewSummary.priceChanges) msg.push(`${reviewSummary.priceChanges} price change${reviewSummary.priceChanges > 1 ? 's' : ''}`);
    if (reviewSummary.stockChanges) msg.push(`${reviewSummary.stockChanges} stock change${reviewSummary.stockChanges > 1 ? 's' : ''}`);
    confirmReview();
    showToast(`Applied: ${msg.join(', ') || 'no changes'}`);
    navigate('dashboard');
  };

  const handleCancel = () => {
    discardReview();
    navigate('dashboard');
  };

  // Filtered data based on search
  const filterBySearch = <T extends { nameEn?: string; barcode?: string }>(items: T[]): T[] => {
    if (!searchTerm) return items;
    const q = searchTerm.toLowerCase();
    return items.filter((item) =>
      (item.nameEn?.toLowerCase().includes(q)) || (item.barcode?.includes(q))
    );
  };

  // Determine available tabs
  const tabs: { key: typeof activeTab; label: string; count: number }[] = [];
  tabs.push({ key: 'price', label: 'Price changes', count: reviewSummary.priceChanges });
  if (isErp) {
    tabs.push({ key: 'stock', label: 'Stock changes', count: reviewSummary.stockChanges });
  } else {
    tabs.push({ key: 'availability', label: 'Availability changes', count: pendingReview.availabilityChanges.length });
  }
  if (isErp) tabs.push({ key: 'new', label: 'New products', count: reviewSummary.newProducts });
  tabs.push({ key: 'missing', label: 'Missing', count: reviewSummary.missingFromFile });
  if (!isErp && pendingReview.unmatched.length > 0) {
    tabs.push({ key: 'unmatched', label: 'Unmatched rows', count: pendingReview.unmatched.length });
  }
  if (pendingReview.errors.length > 0) {
    tabs.push({ key: 'errors', label: 'Errors', count: pendingReview.errors.length });
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-150">
      {/* Breadcrumbs & Header */}
      <div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
          <button onClick={() => navigate('uploads')} className="hover:text-gray-800 text-blue-600 hover:underline">
            Uploads
          </button>
          <span>/</span>
          <span className="text-gray-700">{upload.fileName}</span>
        </div>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              {upload.fileName}
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
              Needs review
            </span>
          </div>
        </div>

        <p className="text-xs text-gray-500 mt-1">
          {sourceName} &nbsp;•&nbsp; {upload.contains === 'full' ? 'Full list' : 'Partial update'} &nbsp;•&nbsp; Uploaded by {state.currentUser.name}
        </p>
      </div>

      {/* Stepper Progress Bar */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs">
        <div className="grid grid-cols-6 gap-2">
          {[
            { label: 'Scan', detail: 'File is safe' },
            { label: 'Check', detail: 'No issues found' },
            { label: 'Detect', detail: template ? `Layout: ${template.name}` : 'Layout recognised' },
            { label: 'Read', detail: `${reviewSummary.rowsRead.toLocaleString()} rows read` },
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-[#027864] text-white flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-gray-900">{step.label}</div>
                <div className="text-[10px] text-gray-500">{step.detail}</div>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[#027864] text-white flex items-center justify-center text-xs font-bold shrink-0">
              5
            </div>
            <div>
              <div className="text-xs font-bold text-[#027864]">Review</div>
              <div className="text-[10px] text-gray-500">Confirm changes</div>
            </div>
          </div>
          <div className="flex items-center gap-2 opacity-60">
            <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-xs font-semibold shrink-0">
              6
            </div>
            <div>
              <div className="text-xs font-medium text-gray-700">Apply</div>
              <div className="text-[10px] text-gray-500">Update catalogue</div>
            </div>
          </div>
        </div>
      </div>

      {/* Info Notice Banner (ERP only) */}
      {isErp && (
        <div className="flex items-center gap-2.5 p-3 rounded-lg bg-blue-50/70 text-blue-900 border border-blue-100 text-xs">
          <Info className="w-4 h-4 shrink-0 text-blue-600" />
          <span>
            <strong>Category, Arabic name, image and markups in this file are ignored.</strong>{' '}
            Qorloop keeps the values you manage here.
          </span>
        </div>
      )}

      {/* Summary Cards */}
      <div className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-900">
          Summary
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <SummaryCard label="Rows read" value={reviewSummary.rowsRead} />
          <SummaryCard label="Matched to catalogue" value={reviewSummary.matched} color="text-[#027864]" />
          <SummaryCard label="New products" value={reviewSummary.newProducts} color="text-blue-600" />
          <SummaryCard label="Rows with errors" value={reviewSummary.rowsWithErrors} color={reviewSummary.rowsWithErrors > 0 ? 'text-red-600' : undefined} />
          <SummaryCard label="Price changes" value={reviewSummary.priceChanges} color="text-blue-600" />
          <SummaryCard label={isErp ? 'Stock changes' : 'Availability changes'} value={reviewSummary.stockChanges} color="text-blue-600" />
          <SummaryCard label="Missing from file" value={reviewSummary.missingFromFile} color={reviewSummary.missingFromFile > 0 ? 'text-amber-600' : undefined} />
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left: Table & Tabs */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
          {/* Tabs */}
          <div className="flex items-center border-b border-gray-200 px-4 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`py-3 px-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'border-[#027864] text-[#027864]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          {/* Search bar */}
          <div className="p-3.5 border-b border-gray-100">
            <div className="relative max-w-sm">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by product name or barcode..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#027864]"
              />
            </div>
          </div>

          {/* Table content */}
          <div className="overflow-x-auto">
            {activeTab === 'price' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Barcode</th>
                    <th className="py-2.5 px-3">Product</th>
                    <th className="py-2.5 px-3 text-right">Old price (QAR)</th>
                    <th className="py-2.5 px-3 text-right">New price (QAR)</th>
                    <th className="py-2.5 px-3 text-right">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filterBySearch(pendingReview.priceChanges).map((item) => (
                    <tr key={item.productId} className="hover:bg-gray-50/70">
                      <td className="py-3 px-3 font-mono text-gray-600">{item.barcode}</td>
                      <td className="py-3 px-3">
                        <div className="font-medium text-gray-900">{item.nameEn}</div>
                        {item.nameAr && <div className="text-[11px] text-gray-500">{item.nameAr}</div>}
                      </td>
                      <td className="py-3 px-3 text-right text-gray-600">{money(item.oldValue)}</td>
                      <td className="py-3 px-3 text-right font-semibold text-gray-900">{money(item.newValue)}</td>
                      <td className="py-3 px-3 text-right font-semibold text-gray-700">
                        {(item.newValue - item.oldValue) > 0 ? '+' : ''}{money(item.newValue - item.oldValue)}
                      </td>
                    </tr>
                  ))}
                  {filterBySearch(pendingReview.priceChanges).length === 0 && (
                    <tr><td colSpan={5} className="py-8 text-center text-gray-400">No price changes</td></tr>
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'stock' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Barcode</th>
                    <th className="py-2.5 px-3">Product</th>
                    <th className="py-2.5 px-3 text-right">Old stock</th>
                    <th className="py-2.5 px-3 text-right">New stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filterBySearch(pendingReview.stockChanges).map((item) => (
                    <tr key={item.productId} className="hover:bg-gray-50/70">
                      <td className="py-3 px-3 font-mono text-gray-600">{item.barcode}</td>
                      <td className="py-3 px-3">
                        <div className="font-medium text-gray-900">{item.nameEn}</div>
                        {item.nameAr && <div className="text-[11px] text-gray-500">{item.nameAr}</div>}
                      </td>
                      <td className="py-3 px-3 text-right text-gray-600">{item.oldValue}</td>
                      <td className="py-3 px-3 text-right font-semibold text-gray-900">{item.newValue}</td>
                    </tr>
                  ))}
                  {filterBySearch(pendingReview.stockChanges).length === 0 && (
                    <tr><td colSpan={4} className="py-8 text-center text-gray-400">No stock changes</td></tr>
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'availability' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Barcode</th>
                    <th className="py-2.5 px-3">Product</th>
                    <th className="py-2.5 px-3">Old availability</th>
                    <th className="py-2.5 px-3">New availability</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pendingReview.availabilityChanges.map((item) => (
                    <tr key={item.productId} className="hover:bg-gray-50/70">
                      <td className="py-3 px-3 font-mono text-gray-600">{item.barcode}</td>
                      <td className="py-3 px-3">
                        <div className="font-medium text-gray-900">{item.nameEn}</div>
                      </td>
                      <td className="py-3 px-3">{item.oldValue === null ? '—' : item.oldValue ? 'Available' : 'Unavailable'}</td>
                      <td className="py-3 px-3 font-semibold">{item.newValue ? 'Available' : 'Unavailable'}</td>
                    </tr>
                  ))}
                  {pendingReview.availabilityChanges.length === 0 && (
                    <tr><td colSpan={4} className="py-8 text-center text-gray-400">No availability changes</td></tr>
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'new' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Barcode</th>
                    <th className="py-2.5 px-3">Product</th>
                    <th className="py-2.5 px-3 text-right">Price (QAR)</th>
                    <th className="py-2.5 px-3 text-right">Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pendingReview.newProducts.map((item, i) => (
                    <tr key={i} className="hover:bg-gray-50/70">
                      <td className="py-3 px-3 font-mono text-gray-600">{item.barcode}</td>
                      <td className="py-3 px-3 font-medium text-gray-900">{item.nameEn}</td>
                      <td className="py-3 px-3 text-right text-gray-700">{money(item.price)}</td>
                      <td className="py-3 px-3 text-right text-gray-700">{item.stock}</td>
                    </tr>
                  ))}
                  {pendingReview.newProducts.length === 0 && (
                    <tr><td colSpan={4} className="py-8 text-center text-gray-400">No new products</td></tr>
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'missing' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Barcode</th>
                    <th className="py-2.5 px-3">Product</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pendingReview.missing.map((item) => (
                    <tr key={item.productId} className="hover:bg-gray-50/70">
                      <td className="py-3 px-3 font-mono text-gray-600">{item.barcode}</td>
                      <td className="py-3 px-3 font-medium text-gray-900">{item.nameEn}</td>
                    </tr>
                  ))}
                  {pendingReview.missing.length === 0 && (
                    <tr><td colSpan={2} className="py-8 text-center text-gray-400">No missing products</td></tr>
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'unmatched' && (
              <>
                <div className="px-4 py-2 bg-amber-50/50 text-xs text-amber-800 border-b border-amber-100">
                  These rows are on {sourceName} but not in your catalogue.
                </div>
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                    <tr>
                      <th className="py-2.5 px-3">ID</th>
                      <th className="py-2.5 px-3">Name</th>
                      <th className="py-2.5 px-3 text-right">Price</th>
                      <th className="py-2.5 px-3">Available</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pendingReview.unmatched.map((item, i) => (
                      <tr key={i} className="hover:bg-gray-50/70">
                        <td className="py-3 px-3 font-mono text-gray-600">{item.marketplaceProductId}</td>
                        <td className="py-3 px-3 font-medium text-gray-900">{item.name}</td>
                        <td className="py-3 px-3 text-right text-gray-700">{money(item.price)}</td>
                        <td className="py-3 px-3">{item.available ? 'Yes' : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {activeTab === 'errors' && (
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Row</th>
                    <th className="py-2.5 px-3">Column</th>
                    <th className="py-2.5 px-3">Value</th>
                    <th className="py-2.5 px-3">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pendingReview.errors.map((err, i) => (
                    <tr key={i} className="hover:bg-gray-50/70">
                      <td className="py-3 px-3 text-gray-600">{err.row}</td>
                      <td className="py-3 px-3 font-medium text-gray-900">{err.column}</td>
                      <td className="py-3 px-3 font-mono text-gray-600">{err.value}</td>
                      <td className="py-3 px-3 text-red-600">{err.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-gray-100 text-xs text-gray-500">
            {activeTab === 'price' && `${pendingReview.priceChanges.length} price changes`}
            {activeTab === 'stock' && `${pendingReview.stockChanges.length} stock changes`}
            {activeTab === 'availability' && `${pendingReview.availabilityChanges.length} availability changes`}
            {activeTab === 'new' && `${pendingReview.newProducts.length} new products`}
            {activeTab === 'missing' && `${pendingReview.missing.length} missing products`}
            {activeTab === 'unmatched' && `${pendingReview.unmatched.length} unmatched rows`}
            {activeTab === 'errors' && `${pendingReview.errors.length} errors`}
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="space-y-4">
          {/* File Details Card */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">
              File details
            </h3>
            <div className="space-y-1.5 text-xs">
              <DetailRow label="Source" value={sourceName} />
              <DetailRow label="File" value={upload.fileName} />
              <DetailRow label="Size" value={`${upload.fileSizeKb} KB`} />
              <DetailRow label="Contains" value={upload.contains === 'full' ? 'All products (full list)' : 'Partial update'} />
              <DetailRow label="Uploaded by" value={state.currentUser.name} />
            </div>
          </div>

          {/* Detected Layout Card */}
          {template && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">
                Detected layout
              </h3>
              <div className="space-y-1 text-xs">
                <DetailRow label="Format" value={`${template.name} (v${template.version})`} />
                <DetailRow label="Columns" value={`${Object.keys(template.fields).length} (recognised)`} />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2 pt-2">
            <button
              onClick={handleConfirm}
              className="w-full py-2.5 text-xs font-bold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg transition-colors shadow-xs"
            >
              Confirm and apply
            </button>
            <button
              onClick={handleCancel}
              className="w-full py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const SummaryCard: React.FC<{ label: string; value: number; color?: string }> = ({ label, value, color }) => (
  <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-xs">
    <div className="text-[11px] text-gray-500">{label}</div>
    <div className={`text-xl font-bold mt-1 ${color || 'text-gray-900'}`}>
      {value.toLocaleString()}
    </div>
  </div>
);

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between py-1 border-b border-gray-50">
    <span className="text-gray-500">{label}</span>
    <span className="font-medium text-gray-900 text-right max-w-[60%] truncate">{value}</span>
  </div>
);

/** In real mode this never calls the demo applyReview: the backend has no apply endpoint yet. */
export const UploadReviewView: React.FC = () => (realUploadsEnabled() ? <RealUploadReviewView /> : <DemoUploadReviewView />);
