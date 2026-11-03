import type { QueryClient } from '@tanstack/react-query';
import { ONBOARDING_KEY } from '../../api/onboarding';
import { realOnboardingEnabled } from '../../lib/features';

/** Invalidate derived evidence; never mark a step done locally or replay a mutation. */
export function invalidateOnboarding(qc: QueryClient) {
  if (realOnboardingEnabled()) return qc.invalidateQueries({ queryKey: ONBOARDING_KEY });
}
