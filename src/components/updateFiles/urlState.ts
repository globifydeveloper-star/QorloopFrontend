import { useSearchParams } from 'react-router-dom';
import { RECON_REFERENCES, type ReconMarketplaceSummary, type ReconReference, type ReconRowType, type ReconStatus } from '../../api/recon';
import type { ExportState, ValueFilter } from '../../api/marketplaceValues';
import { pathFor } from '../../routes/paths';

/**
 * Everything the "Update marketplace files" screen remembers lives in the address bar, so Back, refresh and a shared
 * link open the same tab, step and filter: ?marketplace=talabat&step=adjust&show=needs&type=all&reference=erp
 */

export const STEPS = ['review', 'adjust', 'export'] as const;
export type Step = (typeof STEPS)[number];
export const STEP_LABELS: Record<Step, string> = { review: 'Review', adjust: 'Adjust', export: 'Export' };

/** Which products the Adjust table lists. */
export const SHOWS = ['needs', 'waiting', 'pinned', 'blocked', 'all'] as const;
export type Show = (typeof SHOWS)[number];
export const SHOW_LABELS: Record<Show, string> = {
  needs: 'Needs a change',
  waiting: 'Adjusted, waiting for export',
  pinned: 'Pinned',
  blocked: 'Blocked',
  all: 'All products',
};

/**
 * The recon-row filter for each choice. "Needs a change" = mismatches with no adjustment of yours (ASSUMPTION: the
 * proposal's exportState filter takes one value; rows whose adjustment was cleared are listed under "All products").
 */
export const SHOW_FILTER: Record<Show, { status?: ReconStatus; exportState?: ExportState }> = {
  needs: { status: 'mismatch', exportState: 'catalogue' },
  waiting: { exportState: 'waiting_for_export' },
  pinned: { exportState: 'pinned' },
  blocked: { exportState: 'blocked' },
  all: {},
};

export const TYPES: readonly ReconRowType[] = ['all', 'stock', 'price'];
export const TYPE_LABELS: Record<ReconRowType, string> = { all: 'Stock and price', stock: 'Stock only', price: 'Price only' };

/**
 * The same list as the backend's bulk selection filter (its Review list, strict keys; always against the catalogue).
 * "Needs a change" here is the backend's to_fix (not adjusted yet); stock is the availability field.
 */
export function bulkFilter(show: Show, type: ReconRowType): ValueFilter {
  const state: Record<Show, ValueFilter> = {
    needs: { exportState: 'to_fix' }, waiting: { exportState: 'waiting_for_export' }, pinned: { exportState: 'pinned' }, blocked: { exportState: 'blocked' }, all: { show: 'all' },
  };
  return { ...state[show], ...(type === 'stock' ? { field: 'availability' } : type === 'price' ? { field: 'price' } : {}) };
}

const one = <T extends string>(v: string | null, allowed: readonly T[]): T | undefined => ((allowed as readonly string[]).includes(v ?? '') ? (v as T) : undefined);

export interface UpdateFilesState {
  marketplace: string | null;
  step: Step;
  show: Show;
  type: ReconRowType;
  /** undefined: the store's default (the summary names it). */
  reference?: ReconReference;
}

export function readState(p: URLSearchParams): UpdateFilesState {
  return {
    marketplace: p.get('marketplace'),
    step: one(p.get('step'), STEPS) ?? 'review',
    show: one(p.get('show'), SHOWS) ?? 'needs',
    type: one(p.get('type'), TYPES) ?? 'all',
    reference: one(p.get('reference'), RECON_REFERENCES),
  };
}

const DEFAULTS: Partial<Record<keyof UpdateFilesState, string>> = { step: 'review', show: 'needs', type: 'all' };

export function useUpdateFilesState() {
  const [params, setParams] = useSearchParams();
  const state = readState(params);
  /** Defaults are left out of the URL; a step change is a history entry, filter changes replace it. */
  const set = (patch: Partial<UpdateFilesState>) => setParams(p => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === DEFAULTS[k as keyof UpdateFilesState]) next.delete(k); else next.set(k, String(v));
    }
    return next;
  }, { replace: !('step' in patch || 'marketplace' in patch) });
  return [state, set] as const;
}

/** Permission to change the values to export (Owner, Admin, Catalogue Manager); every other role reads only. */
export const EDIT_PERMISSION = 'marketplace.values_edit';

/** What every step gets from the screen. */
export interface StepProps {
  summary: ReconMarketplaceSummary;
  /** Every marketplace on a tab, for "Export both". */
  marketplaces: ReconMarketplaceSummary[];
  /** The one asked for in the URL, else the store's default (named by the summary). */
  reference: ReconReference;
  state: UpdateFilesState;
  set: (patch: Partial<UpdateFilesState>) => void;
}

/** The Dashboard card's "Update marketplace file" and other links into this screen. */
export const updateFilesLink = (marketplaceId: string, step?: Step) =>
  `${pathFor('update-files')}?${new URLSearchParams({ marketplace: marketplaceId, ...(step && step !== 'review' ? { step } : {}) })}`;
