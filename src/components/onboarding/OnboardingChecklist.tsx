import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ONBOARDING_KEY, onboardingApi, type OnboardingStep } from '../../api/onboarding';
import { useAuth } from '../../auth/AuthContext';
import { realOnboardingEnabled } from '../../lib/features';
import { qatarDateTime } from '../../lib/format';
import { EmptyState, ErrorState, LoadingState } from '../common/States';
import { marketplaceName } from '../recon/shared';
import { ONBOARDING_TARGETS } from './targets';

export function useOnboardingProgress(enabled = true) {
  const { me, can } = useAuth();
  const eligible = (me?.role === 'owner' || me?.role === 'admin') && can('settings.view');
  return useQuery({ queryKey: ONBOARDING_KEY, queryFn: ({ signal }) => onboardingApi.get(signal), enabled: enabled && realOnboardingEnabled() && eligible, retry: false });
}

/** No browser completion/dismiss state: visibility and progress always come from server evidence. */
export const OnboardingChecklist: React.FC<{ placement?: 'dashboard' | 'page' }> = ({ placement = 'dashboard' }) => {
  const { me, can } = useAuth();
  if (!realOnboardingEnabled() || !can('settings.view') || (me?.role !== 'owner' && me?.role !== 'admin')) return null;
  return <Checklist placement={placement} />;
};

const Checklist: React.FC<{ placement: 'dashboard' | 'page' }> = ({ placement }) => {
  const q = useOnboardingProgress();
  if (q.data?.steps.length === 0 && !q.isError) return null;
  if (q.data?.complete && !q.isError) return placement === 'dashboard' ? null : <EmptyState title="You're all set" hint="All required get-started steps are complete." />;
  const required = q.data?.steps.filter(step => step.required) ?? [];
  const optional = q.data?.steps.filter(step => !step.required) ?? [];
  return <section aria-label="Get started" className={`${placement === 'dashboard' ? 'm-8 mb-0 max-w-7xl' : ''} bg-white border border-gray-200 rounded-2xl p-5 space-y-5`}>
    <div><h2 className="text-lg font-bold text-gray-900">Get started</h2><p className="text-xs text-gray-500">Complete these four required steps to get your store ready. Progress updates from your store's records.</p></div>
    {q.isPending ? <LoadingState label="Loading get-started checklist…" rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <>
      <div>
        <p className="text-sm font-semibold mb-2">{q.data.percent}% complete</p>
        <div role="progressbar" aria-label="Required setup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={q.data.percent} className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-[#027864]" style={{ width: `${q.data.percent}%` }} /></div>
      </div>
      <section aria-label="Required steps"><h3 className="font-bold text-sm mb-2">Required steps</h3><ol className="divide-y divide-gray-100">{required.map(step => <Step key={step.id} step={step} />)}</ol></section>
      {optional.length > 0 && <section aria-label="Optional steps"><h3 className="font-bold text-sm">Optional steps</h3><p className="text-xs text-gray-500 mt-1">Optional. These do not affect your progress or prevent completion.</p><ul className="divide-y divide-gray-100">{optional.map(step => <Step key={step.id} step={step} />)}</ul></section>}
      {q.data.marketplaces.length > 0 && <section aria-label="Marketplace upload evidence"><h3 className="text-sm font-bold">Marketplace uploads</h3><p className="text-xs text-gray-500">At least one marketplace upload is required. These are applied uploads, not marketplace enable switches.</p><ul className="mt-2 space-y-1 text-xs text-gray-700">{q.data.marketplaces.map(m => <li key={m.marketplaceId}><b>{marketplaceName(m.marketplaceId)}:</b> {m.applied ? 'Applied upload' : 'No applied upload'}{m.doneAt && ` · ${qatarDateTime(m.doneAt)} (Qatar time)`}</li>)}</ul></section>}
    </>}
  </section>;
};

const STATUS = { done: 'Done', next: 'Next', todo: 'To do' } as const;
const Step: React.FC<{ step: OnboardingStep }> = ({ step }) => {
  const target = ONBOARDING_TARGETS[step.action.target];
  return <li aria-current={step.status === 'next' ? 'step' : undefined} className="py-4 flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0 flex-1"><div className="flex flex-wrap gap-2 items-center"><h4 className="text-sm font-semibold text-gray-900">{step.title}</h4><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${step.status === 'done' ? 'bg-teal-50 text-teal-800' : step.status === 'next' ? 'bg-blue-50 text-blue-800' : 'bg-gray-100 text-gray-600'}`}>{STATUS[step.status]}</span>{!step.required && <span className="text-xs text-gray-500">Optional</span>}</div><p className="text-xs text-gray-600 mt-1">{step.description}</p>{step.doneAt && <p className="text-xs text-gray-500 mt-1">Recorded {qatarDateTime(step.doneAt)} (Qatar time)</p>}</div>
    {target && <Link to={target.path} className="border border-gray-300 rounded-lg px-3 py-2 text-xs font-semibold text-[#027864] hover:bg-gray-50">{target.label}</Link>}
  </li>;
};
