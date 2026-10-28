import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react';
import { ApiError } from '../../api/client';

export const FormError: React.FC<{ error: unknown }> = ({ error }) => {
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  const message = e?.status === 429 ? 'Too many attempts. Please wait a minute and try again.' : e?.message ?? 'Something went wrong. Please try again.';
  return (
    <div role="alert" className="flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <div>
        {message}
        {e?.requestId && e.status >= 500 && <div className="text-[11px] text-red-500 mt-0.5">Request ID: {e.requestId}</div>}
      </div>
    </div>
  );
};

export const FormNotice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div role="status" className="flex items-start gap-2 rounded-[10px] border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">
    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
    <div>{children}</div>
  </div>
);

interface FieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label: string;
  icon?: React.ElementType;
  error?: string;
  hint?: string;
  onChange: (value: string) => void;
  action?: React.ReactNode;
}
export const Field: React.FC<FieldProps> = ({ label, icon: Icon, error, hint, onChange, action, type = 'text', id, ...rest }) => {
  const [shown, setShown] = useState(false);
  const isPassword = type === 'password';
  const inputId = id ?? 'f-' + label.toLowerCase().replace(/\W+/g, '-');
  return (
    <div>
      <div className="flex justify-between">
        <label htmlFor={inputId} className="text-[13px] font-semibold text-gray-700">{label}</label>
        {action}
      </div>
      <div className={`mt-1.5 flex items-center gap-2 h-11 px-3 rounded-[10px] border bg-white focus-within:ring-4 ${error ? 'border-red-400 focus-within:ring-red-100' : 'border-gray-300 focus-within:border-[#00B894] focus-within:ring-[#00D9A9]/15'}`}>
        {Icon && <Icon className="w-4 h-4 text-gray-400" />}
        <input
          id={inputId} type={isPassword && shown ? 'text' : type} aria-invalid={Boolean(error)} aria-describedby={error ? inputId + '-err' : undefined}
          onChange={e => onChange(e.target.value)} className="flex-1 min-w-0 bg-transparent outline-none text-sm text-gray-900" {...rest}
        />
        {isPassword && (
          <button type="button" onClick={() => setShown(s => !s)} aria-label={shown ? 'Hide password' : 'Show password'} className="text-gray-400 hover:text-gray-600">
            {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {error ? <p id={inputId + '-err'} className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-gray-500">{hint}</p> : null}
    </div>
  );
};

export const SubmitButton: React.FC<{ pending: boolean; children: React.ReactNode; disabled?: boolean }> = ({ pending, children, disabled }) => (
  <button
    type="submit" disabled={pending || disabled}
    className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-[10px] text-sm font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
  >
    {pending && <Loader2 className="w-4 h-4 animate-spin" />}
    {children}
  </button>
);

/** Matches the backend rule (12-128 characters). The server still validates. */
export const PASSWORD_MIN = 12;
export function passwordProblem(password: string): string | undefined {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (password.length > 128) return 'Use at most 128 characters';
  return undefined;
}

let captured: { path: string; token: string } | null = null;
/**
 * Reads `#token=…` from the URL and removes it so the secret doesn't linger in history or referrers.
 * The value is kept in memory only, so a re-render (or StrictMode double render) still finds it.
 */
export function takeHashToken(): string | null {
  const path = window.location.pathname;
  const m = /[#&]token=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  if (m) {
    captured = { path, token: m[1] };
    window.history.replaceState(null, '', path + window.location.search);
  }
  return captured?.path === path ? captured.token : null;
}
export const forgetToken = () => { captured = null; };
