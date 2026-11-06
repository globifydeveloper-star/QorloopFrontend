import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/client';
import {
  buildStockBulkRequest, bulkMachine, changeValue, readStock, stockErrors, stockSelectionProblem, unavailableReasons,
  type BulkMachine, type StockBulkForm,
} from '../stockLogic';

type Prev = { willChange: number; previewToken: string };
const reduce = bulkMachine<{ id: number }, Prev, { replayed: boolean }>(p => p.willChange);
const run = (events: Parameters<typeof reduce>[1][], from: BulkMachine<{ id: number }, Prev, { replayed: boolean }> = { phase: 'choose' }) => events.reduce(reduce, from);
const conflict = new ApiError(409, 'CONFLICT', 'The stock of the selected products changed since the preview; preview again before applying');
const lost = new ApiError(0, 'NETWORK', 'offline');

describe('bulk state machine', () => {
  const toConfirm = [{ type: 'preview', request: { id: 1 } }, { type: 'previewed', preview: { willChange: 2, previewToken: 't' } }, { type: 'confirm' }] as const;

  it('choose → previewing → preview → confirm → applying → done', () => {
    let s = run([...toConfirm]);
    expect(s.phase).toBe('confirm');
    s = reduce(s, { type: 'apply', newKey: () => 'key-1' });
    expect([s.phase, s.idempotencyKey]).toEqual(['applying', 'key-1']);
    s = reduce(s, { type: 'applied', result: { replayed: false } });
    expect(s.phase).toBe('done');
  });

  it('reuses the idempotency key on every retry after a lost answer', () => {
    let s = run([...toConfirm, { type: 'apply', newKey: () => 'key-1' }, { type: 'applyFailed', error: lost }]);
    expect([s.phase, s.idempotencyKey]).toEqual(['confirm', 'key-1']);
    s = reduce(s, { type: 'apply', newKey: () => 'key-2' });
    expect(s.idempotencyKey).toBe('key-1');
  });

  it('a 409 goes back to a stale preview, drops the key and cannot be confirmed until previewed again', () => {
    let s = run([...toConfirm, { type: 'apply', newKey: () => 'key-1' }, { type: 'applyFailed', error: conflict }]);
    expect([s.phase, s.stale, s.idempotencyKey]).toEqual(['preview', true, undefined]);
    expect(reduce(s, { type: 'confirm' }).phase).toBe('preview');
    s = run([{ type: 'preview', request: { id: 1 } }, { type: 'previewed', preview: { willChange: 1, previewToken: 'u' } }, { type: 'confirm' }, { type: 'apply', newKey: () => 'key-2' }], s);
    expect(s.idempotencyKey).toBe('key-2');
  });

  it('nothing to change cannot be confirmed; late or doubled events change nothing', () => {
    const s = run([{ type: 'preview', request: { id: 1 } }, { type: 'previewed', preview: { willChange: 0, previewToken: 't' } }, { type: 'confirm' }]);
    expect(s.phase).toBe('preview');
    expect(reduce({ phase: 'choose' }, { type: 'applied', result: { replayed: true } }).phase).toBe('choose');
    expect(reduce({ phase: 'choose' }, { type: 'apply', newKey: () => 'k' }).phase).toBe('choose');
  });
});

describe('values and limits', () => {
  it('reads a whole, non-negative stock up to the Postgres int', () => {
    expect(readStock('12')).toEqual({ value: 12 });
    expect(readStock('0')).toEqual({ value: 0 });
    expect(readStock('').error).toBe('Enter a stock quantity');
    expect(readStock('-1').error).toBe('Enter a whole number of 0 or more');
    expect(readStock('1.5').error).toBe('Enter a whole number of 0 or more');
    expect(readStock('2147483648').error).toBe('Enter at most 2,147,483,647');
  });

  const form = (over: Partial<StockBulkForm> = {}): StockBulkForm => ({ scope: 'ticked', tickedIds: ['a'], filter: {}, mode: 'set', value: '4', reason: '', ...over });
  it('checks the 500 ticked and 5,000 filter limits before any call', () => {
    expect(stockSelectionProblem(form({ tickedIds: [] }))).toBe('Tick at least one product in the list.');
    expect(stockSelectionProblem(form({ tickedIds: Array.from({ length: 501 }, (_, i) => String(i)) }))).toMatch(/at most 500/);
    expect(stockSelectionProblem(form({ scope: 'filter', filterCount: 5001 }))).toMatch(/5,001 products.*at most 5,000/);
    expect(stockSelectionProblem(form({ scope: 'filter', filterCount: 5000 }))).toBeUndefined();
    expect(buildStockBulkRequest(form({ scope: 'filter', filterCount: 6000 })).errors?.selection).toMatch(/5,000/);
  });

  it('builds set and reset-to-ERP bodies, deduplicating ticked ids and dropping an empty reason', () => {
    expect(buildStockBulkRequest(form({ tickedIds: ['a', 'a', 'b'], reason: ' counted ' })).request)
      .toEqual({ selection: { productIds: ['a', 'b'] }, action: { mode: 'set', stock: 4 }, reason: 'counted' });
    expect(buildStockBulkRequest(form({ scope: 'filter', filterCount: 3, filter: { q: ' milk ', categoryId: 'c1' }, mode: 'erp', value: '' })).request)
      .toEqual({ selection: { filter: { q: 'milk', categoryId: 'c1' } }, action: { mode: 'erp' } });
    expect(buildStockBulkRequest(form({ value: 'x' })).errors?.value).toBe('Enter a whole number of 0 or more');
  });
});

describe('plain errors', () => {
  it('409 is stale with the reload sentence; 403 and 400 in words; 500 via the shared helper', () => {
    expect(stockErrors(new ApiError(409, 'CONFLICT', 'Conflict')).stale).toBe(true);
    expect(stockErrors(new ApiError(403, 'FORBIDDEN', 'Forbidden')).general).toMatch(/do not have permission to change the catalogue stock/);
    expect(stockErrors(new ApiError(400, 'VALIDATION', 'Validation failed', [{ path: 'stock', message: 'Too big' }]))).toEqual({ fields: { stock: 'Too big' } });
    expect(stockErrors(new ApiError(400, 'VALIDATION', 'Validation failed', [{ path: 'selection', message: 'This selection has 6,000 products' }])).general).toBe('This selection has 6,000 products');
    expect(stockErrors(new ApiError(500, 'ERROR', 'boom', [], 'req-9')).general).toMatch(/Qorloop could not complete this request.*req-9/);
  });
});

describe('labels', () => {
  it('values in words, prices to 3 decimals', () => {
    expect(changeValue('erpPrice', 6.325)).toBe('6.325 QAR');
    expect(changeValue('erpPrice', 6.3)).toBe('6.30 QAR');
    expect(changeValue('erpActive', false)).toBe('Inactive');
    expect(changeValue('inLatestErpFile', false)).toBe('Not in the file');
    expect(changeValue('erpStock', 1200)).toBe('1,200');
    expect(changeValue('nameEn', null)).toBe('—');
  });
  it('why stock cannot make a product available', () => {
    expect(unavailableReasons({ status: 'active', erpActive: true, inLatestErpFile: true })).toEqual([]);
    expect(unavailableReasons({ status: 'inactive', erpActive: false, inLatestErpFile: false }))
      .toEqual(['it is inactive in Qorloop', 'it is inactive in the ERP', 'it is missing from the latest ERP file']);
  });
});
