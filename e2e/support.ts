import { execFileSync } from 'node:child_process';
import { generate } from 'otplib';

/**
 * The only non-browser access the tests have: reading single-use tokens that production sends by email.
 * Runs the backend's test-support script (scripts/e2e-support.ts) against the same database the API uses.
 */
const BACKEND_DIR = process.env.QORLOOP_BACKEND_DIR ?? '../QorLoopBackend';

function backend(args: string[]): Record<string, unknown> {
  const out = execFileSync('npx', ['tsx', 'scripts/e2e-support.ts', ...args], { cwd: BACKEND_DIR, env: process.env, encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop()!);
}

export const provision = (slug: string, ownerEmail: string) =>
  backend(['provision', '--slug', slug, '--owner-email', ownerEmail]) as { tenantId: string; hostname: string; inviteToken: string };

export function emailedToken(slug: string, email: string, kind: 'invitation' | 'reset' = 'invitation'): string {
  const { token } = backend(['token', '--slug', slug, '--email', email, '--kind', kind]) as { token: string | null };
  if (!token) throw new Error(`No ${kind} email found for ${email}`);
  return token;
}

/**
 * The server rejects a TOTP time step it has already accepted (replay protection), so every code we submit
 * must come from a later step than the previous one. Steps are 30 s; the server tolerates one step either side.
 */
let lastStep = 0;
export async function totp(secret: string): Promise<string> {
  for (;;) {
    const current = Math.floor(Date.now() / 30_000);
    const step = Math.max(current, lastStep + 1);
    if (step <= current + 1) {
      lastStep = step;
      return generate({ secret, epoch: step * 30 });
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}
export const PASSWORD = 'Correct horse battery staple!';
