import React, { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { ApiError } from '../../api/client';
import { Field } from './controls';

/** Shared by the sign-in code screen and the "Confirm it's you" dialog. */
export const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

/** The code was wrong too often, or the sign-in timed out: the only way on is the password again. */
export const endsSignIn = (e: unknown) => e instanceof ApiError && (e.code === 'OTP_LOCKED' || e.code === 'CHALLENGE_EXPIRED');

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The words for the code errors the server answers with (error.meta carries the numbers). */
export function codeErrorMessage(e: unknown, context: 'sign-in' | 'step-up' = 'sign-in'): string | null {
  if (!(e instanceof ApiError)) return null;
  switch (e.code) {
    case 'OTP_INVALID': {
      const left = num(e.meta.attemptsLeft);
      return left === undefined ? 'Wrong code. Check it and try again.' : `Wrong code, ${left} ${left === 1 ? 'try' : 'tries'} left.`;
    }
    case 'OTP_LOCKED': return context === 'sign-in' ? 'Too many wrong codes. Enter your password to sign in again.' : 'Too many wrong codes. Ask for a new code.';
    case 'CHALLENGE_EXPIRED': return context === 'sign-in' ? 'This sign-in expired. Enter your password to sign in again.' : 'This code expired. Ask for a new code.';
    case 'OTP_SEND_LIMIT': {
      const wait = num(e.meta.retryAfterSeconds);
      return wait === undefined ? 'Too many codes sent. Try again later.' : `Too many codes sent, try again in ${wait} s.`;
    }
    default: return null;
  }
}

/** A later "may resend at" time after a 429 OTP_SEND_LIMIT (retryAfterSeconds from now), else the current one. */
export function resendAfterLimit(e: unknown, current: string | null): string | null {
  const wait = e instanceof ApiError && e.code === 'OTP_SEND_LIMIT' ? num(e.meta.retryAfterSeconds) : undefined;
  return wait === undefined ? current : new Date(Date.now() + wait * 1000).toISOString();
}

/** Whole seconds until `until` (0 once it has passed; null stays null). Re-renders every second while counting. */
export function useSecondsUntil(until: string | null): number | null {
  const left = () => (until ? Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000)) : null);
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    if (!until) return;
    const timer = setInterval(() => {
      const s = left();
      setSeconds(s);
      if (!s) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until]);
  return seconds;
}

/** "Send a new code" for emailed codes. resendAvailableAt null: no more codes for this sign-in or confirmation. */
export const ResendButton: React.FC<{ resendAvailableAt: string | null; pending: boolean; onResend: () => void; what?: string }> = ({ resendAvailableAt, pending, onResend, what = 'this sign-in' }) => {
  const wait = useSecondsUntil(resendAvailableAt);
  if (resendAvailableAt === null) return <p className="text-center text-xs text-gray-500">No more codes can be sent for {what}.</p>;
  return (
    <button type="button" onClick={onResend} disabled={pending || Boolean(wait)} className="block mx-auto text-[13px] font-semibold text-[#027864] hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed">
      {pending ? 'Sending…' : wait ? `Send a new code in ${wait} s` : 'Send a new code'}
    </button>
  );
};

/** The six-digit code field, or (authenticator users) the recovery-code field. */
export const CodeField: React.FC<{ mode: 'code' | 'recovery'; value: string; onChange: (v: string) => void; error?: string; id?: string }> = ({ mode, value, onChange, error, id }) => (
  <Field
    key={mode} id={id} label={mode === 'code' ? '6-digit code' : 'Recovery code'} icon={mode === 'code' ? ShieldCheck : KeyRound}
    inputMode={mode === 'code' ? 'numeric' : 'text'} autoComplete={mode === 'code' ? 'one-time-code' : 'off'} spellCheck={false}
    maxLength={mode === 'code' ? 6 : undefined} value={value} onChange={v => onChange(mode === 'code' ? digits(v) : v)} error={error} required autoFocus
  />
);

/** Recovery codes are 43 URL-safe characters (backend `token`). */
export const codeReady = (mode: 'code' | 'recovery', value: string) => (mode === 'code' ? value.length === 6 : /^[A-Za-z0-9_-]{43}$/.test(value.trim()));
