import { api } from './client';
import type { PendingInvitation, Role, TeamMember } from './types';

export const teamApi = {
  members: () => api<TeamMember[]>('/api/team/members'),
  invitations: () => api<PendingInvitation[]>('/api/team/invitations'),
  invite: (email: string, role: Role) => api<PendingInvitation>('/api/team/invitations', { method: 'POST', body: { email, role } }),
  resend: (id: string) => api<unknown>(`/api/team/invitations/${id}/resend`, { method: 'POST' }),
  revoke: (id: string) => api<{ success: boolean }>(`/api/team/invitations/${id}`, { method: 'DELETE' }),
  changeRole: (memberId: string, role: Role) => api<{ id: string; role: Role }>(`/api/team/members/${memberId}/role`, { method: 'PATCH', body: { role } }),
  remove: (memberId: string) => api<{ success: boolean }>(`/api/team/members/${memberId}`, { method: 'DELETE' }),
};
