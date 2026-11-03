import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';
import { SETTINGS_KEY, settingsApi, type StoreSettings, type UpdateStoreSettings } from '../../api/settings';
import { qatarDateTime } from '../../lib/format';
import { ErrorState, LoadingState } from '../common/States';
import { PricingSettingsForm } from '../pricing/RealPricingView';
import { PRICING_SETTINGS_KEY, FieldError, inputCls, invalidatePriced } from '../pricing/shared';
import { marketplaceName } from '../recon/shared';
import { NoAccessPage } from '../auth/SystemPages';
import { settingsChanges, settingsDraft } from './form';

export const RealSettingsView: React.FC = () => {
  const { can } = useAuth();
  return can('settings.view') ? <Settings /> : <NoAccessPage />;
};

const Settings: React.FC = () => {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [notice, setNotice] = useState('');
  const q = useQuery({ queryKey: SETTINGS_KEY, queryFn: ({ signal }) => settingsApi.get(signal), retry: false });
  const update = async (body: UpdateStoreSettings) => {
    setNotice('');
    try {
      const next = await settingsApi.update(body);
      qc.setQueryData(SETTINGS_KEY, next);
      qc.setQueryData(PRICING_SETTINGS_KEY, next.pricing);
      void qc.invalidateQueries({ queryKey: ['me'] });
      invalidatePriced(qc);
      const recompute = body.thresholds?.priceTolerance !== undefined || body.thresholds?.stockThreshold !== undefined || body.pricing !== undefined;
      setNotice(recompute ? 'Settings saved. The comparison will recompute and refresh shortly.' : 'Settings saved.');
      return next;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === 'CONFLICT') {
        setNotice('Someone else changed these settings. Loading the newer values; review them and try again.');
        const result = await q.refetch();
        if (result.isError) throw result.error;
      }
      throw e;
    }
  };
  return <div className="p-8 max-w-5xl mx-auto space-y-6">
    <div><h1 className="text-2xl font-bold text-gray-900">Store &amp; System Settings</h1><p className="text-xs text-gray-500 mt-1">Store profile, comparison thresholds and policies. All times are Qatar time (Asia/Qatar).</p></div>
    {!can('settings.edit') && <p role="note">You can view these settings but not change them.</p>}
    {notice && <p role="status" className="p-3 rounded-lg border bg-teal-50 text-sm">{notice}</p>}
    {q.isPending ? <LoadingState label="Loading settings…" rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <>
      <StoreForm key={q.data.revision} settings={q.data} editable={can('settings.edit')} security={can('settings.security')} update={update} />
      <section aria-label="Marketplace pricing" className="space-y-4"><h2 className="text-lg font-bold">Marketplace pricing</h2>
        <PricingSettingsForm key={q.data.revision} settings={q.data.pricing} editable={can('settings.edit')}
          saveSettings={async pricing => (await update({ expectedRevision: q.data.revision, pricing })).pricing} />
      </section>
    </>}
    <Marketplaces />
  </div>;
};

const StoreForm: React.FC<{ settings: StoreSettings; editable: boolean; security: boolean; update: (b: UpdateStoreSettings) => Promise<StoreSettings> }> = ({ settings: s, editable, security, update }) => {
  const [draft, setDraft] = useState(() => settingsDraft(s));
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({ mutationFn: update });
  const parsed = settingsChanges(s, draft, editable, security);
  const server = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const errors = submitted ? parsed.errors : {};
  const fields = [
    ['name', 'Store name', 'text', 'profile.name'],
    ['priceTolerance', 'Price tolerance (QAR)', 'number', 'thresholds.priceTolerance'],
    ['stockThreshold', 'Stock threshold', 'number', 'thresholds.stockThreshold'],
    ['staleDays', 'Data is out of date after (days)', 'number', 'thresholds.staleHours'],
  ] as const;
  return <form aria-label="Store settings" noValidate onSubmit={e => {
    e.preventDefault(); setSubmitted(true);
    if (editable && parsed.dirty && !Object.keys(parsed.errors).length && !save.isPending) save.mutate(parsed.body);
  }} className="bg-white rounded-2xl border border-gray-200 p-5 space-y-5">
    <h2 className="font-bold">Store profile and reconciliation</h2>
    <p className="text-sm">Time zone: {s.timeZone} · Currency: {s.currency}</p>
    {save.isError && <ErrorState error={save.error} onRetry={() => save.reset()} />}
    <fieldset disabled={!editable || save.isPending} className="grid sm:grid-cols-2 gap-4">
      {fields.map(([key, label, type, path]) => <div key={key}><label htmlFor={`settings-${key}`} className="block text-xs font-semibold">{label}</label>
        <input id={`settings-${key}`} type={type} step="any" value={draft[key]} maxLength={key === 'name' ? 100 : undefined}
          onChange={e => setDraft({ ...draft, [key]: e.target.value })} aria-invalid={Boolean(errors[key] || server[path])}
          aria-describedby={`settings-${key}-error`} className={inputCls(errors[key] || server[path])} />
        <FieldError id={`settings-${key}-error`} message={errors[key] || server[path]} />
      </div>)}
    </fieldset>
    <p className="text-xs text-gray-500">Fractions of a day are allowed in whole hours (0.5 days = 12 hours). Range: 1 hour to 365 days.</p>
    <h2 className="font-bold">Security and export policy</h2>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={draft.analystCanExport} disabled={!editable || save.isPending} onChange={e => setDraft({ ...draft, analystCanExport: e.target.checked })} />Allow Analysts to export reports</label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={draft.mfaRequiredForAll} disabled={!editable || !security || save.isPending} onChange={e => setDraft({ ...draft, mfaRequiredForAll: e.target.checked })} />Require two-step verification for everyone</label>
    {!security && <p className="text-xs text-gray-500">Only the Owner can change the two-step verification policy.</p>}
    {editable && <div className="flex justify-end gap-3">
      <button type="button" disabled={!parsed.dirty || save.isPending} onClick={() => { setDraft(settingsDraft(s)); setSubmitted(false); save.reset(); }} className="border rounded-lg px-4 py-2 text-sm">Discard changes</button>
      <button disabled={!parsed.dirty || save.isPending} className="rounded-lg px-4 py-2 bg-[#027864] text-white text-sm disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save settings'}</button>
    </div>}
  </form>;
};

const Marketplaces: React.FC = () => {
  const q = useQuery({ queryKey: ['settings', 'marketplaces'], queryFn: ({ signal }) => settingsApi.marketplaces(signal), retry: false });
  return <section aria-label="Enabled marketplaces" className="bg-white border rounded-2xl p-5 space-y-3">
    <h2 className="font-bold">Enabled marketplaces</h2>
    {q.isPending ? <LoadingState rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data.items.length === 0 ? <p>No marketplaces are enabled.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Marketplace', 'Enabled', 'Has data', 'Last upload (Qatar time)', 'Age'].map(h => <th key={h} className="py-2 pr-4">{h}</th>)}</tr></thead><tbody>
      {q.data.items.map(m => <tr key={m.marketplaceId}><td className="py-2">{marketplaceName(m.marketplaceId)}</td><td>Yes</td><td>{m.hasData ? 'Yes' : 'No'}</td><td>{m.lastUploadAt ? qatarDateTime(m.lastUploadAt) : 'No upload yet'}</td><td>{m.ageHours === null ? 'No data' : `${Number((m.ageHours / 24).toFixed(2))} days`}</td></tr>)}
    </tbody></table></div>}
  </section>;
};
