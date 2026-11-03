import React, { useState } from 'react';
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

export const RequestId: React.FC<{ id: string }> = ({ id }) => {
  const [message, setMessage] = useState('');
  return <div className="text-xs text-gray-500"><span className="select-all">Request ID: {id}</span> <button type="button" className="underline font-semibold ml-2" onClick={async () => {
    try { if (!navigator.clipboard) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(id); setMessage('Copied'); }
    catch { setMessage('Select the Request ID above and copy it.'); }
  }}>Copy</button>{message && <span role="status" className="ml-2">{message}</span>}</div>;
};

export function friendlyError(error: unknown): { title: string; message: string } {
  if (!(error instanceof ApiError)) return { title: 'Something went wrong', message: 'Please try again.' };
  if (error.status === 0) return { title: 'We could not reach Qorloop', message: "Qorloop can't reach the server. Check your connection and try again" };
  if (error.code === 'CSRF_REQUIRED') return { title: 'Please try saving again', message: 'We are refreshing your sign-in status. Review your changes and try again. If this continues, sign in again.' };
  if (error.status === 403) return { title: 'You do not have permission', message: 'Ask your store Owner or an Admin if you need access.' };
  if (error.status === 404) return { title: 'We could not find this page', message: 'It may have moved or may no longer be available.' };
  if (error.status >= 500) return { title: 'Qorloop could not complete this request', message: error.requestId ? 'Please try again. If this continues, share the Request ID with support.' : 'Please try again. If this continues, contact support.' };
  return { title: 'Something went wrong', message: error.message };
}

export const ErrorState: React.FC<{ error: unknown; onRetry?: () => void; title?: string }> = ({ error, onRetry, title }) => {
  const api = error instanceof ApiError ? error : null;
  const friendly = friendlyError(error);
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <AlertCircle className="w-6 h-6 text-red-500" />
      <div className="text-sm font-semibold text-gray-900">{title ?? friendly.title}</div>
      <div className="text-xs text-gray-500 max-w-sm">{friendly.message}</div>
      {api?.requestId && <RequestId id={api.requestId} />}
      <button type="button" onClick={onRetry ?? (() => window.location.reload())} className="mt-1 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50">
        <RefreshCw className="w-3.5 h-3.5" /> Try again
      </button>
    </div>
  );
};
