import { keepPreviousData, useInfiniteQuery, useMutation, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { RECON_PAGE_SIZE, reconApi, type ReconMarketplaceId, type ReconReference, type ReconRow, type ReconRowType, type ReconRowsPage } from '../../api/recon';
import { marketplaceValuesApi, type MarketplaceValueItem, type SetValues, type ValueField, type ValueVersion } from '../../api/marketplaceValues';
import { applySet, applyUseCatalogue, valueErrors, valuesOf } from './logic';
import { SHOW_FILTER, type Show } from './urlState';

/** Under ['recon', 'rows'], so every recon refresh (a recompute landing, an upload) refreshes this list too. */
export const ADJUST_KEY = ['recon', 'rows', 'update-files'] as const;
/** The Export bar's generated-file previews; refreshed after every change of a value to export. */
export const EXPORT_PREVIEW_KEY = ['update-files', 'preview'] as const;

export interface AdjustFilter { marketplaceId: ReconMarketplaceId; reference: ReconReference; show: Show; type: ReconRowType }

/** GET /api/recon/rows with the proposed exportState filter: one server page per "Load more", urgent rows first. */
export function useAdjustRows(f: AdjustFilter) {
  const { status, exportState } = SHOW_FILTER[f.show];
  return useInfiniteQuery({
    queryKey: [...ADJUST_KEY, f.marketplaceId, f.reference, f.show, f.type],
    queryFn: ({ pageParam, signal }) => reconApi.rows({
      marketplaceId: f.marketplaceId, type: f.type, reference: f.reference, status, exportState, cursor: pageParam, limit: RECON_PAGE_SIZE,
    }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

type Rows = InfiniteData<ReconRowsPage> | ReconRowsPage | undefined;

/** Replace one product's value item on one marketplace in every cached recon list (this table, the Dashboard, the reports). */
function patchRows(qc: QueryClient, marketplaceId: string, productId: string, patch: (item: MarketplaceValueItem) => MarketplaceValueItem) {
  const patchRow = (r: ReconRow): ReconRow => {
    if (r.productId !== productId) return r;
    const item = valuesOf(r);
    return item && item.marketplaceId === marketplaceId ? { ...r, marketplaceValues: patch(item) } : r;
  };
  qc.setQueriesData<Rows>({ queryKey: ['recon', 'rows'] }, data => {
    if (!data) return data;
    if ('pages' in data) return { ...data, pages: data.pages.map(p => ({ ...p, items: p.items.map(patchRow) })) };
    if ('items' in data) return { ...data, items: data.items.map(patchRow) };
    return data;
  });
}

/** After a change: the counts (waiting / pinned) and the export previews. The list itself keeps the row where it is. */
export function afterValueChange(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['recon', 'summary'] });
  void qc.invalidateQueries({ queryKey: EXPORT_PREVIEW_KEY });
  void qc.invalidateQueries({ queryKey: ['activity'] });
}

export type ValueChangeRequest =
  | { kind: 'set'; productId: string; values: SetValues; expected: ValueVersion }
  | { kind: 'use_catalogue'; productId: string; fields: ValueField[]; expected: ValueVersion };

/**
 * One product's value to export: shown at once (optimistic), replaced by the server's answer, rolled back on an error.
 * A 409 (someone else changed it) reloads the lists so the newer values show. Rows never leave the list here.
 */
export function useValueChange(marketplaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (c: ValueChangeRequest) => c.kind === 'set'
      ? marketplaceValuesApi.set(marketplaceId, c.productId, { values: c.values, expected: c.expected })
      : marketplaceValuesApi.useCatalogue(marketplaceId, c.productId, c.fields, c.expected),
    onMutate: async c => {
      await qc.cancelQueries({ queryKey: ['recon', 'rows'] });
      const snapshot = qc.getQueriesData<Rows>({ queryKey: ['recon', 'rows'] });
      patchRows(qc, marketplaceId, c.productId, item => (c.kind === 'set' ? applySet(item, c.values) : applyUseCatalogue(item, c.fields)));
      return { snapshot };
    },
    onError: (e, _c, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
      if (valueErrors(e).stale) void qc.invalidateQueries({ queryKey: ['recon', 'rows'] });
    },
    onSuccess: (res, c) => {
      patchRows(qc, marketplaceId, c.productId, () => res.item);
      if (res.changed) afterValueChange(qc);
    },
  });
}
