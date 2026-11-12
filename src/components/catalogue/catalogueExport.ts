import type { Category } from '../../api/categories';
import type { ProductItem, ProductListQuery, ProductPage } from '../../api/products';

/** Export the complete filtered list, rather than only the pages currently displayed. */
export async function collectCatalogue(
  read: (query: ProductListQuery, signal?: AbortSignal) => Promise<ProductPage>,
  filter: ProductListQuery,
  signal: AbortSignal,
  progress: (loaded: number) => void,
): Promise<ProductItem[]> {
  const products: ProductItem[] = [];
  const ids = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined;
  let expected: number | undefined;
  do {
    signal.throwIfAborted();
    const page = await read({ ...filter, cursor, limit: 200 }, signal);
    expected ??= page.counts[filter.tab ?? 'all'];
    for (const product of page.items) {
      if (ids.has(product.id)) throw new Error('The catalogue changed while exporting. Please try again.');
      ids.add(product.id);
      products.push(product);
    }
    progress(products.length);
    cursor = page.nextCursor ?? undefined;
    if (cursor && cursors.has(cursor)) throw new Error('The export could not load the next page. Please try again.');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  signal.throwIfAborted();
  if (expected !== undefined && products.length !== expected) throw new Error('The catalogue changed while exporting. Please try again.');
  return products;
}

/** Strings stay text in Excel, preserving barcode zeroes and literal formula-like product names. */
export async function catalogueWorkbook(products: ProductItem[], categories: Map<string, Category>): Promise<Uint8Array> {
  const XLSX = await import('xlsx');
  const prices = products.some(p => p.marketplacePrice !== undefined);
  const costs = products.some(p => p.costPrice !== undefined);
  const headers = ['Barcode', 'SKU', 'English name', 'Arabic name', 'Brand', 'ERP category', 'Category', 'Subcategory',
    'ERP price (QAR)', ...(prices ? ['Marketplace price (QAR)'] : []), ...(costs ? ['Cost price (QAR)'] : []),
    'ERP stock', 'Catalogue stock', 'Stock source', 'Status', 'In latest ERP file', 'Updated at (UTC)'];
  const category = (id: string | null) => id ? categories.get(id)?.nameEn ?? id : '';
  const rows = products.map(p => [p.barcode, p.sku ?? '', p.nameEn, p.nameAr ?? '', p.brand ?? '', p.erpCategory ?? '', category(p.categoryId), category(p.subcategoryId),
    p.erpPrice, ...(prices ? [p.marketplacePrice?.price ?? null] : []), ...(costs ? [p.costPrice ?? null] : []),
    p.erpStock, p.catalogueStock ?? p.erpStock, p.catalogueStockSource ?? 'erp', p.status, p.inLatestErpFile, p.updatedAt]);
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet['!cols'] = headers.map(header => ({ wch: /name|category|Updated/.test(header) ? 30 : /price/.test(header) ? 22 : 20 }));
  sheet['!autofilter'] = { ref: sheet['!ref']! };
  for (let row = 1; row <= products.length; row++) {
    for (let col = 0; col < headers.length; col++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell?.t === 's') { cell.z = '@'; delete cell.f; }
      else if (cell?.t === 'n') cell.z = headers[col].includes('price') ? '0.000' : '0';
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Catalogue');
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true }));
}
