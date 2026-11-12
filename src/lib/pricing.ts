import {
  CategoryPriceRule,
  CompareReference,
  MarketplaceId,
  PriceRounding,
  PriceRule,
  PriceSource,
  PricingSettings,
  Product,
} from '../types';

export const MARKETPLACE_IDS: MarketplaceId[] = ['talabat', 'snoonu', 'rafeeq', 'keeta'];

export const MARKETPLACE_NAMES: Record<MarketplaceId, string> = {
  talabat: 'Talabat',
  snoonu: 'Snoonu',
  rafeeq: 'Rafeeq',
  keeta: 'Keeta',
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const formatQar = (n: number | undefined | null) =>
  n === undefined || n === null || Number.isNaN(n) ? '—' : n.toFixed(2);

export const formatDiff = (n: number) => {
  const r = round2(n);
  if (r === 0) return '0';
  return `${r > 0 ? '+' : ''}${r.toFixed(2)}`;
};

export const applyRule = (erpPrice: number, rule: PriceRule): number => {
  switch (rule.mode) {
    case 'percent':
      return erpPrice * (1 + rule.value / 100);
    case 'amount':
      return erpPrice + rule.value;
    case 'fixed':
      return rule.value;
    case 'same':
    default:
      return erpPrice;
  }
};

export const applyRounding = (price: number, rounding: PriceRounding): number => {
  if (rounding === 'Exact') return round2(price);
  const step = rounding === '0.25' ? 0.25 : 0.5;
  return round2(Math.round(price / step) * step);
};

/** Fixed prices and "same as ERP" are used exactly as typed; only calculated prices are rounded. */
const priceFromRule = (erpPrice: number, rule: PriceRule, rounding: PriceRounding) =>
  rule.mode === 'fixed' || rule.mode === 'same'
    ? round2(applyRule(erpPrice, rule))
    : applyRounding(applyRule(erpPrice, rule), rounding);

export interface ResolvedPrice {
  price: number;
  source: PriceSource;
  rule?: PriceRule;
}

/**
 * Marketplace Price for a product.
 * Order: offer → product rule → category rule → per-marketplace rule (advanced only) → default rule.
 */
export const resolveMarketplacePrice = (
  product: Product,
  settings: PricingSettings,
  categoryRules: CategoryPriceRule[],
  marketplace?: MarketplaceId
): ResolvedPrice => {
  if (product.offerPrice !== undefined && product.offerPrice !== null) {
    return { price: round2(product.offerPrice), source: 'offer' };
  }
  if (product.priceRule) {
    return {
      price: priceFromRule(product.erpPrice, product.priceRule, settings.rounding),
      source: 'product',
      rule: product.priceRule,
    };
  }
  const categoryRule = categoryRules.find((r) => r.category === product.category);
  if (categoryRule) {
    return {
      price: priceFromRule(product.erpPrice, categoryRule.rule, settings.rounding),
      source: 'category',
      rule: categoryRule.rule,
    };
  }
  if (marketplace && settings.perMarketplaceEnabled) {
    const mpRule = settings.marketplaceRules[marketplace];
    if (mpRule && mpRule.active) {
      const rule: PriceRule = { mode: 'percent', value: mpRule.markup };
      return {
        price: applyRounding(applyRule(product.erpPrice, rule), mpRule.rounding),
        source: 'marketplace',
        rule,
      };
    }
  }
  return {
    price: priceFromRule(product.erpPrice, settings.defaultRule, settings.rounding),
    source: 'default',
    rule: settings.defaultRule,
  };
};

/** The price a marketplace listing is compared against (and written to generated files). */
export const getReferencePrice = (
  product: Product,
  reference: CompareReference,
  settings: PricingSettings,
  categoryRules: CategoryPriceRule[],
  marketplace?: MarketplaceId
): number =>
  reference === 'erp'
    ? round2(product.erpPrice)
    : resolveMarketplacePrice(product, settings, categoryRules, marketplace).price;

export const describeRule = (rule?: PriceRule): string => {
  if (!rule) return '—';
  switch (rule.mode) {
    case 'percent':
      return `${rule.value >= 0 ? '+' : ''}${rule.value}% on ERP`;
    case 'amount':
      return `${rule.value >= 0 ? '+' : '−'}${Math.abs(rule.value).toFixed(2)} QAR on ERP`;
    case 'fixed':
      return `Fixed ${rule.value.toFixed(2)} QAR`;
    case 'same':
    default:
      return 'Same as ERP';
  }
};

export const SOURCE_LABELS: Record<PriceSource, string> = {
  offer: 'Offer',
  product: 'Product',
  category: 'Category',
  marketplace: 'Marketplace',
  default: 'Default',
};

export const SOURCE_STYLES: Record<PriceSource, string> = {
  offer: 'bg-amber-50 text-amber-800 border-amber-200',
  product: 'bg-purple-50 text-purple-700 border-purple-200',
  category: 'bg-blue-50 text-blue-700 border-blue-200',
  marketplace: 'bg-orange-50 text-orange-700 border-orange-200',
  default: 'bg-gray-50 text-gray-600 border-gray-200',
};

export const REFERENCE_LABELS: Record<CompareReference, string> = {
  marketplace: 'My pricing',
  erp: 'ERP price',
};

/** The reference inside a sentence: "compared against My pricing", "compared against the ERP price". */
export const REFERENCE_IN_TEXT: Record<CompareReference, string> = {
  marketplace: 'My pricing',
  erp: 'the ERP price',
};

// ---------------------------------------------------------------------------
// Price checks (used by reports and generated files)
// ---------------------------------------------------------------------------

export interface PriceCheck {
  marketplace: MarketplaceId;
  listed: boolean;
  expected?: number;
  actual?: number;
  diff: number;
  mismatch: boolean;
  lastUpdated?: string;
}

export const checkProductPrices = (
  product: Product,
  reference: CompareReference,
  settings: PricingSettings,
  categoryRules: CategoryPriceRule[]
): Record<MarketplaceId, PriceCheck> => {
  const result = {} as Record<MarketplaceId, PriceCheck>;
  MARKETPLACE_IDS.forEach((mp) => {
    const status = product.marketplaces[mp];
    if (!status || !status.listed || status.price === undefined) {
      result[mp] = { marketplace: mp, listed: false, diff: 0, mismatch: false };
      return;
    }
    const expected = getReferencePrice(product, reference, settings, categoryRules, mp);
    const diff = round2(status.price - expected);
    result[mp] = {
      marketplace: mp,
      listed: true,
      expected,
      actual: status.price,
      diff,
      mismatch: Math.abs(diff) >= 0.005,
      lastUpdated: status.lastUpdated,
    };
  });
  return result;
};

// ---------------------------------------------------------------------------
// Bulk updates
// ---------------------------------------------------------------------------

export type BulkPriceActionType =
  | 'percent'
  | 'amount'
  | 'fixed'
  | 'same'
  | 'adjust'
  | 'offer'
  | 'remove-offer'
  | 'reset';

export interface BulkPriceAction {
  type: BulkPriceActionType;
  value: number;
  offerUntil?: string;
}

export const BULK_ACTION_LABELS: Record<BulkPriceActionType, string> = {
  percent: 'Markup % on ERP price',
  amount: 'Add fixed amount to ERP price (QAR)',
  fixed: 'Set exact price (QAR)',
  same: 'Same as ERP price',
  adjust: 'Increase / decrease current price by (QAR)',
  offer: 'Set offer price (QAR)',
  'remove-offer': 'Remove offer price',
  reset: 'Reset to category / default rule',
};

export const bulkActionNeedsValue = (type: BulkPriceActionType) =>
  !(type === 'same' || type === 'remove-offer' || type === 'reset');

/** Fields to change on a product for a bulk action. */
export const getBulkPatch = (
  product: Product,
  action: BulkPriceAction,
  settings: PricingSettings,
  categoryRules: CategoryPriceRule[]
): Partial<Product> => {
  switch (action.type) {
    case 'percent':
    case 'amount':
    case 'fixed':
      return { priceRule: { mode: action.type, value: action.value } };
    case 'same':
      return { priceRule: { mode: 'same', value: 0 } };
    case 'adjust': {
      const base = resolveMarketplacePrice(
        { ...product, offerPrice: undefined },
        settings,
        categoryRules
      ).price;
      return { priceRule: { mode: 'fixed', value: round2(Math.max(0, base + action.value)) } };
    }
    case 'offer':
      return { offerPrice: round2(action.value), offerUntil: action.offerUntil || undefined };
    case 'remove-offer':
      return { offerPrice: undefined, offerUntil: undefined };
    case 'reset':
    default:
      return { priceRule: undefined };
  }
};

// ---------------------------------------------------------------------------
// Bulk file (CSV) template + parsing
// ---------------------------------------------------------------------------

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const buildPriceTemplateCsv = (
  products: Product[],
  settings: PricingSettings,
  categoryRules: CategoryPriceRule[]
) => {
  const header = [
    'Barcode',
    'SKU',
    'Product',
    'Category',
    'ERP price',
    'Current marketplace price',
    'New marketplace price',
  ];
  const rows = products.map((p) => {
    const current = resolveMarketplacePrice(p, settings, categoryRules).price;
    return [p.barcode, p.sku, p.nameEn, p.category, p.erpPrice.toFixed(2), current.toFixed(2), ''];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
};

const splitCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',' || ch === ';' || ch === '\t') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
};

export interface ParsedPriceRow {
  barcode: string;
  price: number;
}

export interface ParsedPriceFile {
  rows: ParsedPriceRow[];
  skipped: number;
  error?: string;
}

/** Reads a CSV with a Barcode column and a "New marketplace price" (or "Marketplace price" / "Price") column. */
export const parsePriceCsv = (text: string): ParsedPriceFile => {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { rows: [], skipped: 0, error: 'The file has no data rows.' };
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const barcodeIdx = header.findIndex((h) => h.includes('barcode'));
  let priceIdx = header.findIndex((h) => h.includes('new') && h.includes('price'));
  if (priceIdx === -1) priceIdx = header.findIndex((h) => h === 'marketplace price' || h === 'price');
  if (barcodeIdx === -1 || priceIdx === -1) {
    return {
      rows: [],
      skipped: 0,
      error: 'Columns not found. The file needs "Barcode" and "New marketplace price" columns.',
    };
  }
  const rows: ParsedPriceRow[] = [];
  let skipped = 0;
  lines.slice(1).forEach((line) => {
    const cells = splitCsvLine(line);
    const barcode = (cells[barcodeIdx] || '').trim();
    const raw = (cells[priceIdx] || '').trim();
    const price = parseFloat(raw);
    if (!barcode || raw === '' || Number.isNaN(price) || price < 0) {
      skipped++;
      return;
    }
    rows.push({ barcode, price: round2(price) });
  });
  return { rows, skipped };
};

export const downloadTextFile = (fileName: string, content: string, mime = 'text/csv;charset=utf-8') => {
  const blob = new Blob(['﻿' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const formatNow = () => {
  const d = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
