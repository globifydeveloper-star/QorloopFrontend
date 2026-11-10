import React from 'react';
import { CheckCircle2, HelpCircle, XCircle } from 'lucide-react';
import type { MarketplaceComparison, MarketplacePriceIssue, MarketplaceStatusFilter, ProductItem, ProductMarketplaceValues } from '../../api/products';
import { money2, qatarDateTime } from '../../lib/format';
import { MarketplaceAvailability, NOT_IN_FILE, REFERENCE_LABELS, STOCK_ISSUE_META, marketplaceName } from '../recon/shared';

/**
 * The catalogue's marketplace columns (GET /api/products?marketplaceId=, backend docs/products-api.md).
 * File values (availability, price, upload time) are live; the comparison and issues are from the last recompute.
 */

export const MARKETPLACE_STATUS_LABELS: Record<MarketplaceStatusFilter, string> = {
  mismatch: 'Differs', in_sync: 'Matches', not_in_file: NOT_IN_FILE,
};

const COMPARISON_META: Record<Exclude<MarketplaceComparison, 'not_in_file'>, { label: string; tone: string; Icon: typeof CheckCircle2; title?: string }> = {
  mismatch: { label: 'Differs', tone: 'bg-red-50 text-red-700 border-red-200', Icon: XCircle },
  in_sync: { label: 'Matches', tone: 'bg-[#E3FAF3] text-[#027864] border-[#027864]/30', Icon: CheckCircle2 },
  not_applicable: {
    label: 'Not compared', tone: 'bg-gray-100 text-gray-700 border-gray-300', Icon: HelpCircle,
    title: 'No file uploaded yet, a new product, or the comparison has not run since the upload',
  },
};

const priceIssueText = (issue: MarketplacePriceIssue, reference: ProductMarketplaceValues['reference']) =>
  `Price ${issue === 'marketplace_price_higher' ? 'higher' : 'lower'} than the ${REFERENCE_LABELS[reference]}`;

/** Availability and price in the marketplace's file; an older file's upload time when it is not the newest one shown. */
export const MarketplaceValuesCell: React.FC<{ m: ProductMarketplaceValues | undefined; newest: string | null }> = ({ m, newest }) => {
  if (!m) return null;
  if (!m.inFile) return <span className="text-gray-500">{NOT_IN_FILE}</span>;
  const older = m.sourceUploadedAt && newest && m.sourceUploadedAt !== newest;
  return (
    <div className="space-y-0.5" data-testid="marketplace-values">
      <MarketplaceAvailability value={m.available} />
      <div className="font-mono" data-testid="marketplace-file-price">{m.price === null ? '—' : `QAR ${money2(Number(m.price))}`}</div>
      {older && <div className="text-[11px] text-amber-700">From the file uploaded {qatarDateTime(m.sourceUploadedAt)}</div>}
      {!m.sourceUploadedAt && <div className="text-[11px] text-gray-500">Upload time not recorded</div>}
    </div>
  );
};

/** The last comparison of the product on that marketplace, and what differs. */
export const ComparisonCell: React.FC<{ m: ProductMarketplaceValues | undefined }> = ({ m }) => {
  if (!m || m.comparison === 'not_in_file') return m ? <span className="text-gray-400">—</span> : null;
  const meta = COMPARISON_META[m.comparison];
  return (
    <div className="space-y-1">
      <span data-testid="marketplace-comparison" title={meta.title} className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${meta.tone}`}>
        <meta.Icon className="w-3 h-3" aria-hidden />
        {meta.label}
      </span>
      {m.stockIssue && <div className="text-[11px] text-gray-700" data-testid="marketplace-stock-issue">{STOCK_ISSUE_META[m.stockIssue].label}</div>}
      {m.priceIssue && <div className="text-[11px] text-gray-700" data-testid="marketplace-price-issue">{priceIssueText(m.priceIssue, m.reference)}</div>}
    </div>
  );
};

/** The newest upload time among the shown rows (ISO strings of one format compare by time). */
export function newestUpload(items: ProductItem[]): string | null {
  let best: string | null = null;
  for (const i of items) {
    const t = i.marketplace?.sourceUploadedAt;
    if (t && (!best || Date.parse(t) > Date.parse(best))) best = t;
  }
  return best;
}

/**
 * "Marketplace values are from the Talabat file uploaded … (Qatar time). Compared …". The comparison time is the
 * recon summary's computedAt (the products API gives no time of its own), shown only when it is known.
 */
export function marketplaceNote(marketplaceId: string, items: ProductItem[], computedAt: string | null | undefined): string {
  const name = marketplaceName(marketplaceId);
  const newest = newestUpload(items);
  const older = newest !== null && items.some(i => i.marketplace?.sourceUploadedAt && i.marketplace.sourceUploadedAt !== newest);
  const file = !newest
    ? `No ${name} file values for the products shown.`
    : older
      ? `${name} values are from the latest ${name} file that lists each product; the newest was uploaded ${qatarDateTime(newest)} (Qatar time), and rows from an older file say so.`
      : `${name} values are from the ${name} file uploaded ${qatarDateTime(newest)} (Qatar time).`;
  const compared = computedAt
    ? ` Compared ${qatarDateTime(computedAt)} (Qatar time); after a new upload the comparison can be one run behind the file values.`
    : ' The comparison is from the last run; after a new upload it can be one run behind the file values.';
  return file + compared;
}
