import React from 'react';
import { CheckCircle2, FileX, HelpCircle, XCircle } from 'lucide-react';
import type { MarketplaceComparison, MarketplacePriceIssue, ProductItem, ProductMarketplaceValues } from '../../api/products';
import type { ReconMarketplaceId } from '../../api/recon';
import { money2, qatarDateTime } from '../../lib/format';
import { MarketplaceAvailability, NOT_IN_FILE, REFERENCE_IN_TEXT, STOCK_ISSUE_META, fileNote } from '../recon/shared';

/**
 * The catalogue's marketplace columns (GET /api/products?marketplaceId=, backend docs/products-api.md). Read-only.
 * File values (availability, price, upload time) are live; the comparison and issues are from the last recompute.
 * Wording and badges are the Dashboard's (recon/shared.tsx).
 */

const COMPARED_META: Record<MarketplaceComparison, { label: string; tone: string; Icon: typeof CheckCircle2; title?: string }> = {
  in_sync: { label: 'In sync', tone: 'bg-[#E3FAF3] text-[#027864] border-[#027864]/30', Icon: CheckCircle2 },
  mismatch: { label: 'Mismatch', tone: 'bg-red-50 text-red-700 border-red-200', Icon: XCircle },
  not_in_file: { label: NOT_IN_FILE, tone: 'bg-gray-100 text-gray-700 border-gray-300', Icon: FileX },
  not_applicable: {
    label: 'Not compared', tone: 'bg-gray-100 text-gray-700 border-gray-300', Icon: HelpCircle,
    title: 'Not compared yet: a new product, or the comparison has not run since the upload',
  },
};

const priceIssueText = (issue: MarketplacePriceIssue, reference: ProductMarketplaceValues['reference']) =>
  `Price ${issue === 'marketplace_price_higher' ? 'higher' : 'lower'} than ${REFERENCE_IN_TEXT[reference]}`;

/** "Available" / "Unavailable" from the marketplace file, or "Not in the file". Nothing without values. */
export const MarketplaceAvailabilityCell: React.FC<{ m: ProductMarketplaceValues | undefined }> = ({ m }) =>
  m ? <span data-testid="mp-availability"><MarketplaceAvailability value={m.inFile ? m.available : null} /></span> : null;

/** The price in the marketplace file, or "Not in the file"; an older file's upload time when it is not the latest. */
export const MarketplacePriceCell: React.FC<{ m: ProductMarketplaceValues | undefined; latest: string | null }> = ({ m, latest }) => {
  if (!m) return null;
  if (!m.inFile) return <span data-testid="mp-price" className="text-gray-500">{NOT_IN_FILE}</span>;
  const older = m.sourceUploadedAt && latest && Date.parse(m.sourceUploadedAt) < Date.parse(latest);
  return (
    <span className="inline-block">
      <span data-testid="mp-price" className="font-mono">{m.price === null ? '—' : `QAR ${money2(Number(m.price))}`}</span>
      {older && <span className="block text-[11px] text-amber-700">From the file uploaded {qatarDateTime(m.sourceUploadedAt)}</span>}
    </span>
  );
};

/** The last comparison on that marketplace: In sync / Mismatch / Not in the file, and what differs. */
export const ComparedBadge: React.FC<{ m: ProductMarketplaceValues | undefined }> = ({ m }) => {
  if (!m) return null;
  const meta = COMPARED_META[m.comparison];
  return (
    <span className="inline-block space-y-1">
      <span data-testid="mp-compared" title={meta.title} className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${meta.tone}`}>
        <meta.Icon className="w-3 h-3" aria-hidden />
        {meta.label}
      </span>
      {m.stockIssue && <span className="block text-[11px] text-gray-700" data-testid="mp-stock-issue">{STOCK_ISSUE_META[m.stockIssue].label}</span>}
      {m.priceIssue && <span className="block text-[11px] text-gray-700" data-testid="mp-price-issue">{priceIssueText(m.priceIssue, m.reference)}</span>}
    </span>
  );
};

/** On a phone the marketplace columns are hidden; the same values stack under the product name. */
export const StackedMarketplaceValues: React.FC<{ m: ProductMarketplaceValues | undefined; name: string; latest: string | null }> = ({ m, name, latest }) =>
  m ? (
    <dl data-testid="mp-stacked" className="md:hidden mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
      <dt className="text-gray-500">{`Availability on ${name}`}</dt><dd><MarketplaceAvailabilityCell m={m} /></dd>
      <dt className="text-gray-500">{`Price on ${name}`}</dt><dd><MarketplacePriceCell m={m} latest={latest} /></dd>
      <dt className="text-gray-500">Compared</dt><dd><ComparedBadge m={m} /></dd>
    </dl>
  ) : null;

// ───────── Two marketplaces side by side ─────────

export type MarketplacesDifference = 'same' | 'price' | 'availability' | 'both' | 'only_a' | 'only_b' | 'neither';

/**
 * How two marketplaces' values for one product compare with each other (not with the catalogue). The backend's
 * marketplacesDiffer filter uses the same rule: price exact in fils, availability, or listed on only one.
 */
export function marketplacesDifference(a: ProductMarketplaceValues, b: ProductMarketplaceValues): MarketplacesDifference {
  if (!a.inFile && !b.inFile) return 'neither';
  if (!a.inFile) return 'only_b';
  if (!b.inFile) return 'only_a';
  const fils = (p: string | null) => (p === null ? null : Math.round(Number(p) * 1000));
  const price = fils(a.price) !== fils(b.price);
  const availability = a.available !== b.available;
  return price && availability ? 'both' : price ? 'price' : availability ? 'availability' : 'same';
}

export function differenceText(d: MarketplacesDifference, a: string, b: string): string {
  switch (d) {
    case 'same': return 'Same on both';
    case 'price': return 'Price differs';
    case 'availability': return 'Availability differs';
    case 'both': return 'Price and availability differ';
    case 'only_a': return `Only on ${a}`;
    case 'only_b': return `Only on ${b}`;
    case 'neither': return 'On neither';
  }
}

/** "Talabat vs Snoonu": same, or what differs between the two marketplaces. */
export const DifferenceBadge: React.FC<{ a: ProductMarketplaceValues | undefined; b: ProductMarketplaceValues | undefined; aName: string; bName: string }> = ({ a, b, aName, bName }) => {
  if (!a || !b) return null;
  const d = marketplacesDifference(a, b);
  const quiet = d === 'same' || d === 'neither';
  return (
    <span data-testid="mp-difference" data-difference={d}
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${quiet ? 'bg-gray-100 text-gray-700 border-gray-300' : 'bg-amber-50 text-amber-900 border-amber-300'}`}>
      {differenceText(d, aName, bName)}
    </span>
  );
};

/** One marketplace in one cell (two side by side): availability, price, then the comparison with the catalogue. */
export const MarketplaceSummaryCell: React.FC<{ m: ProductMarketplaceValues | undefined; latest: string | null }> = ({ m, latest }) =>
  m ? (
    <span className="inline-flex flex-col items-start gap-1">
      <MarketplaceAvailabilityCell m={m} />
      {m.inFile && <MarketplacePriceCell m={m} latest={latest} />}
      <ComparedBadge m={m} />
    </span>
  ) : null;

/** On a phone, two marketplaces stack under the product name, then what differs between them. */
export const StackedTwoMarketplaces: React.FC<{
  a: ProductMarketplaceValues | undefined; b: ProductMarketplaceValues | undefined; aName: string; bName: string; latestA: string | null; latestB: string | null;
}> = ({ a, b, aName, bName, latestA, latestB }) =>
  a || b ? (
    <dl data-testid="mp-stacked" className="md:hidden mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
      <dt className="text-gray-500">{aName}</dt><dd><MarketplaceSummaryCell m={a} latest={latestA} /></dd>
      <dt className="text-gray-500">{bName}</dt><dd><MarketplaceSummaryCell m={b} latest={latestB} /></dd>
      <dt className="text-gray-500">{`${aName} vs ${bName}`}</dt><dd><DifferenceBadge a={a} b={b} aName={aName} bName={bName} /></dd>
    </dl>
  ) : null;

/** The newest upload time among the shown rows (of the main marketplace, or with `which`, of the second one). */
export function newestUpload(items: ProductItem[], which: 'marketplace' | 'compareMarketplace' = 'marketplace'): string | null {
  let best: string | null = null;
  for (const i of items) {
    const t = i[which]?.sourceUploadedAt;
    if (t && (!best || Date.parse(t) > Date.parse(best))) best = t;
  }
  return best;
}

/**
 * The Dashboard's note ("Marketplace values are from the latest Talabat file, uploaded … (Qatar time).") from the
 * marketplace's latest upload, then the time of the last comparison when it is known (the recon summary's computedAt;
 * the products API gives none of its own).
 */
export function marketplaceNote(marketplaceId: string, lastUploadAt: string | null, computedAt: string | null | undefined): string {
  const file = fileNote({ marketplaceId: marketplaceId as ReconMarketplaceId, lastUploadAt });
  return computedAt
    ? `${file} Compared ${qatarDateTime(computedAt)} (Qatar time); right after an upload the comparison can be one run behind.`
    : `${file} The comparison is from the last run; right after an upload it can be one run behind.`;
}
