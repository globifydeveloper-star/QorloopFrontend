import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mail, Send, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';
import { teamApi } from '../../api/team';
import { ApiError } from '../../api/client';
import { ROLES, ROLE_LABELS, type PendingInvitation, type Role, type TeamMember } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { useApp } from '../../context/AppContext';
import { EmptyState, ErrorState, LoadingState } from '../common/States';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * SET-009 / SET-010. Every control here is a convenience: the server re-checks the permission and the
 * "only an Owner can grant or change Owner" and "keep at least one Owner" rules on every request.
 */
export const TeamView: React.FC = () => {
  const { me, can } = useAuth();
  const { showToast } = useApp();
  const qc = useQueryClient();
  const canInvite = can('team.invite');
  const canChangeRole = can('team.manage_roles');
  const canRemove = can('team.remove');
  const iAmOwner = me?.role === 'owner';
  const grantable = ROLES.filter(r => r !== 'owner' || iAmOwner);

  const members = useQuery({ queryKey: ['team', 'members'], queryFn: teamApi.members });
  const invitations = useQuery({ queryKey: ['team', 'invitations'], queryFn: teamApi.invitations, enabled: canInvite });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['team'] })]);
  const fail = (e: unknown) => showToast(e instanceof ApiError ? e.message : 'Something went wrong', 'error');

  const [inviting, setInviting] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'remove'; member: TeamMember } | { kind: 'role'; member: TeamMember; role: Role } | { kind: 'revoke'; invitation: PendingInvitation } | null>(null);

  const changeRole = useMutation({
    mutationFn: (v: { id: string; role: Role }) => teamApi.changeRole(v.id, v.role),
    onSuccess: async () => { showToast('Role updated. They will be asked to sign in again.'); setConfirm(null); await refresh(); },
    onError: e => { fail(e); setConfirm(null); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => teamApi.remove(id),
    onSuccess: async () => { showToast('Member removed'); setConfirm(null); await refresh(); },
    onError: e => { fail(e); setConfirm(null); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => teamApi.revoke(id),
    onSuccess: async () => { showToast('Invitation revoked'); setConfirm(null); await refresh(); },
    onError: e => { fail(e); setConfirm(null); },
  });
  const resend = useMutation({
    mutationFn: (id: string) => teamApi.resend(id),
    onSuccess: async () => { showToast('A new invitation email is on its way'); await refresh(); },
    onError: fail,
  });

  const rowCanChange = (m: TeamMember) => canChangeRole && m.user.id !== me?.user.id && (m.role !== 'owner' || iAmOwner);
  const rowCanRemove = (m: TeamMember) => canRemove && m.user.id !== me?.user.id && (m.role !== 'owner' || iAmOwner);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6 animate-in fade-in duration-150">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Team</h1>
          <p className="text-xs text-gray-500 mt-1">People who can sign in to {me?.tenant.name}. Access is by invitation only.</p>
        </div>
        {canInvite && (
          <button onClick={() => setInviting(true)} className="inline-flex items-center gap-2 h-10 px-4 rounded-[10px] text-sm font-semibold text-white bg-[#027864] hover:bg-[#02604F]">
            <UserPlus className="w-4 h-4" /> Invite member
          </button>
        )}
      </div>

      <section aria-labelledby="members-h" className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <h2 id="members-h" className="text-sm font-bold text-gray-900">Members{members.data ? ` (${members.data.length})` : ''}</h2>
        </div>
        {members.isPending ? <LoadingState rows={4} label="Loading members" /> :
         members.isError ? <ErrorState error={members.error} onRetry={() => members.refetch()} title="Could not load the team" /> :
         members.data.length === 0 ? <EmptyState title="No members yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                <tr><th className="text-left px-5 py-2.5 font-semibold">Name</th><th className="text-left px-3 py-2.5 font-semibold">Role</th><th className="text-left px-3 py-2.5 font-semibold">Two-step</th><th className="text-left px-3 py-2.5 font-semibold">Joined</th><th className="px-5 py-2.5" /></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {members.data.map(m => (
                  <tr key={m.id} data-testid={`member-${m.user.email}`}>
                    <td className="px-5 py-3">
                      <div className="font-semibold text-gray-900">{m.user.name}{m.user.id === me?.user.id && <span className="ml-2 text-[11px] font-medium text-gray-400">(you)</span>}</div>
                      <div className="text-xs text-gray-500">{m.user.email}</div>
                    </td>
                    <td className="px-3 py-3">
                      {rowCanChange(m) ? (
                        <select
                          aria-label={`Role for ${m.user.email}`} value={m.role}
                          onChange={e => setConfirm({ kind: 'role', member: m, role: e.target.value as Role })}
                          className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-[13px]"
                        >
                          {(m.role === 'owner' && !grantable.includes('owner') ? [...grantable, 'owner' as Role] : grantable).map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                      ) : <span className="text-[13px] text-gray-800">{ROLE_LABELS[m.role]}</span>}
                    </td>
                    <td className="px-3 py-3">
                      {m.user.mfaEnabled
                        ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><ShieldCheck className="w-3.5 h-3.5" /> On</span>
                        : <span className="text-xs text-gray-400">Off</span>}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-500">{when(m.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      {rowCanRemove(m) && (
                        <button onClick={() => setConfirm({ kind: 'remove', member: m })} aria-label={`Remove ${m.user.email}`} className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canInvite && (
        <section aria-labelledby="invites-h" className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100"><h2 id="invites-h" className="text-sm font-bold text-gray-900">Pending invitations{invitations.data ? ` (${invitations.data.length})` : ''}</h2></div>
          {invitations.isPending ? <LoadingState rows={2} label="Loading invitations" /> :
           invitations.isError ? <ErrorState error={invitations.error} onRetry={() => invitations.refetch()} title="Could not load invitations" /> :
           invitations.data.length === 0 ? <EmptyState title="No pending invitations" hint="Invite someone to give them access." /> : (
            <ul className="divide-y divide-gray-100">
              {invitations.data.map(i => {
                const expired = new Date(i.expiresAt) < new Date();
                return (
                  <li key={i.id} data-testid={`invite-${i.email}`} className="px-5 py-3 flex items-center gap-4">
                    <Mail className="w-4 h-4 text-gray-300 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-gray-900 truncate">{i.email}</div>
                      <div className="text-xs text-gray-500">{ROLE_LABELS[i.role]} · {expired ? <span className="text-amber-600 font-medium">Expired {when(i.expiresAt)}</span> : <>Expires {when(i.expiresAt)}</>}</div>
                    </div>
                    <button onClick={() => resend.mutate(i.id)} disabled={resend.isPending && resend.variables === i.id} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-60">
                      {resend.isPending && resend.variables === i.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Resend
                    </button>
                    <button onClick={() => setConfirm({ kind: 'revoke', invitation: i })} className="h-8 px-3 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50">Revoke</button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {inviting && <InviteDialog roles={grantable} onClose={() => setInviting(false)} onDone={async email => { setInviting(false); showToast(`Invitation sent to ${email}`); await refresh(); }} />}

      {confirm && (
        <Dialog onClose={() => setConfirm(null)} title={confirm.kind === 'remove' ? 'Remove this member?' : confirm.kind === 'revoke' ? 'Revoke this invitation?' : 'Change role?'}>
          <p className="text-sm text-gray-600">
            {confirm.kind === 'remove' && <>{confirm.member.user.email} will lose access immediately and be signed out everywhere.</>}
            {confirm.kind === 'revoke' && <>The link sent to {confirm.invitation.email} will stop working.</>}
            {confirm.kind === 'role' && <>{confirm.member.user.email} becomes <b>{ROLE_LABELS[confirm.role]}</b> and will be signed out everywhere so the change takes effect.</>}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setConfirm(null)} className="h-9 px-4 rounded-lg text-sm font-semibold border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>
            <button
              autoFocus
              onClick={() => confirm.kind === 'remove' ? remove.mutate(confirm.member.id) : confirm.kind === 'revoke' ? revoke.mutate(confirm.invitation.id) : changeRole.mutate({ id: confirm.member.id, role: confirm.role })}
              className={`h-9 px-4 rounded-lg text-sm font-semibold text-white ${confirm.kind === 'role' ? 'bg-[#027864] hover:bg-[#02604F]' : 'bg-red-600 hover:bg-red-700'}`}
            >
              {(remove.isPending || revoke.isPending || changeRole.isPending) ? 'Working…' : confirm.kind === 'remove' ? 'Remove' : confirm.kind === 'revoke' ? 'Revoke' : 'Change role'}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
};

const Dialog: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onMouseDown={e => e.target === e.currentTarget && onClose()} onKeyDown={e => e.key === 'Escape' && onClose()}>
    <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
      <div className="flex items-start justify-between"><h3 className="text-base font-bold text-gray-900">{title}</h3><button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button></div>
      <div className="mt-3">{children}</div>
    </div>
  </div>
);

const InviteDialog: React.FC<{ roles: Role[]; onClose: () => void; onDone: (email: string) => void }> = ({ roles, onClose, onDone }) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(roles.includes('catalogue_manager') ? 'catalogue_manager' : roles[0]);
  const [touched, setTouched] = useState(false);
  const invite = useMutation({ mutationFn: () => teamApi.invite(email.trim().toLowerCase(), role), onSuccess: () => onDone(email.trim()) });
  const emailError = touched && !EMAIL.test(email.trim()) ? 'Enter a valid email address' : undefined;
  const serverField = invite.error instanceof ApiError ? invite.error.fieldErrors : {};
  return (
    <Dialog title="Invite a team member" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); setTouched(true); if (EMAIL.test(email.trim())) invite.mutate(); }} className="space-y-4" noValidate>
        <div>
          <label htmlFor="invite-email" className="text-[13px] font-semibold text-gray-700">Email</label>
          <input id="invite-email" type="email" autoFocus value={email} onChange={e => setEmail(e.target.value)} aria-invalid={Boolean(emailError)}
            className={`mt-1.5 w-full h-11 px-3 rounded-[10px] border text-sm outline-none focus:ring-4 ${emailError ? 'border-red-400 focus:ring-red-100' : 'border-gray-300 focus:border-[#00B894] focus:ring-[#00D9A9]/15'}`} />
          {(emailError || serverField.email) && <p className="mt-1 text-xs text-red-600">{emailError ?? serverField.email}</p>}
        </div>
        <div>
          <label htmlFor="invite-role" className="text-[13px] font-semibold text-gray-700">Role</label>
          <select id="invite-role" value={role} onChange={e => setRole(e.target.value as Role)} className="mt-1.5 w-full h-11 px-3 rounded-[10px] border border-gray-300 bg-white text-sm">
            {roles.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          {!roles.includes('owner') && <p className="mt-1 text-xs text-gray-500">Only an Owner can invite another Owner.</p>}
        </div>
        {invite.error && !serverField.email && <div role="alert" className="rounded-[10px] border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{invite.error.message}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg text-sm font-semibold border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={invite.isPending} className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold text-white bg-[#027864] hover:bg-[#02604F] disabled:opacity-60">
            {invite.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Send invitation
          </button>
        </div>
      </form>
    </Dialog>
  );
};
