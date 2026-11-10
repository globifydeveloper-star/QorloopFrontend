import React from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Check, ChevronDown, FileSpreadsheet, LayoutDashboard, ListChecks, Minus, Store, Upload, Wrench,
} from 'lucide-react';
import { HOW_IT_WORKS as C, type HowItWorksIcon, type RoleCell, type Term } from '../../content/howItWorks';
import { ROLES, ROLE_LABELS } from '../../api/types';
import { pathFor } from '../../routes/paths';

const ICONS: Record<HowItWorksIcon, React.ElementType> = {
  upload: Upload, changes: ListChecks, marketplace: Store, dashboard: LayoutDashboard, fix: Wrench, file: FileSpreadsheet,
};

const SECTION_ORDER = [
  C.sections.what, C.sections.loop, C.sections.sources, C.sections.words, C.sections.situations,
  C.sections.limits, C.sections.roles, C.sections.tips, C.sections.glossary,
];

const card = 'bg-white border border-gray-200 rounded-2xl shadow-sm';
const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#027864] focus-visible:ring-offset-2';

/** "How it works" (/how-it-works): static text from src/content/howItWorks.ts. No API call, every signed-in role. */
export const HowItWorksView: React.FC = () => (
  <div className="px-4 py-6 sm:p-8 max-w-5xl mx-auto space-y-8">
    <header className="space-y-2">
      <h1 className="text-2xl font-bold tracking-tight text-gray-900">{C.title}</h1>
      <p className="text-sm text-gray-600">{C.intro}</p>
    </header>

    <nav aria-label={C.jumpToLabel} className={`${card} p-4`}>
      <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">{C.jumpToLabel}</h2>
      <ol className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 text-sm">
        {SECTION_ORDER.map((s, i) => (
          <li key={s.id}>
            <a href={`#${s.id}`} className={`inline-flex gap-2 py-1 rounded text-[#027864] font-semibold hover:underline ${focus}`}>
              <span className="text-gray-400 tabular-nums" aria-hidden>{i + 1}.</span>{s.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>

    <Section {...C.sections.what}>
      <div className={`${card} p-5 space-y-2 text-sm text-gray-700`}>
        {C.what.map(p => <p key={p}>{p}</p>)}
      </div>
    </Section>

    <Section {...C.sections.loop}>
      <p className="text-sm text-gray-600">{C.loopIntro}</p>
      <ol aria-label={C.sections.loop.title} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {C.loop.map((step, i) => {
          const Icon = ICONS[step.icon];
          return (
            <li key={step.id} data-testid="loop-step" className={`${card} p-4 flex flex-col gap-3`}>
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 shrink-0 rounded-full bg-[#027864] text-white text-sm font-bold flex items-center justify-center" aria-hidden>{i + 1}</span>
                <span className="w-8 h-8 shrink-0 rounded-lg bg-[#E3FAF3] text-[#027864] flex items-center justify-center"><Icon className="w-4 h-4" aria-hidden /></span>
                <h3 className="text-sm font-bold text-gray-900">{step.title}</h3>
              </div>
              <p className="text-sm text-gray-600 flex-1">{step.text}</p>
              <Link
                to={pathFor(step.action.view)}
                data-view={step.action.view}
                className={`self-start inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-xs font-semibold border border-gray-300 bg-white text-[#027864] hover:bg-gray-50 ${focus}`}
              >
                {step.action.label} <ArrowRight className="w-3.5 h-3.5" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ol>
    </Section>

    <Section {...C.sections.sources}>
      <TermList terms={C.sources} />
    </Section>

    <Section {...C.sections.words}>
      <TermList terms={C.words} />
      <div className={`${card} p-5 space-y-3`}>
        <h3 className="text-sm font-bold text-gray-900">{C.compareTitle}</h3>
        <TermList terms={C.compare} plain />
        <p role="note" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" aria-hidden /> {C.compareWarning}
        </p>
      </div>
    </Section>

    <Section {...C.sections.situations}>
      <p className="text-sm text-gray-600">{C.situationsIntro}</p>
      <div className={`${card} divide-y divide-gray-100`}>
        {C.situations.map(s => (
          <details key={s.id} className="group">
            <summary className={`flex items-center justify-between gap-3 px-5 py-3.5 cursor-pointer list-none text-sm font-semibold text-gray-900 hover:bg-gray-50 rounded-2xl [&::-webkit-details-marker]:hidden ${focus}`}>
              {s.title}
              <ChevronDown className="w-4 h-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <ol className="px-5 pb-4 pl-10 list-decimal space-y-1 text-sm text-gray-700">
              {s.steps.map(step => <li key={step}>{step}</li>)}
            </ol>
          </details>
        ))}
      </div>
    </Section>

    <Section {...C.sections.limits}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900">{C.canTitle}</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-gray-700">
            {C.can.map(t => <li key={t} className="flex gap-2"><Check className="w-4 h-4 mt-0.5 shrink-0 text-[#027864]" aria-hidden />{t}</li>)}
          </ul>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900">{C.cannotTitle}</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-gray-700">
            {C.cannot.map(t => <li key={t} className="flex gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" aria-hidden />{t}</li>)}
          </ul>
        </div>
      </div>
    </Section>

    <Section {...C.sections.roles}>
      <p className="text-sm text-gray-600">{C.rolesIntro}</p>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[560px] text-sm">
          <caption className="sr-only">{C.sections.roles.title}</caption>
          <thead className="bg-[#F8FBFA] text-xs text-gray-600">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-semibold">{C.rolesActionHeader}</th>
              {ROLES.map(r => <th key={r} scope="col" className="px-3 py-3 text-center font-semibold">{ROLE_LABELS[r]}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {C.roles.map(row => (
              <tr key={row.id} data-testid="role-row">
                <th scope="row" className="px-4 py-2.5 text-left font-medium text-gray-800">{row.label}</th>
                {ROLES.map(r => <td key={r} className="px-3 py-2.5 text-center"><Cell value={row.roles[r]} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">{C.roleFootnote}</p>
    </Section>

    <Section {...C.sections.tips}>
      <ul className={`${card} p-5 space-y-1.5 text-sm text-gray-700`}>
        {C.tips.map(t => <li key={t} className="flex gap-2"><Check className="w-4 h-4 mt-0.5 shrink-0 text-[#027864]" aria-hidden />{t}</li>)}
      </ul>
    </Section>

    <Section {...C.sections.glossary}>
      <TermList terms={C.glossary} />
    </Section>
  </div>
);

const Section: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 space-y-3">
    <h2 id={`${id}-title`} className="text-lg font-bold text-gray-900">{title}</h2>
    {children}
  </section>
);

const TermList: React.FC<{ terms: readonly Term[]; plain?: boolean }> = ({ terms, plain }) => (
  <dl className={plain ? 'space-y-2' : `${card} divide-y divide-gray-100`}>
    {terms.map(t => (
      <div key={t.term} className={`${plain ? '' : 'px-5 py-3'} flex flex-col sm:flex-row sm:gap-4`}>
        <dt className="sm:w-56 shrink-0 text-sm font-semibold text-gray-900 flex flex-wrap items-center gap-2">
          {t.term}
          {t.urgent && <span className="px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-[11px] font-semibold text-red-700">{C.urgentBadge}</span>}
        </dt>
        <dd className="text-sm text-gray-600">{t.meaning}</dd>
      </div>
    ))}
  </dl>
);

const Cell: React.FC<{ value: RoleCell }> = ({ value }) =>
  value === true ? <span className="inline-flex items-center gap-1 text-[#027864] font-semibold"><Check className="w-4 h-4" aria-hidden />{C.roleCellYes}</span>
    : value === 'if-allowed' ? <span className="text-xs text-amber-800 font-semibold">{C.roleCellIfAllowed}</span>
      : <span className="inline-flex items-center gap-1 text-gray-400"><Minus className="w-4 h-4" aria-hidden />{C.roleCellNo}</span>;
