import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, User } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AuthLayout } from './AuthLayout';
import { Field, FormError, SubmitButton, forgetToken, passwordProblem, takeHashToken } from './controls';
import { homeFor } from './LoginPage';

/** AUTH-008. Accepting the invitation verifies the email, sets the name and password and starts a session. */
export const AcceptInvitationPage: React.FC = () => {
  const { establish } = useAuth();
  const navigate = useNavigate();
  const [token] = useState(takeHashToken);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);

  const accept = useMutation({
    mutationFn: () => authApi.acceptInvitation(token!, name.trim(), password),
    onSuccess: async s => { forgetToken(); await establish(s); navigate(homeFor(s.state), { replace: true }); },
  });

  if (!token) {
    return (
      <AuthLayout title="This invitation link is incomplete">
        <p className="text-sm text-gray-600">Open the link from your invitation email again. If it still does not work, ask your store Owner to send a new invitation.</p>
        <Link to="/login" className="mt-6 inline-block text-sm font-semibold text-[#027864] hover:underline">Go to sign in</Link>
      </AuthLayout>
    );
  }

  const field = (accept.error instanceof ApiError && accept.error.fieldErrors) || {};
  const pwErr = touched ? passwordProblem(password) ?? field.password : field.password;
  const mismatch = touched && confirm !== password ? 'Passwords do not match' : undefined;
  const invalid = !name.trim() || Boolean(passwordProblem(password)) || confirm !== password;

  return (
    <AuthLayout title="Welcome to Qorloop" subtitle="Set your name and password to activate your account. This also verifies your email.">
      <form onSubmit={e => { e.preventDefault(); setTouched(true); if (!invalid) accept.mutate(); }} className="space-y-4" noValidate>
        <Field label="Your name" icon={User} autoComplete="name" value={name} onChange={setName} error={field.name} required autoFocus />
        <Field label="Password" icon={Lock} type="password" autoComplete="new-password" value={password} onChange={setPassword} error={pwErr} hint="At least 12 characters. A long phrase works well." required />
        <Field label="Confirm password" icon={Lock} type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} error={mismatch} required />
        <FormError error={accept.error && !(Object.keys(field).length) ? accept.error : null} />
        <SubmitButton pending={accept.isPending}>Activate account</SubmitButton>
        <p className="pt-1 text-center text-xs text-gray-400">Store Owners are asked to set up two-step verification next.</p>
      </form>
    </AuthLayout>
  );
};
