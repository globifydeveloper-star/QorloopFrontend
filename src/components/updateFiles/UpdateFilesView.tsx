import React, { useRef } from 'react';
import { Check, Lock, Upload } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../auth/AuthContext';
import type { ReconMarketplaceSummary } from '../../api/recon';
import { readExportCounts } from '../../api/marketplaceValues';
import { EmptyState, ErrorState, LoadingState } from '../common/States';
import { NoReconAccess, marketplaceName, useReconSummary } from '../recon/shared';
import { count } from '../pricing/priceChange';
import { ReviewStep } from './ReviewStep';
import { AdjustStep } from './AdjustStep';
import { ExportPanel } from './ExportPanel';
import { EDIT_PERMISSION, STEPS, STEP_LABELS, useUpdateFilesState, type Step, type StepProps } from './urlState';

/**
 * "Update marketplace files" (/update-files), the main screen: for Talabat and Snoonu together, review what differs,
 * adjust the availability and price to export, then export the finished files. Needs recon.view to open; editing needs
 * marketplace.values_edit; exporting needs the files.* permissions. Uses the PROPOSED ADR 018 endpoints.
 */
export const UpdateFilesView: React.FC = () => {
  const { can } = useAuth();
  return can('recon.view') ? <UpdateFiles /> : <NoReconAccess />;
};

const UpdateFiles: React.FC = () => {
  const { can } = useAuth();
  const { openUploadModal } = useApp();
  const [state, set] = useUpdateFilesState();
  const summary = useReconSummary(state.reference);
  // Only enabled marketplaces with a file (the summary lists the enabled ones; hasData = an applied upload exists).
  const marketplaces = (summary.data?.marketplaces ?? []).filter(m => m.hasData);
  const selected = marketplaces.find(m => m.marketplaceId === state.marketplace) ?? marketplaces[0];
  const reference = state.reference ?? summary.data?.reference ?? 'marketplace';

  let body: React.ReactNode;
  if (summary.isPending) body = <LoadingState label="Loading the marketplaces…" rows={4} />;
  else if (summary.isError && !summary.data) body = <ErrorState error={summary.error} title="We could not load the marketplaces" onRetry={() => void summary.refetch()} />;
  else if (!selected) {
    body = (
      <section className="bg-white border border-gray-200 rounded-2xl">
        <EmptyState
          title="No marketplace file yet"
          hint="Upload a file from each marketplace first. You then update its values here and export the corrected file."
          action={can('uploads.upload') ? (
            <button onClick={() => openUploadModal()} className="mt-2 inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold text-white bg-[#027864] hover:bg-[#02604F] rounded-lg">
              <Upload className="w-3.5 h-3.5" aria-hidden /> Upload a marketplace file
            </button>
          ) : undefined}
        />
      </section>
    );
  } else {
    const props: StepProps = { summary: selected, marketplaces, reference, storeReference: summary.data!.reference, state, set };
    body = (
      <>
        <MarketplaceTabs marketplaces={marketplaces} selected={selected.marketplaceId} onSelect={id => set({ marketplace: id })} />
        <div role="tabpanel" id="update-files-panel" aria-labelledby={`tab-${selected.marketplaceId}`} className="space-y-5">
          {!can(EDIT_PERMISSION) && <ReadOnlyNote />}
          <StepBody step={state.step} {...props} />
        </div>
        {/* Talabat and Snoonu together, under every step except Export (which shows the same in full). */}
        {state.step !== 'export' && <ExportPanel marketplaces={marketplaces} reference={reference} variant="bar" onOpenExport={() => set({ step: 'export' })} />}
      </>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-5 pb-48 md:pb-40">
      <header className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Update marketplace files</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Check what differs on each marketplace, set the availability and price to export, then export the files. Times are Qatar time.
          </p>
        </div>
        <StepIndicator step={state.step} onStep={step => set({ step })} />
      </header>
      {body}
    </div>
  );
};

const StepBody: React.FC<StepProps & { step: Step }> = ({ step, ...props }) => {
  if (step === 'review') return <ReviewStep {...props} />;
  if (step === 'adjust') return <AdjustStep {...props} />;
  return <ExportPanel marketplaces={props.marketplaces} reference={props.reference} variant="full" />;
};

/** Review, Adjust, Export: each is a link-like button; the current one has aria-current="step". */
export const StepIndicator: React.FC<{ step: Step; onStep: (s: Step) => void }> = ({ step, onStep }) => {
  const at = STEPS.indexOf(step);
  return (
    <nav aria-label="Steps">
      <ol className="flex flex-wrap items-center gap-2">
        {STEPS.map((s, i) => {
          const current = s === step;
          const done = i < at;
          return (
            <li key={s} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden className="w-6 h-px bg-gray-300" />}
              <button
                type="button"
                onClick={() => onStep(s)}
                aria-current={current ? 'step' : undefined}
                data-testid={`step-${s}`}
                className={`inline-flex items-center gap-2 h-9 pl-1.5 pr-3.5 rounded-full border text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#027864] ${
                  current ? 'border-[#027864] bg-[#027864] text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${current ? 'bg-white text-[#027864]' : done ? 'bg-[#E3FAF3] text-[#027864]' : 'bg-gray-100 text-gray-600'}`}>
                  {done ? <Check className="w-3.5 h-3.5" aria-label="done" /> : i + 1}
                </span>
                {STEP_LABELS[s]}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

/** "Talabat | Snoonu" as tabs (arrow keys move between them); each shows its own counts. */
export const MarketplaceTabs: React.FC<{ marketplaces: ReconMarketplaceSummary[]; selected: string; onSelect: (id: string) => void }> = ({ marketplaces, selected, onSelect }) => {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (e: React.KeyboardEvent, i: number) => {
    const by = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? marketplaces.length - 1 : by ? (i + by + marketplaces.length) % marketplaces.length : -1;
    if (to < 0) return;
    e.preventDefault();
    const id = marketplaces[to]!.marketplaceId;
    onSelect(id);
    refs.current[id]?.focus();
  };
  return (
    <div role="tablist" aria-label="Marketplace" className="flex gap-2 overflow-x-auto border-b border-gray-200">
      {marketplaces.map((m, i) => {
        const active = m.marketplaceId === selected;
        const c = readExportCounts(m);
        const name = marketplaceName(m.marketplaceId);
        return (
          <button
            key={m.marketplaceId}
            ref={el => { refs.current[m.marketplaceId] = el; }}
            role="tab" id={`tab-${m.marketplaceId}`} aria-selected={active} aria-controls="update-files-panel" tabIndex={active ? 0 : -1}
            onClick={() => onSelect(m.marketplaceId)} onKeyDown={e => move(e, i)}
            className={`-mb-px shrink-0 px-4 py-2.5 border-b-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#027864] ${active ? 'border-[#027864]' : 'border-transparent hover:border-gray-300'}`}
          >
            <span className={`block text-sm font-bold ${active ? 'text-gray-900' : 'text-gray-600'}`}>{name}</span>
            <span data-testid={`tab-counts-${m.marketplaceId}`} className="block text-[11px] text-gray-500 whitespace-nowrap">
              {count(m.stock)} stock · {count(m.price)} price to fix
              {c.waitingForExport !== undefined ? ` · ${count(c.waitingForExport)} waiting` : ''}
              {m.stale ? ' · out of date' : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export const ReadOnlyNote: React.FC = () => (
  <p role="note" data-testid="read-only" className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs text-gray-700">
    <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-500" aria-hidden />
    <span>Your role can see these values but not change them. An Owner, Admin or Catalogue Manager can change the values to export.</span>
  </p>
);
