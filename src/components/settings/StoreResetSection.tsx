import React, { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { STORE_RESET_KEY, storeResetApi, type StoreResetCounts } from '../../api/storeReset';
import { ErrorState, LoadingState } from '../common/States';

const LABELS: [keyof StoreResetCounts, string][] = [
  ['products', 'Products'], ['categories', 'Categories'], ['uploads', 'Uploaded files'], ['generatedFiles', 'Generated marketplace files'],
  ['marketplaceListings', 'Marketplace listings'], ['comparisonRows', 'Comparison results'], ['priceRules', 'Price rules and category mappings'],
  ['offers', 'Offers'], ['exportValues', 'Export values'], ['stockEdits', 'Stock edits'], ['notifications', 'Notifications'],
  ['activityEntries', 'Activity entries (catalogue, pricing, uploads)'],
];
const KEPT = ['The store, its name and address', 'Team members, roles, invitations and sign-in settings', 'Store, pricing and security settings',
  'Enabled marketplaces and saved column layouts', 'Team and security activity'];
const n = (v: number) => v.toLocaleString('en-US');

/**
 * Owner only (ADR 022): delete all of the store's business data and start again from an empty catalogue. The Owner
 * reviews the counts, types the store's address name to confirm and enters a fresh code ("Confirm it's you").
 */
export const StoreResetSection: React.FC = () => {
  const [open, setOpen] = useState(false);
  return <section aria-labelledby="store-reset-title" className="bg-white border border-red-200 rounded-2xl p-5 space-y-3">
    <div className="flex items-start gap-2">
      <AlertTriangle className="w-5 h-5 mt-0.5 text-red-600" aria-hidden="true" />
      <div>
        <h2 id="store-reset-title" className="font-bold">Reset store data</h2>
        <p className="text-sm text-gray-600">Delete every product, upload, comparison and generated file and start again from an empty catalogue. Your team and settings stay. This cannot be undone.</p>
      </div>
    </div>
    {open ? <ResetPanel onClose={() => setOpen(false)} />
      : <button type="button" onClick={() => setOpen(true)} className="border border-red-300 text-red-700 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-red-50">Review what will be deleted</button>}
  </section>;
};

const ResetPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const qc = useQueryClient();
  const [typed, setTyped] = useState('');
  const q = useQuery({ queryKey: STORE_RESET_KEY, queryFn: ({ signal }) => storeResetApi.preview(signal), retry: false, staleTime: 0 });
  const reset = useMutation({
    mutationFn: () => storeResetApi.reset(typed.trim()),
    onSuccess: () => { setTyped(''); void qc.invalidateQueries(); },
  });

  if (reset.isSuccess) {
    const d = reset.data.deleted;
    return <div role="status" className="p-3 rounded-lg border bg-teal-50 text-sm space-y-1">
      <p className="font-semibold">The store's data was reset.</p>
      <p>{n(d.products)} products, {n(d.uploads)} uploads and {n(d.generatedFiles)} generated files were deleted ({n(d.totalRows)} records in all).</p>
      <p>{reset.data.storageCleanup === 'queued' ? 'The stored files are removed in the background within a few minutes.' : 'The stored files could not be queued for removal now; they will be cleaned up by an administrator.'} Start again by uploading your ERP file.</p>
      <button type="button" onClick={onClose} className="mt-1 text-xs font-semibold text-[#027864] hover:underline">Close</button>
    </div>;
  }
  if (q.isPending) return <LoadingState label="Counting the store's data…" rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const p = q.data;
  const rows = LABELS.filter(([k]) => p.deletes[k] > 0);
  const matches = typed.trim().toLowerCase() === p.store.slug;
  const fieldError = reset.error instanceof ApiError ? reset.error.fieldErrors.confirmSlug : undefined;
  const blocked = Boolean(p.blockedReason);
  return <div className="space-y-4">
    <div className="grid sm:grid-cols-2 gap-4">
      <div>
        <h3 className="text-sm font-semibold text-red-700">Will be deleted</h3>
        {rows.length === 0 ? <p className="text-sm text-gray-600 mt-1">The store has no business data yet.</p>
          : <ul className="mt-1 text-sm space-y-0.5">{rows.map(([k, label]) => <li key={k} className="flex justify-between gap-3"><span>{label}</span><span className="tabular-nums font-semibold">{n(p.deletes[k])}</span></li>)}</ul>}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-gray-700">Will stay</h3>
        <ul className="mt-1 text-sm text-gray-600 list-disc pl-4 space-y-0.5">{KEPT.map(k => <li key={k}>{k}</li>)}</ul>
      </div>
    </div>
    {blocked && <p role="alert" className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm">{p.blockedReason} <button type="button" onClick={() => void q.refetch()} className="font-semibold underline">Check again</button></p>}
    <form noValidate onSubmit={e => { e.preventDefault(); if (matches && !blocked && !reset.isPending) reset.mutate(); }} className="space-y-3">
      <div>
        <label htmlFor="store-reset-confirm" className="block text-xs font-semibold">Type <span className="font-mono">{p.store.slug}</span> to confirm</label>
        <input id="store-reset-confirm" value={typed} onChange={e => { setTyped(e.target.value); if (reset.isError) reset.reset(); }} autoComplete="off" spellCheck={false}
          disabled={blocked || reset.isPending} aria-invalid={Boolean(fieldError)} aria-describedby="store-reset-confirm-error"
          className="mt-1 w-full sm:w-80 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono" />
        {fieldError && <p id="store-reset-confirm-error" className="text-xs text-red-600 mt-1">{fieldError}</p>}
      </div>
      {reset.isError && !fieldError && <ErrorState error={reset.error} onRetry={() => reset.reset()} title="The store was not reset" />}
      <p className="text-xs text-gray-500">You will be asked for a fresh code. Large stores can take a minute.</p>
      <div className="flex gap-3">
        <button type="submit" disabled={!matches || blocked || reset.isPending} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 bg-red-600 text-white text-sm font-semibold disabled:opacity-50">
          {reset.isPending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}{reset.isPending ? 'Resetting…' : 'Reset store data'}
        </button>
        <button type="button" onClick={onClose} disabled={reset.isPending} className="border rounded-lg px-4 py-2 text-sm">Cancel</button>
      </div>
    </form>
  </div>;
};
