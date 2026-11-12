import { describe, expect, it } from 'vitest';
import { readExportCounts, readValueItem, type MarketplaceValueItem } from '../../../api/marketplaceValues';
import type { ReconRow } from '../../../api/recon';
import { applySet, applyUseCatalogue, differsFromRule, resaveWithPersistent, rowState, valueErrors } from '../logic';
import { buildBulkRequest } from '../BulkValuesDialog';
import { readState } from '../urlState';
import { ApiError } from '../../../api/client';

const item = (over: Partial<MarketplaceValueItem> = {}): MarketplaceValueItem => ({
  productId: 'p1', marketplaceId: 'talabat', version: null,
  catalogue: { available: true, price: 12.5 },
  marketplaceCurrent: { available: false, price: 13 },
  export: { available: true, price: 12.5, availabilitySource: 'catalogue', priceSource: 'catalogue' },
  overrides: { availability: null, price: null },
  exportState: 'catalogue', exportStateLabel: null, blockedReason: null, blockedReasonLabel: null, rulePrice: 12.5,
  ...over,
});
const row = (mv: unknown, status: ReconRow['status'] = 'mismatch') => ({ productId: 'p1', status, marketplaceValues: mv }) as ReconRow;

describe('export value logic', () => {
  it('reads only items shaped like the proposal; anything else is "not available"', () => {
    expect(readValueItem(item())).toEqual(item());
    expect(readValueItem({ productId: 'p1' })).toBeUndefined();
    expect(readValueItem({ ...item(), exportState: 'later' })).toBeUndefined();
    expect(readValueItem(undefined)).toBeUndefined();
    // Blocked reason in words when the server sends only the code.
    expect(readValueItem({ ...item(), exportState: 'blocked', blockedReason: 'erp_inactive' })?.blockedReasonLabel).toBe('Inactive in the ERP');
  });

  it('reads the waiting, pinned and blocked counts, and leaves them out when not sent', () => {
    expect(readExportCounts({ waitingForExport: 3, pinned: 1, blockedExportProducts: 2 })).toEqual({ waitingForExport: 3, pinned: 1, blocked: 2 });
    expect(readExportCounts({})).toEqual({ waitingForExport: undefined, pinned: undefined, blocked: undefined });
  });

  it('a fix-once set waits for export; a pinned value the marketplace already shows is "Pinned"', () => {
    const fixOnce = applySet(item(), { availability: { value: false } });
    expect(fixOnce.exportState).toBe('waiting_for_export');
    expect(fixOnce.export).toMatchObject({ available: false, availabilitySource: 'override' });
    expect(fixOnce.overrides.availability).toMatchObject({ value: false, state: 'pending', persistent: false });
    expect(applySet(item(), { availability: { value: false, persistent: true } }).exportState).toBe('pinned');
    expect(applySet(item(), { availability: { value: true, persistent: true } }).exportState).toBe('waiting_for_export');
  });

  it('a typed price differs from the rule price in whole fils', () => {
    expect(differsFromRule(applySet(item(), { price: { value: 13 } }))).toBe(true);
    expect(differsFromRule(applySet(item(), { price: { value: 12.5 } }))).toBe(false);
  });

  it('"use catalogue value" clears the field: no row left = catalogue, a kept row = cleared', () => {
    const set = applySet(item(), { price: { value: 13 } });
    expect(applyUseCatalogue(set, ['price'])).toMatchObject({ exportState: 'catalogue', export: { price: 12.5, priceSource: 'catalogue' } });
    expect(applyUseCatalogue({ ...set, version: { id: 'v', version: 2 } }, ['price']).exportState).toBe('cleared');
  });

  it('"Keep until I remove it" re-saves only the adjusted fields', () => {
    expect(resaveWithPersistent(item(), true)).toBeNull();
    expect(resaveWithPersistent(applySet(item(), { price: { value: 13 } }), true)).toEqual({ price: { value: 13, persistent: true } });
  });

  it('the state badge in words', () => {
    expect(rowState(row(item())).label).toBe('Needs fix');
    expect(rowState(row(item(), 'in_sync')).label).toBe('In sync');
    expect(rowState(row(applySet(item(), { price: { value: 13 } }))).label).toBe('Adjusted, waiting for export');
    expect(rowState(row({ ...item(), exportState: 'blocked', blockedReason: 'inactive' }))).toMatchObject({ label: 'Blocked', detail: 'Product is inactive' });
    expect(rowState(row({ ...item(), exportState: 'pinned' })).label).toBe('Pinned');
    expect(rowState(row({ ...item(), exportState: 'cleared' }, 'in_sync')).label).toBe('Cleared');
  });

  it('errors in plain words: 409 is stale, 403 the permission, 400 the field message', () => {
    expect(valueErrors(new ApiError(409, 'CONFLICT', 'Conflict')).stale).toBe(true);
    expect(valueErrors(new ApiError(403, 'FORBIDDEN', 'Forbidden')).general).toMatch(/do not have permission to change the marketplace values/);
    expect(valueErrors(new ApiError(400, 'VALIDATION', 'Validation failed', [{ path: 'values.price.value', message: 'Too high' }])).fields.price).toBe('Too high');
  });

  it('builds the bulk request; ticked rows at most 500; a bad price is caught before any call', () => {
    const base = { marketplaceId: 'talabat' as const, scope: 'ticked' as const, tickedIds: ['a', 'a', 'b'], filter: { type: 'all' as const }, price: '', keep: true, fields: 'both' as const };
    expect(buildBulkRequest({ ...base, kind: 'unavailable' }).request).toEqual({
      marketplaceId: 'talabat', selection: { productIds: ['a', 'b'] }, action: { type: 'set', values: { availability: { value: false, persistent: true } } },
    });
    expect(buildBulkRequest({ ...base, kind: 'price', price: '0' }).error?.price).toMatch(/above 0/);
    expect(buildBulkRequest({ ...base, kind: 'use_catalogue', scope: 'filter' }).request?.selection).toEqual({ filter: { type: 'all' } });
    expect(buildBulkRequest({ ...base, kind: 'remove', fields: 'price' }).request?.action).toEqual({ type: 'use_catalogue', fields: ['price'] });
    expect(buildBulkRequest({ ...base, kind: 'available', tickedIds: Array.from({ length: 501 }, (_, i) => String(i)) }).error?.selection).toMatch(/at most 500/);
  });

  it('reads the URL state with safe defaults', () => {
    expect(readState(new URLSearchParams(''))).toEqual({ marketplace: null, step: 'review', show: 'needs', type: 'all', reference: undefined });
    expect(readState(new URLSearchParams('marketplace=snoonu&step=export&show=pinned&type=price&reference=erp')))
      .toEqual({ marketplace: 'snoonu', step: 'export', show: 'pinned', type: 'price', reference: 'erp' });
    expect(readState(new URLSearchParams('step=nope&show=x')).step).toBe('review');
  });
});
