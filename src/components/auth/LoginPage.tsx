import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Lock, Mail } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '../../api/auth';
import { useAuth } from '../../auth/AuthContext';
import { AuthLayout } from './AuthLayout';
import { Field, FormError, FormNotice, SubmitButton } from './controls';

/** Where a session state sends the user next. */
export const homeFor = (state: string, next?: string | null) =>
  state === 'mfa_setup_required' ? '/mfa/setup' : state === 'mfa_required' ? '/mfa/verify' : next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

export const LoginPage: React.FC = () => {
  const { establish } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => authApi.login(email.trim(), password),
    onSuccess: async s => { await establish(s); navigate(homeFor(s.state, params.get('next')), { replace: true }); },
  });

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your Qorloop workspace.">
      <form onSubmit={e => { e.preventDefault(); login.mutate(); }} className="space-y-4" noValidate>
        {params.get('reset') && <FormNotice>Your password was changed. Sign in with the new one.</FormNotice>}
        <Field label="Work email" icon={Mail} type="email" autoComplete="username" value={email} onChange={setEmail} required autoFocus />
        <Field
          label="Password" icon={Lock} type="password" autoComplete="current-password" value={password} onChange={setPassword} required
          action={<Link to="/forgot-password" className="text-[13px] font-semibold text-[#027864] hover:underline">Forgot password?</Link>}
        />
        <FormError error={login.error} />
        <SubmitButton pending={login.isPending} disabled={!email || !password}>
          Sign in <ArrowRight className="w-4 h-4" />
        </SubmitButton>
        <p className="pt-2 text-center text-xs text-gray-400">Access is by invitation only. Ask your store Owner to invite you.</p>
      </form>
    </AuthLayout>
  );
};
