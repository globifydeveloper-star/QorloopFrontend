import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import type { ReconRow, ReconRowType } from '../../api/recon';
import { readMarketplaceSource } from '../../api/marketplaceValues';
import { pathFor } from '../../routes/paths';
import { EmptyState, ErrorState, LoadingState } from '../common/States';
import { count, priceText } from '../pricing/priceChange';
import { MarketplaceAvailability, NOT_IN_FILE, OwnAvailability, marketplaceName, ownSide, qatarDateTime } from '../recon/shared';
import { ExportStateBadge, ExportValueEditor, PRICE_INPUT_ATTR } from './ExportValueEditor';
import { FileAge } from './ReviewStep';
import { valuesOf } from './logic';
import { useAdjustRows } from './queries';
import { EDIT_PERMISSION, SHOWS, SHOW_LABELS, TYPES, TYPE_LABELS, type Show, type StepProps } from './urlState';

/**
 * ADJUST: the products that need a change on this marketplace (server pages, urgent first), with the marketplace's
 * values, the catalogue's, and the value to export, editable in place. Rows stay where they are after a save (their state
 * badge changes); "Refresh the list" applies the filter again.
 */
export const AdjustStep: React.FC<StepProps & { bulk?: (ctx: AdjustContext) => React.ReactNode }> = ({ summary: s, reference, state, set, bulk }) => {
  const { can } = useAuth();
  const canEdit = can(EDIT_PERMISSION);
  const name = marketplaceName(s.marketplaceId);
  const rows = useAdjustRows({ marketplaceId: s.marketplaceId, reference, show: state.show, type: state.type });
  const items = rows.data?.pages.flatMap(p => p.items) ?? [];
  const more = Boolean(rows.hasNextPage);

  // Ticked rows belong to one list: a new marketplace, filter or reference starts empty.
  const listKey = `${s.marketplaceId}|${reference}|${state.show}|${state.type}`;
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  useEffect(() => { setTicked(new Set()); }, [listKey]);
  const toggle = (id: string) => setTicked(t => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allTicked = items.length > 0 && items.every(r => ticked.has(r.productId));
  const tickAll = () => setTicked(allTicked ? new Set() : new Set(items.map(r => r.productId)));

  /** Tab from a price input: the same input on the next (or previous) row. */
  const focusRow = (from: string, dir: 1 | -1) => {
    const at = items.findIndex(r => r.productId === from);
    const to = items[at + dir];
    if (!to) return;
    document.querySelector<HTMLInputElement>(`[${PRICE_INPUT_ATTR}="${CSS.escape(to.productId)}"]`)?.focus();
  };

  const ctx: AdjustContext = { rows: items, more, loadedAll: !more && !rows.isPending, ticked: [...ticked], clearTicked: () => setTicked(new Set()) };

  return (
    <section aria-labelledby="adjust-heading" className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h2 id="adjust-heading" className="text-sm font-bold text-gray-900">Adjust the values to export to {name}</h2>
          <p className="text-[11px] text-gray-500">Availability and price only. Marketplace values are from the {name} file; times are Qatar time.</p>
        </div>
        <Filters show={state.show} type={state.type} onShow={show => set({ show })} onType={type => set({ type })} />
      </div>

      {s.stale && <FileAge summary={s} />}

      {canEdit && bulk?.(ctx)}

      {rows.isPending ? <LoadingState label={`Loading ${name} products…`} rows={5} />
        : rows.isError && !rows.data ? <ErrorState error={rows.error} title="We could not load the products" onRetry={() => void rows.refetch()} />
          : items.length === 0 ? (
            <EmptyState
              title={state.show === 'needs' ? `Nothing needs a change on ${name}` : `No products: ${SHOW_LABELS[state.show].toLowerCase()}`}
              hint={state.show === 'needs' ? 'Every listed product matches the catalogue, or you already adjusted it.' : 'Try another filter.'}
              action={(
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {state.show !== 'all' && <button type="button" onClick={() => set({ show: 'all' })} className="h-9 px-3.5 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50">Show all products</button>}
                  <button type="button" onClick={() => set({ step: 'export' })} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F]">
                    Go to Export <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                  </button>
                </div>
              )}
            />
          ) : (
            <>
              <div className={`md:overflow-x-auto md:border md:border-gray-200 md:rounded-xl ${rows.isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={rows.isFetching}>
                <table className="w-full text-left text-xs" aria-label={`Products on ${name}`}>
                  <thead className="hidden md:table-header-group bg-gray-50 text-gray-600 font-semibold">
                    <tr>
                      {canEdit && (
                        <th scope="col" className="py-2.5 px-3 w-8">
                          <input type="checkbox" checked={allTicked} onChange={tickAll} aria-label="Tick every loaded row" className="accent-[#027864]" />
                        </th>
                      )}
                      <th scope="col" className="py-2.5 px-3">Product</th>
                      <th scope="col" className="py-2.5 px-3">{name} now</th>
                      <th scope="col" className="py-2.5 px-3">Catalogue value</th>
                      <th scope="col" className="py-2.5 px-3">Value to export</th>
                      <th scope="col" className="py-2.5 px-3">State</th>
                    </tr>
                  </thead>
                  <tbody className="block md:table-row-group space-y-3 md:space-y-0 md:divide-y md:divide-gray-100">
                    {items.map(r => (
                      <AdjustRow key={r.productId} row={r} marketplaceId={s.marketplaceId} reference={reference} canEdit={canEdit}
                        ticked={ticked.has(r.productId)} onTick={() => toggle(r.productId)} onTabOut={dir => focusRow(r.productId, dir)} />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-gray-500">
                <span data-testid="loaded-count">{count(items.length)} {more ? 'loaded, more to load' : items.length === 1 ? 'product' : 'products'}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => void rows.refetch()} disabled={rows.isFetching} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-gray-300 bg-white font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    <RefreshCw className="w-3 h-3" aria-hidden /> Refresh the list
                  </button>
                  {more && (
                    <button type="button" onClick={() => void rows.fetchNextPage()} disabled={rows.isFetchingNextPage} className="h-8 px-3 rounded-lg border border-gray-300 bg-white font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                      {rows.isFetchingNextPage ? 'Loading…' : 'Load more'}
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-gray-500">Rows you change stay in this list with their new state until you refresh it.</p>
            </>
          )}
    </section>
  );
};

/** What the bulk actions need from the list. */
export interface AdjustContext { rows: ReconRow[]; more: boolean; loadedAll: boolean; ticked: string[]; clearTicked: () => void }

const Filters: React.FC<{ show: Show; type: ReconRowType; onShow: (s: Show) => void; onType: (t: ReconRowType) => void }> = ({ show, type, onShow, onType }) => (
  <div className="flex flex-wrap items-end gap-3">
    <label className="text-[11px] font-semibold text-gray-600">
      Show
      <select value={show} onChange={e => onShow(e.target.value as Show)} className="mt-1 block h-9 px-2 text-xs border border-gray-300 rounded-lg bg-white">
        {SHOWS.map(s => <option key={s} value={s}>{SHOW_LABELS[s]}</option>)}
      </select>
    </label>
    <label className="text-[11px] font-semibold text-gray-600">
      Differences
      <select value={type} onChange={e => onType(e.target.value as ReconRowType)} className="mt-1 block h-9 px-2 text-xs border border-gray-300 rounded-lg bg-white">
        {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
      </select>
    </label>
  </div>
);

/** On a phone the cells stack into a card, each with its own label. */
const Cell: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className = '' }) => (
  <td className={`block md:table-cell py-1.5 md:py-3 px-3 align-top ${className}`}>
    <span className="md:hidden block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">{label}</span>
    {children}
  </td>
);

const AdjustRow: React.FC<{
  row: ReconRow; marketplaceId: string; reference: StepProps['reference']; canEdit: boolean;
  ticked: boolean; onTick: () => void; onTabOut: (dir: 1 | -1) => void;
}> = ({ row: r, marketplaceId, reference, canEdit, ticked, onTick, onTabOut }) => {
  const { can } = useAuth();
  const item = valuesOf(r);
  const own = ownSide(r, reference);
  const source = readMarketplaceSource(r.marketplaceSource);
  const cataloguePrice = item?.catalogue.price ?? (reference === 'erp' ? r.erpPrice : r.marketplacePrice);
  const catalogueAvailable = item?.catalogue.available ?? own.available;
  return (
    <tr data-testid="adjust-row" data-product={r.productId} className={`block md:table-row rounded-xl border border-gray-200 md:border-0 py-2 md:py-0 ${ticked ? 'bg-[#F2F7F6]' : ''}`}>
      {canEdit && (
        <td className="block md:table-cell px-3 pt-1 md:py-3 align-top">
          <input type="checkbox" checked={ticked} onChange={onTick} aria-label={`Tick ${r.nameEn}`} className="accent-[#027864]" />
        </td>
      )}
      <Cell label="Product">
        {can('products.view')
          ? <Link to={pathFor('product-detail', r.productId)} className="font-semibold text-gray-900 hover:text-[#027864] hover:underline">{r.nameEn}</Link>
          : <span className="font-semibold text-gray-900">{r.nameEn}</span>}
        <div className="font-mono text-[11px] text-gray-500">{r.barcode}</div>
      </Cell>
      <Cell label={`${marketplaceName(marketplaceId)} now`}>
        <div data-testid="mp-now-available"><MarketplaceAvailability value={r.actualAvailable} /></div>
        <div data-testid="mp-now-price" className="font-mono">{r.actualPrice === null ? <span className="font-sans text-gray-500">{NOT_IN_FILE}</span> : `${priceText(r.actualPrice)} QAR`}</div>
        {source && !source.isLatestFile && <div className="text-[11px] text-amber-700">From the file of {qatarDateTime(source.uploadedAt)}</div>}
      </Cell>
      <Cell label="Catalogue value">
        <div data-testid="catalogue-available"><OwnAvailability available={catalogueAvailable} stock={own.stock} /></div>
        <div data-testid="catalogue-price" className="font-mono">{cataloguePrice === null || cataloguePrice === undefined ? '—' : `${priceText(cataloguePrice)} QAR`}</div>
      </Cell>
      <Cell label="Value to export">
        <ExportValueEditor row={r} marketplaceId={marketplaceId} canEdit={canEdit} onTabOut={onTabOut} />
      </Cell>
      <Cell label="State"><ExportStateBadge row={r} /></Cell>
    </tr>
  );
};
