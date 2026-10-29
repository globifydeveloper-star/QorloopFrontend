import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, Download, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { authApi } from '../../api/auth';
import { useAuth } from '../../auth/AuthContext';
import type { SessionResponse } from '../../api/types';
import { AuthLayout } from './AuthLayout';
import { Field, FormError, SubmitButton } from './controls';
import { homeFor } from './LoginPage';

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

/** ACC-003. Password → QR code → first code → recovery codes (shown once). Mandatory for Owners. */
export const MfaSetupPage: React.FC = () => {
  const { establish, logout } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [verified, setVerified] = useState<SessionResponse | null>(null);
  const [saved, setSaved] = useState(false);

  const setup = useMutation({ mutationFn: () => authApi.mfaSetup(password) });
  const verify = useMutation({ mutationFn: () => authApi.mfaVerify(code), onSuccess: s => setVerified(s) });
  const uri = setup.data?.totpUri;
  const secret = uri ? new URL(uri).searchParams.get('secret') : null;

  useEffect(() => {
    if (!uri) return;
    let live = true;
    void QRCode.toDataURL(uri, { margin: 1, width: 192 }).then(url => live && setQr(url));
    return () => { live = false; };
  }, [uri]);

  // Step 3: recovery codes. The session was already upgraded by verify; we only refresh the UI after the user has saved them.
  if (verified) {
    const codes = verified.recoveryCodes ?? [];
    const text = codes.join('\n');
    return (
      <AuthLayout title="Save your recovery codes" subtitle="Each code works once if you lose your authenticator. They will not be shown again.">
        <div className="rounded-[10px] border border-gray-200 bg-white p-4">
          <ul data-testid="recovery-codes" className="grid grid-cols-1 gap-1.5 font-mono text-[13px] text-gray-900">
            {codes.map(c => <li key={c} className="select-all break-all">{c}</li>)}
          </ul>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => void navigator.clipboard?.writeText(text)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50">
            <Copy className="w-3.5 h-3.5" /> Copy
          </button>
          <a
            href={URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain' }))} download="qorloop-recovery-codes.txt"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50"
          >
            <Download className="w-3.5 h-3.5" /> Download
          </a>
        </div>
        <label className="mt-5 flex items-start gap-2 text-[13px] text-gray-700">
          <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} className="mt-0.5 rounded" />
          I have stored these codes somewhere safe.
        </label>
        <button
          disabled={!saved}
          onClick={async () => { await establish(verified); navigate(homeFor(verified.state), { replace: true }); }}
          className="mt-4 w-full h-11 rounded-[10px] text-sm font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-60"
        >
          Continue to Qorloop
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set up two-step verification" subtitle="Required for store Owners. You will use an authenticator app each time you sign in.">
      {!uri ? (
        <form onSubmit={e => { e.preventDefault(); setup.mutate(); }} className="space-y-4" noValidate>
          <Field label="Confirm your password" icon={Lock} type="password" autoComplete="current-password" value={password} onChange={setPassword} required autoFocus />
          <FormError error={setup.error} />
          <SubmitButton pending={setup.isPending} disabled={!password}>Continue</SubmitButton>
        </form>
      ) : (
        <form onSubmit={e => { e.preventDefault(); verify.mutate(); }} className="space-y-4" noValidate>
          <p className="text-sm text-gray-600">Scan this code with Google Authenticator, Microsoft Authenticator, 1Password or similar.</p>
          <div className="flex justify-center rounded-[10px] border border-gray-200 bg-white p-3">
            {qr ? <img src={qr} alt="Authenticator QR code" width={192} height={192} /> : <div className="w-48 h-48 animate-pulse bg-gray-100 rounded" />}
          </div>
          {secret && (
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer font-semibold text-gray-700">Can't scan? Enter the key manually</summary>
              <code data-testid="totp-secret" className="mt-1 block break-all rounded bg-gray-100 p-2 text-gray-800 select-all">{secret}</code>
            </details>
          )}
          <Field label="6-digit code" icon={ShieldCheck} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={v => setCode(digits(v))} required />
          <FormError error={verify.error} />
          <SubmitButton pending={verify.isPending} disabled={code.length !== 6}>Verify and turn on</SubmitButton>
        </form>
      )}
      <button onClick={() => void logout().then(() => navigate('/login', { replace: true }))} className="mt-6 block mx-auto text-xs font-semibold text-gray-500 hover:underline">Sign out</button>
    </AuthLayout>
  );
};

/** AUTH-005. Authenticator code, or a one-time recovery code. */
export const MfaVerifyPage: React.FC = () => {
  const { establish, logout } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const verify = useMutation({
    mutationFn: () => (mode === 'totp' ? authApi.mfaVerify(code) : authApi.mfaRecovery(code.trim())),
    onSuccess: async s => { await establish(s); navigate(homeFor(s.state), { replace: true }); },
  });
  const ready = mode === 'totp' ? code.length === 6 : code.trim().length >= 20;
  return (
    <AuthLayout title="Two-step verification" subtitle={mode === 'totp' ? 'Enter the 6-digit code from your authenticator app.' : 'Enter one of your recovery codes. Each works once.'}>
      <form onSubmit={e => { e.preventDefault(); verify.mutate(); }} className="space-y-4" noValidate>
        <Field
          key={mode} label={mode === 'totp' ? '6-digit code' : 'Recovery code'} icon={mode === 'totp' ? ShieldCheck : KeyRound}
          inputMode={mode === 'totp' ? 'numeric' : 'text'} autoComplete={mode === 'totp' ? 'one-time-code' : 'off'} spellCheck={false}
          value={code} onChange={v => setCode(mode === 'totp' ? digits(v) : v)} required autoFocus
        />
        <FormError error={verify.error} />
        <SubmitButton pending={verify.isPending} disabled={!ready}>Verify</SubmitButton>
        <button type="button" onClick={() => { setMode(m => (m === 'totp' ? 'recovery' : 'totp')); setCode(''); verify.reset(); }} className="block mx-auto text-[13px] font-semibold text-[#027864] hover:underline">
          {mode === 'totp' ? 'Use a recovery code instead' : 'Use my authenticator app instead'}
        </button>
      </form>
      <button onClick={() => void logout().then(() => navigate('/login', { replace: true }))} className="mt-6 block mx-auto text-xs font-semibold text-gray-500 hover:underline">Back to sign in</button>
    </AuthLayout>
  );
};
