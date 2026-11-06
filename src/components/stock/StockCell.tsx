import React from 'react';
import { AlertTriangle, Pencil } from 'lucide-react';
import { count } from '../pricing/priceChange';

/**
 * The catalogue stock with a mark for a manual edit or an open conflict (in words, never colour alone). Undefined when
 * the backend sends no catalogue stock (before the ADR 017 migration): a dash.
 */
export const CatalogueStockCell: React.FC<{ catalogueStock?: number; source?: 'erp' | 'owner'; conflict?: boolean }> = ({ catalogueStock, source, conflict }) => {
  if (catalogueStock === undefined) return <span className="text-gray-400">—</span>;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="font-mono" data-testid="catalogue-stock">{count(catalogueStock)}</span>
      {conflict ? (
        <span data-testid="stock-mark" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-[10px] font-semibold text-amber-900 whitespace-nowrap">
          <AlertTriangle className="w-3 h-3 text-amber-600" aria-hidden /> Stock conflict
        </span>
      ) : source === 'owner' ? (
        <span data-testid="stock-mark" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-[10px] font-semibold text-blue-800 whitespace-nowrap">
          <Pencil className="w-3 h-3" aria-hidden /> Manual edit
        </span>
      ) : null}
    </span>
  );
};
