import React from 'react';
import { OnboardingChecklist } from './OnboardingChecklist';

export const OnboardingPage: React.FC = () => <div className="p-8 max-w-5xl mx-auto space-y-5">
  <h1 className="text-2xl font-bold text-gray-900">Help &amp; onboarding</h1>
  <OnboardingChecklist placement="page" />
</div>;
