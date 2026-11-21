import React, { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Ban, X } from 'lucide-react';
import { ApiError, STEP_UP_CANCELLED, isStepUpRequired } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import {
  PRODUCT_BLOCK_IDS_MAX, PRODUCT_BLOCK_REASONS, PRODUCT_BLOCK_REASON_LABELS, productsApi,
  type BlockResult, type ProductBlockReason, type UnblockResult,
} from '../../api/products';
import { expectRecompute } from '../recon/shared';
import { catalogueErrorText } from './shared';

/** Who may block and unblock: Owner, Admin and Catalogue Manager (backend roles.ts). */
export const BLOCK_PERMISSION = 'products.block';

export interface BlockTarget { id: string; nameEn: string }

const n = (v: number) => v.toLocaleString('en-US');
export const productsText = (v: number) => `${n(v)} ${v === 1 ? 'product' : 'products'}`;
export const offersText = (v: number) => `${n(v)} active ${v === 1 ? 'offer' : 'offers'}`;

/** What the catalogue, the Blocked tab and the drawer say a block does. */
export const BLOCK_EXPLAINED =
  'A blocked product stays in your catalogue, but the Dashboard, Review, comparisons, generated files, bulk price changes and offers leave it out. Its status and details are kept. You can unblock it from the Blocked tab.';
export const ENDED_OFFERS_NOT_RESTORED = 'Offers that were ended when a product was blocked are not restored; set a new offer if needed.';

/**
 * The Blocked tab's number: GET /api/products?blocked=only&limit=1 → counts.blocked. Under ['products'], so a block,
 * an unblock or any product change refreshes it. null: a backend without blocking (the tab shows no number).
 */
export function useBlockedCount() {
  return useQuery({
    queryKey: ['products', 'blocked-count'] as const,
    queryFn: ({ signal }) => productsApi.list({ tab: 'all', blocked: 'only', limit: 1 }, signal).then(p => p.counts.blocked ?? null),
    retry: false,
    staleTime: 10_000,
  });
}

/**
 * After a block or unblock: every product list, detail and count, the pricing screens (offers ended, active offers),
 * upload change lists, stock conflicts and Activity. A change queues one recompute on the server: the Dashboard and
 * Review lists are polled until it lands, so the product leaves (or comes back to) them.
 */
export function invalidateAfterBlock(qc: QueryClient, changed: boolean) {
  for (const key of [['products'], ['pricing'], ['uploads', 'changes'], ['stock'], ['activity'], ['product-history']]) {
    void qc.invalidateQueries({ queryKey: key });
  }
  if (changed) expectRecompute(qc);
}

function blockErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (isStepUpRequired(e)) return STEP_UP_CANCELLED;
    if (e.status === 403) return 'You do not have permission to block or unblock products.';
    if (e.status === 404) return 'This server cannot block products yet.';
    if (e.status === 409) return 'These products or their offers changed since the preview. Check the new preview, then confirm again.';
  }
  return catalogueErrorText(e);
}

const Modal: React.FC<{ label: string; title: string; busy: boolean; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }> = ({ label, title, busy, onClose, children, footer }) => (
  <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onMouseDown={e => e.target === e.currentTarget && !busy && onClose()} onKeyDown={e => e.key === 'Escape' && !busy && onClose()}>
    <div role="dialog" aria-modal="true" aria-label={label} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-bold text-gray-900">{title}</h3>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-gray-400 hover:text-gray-600 disabled:opacity-40"><X className="w-4 h-4" /></button>
      </div>
      <div className="mt-3 space-y-4 text-sm text-gray-600">{children}</div>
      <div className="mt-5 flex justify-end gap-2">{footer}</div>
    </div>
  </div>
);
const secondary = 'h-9 px-4 rounded-lg text-sm font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50';
const danger = 'h-9 px-4 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50';
const primary = 'h-9 px-4 rounded-lg text-sm font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-50';

/**
 * Block one product or the ticked rows (POST /api/products/block/preview, then /block with its token): choose a reason,
 * read the preview (how many, and the active offers that end), confirm. A 409 (the selection or its offers changed)
 * previews again and asks for a new confirmation.
 */
export const BlockDialog: React.FC<{ products: readonly BlockTarget[]; onClose: () => void; onBlocked?: (r: BlockResult) => void }> = ({ products, onClose, onBlocked }) => {
  const uid = useId();
  const qc = useQueryClient();
  const [reason, setReason] = useState<ProductBlockReason | ''>('');
  const ids = products.map(p => p.id);
  const tooMany = ids.length > PRODUCT_BLOCK_IDS_MAX;
  const preview = useQuery({
    queryKey: ['block-preview', [...ids].sort(), reason] as const,
    queryFn: () => productsApi.blockPreview({ productIds: ids, reason: reason as ProductBlockReason }),
    enabled: Boolean(reason) && ids.length > 0 && !tooMany,
    retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false,
  });
  const block = useMutation({
    mutationFn: () => productsApi.block({ productIds: ids, reason: reason as ProductBlockReason, previewToken: preview.data!.previewToken }),
    onSuccess: r => { invalidateAfterBlock(qc, r.blocked > 0); onBlocked?.(r); },
    onError: e => { if (e instanceof ApiError && e.status === 409) void preview.refetch(); },
  });
  const one = products.length === 1 ? products[0] : undefined;
  const title = one ? `Block "${one.nameEn}"` : `Block ${productsText(products.length)}`;
  const p = preview.data;
  const ready = Boolean(p) && !preview.isFetching && !block.isPending;

  if (block.isSuccess) {
    const r = block.data;
    return (
      <Modal label={title} title={r.blocked > 0 ? `Blocked ${productsText(r.blocked)}` : 'Nothing was blocked'} busy={false} onClose={onClose}
        footer={<button type="button" autoFocus onClick={onClose} className={primary}>Done</button>}>
        <p role="status">
          {r.blocked > 0 ? `Reason: ${r.reasonLabel}. ${one ? 'It is' : 'They are'} now in the Blocked tab.` : 'They were already blocked.'}
          {r.alreadyBlocked > 0 && r.blocked > 0 ? ` ${productsText(r.alreadyBlocked)} already blocked.` : ''}
        </p>
        {r.offersEnded > 0 && <p className="text-amber-800">{`${offersText(r.offersEnded)} ended. Unblocking does not bring ${r.offersEnded === 1 ? 'it' : 'them'} back.`}</p>}
        {r.blocked > 0 && <p className="text-xs text-gray-500">The Dashboard and Review update after the next comparison, in a few seconds.</p>}
      </Modal>
    );
  }

  const confirmLabel = !p || p.toBlock === 0 ? 'Block'
    : `Block ${one && p.toBlock === 1 ? 'product' : productsText(p.toBlock)}${p.activeOffersToEnd > 0 ? ` and end ${offersText(p.activeOffersToEnd)}` : ''}`;
  return (
    <Modal label={title} title={title} busy={block.isPending} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} disabled={block.isPending} className={secondary}>Cancel</button>
        <button type="button" onClick={() => block.mutate()} disabled={!ready || !p || p.toBlock === 0} className={danger}>
          {block.isPending ? 'Blocking…' : confirmLabel}
        </button>
      </>}>
      <p>{BLOCK_EXPLAINED}</p>
      <fieldset disabled={block.isPending}>
        <legend className="text-xs font-semibold text-gray-700">Reason</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRODUCT_BLOCK_REASONS.map(r => (
            <label key={r} className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer ${reason === r ? 'border-[#027864] bg-[#F2F7F6] text-gray-900' : 'border-gray-200'}`}>
              <input type="radio" name={`${uid}-reason`} value={r} checked={reason === r} onChange={() => { setReason(r); block.reset(); }} className="accent-[#027864]" />
              {PRODUCT_BLOCK_REASON_LABELS[r]}
            </label>
          ))}
        </div>
      </fieldset>
      {tooMany ? (
        <p role="alert" className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
          {`At most ${n(PRODUCT_BLOCK_IDS_MAX)} products can be blocked at once; ${n(ids.length)} are ticked. Untick some rows.`}
        </p>
      ) : !reason ? (
        <p className="text-xs text-gray-500">Choose a reason to see what will change.</p>
      ) : preview.isError ? (
        <p role="alert" className="text-xs text-red-700">{blockErrorText(preview.error)}</p>
      ) : !p ? (
        <p role="status" className="text-xs text-gray-500">Checking…</p>
      ) : (
        <div data-testid="block-preview" role="status" className="rounded-xl border border-gray-200 bg-[#F8FBFA] px-3 py-2 space-y-1 text-xs text-gray-700">
          <p className="font-semibold text-gray-900">{p.toBlock === 0 ? 'Nothing to block.' : `${productsText(p.toBlock)} will be blocked.`}</p>
          {p.alreadyBlocked > 0 && <p>{`${productsText(p.alreadyBlocked)} already blocked.`}</p>}
          {p.notFound > 0 && <p>{`${productsText(p.notFound)} not found.`}</p>}
          {p.activeOffersToEnd > 0 && (
            <p data-testid="offers-to-end" className="text-amber-800 font-semibold">
              {`${offersText(p.activeOffersToEnd)} on ${p.toBlock === 1 ? 'this product' : 'these products'} will end now. Unblocking does not bring ${p.activeOffersToEnd === 1 ? 'it' : 'them'} back.`}
            </p>
          )}
        </div>
      )}
      {block.isError && <p role="alert" className="text-xs text-red-700">{blockErrorText(block.error)}</p>}
    </Modal>
  );
};

/** Unblock one or the ticked blocked products (POST /api/products/unblock). Ended offers do not come back. */
export const UnblockDialog: React.FC<{ products: readonly BlockTarget[]; onClose: () => void; onUnblocked?: (r: UnblockResult) => void }> = ({ products, onClose, onUnblocked }) => {
  const qc = useQueryClient();
  const ids = products.map(p => p.id);
  const tooMany = ids.length > PRODUCT_BLOCK_IDS_MAX;
  const unblock = useMutation({
    mutationFn: () => productsApi.unblock({ productIds: ids }),
    onSuccess: r => { invalidateAfterBlock(qc, r.unblocked > 0); onUnblocked?.(r); },
  });
  const one = products.length === 1 ? products[0] : undefined;
  const title = one ? `Unblock "${one.nameEn}"?` : `Unblock ${productsText(products.length)}?`;

  if (unblock.isSuccess) {
    const r = unblock.data;
    return (
      <Modal label={title} title={r.unblocked > 0 ? `Unblocked ${productsText(r.unblocked)}` : 'Nothing was unblocked'} busy={false} onClose={onClose}
        footer={<button type="button" autoFocus onClick={onClose} className={primary}>Done</button>}>
        <p role="status">{r.unblocked > 0 ? `${one ? 'It is' : 'They are'} back in the catalogue and the next comparison.` : 'They were not blocked.'}</p>
        {r.unblocked > 0 && <p className="text-xs text-gray-500">{ENDED_OFFERS_NOT_RESTORED}</p>}
      </Modal>
    );
  }
  return (
    <Modal label={title} title={title} busy={unblock.isPending} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} disabled={unblock.isPending} className={secondary}>Cancel</button>
        <button type="button" autoFocus onClick={() => unblock.mutate()} disabled={unblock.isPending || tooMany} className={primary}>
          {unblock.isPending ? 'Unblocking…' : one ? 'Unblock' : `Unblock ${productsText(products.length)}`}
        </button>
      </>}>
      <p>{`${one ? 'It comes' : 'They come'} back in the catalogue, the marketplace tabs, the Dashboard and Review, with ${one ? 'its' : 'their'} status and details as before.`}</p>
      <p className="text-xs text-gray-500">{ENDED_OFFERS_NOT_RESTORED}</p>
      {tooMany && <p role="alert" className="text-xs text-amber-900">{`At most ${n(PRODUCT_BLOCK_IDS_MAX)} products can be unblocked at once; untick some rows.`}</p>}
      {unblock.isError && <p role="alert" className="text-xs text-red-700">{blockErrorText(unblock.error)}</p>}
    </Modal>
  );
};

/** A "Block" button for one product (row, drawer, product page); nothing without products.block. */
export const BlockButton: React.FC<{ product: BlockTarget; variant?: 'link' | 'button'; onBlocked?: (r: BlockResult) => void }> = ({ product, variant = 'link', onBlocked }) => {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  if (!can(BLOCK_PERMISSION)) return null;
  return (
    <>
      <button
        type="button" onClick={() => setOpen(true)} aria-label={`Block ${product.nameEn}`}
        className={variant === 'link' ? 'font-semibold text-red-700 hover:underline'
          : 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold border border-red-200 text-red-700 bg-white hover:bg-red-50'}
      >
        {variant === 'button' && <Ban className="w-3.5 h-3.5" aria-hidden />}
        Block
      </button>
      {open && <BlockDialog products={[product]} onClose={() => setOpen(false)} onBlocked={onBlocked} />}
    </>
  );
};
