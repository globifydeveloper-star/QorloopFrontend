import type { ProductItem } from '../../api/products';

export type OfferRow = { barcode: string; action: 'set' | 'clear'; price?: number; validFrom: string | null; validUntil: string | null; product?: ProductItem; error?: string };
const date = (value: string): string | null | undefined => {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const instant = new Date(`${match[1]}T${match[2]}:${match[3]}:00+03:00`);
  return Number.isNaN(instant.getTime()) || new Date(instant.getTime() + 3 * 3600_000).toISOString().slice(0, 16) !== `${match[1]}T${match[2]}:${match[3]}`
    ? undefined : `${match[1]}T${match[2]}:${match[3]}:00+03:00`;
};

export function previewOffers(values: Record<string, unknown>[], products: ProductItem[]): OfferRow[] {
  const byBarcode = new Map<string, ProductItem[]>();
  for (const product of products) byBarcode.set(product.barcode, [...(byBarcode.get(product.barcode) ?? []), product]);
  const seen = new Set<string>();
  return values.map((value): OfferRow => {
    const barcode = String(value.Barcode ?? '').trim();
    const action = String(value.Action ?? 'set').trim().toLowerCase();
    const rawPrice = String(value['Offer price (QAR)'] ?? '').trim();
    const from = date(String(value['Starts (Qatar time)'] ?? '').trim());
    const until = date(String(value['Ends (Qatar time)'] ?? '').trim());
    const matches = byBarcode.get(barcode) ?? [];
    const price = Number(rawPrice);
    const error = !barcode ? 'Barcode is required'
      : seen.has(barcode) ? 'Duplicate barcode in file'
      : matches.length !== 1 ? matches.length ? 'Barcode matches multiple products' : 'Product not found'
      : !['set', 'clear'].includes(action) ? 'Action must be set or clear'
      : action === 'set' && (!rawPrice || !Number.isFinite(price) || price <= 0 || price >= 1_000_000_000 || !/^\d+(?:\.\d{1,3})?$/.test(rawPrice)) ? 'Enter an offer price above 0 with at most 3 decimals'
      : action === 'set' && (from === undefined || until === undefined) ? 'Use YYYY-MM-DD HH:mm for Qatar time'
      : action === 'set' && until && Date.parse(until) <= Date.now() ? 'Offer end is in the past'
      : action === 'set' && from && until && Date.parse(until) <= Date.parse(from) ? 'End must be after start'
      : action === 'set' && matches[0].status !== 'active' ? 'Product must be active'
      : undefined;
    seen.add(barcode);
    return { barcode, action: action === 'clear' ? 'clear' : 'set', price: action === 'set' ? price : undefined, validFrom: from ?? null, validUntil: until ?? null, product: matches[0], error };
  });
}
