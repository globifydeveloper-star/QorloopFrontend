import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keys typed into a field are text, never a shortcut. */
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName));

export interface DrawerPosition {
  /** "3 of 5", "3 of 50 loaded", or a sentence when the item left the list. */
  label: string;
}

/**
 * A modal panel that slides in from the right (about 480px on a laptop, the page behind dimmed; a full-screen sheet on a
 * phone). role="dialog" + aria-modal, labelled by its heading; focus moves to the heading on open, is trapped inside, and
 * goes back to `returnFocus()` (or the element that had it) on close. Esc closes. With `position`: Previous / Next and the
 * J / K keys move through the list that opened it. Every way of leaving (close, Esc, backdrop, Previous, Next, J, K) asks
 * "Discard changes?" first while `dirty`. The slide is off for prefers-reduced-motion (index.css .q-drawer).
 */
export const SideDrawer: React.FC<{
  title: React.ReactNode;
  /** Under the title: barcode, marketplace… */
  subtitle?: React.ReactNode;
  /** Right of the title, before the close button. */
  headerAction?: React.ReactNode;
  onClose: () => void;
  dirty?: boolean;
  position?: DrawerPosition;
  onPrevious?: () => void;
  onNext?: () => void;
  /** Where focus goes after closing; falls back to the element focused when the drawer opened. */
  returnFocus?: () => HTMLElement | null;
  /** Changes when the drawer shows another item: focus goes back to the heading. */
  itemKey?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, headerAction, onClose, dirty = false, position, onPrevious, onNext, returnFocus, itemKey, children }) => {
  const uid = useId();
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<Element | null>(null);
  const returnTo = useRef(returnFocus);
  returnTo.current = returnFocus;
  const [confirm, setConfirm] = useState<(() => void) | null>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);

  // Opening: remember who had focus, put it on the heading. Closing (unmount): give it back.
  useLayoutEffect(() => {
    opener.current = document.activeElement;
    return () => {
      const target = returnTo.current?.() ?? (opener.current instanceof HTMLElement ? opener.current : null);
      if (target?.isConnected) target.focus();
    };
  }, []);
  useEffect(() => { heading.current?.focus(); }, [itemKey]);
  useEffect(() => { if (confirm) keepEditing.current?.focus(); }, [confirm]);

  const guard = (action: () => void) => { if (dirty) setConfirm(() => action); else action(); };
  // The caller passes onPrevious / onNext only when there is a row to move to.
  const hasPrevious = Boolean(onPrevious && position);
  const hasNext = Boolean(onNext && position);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (confirm) setConfirm(null); else guard(onClose);
      return;
    }
    if (e.key === 'Tab' && panel.current) {
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => !el.closest('[inert]'));
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === heading.current || !panel.current.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !panel.current.contains(active))) { e.preventDefault(); first.focus(); }
      return;
    }
    if (confirm || e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
    const k = e.key.toLowerCase();
    if (k === 'j' && hasNext) { e.preventDefault(); guard(onNext!); }
    else if (k === 'k' && hasPrevious) { e.preventDefault(); guard(onPrevious!); }
  };

  const navButton = 'inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#027864]';

  return (
    <div className="fixed inset-0 z-40" onKeyDown={onKeyDown}>
      <div data-testid="drawer-backdrop" className="q-drawer-backdrop absolute inset-0 bg-gray-900/40" aria-hidden onClick={() => guard(onClose)} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        className="q-drawer absolute inset-y-0 right-0 w-full sm:w-[480px] sm:max-w-[calc(100vw-2rem)] bg-white shadow-2xl flex flex-col"
      >
        <header className="shrink-0 border-b border-gray-200 px-4 sm:px-5 py-4 space-y-3" inert={confirm ? true : undefined}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={`${uid}-title`} ref={heading} tabIndex={-1} className="text-base font-bold text-gray-900 break-words focus:outline-none">{title}</h2>
              {subtitle && <div className="mt-0.5 text-xs text-gray-500">{subtitle}</div>}
            </div>
            {headerAction}
            <button type="button" onClick={() => guard(onClose)} aria-label="Close" className="shrink-0 p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#027864]">
              <X className="w-4 h-4" aria-hidden />
            </button>
          </div>
          {position && (
            <nav aria-label="Move through the list" className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => guard(onPrevious!)} disabled={!hasPrevious} aria-keyshortcuts="K" className={navButton}>
                <ChevronLeft className="w-3.5 h-3.5" aria-hidden /> Previous
              </button>
              <span data-testid="drawer-position" aria-live="polite" className="text-xs text-gray-600 text-center">{position.label}</span>
              <button type="button" onClick={() => guard(onNext!)} disabled={!hasNext} aria-keyshortcuts="J" className={navButton}>
                Next <ChevronRight className="w-3.5 h-3.5" aria-hidden />
              </button>
            </nav>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-5 space-y-6" inert={confirm ? true : undefined}>
          {children}
        </div>
        {position && <p className="hidden sm:block shrink-0 border-t border-gray-100 px-5 py-2 text-[11px] text-gray-500">Keys: J next, K previous, Esc close.</p>}

        {confirm && (
          <div role="alertdialog" aria-modal="true" aria-labelledby={`${uid}-discard`} aria-describedby={`${uid}-discard-text`} className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 p-4">
            <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-xl space-y-3">
              <h3 id={`${uid}-discard`} className="text-sm font-bold text-gray-900">Discard changes?</h3>
              <p id={`${uid}-discard-text`} className="text-xs text-gray-600">You have changes that are not saved. If you leave now, they are lost.</p>
              <div className="flex justify-end gap-2">
                <button ref={keepEditing} type="button" onClick={() => setConfirm(null)} className="h-9 px-3 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50">Keep editing</button>
                <button type="button" onClick={() => { const go = confirm; setConfirm(null); go(); }} className="h-9 px-3 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-700">Discard changes</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
