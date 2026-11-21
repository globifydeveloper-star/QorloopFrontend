import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Lock, Mail } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '../../api/auth';
import { isChallenge, type ChallengeResponse, type SessionResponse } from '../../api/types';
import { assertKnownState, useAuth } from '../../auth/AuthContext';
import { AuthLayout } from './AuthLayout';
import { FormError, FormNotice, Field, SubmitButton } from './controls';
import { CodeField, ResendButton, codeErrorMessage, codeReady, endsSignIn, resendAfterLimit } from './codes';
import { AUTHENTICATOR_SETUP_PATH } from './AuthGate';
import { returnQuery, safeReturnTo } from '../../lib/returnTo';

/** Where a session state sends the user next. */
export const homeFor = (state: string, next?: string | null) =>
  state === 'authenticator_setup_required' ? AUTHENTICATOR_SETUP_PATH + returnQuery(next) : safeReturnTo(next);

/**
 * AUTH-001. Password first. A trusted browser goes straight in; otherwise the server asks for a code (emailed, or the
 * authenticator app) and this page shows the code step. The challenge itself is an httpOnly cookie the app never sees.
 */
export const LoginPage: React.FC = () => {
  const { establish } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shared, setShared] = useState(false);
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  /** Why the user is back on the password step (too many wrong codes, or the sign-in expired). */
  const [ended, setEnded] = useState<string | null>(null);

  const finish = async (s: SessionResponse) => { await establish(s); navigate(homeFor(s.state, params.get('next')), { replace: true }); };
  const login = useMutation({
    mutationFn: async () => {
      const r = await authApi.login(email.trim(), password, shared);
      if (!isChallenge(r)) assertKnownState(r.state); // never go in on a sign-in step this app cannot complete
      return r;
    },
    onMutate: () => setEnded(null),
    onSuccess: async r => { if (isChallenge(r)) setChallenge(r); else await finish(r); },
  });
  const backToPassword = (reason: string | null) => { setChallenge(null); setPassword(''); setEnded(reason); login.reset(); };

  if (challenge) return <CodeStep challenge={challenge} onChallenge={setChallenge} onSession={finish} onEnd={backToPassword} />;

  // A rejected login can also be 429 OTP_SEND_LIMIT (no code may be sent right now).
  const loginError = codeErrorMessage(login.error);
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your Qorloop workspace.">
      <form onSubmit={e => { e.preventDefault(); login.mutate(); }} className="space-y-4" noValidate>
        {params.get('reset') && !ended && <FormNotice>Your password was changed. Sign in with the new one.</FormNotice>}
        {ended && <FormError error={new Error(ended)} message={ended} />}
        <Field label="Work email" icon={Mail} type="email" autoComplete="username" value={email} onChange={setEmail} required autoFocus />
        <Field
          label="Password" icon={Lock} type="password" autoComplete="current-password" value={password} onChange={setPassword} required
          action={<Link to="/forgot-password" className="text-[13px] font-semibold text-[#027864] hover:underline">Forgot password?</Link>}
        />
        <label className="flex items-start gap-2 text-[13px] text-gray-700">
          <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} className="mt-0.5 rounded" aria-describedby="shared-hint" />
          <span>
            This is a shared computer
            <span id="shared-hint" className="block text-xs text-gray-500">We will not remember this browser: you sign in with a code every time, and the session ends after 12 hours.</span>
          </span>
        </label>
        <FormError error={login.error} message={loginError ?? undefined} />
        <SubmitButton pending={login.isPending} disabled={!email || !password}>
          Sign in <ArrowRight className="w-4 h-4" />
        </SubmitButton>
        <p className="pt-2 text-center text-xs text-gray-400">Access is by invitation only. Ask your store Owner to invite you.</p>
      </form>
    </AuthLayout>
  );
};

/** AUTH-005. The emailed code (with resend), or the authenticator app's code with a recovery-code fallback. */
const CodeStep: React.FC<{
  challenge: ChallengeResponse;
  onChallenge: (c: ChallengeResponse) => void;
  onSession: (s: SessionResponse) => Promise<void>;
  onEnd: (reason: string | null) => void;
}> = ({ challenge, onChallenge, onSession, onEnd }) => {
  const app = challenge.state === 'totp_required';
  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);

  const verify = useMutation({
    mutationFn: () => (mode === 'code' ? authApi.verifyCode(code) : authApi.verifyRecoveryCode(code.trim())),
    onSuccess: onSession,
    onError: e => { if (endsSignIn(e)) onEnd(codeErrorMessage(e)); else setCode(''); },
  });
  const resend = useMutation({
    mutationFn: authApi.resendCode,
    onMutate: () => setSent(false),
    onSuccess: r => { onChallenge({ ...challenge, ...r }); setSent(true); verify.reset(); setCode(''); },
    onError: e => {
      if (endsSignIn(e)) onEnd(codeErrorMessage(e));
      else onChallenge({ ...challenge, resendAvailableAt: resendAfterLimit(e, challenge.resendAvailableAt) });
    },
  });

  const error = verify.error ?? resend.error;
  const title = app ? 'Two-step verification' : 'Check your email';
  const subtitle = app
    ? mode === 'code' ? 'Enter the code from your authenticator app.' : 'Enter one of your recovery codes. Each works once.'
    : `Enter the 6-digit code we emailed to ${challenge.maskedEmail ?? 'your work email'}.`;
  return (
    <AuthLayout title={title} subtitle={subtitle}>
      <form onSubmit={e => { e.preventDefault(); if (codeReady(mode, code)) verify.mutate(); }} className="space-y-4" noValidate>
        {sent && !error && <FormNotice>We sent a new code. The previous one no longer works.</FormNotice>}
        <CodeField mode={mode} value={code} onChange={setCode} />
        <FormError error={error} message={codeErrorMessage(error) ?? undefined} />
        <SubmitButton pending={verify.isPending} disabled={!codeReady(mode, code)}>Verify</SubmitButton>
        {app ? (
          <button type="button" onClick={() => { setMode(m => (m === 'code' ? 'recovery' : 'code')); setCode(''); verify.reset(); }} className="block mx-auto text-[13px] font-semibold text-[#027864] hover:underline">
            {mode === 'code' ? 'Use a recovery code' : 'Use my authenticator app instead'}
          </button>
        ) : (
          <ResendButton resendAvailableAt={challenge.resendAvailableAt} pending={resend.isPending} onResend={() => resend.mutate()} />
        )}
      </form>
      <button type="button" onClick={() => onEnd(null)} className="mt-6 block mx-auto text-xs font-semibold text-gray-500 hover:underline">Back to sign in</button>
    </AuthLayout>
  );
};
