import React from 'react';
import { AlertCircle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { ApiError } from '../../api/client';

/** Reusable loading / empty / error states (blueprint §6): skeletons, not full-page spinners, for tables. */
export const LoadingState: React.FC<{ label?: string; rows?: number }> = ({ label = 'Loading…', rows = 0 }) =>
  rows > 0 ? (
    <div role="status" aria-label={label} className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 rounded-lg bg-gray-100 animate-pulse" />
      ))}
    </div>
  ) : (
    <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
      <Loader2 className="w-4 h-4 animate-spin" /> {label}
    </div>
  );

export const EmptyState: React.FC<{ title: string; hint?: string; action?: React.ReactNode }> = ({ title, hint, action }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
    <Inbox className="w-6 h-6 text-gray-300" />
    <div className="text-sm font-semibold text-gray-800">{title}</div>
    {hint && <div className="text-xs text-gray-500 max-w-sm">{hint}</div>}
    {action}
  </div>
);

export const ErrorState: React.FC<{ error: unknown; onRetry?: () => void; title?: string }> = ({ error, onRetry, title = 'Something went wrong' }) => {
  const api = error instanceof ApiError ? error : null;
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <AlertCircle className="w-6 h-6 text-red-500" />
      <div className="text-sm font-semibold text-gray-900">{title}</div>
      <div className="text-xs text-gray-500 max-w-sm">{api?.message ?? 'Please try again.'}</div>
      {api?.requestId && <div className="text-[11px] text-gray-400">Request ID: {api.requestId}</div>}
      {onRetry && (
        <button onClick={onRetry} className="mt-1 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50">
          <RefreshCw className="w-3.5 h-3.5" /> Try again
        </button>
      )}
    </div>
  );
};
