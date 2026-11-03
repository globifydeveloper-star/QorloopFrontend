// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ActivityView, ProductHistory } from '../ActivityView';
import type { ActivityItem } from '../../../api/activity';

const perms = new Set<string>();
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ can: (p: string) => perms.has(p) }) }));
const PRODUCT = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const NOTICE = 'Upload entries are store-wide summaries and do not prove this product changed. Earlier marketplace price and availability changes were not recorded per product. Historical coverage may also omit newly adopted price rules. No audit retention policy is configured.';
const event = (id: string, over: Partial<ActivityItem> = {}): ActivityItem => ({
  id, time: '2026-11-03T09:00:00.123456Z', actor: { id: ACTOR, name: 'Sara', email: 'sara@example.test' }, type: 'product.price_rule_set', group: 'price',
  summary: `Price change ${id}`, beforeAfter: [], scope: 'product', productId: PRODUCT, uploadId: null, ...over,
});
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
let fetchMock: ReturnType<typeof vi.fn>;
let handler: (u: URL) => Response | Promise<Response>;
let clients: QueryClient[] = [];
const urls = () => fetchMock.mock.calls.map(([u]) => new URL(u, 'http://store.localhost')).filter(u => u.pathname === '/api/activity');
beforeEach(() => {
  vi.stubEnv('VITE_REAL_SETTINGS', 'true'); perms.clear(); ['activity.view', 'products.view'].forEach(p => perms.add(p));
  handler = () => ok({ items: [], nextCursor: null });
  fetchMock = vi.fn((u: string) => handler(new URL(u, 'http://store.localhost'))); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); clients.forEach(q => q.clear()); clients = []; vi.unstubAllGlobals(); });
const mount = (ui = <ActivityView />) => { const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(qc); return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>); };

describe('shared Activity and History data errors', () => {
  it.each(['Activity', 'History'] as const)('shows the connection message and retry without a Request ID on %s when fetch rejects', async page => {
    handler = () => { throw new TypeError('Failed to fetch'); };
    mount(page === 'Activity' ? <ActivityView /> : <ProductHistory productId={PRODUCT} />);
    expect(await screen.findByText("Qorloop can't reach the server. Check your connection and try again.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Request ID|could not complete this request/i);
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    handler = () => ok({ items: [], nextCursor: null, coverageNotice: NOTICE });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(page === 'Activity' ? 'No activity matches these filters' : 'No changes recorded for this product yet')).toBeTruthy();
  });
  it.each(['Activity', 'History'] as const)('shows the connection message on %s for an explicitly marked refused dev-proxy connection', async page => {
    handler = () => new Response(JSON.stringify({ error: { code: 'UPSTREAM_UNREACHABLE', message: 'Proxy could not connect' } }), { status: 503 });
    mount(page === 'Activity' ? <ActivityView /> : <ProductHistory productId={PRODUCT} />);
    expect(await screen.findByText("Qorloop can't reach the server. Check your connection and try again.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Request ID|could not complete this request/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
  it.each(['Activity', 'History'] as const)('keeps a real server 500 and Request ID/Copy on %s', async page => {
    const copy = vi.fn(async () => undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    handler = () => new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }, requestId: 'page-server-request' }), { status: 500 });
    mount(page === 'Activity' ? <ActivityView /> : <ProductHistory productId={PRODUCT} />);
    expect(await screen.findByText('Qorloop could not complete this request')).toBeTruthy();
    expect(screen.getByText('Request ID: page-server-request')).toBeTruthy();
    expect(screen.queryByText("Qorloop can't reach the server. Check your connection and try again.")).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith('page-server-request'));
  });
});

describe('Activity filters and cursor pages', () => {
  it('shows loading, empty results and filters in Qatar time', async () => {
    mount(); expect(screen.getByRole('status', { name: 'Loading activity…' })).toBeTruthy();
    expect(await screen.findByText('No activity matches these filters')).toBeTruthy();
    expect((screen.getByLabelText('From (Qatar time)') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('To (Qatar time)') as HTMLInputElement).value).toBe('');
    expect(urls()[0].searchParams.has('from')).toBe(false);
    expect(urls()[0].searchParams.has('to')).toBe(false);
    fireEvent.change(screen.getByLabelText('Event type group'), { target: { value: 'price' } });
    fireEvent.change(screen.getByLabelText('Actor'), { target: { value: 'system' } });
    fireEvent.change(screen.getByLabelText('Product ID'), { target: { value: PRODUCT } });
    fireEvent.change(screen.getByLabelText('From (Qatar time)'), { target: { value: '2026-11-01T09:00' } });
    fireEvent.change(screen.getByLabelText('To (Qatar time)'), { target: { value: '2026-11-03T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(urls()).toHaveLength(2));
    expect(Object.fromEntries(urls()[1].searchParams)).toEqual({ eventType: 'price', actorId: 'system', productId: PRODUCT, from: '2026-11-01T09:00:00+03:00', to: '2026-11-03T10:00:00+03:00' });
  });
  it('preserves server ordering and opaque cursors with the same filters and resets paging when filters change', async () => {
    const cursor = 'opaque.2026-11-03T09:00:00.123456Z+/=';
    handler = u => u.searchParams.get('eventType') === 'catalogue' ? ok({ items: [event('filtered')], nextCursor: null })
      : u.searchParams.has('cursor') ? ok({ items: [event('older')], nextCursor: null }) : ok({ items: [event('newer')], nextCursor: cursor });
    mount(); await screen.findByText('Price change newer');
    fireEvent.change(screen.getByLabelText('Actor'), { target: { value: ACTOR } }); fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(urls()).toHaveLength(2));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Load more' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' })); await screen.findByText('Price change older');
    expect(Object.fromEntries(urls()[2].searchParams)).toEqual({ actorId: ACTOR, cursor });
    const rows = within(screen.getByRole('region', { name: 'Activity entries' })).getAllByRole('listitem');
    expect(rows.map(r => r.textContent)).toEqual([expect.stringContaining('Price change newer'), expect.stringContaining('Price change older')]);
    expect(rows[0].textContent).toContain('03 Nov 2026, 12:00');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Event type group'), { target: { value: 'catalogue' } }); fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await screen.findByText('Price change filtered'); expect(urls().at(-1)!.searchParams.has('cursor')).toBe(false);
    expect(screen.queryByText('Price change older')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' })); await screen.findByText('Price change newer');
  });
  it('validates actor, product and date range without a request', async () => {
    mount(); await screen.findByText('No activity matches these filters');
    fireEvent.change(screen.getByLabelText('Actor'), { target: { value: 'wrong' } }); fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(screen.getByText(/Choose an actor/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Actor'), { target: { value: '' } }); fireEvent.change(screen.getByLabelText('Product ID'), { target: { value: 'wrong' } }); fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(screen.getByText('Enter a valid product ID.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Product ID'), { target: { value: '' } }); fireEvent.change(screen.getByLabelText('From (Qatar time)'), { target: { value: '2026-11-03T09:00' } }); fireEvent.change(screen.getByLabelText('To (Qatar time)'), { target: { value: '2026-11-02T09:00' } }); fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(screen.getByText(/end date must be on or after/)).toBeTruthy(); expect(urls()).toHaveLength(1);
  });
  it('clears every applied filter, including actor/event type, dates, product and validation errors', async () => {
    mount(); await screen.findByText('No activity matches these filters');
    for (const [label, value] of [['Actor', ACTOR], ['Event type group', 'price'], ['Product ID', PRODUCT], ['From (Qatar time)', '2026-11-01T09:00'], ['To (Qatar time)', '2026-11-03T10:00']])
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(urls().at(-1)!.searchParams.get('actorId')).toBe(ACTOR));
    fireEvent.change(screen.getByLabelText('Actor'), { target: { value: 'invalid actor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(screen.getByText(/Choose an actor/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    for (const label of ['Actor', 'Event type group', 'Product ID', 'From (Qatar time)', 'To (Qatar time)'])
      expect((screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement).value).toBe('');
    expect(screen.queryByText(/Choose an actor/)).toBeNull();
    await waitFor(() => expect(urls().at(-1)!.search).toBe(''));
  });
  it('loads team actor suggestions only with team.view', async () => {
    perms.add('team.view');
    handler = u => u.pathname === '/api/team/members' ? ok([{ id: 'member', user: { id: ACTOR, name: 'Sara', email: 'sara@example.test' } }]) : ok({ items: [], nextCursor: null });
    mount(); expect(await screen.findByText('Sara (sara@example.test)')).toBeTruthy();
  });
  it('does not fetch or display entries without activity.view or with the flag off', () => {
    perms.delete('activity.view'); const r = mount(); expect(screen.getByText('You do not have access to this page')).toBeTruthy(); expect(fetchMock).not.toHaveBeenCalled();
    r.unmount(); perms.add('activity.view'); vi.stubEnv('VITE_REAL_SETTINGS', ''); mount(); expect(screen.getByText('Activity is not connected yet')).toBeTruthy(); expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Product History safe rendering', () => {
  it('displays coverage notice, System, tenant context, missing values and human-readable rules; ignores raw details', async () => {
    handler = () => ok({ items: [
      { ...event('upload', { actor: { id: null, name: 'system', email: null }, scope: 'tenant', productId: null, summary: 'Marketplace upload applied' }), details: { privatePayload: 'DO_NOT_RENDER' } },
      event('rule', { beforeAfter: [{ field: 'rule', before: null, after: { mode: 'fixed', value: 12.5 } }] }),
      event('former', { actor: { id: ACTOR, name: 'Former team member', email: null }, beforeAfter: [] }),
    ], nextCursor: null, coverageNotice: NOTICE });
    mount(<ProductHistory productId={PRODUCT} />);
    expect(screen.getByRole('status', { name: 'Loading history…' })).toBeTruthy();
    expect(await screen.findByText(NOTICE)).toBeTruthy();
    const toggle = screen.getByRole('checkbox', { name: 'Show store-wide upload entries' }) as HTMLInputElement;
    expect(toggle.checked).toBe(false); expect(screen.queryByText('Marketplace upload applied')).toBeNull();
    expect(screen.getByText('Price change rule')).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByText('System')).toBeTruthy(); expect(screen.getByText('Former team member')).toBeTruthy();
    expect(screen.getByText(/Store-wide context/)).toBeTruthy(); expect(screen.getAllByText('Before and after')).toHaveLength(1);
    fireEvent.click(screen.getByText('Before and after')); expect(screen.getByText('Not recorded')).toBeTruthy(); expect(screen.getByText('Fixed 12.50 QAR')).toBeTruthy();
    expect(screen.queryByText('DO_NOT_RENDER')).toBeNull(); expect(document.body.textContent).not.toContain('"mode"');
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/products/${PRODUCT}/history`);
    fireEvent.click(toggle);
    expect(screen.queryByText('Marketplace upload applied')).toBeNull(); expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(screen.getByText('Price change rule')).toBeTruthy();
  });
  it('shows the exact coverage notice even for an empty history', async () => {
    handler = () => ok({ items: [], nextCursor: null, coverageNotice: NOTICE }); mount(<ProductHistory productId={PRODUCT} />);
    expect(await screen.findByText('No changes recorded for this product yet')).toBeTruthy(); expect(screen.getByText(NOTICE)).toBeTruthy();
  });
  it('shows the product empty state for upload-only results, with notice and an opt-in toggle', async () => {
    handler = () => ok({ items: [event('upload', { scope: 'tenant', productId: null, summary: 'Marketplace upload applied' })], nextCursor: null, coverageNotice: NOTICE });
    mount(<ProductHistory productId={PRODUCT} />);
    expect(await screen.findByText('No changes recorded for this product yet')).toBeTruthy(); expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(screen.queryByText('Marketplace upload applied')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show store-wide upload entries' }));
    expect(screen.getByText('Marketplace upload applied')).toBeTruthy(); expect(screen.queryByText('No changes recorded for this product yet')).toBeNull();
    expect(screen.getByText(/Store-wide context/)).toBeTruthy(); expect(screen.getByText(NOTICE)).toBeTruthy();
  });
  it('keeps Load more available when the current page contains only hidden uploads', async () => {
    handler = u => ok({ items: [u.searchParams.has('cursor') ? event('product-change') : event('upload', { scope: 'tenant', productId: null })], nextCursor: u.searchParams.has('cursor') ? null : 'next', coverageNotice: NOTICE });
    mount(<ProductHistory productId={PRODUCT} />);
    await screen.findByText('No changes recorded for this product yet');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Price change product-change')).toBeTruthy(); expect(screen.queryByText('Price change upload')).toBeNull(); expect(screen.getByText(NOTICE)).toBeTruthy();
  });
  it.each(['activity.view', 'products.view'])('requires %s for history', permission => { perms.delete(permission); mount(<ProductHistory productId={PRODUCT} />); expect(screen.queryByRole('region', { name: 'History' })).toBeNull(); expect(fetchMock).not.toHaveBeenCalled(); });
  it('keeps existing history when loading another page fails, with a request ID and retry', async () => {
    let attempts = 0;
    handler = u => !u.searchParams.has('cursor') ? ok({ items: [event('one')], nextCursor: 'next', coverageNotice: NOTICE }) : ++attempts === 1
      ? new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }, requestId: 'history-request' }), { status: 500 })
      : ok({ items: [event('two')], nextCursor: null, coverageNotice: NOTICE });
    mount(<ProductHistory productId={PRODUCT} />); await screen.findByText('Price change one'); fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Request ID: history-request'); expect(screen.getByText('Price change one')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Price change two')).toBeTruthy(); expect(screen.getByText('Price change one')).toBeTruthy();
  });
});
