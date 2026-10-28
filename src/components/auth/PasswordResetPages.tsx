import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, Mail } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { AuthLayout } from './AuthLayout';
import { Field, FormError, FormNotice, SubmitButton, forgetToken, passwordProblem, takeHashToken } from './controls';

/** AUTH-006. The server answers the same way for known and unknown addresses; so do we. */
export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const forgot = useMutation({ mutationFn: () => authApi.forgotPassword(email.trim()) });
  return (
    <AuthLayout title="Forgot your password?" subtitle="Enter your email and we will send a reset link if an account exists.">
      {forgot.isSuccess ? (
        <div className="space-y-4">
          <FormNotice>If an account exists for that address, a reset link is on its way. It expires in 30 minutes.</FormNotice>
          <Link to="/login" className="inline-block text-sm font-semibold text-[#027864] hover:underline">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={e => { e.preventDefault(); forgot.mutate(); }} className="space-y-4" noValidate>
          <Field label="Work email" icon={Mail} type="email" autoComplete="username" value={email} onChange={setEmail} required autoFocus />
          <FormError error={forgot.error} />
          <SubmitButton pending={forgot.isPending} disabled={!email}>Send reset link</SubmitButton>
          <Link to="/login" className="block text-center text-sm font-semibold text-[#027864] hover:underline">Back to sign in</Link>
        </form>
      )}
    </AuthLayout>
  );
};

/** AUTH-007. Resetting revokes every session; MFA stays enrolled, so the next sign-in still asks for it. */
export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [token] = useState(takeHashToken);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const reset = useMutation({
    mutationFn: () => authApi.resetPassword(token!, password),
    onSuccess: () => { forgetToken(); navigate('/login?reset=1', { replace: true }); },
  });

  if (!token) {
    return (
      <AuthLayout title="This reset link is incomplete">
        <p className="text-sm text-gray-600">Open the link from your email again, or request a new one.</p>
        <Link to="/forgot-password" className="mt-6 inline-block text-sm font-semibold text-[#027864] hover:underline">Request a new link</Link>
      </AuthLayout>
    );
  }
  const field = (reset.error instanceof ApiError && reset.error.fieldErrors) || {};
  const invalid = Boolean(passwordProblem(password)) || confirm !== password;
  return (
    <AuthLayout title="Choose a new password" subtitle="You will be signed out everywhere and asked to sign in again.">
      <form onSubmit={e => { e.preventDefault(); setTouched(true); if (!invalid) reset.mutate(); }} className="space-y-4" noValidate>
        <Field label="New password" icon={Lock} type="password" autoComplete="new-password" value={password} onChange={setPassword}
          error={touched ? passwordProblem(password) ?? field.password : field.password} hint="At least 12 characters." required autoFocus />
        <Field label="Confirm new password" icon={Lock} type="password" autoComplete="new-password" value={confirm} onChange={setConfirm}
          error={touched && confirm !== password ? 'Passwords do not match' : undefined} required />
        <FormError error={reset.error && !Object.keys(field).length ? reset.error : null} />
        <SubmitButton pending={reset.isPending}>Change password</SubmitButton>
      </form>
    </AuthLayout>
  );
};
