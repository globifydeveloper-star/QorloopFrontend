import React from 'react';
import { XCircle } from 'lucide-react';
import { HOW_IT_WORKS } from '../../content/howItWorks';

/**
 * Shown in Generated files when a file that carries prices is made against the ERP price. Generate stays disabled until
 * "I understand" is ticked; the caller clears the tick whenever a choice changes.
 */
export const ErpPriceFileWarning: React.FC<{ understood: boolean; onChange: (v: boolean) => void }> = ({ understood, onChange }) => (
  <div data-testid="erp-price-warning" className="p-3 rounded-lg border border-red-300 bg-red-50 text-xs text-red-800 space-y-2">
    <p role="alert" className="flex items-start gap-2 font-semibold">
      <XCircle className="w-4 h-4 shrink-0 text-red-600 mt-px" aria-hidden /> {HOW_IT_WORKS.compareWarning}
    </p>
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={understood} onChange={e => onChange(e.target.checked)} className="accent-red-700" /> I understand
    </label>
  </div>
);
