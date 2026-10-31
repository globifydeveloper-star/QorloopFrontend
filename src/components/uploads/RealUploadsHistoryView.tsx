import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import { UPLOAD_POLL_MS, isSettled, uploadsApi } from '../../api/uploads';
import { SOURCE_LABELS, StatusBadge, StatusProgress, UPLOADS_LIST_KEY, errorText, failureCopy, formatBytes, uploadPath } from './shared';

/** Upload history from GET /api/uploads. Refreshes every 2 s while any upload is still being processed. */
export const RealUploadsHistoryView: React.FC = () => {
  const { openUploadModal } = useApp();
  const { can } = useAuth();
  const q = useQuery({
    queryKey: UPLOADS_LIST_KEY,
    queryFn: () => uploadsApi.list(),
    retry: false,
    refetchInterval: query => (query.state.data?.some(u => !isSettled(u.status)) ? UPLOAD_POLL_MS : false),
  });
  const uploads = q.data ?? [];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Uploads</h1>
          <p className="text-sm text-gray-500 mt-1">History of ERP and marketplace file imports</p>
        </div>
        {can('uploads.upload') && (
          <button
            onClick={() => openUploadModal()}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#027864] hover:bg-[#02604F] text-white text-sm font-semibold rounded-xl shadow-sm"
          >
            <Upload className="w-4 h-4" />
            <span>Upload file</span>
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Upload History</h2>
          {q.data && <span className="text-xs text-gray-500 font-medium">{uploads.length} uploads recorded</span>}
        </div>

        {q.isPending ? (
          <p className="p-6 text-sm text-gray-500">Loading…</p>
        ) : q.isError ? (
          <p role="alert" className="p-6 text-sm text-red-600">{errorText(q.error)}</p>
        ) : uploads.length === 0 ? (
          <div className="p-12 text-center">
            <FileSpreadsheet className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-600 font-medium">No uploads recorded yet</p>
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
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5 text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-600 font-medium">
                {uploads.map(up => (
                  <tr key={up.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-gray-900 font-mono text-[11px]">{new Date(up.createdAt).toLocaleString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex px-2.5 py-1 rounded-md text-xs font-semibold bg-gray-100 text-gray-800">{SOURCE_LABELS[up.source] ?? up.source}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="font-semibold text-gray-900">{up.fileName}</span>
                      <span className="text-[11px] text-gray-400 ml-1.5">({formatBytes(up.size)})</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">{up.contains === 'full' ? 'Full catalogue' : 'Partial update'}</td>
                    <td className="px-6 py-4 min-w-[180px]">
                      {up.status === 'processing' || up.status === 'applying' ? <StatusProgress upload={up} /> : <StatusBadge status={up.status} />}
                      {failureCopy(up) && (
                        <p className="mt-1 text-[11px] text-red-700 max-w-[260px] whitespace-normal">{up.errorMessage || failureCopy(up)!.title}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      {up.status === 'needs_mapping' && !can('uploads.map') ? null : (
                        <Link to={uploadPath(up)} className="text-[#027864] hover:underline font-semibold">
                          {up.status === 'needs_mapping' ? 'Map columns' : up.status === 'needs_review' ? 'Review' : 'Details'}
                        </Link>
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
