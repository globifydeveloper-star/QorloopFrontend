import React from 'react';
import { useApp } from '../../context/AppContext';
import { CompareReference } from '../../types';

/**
 * "Compare against: Marketplace price | ERP price" — shared by the price reports and generated files.
 * Without `onChange` it reads and writes the app-wide (demo) choice; with it, the caller owns the value
 * (the real reconciliation screens, where the store's default comes from the server). `value` may then be
 * undefined while that default is still loading.
 */
export const CompareAgainstToggle: React.FC<{
  className?: string;
  label?: string;
  value?: CompareReference;
  onChange?: (ref: CompareReference) => void;
  disabled?: boolean;
}> = ({ className = '', label = 'Compare against', value, onChange, disabled = false }) => {
  const app = useApp();
  const current = onChange ? value : app.compareReference;
  const set = onChange ?? app.setCompareReference;

  const options: { id: CompareReference; label: string }[] = [
    { id: 'marketplace', label: 'Marketplace price' },
    { id: 'erp', label: 'ERP price' },
  ];

  return (
    <div role="group" aria-label={label} className={`flex items-center gap-2 text-xs ${className}`}>
      <span className="text-gray-500">{label}</span>
      <div className="inline-flex items-center p-0.5 bg-gray-100 border border-gray-200 rounded-lg">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={current === o.id}
            disabled={disabled}
            onClick={() => set(o.id)}
            className={`px-2.5 py-1 rounded-md font-semibold transition-colors disabled:opacity-60 ${current === o.id
                ? 'bg-white text-[#027864] shadow-xs border border-gray-200'
                : 'text-gray-500 hover:text-gray-700 border border-transparent'
              }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
};
