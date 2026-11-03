import React from 'react';
import type { QueryClient } from '@tanstack/react-query';
import {
  CalendarClock, CalendarX, CheckCircle2, CircleSlash, Folder, FolderTree, Layers, MinusCircle, Package, Settings2, Store, Tag,
} from 'lucide-react';
import { ApiError } from '../../api/client';
import { invalidateOnboarding } from '../onboarding/shared';
import type { ChainStatus, OfferState, PriceChainStep, PriceRule, PriceSource, RoundingOption, RuleMode } from '../../api/pricing';
import { money2, qatarDateTime } from '../../lib/format';

export const PRICING_SETTINGS_KEY = ['pricing', 'settings'] as const;
export const CATEGORY_RULES_KEY = ['pricing', 'category-rules'] as const;

/** Everything that depends on prices: product lists and details, and the reconciliation (recomputed by the backend). */
export function invalidatePriced(qc: QueryClient) {
  invalidateOnboarding(qc);
  void qc.invalidateQueries({ queryKey: ['products'] });
  void qc.invalidateQueries({ queryKey: ['recon', 'summary'] });
  void qc.invalidateQueries({ queryKey: ['recon', 'rows'] });
  void qc.invalidateQueries({ queryKey: ['activity'] });
  void qc.invalidateQueries({ queryKey: ['product-history'] });
}

type IconType = React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

// ───────── Labels ─────────

export const MODE_LABELS: Record<RuleMode, string> = {
  percent: 'Percent of ERP price',
  amount: 'ERP price plus an amount',
  fixed: 'Fixed price',
  same: 'Same as ERP price',
};
export const VALUE_LABELS: Record<Exclude<RuleMode, 'same'>, string> = {
  percent: 'Percent (%)',
  amount: 'Amount (QAR)',
  fixed: 'Price (QAR)',
};
export const ROUNDING_LABELS: Record<RoundingOption, string> = {
  exact: 'No rounding (2 decimals)',
  '0.05': 'Round to 0.05',
  '0.25': 'Round to 0.25',
  '0.50': 'Round to 0.50',
};

export const SOURCE_META: Record<PriceSource, { label: string; Icon: IconType; tone: string }> = {
  offer: { label: 'Offer', Icon: Tag, tone: 'bg-purple-50 text-purple-800 border-purple-200' },
  product: { label: 'Product rule', Icon: Package, tone: 'bg-blue-50 text-blue-800 border-blue-200' },
  subcategory: { label: 'Subcategory rule', Icon: FolderTree, tone: 'bg-teal-50 text-teal-800 border-teal-200' },
  category: { label: 'Category rule', Icon: Folder, tone: 'bg-teal-50 text-teal-800 border-teal-200' },
  marketplace: { label: 'Marketplace rule', Icon: Store, tone: 'bg-amber-50 text-amber-900 border-amber-200' },
  default: { label: 'Default rule', Icon: Settings2, tone: 'bg-gray-100 text-gray-700 border-gray-300' },
};

/** Where a marketplace price came from, in words with an icon (never colour alone). */
export const PriceSourceChip: React.FC<{ source: PriceSource }> = ({ source }) => {
  const m = SOURCE_META[source] ?? { label: source, Icon: Layers, tone: 'bg-gray-100 text-gray-700 border-gray-300' };
  return (
    <span data-testid="price-source" className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${m.tone}`}>
      <m.Icon className="w-3 h-3" aria-hidden />
      {m.label}
    </span>
  );
};

export const CHAIN_STATUS_META: Record<ChainStatus, { label: string; Icon: IconType; tone: string }> = {
  applied: { label: 'Applied', Icon: CheckCircle2, tone: 'text-[#027864]' },
  overridden: { label: 'Overridden', Icon: Layers, tone: 'text-gray-700' },
  not_set: { label: 'Not set', Icon: MinusCircle, tone: 'text-gray-500' },
  expired: { label: 'Expired', Icon: CalendarX, tone: 'text-gray-500' },
  scheduled: { label: 'Scheduled', Icon: CalendarClock, tone: 'text-blue-700' },
  disabled: { label: 'Off', Icon: CircleSlash, tone: 'text-gray-500' },
};
export const ChainStatusLabel: React.FC<{ status: ChainStatus }> = ({ status }) => {
  const m = CHAIN_STATUS_META[status];
  return <span data-testid="chain-status" className={`inline-flex items-center gap-1 font-semibold ${m.tone}`}><m.Icon className="w-3.5 h-3.5" aria-hidden />{m.label}</span>;
};

export const OFFER_STATE_META: Record<OfferState, { label: string; Icon: IconType; tone: string }> = {
  valid: { label: 'Running now', Icon: CheckCircle2, tone: 'text-[#027864]' },
  scheduled: { label: 'Scheduled', Icon: CalendarClock, tone: 'text-blue-700' },
  expired: { label: 'Ended', Icon: CalendarX, tone: 'text-gray-500' },
};

const signed = (n: number, digits: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;
/** "+15 % of ERP price", "ERP price +2.00 QAR", "Fixed 12.50 QAR", "Same as ERP price". */
export function ruleText(rule: PriceRule | { mode: RuleMode; value?: number }): string {
  const v = 'value' in rule && typeof rule.value === 'number' ? rule.value : 0;
  switch (rule.mode) {
    case 'percent': return `${signed(v, Number.isInteger(v) ? 0 : Math.min(3, String(v).split('.')[1]?.length ?? 0))} % of ERP price`;
    case 'amount': return `ERP price ${signed(v, 2)} QAR`;
    case 'fixed': return `Fixed ${money2(v)} QAR`;
    default: return 'Same as ERP price';
  }
}

// ───────── Rule form fields ─────────

export interface RuleDraft { mode: RuleMode; value: string }
export const draftOf = (r: PriceRule | { mode: RuleMode; value?: number } | null | undefined): RuleDraft =>
  r ? { mode: r.mode, value: 'value' in r && typeof r.value === 'number' ? String(r.value) : '' } : { mode: 'same', value: '' };

/** Mirrors the API range and DECIMAL(12,3) validation; same never includes a value property. */
export function ruleFromDraft(d: RuleDraft): { rule?: PriceRule; error?: string } {
  if (d.mode === 'same') return { rule: { mode: 'same' } };
  const text = d.value.trim();
  if (!text) return { error: 'Enter a value' };
  const n = Number(text);
  if (!Number.isFinite(n)) return { error: 'Enter a number' };
  if (Math.abs(n * 1000 - Math.round(n * 1000)) >= 1e-6) return { error: 'Use at most 3 decimal places' };
  if (d.mode === 'percent' && (n < -90 || n > 1000)) return { error: 'Enter a percent from -90 to 1000' };
  if (d.mode === 'amount' && (n < -100000 || n > 100000)) return { error: 'Enter an amount from -100000 to 100000' };
  if (d.mode === 'fixed' && (n <= 0 || n >= 1000000000)) return { error: 'Enter a price greater than 0 and less than 1000000000' };
  return { rule: { mode: d.mode, value: n } };
}

export const FieldError: React.FC<{ id: string; message?: string }> = ({ id, message }) =>
  message ? <p id={id} role="alert" className="mt-1 text-[11px] text-red-700">{message}</p> : null;

export const inputCls = (error?: string) =>
  `w-full h-9 px-3 text-sm border rounded-lg bg-white disabled:bg-gray-50 disabled:text-gray-600 ${error ? 'border-red-400' : 'border-gray-300'}`;

/** Mode + value, with the API's field messages under each field. */
export const RuleFields: React.FC<{
  id: string; draft: RuleDraft; onChange: (d: RuleDraft) => void; disabled?: boolean;
  errors?: { mode?: string; value?: string }; modeLabel?: string;
}> = ({ id, draft, onChange, disabled, errors = {}, modeLabel = 'Rule' }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <div>
      <label htmlFor={`${id}-mode`} className="block text-xs font-semibold text-gray-700">{modeLabel}</label>
      <select
        id={`${id}-mode`} value={draft.mode} disabled={disabled}
        onChange={e => onChange({ ...draft, mode: e.target.value as RuleMode })}
        aria-invalid={Boolean(errors.mode)} aria-describedby={errors.mode ? `${id}-mode-err` : undefined}
        className={`${inputCls(errors.mode)} mt-1`}
      >
        {(Object.keys(MODE_LABELS) as RuleMode[]).map(m => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
      </select>
      <FieldError id={`${id}-mode-err`} message={errors.mode} />
    </div>
    {draft.mode !== 'same' && (
      <div>
        <label htmlFor={`${id}-value`} className="block text-xs font-semibold text-gray-700">{VALUE_LABELS[draft.mode]}</label>
        <input
          id={`${id}-value`} type="number" inputMode="decimal" step="any" value={draft.value} disabled={disabled}
          onChange={e => onChange({ ...draft, value: e.target.value })}
          aria-invalid={Boolean(errors.value)} aria-describedby={errors.value ? `${id}-value-err` : undefined}
          className={`${inputCls(errors.value)} mt-1 font-mono`}
        />
        <FieldError id={`${id}-value-err`} message={errors.value} />
      </div>
    )}
  </div>
);

// ───────── Rule chain ─────────

function stepDetail(s: PriceChainStep): string {
  if (s.offer) {
    const from = s.offer.validFrom ? `from ${qatarDateTime(s.offer.validFrom)}` : 'no start date';
    const until = s.offer.validUntil ? `until ${qatarDateTime(s.offer.validUntil)}` : 'no end date';
    return `Offer ${money2(s.offer.price)} QAR, ${from}, ${until}`;
  }
  if (s.rule) return `${ruleText(s.rule)}${s.rounding ? `, ${ROUNDING_LABELS[s.rounding].toLowerCase()}` : ''}`;
  if (s.status === 'disabled') return 'Different price per marketplace is off';
  return '—';
}

/** Every step of the rule order with its status, price and details; the applied one is highlighted. */
export const Chain: React.FC<{ chain: PriceChainStep[]; label?: string }> = ({ chain, label = 'Price rule chain' }) => (
  <div role="region" aria-label={label} className="overflow-x-auto">
    <table className="w-full text-left text-xs">
      <thead className="bg-[#F2F7F6] text-gray-500 uppercase font-semibold text-[10px] tracking-wider">
        <tr>
          <th className="px-5 py-2.5">Order</th>
          <th className="px-5 py-2.5">Step</th>
          <th className="px-5 py-2.5">Status</th>
          <th className="px-5 py-2.5 text-right">Price (QAR)</th>
          <th className="px-5 py-2.5">Details</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 text-gray-700">
        {chain.map((s, i) => (
          <tr key={s.source} data-testid="chain-step" data-status={s.status} className={s.status === 'applied' ? 'bg-[#F2F7F6]' : ''}>
            <td className="px-5 py-2.5 text-gray-500">{i + 1}</td>
            <td className="px-5 py-2.5 font-semibold text-gray-900">{SOURCE_META[s.source]?.label ?? s.source}</td>
            <td className="px-5 py-2.5"><ChainStatusLabel status={s.status} /></td>
            <td className="px-5 py-2.5 text-right font-mono">{s.price === undefined ? '—' : money2(s.price)}</td>
            <td className="px-5 py-2.5">{stepDetail(s)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ───────── Errors ─────────

export function pricingErrorText(e: unknown): string {
  if (e instanceof ApiError) return e.status === 403 ? 'You do not have permission to do this.' : e.message;
  return 'Something went wrong. Please try again.';
}

/**
 * Field messages from a 400's details, keyed by path with `prefix` removed (e.g. "defaultRule.value" → "value" for
 * prefix "defaultRule."), plus the overall message when it says more than "Validation failed" or no field matched.
 */
export function fieldErrors(e: unknown, fields: readonly string[], prefix = ''): { fields: Record<string, string>; general?: string } {
  if (!(e instanceof ApiError)) return { fields: {}, general: e ? pricingErrorText(e) : undefined };
  const out: Record<string, string> = {};
  for (const d of e.details) {
    const path = d.path?.startsWith(prefix) ? d.path.slice(prefix.length) : d.path;
    if (path && fields.includes(path) && !out[path] && d.message) out[path] = d.message;
  }
  const matched = Object.keys(out).length > 0;
  return { fields: out, general: matched && e.message === 'Validation failed' ? undefined : pricingErrorText(e) };
}
