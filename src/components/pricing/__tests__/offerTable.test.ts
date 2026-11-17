import { describe, expect, it } from 'vitest';
import type { ProductItem } from '../../../api/products';
import {
  applyToAll, endOfQatarDay, isCalendarDate, itemsOf, normalPriceOf, offPercent, offText, qatarToday, readBulkOfferPreview,
  readBulkOfferResult, rowFrom, rowProblems, startOfQatarDay, warningSummary, type OfferRow,
} from '../offerTable';

const TODAY = '2026-11-17';
const item = (over: Partial<ProductItem> = {}): ProductItem => ({
  id: 'p1', barcode: '0001', sku: null, nameEn: 'Milk', nameAr: null, brand: null, erpCategory: null, categoryId: null, subcategoryId: null,
  erpPrice: 9, erpStock: 1, status: 'active', inLatestErpFile: true, updatedAt: '2026-11-01T00:00:00Z', normalPrice: 10, ...over,
});
const row = (over: Partial<OfferRow> = {}): OfferRow => ({ ...rowFrom(item(), TODAY), price: '8', end: '2026-11-30', ...over });

describe('Qatar calendar dates', () => {
  it('today is the Qatar date (UTC+3), even late in the UTC day', () => {
    expect(qatarToday(Date.parse('2026-11-17T20:59:00Z'))).toBe('2026-11-17');
    expect(qatarToday(Date.parse('2026-11-17T21:00:00Z'))).toBe('2026-11-18');
  });
  it('a start day begins at 00:00 and an end day lasts until 23:59:59.999, Qatar time', () => {
    expect(startOfQatarDay('2026-12-01')).toBe('2026-12-01T00:00:00.000+03:00');
    expect(endOfQatarDay('2026-12-15')).toBe('2026-12-15T23:59:59.999+03:00');
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-02-28')).toBe(true);
  });
});

describe('normal price and Off %', () => {
  it('uses normalPrice, else the resolved price when no offer sets it, else unknown', () => {
    expect(normalPriceOf(item())).toBe(10);
    expect(normalPriceOf(item({ normalPrice: undefined, marketplacePrice: { price: 12, source: 'product' } }))).toBe(12);
    expect(normalPriceOf(item({ normalPrice: undefined, marketplacePrice: { price: 7, source: 'offer' } }))).toBeNull();
  });
  it('is the discount from the normal price, one decimal', () => {
    expect(offPercent(10, '8')).toBe(20);
    expect(offPercent(12, '10.5')).toBe(12.5);
    expect(offPercent(3, '2')).toBe(33.3);
    expect(offText(offPercent(10, ''))).toBe('—');
    expect(offText(offPercent(null, '8'))).toBe('—');
    expect(offText(offPercent(10, '8'))).toBe('20 %');
  });
});

describe('row checks', () => {
  it('a complete row is ready', () => expect(rowProblems(row(), TODAY)).toEqual([]));
  it('price above 0, at most 3 decimals and below the normal price', () => {
    expect(rowProblems(row({ price: '' }), TODAY)).toEqual(['Enter a promo price']);
    expect(rowProblems(row({ price: '0' }), TODAY)).toEqual(['Promo price must be above 0']);
    expect(rowProblems(row({ price: '8.1234' }), TODAY)).toEqual(['Use at most 3 decimals']);
    expect(rowProblems(row({ price: '10' }), TODAY)).toEqual(['Promo price must be below the normal price (10.00 QAR)']);
    expect(rowProblems(row({ price: '50', normalPrice: null }), TODAY)).toEqual([]);
  });
  it('end date required, not before the start, nothing in the past; same day allowed', () => {
    expect(rowProblems(row({ end: '' }), TODAY)).toEqual(['Enter an end date']);
    expect(rowProblems(row({ start: '2026-12-05', end: '2026-12-01' }), TODAY)).toEqual(['End date is before the start date']);
    expect(rowProblems(row({ end: '2026-11-16' }), TODAY)).toEqual(['End date is in the past']);
    expect(rowProblems(row({ start: '2026-11-10' }), TODAY)).toEqual(['Start date is in the past']);
    expect(rowProblems(row({ start: TODAY, end: TODAY }), TODAY)).toEqual([]);
  });
  it('the product must be active; every problem is listed', () => {
    expect(rowProblems(row({ status: 'inactive', price: '', end: '' }), TODAY)).toEqual(['Product is not active', 'Enter a promo price', 'Enter an end date']);
  });
});

describe('items and apply to all', () => {
  it('sends only the valid rows, prices to 3 decimals, start optional', () => {
    const rows = [row({ id: 'a', price: '8.125' }), row({ id: 'b', price: '' }), row({ id: 'c', start: '' })];
    expect(itemsOf(rows, TODAY)).toEqual([
      { productId: 'a', price: 8.125, validFrom: '2026-11-17T00:00:00.000+03:00', validUntil: '2026-11-30T23:59:59.999+03:00' },
      { productId: 'c', price: 8, validUntil: '2026-11-30T23:59:59.999+03:00' },
    ]);
  });
  it('copies only the filled-in values', () => {
    const out = applyToAll([row({ id: 'a', price: '1' }), row({ id: 'b', price: '2' })], { price: '', start: '', end: '2026-12-31' });
    expect(out.map(r => [r.price, r.end])).toEqual([['1', '2026-12-31'], ['2', '2026-12-31']]);
  });
});

describe('reading the answers', () => {
  it('takes the counts and rows it knows, ignores the rest, and counts from rows when counts are missing', () => {
    const p = readBulkOfferPreview({
      rows: [
        { productId: 'a', outcome: 'set', warnings: [{ code: 'replaces_offer' }, { code: 'export_value_outranks', marketplaceId: 'talabat' }] },
        { productId: 'b', outcome: 'rejected', reason: 'price_not_below_normal' },
        { productId: 'c', outcome: 'unchanged' },
        { productId: 'd', outcome: 'weird' },
        'junk',
      ],
      previewToken: 't',
    });
    expect(p).toMatchObject({ willChange: 1, unchanged: 1, rejected: 1, previewToken: 't' });
    expect(p.rows.map(r => r.productId)).toEqual(['a', 'b', 'c']);
    expect(warningSummary(p.rows)).toEqual({ replaces: 1, outranks: [{ marketplaceId: 'talabat', products: 1 }], other: [] });
    expect(readBulkOfferPreview({ willChange: 4, unchanged: 0, rejected: 2, rows: [] })).toMatchObject({ willChange: 4, rejected: 2 });
    expect(readBulkOfferPreview(null)).toEqual({ willChange: 0, unchanged: 0, rejected: 0, rows: [], previewToken: undefined });
    expect(readBulkOfferResult({ replayed: true, willChange: 1 }).replayed).toBe(true);
  });
});
