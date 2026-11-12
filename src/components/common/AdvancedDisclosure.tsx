import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { advancedOpen, withAdvanced } from '../../lib/advanced';

/** Whether Advanced is open on this screen (?advanced=1), and a setter that keeps every other URL parameter. */
export function useAdvanced(): [boolean, (open: boolean) => void] {
  const [params, setParams] = useSearchParams();
  const open = advancedOpen(params);
  const setOpen = (next: boolean) => setParams(p => withAdvanced(p, next), { replace: true });
  return [open, setOpen];
}

/** A small "Advanced" button; what it holds is shown only while it is open. */
export const AdvancedDisclosure: React.FC<{ id: string; children: React.ReactNode; className?: string }> = ({ id, children, className = '' }) => {
  const [open, setOpen] = useAdvanced();
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 h-8 px-2.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" aria-hidden /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden />} Advanced
      </button>
      {open && <div id={id} className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
};
