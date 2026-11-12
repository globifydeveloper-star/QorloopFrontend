import { describe, expect, it } from 'vitest';
import { readExportCounts, readPreview, readValueItem, type MarketplaceValueItem } from '../../../api/marketplaceValues';
import type { ReconRow } from '../../../api/recon';
import { applySet, applyUseCatalogue, differsFromRule, fieldSource, resaveWithPersistent, rowState, sourceText, valueErrors } from '../logic';
import { actionText, buildBulkRequest } from '../BulkValuesDialog';
import { bulkFilter, readState } from '../urlState';
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
    const base = { marketplaceId: 'talabat' as const, scope: 'ticked' as const, tickedIds: ['a', 'a', 'b'], filter: { show: 'all' as const }, price: '', keep: true, fields: 'both' as const };
    expect(buildBulkRequest({ ...base, kind: 'unavailable' }).request).toEqual({
      marketplaceId: 'talabat', selection: { productIds: ['a', 'b'] }, action: { type: 'set', values: { availability: { value: false, persistent: true } } },
    });
    expect(buildBulkRequest({ ...base, kind: 'price', price: '0' }).error?.price).toMatch(/above 0/);
    expect(buildBulkRequest({ ...base, kind: 'use_catalogue', scope: 'filter' }).request?.selection).toEqual({ filter: { show: 'all' } });
    expect(buildBulkRequest({ ...base, kind: 'remove', fields: 'price' }).request?.action).toEqual({ type: 'use_catalogue', fields: ['price'] });
    expect(buildBulkRequest({ ...base, kind: 'available', tickedIds: Array.from({ length: 501 }, (_, i) => String(i)) }).error?.selection).toMatch(/at most 500/);
  });

  it('builds "Fill from another marketplace": price only by default, never from itself', () => {
    const base = { marketplaceId: 'talabat' as const, scope: 'filter' as const, tickedIds: [], filter: { show: 'all' as const }, price: '', keep: false, fields: 'both' as const, kind: 'copy' as const };
    expect(buildBulkRequest({ ...base, copyFrom: 'snoonu' }).request).toEqual({
      marketplaceId: 'talabat', selection: { filter: { show: 'all' } }, action: { type: 'copy_from_marketplace', sourceMarketplaceId: 'snoonu', fields: ['price'] },
    });
    expect(buildBulkRequest({ ...base, copyFrom: 'snoonu', copyWhat: 'availability' }).request?.action).toMatchObject({ fields: ['availability'] });
    expect(buildBulkRequest({ ...base, copyFrom: 'snoonu', copyWhat: 'both' }).request?.action).toMatchObject({ fields: ['availability', 'price'] });
    expect(buildBulkRequest({ ...base, copyFrom: 'talabat' }).error?.source).toMatch(/cannot fill Talabat from itself/);
    expect(buildBulkRequest(base).error?.source).toBe('Choose the marketplace to fill from.');
  });

  it('the bulk filter uses only the keys the backend accepts (its Review list filter)', () => {
    expect(bulkFilter('needs', 'all')).toEqual({ exportState: 'to_fix' });
    expect(bulkFilter('waiting', 'price')).toEqual({ exportState: 'waiting_for_export', field: 'price' });
    expect(bulkFilter('pinned', 'stock')).toEqual({ exportState: 'pinned', field: 'availability' });
    expect(bulkFilter('blocked', 'all')).toEqual({ exportState: 'blocked' });
    expect(bulkFilter('all', 'all')).toEqual({ show: 'all' });
    const allowed = ['show', 'exportState', 'field', 'q', 'categoryId', 'subcategoryId'];
    for (const s of ['needs', 'waiting', 'pinned', 'blocked', 'all'] as const) {
      for (const t of ['all', 'stock', 'price'] as const) expect(Object.keys(bulkFilter(s, t)).every(k => allowed.includes(k))).toBe(true);
    }
  });

  it('the action in words', () => {
    expect(actionText({ type: 'copy_from_marketplace', sourceMarketplaceId: 'snoonu', fields: ['price'] })).toBe('Fill the price from Snoonu');
    expect(actionText({ type: 'copy_from_marketplace', sourceMarketplaceId: 'talabat', fields: ['availability', 'price'] })).toBe('Fill the price and availability from Talabat');
    expect(actionText({ type: 'use_catalogue', fields: ['availability', 'price'] })).toBe('Use the catalogue values');
  });

  it('reads the bulk preview as built (reason lists, per-field changes) and as first proposed (reason maps, whole items)', () => {
    const built = readPreview({
      selected: 3, willChange: 1, unchanged: 0, blocked: 1, notOnSource: 1, pinnedKept: 0, previewToken: 'f'.repeat(64),
      blockedByReason: [{ reason: 'erp_inactive', label: 'Inactive in the ERP', count: 1 }, { reason: 'not_listed', label: 'x', count: 0 }],
      notOnSourceByReason: [{ reason: 'source_price_invalid', label: null, count: 1 }],
      source: { marketplaceId: 'snoonu', latestFile: { uploadId: 'u1', fileName: 's.xlsx', uploadedAt: '2026-11-10T05:00:00.000Z', appliedAt: null } },
      rows: [
        { productId: 'p1', nameEn: 'Milk', barcode: '62', source: { available: true, price: '4.25', uploadId: 'u1', fileName: 's.xlsx', isLatestFile: false }, changes: [{ field: 'price', op: 'set', before: 4.5, after: 4.25 }, { field: 'stock', op: 'set' }] },
        { productId: 'p2', source: null, changes: [] },
        { productId: 'p3', changes: [{ field: 'availability', op: 'clear', before: false, after: true }] },
      ],
    });
    expect(built.blockedByReason).toEqual([{ reason: 'erp_inactive', label: 'Inactive in the ERP', count: 1 }]);
    expect(built.notOnSourceByReason).toEqual([{ reason: 'source_price_invalid', label: null, count: 1 }]);
    expect(built.source?.latestFile?.fileName).toBe('s.xlsx');
    expect(built.rows[0]).toMatchObject({ nameEn: 'Milk', source: { price: 4.25, isLatestFile: false }, changes: [{ field: 'price', op: 'set', before: 4.5, after: 4.25 }] });
    expect(built.rows[1].source).toBeNull(); // not on the source marketplace
    expect('source' in built.rows[2]).toBe(false); // not a copy row
    expect(built.rows[2].changes).toEqual([{ field: 'availability', op: 'clear', before: false, after: true }]);

    const proposed = readPreview({ selected: 1, willChange: 1, unchanged: 0, blocked: 0, blockedByReason: { inactive: 2 }, rows: [{ productId: 'p1', before: item(), after: item() }] });
    expect(proposed.blockedByReason).toEqual([{ reason: 'inactive', label: null, count: 2 }]);
    expect(proposed).toMatchObject({ notOnSource: 0, pinnedKept: 0, source: null });
    expect(proposed.rows[0]).toMatchObject({ before: item(), changes: null });
  });

  it('says where each value to export comes from', () => {
    expect(sourceText(item())).toBe('Availability and price from the catalogue');
    const meta = (reason: string | null, extra = {}) => ({ value: 4.25, state: 'pending' as const, persistent: false, fieldState: null, setAt: '', reason, clearedAt: null, ...extra });
    const withPrice = (m: ReturnType<typeof meta>) => item({ export: { ...item().export, priceSource: 'override', price: 4.25 }, overrides: { availability: null, price: m } });
    expect(sourceText(withPrice(meta('Copied from Snoonu')))).toBe('Availability from the catalogue · price from Snoonu');
    expect(fieldSource(withPrice(meta(null, { sourceMarketplaceId: 'talabat' })), 'price', id => (id === 'talabat' ? 'Talabat' : id))).toEqual({ kind: 'marketplace', name: 'Talabat' });
    expect(sourceText(withPrice(meta('Promo week')))).toBe('Availability from the catalogue · price adjusted by hand');
    expect(fieldSource(item({ export: { ...item().export, availabilitySource: 'eligibility_guard', available: false } }), 'availability').kind).toBe('guard');
    // The server's `sourceMarketplaceId` on a field is kept by the reader.
    expect(readValueItem({ ...item(), overrides: { availability: null, price: meta(null, { sourceMarketplaceId: 'snoonu' }) } })?.overrides.price?.sourceMarketplaceId).toBe('snoonu');
  });

  it('reads the URL state with safe defaults', () => {
    expect(readState(new URLSearchParams(''))).toEqual({ marketplace: null, step: 'review', show: 'needs', type: 'all', reference: undefined });
    expect(readState(new URLSearchParams('marketplace=snoonu&step=export&show=pinned&type=price&reference=erp')))
      .toEqual({ marketplace: 'snoonu', step: 'export', show: 'pinned', type: 'price', reference: 'erp' });
    expect(readState(new URLSearchParams('step=nope&show=x')).step).toBe('review');
  });
});
