// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SettingsView } from '../../views/SettingsView';
import { settingsChanges, settingsDraft } from '../form';
import type { StoreSettings } from '../../../api/settings';
import { ruleFromDraft } from '../../pricing/shared';

const perms = new Set<string>();
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ can: (p: string) => perms.has(p) }) }));
vi.mock('../../../context/AppContext', () => ({ useApp: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../demo', () => ({ useDemo: () => { throw new Error('Real Settings must not use demo state'); } }));
const BASE: StoreSettings = {
  profile: { name: 'Doha Store' }, timeZone: 'Asia/Qatar', currency: 'QAR', revision: 'a'.repeat(64),
  thresholds: { priceTolerance: 0.1, stockThreshold: 2, staleHours: 12 }, security: { analystCanExport: true, mfaRequiredForAll: false },
  pricing: { defaultRule: { mode: 'same' }, rounding: 'exact', perMarketplaceEnabled: false, compareReferenceDefault: 'marketplace', marketplaceRules: [], order: ['offer', 'product', 'subcategory', 'category', 'marketplace', 'default'], updatedAt: null },
};
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
let current: StoreSettings;
let conflict: boolean;
let fetchMock: ReturnType<typeof vi.fn>;
let clients: QueryClient[] = [];
const savedBodies = () => fetchMock.mock.calls.filter(([u, i]) => u === '/api/settings' && i.method === 'PUT').map(([, i]) => JSON.parse(i.body));
beforeEach(() => {
  vi.stubEnv('VITE_REAL_SETTINGS', 'true'); perms.clear(); ['settings.view', 'settings.edit', 'settings.security'].forEach(p => perms.add(p));
  current = structuredClone(BASE); conflict = false;
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === '/api/settings/marketplaces') return ok({ items: [{ marketplaceId: 'talabat', enabled: true, hasData: true, lastUploadAt: '2026-11-01T18:30:00Z', ageHours: 36 }, { marketplaceId: 'keeta', enabled: true, hasData: false, lastUploadAt: null, ageHours: null }] });
    if (url === '/api/settings' && init.method === 'PUT') {
      if (conflict) { current = { ...current, profile: { name: 'Newer server name' }, revision: 'b'.repeat(64) }; return new Response(JSON.stringify({ error: { code: 'CONFLICT', message: 'Reload settings' }, requestId: 'conflict-id' }), { status: 409 }); }
      const b = JSON.parse(String(init.body));
      current = { ...current, profile: { ...current.profile, ...b.profile }, thresholds: { ...current.thresholds, ...b.thresholds }, security: { ...current.security, ...b.security }, pricing: { ...current.pricing, ...b.pricing }, revision: 'b'.repeat(64) };
    }
    if (url === '/api/settings') return ok(current);
    throw new Error('Unexpected API request');
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); clients.forEach(q => q.clear()); clients = []; vi.unstubAllGlobals(); });
const mount = () => { const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(qc); render(<QueryClientProvider client={qc}><MemoryRouter><SettingsView /></MemoryRouter></QueryClientProvider>); return qc; };

describe('settings state and validation', () => {
  it.each([
    ['percent', '-90.001'], ['percent', '1000.001'], ['amount', '-100000.001'], ['amount', '100000.001'],
    ['fixed', '0'], ['fixed', '1000000000'], ['fixed', '1.0001'], ['amount', 'NaN'],
  ] as const)('rejects an out-of-contract %s pricing value', (mode, value) => { expect(ruleFromDraft({ mode, value }).error).toBeTruthy(); });
  it('accepts the documented pricing boundaries and omits value for same', () => {
    expect(ruleFromDraft({ mode: 'same', value: '99' }).rule).toEqual({ mode: 'same' });
    for (const value of ['-90', '1000']) expect(ruleFromDraft({ mode: 'percent', value }).rule).toEqual({ mode: 'percent', value: Number(value) });
    for (const value of ['-100000', '100000']) expect(ruleFromDraft({ mode: 'amount', value }).rule).toEqual({ mode: 'amount', value: Number(value) });
    expect(ruleFromDraft({ mode: 'fixed', value: '999999999.999' }).rule).toBeTruthy();
  });
  it.each([
    ['name', ' ', 'name'], ['name', 'a'.repeat(101), 'name'], ['priceTolerance', '-1', 'priceTolerance'], ['priceTolerance', '100001', 'priceTolerance'], ['priceTolerance', '1.0001', 'priceTolerance'],
    ['stockThreshold', '1.5', 'stockThreshold'], ['stockThreshold', '2147483648', 'stockThreshold'], ['stockThreshold', '-1', 'stockThreshold'],
    ['staleDays', '0', 'staleDays'], ['staleDays', '366', 'staleDays'], ['staleDays', '0.01', 'staleDays'], ['staleDays', '', 'staleDays'],
  ])('rejects invalid %s = %s', (key, value, error) => {
    expect(settingsChanges(BASE, { ...settingsDraft(BASE), [key]: value }, true, true).errors[error]).toBeTruthy();
  });
  it('supports whole-hour boundaries and avoids rounding the stored default', () => {
    for (const hours of [1, 12, 25, 8760]) {
      const s = { ...BASE, thresholds: { ...BASE.thresholds, staleHours: hours } };
      const p = settingsChanges(s, settingsDraft(s), true, true);
      expect(p.errors).toEqual({}); expect(p.dirty).toBe(false);
    }
  });
  it('omits forbidden and unchanged fields, and has no writable currency/time-zone payload', () => {
    const draft = { ...settingsDraft(BASE), name: ' Updated ', staleDays: '1.5', mfaRequiredForAll: true };
    expect(settingsChanges(BASE, draft, false, false).dirty).toBe(false);
    expect(settingsChanges(BASE, draft, true, false).body).toEqual({ expectedRevision: BASE.revision, profile: { name: 'Updated' }, thresholds: { staleHours: 36 } });
  });
});

describe('real Settings screen', () => {
  it.each(['fetch rejection', 'refused dev-proxy connection'])('shows the shared connection state for %s and retries the read', async mode => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/settings/marketplaces') return ok({ items: [] });
      if (mode === 'fetch rejection') throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ error: { code: 'UPSTREAM_UNREACHABLE', message: 'Proxy could not connect' } }), { status: 503 });
    });
    mount();
    expect(await screen.findByText("Qorloop can't reach the server. Check your connection and try again.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Request ID|could not complete this request/i); expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    fetchMock.mockImplementation(async (url: string) => ok(url === '/api/settings' ? BASE : { items: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Store name')).toBeTruthy();
  });
  it('keeps a genuine 500 response with Request ID and Copy', async () => {
    const copy = vi.fn(async () => undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    fetchMock.mockImplementation(async (url: string) => url === '/api/settings/marketplaces' ? ok({ items: [] }) : new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }, requestId: 'settings-server-request' }), { status: 500 }));
    mount(); expect(await screen.findByText('Qorloop could not complete this request')).toBeTruthy(); expect(screen.getByText('Request ID: settings-server-request')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' })); await waitFor(() => expect(copy).toHaveBeenCalledWith('settings-server-request'));
  });
  it('loads profile, days, labels and read-only marketplace upload times in Qatar', async () => {
    mount(); expect(screen.getByRole('status', { name: 'Loading settings…' })).toBeTruthy();
    expect((await screen.findByLabelText('Store name') as HTMLInputElement).value).toBe('Doha Store');
    expect((screen.getByLabelText('Data is out of date after (days)') as HTMLInputElement).value).toBe('0.5');
    expect(screen.getByText(/Time zone: Asia\/Qatar/).textContent).toContain('QAR');
    expect(await screen.findByText('01 Nov 2026, 21:30')).toBeTruthy(); expect(screen.getByText('No upload yet')).toBeTruthy();
  });
  it('saves whole hours with the revision, excludes unchanged security and marks dashboard recompute', async () => {
    const qc = mount(); await screen.findByLabelText('Store name');
    fireEvent.change(screen.getByLabelText('Data is out of date after (days)'), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText('Price tolerance (QAR)'), { target: { value: '0.125' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText(/The comparison will recompute/)).toBeTruthy();
    expect(savedBodies()).toEqual([{ expectedRevision: BASE.revision, thresholds: { priceTolerance: 0.125, staleHours: 36 } }]);
    expect(qc.getQueryData(['recon', 'recompute'])).toMatchObject({ timedOut: false });
  });
  it('validates before sending and can discard the invalid draft', async () => {
    mount(); await screen.findByLabelText('Store name');
    fireEvent.change(screen.getByLabelText('Stock threshold'), { target: { value: '2.5' } }); fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText(/Enter a whole number/)).toBeTruthy(); expect(savedBodies()).toEqual([]);
    fireEvent.click(within(screen.getByRole('form', { name: 'Store settings' })).getByRole('button', { name: 'Discard changes' })); expect((screen.getByLabelText('Stock threshold') as HTMLInputElement).value).toBe('2');
  });
  it('automatically reloads newer values after a stale revision, drops the draft and allows review', async () => {
    conflict = true; mount(); await screen.findByLabelText('Store name');
    fireEvent.change(screen.getByLabelText('Store name'), { target: { value: 'My stale draft' } }); fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect((screen.getByLabelText('Store name') as HTMLInputElement).value).toBe('Newer server name'));
    expect(screen.getByText(/Someone else changed these settings/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled).toBe(true);
    conflict = false; fireEvent.change(screen.getByLabelText('Store name'), { target: { value: 'Reviewed name' } }); fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(savedBodies()).toHaveLength(2)); expect(savedBodies()[1].expectedRevision).toBe('b'.repeat(64));
  });
  it.each(['analyst', 'catalogue_manager'])('keeps %s read-only even if pricing.edit is present', async () => {
    perms.delete('settings.edit'); perms.delete('settings.security'); perms.add('pricing.edit'); mount(); await screen.findByLabelText('Store name');
    const form = within(screen.getByRole('form', { name: 'Store settings' }));
    expect((screen.getByLabelText('Store name') as HTMLInputElement).closest('fieldset')!.disabled).toBe(true);
    expect((screen.getByLabelText('Default rule') as HTMLSelectElement).disabled).toBe(true);
    expect(form.queryByRole('button', { name: 'Save settings' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Save pricing' })).toBeNull();
    fireEvent.submit(screen.getByRole('form', { name: 'Store settings' })); expect(savedBodies()).toEqual([]);
  });
  it('allows Admin export edits but omits the Owner-only MFA field', async () => {
    perms.delete('settings.security'); mount(); await screen.findByLabelText('Store name');
    expect((screen.getByLabelText('Require two-step verification for everyone') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Allow Analysts to export reports')); fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(savedBodies()).toHaveLength(1)); expect(savedBodies()[0].security).toEqual({ analystCanExport: false });
  });
  it('allows the Owner to save MFA policy and reuses pricing controls with the general revision', async () => {
    mount(); await screen.findByLabelText('Store name');
    fireEvent.click(screen.getByLabelText('Require two-step verification for everyone')); fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(savedBodies()).toHaveLength(1)); expect(savedBodies()[0].security).toEqual({ mfaRequiredForAll: true });
    await screen.findByText('Settings saved.');
    await waitFor(() => expect((screen.getByLabelText('Require two-step verification for everyone') as HTMLInputElement).checked).toBe(true));
    fireEvent.change(screen.getByLabelText('Default rule'), { target: { value: 'percent' } });
    fireEvent.change(screen.getByLabelText('Percent (%)'), { target: { value: '1001' } }); fireEvent.click(screen.getByRole('button', { name: 'Save pricing' }));
    expect(await screen.findByText('Enter a percent from -90 to 1000')).toBeTruthy(); expect(savedBodies()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Percent (%)'), { target: { value: '10' } }); fireEvent.click(screen.getByRole('button', { name: 'Save pricing' }));
    await waitFor(() => expect(savedBodies()).toHaveLength(2)); expect(savedBodies()[1]).toEqual({ expectedRevision: 'b'.repeat(64), pricing: { defaultRule: { mode: 'percent', value: 10 } } });
  });
  it('does not fetch settings without settings.view', () => { perms.clear(); mount(); expect(screen.getByText('You do not have access to this page')).toBeTruthy(); expect(fetchMock).not.toHaveBeenCalled(); });
});
