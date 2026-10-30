import React from 'react';
import { Upload, ArrowRight, FileSpreadsheet, CheckCircle2, Clock } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useDemo, dateTime } from '../../demo';
import type { SourceId } from '../../demo';
import { useAuth } from '../../auth/AuthContext';
import { realUploadsEnabled } from '../../lib/features';
import { RealUploadsHistoryView } from '../uploads/RealUploadsHistoryView';

const SOURCE_LABELS: Record<SourceId, string> = {
  erp: 'ERP (RetailOne)',
  talabat: 'Talabat',
  snoonu: 'Snoonu',
  rafeeq: 'Rafeeq',
  keeta: 'Keeta',
};

const DemoUploadsHistoryView: React.FC = () => {
  const { navigate, openUploadModal } = useApp();
  const { state, pendingReview } = useDemo();
  const { can } = useAuth();

  const getSourceLabel = (src: SourceId) => {
    return SOURCE_LABELS[src] || src;
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Uploads</h1>
          <p className="text-sm text-gray-500 mt-1">
            History of ERP and marketplace file imports
          </p>
        </div>
        {can('uploads.upload') && (
          <button
            onClick={() => openUploadModal()}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#027864] hover:bg-[#02604F] text-white text-sm font-semibold rounded-xl shadow-sm transition-colors"
          >
            <Upload className="w-4 h-4" />
            <span>Upload file</span>
          </button>
        )}
      </div>

      {/* Pending review callout */}
      {pendingReview && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-700">Pending Review</span>
                <span className="text-sm font-semibold text-gray-900">{pendingReview.upload.fileName}</span>
              </div>
              <p className="text-xs text-gray-600 mt-0.5">
                {getSourceLabel(pendingReview.upload.source)} &middot; {pendingReview.summary.rowsRead} rows read &middot; {pendingReview.summary.priceChanges} price changes, {pendingReview.summary.stockChanges} stock changes
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('upload-review')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors shrink-0"
          >
            <span>Continue review</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Uploads Table */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Upload History</h2>
          <span className="text-xs text-gray-500 font-medium">{state.uploads.length} uploads recorded</span>
        </div>

        {state.uploads.length === 0 ? (
          <div className="p-12 text-center">
            <FileSpreadsheet className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-600 font-medium">No uploads recorded yet</p>
            <p className="text-xs text-gray-400 mt-1">Upload an ERP or marketplace spreadsheet to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider border-b border-gray-100">
                <tr>
                  <th className="px-6 py-3.5">Date & Time</th>
                  <th className="px-6 py-3.5">Source</th>
                  <th className="px-6 py-3.5">File</th>
                  <th className="px-6 py-3.5">Contains</th>
                  <th className="px-6 py-3.5">Uploaded By</th>
                  <th className="px-6 py-3.5 text-right">Rows</th>
                  <th className="px-6 py-3.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-600 font-medium">
                {state.uploads.map((up) => (
                  <tr key={up.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-gray-900 font-mono text-[11px]">
                      {dateTime(up.uploadedAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-gray-100 text-gray-800">
                        {getSourceLabel(up.source)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="font-semibold text-gray-900">{up.fileName}</span>
                        {up.fileSizeKb > 0 && (
                          <span className="text-[11px] text-gray-400">({up.fileSizeKb} KB)</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="capitalize">{up.contains === 'full' ? 'Full catalogue' : 'Partial update'}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                      {up.uploadedBy}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right font-mono font-semibold text-gray-900">
                      {up.summary.rowsRead.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      {up.status === 'applied' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" />
                          Applied
                        </span>
                      ) : up.status === 'needs_review' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          <Clock className="w-3 h-3" />
                          Needs review
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                          Discarded
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export const UploadsHistoryView: React.FC = () => (realUploadsEnabled() ? <RealUploadsHistoryView /> : <DemoUploadsHistoryView />);
