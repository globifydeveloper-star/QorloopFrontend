import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Copy, Download, Lock } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { authApi } from '../../api/auth';
import { useAuth } from '../../auth/AuthContext';
import { AuthLayout } from './AuthLayout';
import { Field, FormError, SubmitButton } from './controls';
import { CodeField, codeReady } from './codes';
import { safeReturnTo } from '../../lib/returnTo';

/**
 * ACC-003. Shown only when the store requires an authenticator app for everyone (session state
 * authenticator_setup_required, or 403 AUTHENTICATOR_SETUP_REQUIRED). Password → QR code → first code → recovery codes,
 * shown once. Everyone else signs in with emailed codes and may add an app later from their account.
 */
export const AuthenticatorSetupPage: React.FC = () => {
  const { establish, logout } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  const setup = useMutation({ mutationFn: () => authApi.setupAuthenticator(password) });
  const verify = useMutation({ mutationFn: () => authApi.confirmAuthenticator(code), onSuccess: r => setCodes(r.recoveryCodes) });
  const uri = setup.data?.totpUri;
  const secret = uri ? new URL(uri).searchParams.get('secret') : null;

  useEffect(() => {
    if (!uri) return;
    let live = true;
    void QRCode.toDataURL(uri, { margin: 1, width: 192 }).then(url => live && setQr(url));
    return () => { live = false; };
  }, [uri]);

  // Recovery codes. The app is already on; the UI refreshes the session only after the user has saved them.
  if (codes) {
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
          onClick={async () => { await establish(); navigate(safeReturnTo(params.get('next')), { replace: true }); }}
          className="mt-4 w-full h-11 rounded-[10px] text-sm font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-60"
        >
          Continue to Qorloop
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set up an authenticator app" subtitle="Your store requires an authenticator app for everyone. You will use it each time you sign in on a new device.">
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
          <CodeField mode="code" value={code} onChange={setCode} />
          <FormError error={verify.error} />
          <SubmitButton pending={verify.isPending} disabled={!codeReady('code', code)}>Verify and turn on</SubmitButton>
        </form>
      )}
      <button onClick={() => void logout().then(() => navigate('/login', { replace: true }))} className="mt-6 block mx-auto text-xs font-semibold text-gray-500 hover:underline">Sign out</button>
    </AuthLayout>
  );
};
