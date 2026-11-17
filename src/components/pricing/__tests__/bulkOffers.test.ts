import { describe, expect, it, vi } from 'vitest';
import type { ProductItem } from '../../../api/products';
import { previewOffers } from '../bulkOffers';

const product = { id: 'p1', barcode: '00123', nameEn: 'Milk', status: 'active' } as ProductItem;
describe('bulk offer preview', () => {
  it('matches text barcodes and converts Qatar dates for each offer', () => {
    const rows = previewOffers([{ Barcode: '00123', Action: 'set', 'Offer price (QAR)': '8.125', 'Starts (Qatar time)': '2026-12-01 09:30', 'Ends (Qatar time)': '' }], [product]);
    expect(rows[0]).toMatchObject({ product, price: 8.125, validFrom: '2026-12-01T09:30:00+03:00', validUntil: null, error: undefined });
  });
  it('allows clearing without a price and refuses duplicate or unknown products', () => {
    const rows = previewOffers([
      { Barcode: '00123', Action: 'clear' },
      { Barcode: '00123', Action: 'set', 'Offer price (QAR)': '9' },
      { Barcode: '99999', Action: 'clear' },
    ], [product]);
    expect(rows.map(r => r.error)).toEqual([undefined, 'Duplicate barcode in file', 'Product not found']);
  });
  it('blocks invalid price and time before applying any row', () => {
    vi.setSystemTime(new Date('2026-11-13T00:00:00Z'));
    try {
      expect(previewOffers([{ Barcode: '00123', Action: 'set', 'Offer price (QAR)': '8.1234' }], [product])[0].error).toMatch(/price/);
      expect(previewOffers([{ Barcode: '00123', Action: 'set', 'Offer price (QAR)': '8', 'Ends (Qatar time)': '2026-11-01 10:00' }], [product])[0].error).toMatch(/past/);
      expect(previewOffers([{ Barcode: '00123', Action: 'set', 'Offer price (QAR)': '8', 'Starts (Qatar time)': '2026-12-03 10:00', 'Ends (Qatar time)': '2026-12-01 10:00' }], [product])[0].error).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });
});
