import React, { useState } from 'react';
import { ApiError } from '../../api/client';
import { catalogueErrorText, FieldError } from './shared';

/** Field messages (nameEn / nameAr) and the overall message for a failed category create or rename. */
export function categoryErrors(e: unknown): { nameEn?: string; nameAr?: string; general?: string } {
  if (!e) return {};
  const fields = e instanceof ApiError ? e.fieldErrors : {};
  const out = { nameEn: fields.nameEn, nameAr: fields.nameAr };
  // 409 "A category with this name already exists here" belongs to the English name.
  if (e instanceof ApiError && e.status === 409 && !out.nameEn) out.nameEn = e.message;
  const named = Boolean(out.nameEn || out.nameAr);
  return { ...out, general: named ? undefined : catalogueErrorText(e) };
}

/** English + Arabic name inputs used to create and rename categories. Validation messages come from the API. */
export const CategoryNameForm: React.FC<{
  label: string;
  submitLabel: string;
  initial?: { nameEn: string; nameAr: string | null };
  busy: boolean;
  error: unknown;
  onSubmit: (v: { nameEn: string; nameAr: string }) => void;
  onCancel?: () => void;
  idPrefix: string;
}> = ({ label, submitLabel, initial, busy, error, onSubmit, onCancel, idPrefix }) => {
  const [nameEn, setNameEn] = useState(initial?.nameEn ?? '');
  const [nameAr, setNameAr] = useState(initial?.nameAr ?? '');
  const errs = categoryErrors(error);
  const unchanged = initial && nameEn.trim() === initial.nameEn && nameAr.trim() === (initial.nameAr ?? '');
  return (
    <form
      aria-label={label}
      className="flex flex-col md:flex-row md:items-start gap-2"
      onSubmit={e => { e.preventDefault(); if (!busy && nameEn.trim()) onSubmit({ nameEn: nameEn.trim(), nameAr: nameAr.trim() }); }}
    >
      <label className="flex-1">
        <span className="sr-only">English name</span>
        <input
          value={nameEn} onChange={e => setNameEn(e.target.value)} maxLength={100} placeholder="English name" required
          aria-label="English name" aria-invalid={Boolean(errs.nameEn)} aria-describedby={errs.nameEn ? `${idPrefix}-err-en` : undefined}
          className={`w-full h-9 px-3 text-sm border rounded-lg ${errs.nameEn ? 'border-red-400' : 'border-gray-300'}`}
        />
        <FieldError id={`${idPrefix}-err-en`} message={errs.nameEn} />
      </label>
      <label className="flex-1">
        <span className="sr-only">Arabic name</span>
        <input
          dir="rtl" lang="ar" value={nameAr} onChange={e => setNameAr(e.target.value)} maxLength={100} placeholder="الاسم بالعربية"
          aria-label="Arabic name" aria-invalid={Boolean(errs.nameAr)} aria-describedby={errs.nameAr ? `${idPrefix}-err-ar` : undefined}
          className={`w-full h-9 px-3 text-sm border rounded-lg ${errs.nameAr ? 'border-red-400' : 'border-gray-300'}`}
        />
        <FieldError id={`${idPrefix}-err-ar`} message={errs.nameAr} />
      </label>
      <div className="flex gap-2">
        {onCancel && <button type="button" onClick={onCancel} className="h-9 px-3 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>}
        <button type="submit" disabled={busy || !nameEn.trim() || Boolean(unchanged)} className="h-9 px-4 rounded-lg text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50">
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
      {errs.general && <p role="alert" className="md:basis-full text-xs text-red-700">{errs.general}</p>}
    </form>
  );
};
