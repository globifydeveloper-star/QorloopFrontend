import { useQuery, type QueryClient } from '@tanstack/react-query';
import { stockApi } from '../../api/stock';
import { expectRecompute } from '../recon/shared';

/** Open conflicts (list and count). */
export const STOCK_KEY = ['stock'] as const;
export const stockConflictsKey = (page: number) => ['stock', 'conflicts', page] as const;
/** Under ['products'], so every product invalidation refreshes it too. */
export const productStockKey = (id: string) => ['products', 'stock', id] as const;

export function useProductStock(id: string) {
  return useQuery({ queryKey: productStockKey(id), queryFn: ({ signal }) => stockApi.get(id, signal), enabled: Boolean(id), retry: false });
}

/**
 * After a stock write: the conflicts, every product list and detail (catalogueStock, stockConflict), upload change lists
 * (their catalogue stock now) and the activity. A write that changed something queues one recompute on the server, so
 * the comparison is polled until it lands.
 */
export function invalidateStock(qc: QueryClient, changed: boolean, productId?: string) {
  void qc.invalidateQueries({ queryKey: STOCK_KEY });
  void qc.invalidateQueries({ queryKey: ['products'] });
  void qc.invalidateQueries({ queryKey: ['uploads', 'changes'] });
  void qc.invalidateQueries({ queryKey: ['activity'] });
  if (productId) void qc.invalidateQueries({ queryKey: ['product-history', productId] });
  if (changed) expectRecompute(qc);
  else void qc.invalidateQueries({ queryKey: ['recon', 'summary'] });
}
