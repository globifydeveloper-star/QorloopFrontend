import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ExternalLink, Info } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { productsApi } from '../../api/products';
import type { ReconMarketplaceSummary, ReconReference, ReconRow } from '../../api/recon';
import { SETTINGS_KEY, settingsApi } from '../../api/settings';
import { pathFor } from '../../routes/paths';
import { ErrorState, LoadingState } from '../common/States';
import { SideDrawer } from '../common/SideDrawer';
import { productKey } from '../catalogue/shared';
import { ProductStockPanel } from '../stock/ProductStockPanel';
import { RowPriceEditor } from '../pricing/InlinePriceEditor';
import { Chain, PriceSourceChip } from '../pricing/shared';
import { count } from '../pricing/priceChange';
import {
  Availability, MarketplaceAvailability, NOT_IN_FILE, REFERENCE_LABELS, STOCK_ISSUE_META, StockIssuePill, freshnessText, marketplaceName, money2, priceDifference,
  qatarDateTime, useRecomputeState,
} from './shared';

export type QuickEditKind = 'stock' | 'price';

/** The list the drawer was opened from: its rows as loaded (same filter, same pages), and what they were compared on. */
export interface QuickEditList {
  kind: QuickEditKind;
  rows: ReconRow[];
  summary: ReconMarketplaceSummary;
  reference: ReconReference;
  /** More rows exist than are loaded (the dashboard's short list, or a report with "Load more"). */
  more: boolean;
}

/** The attribute on each row's Edit button: focus goes back to the row shown last when the drawer closes. */
export const QUICK_EDIT_ATTR = 'data-quick-edit';
const editButtonFor = (productId: string) =>
  [...document.querySelectorAll<HTMLElement>(`[${QUICK_EDIT_ATTR}]`)].find(el => el.getAttribute(QUICK_EDIT_ATTR) === productId) ?? null;

/** An "Edit" button for a row; give it to every row the drawer can open. */
export const QuickEditButton: React.FC<{ row: ReconRow; onOpen: (productId: string) => void }> = ({ row, onOpen }) => (
  <button
    type="button"
    {...{ [QUICK_EDIT_ATTR]: row.productId }}
    onClick={e => { e.stopPropagation(); onOpen(row.productId); }}
    aria-label={`Edit ${row.nameEn}`}
    className="h-7 px-2.5 rounded-lg text-[11px] font-semibold border border-gray-300 bg-white text-[#027864] hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#027864]"
  >
    Edit
  </button>
);

/** Row clicks open the drawer too, except on a link or a button inside the row. */
export const rowClickOpens = (e: React.MouseEvent) => !(e.target instanceof Element && e.target.closest('a, button, input, select, label'));

/**
 * The "Quick edit" drawer for one mismatch row (Dashboard "Needs attention", stock and price reports): what differs, and
 * the existing stock panel or price editor to fix it without leaving the page. Saves go through those components, which
 * refresh the product, the lists and the comparison (expectRecompute); the drawer then says "Saved. The comparison is
 * updating…" until the recompute lands. Rows are never removed here: the list changes only when the comparison does.
 *
 * Needs products.view (the product and its stock are loaded); the caller only offers it then.
 */
export const QuickEditDrawer: React.FC<{
  list: QuickEditList;
  productId: string;
  onNavigate: (productId: string) => void;
  onClose: () => void;
  /**
   * SLOT "Value to export for this marketplace" (not built yet): a future section showing the value the generated
   * file will carry for this product on this marketplace. It renders after "Fix it" when given.
   */
  marketplaceExportValue?: React.ReactNode;
}> = ({ list, productId, onNavigate, onClose, marketplaceExportValue }) => {
  const index = list.rows.findIndex(r => r.productId === productId);
  // The row as last seen: a recompute may take it out of the list while the drawer still shows it.
  const last = useRef<{ row: ReconRow; index: number } | null>(null);
  if (index >= 0) last.current = { row: list.rows[index], index };
  const row = index >= 0 ? list.rows[index] : last.current?.row;
  const at = index >= 0 ? index : last.current?.index ?? 0;
  const [dirty, setDirty] = useState(false);
  const onDirtyChange = useCallback((d: boolean) => setDirty(d), []);
  useEffect(() => { setDirty(false); }, [productId]);

  if (!row) return null;
  const name = marketplaceName(list.summary.marketplaceId);
  const total = list.rows.length;
  const inList = index >= 0;
  // Out of the list: Next shows the row that took its place, Previous the one before.
  const nextId = inList ? list.rows[index + 1]?.productId : list.rows[at]?.productId;
  const previousId = list.rows[(inList ? index : at) - 1]?.productId;
  const label = !inList ? 'No longer in this list: the comparison says it is fixed'
    : list.more ? `${index + 1} of ${total} loaded` : `${index + 1} of ${total}`;

  return (
    <SideDrawer
      title={row.nameEn}
      subtitle={<><span className="font-mono">{row.barcode}</span>{row.sku ? <> · SKU {row.sku}</> : null} · {name} · {list.kind === 'stock' ? 'Stock difference' : 'Price difference'}</>}
      onClose={onClose}
      dirty={dirty}
      itemKey={productId}
      position={{ label }}
      onPrevious={previousId ? () => onNavigate(previousId) : undefined}
      onNext={nextId ? () => onNavigate(nextId) : undefined}
      returnFocus={() => editButtonFor(productId)}
    >
      <Link to={pathFor('product-detail', row.productId)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#027864] hover:underline">
        Open full product page <ExternalLink className="w-3.5 h-3.5" aria-hidden />
      </Link>
      <SavedStatus productId={productId} />
      {list.kind === 'stock'
        ? <><StockDiffers row={row} list={list} /><StockFix row={row} onDirtyChange={onDirtyChange} /></>
        : <><PriceDiffers row={row} list={list} /><PriceFix row={row} list={list} onDirtyChange={onDirtyChange} /></>}
      {marketplaceExportValue && <div data-slot="marketplace-export-value">{marketplaceExportValue}</div>}
    </SideDrawer>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const id = `qe-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h3 id={id} className="text-xs font-bold uppercase tracking-wider text-gray-900">{title}</h3>
      {children}
    </section>
  );
};

const Fact: React.FC<{ label: string; children: React.ReactNode; testId?: string }> = ({ label, children, testId }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5">
    <dt className="text-xs text-gray-500">{label}</dt>
    <dd data-testid={testId} className="text-xs font-semibold text-gray-900 text-right">{children}</dd>
  </div>
);

const box = 'rounded-xl border border-gray-200 bg-[#F8FBFA] px-3 py-2';

/** "Saved. The comparison is updating…" from the moment a save here queues a recompute, until it lands. */
const SavedStatus: React.FC<{ productId: string }> = ({ productId }) => {
  const state = useRecomputeState();
  const [saved, setSaved] = useState(false);
  const before = useRef(state);
  useEffect(() => {
    if (state && !before.current) setSaved(true);
    before.current = state;
  }, [state]);
  // Another product: the line belongs to the save, so it stays only while that recompute runs.
  const shownFor = useRef(productId);
  useEffect(() => { if (shownFor.current !== productId) { shownFor.current = productId; if (!state) setSaved(false); } }, [productId, state]);

  if (!saved) return null;
  const text = !state ? 'Saved. The comparison is up to date.'
    : state.timedOut ? 'Saved. The comparison is taking longer than usual; the numbers update when it finishes.'
      : 'Saved. The comparison is updating…';
  return (
    <p role="status" data-testid="quick-edit-status" className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${state ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-[#027864]/30 bg-[#E3FAF3] text-[#027864]'}`}>
      {state && !state.timedOut
        ? <span className="w-3.5 h-3.5 rounded-full border-2 border-blue-300 border-t-blue-700 motion-safe:animate-spin shrink-0" aria-hidden />
        : <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden />}
      {text}
    </p>
  );
};

/** The product (status, ERP flags, pricing): the same query the product page and the price editor use. */
const useProduct = (id: string) =>
  useQuery({ queryKey: productKey(id), queryFn: ({ signal }) => productsApi.get(id, signal), retry: false });

// ───────── Stock ─────────

const StockDiffers: React.FC<{ row: ReconRow; list: QuickEditList }> = ({ row, list }) => {
  const { can } = useAuth();
  const s = list.summary;
  const name = marketplaceName(s.marketplaceId);
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: ({ signal }) => settingsApi.get(signal), retry: false, enabled: can('settings.view') });
  const threshold = settings.data?.thresholds.stockThreshold;
  const byErp = list.reference === 'erp' || row.catalogueAvailable === undefined;
  const issue = row.stockIssue ? STOCK_ISSUE_META[row.stockIssue] : undefined;
  return (
    <Section title="What differs">
      {issue && (
        <div className="space-y-1">
          <StockIssuePill issue={row.stockIssue} />
          <p data-testid="stock-reason" className="text-xs text-gray-700">
            {row.stockIssue === 'available_but_out_of_stock'
              ? `Customers can order it on ${name}, but you do not have the stock to deliver it.`
              : `You have stock, but ${name} shows it as unavailable, so you lose sales.`}
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <dl className={box} aria-label={`On ${name}`}>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 pt-1">On {name}</h4>
          <Fact label="Availability" testId="marketplace-available"><MarketplaceAvailability value={row.actualAvailable} /></Fact>
          <Fact label="From the file uploaded">
            {s.lastUploadAt ? `${qatarDateTime(s.lastUploadAt)} (Qatar time)` : 'Unknown'}
          </Fact>
          <p data-testid="file-age" className={`pb-1 text-[11px] ${s.stale ? 'text-amber-800 font-semibold' : 'text-gray-500'}`}>
            {freshnessText(s) ?? 'Upload time unknown'}{s.stale ? ' (out of date)' : ''}
          </p>
        </dl>
        <dl className={box} aria-label="In Qorloop">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 pt-1">In Qorloop</h4>
          <Fact label={byErp ? 'Availability (by ERP stock)' : 'Availability (by catalogue stock)'} testId="qorloop-available">
            <Availability value={byErp ? row.erpAvailable : row.catalogueAvailable ?? null} />
          </Fact>
          <Fact label="ERP stock" testId="row-erp-stock">{count(row.erpStock)}</Fact>
          {row.catalogueStock !== undefined && (
            <Fact label="Catalogue stock" testId="row-catalogue-stock">
              {count(row.catalogueStock)}{row.catalogueStockSource === 'owner' ? ' (edited)' : ''}
            </Fact>
          )}
          {threshold !== undefined && <Fact label="Counts as available above" testId="stock-threshold">{count(threshold)}</Fact>}
        </dl>
      </div>
      {issue && <p className="text-[11px] text-gray-500">{issue.detail}. As of the last comparison.</p>}
    </Section>
  );
};

const StockFix: React.FC<{ row: ReconRow; onDirtyChange: (d: boolean) => void }> = ({ row, onDirtyChange }) => {
  const { can } = useAuth();
  const product = useProduct(row.productId);
  return (
    <Section title="Fix it">
      <p role="note" className="flex items-start gap-1.5 text-xs text-gray-600">
        <Info className="w-3.5 h-3.5 shrink-0 text-gray-400 mt-0.5" aria-hidden />
        <span>The catalogue stock applies to every marketplace. Marketplace files carry available or unavailable, not stock quantities.</span>
      </p>
      {!can('catalogue.stock_edit') && (
        <p role="note" data-testid="read-only" className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
          Your role can see the stock but not change it. An Owner, Admin or Catalogue Manager can change it.
        </p>
      )}
      {product.isPending ? <LoadingState label="Loading the product…" rows={2} />
        : product.isError ? <ErrorState error={product.error} title="We could not load this product" onRetry={() => void product.refetch()} />
          : <ProductStockPanel key={row.productId} product={product.data} onDirtyChange={onDirtyChange} />}
    </Section>
  );
};

// ───────── Price ─────────

const PriceDiffers: React.FC<{ row: ReconRow; list: QuickEditList }> = ({ row, list }) => {
  const name = marketplaceName(list.summary.marketplaceId);
  const product = useProduct(row.productId);
  return (
    <Section title="What differs">
      <dl className={box}>
        <Fact label={`Price on ${name}`} testId="qe-actual">{row.actualPrice === null ? NOT_IN_FILE : `${money2(row.actualPrice)} QAR`}</Fact>
        <Fact label={`Expected (${REFERENCE_LABELS[list.reference]})`} testId="qe-expected">{row.expectedPrice === null ? '—' : `${money2(row.expectedPrice)} QAR`}</Fact>
        <Fact label="Difference" testId="qe-difference">{priceDifference(row.actualPrice, row.expectedPrice)} QAR</Fact>
        <Fact label="Set by" testId="qe-source">
          {list.reference === 'erp' ? 'ERP price' : row.marketplacePriceSource ? <PriceSourceChip source={row.marketplacePriceSource} /> : '—'}
        </Fact>
      </dl>
      {list.reference === 'erp' && (
        <p role="note" className="flex items-start gap-2 text-xs text-amber-900">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600 mt-0.5" aria-hidden />
          This list compares against the raw ERP price, not the price you expect on the marketplace.
        </p>
      )}
      <p className="text-[11px] text-gray-500">As of the last comparison.</p>
      {product.data?.pricing && <Chain chain={product.data.pricing.chain} label="Which rule produced the expected price" />}
    </Section>
  );
};

const PriceFix: React.FC<{ row: ReconRow; list: QuickEditList; onDirtyChange: (d: boolean) => void }> = ({ row, list, onDirtyChange }) => {
  const { can } = useAuth();
  return (
    <Section title="Fix it">
      {can('pricing.edit')
        ? <RowPriceEditor key={row.productId} productId={row.productId} showChain={false} initialMarketplace={list.summary.marketplaceId} onDirtyChange={onDirtyChange} />
        : (
          <p role="note" data-testid="read-only" className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
            Your role can see prices but not change them. An Owner, Admin or Catalogue Manager can change them.
          </p>
        )}
      <ul className="space-y-1 text-xs">
        <li>
          <Link to={pathFor('product-detail', row.productId)} className="font-semibold text-[#027864] hover:underline">Set or change an offer on the full product page</Link>
        </li>
        {can('pricing.bulk') && (
          <li><Link to={pathFor('catalogue')} className="font-semibold text-[#027864] hover:underline">Change many prices at once in the Catalogue</Link></li>
        )}
      </ul>
    </Section>
  );
};
