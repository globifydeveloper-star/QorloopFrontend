// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { Role } from '../../../api/types';
import { ONBOARDING_KEY, type OnboardingProgress } from '../../../api/onboarding';
import { OnboardingChecklist, onboardingTiming } from '../OnboardingChecklist';
import { OnboardingPage } from '../OnboardingPage';
import { OnboardingRouteActions } from '../OnboardingRouteActions';
import { invalidateOnboarding } from '../shared';
import { progress, completeProgress, EVIDENCE_TIME } from './fixtures';
import { useReconSummary } from '../../recon/shared';
import { DashboardView } from '../../views/DashboardView';
import { TeamView } from '../../views/TeamView';
import { RealUploadModal } from '../../uploads/RealUploadModal';
import { matchView } from '../../../routes/paths';

let role: Role;
const perms = new Set<string>();
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ me: { role, user: { id: 'observer', name: 'Observer' }, tenant: { name: 'Store' } }, can: (p: string) => perms.has(p) }) }));
const app = { openUploadModal: vi.fn(), closeUploadModal: vi.fn(), showToast: vi.fn(), isUploadModalOpen: true, uploadModalPreselectedSource: 'marketplace' as 'marketplace' | 'erp' };
vi.mock('../../../context/AppContext', () => ({ useApp: () => app }));
vi.mock('../../recon/RealDashboardView', () => ({ RealDashboardView: () => <div>Real dashboard content</div> }));
vi.mock('../../../demo', () => ({ useDemo: () => { throw new Error('Real onboarding must not use demo state'); } }));

const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
let current: OnboardingProgress;
let handler: (url: string, init: RequestInit) => Response | Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;
let clients: QueryClient[] = [];
const Where = () => { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search + l.hash}</output>; };
const mount = (ui = <OnboardingChecklist />, path = '/') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } }); clients.push(qc);
  const rendered = render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>{ui}<Where /></MemoryRouter></QueryClientProvider>);
  return { ...rendered, qc };
};
const onboardingCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/onboarding');
const defaultPollMs = onboardingTiming.pollMs;
beforeEach(() => {
  vi.stubEnv('VITE_REAL_ONBOARDING', 'true'); role = 'admin'; perms.clear();
  ['settings.view', 'uploads.upload', 'team.view', 'team.invite'].forEach(p => perms.add(p));
  current = progress(); app.openUploadModal.mockClear(); app.closeUploadModal.mockClear(); app.showToast.mockClear(); app.uploadModalPreselectedSource = 'marketplace';
  handler = async () => ok(current);
  fetchMock = vi.fn((url: string, init: RequestInit = {}) => handler(url, init)); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); clients.forEach(q => q.clear()); clients = []; onboardingTiming.pollMs = defaultPollMs; vi.unstubAllGlobals(); });

describe('get-started checklist', () => {
  it('links to How it works from the card, on the Dashboard and on the Help & onboarding page', async () => {
    for (const ui of [<OnboardingChecklist />, <OnboardingPage />]) {
      const { unmount } = mount(ui);
      await screen.findByRole('progressbar');
      const card = within(screen.getByRole('region', { name: 'Get started' }));
      const link = card.getByRole('link', { name: 'New to Qorloop? Read How it works.' });
      expect(link.getAttribute('href')).toBe('/how-it-works');
      expect(matchView('/how-it-works')).toEqual({ view: 'how-it-works' });
      fireEvent.click(link);
      expect(screen.getByTestId('where').textContent).toBe('/how-it-works');
      unmount();
    }
  });

  it('shows loading, then four required steps with step one next and separate optional work for a new tenant', async () => {
    mount(); expect(screen.getByRole('status', { name: 'Loading get-started checklist…' })).toBeTruthy();
    expect((await screen.findByRole('progressbar')).getAttribute('aria-valuenow')).toBe('0');
    const required = within(screen.getByRole('region', { name: 'Required steps' }));
    const rows = required.getAllByRole('listitem'); expect(rows).toHaveLength(4);
    expect(rows[0].getAttribute('aria-current')).toBe('step'); expect(within(rows[0]).getByText('Next')).toBeTruthy();
    expect(required.getAllByText('To do')).toHaveLength(3);
    const optional = within(screen.getByRole('region', { name: 'Optional steps' }));
    expect(optional.getAllByRole('listitem')).toHaveLength(3); expect(optional.getAllByText('Optional')).toHaveLength(3); expect(optional.queryByText('Next')).toBeNull();
    expect(screen.getByText('Server description for Secure your account.')).toBeTruthy(); expect(screen.queryByText(/categor/i)).toBeNull();
    expect(screen.queryByText(/Recorded/)).toBeNull();
  });
  it('uses partial API progress, out-of-order statuses and Qatar timestamps; null MFA time stays absent', async () => {
    current = progress(['owner_mfa', 'marketplace_upload']); mount();
    const bar = await screen.findByRole('progressbar'); expect(bar.getAttribute('aria-valuenow')).toBe('50');
    const rows = within(screen.getByRole('region', { name: 'Required steps' })).getAllByRole('listitem');
    expect(within(rows[0]).getByText('Done')).toBeTruthy(); expect(rows[0].textContent).not.toContain('Recorded');
    expect(within(rows[1]).getByText('Next')).toBeTruthy(); expect(within(rows[2]).getByText('Done')).toBeTruthy();
    expect(screen.getByText('Recorded 03 Nov 2026, 11:30 (Qatar time)')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Marketplace upload evidence' }).textContent).toContain('Talabat: Applied upload · 03 Nov 2026, 11:30 (Qatar time)');
  });
  it.each(['catalogue_manager', 'analyst'] as const)('renders no wizard and makes no onboarding call for %s', value => {
    role = value; mount(); expect(screen.queryByRole('region', { name: 'Get started' })).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('shows Owner progress from the API and hides with the flag off or an empty server step list', async () => {
    role = 'owner'; current = progress(['owner_mfa']); const first = mount();
    expect((await screen.findByRole('progressbar')).getAttribute('aria-valuenow')).toBe('25'); first.unmount();
    current = { steps: [], percent: 0, nextStepId: null, complete: false, marketplaces: [] }; mount();
    await waitFor(() => expect(onboardingCalls()).toHaveLength(2)); await waitFor(() => expect(screen.queryByRole('region', { name: 'Get started' })).toBeNull());
    cleanup(); fetchMock.mockClear(); vi.stubEnv('VITE_REAL_ONBOARDING', ''); mount(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('hides a complete Dashboard card automatically, keeps Help completion honest, and can show evidence loss later', async () => {
    vi.stubEnv('VITE_REAL_RECON', 'true'); const { qc } = mount(<DashboardView />);
    await screen.findByRole('progressbar'); expect(screen.getByText('Real dashboard content')).toBeTruthy();
    current = completeProgress(); await act(async () => { await invalidateOnboarding(qc); });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Get started' })).toBeNull()); expect(screen.getByText('Real dashboard content')).toBeTruthy();
    current = progress(['owner_mfa']); await act(async () => { await invalidateOnboarding(qc); });
    expect((await screen.findByRole('progressbar')).getAttribute('aria-valuenow')).toBe('25');
    cleanup(); current = completeProgress(); mount(<OnboardingPage />, '/onboarding');
    expect(await screen.findByText("You're all set")).toBeTruthy(); expect(screen.queryByRole('region', { name: 'Get started' })).toBeNull();
  });
  it('does not count optional evidence toward required progress or hide remaining required work', async () => {
    current.steps.filter(s => !s.required).forEach(s => { s.status = 'done'; s.doneAt = EVIDENCE_TIME; }); mount();
    expect((await screen.findByRole('progressbar')).getAttribute('aria-valuenow')).toBe('0');
    expect(within(screen.getByRole('region', { name: 'Optional steps' })).getAllByText('Done')).toHaveLength(3);
  });
  it('refreshes incomplete server evidence automatically, hides the complete card and stops polling', async () => {
    onboardingTiming.pollMs = 20;
    mount(); await screen.findByRole('progressbar');
    current = completeProgress();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Get started' })).toBeNull());
    const reads = onboardingCalls().length;
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(onboardingCalls()).toHaveLength(reads);
    expect(fetchMock.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });
});

describe('all committed action targets', () => {
  it.each([
    ['Review security', '/settings#security'], ['Upload ERP file', '/uploads?start=erp'], ['Choose marketplace', '/uploads?start=marketplace'], ['Open dashboard', '/'],
    ['Invite team member', '/settings/team?invite=1'], ['Review pricing', '/pricing'], ['Generate files', '/files'],
  ])('navigates %s to %s without a progress write', async (label, path) => {
    mount(); fireEvent.click(await screen.findByRole('link', { name: label }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(path));
    expect(matchView(path.split(/[?#]/)[0])).not.toBeNull();
    expect(fetchMock.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });
  it.each(['erp', 'marketplace'])('opens and consumes the %s upload entry while retaining other query parameters', async source => {
    mount(<OnboardingRouteActions />, `/uploads?start=${source}&retain=1`);
    await waitFor(() => expect(app.openUploadModal).toHaveBeenCalledWith(source));
    expect(screen.getByTestId('where').textContent).toBe('/uploads?retain=1'); expect(app.openUploadModal).toHaveBeenCalledTimes(1);
  });
  it('opens the team invitation form and consumes its entry without sending anything', async () => {
    handler = async () => ok([]); mount(<TeamView />, '/settings/team?invite=1');
    expect(await screen.findByRole('dialog', { name: 'Invite a team member' })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/settings/team'));
    expect(fetchMock.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });
  it('requires an explicit marketplace choice and shows existing applied-upload evidence', async () => {
    current = progress(['owner_mfa', 'marketplace_upload']);
    mount(<RealUploadModal />);
    await screen.findByRole('list', { name: 'Marketplace upload evidence' });
    expect(screen.queryByRole('button', { name: 'ERP' })).toBeNull();
    for (const name of ['Talabat', 'Snoonu', 'Rafeeq', 'Keeta']) expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.change(screen.getByTestId('upload-input'), { target: { files: [new File(['barcode,name\n1,Water'], 'fixture.csv', { type: 'text/csv' })] } });
    expect((screen.getByRole('button', { name: 'Upload' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Snoonu' }));
    expect((screen.getByRole('button', { name: 'Upload' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('list', { name: 'Marketplace upload evidence' }).textContent).toContain('03 Nov 2026, 11:30 (Qatar time)');
  });
  it('preselects ERP for the ERP upload entry', () => {
    app.uploadModalPreselectedSource = 'erp'; mount(<RealUploadModal />);
    expect(screen.getByRole('button', { name: 'ERP' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('shared onboarding error states', () => {
  it.each(['network', 'proxy'])('shows the exact %s connection message with retry and no Request ID', async kind => {
    handler = async () => { if (kind === 'network') throw new TypeError('Failed to fetch'); return new Response(JSON.stringify({ error: { code: 'UPSTREAM_UNREACHABLE', message: 'Unavailable' } }), { status: 503 }); };
    mount(); expect(await screen.findByText("Qorloop can't reach the server. Check your connection and try again.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull(); expect(document.body.textContent).not.toContain('Request ID');
    handler = async () => ok(current); fireEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(await screen.findByRole('progressbar')).toBeTruthy();
  });
  it('shows 500 Request ID and Copy', async () => {
    const copy = vi.fn(async () => undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    handler = async () => new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }, requestId: 'onboarding-request' }), { status: 500 });
    mount(); expect(await screen.findByText('Request ID: onboarding-request')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith('onboarding-request'));
  });
});

describe('derived evidence refresh', () => {
  it('refreshes after a successful invitation and updates optional status from the GET', async () => {
    handler = async (url, init) => {
      if (url === '/api/onboarding') return ok(current);
      if (url === '/api/team/invitations' && init.method === 'POST') {
        current.steps.find(s => s.id === 'invite_team')!.status = 'done';
        return ok({ id: 'invitation', email: 'fixture@example.test', role: 'analyst', expiresAt: EVIDENCE_TIME });
      }
      return ok([]);
    };
    mount(<><OnboardingChecklist /><TeamView /></>); await screen.findByRole('progressbar');
    fireEvent.click(screen.getByRole('button', { name: 'Invite member' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'fixture@example.test' } }); fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(onboardingCalls().length).toBeGreaterThan(1));
    await waitFor(() => expect(screen.getByText('Invite your team').closest('li')!.textContent).toContain('Done'));
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });
  it('refreshes when a new comparison result arrives and hides the completed Dashboard card', async () => {
    let computedAt: string | null = null;
    current = progress(['owner_mfa', 'erp_upload', 'marketplace_upload']);
    handler = async url => url.startsWith('/api/recon/summary') ? ok({ reference: 'marketplace', computedAt, marketplaces: [] }) : ok(current);
    const Comparison = () => { useReconSummary(); return null; };
    const { qc } = mount(<><OnboardingChecklist /><Comparison /></>);
    expect((await screen.findByRole('progressbar')).getAttribute('aria-valuenow')).toBe('75');
    current = completeProgress(); computedAt = EVIDENCE_TIME;
    await act(async () => { await qc.invalidateQueries({ queryKey: ['recon', 'summary'] }); });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Get started' })).toBeNull());
    expect(onboardingCalls().length).toBeGreaterThan(1);
  });
  it('keeps the query untouched when the feature is off', async () => {
    vi.stubEnv('VITE_REAL_ONBOARDING', ''); const qc = new QueryClient();
    qc.setQueryData(ONBOARDING_KEY, progress()); await invalidateOnboarding(qc);
    expect(qc.getQueryState(ONBOARDING_KEY)?.isInvalidated).toBe(false); qc.clear();
  });
});
