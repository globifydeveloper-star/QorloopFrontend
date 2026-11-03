// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onboardingApi } from '../onboarding';
import { progress } from '../../components/onboarding/__tests__/fixtures';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());
describe('committed onboarding GET shape', () => {
  it('unwraps all seven steps, evidence, percent and navigation enums without a request body or tenant ID', async () => {
    const data = progress(['owner_mfa', 'erp_upload']);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data }), { status: 200 }));
    expect(await onboardingApi.get()).toEqual(data);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual(['/api/onboarding', expect.objectContaining({ method: 'GET', credentials: 'include', body: undefined })]);
    expect(fetchMock.mock.calls[0][0]).not.toContain('?');
    expect(data.steps[0]).toMatchObject({ status: 'done', doneAt: null });
  });
  it('preserves the exact empty non-admin response without inferring tenant completion', async () => {
    const data = { steps: [], percent: 0, nextStepId: null, complete: false, marketplaces: [] };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data }), { status: 200 }));
    expect(await onboardingApi.get()).toEqual(data);
  });
  it('retains a real server Request ID and normalizes rejected connections', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }, requestId: 'onboarding-server' }), { status: 500 }));
    await expect(onboardingApi.get()).rejects.toMatchObject({ status: 500, requestId: 'onboarding-server' });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(onboardingApi.get()).rejects.toMatchObject({ status: 0, code: 'NETWORK', requestId: undefined });
  });
});
