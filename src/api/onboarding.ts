import { api } from './client';

/** GET /api/onboarding; mirrored from backend docs/onboarding-api.md and ADR 015. */
export type RequiredOnboardingStep = 'owner_mfa' | 'erp_upload' | 'marketplace_upload' | 'first_comparison';
export type OnboardingStepId = RequiredOnboardingStep | 'invite_team' | 'pricing_settings' | 'generated_file';
export type OnboardingTarget = 'settings.security' | 'uploads.erp' | 'uploads.marketplace' | 'dashboard' | 'team.invite' | 'settings.pricing' | 'generated-files';
export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  description: string;
  required: boolean;
  status: 'done' | 'next' | 'todo';
  doneAt: string | null;
  action: { kind: 'navigate'; target: OnboardingTarget };
}
export interface OnboardingProgress {
  steps: OnboardingStep[];
  percent: 0 | 25 | 50 | 75 | 100;
  nextStepId: RequiredOnboardingStep | null;
  complete: boolean;
  marketplaces: { marketplaceId: 'talabat' | 'snoonu' | 'rafeeq' | 'keeta'; applied: boolean; doneAt: string | null }[];
}
export const ONBOARDING_KEY = ['onboarding'] as const;
export const onboardingApi = {
  get: (signal?: AbortSignal) => api<OnboardingProgress>('/api/onboarding', { signal }),
};
