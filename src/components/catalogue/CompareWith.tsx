import React from 'react';
import { Check } from 'lucide-react';
import { marketplaceName } from '../recon/shared';

/** At most this many marketplaces side by side: two keep the table readable (and the backend compares two). */
export const COMPARE_MAX = 2;

/**
 * "Compare with" above the catalogue: one toggle button per enabled marketplace that has a file. Pressing one shows
 * its values next to the catalogue's; a second one shows both side by side. The order of pressing is kept (the first
 * one is the main marketplace). Nothing here changes the catalogue: it is a read-only comparison.
 */
export const CompareWith: React.FC<{ marketplaceIds: string[]; selected: string[]; onChange: (ids: string[]) => void }> = ({ marketplaceIds, selected, onChange }) => {
  const full = selected.length >= COMPARE_MAX;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id].slice(0, COMPARE_MAX));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span id="compare-with-label" className="text-xs font-semibold text-gray-700">Compare with</span>
      <div role="group" aria-labelledby="compare-with-label" className="flex flex-wrap gap-2">
        {marketplaceIds.map(id => {
          const on = selected.includes(id);
          const blocked = !on && full;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              disabled={blocked}
              title={blocked ? `Compare at most ${COMPARE_MAX} marketplaces at once` : undefined}
              onClick={() => toggle(id)}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#027864] disabled:opacity-50 disabled:cursor-not-allowed ${
                on ? 'border-[#027864] bg-[#027864] text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {on && <Check className="w-3.5 h-3.5" aria-hidden />}
              {marketplaceName(id)}
            </button>
          );
        })}
      </div>
      <span data-testid="compare-hint" className="text-[11px] text-gray-500">
        {selected.length === 0 ? 'Choose a marketplace to see its values next to your catalogue.'
          : selected.length === 1 ? 'Read-only. Choose a second marketplace to see both side by side.'
            : 'Read-only. Your catalogue does not change.'}
      </span>
    </div>
  );
};
