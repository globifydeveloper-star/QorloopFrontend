// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ActiveOffersDashboard } from '../ActiveOffersDashboard';

const reply = (status: number, data: unknown) => new Response(JSON.stringify(status === 200 ? { data } : { error: { code: 'ERROR', message: 'Failed' } }), { status, headers: { 'Content-Type': 'application/json' } });
const offer = (n: number) => ({ productId: `00000000-0000-4000-8000-00000000000${n}`, nameEn: `Product ${n}`, barcode: `000${n}`,
  erpPrice: 10, price: 7.5, validFrom: n === 1 ? null : '2026-11-01T09:00:00.000Z', validUntil: n === 1 ? null : '2026-11-30T09:00:00.000Z' });
let fetchMock: ReturnType<typeof vi.fn>;

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><ActiveOffersDashboard /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('dashboard active offers', () => {
  it('shows running offers, their dates and prices, links to edit, and loads all pages', async () => {
    fetchMock.mockImplementation((url: string) => reply(200, { asOf: '2026-11-11T09:00:00.000Z', total: 2,
      page: Number(new URL(url, 'http://x').searchParams.get('page')), limit: 1,
      items: url.includes('page=1') ? [offer(1)] : [offer(2)] }));
    mount();
    const region = within(screen.getByRole('region', { name: 'Offers running now' }));
    expect(await region.findByText('Product 1')).toBeTruthy();
    expect(region.getByText('2 running')).toBeTruthy();
    expect(region.getByRole('link', { name: 'Product 1' }).getAttribute('href')).toBe('/catalogue/00000000-0000-4000-8000-000000000001');
    expect(region.getByText('No end date')).toBeTruthy();
    expect(region.getByRole('button', { name: 'Show more (1 of 2)' })).toBeTruthy();
    fireEvent.click(region.getByRole('button', { name: 'Show more (1 of 2)' }));
    expect(await region.findByText('Product 2')).toBeTruthy();
    expect(region.getAllByText('7.50')).toHaveLength(2);
    expect(region.queryByRole('button', { name: /Show more/ })).toBeNull();
  });

  it('shows an empty state and recovers from an API failure', async () => {
    fetchMock.mockResolvedValueOnce(reply(500, null)).mockResolvedValueOnce(reply(200, { asOf: '2026-11-11T09:00:00.000Z', total: 0, page: 1, limit: 20, items: [] }));
    mount();
    const region = within(screen.getByRole('region', { name: 'Offers running now' }));
    expect(await region.findByRole('alert')).toBeTruthy();
    fireEvent.click(region.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(region.getByText('No offers are running now.')).toBeTruthy());
    expect(region.getByText('0 running')).toBeTruthy();
  });
});
