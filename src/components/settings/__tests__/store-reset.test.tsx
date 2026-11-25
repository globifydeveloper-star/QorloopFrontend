// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StoreResetSection } from '../StoreResetSection';
import type { StoreResetPreview } from '../../../api/storeReset';

const COUNTS = { products: 1200, categories: 14, uploads: 6, generatedFiles: 3, marketplaceListings: 2400, comparisonRows: 2300, priceRules: 5,
  offers: 2, exportValues: 0, stockEdits: 0, notifications: 4, activityEntries: 90, totalRows: 6026 };
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
let preview: StoreResetPreview;
let fetchMock: ReturnType<typeof vi.fn>;
let resetResponse: () => Response;

beforeEach(() => {
  preview = { store: { name: 'Doha Store', slug: 'doha' }, deletes: COUNTS, inFlightUploads: 0, blockedReason: null };
  resetResponse = () => ok({ eventId: 'e1', deleted: COUNTS, storageCleanup: 'queued' });
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === '/api/store/reset' && init.method === 'POST') return resetResponse();
    if (url === '/api/store/reset') return ok(preview);
    throw new Error('Unexpected API request ' + url);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><StoreResetSection /></QueryClientProvider>);
};
const posts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST');

describe('reset store data', () => {
  it('loads nothing until the Owner opens it, then lists what is deleted and kept', async () => {
    mount();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Review what will be deleted' }));
    expect(await screen.findByText('Products')).toBeTruthy();
    expect(screen.getByText('1,200')).toBeTruthy();
    expect(screen.queryByText('Export values')).toBeNull(); // zero counts are not listed
    expect(screen.getByText(/Team members, roles/)).toBeTruthy();
  });

  it('enables the reset only when the slug is typed, and sends it', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Review what will be deleted' }));
    const input = await screen.findByLabelText(/to confirm/);
    const button = screen.getByRole('button', { name: 'Reset store data' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'dohaa' } });
    expect(button.disabled).toBe(true);
    fireEvent.change(input, { target: { value: ' Doha ' } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(await screen.findByText("The store's data was reset.")).toBeTruthy();
    expect(screen.getByText(/1,200 products, 6 uploads and 3 generated files/)).toBeTruthy();
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0]![1].body)).toEqual({ confirmSlug: 'Doha' });
  });

  it('cannot reset while an upload is being processed', async () => {
    preview = { ...preview, inFlightUploads: 1, blockedReason: 'An upload is still being processed.' };
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Review what will be deleted' }));
    expect((await screen.findByRole('alert')).textContent).toContain('still being processed');
    expect((screen.getByLabelText(/to confirm/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Reset store data' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a refusal from the server and resets nothing on screen', async () => {
    resetResponse = () => new Response(JSON.stringify({ error: { code: 'CONFLICT', message: 'The comparison is being recalculated right now. Try again in a minute. Nothing was changed.' }, requestId: 'r1' }), { status: 409 });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Review what will be deleted' }));
    fireEvent.change(await screen.findByLabelText(/to confirm/), { target: { value: 'doha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset store data' }));
    await waitFor(() => expect(screen.getByText(/The store was not reset/)).toBeTruthy());
    expect(screen.queryByText("The store's data was reset.")).toBeNull();
  });
});
