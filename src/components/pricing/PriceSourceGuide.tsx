import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Percent, Store } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';

/** Anchor of the card, used by the onboarding checklist link (/pricing#price-source). */
export const PRICE_SOURCE_ANCHOR = 'price-source';
/** Anchor of the default-rule section on the Pricing screen; "Set my markup" brings it into view. */
export const DEFAULT_RULE_ANCHOR = 'pricing-default-rule';

export const PRICE_SOURCE_COPY = {
  title: 'How do you set your marketplace prices?',
  intro: [
    'The ERP price alone is usually not your selling price, because you add a markup on top of it.',
    'Qorloop compares the prices on each marketplace with “My pricing”: the price your pricing rules give each product.',
  ],
  markupChoice: 'My prices are the ERP price plus my markup',
  markupHint: 'Set a default markup, and a different one for a category if you need it.',
  markupButton: 'Set my markup',
  adoptChoice: 'My prices are already set in the marketplace',
  adoptHint: 'Copy the prices a marketplace shows today into your pricing, so they stop showing as problems.',
  adoptButton: 'Use my current marketplace prices',
  readOnly: 'Only someone who can change pricing can make these choices.',
  onboardingLink: 'Set how your prices are decided',
} as const;

/** Brings the default rule section into view and puts the cursor in its first field. */
export function openDefaultRule() {
  const section = document.getElementById(DEFAULT_RULE_ANCHOR);
  if (!section) return;
  section.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  section.querySelector<HTMLElement>('select:not([disabled]), input:not([disabled])')?.focus();
}

/**
 * Two plain choices for Owners and Admins. Nothing is stored: each button opens an existing setting. Without
 * pricing.edit the text is shown read-only. `onAdopt` is left out where the adopt flow is not available.
 */
export const PriceSourceGuide: React.FC<{ onAdopt?: () => void }> = ({ onAdopt }) => {
  const { can } = useAuth();
  const editable = can('pricing.edit');
  const { hash } = useLocation();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (hash === `#${PRICE_SOURCE_ANCHOR}`) ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [hash]);

  const c = PRICE_SOURCE_COPY;
  return (
    <section ref={ref} id={PRICE_SOURCE_ANCHOR} aria-label={c.title} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
      <div>
        <h2 className="text-sm font-bold text-gray-900">{c.title}</h2>
        {c.intro.map(s => <p key={s} className="text-xs text-gray-600 mt-1">{s}</p>)}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Choice icon={Percent} title={c.markupChoice} hint={c.markupHint}>
          {editable && <ChoiceButton onClick={openDefaultRule}>{c.markupButton}</ChoiceButton>}
        </Choice>
        <Choice icon={Store} title={c.adoptChoice} hint={c.adoptHint}>
          {editable && onAdopt && <ChoiceButton onClick={onAdopt}>{c.adoptButton}</ChoiceButton>}
        </Choice>
      </div>
      {!editable && <p data-testid="price-source-read-only" className="text-[11px] text-gray-500">{c.readOnly}</p>}
    </section>
  );
};

const Choice: React.FC<{ icon: React.ElementType; title: string; hint: string; children?: React.ReactNode }> = ({ icon: Icon, title, hint, children }) => (
  <div className="flex flex-col gap-2 p-4 rounded-xl border border-gray-200 bg-[#F8FBFA]">
    <div className="flex items-start gap-2">
      <Icon className="w-4 h-4 text-[#027864] shrink-0 mt-0.5" aria-hidden />
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{hint}</p>
      </div>
    </div>
    {children && <div className="mt-auto">{children}</div>}
  </div>
);

const ChoiceButton: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <button type="button" onClick={onClick} className="h-9 px-3.5 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg">
    {children}
  </button>
);
