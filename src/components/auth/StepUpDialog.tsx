import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, ShieldCheck, X } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { setStepUpHandler } from '../../api/client';
import { authApi } from '../../api/auth';
import type { StepUpStart } from '../../api/types';
import { FormError, SubmitButton } from './controls';
import { CodeField, ResendButton, codeErrorMessage, codeReady, endsSignIn, resendAfterLimit } from './codes';

const WINDOW_NOTE: Record<string, string> = {
  security: 'After you confirm, security actions will not ask again for 10 minutes.',
  work: 'After you confirm, this kind of action will not ask again for 30 minutes.',
  single: 'This action asks every time.',
};

/**
 * "Confirm it's you" (ADR 021). Mounted once. The API client opens it when a request answers 403 STEP_UP_REQUIRED,
 * and sends the original request again once the fresh code is verified. Cancelling leaves the request refused.
 */
export const StepUpDialog: React.FC = () => {
  const [open, setOpen] = useState<{ window?: string; resolve: (ok: boolean) => void } | null>(null);
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => setStepUpHandler(window => new Promise<boolean>(resolve => {
    returnFocus.current = document.activeElement;
    setOpen({ window, resolve });
  })), []);

  const close = useCallback((ok: boolean) => {
    setOpen(current => { current?.resolve(ok); return null; });
    const el = returnFocus.current;
    if (el instanceof HTMLElement) setTimeout(() => el.focus(), 0);
  }, []);

  if (!open) return null;
  return <StepUpBody window={open.window} onDone={() => close(true)} onCancel={() => close(false)} />;
};

const StepUpBody: React.FC<{ window?: string; onDone: () => void; onCancel: () => void }> = ({ window, onDone, onCancel }) => {
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [code, setCode] = useState('');
  const [started, setStarted] = useState<StepUpStart | null>(null);
  /** The current code can no longer be used (too many wrong tries, or expired): a new one has to be asked for. */
  const [spent, setSpent] = useState(false);

  const start = useMutation({
    mutationFn: authApi.startStepUp,
    onMutate: () => { setCode(''); verify.reset(); },
    onSuccess: s => { setStarted(s); setSpent(false); },
    onError: e => setStarted(s => (s ? { ...s, resendAvailableAt: resendAfterLimit(e, s.resendAvailableAt) } : s)),
  });
  const verify = useMutation({
    mutationFn: () => authApi.verifyStepUp(mode === 'code' ? { code } : { recoveryCode: code.trim() }),
    onSuccess: onDone,
    onError: e => { setCode(''); if (endsSignIn(e)) setSpent(true); },
  });
  // Once per opening (a second start would email a second code and hit the 60-second resend limit).
  const asked = useRef(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!asked.current) { asked.current = true; start.mutate(); } }, []);

  const app = started?.method === 'totp';
  const error = verify.error ?? start.error;
  const busy = verify.isPending;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onKeyDown={e => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onCancel(); } }}>
      <div role="dialog" aria-modal="true" aria-labelledby="step-up-title" aria-describedby="step-up-text" className="w-full max-w-md my-16 rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-gray-100">
          <div className="flex items-start gap-2">
            <ShieldCheck className="w-5 h-5 mt-0.5 text-[#027864]" />
            <div>
              <h2 id="step-up-title" className="text-base font-bold text-gray-900">Confirm it's you</h2>
              <p id="step-up-text" className="text-xs text-gray-500">
                {!started ? 'Preparing a code…'
                  : app ? (mode === 'code' ? 'Enter the code from your authenticator app.' : 'Enter one of your recovery codes. Each works once.')
                  : `Enter the 6-digit code we emailed to ${started.maskedEmail ?? 'your work email'}.`}
                {window && WINDOW_NOTE[window] ? ' ' + WINDOW_NOTE[window] : ''}
              </p>
            </div>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="Close" className="text-gray-400 hover:text-gray-600 disabled:opacity-40"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); if (started && !spent && codeReady(mode, code)) verify.mutate(); }} className="space-y-4 px-6 py-5" noValidate>
          {!started && start.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Sending a code…</p>}
          {started && !spent && <CodeField id="step-up-code" mode={mode} value={code} onChange={setCode} />}
          <FormError error={error} message={codeErrorMessage(error, 'step-up') ?? undefined} />
          {started && !spent && <SubmitButton pending={busy} disabled={!codeReady(mode, code)}>Confirm</SubmitButton>}
          {(!started && start.isError) || (spent && app) ? (
            <button type="button" onClick={() => start.mutate()} disabled={start.isPending} className="w-full h-11 rounded-[10px] text-sm font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-60">
              Try again
            </button>
          ) : null}
          {started && (app
            ? !spent && (
              <button type="button" onClick={() => { setMode(m => (m === 'code' ? 'recovery' : 'code')); setCode(''); verify.reset(); }} className="block mx-auto text-[13px] font-semibold text-[#027864] hover:underline">
                {mode === 'code' ? 'Use a recovery code' : 'Use my authenticator app instead'}
              </button>
            )
            : <ResendButton what="this confirmation" resendAvailableAt={started.resendAvailableAt} pending={start.isPending} onResend={() => start.mutate()} />)}
          <button type="button" onClick={onCancel} disabled={busy} className="block mx-auto text-xs font-semibold text-gray-500 hover:underline disabled:opacity-40">Cancel</button>
        </form>
      </div>
    </div>
  );
};
