import type { OnboardingTarget } from '../../api/onboarding';
import { pathFor } from '../../routes/paths';

/** Every committed backend target maps to a real frontend route, never a guessed endpoint. */
export const ONBOARDING_TARGETS: Record<OnboardingTarget, { path: string; label: string }> = {
  'settings.security': { path: pathFor('settings') + '#security', label: 'Review security' },
  'uploads.erp': { path: pathFor('uploads') + '?start=erp', label: 'Upload ERP file' },
  'uploads.marketplace': { path: pathFor('uploads') + '?start=marketplace', label: 'Choose marketplace' },
  dashboard: { path: pathFor('dashboard'), label: 'Open dashboard' },
  'team.invite': { path: pathFor('team') + '?invite=1', label: 'Invite team member' },
  'settings.pricing': { path: pathFor('markups'), label: 'Review pricing' },
  'generated-files': { path: pathFor('outputs-generate'), label: 'Generate files' },
};
