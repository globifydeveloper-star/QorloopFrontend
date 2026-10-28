/**
 * Request/response types for the Qorloop API.
 *
 * Source of truth: the backend repository (QorLoopBackend) —
 *   packages/shared/src/contracts.ts   (request bodies, Zod)
 *   apps/api/src/auth/*.controller.ts  (responses)
 * They are mirrored here by hand and verified by the Playwright suite in e2e/ against a real backend.
 * Do not add a type here for an endpoint the backend does not have yet.
 */

export type Role = 'owner' | 'admin' | 'catalogue_manager' | 'analyst';
export const ROLES: readonly Role[] = ['owner', 'admin', 'catalogue_manager', 'analyst'];
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  catalogue_manager: 'Catalogue Manager',
  analyst: 'Analyst',
};

/** Permission names are defined by the backend (packages/core/src/roles.ts). The UI only checks membership. */
export type Permission = string;

export type AuthState = 'authenticated' | 'mfa_setup_required' | 'mfa_required';

export interface SessionResponse {
  state: AuthState;
  csrfToken: string;
  expiresAt: string;
  /** Returned once, after MFA enrollment is verified. Never stored by the app. */
  recoveryCodes?: string[];
}

export interface Me {
  user: { id: string; email: string; name: string };
  role: Role;
  permissions: Permission[];
  tenant: { id: string; name: string; slug: string };
  mfaEnabled: boolean;
  expiresAt: string;
}

export interface TeamMember {
  id: string;
  role: Role;
  active: boolean;
  createdAt: string;
  user: { id: string; email: string; name: string; mfaEnabled: boolean };
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt?: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string | string[]; details?: { path?: string; message: string }[] };
  requestId?: string;
}
