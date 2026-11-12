// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { RealCatalogueView } from '../RealCatalogueView';
import type { MarketplaceListing } from '../../../api/marketplaceListings';

const app = { openUploadModal: vi.fn() };
let canUpload = true;
let canEditAvailability = false;
vi.mock('../../../context/AppContext', () => ({ useApp: () => app }));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ can: (permission: string) => permission === 'products.view' || canUpload && permission === 'uploads.upload' || canEditAvailability && permission === 'marketplace.values_edit' }) }));
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
const fail = () => new Response(JSON.stringify({ error: { code: 'ERROR', message: 'Failed' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
const date = '2026-11-11T08:00:00Z';
const listing = (id: string, over: Partial<MarketplaceListing> = {}): MarketplaceListing => ({
  id, marketplaceProductId: `T-${id}`, name: `Marketplace product ${id}`, barcodes: ['62810001'], price: 13.75, available: true,
  updatedAt: date, product: { id: 'p1', nameEn: 'Master product', barcode: '62810001' }, sourceFile: { id: 'u1', fileName: 'talabat.xlsx' },
  availabilityAdjustment: { catalogueAvailable: true, override: null, version: null, blockedReason: null }, ...over,
});
const page = (items = [listing('1'), listing('2', { product: null, available: false, availabilityAdjustment: null })], nextCursor: string | null = null, total = 2) => ({
  items, nextCursor, total, latestUpload: { id: 'u1', fileName: 'talabat.xlsx', appliedAt: date },
});
let fetchMock: ReturnType<typeof vi.fn>;
let answer: (query: URLSearchParams) => Response;
let write: (url: URL, init: RequestInit) => Response | Promise<Response>;
const requests = () => fetchMock.mock.calls.map(([url]) => new URL(String(url), 'http://x')).filter(url => url.pathname.endsWith('/marketplace-listings'));
const Where = () => { const location = useLocation(); return <output data-testid="where">{location.search}</output>; };
function open(at = '/catalogue?marketplace=talabat') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[at]}><RealCatalogueView /><Where /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  canUpload = true;
  canEditAvailability = false;
  app.openUploadModal.mockClear();
  answer = () => ok(page());
  write = () => fail();
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(String(url), 'http://x');
    if (u.pathname.startsWith('/api/marketplace-values/')) return write(u, init);
    if (u.pathname.endsWith('/marketplace-listings')) return answer(u.searchParams);
    if (u.pathname === '/api/products') return ok({ items: [], nextCursor: null, counts: { all: 0, active: 0, inactive: 0, new: 0, missing: 0 } });
    if (u.pathname === '/api/categories') return ok([]);
    return fail();
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('marketplace availability switch', () => {
  const cell = () => within(screen.getByText('Marketplace product 1').closest('tr')!);
  const toggle = () => cell().getByRole('switch') as HTMLInputElement;
  const writes = () => fetchMock.mock.calls.filter(([url, init]) => String(url).startsWith('/api/marketplace-values/') && (init as RequestInit)?.method !== 'GET');
  const changed = (value: boolean | null, persistent = false, version = 1) => ok({ changed: true, item: {
    version: { id: 'override-1', version }, values: { availability: value === null ? null : { value, persistent, state: 'pending' } },
  } });

  it('Space toggles the catalogue value, saves only this marketplace and shows saving without changing its current badge', async () => {
    canEditAvailability = true;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    write = async () => { await gate; return changed(false); };
    open();
    await screen.findByText('Marketplace product 1');
    expect(toggle().checked).toBe(true);
    toggle().focus();
    await userEvent.setup().keyboard('[Space]');
    await cell().findByText(/Saving/);
    expect(toggle().checked).toBe(false);
    expect(toggle().disabled).toBe(true);
    expect(cell().getByTestId('marketplace-current-availability').textContent).toBe('Talabat now: Available');
    release();
    await cell().findByText('Saved for Talabat export');
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toBe('/api/marketplace-values/talabat/products/p1');
    expect(JSON.parse((writes()[0][1] as RequestInit).body as string)).toEqual({ values: { availability: { value: false, persistent: false } }, expected: null });
    write = () => changed(true, false, 2);
    fireEvent.click(toggle());
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(JSON.parse((writes()[1][1] as RequestInit).body as string).expected).toEqual({ id: 'override-1', version: 1 });
    await cell().findByText('Saved for Talabat export');
    expect(toggle().checked).toBe(true);
  });

  it('starts at catalogue availability even when the marketplace currently shows a different value', async () => {
    canEditAvailability = true;
    answer = () => ok(page([listing('1', { availabilityAdjustment: { catalogueAvailable: false, override: null, version: null, blockedReason: null } })], null, 1));
    open();
    await screen.findByText('Marketplace product 1');
    expect(toggle().checked).toBe(false);
    expect(cell().getByTestId('marketplace-current-availability').textContent).toBe('Talabat now: Available');
  });

  it('pins a value and resets availability only, with the latest saved version', async () => {
    canEditAvailability = true;
    write = () => changed(false, true);
    open();
    await screen.findByText('Marketplace product 1');
    fireEvent.click(cell().getByRole('checkbox', { name: 'Keep until I remove it' }));
    expect(writes()).toHaveLength(0);
    fireEvent.click(toggle());
    await cell().findByText(/Saved for Talabat export · Pinned/);
    expect(JSON.parse((writes()[0][1] as RequestInit).body as string).values).toEqual({ availability: { value: false, persistent: true } });
    write = () => changed(null, false, 2);
    fireEvent.click(cell().getByRole('button', { name: 'Use catalogue value' }));
    await cell().findByText('Saved for Talabat export');
    expect(toggle().checked).toBe(true);
    const reset = writes()[1];
    expect((reset[1] as RequestInit).method).toBe('DELETE');
    expect(new URL(String(reset[0]), 'http://x').searchParams.get('fields')).toBe('availability');
    expect(new URL(String(reset[0]), 'http://x').searchParams.get('expectedVersion')).toBe('1');
    expect((cell().getByRole('checkbox', { name: 'Keep until I remove it' }) as HTMLInputElement).checked).toBe(false);
  });

  it('a failed pin change rolls back the pin and availability', async () => {
    canEditAvailability = true;
    answer = () => ok(page([listing('1', { availabilityAdjustment: { catalogueAvailable: true, override: { value: false, persistent: false }, version: { id: 'override-1', version: 1 }, blockedReason: null } })]));
    open();
    await screen.findByText('Marketplace product 1');
    fireEvent.click(cell().getByRole('checkbox', { name: 'Keep until I remove it' }));
    await cell().findByRole('alert');
    expect(toggle().checked).toBe(false);
    expect((cell().getByRole('checkbox', { name: 'Keep until I remove it' }) as HTMLInputElement).checked).toBe(false);
  });

  it('a failed reset restores the pinned availability adjustment', async () => {
    canEditAvailability = true;
    answer = () => ok(page([listing('1', { availabilityAdjustment: { catalogueAvailable: true, override: { value: false, persistent: true }, version: { id: 'override-1', version: 1 }, blockedReason: null } })]));
    open();
    await screen.findByText('Marketplace product 1');
    fireEvent.click(cell().getByRole('button', { name: 'Use catalogue value' }));
    await cell().findByRole('alert');
    expect(toggle().checked).toBe(false);
    expect((cell().getByRole('checkbox', { name: 'Keep until I remove it' }) as HTMLInputElement).checked).toBe(true);
  });

  it('reloads the saved version when a newly uploaded product has no comparison row yet', async () => {
    canEditAvailability = true;
    let remote = listing('1').availabilityAdjustment!;
    answer = () => ok(page([listing('1', { availabilityAdjustment: remote })], null, 1));
    write = () => {
      remote = { ...remote, override: { value: false, persistent: false }, version: { id: 'new-upload', version: 1 } };
      return ok({ changed: true, item: null });
    };
    open();
    await screen.findByText('Marketplace product 1');
    fireEvent.click(toggle());
    await cell().findByText('Saved for Talabat export');
    expect(toggle().checked).toBe(false);
    write = () => changed(true, false, 2);
    fireEvent.click(toggle());
    await cell().findByText('Saved for Talabat export');
    expect(JSON.parse((writes()[1][1] as RequestInit).body as string).expected).toEqual({ id: 'new-upload', version: 1 });
  });

  it.each(['Product is not active', 'Inactive in the ERP', 'Not in the latest ERP file'])('disables the switch with the plain reason: %s', async reason => {
    canEditAvailability = true;
    answer = () => ok(page([listing('1', { availabilityAdjustment: { catalogueAvailable: false, override: null, version: null, blockedReason: reason } })], null, 1));
    open();
    await screen.findByText('Marketplace product 1');
    expect(toggle().disabled).toBe(true);
    expect(document.getElementById(toggle().getAttribute('aria-describedby')!)?.textContent).toBe(reason);
    fireEvent.click(toggle());
    expect(writes()).toHaveLength(0);
  });

  it('disables unmatched listings and gives read-only roles no switch', async () => {
    canEditAvailability = true;
    open();
    await screen.findByText('Marketplace product 2');
    const unmatched = within(screen.getByText('Marketplace product 2').closest('tr')!);
    expect((unmatched.getByRole('switch') as HTMLInputElement).disabled).toBe(true);
    expect(unmatched.getByText('Match this listing to a catalogue product first.')).toBeTruthy();
    cleanup();
    canEditAvailability = false;
    open();
    await screen.findByText('Marketplace product 1');
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('rolls back a failed toggle and leaves another row’s successful save intact', async () => {
    canEditAvailability = true;
    answer = () => ok(page([listing('1'), listing('2', { product: { id: 'p2', nameEn: 'Second master product', barcode: '62810002' } })]));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    write = async url => { if (url.pathname.endsWith('/p1')) { await gate; return fail(); } return changed(false); };
    open();
    await screen.findByText('Marketplace product 1');
    fireEvent.click(toggle());
    await cell().findByText(/Saving/);
    const second = within(screen.getByText('Marketplace product 2').closest('tr')!);
    fireEvent.click(second.getByRole('switch'));
    await second.findByText('Saved for Talabat export');
    release();
    await cell().findByRole('alert');
    expect(toggle().checked).toBe(true);
    expect((second.getByRole('switch') as HTMLInputElement).checked).toBe(false);
  });

  it('a 409 refreshes the adjustment and the next save uses its newer version', async () => {
    canEditAvailability = true;
    let remote = listing('1').availabilityAdjustment!;
    answer = () => ok(page([listing('1', { availabilityAdjustment: remote })], null, 1));
    write = () => {
      remote = { ...remote, override: { value: false, persistent: true }, version: { id: 'remote', version: 7 } };
      return new Response(JSON.stringify({ error: { code: 'CONFLICT', message: 'Changed' } }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    };
    open();
    await screen.findByText('Marketplace product 1');
    fireEvent.click(toggle());
    await cell().findByText('Someone changed this marketplace adjustment. Check the refreshed values and try again.');
    expect(toggle().checked).toBe(false);
    expect((cell().getByRole('checkbox', { name: 'Keep until I remove it' }) as HTMLInputElement).checked).toBe(true);
    write = () => changed(true, true, 8);
    fireEvent.click(toggle());
    await cell().findByText(/Saved for Talabat export/);
    expect(JSON.parse((writes()[1][1] as RequestInit).body as string).expected).toEqual({ id: 'remote', version: 7 });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('marketplace catalogue tabs', () => {
  it('opens a bookmarked marketplace and shows actual matched and unmatched listings, prices, availability and source', async () => {
    open();
    const tabs = within(screen.getByRole('tablist', { name: 'Catalogue source' }));
    expect(tabs.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Master catalogue', 'Talabat', 'Snoonu', 'Rafeeq', 'Keeta']);
    expect(tabs.getByRole('tab', { name: 'Talabat' }).getAttribute('aria-selected')).toBe('true');
    const table = within(await screen.findByRole('table', { name: 'Talabat product listings' }));
    expect(table.getByText('Marketplace product 1')).toBeTruthy();
    expect(table.getByText('Marketplace product 2')).toBeTruthy();
    expect(table.getByText('Available')).toBeTruthy();
    expect(table.getByText('Unavailable')).toBeTruthy();
    expect(table.getAllByText('13.75')).toHaveLength(2);
    expect(table.getByText('Not in catalogue')).toBeTruthy();
    expect(table.getByRole('link', { name: 'Master product' }).getAttribute('href')).toBe('/catalogue/p1');
    expect(screen.getByText(/Latest file: talabat.xlsx/)).toBeTruthy();
    expect(screen.getByText('2 of 2 listings loaded')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/products?'))).toBe(false);
  });

  it('supports arrow, Home and End keys, updates the URL, and never shows another marketplace’s cached rows', async () => {
    answer = q => ok(page([listing(q.get('marketplaceId')!)]));
    open('/catalogue?marketplace=talabat&other=keep');
    await screen.findByText('Marketplace product talabat');
    const talabat = screen.getByRole('tab', { name: 'Talabat' });
    talabat.focus();
    fireEvent.keyDown(talabat, { key: 'ArrowRight' });
    const snoonu = screen.getByRole('tab', { name: 'Snoonu' });
    expect(document.activeElement).toBe(snoonu);
    expect(screen.queryByText('Marketplace product talabat')).toBeNull();
    await screen.findByText('Marketplace product snoonu');
    expect(screen.getByTestId('where').textContent).toContain('marketplace=snoonu');
    expect(screen.getByTestId('where').textContent).toContain('other=keep');
    fireEvent.keyDown(snoonu, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Keeta' }));
    await screen.findByText('Marketplace product keeta');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Keeta' }), { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Master catalogue' }));
    await screen.findByText('No products yet');
    expect(screen.getByTestId('where').textContent).not.toContain('marketplace=');
  });

  it('pages on the server and resets paging when search, availability or match changes', async () => {
    answer = q => ok(page([listing(q.get('cursor') ? 'next' : 'first')], q.get('cursor') ? null : 'page-2', 2));
    open();
    await screen.findByText('Marketplace product first');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Marketplace product next');
    expect(requests().at(-1)!.searchParams.get('cursor')).toBe('page-2');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Talabat listings' }), { target: { value: 'milk' } });
    await waitFor(() => expect(requests().at(-1)!.searchParams.get('q')).toBe('milk'));
    expect(requests().at(-1)!.searchParams.has('cursor')).toBe(false);
    expect(screen.queryByText('Marketplace product next')).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Marketplace availability' }), { target: { value: 'unavailable' } });
    await waitFor(() => expect(requests().at(-1)!.searchParams.get('availability')).toBe('unavailable'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Catalogue match' }), { target: { value: 'unmatched' } });
    await waitFor(() => expect(requests().at(-1)!.searchParams.get('match')).toBe('unmatched'));
    expect(requests().at(-1)!.searchParams.get('marketplaceId')).toBe('talabat');
  });

  it('shows an empty-state upload action and respects upload permissions', async () => {
    answer = () => ok({ ...page([], null, 0), latestUpload: null });
    open();
    await screen.findByText('No Talabat listings yet');
    fireEvent.click(screen.getByRole('button', { name: 'Upload Talabat file' }));
    expect(app.openUploadModal).toHaveBeenCalledWith('talabat');
    cleanup();
    canUpload = false;
    open();
    await screen.findByText('No Talabat listings yet');
    expect(screen.queryByRole('button', { name: 'Upload Talabat file' })).toBeNull();
  });

  it('retries an error and keeps already loaded rows if loading the next page fails', async () => {
    answer = () => fail();
    open();
    await screen.findByText('We could not load the Talabat catalogue');
    answer = q => q.has('cursor') ? fail() : ok(page([listing('1')], 'next', 2));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Marketplace product 1');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText(/We could not load more listings/);
    expect(screen.getByText('Marketplace product 1')).toBeTruthy();
    answer = q => ok(page([listing(q.has('cursor') ? '2' : '1')], null, 2));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Marketplace product 2');
    expect(screen.getByText('2 of 2 listings loaded')).toBeTruthy();
  });
});
