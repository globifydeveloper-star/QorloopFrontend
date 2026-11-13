// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReconMarketplaceSummary } from '../../../api/recon';
import { MarketplaceComparisonCard, compareLink } from '../MarketplaceComparisonCard';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json(200, { data });
const fail = (status: number, message: string, details?: unknown[]) => json(status, { error: { code: 'E', message, details } });

const NOW = new Date('2026-11-13T09:00:00.000Z');
const mp = (marketplaceId: ReconMarketplaceSummary['marketplaceId'], over: Partial<ReconMarketplaceSummary> = {}): ReconMarketplaceSummary => ({
  marketplaceId, hasData: true, stock: 0, price: 0, total: 0, listed: 10, notListed: 0, noData: 0, missingFromErp: 0, newCount: 0,
  lastUploadAt: '2026-11-13T07:00:00.000Z', stale: false, ...over,
});
/** The number of products each "differ" choice finds, per pair. */
const COUNTS: Record<string, Record<string, number>> = {
  'talabat|snoonu': { any: 12, price: 9, availability: 4 },
  'talabat|rafeeq': { any: 0, price: 0, availability: 0 },
};

let fetchMock: ReturnType<typeof vi.fn>;
let answer: (q: Record<string, string>) => Response;
const productCalls = () => fetchMock.mock.calls.map(([u]) => String(u)).filter(u => u.startsWith('/api/products?')).map(u => Object.fromEntries(new URL(u, 'http://x').searchParams));

function open(marketplaces: ReconMarketplaceSummary[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><MarketplaceComparisonCard marketplaces={marketplaces} /></MemoryRouter></QueryClientProvider>);
}
const card = () => within(screen.getByRole('region'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  answer = q => ok({ items: [], nextCursor: null, counts: { all: COUNTS[`${q.marketplaceId}|${q.compareMarketplaceId}`]?.[q.marketplacesDiffer] ?? 0, active: 0, inactive: 0, new: 0, missing: 0 } });
  fetchMock = vi.fn(async (u: string) => {
    const url = String(u);
    return url.startsWith('/api/products?') ? answer(Object.fromEntries(new URL(url, 'http://x').searchParams)) : fail(404, 'not mocked');
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Dashboard: two marketplaces compared with each other', () => {
  it('shows how many products differ in total, in price and in availability, each opening the Catalogue comparison', async () => {
    open([mp('talabat'), mp('snoonu'), mp('keeta', { hasData: false, lastUploadAt: null })]);
    expect(screen.getByRole('heading', { name: 'Talabat vs Snoonu' })).toBeTruthy();
    await waitFor(() => expect(card().getByTestId('compare-any').textContent).toBe('12'));
    expect(card().getByTestId('compare-price').textContent).toBe('9');
    expect(card().getByTestId('compare-availability').textContent).toBe('4');
    // One count request per choice, from the server's tab count (limit 1); Keeta has no file, so it is not offered.
    expect(productCalls().map(q => q.marketplacesDiffer).sort()).toEqual(['any', 'availability', 'price']);
    for (const q of productCalls()) expect(q).toMatchObject({ marketplaceId: 'talabat', compareMarketplaceId: 'snoonu', limit: '1', tab: 'all' });
    expect(card().getByRole('link', { name: /Price differs: 9/ }).getAttribute('href')).toBe('/catalogue?marketplace=talabat&compare=snoonu&differ=price');
    expect(card().getByRole('link', { name: /Products that differ: 12/ }).getAttribute('href')).toBe(compareLink('talabat', 'snoonu', 'any'));
    expect(card().getByTestId('compare-open').getAttribute('href')).toBe('/catalogue?marketplace=talabat&compare=snoonu');
    // Two marketplaces only: no choice to make.
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('shows nothing with fewer than two marketplaces that have a file, and asks for nothing', () => {
    const { container } = open([mp('talabat'), mp('snoonu', { hasData: false, lastUploadAt: null })]);
    expect(container.querySelector('section')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with three, either side can be changed; choosing the other side\'s marketplace swaps them', async () => {
    open([mp('talabat'), mp('snoonu'), mp('rafeeq')]);
    await waitFor(() => expect(card().getByTestId('compare-any').textContent).toBe('12'));
    fireEvent.change(screen.getByLabelText('Second marketplace'), { target: { value: 'rafeeq' } });
    expect(screen.getByRole('heading', { name: 'Talabat vs Rafeeq' })).toBeTruthy();
    await waitFor(() => expect(card().getByTestId('compare-any').textContent).toBe('0'));
    fireEvent.change(screen.getByLabelText('First marketplace'), { target: { value: 'rafeeq' } });
    expect(screen.getByRole('heading', { name: 'Rafeeq vs Talabat' })).toBeTruthy();
    expect((screen.getByLabelText('Second marketplace') as HTMLSelectElement).value).toBe('talabat');
  });

  it('says when a file is out of date', async () => {
    open([mp('talabat', { stale: true, lastUploadAt: '2026-11-10T09:00:00.000Z' }), mp('snoonu')]);
    expect(screen.getByTestId('compare-stale').textContent).toBe('Talabat data is 3 days old. Upload a fresh file for a reliable comparison.');
  });

  it('a backend that cannot compare two marketplaces says so in plain words, without counts', async () => {
    answer = () => fail(400, 'Invalid request', [{ path: '', message: 'Unrecognized key: "compareMarketplaceId"' }]);
    open([mp('talabat'), mp('snoonu')]);
    expect((await screen.findByTestId('compare-problem')).textContent).toBe('This server cannot compare two marketplaces yet.');
    expect(screen.queryByTestId('compare-any')).toBeNull();
    // The link to the Catalogue stays: it explains the same there.
    expect(card().getByTestId('compare-open')).toBeTruthy();
  });
});
