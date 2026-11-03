import type { OnboardingProgress, OnboardingStep, RequiredOnboardingStep } from '../../../api/onboarding';

const definitions: Pick<OnboardingStep, 'id' | 'title' | 'required' | 'action'>[] = [
  { id: 'owner_mfa', title: 'Secure your account', required: true, action: { kind: 'navigate', target: 'settings.security' } },
  { id: 'erp_upload', title: 'Upload your ERP file', required: true, action: { kind: 'navigate', target: 'uploads.erp' } },
  { id: 'marketplace_upload', title: 'Upload at least one marketplace file', required: true, action: { kind: 'navigate', target: 'uploads.marketplace' } },
  { id: 'first_comparison', title: 'Review the first comparison', required: true, action: { kind: 'navigate', target: 'dashboard' } },
  { id: 'invite_team', title: 'Invite your team', required: false, action: { kind: 'navigate', target: 'team.invite' } },
  { id: 'pricing_settings', title: 'Review pricing settings', required: false, action: { kind: 'navigate', target: 'settings.pricing' } },
  { id: 'generated_file', title: 'Generate your first corrected file', required: false, action: { kind: 'navigate', target: 'generated-files' } },
];
export const EVIDENCE_TIME = '2026-11-03T08:30:00.000Z';
export const progress = (done: RequiredOnboardingStep[] = []): OnboardingProgress => {
  const next = definitions.find(step => step.required && !done.includes(step.id as RequiredOnboardingStep))?.id as RequiredOnboardingStep | undefined;
  return {
    percent: done.length * 25 as OnboardingProgress['percent'], complete: done.length === 4, nextStepId: next ?? null,
    steps: definitions.map(step => ({ ...step, description: `Server description for ${step.title}.`, status: done.includes(step.id as RequiredOnboardingStep) ? 'done' : step.id === next ? 'next' : 'todo', doneAt: step.id !== 'owner_mfa' && done.includes(step.id as RequiredOnboardingStep) ? EVIDENCE_TIME : null })),
    marketplaces: (['talabat', 'snoonu', 'rafeeq', 'keeta'] as const).map(marketplaceId => ({ marketplaceId, applied: marketplaceId === 'talabat' && done.includes('marketplace_upload'), doneAt: marketplaceId === 'talabat' && done.includes('marketplace_upload') ? EVIDENCE_TIME : null })),
  };
};
export const completeProgress = () => progress(['owner_mfa', 'erp_upload', 'marketplace_upload', 'first_comparison']);
