import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import type { ProductItem, ProductPage } from '../../../api/products';
import type { Category } from '../../../api/categories';
import { catalogueWorkbook, collectCatalogue } from '../catalogueExport';

const product = (id: string, over: Partial<ProductItem> = {}): ProductItem => ({
  id, barcode: '001234567890123456', sku: '00001', nameEn: '=literal name', nameAr: 'حليب', brand: 'Brand', erpCategory: 'DAIRY',
  categoryId: 'dairy', subcategoryId: null, erpPrice: 12.345, erpStock: 7, catalogueStock: 4, catalogueStockSource: 'owner',
  status: 'active', inLatestErpFile: true, updatedAt: '2026-11-11T08:00:00Z', ...over,
});
const page = (items: ProductItem[], cursor: string | null = null, total = 3): ProductPage => ({ items, nextCursor: cursor, counts: { all: total, active: total, inactive: 0, new: 0, missing: 0 } });

describe('catalogue Excel export', () => {
  it('loads every server page using the current filters, not only the visible rows', async () => {
    const read = vi.fn().mockResolvedValueOnce(page([product('1'), product('2')], 'next')).mockResolvedValueOnce(page([product('3')]));
    const progress = vi.fn();
    const result = await collectCatalogue(read, { tab: 'active', q: 'milk', categoryId: 'dairy' }, new AbortController().signal, progress);
    expect(result.map(p => p.id)).toEqual(['1', '2', '3']);
    expect(read.mock.calls[0][0]).toEqual({ tab: 'active', q: 'milk', categoryId: 'dairy', cursor: undefined, limit: 200 });
    expect(read.mock.calls[1][0].cursor).toBe('next');
    expect(progress.mock.calls.map(([n]) => n)).toEqual([2, 3]);
  });

  it('preserves barcode zeroes, Arabic, numeric prices and stock, and treats formula-like names as text', async () => {
    const categories = new Map([['dairy', { id: 'dairy', nameEn: 'Dairy' } as Category]]);
    const bytes = await catalogueWorkbook([product('1', { marketplacePrice: { price: 14.125, source: 'product' } })], categories);
    const workbook = XLSX.read(bytes, { type: 'array' });
    const sheet = workbook.Sheets.Catalogue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    expect(rows[0]).toMatchObject({ Barcode: '001234567890123456', SKU: '00001', 'English name': '=literal name', 'Arabic name': 'حليب', Category: 'Dairy', 'ERP price (QAR)': 12.345, 'Marketplace price (QAR)': 14.125, 'ERP stock': 7, 'Catalogue stock': 4 });
    expect(sheet.A2.t).toBe('s');
    expect(sheet.C2.t).toBe('s');
    expect(sheet.C2.f).toBeUndefined();
    expect(sheet['!autofilter']?.ref).toBeTruthy();
    expect(rows[0]).not.toHaveProperty('Cost price (QAR)');
  });

  it('exports cost only when the authorised API supplied it and resolves missing category labels safely', async () => {
    const bytes = await catalogueWorkbook([product('1', { costPrice: 9.125 })], new Map());
    const workbook = XLSX.read(bytes);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Catalogue);
    expect(rows[0]['Cost price (QAR)']).toBe(9.125);
    expect(rows[0].Category).toBe('dairy');
  });

  it('refuses a partial or repeated-page export rather than downloading incomplete data', async () => {
    const signal = new AbortController().signal;
    await expect(collectCatalogue(vi.fn().mockResolvedValue(page([product('1')], null, 3)), {}, signal, () => {})).rejects.toThrow('catalogue changed');
    const repeated = vi.fn().mockResolvedValueOnce(page([product('1')], 'same')).mockResolvedValueOnce(page([product('2')], 'same'));
    await expect(collectCatalogue(repeated, {}, signal, () => {})).rejects.toThrow('next page');
  });

  it('stops before reading data when cancelled', async () => {
    const controller = new AbortController(); controller.abort();
    const read = vi.fn();
    await expect(collectCatalogue(read, {}, controller.signal, () => {})).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).not.toHaveBeenCalled();
  });
});
