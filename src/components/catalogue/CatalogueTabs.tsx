import React, { useRef } from 'react';
import { marketplaceName } from '../recon/shared';

/** The tab ids: '' is the catalogue itself, otherwise a marketplace id. */
export const CATALOGUE_TAB = '';
export const catalogueTabId = (id: string) => `catalogue-tab-${id || 'catalogue'}`;
export const CATALOGUE_PANEL_ID = 'catalogue-tab-panel';

/**
 * The tabs at the top of the Catalogue page: "Catalogue", then one per enabled marketplace that has a file. A tab only
 * changes what the list shows next to the catalogue values (read-only); it never changes the catalogue. Arrow keys,
 * Home and End move between the tabs and open the one they land on.
 */
export const CatalogueTabs: React.FC<{ marketplaceIds: string[]; active: string; onSelect: (id: string) => void }> = ({ marketplaceIds, active, onSelect }) => {
  const ids = [CATALOGUE_TAB, ...marketplaceIds];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const go = (i: number) => {
    const n = (i + ids.length) % ids.length;
    onSelect(ids[n]);
    refs.current[n]?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    go(to);
  };
  return (
    <div role="tablist" aria-label="Catalogue or marketplace" className="flex flex-wrap gap-1 border-b border-gray-200">
      {ids.map((id, i) => {
        const selected = id === active;
        return (
          <button
            key={id || 'catalogue'}
            ref={el => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={catalogueTabId(id)}
            aria-selected={selected}
            aria-controls={CATALOGUE_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(id)}
            onKeyDown={e => onKeyDown(e, i)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px focus:outline-none focus-visible:ring-2 focus-visible:ring-[#027864]/40 rounded-t ${
              selected ? 'border-[#027864] text-[#027864]' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
          >
            {id ? marketplaceName(id) : 'Catalogue'}
          </button>
        );
      })}
    </div>
  );
};
