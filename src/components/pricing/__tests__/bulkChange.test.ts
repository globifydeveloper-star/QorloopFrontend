import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import type { BulkApplyResult, BulkPreview, BulkPriceRequest } from '../../../api/pricing';
import {
  BULK_START, actionText, buildBulkRequest, bulkReducer, newIdempotencyKey, selectionCount, selectionCountText, selectionProblem, type BulkForm, type BulkState,
} from '../bulkChange';
import { changeErrors, priceText, readInlineValue, signedPrice } from '../priceChange';

const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;
const REQUEST: BulkPriceRequest = { marketplaceId: 'talabat', selection: { productIds: ['a', 'b'] }, action: { type: 'increase_percent', percent: 5, rounding: '0.05' } };
const counts = { selected: 2, willChange: 1, unchanged: 0, blocked: 1, blockedReasons: [], otherMarketplaces: [] };
const PREVIEW: BulkPreview = {
  marketplaceId: 'talabat', action: REQUEST.action, selection: REQUEST.selection, limit: 5000, ...counts,
  largestIncrease: null, largestDecrease: null, rows: [], previewToken: 'f'.repeat(64),
};
const RESULT: BulkApplyResult = { operationId: 'op-1', replayed: false, appliedAt: '2026-11-02T06:00:00.000Z', ...counts, created: 1, replaced: 0, removed: 0 };
const network = new ApiError(0, 'NETWORK', 'We could not reach the server. Check your connection and try again.');
const stale = new ApiError(409, 'CONFLICT', 'Prices or rules changed since the preview; preview again before applying');

const run = (events: Parameters<typeof bulkReducer>[1][], from: BulkState = BULK_START) => events.reduce(bulkReducer, from);
const toConfirm = () => run([{ type: 'preview', request: REQUEST }, { type: 'previewed', preview: PREVIEW }, { type: 'confirm' }]);

describe('bulk state machine: preview → confirm → apply', () => {
  it('walks choose → previewing → preview → confirm → applying → done, creating the key at the first apply', () => {
    let s = bulkReducer(BULK_START, { type: 'preview', request: REQUEST });
    expect(s).toEqual({ phase: 'previewing', request: REQUEST });
    s = bulkReducer(s, { type: 'previewed', preview: PREVIEW });
    expect(s).toMatchObject({ phase: 'preview', request: REQUEST, preview: PREVIEW });
    expect(s.idempotencyKey).toBeUndefined();
    s = bulkReducer(s, { type: 'confirm' });
    expect(s.phase).toBe('confirm');
    const newKey = vi.fn(() => 'key-0001');
    s = bulkReducer(s, { type: 'apply', newKey });
    expect(s).toMatchObject({ phase: 'applying', idempotencyKey: 'key-0001' });
    expect(newKey).toHaveBeenCalledTimes(1);
    s = bulkReducer(s, { type: 'applied', result: RESULT });
    expect(s).toMatchObject({ phase: 'done', result: RESULT, idempotencyKey: 'key-0001' });
  });

  it('a failed apply stays on the confirmation and every retry reuses the same key', () => {
    const newKey = vi.fn(() => `key-${newKey.mock.calls.length}xxxx`);
    let s = bulkReducer(toConfirm(), { type: 'apply', newKey });
    const key = s.idempotencyKey;
    s = bulkReducer(s, { type: 'applyFailed', error: network });
    expect(s).toMatchObject({ phase: 'confirm', idempotencyKey: key, error: network });
    s = bulkReducer(s, { type: 'apply', newKey });
    expect(s).toMatchObject({ phase: 'applying', idempotencyKey: key, error: undefined });
    // Cancelling the confirmation and confirming again is still the same intended change.
    s = run([{ type: 'applyFailed', error: new ApiError(500, 'INTERNAL_ERROR', 'Internal server error') }, { type: 'cancel' }, { type: 'confirm' }, { type: 'apply', newKey }], s);
    expect(s.idempotencyKey).toBe(key);
    expect(newKey).toHaveBeenCalledTimes(1);
  });

  it('a 409 drops the key and asks for a new preview; the next confirmation gets a new key', () => {
    let s = run([{ type: 'apply', newKey: () => 'first-key' }, { type: 'applyFailed', error: stale }], toConfirm());
    expect(s).toMatchObject({ phase: 'preview', stale: true, error: stale, idempotencyKey: undefined });
    expect(bulkReducer(s, { type: 'confirm' })).toBe(s); // no apply from a stale preview
    s = run([{ type: 'preview', request: REQUEST }, { type: 'previewed', preview: { ...PREVIEW, previewToken: 'e'.repeat(64) } }, { type: 'confirm' }, { type: 'apply', newKey: () => 'second-key' }], s);
    expect(s).toMatchObject({ phase: 'applying', idempotencyKey: 'second-key' });
    expect(s.stale).toBeUndefined();
    expect(s.preview?.previewToken).toBe('e'.repeat(64));
  });

  it('editing after a preview forgets the preview and the key', () => {
    const s = run([{ type: 'apply', newKey: () => 'k-123456' }, { type: 'applyFailed', error: network }, { type: 'cancel' }, { type: 'edit' }], toConfirm());
    expect(s).toEqual({ phase: 'choose' });
  });

  it('ignores events that do not fit: a double preview, a late answer, nothing to change, a double apply', () => {
    const previewing = bulkReducer(BULK_START, { type: 'preview', request: REQUEST });
    expect(bulkReducer(previewing, { type: 'preview', request: REQUEST })).toBe(previewing);
    expect(bulkReducer(BULK_START, { type: 'previewed', preview: PREVIEW })).toBe(BULK_START);
    const nothing = run([{ type: 'previewed', preview: { ...PREVIEW, willChange: 0 } }], previewing);
    expect(bulkReducer(nothing, { type: 'confirm' })).toBe(nothing);
    const applying = bulkReducer(toConfirm(), { type: 'apply', newKey: () => 'k-123456' });
    expect(bulkReducer(applying, { type: 'apply', newKey: () => 'other-key' })).toBe(applying);
    expect(bulkReducer(applying, { type: 'cancel' })).toBe(applying);
    expect(bulkReducer(applying, { type: 'edit' })).toBe(applying);
  });

  it('a failed preview goes back to the form with the error', () => {
    const e = new ApiError(400, 'VALIDATION_ERROR', 'Validation failed');
    expect(run([{ type: 'preview', request: REQUEST }, { type: 'previewFailed', error: e }])).toEqual({ phase: 'choose', error: e });
  });
});

describe('idempotency key', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is a UUID the apply contract accepts, new each time', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(KEY_RE);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  it('works without crypto.randomUUID (plain http)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: (b: Uint8Array<ArrayBuffer>) => real.getRandomValues(b) });
    const key = newIdempotencyKey();
    expect(key).toMatch(KEY_RE);
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

const form = (over: Partial<BulkForm> = {}): BulkForm => ({
  marketplaceId: 'talabat', scope: 'ticked', tickedIds: ['a', 'b'], filter: {}, filterActiveCount: 3,
  action: 'increase_percent', value: '5', rounding: 'none', ...over,
});

describe('bulk request: limits before the API', () => {
  it('refuses more than 500 ticked rows and more than 5,000 products by filter, in plain words', () => {
    const many = Array.from({ length: 501 }, (_, i) => `id-${i}`);
    expect(selectionProblem({ scope: 'ticked', tickedIds: many })).toBe(
      'You ticked 501 products. A change of ticked rows can include at most 500; use the search and category filter instead (up to 5,000 products).',
    );
    expect(buildBulkRequest(form({ tickedIds: many }))).toEqual({ errors: { selection: expect.stringContaining('at most 500') } });
    expect(selectionProblem({ scope: 'ticked', tickedIds: many.slice(0, 500) })).toBeUndefined();

    expect(buildBulkRequest(form({ scope: 'filter', filterActiveCount: 5001 })).errors?.selection).toBe(
      'The current search and category match 5,001 active products. One change can price at most 5,000; narrow the search or category.',
    );
    expect(selectionProblem({ scope: 'filter', tickedIds: [], filterActiveCount: 5000 })).toBeUndefined();
    expect(selectionProblem({ scope: 'filter', tickedIds: [], filterActiveCount: 0 })).toBe('No active products match the current search and category.');
    expect(selectionProblem({ scope: 'ticked', tickedIds: [] })).toBe('Tick at least one product in the list.');
    // Not known yet: the server decides (it refuses more than 5,000 with the count).
    expect(selectionProblem({ scope: 'filter', tickedIds: [], filterActiveCount: undefined })).toBeUndefined();
  });

  it('builds each action as the contract wants it', () => {
    expect(buildBulkRequest(form({ action: 'set_fixed', value: '12.5' })).request?.action).toEqual({ type: 'set_fixed', price: 12.5 });
    expect(buildBulkRequest(form({ action: 'increase_percent', value: '5', rounding: '0.05' })).request?.action).toEqual({ type: 'increase_percent', percent: 5, rounding: '0.05' });
    expect(buildBulkRequest(form({ action: 'decrease_percent', value: '90', rounding: '0.25' })).request?.action).toEqual({ type: 'decrease_percent', percent: 90, rounding: '0.25' });
    expect(buildBulkRequest(form({ action: 'increase_amount', value: '0.5' })).request?.action).toEqual({ type: 'increase_amount', amount: 0.5, rounding: 'none' });
    expect(buildBulkRequest(form({ action: 'decrease_amount', value: '1.25', rounding: '0.05' })).request?.action).toEqual({ type: 'decrease_amount', amount: 1.25, rounding: '0.05' });
    expect(buildBulkRequest(form({ action: 'match_marketplace', value: 'ignored' })).request?.action).toEqual({ type: 'match_marketplace' });
    expect(buildBulkRequest(form({ action: 'match_erp', value: '' })).request?.action).toEqual({ type: 'match_erp' });
  });

  it('builds the selection: ticked ids once each, or the filter without empty fields', () => {
    expect(buildBulkRequest(form({ tickedIds: ['a', 'b', 'a'] })).request).toEqual({
      marketplaceId: 'talabat', selection: { productIds: ['a', 'b'] }, action: { type: 'increase_percent', percent: 5, rounding: 'none' },
    });
    expect(buildBulkRequest(form({ scope: 'filter', filter: { q: '  ', categoryId: undefined } })).request?.selection).toEqual({ filter: {} });
    expect(buildBulkRequest(form({ scope: 'filter', marketplaceId: 'keeta', filter: { q: ' milk ', categoryId: 'c1', subcategoryId: 's1' } })).request)
      .toMatchObject({ marketplaceId: 'keeta', selection: { filter: { q: 'milk', categoryId: 'c1', subcategoryId: 's1' } } });
  });

  it('checks the value in plain words', () => {
    const err = (over: Partial<BulkForm>) => buildBulkRequest(form(over)).errors?.value;
    expect(err({ action: 'set_fixed', value: '' })).toBe('Enter a price');
    expect(err({ action: 'set_fixed', value: '0' })).toBe('Enter a price above 0 and at most 100,000 QAR');
    expect(err({ action: 'set_fixed', value: '100001' })).toBe('Enter a price above 0 and at most 100,000 QAR');
    expect(err({ action: 'set_fixed', value: '1.2345' })).toBe('Use at most 3 decimal places');
    expect(err({ action: 'set_fixed', value: 'abc' })).toBe('Enter a number');
    expect(err({ action: 'decrease_percent', value: '91' })).toBe('Enter a percent above 0 and at most 90');
    expect(err({ action: 'increase_percent', value: '1001' })).toBe('Enter a percent above 0 and at most 1,000');
    expect(err({ action: 'increase_amount', value: '' })).toBe('Enter an amount');
    expect(err({ action: 'decrease_amount', value: '-1' })).toBe('Enter an amount above 0 and at most 100,000 QAR');
    expect(buildBulkRequest(form({ value: '', tickedIds: [] })).errors).toEqual({ selection: 'Tick at least one product in the list.', value: 'Enter a percent' });
  });

  it('describes the action in words', () => {
    expect(actionText({ type: 'increase_percent', percent: 5, rounding: '0.05' }, 'Talabat')).toBe('Increase by 5 % (round to 0.05)');
    expect(actionText({ type: 'decrease_amount', amount: 0.5, rounding: 'none' }, 'Talabat')).toBe('Decrease by 0.50 QAR');
    expect(actionText({ type: 'set_fixed', price: 6.325 }, 'Talabat')).toBe('Set a fixed price of 6.325 QAR');
    expect(actionText({ type: 'match_marketplace' }, 'Snoonu')).toBe('Match the Snoonu price');
  });
});

describe('bulk request: only price mismatches (listed + reconStatus price_mismatch)', () => {
  const mm = (count: number, more = false) => ({ count, more, reference: 'erp' as const });
  const sel = (over: Partial<BulkForm>) => ({ scope: 'filter' as const, tickedIds: [], marketplaceId: 'talabat' as const, filter: {}, onlyMismatches: true, ...over });

  it('counts before the preview: exact for the whole catalogue, at most within a search or category', () => {
    expect(selectionCount(sel({ onlyMismatches: false, filterActiveCount: 40 }))).toEqual({ value: 40, kind: 'exact' });
    expect(selectionCount(sel({ filterActiveCount: 2431, mismatches: mm(37) }))).toEqual({ value: 37, kind: 'exact' });
    expect(selectionCount(sel({ mismatches: mm(5001, true) }))).toEqual({ value: 5001, kind: 'moreThan' });
    expect(selectionCount(sel({ filter: { q: 'milk' }, filterActiveCount: 12, mismatches: mm(37) }))).toEqual({ value: 12, kind: 'atMost' });
    expect(selectionCount(sel({ filter: { categoryId: 'c1' }, filterActiveCount: 900, mismatches: mm(37) }))).toEqual({ value: 37, kind: 'atMost' });
    expect(selectionCount(sel({ filter: { q: 'milk' }, filterActiveCount: 12, mismatches: mm(6000, true) }))).toEqual({ value: 12, kind: 'atMost' });
    expect(selectionCount(sel({ filterActiveCount: 40 }))).toBeUndefined(); // the mismatches are still being counted
    expect(selectionCountText({ value: 37, kind: 'exact' })).toBe('37');
    expect(selectionCountText({ value: 12, kind: 'atMost' })).toBe('at most 12');
    expect(selectionCountText({ value: 5001, kind: 'moreThan' })).toBe('more than 5,000');
  });

  it('says what is wrong before the API: none, or above 5,000', () => {
    expect(selectionProblem(sel({ mismatches: mm(0) }))).toBe('No active product has a price mismatch on Talabat (as of the last comparison).');
    expect(selectionProblem(sel({ filter: { q: 'milk' }, filterActiveCount: 0, mismatches: mm(37) })))
      .toBe('No active product matching the current search and category has a price mismatch on Talabat.');
    expect(selectionProblem(sel({ mismatches: mm(5200) }))).toBe('5,200 active products have a price mismatch on Talabat. One change can price at most 5,000; narrow the search or category.');
    expect(selectionProblem(sel({ marketplaceId: 'keeta', mismatches: mm(5001, true) })))
      .toBe('More than 5,000 active products have a price mismatch on Keeta. One change can price at most 5,000; narrow the search or category.');
    // Only an upper bound above the limit: the server decides.
    expect(selectionProblem(sel({ filter: { q: 'milk' }, filterActiveCount: 6000, mismatches: mm(6000, true) }))).toBeUndefined();
    expect(selectionProblem(sel({ mismatches: mm(37) }))).toBeUndefined();
  });

  it('sends listed, reconStatus and the reference the count was made with', () => {
    expect(buildBulkRequest(form({ scope: 'filter', filter: { q: 'milk' }, onlyMismatches: true, mismatches: mm(37) })).request?.selection)
      .toEqual({ filter: { q: 'milk', listed: true, reconStatus: 'price_mismatch', reference: 'erp' } });
    // Not counted (yet, or the count failed): the server's default reference.
    expect(buildBulkRequest(form({ scope: 'filter', onlyMismatches: true })).request?.selection)
      .toEqual({ filter: { listed: true, reconStatus: 'price_mismatch' } });
    // Ticked rows are never narrowed by the filter.
    expect(buildBulkRequest(form({ scope: 'ticked', onlyMismatches: true, mismatches: mm(37) })).request?.selection).toEqual({ productIds: ['a', 'b'] });
    expect(buildBulkRequest(form({ scope: 'filter', onlyMismatches: true, mismatches: mm(0) })).errors?.selection)
      .toBe('No active product has a price mismatch on Talabat (as of the last comparison).');
  });
});

describe('inline value and error text', () => {
  it('reads a fixed price or a percent over the ERP price, with the contract bounds', () => {
    expect(readInlineValue('fixed', '12.5')).toEqual({ value: 12.5 });
    expect(readInlineValue('fixed', '')).toEqual({ error: 'Enter a price' });
    expect(readInlineValue('fixed', '0').error).toBe('Enter a price above 0 and at most 100,000 QAR');
    expect(readInlineValue('fixed', '100000')).toEqual({ value: 100000 });
    expect(readInlineValue('percent', '-90')).toEqual({ value: -90 });
    expect(readInlineValue('percent', '1000')).toEqual({ value: 1000 });
    expect(readInlineValue('percent', '-90.5').error).toBe('Enter a percent from -90 to 1,000');
    expect(readInlineValue('percent', '')).toEqual({ error: 'Enter a percent' });
  });

  it('shows prices as stored (whole fils), signed differences', () => {
    expect(priceText(6.325)).toBe('6.325');
    expect(priceText(12.5)).toBe('12.50');
    expect(priceText(4.4)).toBe('4.40');
    expect(priceText(null)).toBe('—');
    expect(signedPrice(0.2)).toBe('+0.20');
    expect(signedPrice(-0.025)).toBe('−0.025');
    expect(signedPrice(0)).toBe('0.00');
  });

  it('turns API errors into plain words, never a bare "Validation failed"', () => {
    const v = new ApiError(400, 'VALIDATION_ERROR', 'Validation failed', [
      { path: 'value', message: 'The new price would be above 100,000 QAR' },
      { path: 'offer', message: 'A current offer sets this price; change or remove the offer first' },
    ]);
    expect(changeErrors(v, ['value'])).toEqual({ fields: { value: 'The new price would be above 100,000 QAR' }, general: 'A current offer sets this price; change or remove the offer first' });
    expect(changeErrors(v, ['value', 'offer'])).toEqual({ fields: { value: 'The new price would be above 100,000 QAR', offer: 'A current offer sets this price; change or remove the offer first' } });
    expect(changeErrors(new ApiError(400, 'VALIDATION_ERROR', 'Validation failed')).general).toBe('Some values were not accepted. Check them and try again.');
    expect(changeErrors(new ApiError(400, 'VALIDATION_ERROR', 'Only an active product can be priced; activate it first')).general).toBe('Only an active product can be priced; activate it first');
    expect(changeErrors(new ApiError(403, 'FORBIDDEN', 'Forbidden')).general).toBe('You do not have permission to change prices.');
    expect(changeErrors(new ApiError(404, 'NOT_FOUND', 'Product not found')).general).toBe('This product was not found. It may have been removed; reload the page.');
    expect(changeErrors(stale).general).toBe('Prices or rules changed since the preview; preview again before applying');
    expect(changeErrors(new Error('boom')).general).toBe('Something went wrong. Please try again.');
    expect(changeErrors(undefined)).toEqual({ fields: {} });
  });
});
