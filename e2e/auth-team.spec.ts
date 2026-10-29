import { expect, test, type Page, type BrowserContext } from '@playwright/test';
import { PASSWORD, emailedToken, provision, totp } from './support';

/**
 * Task 9, flows 1-5 against the real backend, plus the security-relevant edges of Tasks 1 and 2.
 * One fresh store per run (unique slug) so the suite can be re-run against the same database.
 */
const run = Date.now().toString(36);
const slug = 'e2e' + run;
const ownerEmail = `owner@${slug}.test`;
const managerEmail = `manager@${slug}.test`;
const adminEmail = `admin@${slug}.test`;
const analystEmail = `analyst@${slug}.test`;

let baseURL: string;
let ownerSecret: string;
let recoveryCodes: string[] = [];
let newPassword = PASSWORD + '!2';

const host = (s: string) => `http://${s}.localhost:3000`;
let inviteToken: string;
test.beforeAll(() => { baseURL = host(slug); inviteToken = provision(slug, ownerEmail).inviteToken; });

async function open(page: Page, path: string) { await page.goto(baseURL + path); }

async function signIn(page: Page, email: string, password = PASSWORD) {
  await open(page, '/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
}
async function enterTotp(page: Page) {
  await page.getByLabel('6-digit code').fill(await totp(ownerSecret));
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
}
async function ownerLogin(page: Page) {
  await signIn(page, ownerEmail);
  await enterTotp(page);
  await expect(page).toHaveURL(baseURL + '/');
}
async function acceptInvite(page: Page, token: string, name: string) {
  await open(page, `/invitations/accept#token=${token}`);
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Activate account' }).click();
}
async function invite(page: Page, email: string, role: string) {
  await open(page, '/settings/team');
  await page.getByRole('button', { name: 'Invite member' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Role', { exact: true }).selectOption({ label: role });
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByTestId(`invite-${email}`)).toBeVisible();
}
/** Same-origin API call from the page, as the app itself makes it (cookie + CSRF header). */
async function apiStatus(page: Page, method: string, path: string, body?: unknown): Promise<number> {
  return page.evaluate(async ([m, p, b]) => {
    const csrf = document.cookie.split('; ').find(c => c.startsWith('qorloop.csrf='))?.split('=')[1] ?? '';
    const r = await fetch(p as string, { method: m as string, credentials: 'include', headers: { ...(b ? { 'Content-Type': 'application/json' } : {}), 'X-CSRF-Token': csrf }, body: b ? JSON.stringify(b) : undefined });
    return r.status;
  }, [method, path, body] as const);
}

test.describe.configure({ mode: 'serial' });

test('an unknown store address says so instead of failing silently', async ({ page }) => {
  await page.goto('http://nosuchstore.localhost:3000/');
  await expect(page.getByText('We could not find this store')).toBeVisible();
});

test('there is no public sign-up or store registration anywhere', async ({ page }) => {
  await open(page, '/login');
  await expect(page.getByText(/sign up|create (an )?account|register|start free/i)).toHaveCount(0);
  for (const path of ['/signup', '/register', '/sign-up']) {
    await open(page, path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test('1. the Owner accepts the invitation and sets a password', async ({ page }) => {
  await acceptInvite(page, inviteToken, 'Olivia Owner');
  // Owners cannot reach the app until two-step verification is on
  await expect(page).toHaveURL(/\/mfa\/setup/);
  expect(page.url()).not.toContain('token='); // the token is removed from the address bar
  await open(page, '/settings/team');
  await expect(page).toHaveURL(/\/mfa\/setup/);
});

test('2. the Owner sets up two-step verification and receives recovery codes once', async ({ page }) => {
  await signIn(page, ownerEmail); // no TOTP yet, so login lands on setup again
  await expect(page).toHaveURL(/\/mfa\/setup/);
  await page.getByLabel('Confirm your password').fill('wrong password here');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Confirm your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByAltText('Authenticator QR code')).toBeVisible();
  await page.locator('summary', { hasText: 'enter the key manually' }).click();
  ownerSecret = (await page.getByTestId('totp-secret').innerText()).trim();

  await page.getByLabel('6-digit code').fill('000000');
  await page.getByRole('button', { name: /verify and turn on/i }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('6-digit code').fill(await totp(ownerSecret));
  await page.getByRole('button', { name: /verify and turn on/i }).click();

  const codes = page.getByTestId('recovery-codes').locator('li');
  await expect(codes).toHaveCount(10);
  recoveryCodes = await codes.allInnerTexts();
  await expect(page.getByRole('button', { name: 'Continue to Qorloop' })).toBeDisabled();
  await page.getByLabel(/stored these codes/i).check();
  await page.getByRole('button', { name: 'Continue to Qorloop' }).click();
  await expect(page).toHaveURL(baseURL + '/');
  await expect(page.getByRole('link', { name: /team/i }).or(page.getByRole('button', { name: 'Team' }))).toBeVisible();
});

test('3. the Owner logs out and back in with a code, and with a recovery code', async ({ page }) => {
  await signIn(page, ownerEmail);
  await expect(page).toHaveURL(/\/mfa\/verify/);
  // the restricted session gives no access to the app
  await open(page, '/settings/team');
  await expect(page).toHaveURL(/\/mfa\/verify/);
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await enterTotp(page);
  await expect(page).toHaveURL(baseURL + '/');
  await page.getByTitle('Sign out').click();
  await expect(page).toHaveURL(/\/login/);

  // recovery code, once
  await signIn(page, ownerEmail);
  await page.getByRole('button', { name: /recovery code instead/i }).click();
  await page.getByLabel('Recovery code').fill(recoveryCodes[0]);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page).toHaveURL(baseURL + '/');
  await page.getByTitle('Sign out').click();
  await signIn(page, ownerEmail);
  await page.getByRole('button', { name: /recovery code instead/i }).click();
  await page.getByLabel('Recovery code').fill(recoveryCodes[0]);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible(); // already used
});

test('4. the Owner invites a Catalogue Manager; roles offered include Owner only for Owners', async ({ page }) => {
  await ownerLogin(page);
  await open(page, '/settings/team');
  await expect(page.getByTestId(`member-${ownerEmail}`)).toContainText('Olivia Owner');
  await page.getByRole('button', { name: 'Invite member' }).click();
  await expect(page.getByLabel('Role', { exact: true }).locator('option')).toHaveText(['Owner', 'Admin', 'Catalogue Manager', 'Analyst']);
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('Enter a valid email address')).toBeVisible();
  await page.getByLabel('Email').fill(managerEmail);
  await page.getByLabel('Role', { exact: true }).selectOption({ label: 'Catalogue Manager' });
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByTestId(`invite-${managerEmail}`)).toContainText('Catalogue Manager');
  // duplicate invitations are refused by the server and the message is shown
  await page.getByRole('button', { name: 'Invite member' }).click();
  await page.getByLabel('Email').fill(managerEmail);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('alert')).toContainText(/pending invitation/i);
});

test('5. the Catalogue Manager signs in and sees only what the role allows', async ({ page }) => {
  await acceptInvite(page, emailedToken(slug, managerEmail), 'Carla Manager');
  await expect(page).toHaveURL(baseURL + '/'); // no MFA enrolment forced on non-Owners by default
  await open(page, '/settings/team');
  await expect(page.getByTestId(`member-${managerEmail}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite member' })).toHaveCount(0);
  await expect(page.getByText('Pending invitations')).toHaveCount(0);
  await expect(page.getByLabel(`Role for ${ownerEmail}`)).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Remove ${ownerEmail}` })).toHaveCount(0);
  // the UI hiding is not the security boundary: the server refuses the same actions
  expect(await apiStatus(page, 'POST', '/api/team/invitations', { email: 'x@y.test', role: 'analyst' })).toBe(403);
  expect(await apiStatus(page, 'GET', '/api/team/invitations')).toBe(403);
  expect(await apiStatus(page, 'DELETE', '/api/team/members/00000000-0000-4000-8000-000000000000')).toBe(403);
});

test('an Admin cannot grant Owner (UI and server)', async ({ page }) => {
  await ownerLogin(page);
  await invite(page, adminEmail, 'Admin');
  await page.getByTitle('Sign out').click();
  await expect(page).toHaveURL(/\/login/);
  await acceptInvite(page, emailedToken(slug, adminEmail), 'Adam Admin');
  await expect(page).toHaveURL(baseURL + '/');
  await open(page, '/settings/team');
  await page.getByRole('button', { name: 'Invite member' }).click();
  await expect(page.getByLabel('Role', { exact: true }).locator('option')).toHaveText(['Admin', 'Catalogue Manager', 'Analyst']);
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await apiStatus(page, 'POST', '/api/team/invitations', { email: 'sneaky@y.test', role: 'owner' })).toBe(403);
  // nor can they touch the Owner
  await expect(page.getByLabel(`Role for ${ownerEmail}`)).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Remove ${ownerEmail}` })).toHaveCount(0);
});

test('the Owner changes a role, revokes an invitation and removes a member', async ({ page }) => {
  await ownerLogin(page);
  await open(page, '/settings/team');
  await page.getByLabel(`Role for ${managerEmail}`).selectOption({ label: 'Analyst' });
  await page.getByRole('dialog').getByRole('button', { name: 'Change role' }).click();
  await expect(page.getByTestId(`member-${managerEmail}`)).toContainText('Analyst');
  await expect(page.getByLabel(`Role for ${ownerEmail}`)).toHaveCount(0); // cannot edit yourself

  await invite(page, analystEmail, 'Analyst');
  await page.getByTestId(`invite-${analystEmail}`).getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByTestId(`invite-${analystEmail}`)).toHaveCount(0);

  await page.getByRole('button', { name: `Remove ${managerEmail}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId(`member-${managerEmail}`)).toHaveCount(0);
});

test('forgot and reset password, then sign in with the new password', async ({ page }) => {
  await open(page, '/forgot-password');
  await page.getByLabel('Work email').fill('nobody@nowhere.test');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  const unknown = await page.getByRole('status').innerText();
  await open(page, '/forgot-password');
  await page.getByLabel('Work email').fill(adminEmail);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  expect(await page.getByRole('status').innerText()).toBe(unknown); // same answer for known and unknown

  await open(page, `/password/reset#token=${emailedToken(slug, adminEmail, 'reset')}`);
  await page.getByLabel('New password', { exact: true }).fill('short');
  await page.getByLabel('Confirm new password').fill('short');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText(/at least 12 characters/i).first()).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm new password').fill(newPassword);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page).toHaveURL(/\/login\?reset=1/);
  await signIn(page, adminEmail, PASSWORD);
  await expect(page.getByRole('alert')).toBeVisible(); // old password no longer works
  await signIn(page, adminEmail, newPassword);
  await expect(page).toHaveURL(baseURL + '/');
});

test('a deep link returns to the same page after sign-in', async ({ page }) => {
  await open(page, '/settings/team');
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fteam/);
  await page.getByLabel('Work email').fill(adminEmail);
  await page.getByLabel('Password', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(baseURL + '/settings/team');
});

test('when the session ends mid-task the user sees the session-expired screen', async ({ page, context }: { page: Page; context: BrowserContext }) => {
  await signIn(page, adminEmail, newPassword);
  await expect(page).toHaveURL(baseURL + '/');
  await open(page, '/settings/team');
  await page.getByRole('button', { name: 'Invite member' }).click();
  await page.getByLabel('Email').fill('late@' + slug + '.test');
  await context.clearCookies({ name: 'qorloop' }); // idle/absolute timeout: the server no longer knows this browser
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page).toHaveURL(/\/session-expired/);
  await expect(page.getByRole('heading', { name: 'Your session has expired' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in again' }).click();
  await expect(page).toHaveURL(/\/login/);
});
