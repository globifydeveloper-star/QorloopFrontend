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

/** The newest upload time among the shown rows. */
export function newestUpload(items: ProductItem[]): string | null {
  let best: string | null = null;
  for (const i of items) {
    const t = i.marketplace?.sourceUploadedAt;
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
