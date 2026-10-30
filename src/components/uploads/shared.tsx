import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, Loader2, X, XCircle } from 'lucide-react';
import { ApiError } from '../../api/client';
import { DirectUploadError, UploadStepError } from '../../api/directUpload';
import { UPLOAD_POLL_MS, isSettled, uploadsApi } from '../../api/uploads';
import type { UploadRecord, UploadSource, UploadStatus } from '../../api/types';

export const SOURCE_LABELS: Record<UploadSource, string> = {
  erp: 'ERP',
  talabat: 'Talabat',
  snoonu: 'Snoonu',
  rafeeq: 'Rafeeq',
  keeta: 'Keeta',
};

export const STATUS_LABELS: Record<UploadStatus, string> = {
  uploading: 'Uploading',
  processing: 'Processing',
  needs_mapping: 'Needs mapping',
  needs_review: 'Needs review',
  rejected: 'Rejected',
  failed: 'Failed',
  discarded: 'Discarded',
};

/** Where an upload is looked at: mapping while columns are unknown, the detail/review page otherwise. */
export const uploadPath = (u: Pick<UploadRecord, 'id' | 'status'>) =>
  `${u.status === 'needs_mapping' ? '/uploads/mapping' : '/uploads/review'}?upload=${encodeURIComponent(u.id)}`;

export const uploadKey = (id: string) => ['uploads', 'detail', id] as const;
export const UPLOADS_LIST_KEY = ['uploads', 'list'] as const;

/** GET /api/uploads/:id every 2 s while the backend is working; stops once the status settles. */
export function useUploadStatus(id: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: uploadKey(id ?? ''),
    queryFn: ({ signal }) => uploadsApi.get(id!, signal),
    enabled: Boolean(id) && enabled,
    retry: false,
    refetchInterval: q => (q.state.status === 'error' || isSettled(q.state.data?.status) ? false : UPLOAD_POLL_MS),
  });
}

export function errorText(e: unknown): string {
  if (e instanceof UploadStepError || e instanceof DirectUploadError) return e.message;
  if (e instanceof ApiError) {
    if (e.status === 403) return 'You do not have permission to do this.';
    if (e.status === 404) return 'This upload was not found.';
    return e.message;
  }
  return e instanceof Error && e.message ? `Something went wrong: ${e.message}` : 'Something went wrong. Please try again.';
}

export const StatusBadge: React.FC<{ status: UploadStatus }> = ({ status }) => {
  const tone =
    status === 'needs_review' || status === 'needs_mapping' ? 'bg-amber-50 text-amber-700 border-amber-200'
      : status === 'rejected' || status === 'failed' ? 'bg-red-50 text-red-700 border-red-200'
        : status === 'discarded' ? 'bg-gray-100 text-gray-600 border-gray-200'
          : 'bg-blue-50 text-blue-700 border-blue-200';
  const Icon = status === 'uploading' || status === 'processing' ? Loader2
    : status === 'rejected' || status === 'failed' ? XCircle
      : status === 'discarded' ? null : status === 'needs_review' || status === 'needs_mapping' ? Clock : CheckCircle2;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${tone}`}>
      {Icon && <Icon className={`w-3 h-3 ${Icon === Loader2 ? 'animate-spin' : ''}`} />}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
};

/** Current step and progress reported by the backend while it reads the file. */
export const StatusProgress: React.FC<{ upload: Pick<UploadRecord, 'status' | 'step' | 'progress'> }> = ({ upload }) => {
  const pct = typeof upload.progress === 'number' ? Math.max(0, Math.min(100, Math.round(upload.progress))) : null;
  return (
    <div className="space-y-1.5" role="status" aria-live="polite">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-gray-800">{upload.step || STATUS_LABELS[upload.status]}</span>
        {pct !== null && <span className="font-mono text-gray-500">{pct}%</span>}
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full bg-[#027864] transition-all ${pct === null ? 'w-1/3 animate-pulse' : ''}`}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

/** The backend allows discard in these statuses only (processing answers 409). */
export const DISCARDABLE: ReadonlySet<UploadStatus> = new Set<UploadStatus>(['uploading', 'needs_mapping', 'needs_review', 'rejected', 'failed']);

/** Human copy for a file that did not make it to review, around the backend's errorMessage. */
export function failureCopy(u: Pick<UploadRecord, 'status' | 'errorMessage'>): { title: string; detail: string; next: string } | null {
  if (u.status === 'rejected') {
    return {
      title: 'Qorloop could not accept this file',
      detail: u.errorMessage || 'The file is not in a format Qorloop can read.',
      next: 'Fix the file and upload it again.',
    };
  }
  if (u.status === 'failed') {
    return {
      title: 'Something went wrong while reading this file',
      detail: u.errorMessage || 'Processing stopped before the file could be read.',
      next: 'Please upload it again. If it keeps failing, contact support with the file name and time of upload.',
    };
  }
  return null;
}

export const FailureNotice: React.FC<{ upload: Pick<UploadRecord, 'status' | 'errorMessage'> }> = ({ upload }) => {
  const copy = failureCopy(upload);
  if (!copy) return null;
  return (
    <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-900 space-y-1">
      <p className="font-semibold">{copy.title}</p>
      <p>{copy.detail}</p>
      <p className="text-xs text-red-800">{copy.next}</p>
    </div>
  );
};

/** Same look and behaviour as the confirmations on the Team screen. */
export const ConfirmDialog: React.FC<{
  title: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, confirmLabel, busy, onConfirm, onClose, children }) => (
  <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onMouseDown={e => e.target === e.currentTarget && onClose()} onKeyDown={e => e.key === 'Escape' && onClose()}>
    <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
      <div className="flex items-start justify-between">
        <h3 className="text-base font-bold text-gray-900">{title}</h3>
        <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>
      <div className="mt-3 text-sm text-gray-600">{children}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm font-semibold border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>
        <button autoFocus disabled={busy} onClick={onConfirm} className="h-9 px-4 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

/** Hands a downloaded Blob to the browser as a file: temporary object URL + <a download>, then the URL is revoked. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  try { a.click(); } finally {
    a.remove();
    // Revoke on the next tick so the browser has started the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Renders a parsed file value for display. */
export const cell = (v: unknown): string =>
  v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

export const formatBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
