import React, { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { activityApi, type ActivityFilters, type ActivityGroup, type ActivityItem, type SafeValue } from '../../api/activity';
import { teamApi } from '../../api/team';
import { useAuth } from '../../auth/AuthContext';
import { fromQatarInput, qatarDateTime } from '../../lib/format';
import { realSettingsEnabled } from '../../lib/features';
import { EmptyState, ErrorState, LoadingState } from '../common/States';
import { NoAccessPage } from '../auth/SystemPages';
import { ruleText, inputCls } from '../pricing/shared';

const GROUPS: Record<ActivityGroup, string> = { price: 'Price', stock_uploads: 'Stock and uploads', catalogue: 'Catalogue', team_security: 'Team and security' };
const FIELDS: Record<string, string> = {
  nameAr: 'Arabic name', nameEn: 'English name', sku: 'SKU', brand: 'Brand', size: 'Size', erpCategory: 'ERP category',
  categoryId: 'Category', subcategoryId: 'Subcategory', status: 'Product status', erpPrice: 'ERP price', costPrice: 'Cost price',
  erpStock: 'ERP stock', erpActive: 'ERP active', inLatestErpFile: 'In latest ERP file', rule: 'Price rule', price: 'Price',
  'profile.name': 'Store name', priceTolerance: 'Price tolerance', stockThreshold: 'Stock threshold', staleHours: 'Out of date after (hours)',
  mfaRequiredForAll: 'Require two-step verification', analystCanExport: 'Analysts can export', defaultRule: 'Default price rule',
  rounding: 'Rounding', perMarketplaceEnabled: 'Different price per marketplace', compareReferenceDefault: 'Compare prices with', offerPrice: 'Offer price', role: 'Role',
};
const valueText = (v: SafeValue): string => {
  if (v === null || v === undefined) return 'Not recorded';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v !== 'object') return String(v);
  if (v.mode === 'same') return ruleText({ mode: 'same' });
  if ((v.mode === 'percent' || v.mode === 'amount' || v.mode === 'fixed') && typeof v.value === 'number') return ruleText({ mode: v.mode, value: v.value });
  return 'Details unavailable';
};

/** Read only the safe presentation contract, never raw event payloads. Preserve server ordering. */
export const ActivityRows: React.FC<{ items: ActivityItem[]; history?: boolean }> = ({ items, history }) => <ol className="divide-y divide-gray-100">
  {items.map(item => <li key={item.id} className="py-4 space-y-2">
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500"><time dateTime={item.time}>{qatarDateTime(item.time)} (Qatar time)</time><span>{item.actor.id === null ? 'System' : item.actor.name}</span></div>
    <p className="text-sm font-semibold text-gray-900">{item.summary}</p>
    {history && item.scope === 'tenant' && <p className="text-xs text-amber-800">Store-wide context. This entry does not prove this product changed.</p>}
    {item.beforeAfter.length > 0 && <details><summary className="text-xs font-semibold text-[#027864] cursor-pointer">Before and after</summary>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs mt-2"><thead><tr><th className="py-2 pr-3">Field</th><th className="pr-3">Before</th><th>After</th></tr></thead><tbody>
        {item.beforeAfter.map((change, i) => <tr key={`${change.field}:${i}`}><td className="py-2 pr-3">{FIELDS[change.field] ?? 'Change'}</td><td className="pr-3">{valueText(change.before)}</td><td>{valueText(change.after)}</td></tr>)}
      </tbody></table></div>
    </details>}
  </li>)}
</ol>;

export const ActivityView: React.FC = () => {
  const { can } = useAuth();
  if (!can('activity.view')) return <NoAccessPage />;
  if (!realSettingsEnabled()) return <EmptyState title="Activity is not connected yet" />;
  return <Activity />;
};

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Activity: React.FC = () => {
  const { can } = useAuth();
  const team = useQuery({ queryKey: ['team', 'members'], queryFn: teamApi.members, enabled: can('team.view'), retry: false });
  const [draft, setDraft] = useState({ eventType: '', actorId: '', productId: '', from: '', to: '' });
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [error, setError] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['activity', filters], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => activityApi.list({ ...filters, cursor: pageParam }, signal),
    getNextPageParam: page => page.nextCursor ?? undefined, retry: false,
  });
  const items = q.data?.pages.flatMap(p => p.items) ?? [];
  return <div className="p-8 max-w-5xl mx-auto space-y-5">
    <div><h1 className="text-2xl font-bold">Activity</h1><p className="text-xs text-gray-500 mt-1">Newest first. Dates and times are in Asia/Qatar.</p></div>
    <form aria-label="Activity filters" className="bg-white border rounded-2xl p-5 grid sm:grid-cols-2 gap-4" onSubmit={e => {
      e.preventDefault();
      const actorId = draft.actorId.trim(), productId = draft.productId.trim();
      if (actorId && actorId !== 'system' && !UUID.test(actorId)) { setError('Choose an actor, or enter a user ID or system.'); return; }
      if (productId && !UUID.test(productId)) { setError('Enter a valid product ID.'); return; }
      const from = fromQatarInput(draft.from) ?? undefined, to = fromQatarInput(draft.to) ?? undefined;
      if (from && to && Date.parse(to) < Date.parse(from)) { setError('The end date must be on or after the start date.'); return; }
      setError(''); setFilters({ eventType: draft.eventType as ActivityGroup || undefined, actorId: actorId || undefined, productId: productId || undefined, from, to });
    }}>
      <label className="text-xs font-semibold">Event type group<select aria-label="Event type group" className={inputCls()} value={draft.eventType} onChange={e => setDraft({ ...draft, eventType: e.target.value })}><option value="">All events</option>{Object.entries(GROUPS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      <label className="text-xs font-semibold">Actor<input aria-label="Actor" list="activity-actors" placeholder="All actors" className={inputCls()} value={draft.actorId} onChange={e => setDraft({ ...draft, actorId: e.target.value })} /><datalist id="activity-actors"><option value="system">System</option>{team.data?.map(m => <option key={m.user.id} value={m.user.id}>{m.user.name} ({m.user.email})</option>)}</datalist><span className="text-gray-500 font-normal">Choose a team member, or enter a user ID or system.</span></label>
      <label className="text-xs font-semibold">From (Qatar time)<input aria-label="From (Qatar time)" type="datetime-local" className={inputCls()} value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label>
      <label className="text-xs font-semibold">To (Qatar time)<input aria-label="To (Qatar time)" type="datetime-local" className={inputCls()} value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} /></label>
      <label className="text-xs font-semibold">Product ID<input aria-label="Product ID" className={inputCls()} value={draft.productId} onChange={e => setDraft({ ...draft, productId: e.target.value })} placeholder="All products" /></label>
      <div className="flex gap-3 items-end"><button className="rounded-lg bg-[#027864] text-white px-4 py-2 text-sm">Apply filters</button><button type="button" className="border rounded-lg px-4 py-2 text-sm" onClick={() => { setDraft({ eventType: '', actorId: '', productId: '', from: '', to: '' }); setFilters({}); setError(''); }}>Clear filters</button></div>
      {error && <p role="alert" className="text-red-700 text-sm sm:col-span-2">{error}</p>}
    </form>
    <section aria-label="Activity entries" className="bg-white border rounded-2xl p-5">
      {q.isPending ? <LoadingState label="Loading activity…" rows={5} /> : <>
        {items.length ? <ActivityRows items={items} /> : !q.isError && <EmptyState title="No activity matches these filters" />}
        {q.isError && <ErrorState error={q.error} onRetry={() => void (q.isFetchNextPageError ? q.fetchNextPage() : q.refetch())} />}
        {q.hasNextPage && <button disabled={q.isFetching} onClick={() => void q.fetchNextPage()} className="border rounded-lg px-4 py-2 text-sm disabled:opacity-50">{q.isFetchingNextPage ? 'Loading…' : 'Load more'}</button>}
      </>}
    </section>
  </div>;
};

export const ProductHistory: React.FC<{ productId: string }> = ({ productId }) => {
  const { can } = useAuth();
  return can('activity.view') && can('products.view') && realSettingsEnabled() ? <History key={productId} productId={productId} /> : null;
};
const History: React.FC<{ productId: string }> = ({ productId }) => {
  const [showStoreWide, setShowStoreWide] = useState(false);
  const q = useInfiniteQuery({
    queryKey: ['product-history', productId], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => activityApi.history(productId, { cursor: pageParam }, signal),
    getNextPageParam: page => page.nextCursor ?? undefined, retry: false,
  });
  const items = (q.data?.pages.flatMap(p => p.items) ?? []).filter(item => showStoreWide || item.scope !== 'tenant');
  return <section aria-label="History" className="bg-white border rounded-2xl p-5 space-y-3">
    <h2 className="font-bold">History</h2>
    {q.data && <p role="note" className="text-xs text-gray-600">{q.data.pages[0].coverageNotice}</p>}
    <label className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" checked={showStoreWide} onChange={e => setShowStoreWide(e.target.checked)} />Show store-wide upload entries</label>
    {q.isPending ? <LoadingState label="Loading history…" rows={3} /> : <>
      {items.length ? <ActivityRows items={items} history /> : !q.isError && <EmptyState title="No changes recorded for this product yet" />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void (q.isFetchNextPageError ? q.fetchNextPage() : q.refetch())} />}
      {q.hasNextPage && <button disabled={q.isFetching} onClick={() => void q.fetchNextPage()} className="border rounded-lg px-4 py-2 text-sm">{q.isFetchingNextPage ? 'Loading…' : 'Load more'}</button>}
    </>}
  </section>;
};
