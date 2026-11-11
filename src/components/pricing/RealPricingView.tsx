import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';
import {
  ROUNDING_OPTIONS, pricingApi,
  type CategoryRule, type CompareReferenceDefault, type PricingSettings, type RoundingOption, type UpdatePricingSettings,
} from '../../api/pricing';
import { qatarDateTime } from '../../lib/format';
import { marketplaceName } from '../recon/shared';
import { useCategoryTree } from '../catalogue/shared';
import { ConfirmDialog } from '../uploads/shared';
import { EmptyState, ErrorState, LoadingState } from '../common/States';
import { AdoptPricesWizard } from './AdoptPricesWizard';
import {
  CATEGORY_RULES_KEY, FieldError, PRICING_SETTINGS_KEY, ROUNDING_LABELS, RuleFields, draftOf, fieldErrors, inputCls,
  invalidatePriced, pricingErrorText, ruleFromDraft, ruleText, type RuleDraft,
} from './shared';

/** PRC-001 on /api/pricing: default rule, rounding, per-marketplace switch, compare-against default and category rules. */
export const RealPricingView: React.FC = () => {
  const { can } = useAuth();
  const editable = can('pricing.edit');
  const [adopting, setAdopting] = useState(false);
  const settings = useQuery({ queryKey: PRICING_SETTINGS_KEY, queryFn: ({ signal }) => pricingApi.settings(signal), retry: false });

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Pricing</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            The price each product should have on the marketplaces. The first rule that applies wins: offer, product rule,
            subcategory rule, category rule, marketplace rule, then the default rule.
          </p>
        </div>
        {editable && (
          <button onClick={() => setAdopting(true)} className="inline-flex items-center gap-2 h-9 px-3.5 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shrink-0">
            <Wand2 className="w-3.5 h-3.5" aria-hidden /> Adopt current marketplace prices
          </button>
        )}
      </div>

      {!editable && (
        <p role="note" className="px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-xs text-gray-600">You can view the pricing but not change it.</p>
      )}

      {settings.isPending ? (
        <LoadingState label="Loading pricing settings…" rows={5} />
      ) : settings.isError ? (
        <div className="bg-white border border-gray-200 rounded-2xl">
          <ErrorState error={settings.error} title="We could not load the pricing settings" onRetry={() => void settings.refetch()} />
        </div>
      ) : (
        // Remounted when the server copy changes, so a save or reload replaces the draft.
        <PricingSettingsForm key={settings.data.updatedAt ?? 'never'} settings={settings.data} editable={editable} />
      )}

      <CategoryRules editable={editable} />

      {adopting && <AdoptPricesWizard onClose={() => setAdopting(false)} />}
    </div>
  );
};

export const PricingSettingsForm: React.FC<{
  settings: PricingSettings; editable: boolean;
  saveSettings?: (body: UpdatePricingSettings) => Promise<PricingSettings>;
}> = ({ settings: s, editable, saveSettings = pricingApi.updateSettings }) => {
  const { showToast } = useApp();
  const qc = useQueryClient();
  const [rule, setRule] = useState<RuleDraft>(draftOf(s.defaultRule));
  const [rounding, setRounding] = useState<RoundingOption>(s.rounding);
  const [perMarketplace, setPerMarketplace] = useState(s.perMarketplaceEnabled);
  const [compare, setCompare] = useState<CompareReferenceDefault>(s.compareReferenceDefault);
  const [localError, setLocalError] = useState<string>();

  const parsed = ruleFromDraft(rule);
  const ruleDirty = rule.mode !== s.defaultRule.mode || rule.value !== draftOf(s.defaultRule).value;
  const changes: UpdatePricingSettings = {};
  if (ruleDirty && parsed.rule && JSON.stringify(parsed.rule) !== JSON.stringify(s.defaultRule)) changes.defaultRule = parsed.rule;
  if (rounding !== s.rounding) changes.rounding = rounding;
  if (perMarketplace !== s.perMarketplaceEnabled) changes.perMarketplaceEnabled = perMarketplace;
  if (compare !== s.compareReferenceDefault) changes.compareReferenceDefault = compare;
  const dirty = ruleDirty || Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: saveSettings,
    onSuccess: next => {
      qc.setQueryData(PRICING_SETTINGS_KEY, next);
      invalidatePriced(qc);
      showToast('Pricing saved. The comparison will refresh shortly.', 'success');
    },
  });
  const errors = fieldErrors(save.error, ['value', 'mode'], 'defaultRule.');
  const other = fieldErrors(save.error, ['rounding', 'perMarketplaceEnabled', 'compareReferenceDefault']);
  const screenError = save.error instanceof ApiError && (save.error.status === 0 || save.error.status >= 500 || save.error.status === 403 || save.error.status === 404);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editable || !dirty || save.isPending) return;
    if (ruleDirty && !parsed.rule) { setLocalError(parsed.error); return; }
    setLocalError(undefined);
    if (Object.keys(changes).length) save.mutate(changes);
  };
  const reset = () => {
    setRule(draftOf(s.defaultRule)); setRounding(s.rounding); setPerMarketplace(s.perMarketplaceEnabled); setCompare(s.compareReferenceDefault);
    setLocalError(undefined); save.reset();
  };

  return (
    <form aria-label="Pricing settings" onSubmit={submit} className="space-y-6">
      {screenError ? <ErrorState error={save.error} onRetry={() => save.reset()} /> : errors.general && !Object.keys(other.fields).length && <p role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">{errors.general}</p>}

      <section aria-label="Default marketplace price" className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Default marketplace price</h2>
          <p className="text-xs text-gray-500">Used for every product that no offer, product, subcategory, category or marketplace rule covers.</p>
        </div>
        <RuleFields id="default-rule" draft={rule} onChange={d => { setRule(d); setLocalError(undefined); }} disabled={!editable}
          errors={{ mode: errors.fields.mode, value: localError ?? errors.fields.value }} modeLabel="Default rule" />
        <div className="sm:w-1/2 sm:pr-1.5">
          <label htmlFor="pricing-rounding" className="block text-xs font-semibold text-gray-700">Rounding</label>
          <select id="pricing-rounding" value={rounding} disabled={!editable} onChange={e => setRounding(e.target.value as RoundingOption)}
            aria-describedby="pricing-rounding-hint" className={`${inputCls(other.fields.rounding)} mt-1`}>
            {ROUNDING_OPTIONS.map(r => <option key={r} value={r}>{ROUNDING_LABELS[r]}</option>)}
          </select>
          <p id="pricing-rounding-hint" className="mt-1 text-[11px] text-gray-500">Applies to calculated prices (percent and amount rules). Fixed prices and offers are used exactly as entered.</p>
          <FieldError id="pricing-rounding-err" message={other.fields.rounding} />
        </div>
      </section>

      <section aria-label="Compare prices with" className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Compare prices with</h2>
          <p className="text-xs text-gray-500">The dashboard, reports and generated files always use My pricing. This default only applies when someone opens Advanced on those screens.</p>
        </div>
        <fieldset className="flex flex-wrap gap-4 text-sm" disabled={!editable}>
          <legend className="sr-only">Store default for compare prices with</legend>
          {([['marketplace', 'My pricing'], ['erp', 'ERP price (advanced)']] as const).map(([v, label]) => (
            <label key={v} className="inline-flex items-center gap-2">
              <input type="radio" name="compare-default" value={v} checked={compare === v} onChange={() => setCompare(v)} className="accent-[#027864]" />
              {label}
            </label>
          ))}
        </fieldset>
        <FieldError id="pricing-compare-err" message={other.fields.compareReferenceDefault} />
      </section>

      <section aria-label="Different price per marketplace" className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-3">
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-sm font-bold text-gray-900">Different price per marketplace</span>
            <span className="block text-xs text-gray-500">Off by default: one marketplace price on every marketplace.</span>
          </span>
          <input type="checkbox" checked={perMarketplace} disabled={!editable} onChange={e => setPerMarketplace(e.target.checked)} className="mt-1 w-4 h-4 accent-[#027864]" />
        </label>
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 text-amber-900 border border-amber-200 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600 mt-0.5" aria-hidden />
          <span><b>Price parity:</b> many marketplace contracts require the same price everywhere. Check your contracts before using different prices.</span>
        </div>
        {s.perMarketplaceEnabled && (
          s.marketplaceRules.length === 0
            ? <p className="text-xs text-gray-500">No marketplace has its own rule yet, so every marketplace uses the rules above.</p>
            : (
              <ul className="text-xs text-gray-700 space-y-1" aria-label="Marketplace rules">
                {s.marketplaceRules.map(r => (
                  <li key={r.marketplaceId}><b>{marketplaceName(r.marketplaceId)}:</b> {ruleText(r)} · {ROUNDING_LABELS[r.rounding]}</li>
                ))}
              </ul>
            )
        )}
        <FieldError id="pricing-permp-err" message={other.fields.perMarketplaceEnabled} />
      </section>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-gray-500">{s.updatedAt ? `Last changed ${qatarDateTime(s.updatedAt)} (Qatar time)` : 'Never changed: these are the starting settings.'}</p>
        {editable && (
          <div className="flex gap-2">
            <button type="button" onClick={reset} disabled={!dirty || save.isPending} className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">Discard changes</button>
            <button type="submit" disabled={!dirty || save.isPending} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
              {save.isPending ? 'Saving…' : 'Save pricing'}
            </button>
          </div>
        )}
      </div>
    </form>
  );
};

// ───────── Category and subcategory rules ─────────

const CategoryRules: React.FC<{ editable: boolean }> = ({ editable }) => {
  const { showToast } = useApp();
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: CATEGORY_RULES_KEY, queryFn: ({ signal }) => pricingApi.categoryRules(signal), retry: false });
  const [editing, setEditing] = useState<CategoryRule | 'new' | null>(null);
  const [removing, setRemoving] = useState<CategoryRule | null>(null);
  const remove = useMutation({
    mutationFn: (r: CategoryRule) => pricingApi.deleteCategoryRule(r.categoryId, r.subcategoryId),
    onSuccess: () => {
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: CATEGORY_RULES_KEY });
      invalidatePriced(qc);
      showToast('Category rule removed', 'success');
    },
  });
  const label = (r: CategoryRule) => `${r.category?.nameEn ?? 'Unknown category'}${r.subcategoryId ? ` › ${r.subcategory?.nameEn ?? 'Unknown subcategory'}` : ''}`;

  return (
    <section aria-label="Category rules" className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Category rules</h2>
          <p className="text-xs text-gray-500">A subcategory rule wins over its category&apos;s rule; both win over the default.</p>
        </div>
        {editable && editing === null && (
          <button onClick={() => setEditing('new')} className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg shrink-0">
            <Plus className="w-3.5 h-3.5" aria-hidden /> Add category rule
          </button>
        )}
      </div>

      {editing !== null && (
        <CategoryRuleForm key={editing === 'new' ? 'new' : `${editing.categoryId}:${editing.subcategoryId}`} existing={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
      )}

      {rules.isPending ? (
        <LoadingState label="Loading category rules…" rows={3} />
      ) : rules.isError ? (
        <ErrorState error={rules.error} title="We could not load the category rules" onRetry={() => void rules.refetch()} />
      ) : rules.data.length === 0 ? (
        <EmptyState title="No category rules yet" hint="Products use the default rule unless an offer, product rule or category rule says otherwise." />
      ) : (
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider">
            <tr>
              <th className="px-5 py-2.5">Category</th>
              <th className="px-5 py-2.5">Rule</th>
              <th className="px-5 py-2.5">Last changed</th>
              {editable && <th className="px-5 py-2.5"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-700">
            {rules.data.map(r => (
              <tr key={`${r.categoryId}:${r.subcategoryId ?? ''}`}>
                <td className="px-5 py-2.5 font-semibold text-gray-900">{label(r)}{!r.subcategoryId && <span className="ml-1 font-normal text-gray-500">(whole category)</span>}</td>
                <td className="px-5 py-2.5">{ruleText(r)}</td>
                <td className="px-5 py-2.5 whitespace-nowrap text-gray-500">{qatarDateTime(r.updatedAt)}</td>
                {editable && (
                  <td className="px-5 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(r)} aria-label={`Change rule for ${label(r)}`} className="inline-flex items-center gap-1 px-2 py-1 font-semibold text-[#027864] hover:underline">
                      <Pencil className="w-3 h-3" aria-hidden /> Change
                    </button>
                    <button onClick={() => { remove.reset(); setRemoving(r); }} aria-label={`Remove rule for ${label(r)}`} className="inline-flex items-center gap-1 px-2 py-1 font-semibold text-red-700 hover:underline">
                      <Trash2 className="w-3 h-3" aria-hidden /> Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {removing && (
        <ConfirmDialog title="Remove category rule" confirmLabel="Remove rule" busy={remove.isPending} onClose={() => setRemoving(null)} onConfirm={() => remove.mutate(removing)}>
          <p>Remove the rule for <b>{label(removing)}</b> ({ruleText(removing)})? Its products fall back to the next rule in the order.</p>
          {remove.isError && <p role="alert" className="mt-2 text-xs text-red-700">{pricingErrorText(remove.error)}</p>}
        </ConfirmDialog>
      )}
    </section>
  );
};

const CategoryRuleForm: React.FC<{ existing?: CategoryRule; onDone: () => void }> = ({ existing, onDone }) => {
  const { showToast } = useApp();
  const qc = useQueryClient();
  const tree = useCategoryTree();
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? '');
  const [subcategoryId, setSubcategoryId] = useState(existing?.subcategoryId ?? '');
  const [draft, setDraft] = useState<RuleDraft>(draftOf(existing));
  const [local, setLocal] = useState<{ categoryId?: string; value?: string }>({});
  const subs = tree.data?.find(c => c.id === categoryId)?.children ?? [];

  const save = useMutation({
    mutationFn: () => {
      const { rule } = ruleFromDraft(draft);
      return pricingApi.setCategoryRule({ ...rule!, categoryId, subcategoryId: subcategoryId || null });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CATEGORY_RULES_KEY });
      invalidatePriced(qc);
      showToast(existing ? 'Category rule changed' : 'Category rule added', 'success');
      onDone();
    },
  });
  const errors = fieldErrors(save.error, ['categoryId', 'subcategoryId', 'mode', 'value']);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = ruleFromDraft(draft);
    const next = { categoryId: categoryId ? undefined : 'Choose a category', value: parsed.error };
    setLocal(next);
    if (next.categoryId || next.value || save.isPending) return;
    save.mutate();
  };

  return (
    <form aria-label={existing ? 'Change category rule' : 'Add category rule'} onSubmit={submit} className="px-5 py-4 border-b border-gray-100 bg-[#F8FBFA] space-y-3">
      {errors.general && <p role="alert" className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">{errors.general}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="cr-category" className="block text-xs font-semibold text-gray-700">Category</label>
          <select id="cr-category" value={categoryId} disabled={Boolean(existing)} onChange={e => { setCategoryId(e.target.value); setSubcategoryId(''); }}
            aria-invalid={Boolean(local.categoryId ?? errors.fields.categoryId)} aria-describedby={local.categoryId ?? errors.fields.categoryId ? 'cr-category-err' : undefined} className={`${inputCls(local.categoryId ?? errors.fields.categoryId)} mt-1`}>
            <option value="">Choose a category</option>
            {existing && !tree.data && <option value={existing.categoryId}>{existing.category?.nameEn ?? existing.categoryId}</option>}
            {(tree.data ?? []).map(c => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
          </select>
          <FieldError id="cr-category-err" message={local.categoryId ?? errors.fields.categoryId} />
        </div>
        <div>
          <label htmlFor="cr-subcategory" className="block text-xs font-semibold text-gray-700">Subcategory</label>
          <select id="cr-subcategory" value={subcategoryId} disabled={Boolean(existing) || !categoryId} onChange={e => setSubcategoryId(e.target.value)}
            aria-invalid={Boolean(errors.fields.subcategoryId)} aria-describedby={errors.fields.subcategoryId ? 'cr-subcategory-err' : undefined} className={`${inputCls(errors.fields.subcategoryId)} mt-1`}>
            <option value="">Whole category</option>
            {existing?.subcategoryId && !tree.data && <option value={existing.subcategoryId}>{existing.subcategory?.nameEn ?? existing.subcategoryId}</option>}
            {subs.map(s => <option key={s.id} value={s.id}>{s.nameEn}</option>)}
          </select>
          <FieldError id="cr-subcategory-err" message={errors.fields.subcategoryId} />
        </div>
      </div>
      {tree.isError && <p className="text-[11px] text-red-700">We could not load the category list. <button type="button" className="underline" onClick={() => void tree.refetch()}>Try again</button></p>}
      <RuleFields id="cr-rule" draft={draft} onChange={d => { setDraft(d); setLocal(l => ({ ...l, value: undefined })); }}
        errors={{ mode: errors.fields.mode, value: local.value ?? errors.fields.value }} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="h-9 px-4 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>
        <button type="submit" disabled={save.isPending} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
          {save.isPending ? 'Saving…' : existing ? 'Save rule' : 'Add rule'}
        </button>
      </div>
    </form>
  );
};
