import { expect, test, type Page, type BrowserContext } from '@playwright/test';
import { PASSWORD, emailedCode, emailedToken, provision } from './support';

/**
 * Task 9, flows 1-5 against the real backend, plus the security-relevant edges of Tasks 1 and 2, on the sign-in of
 * ADR 021: emailed codes on a new browser, trusted devices, shared computers and "Confirm it's you" for sensitive actions.
 * One fresh store per run (unique slug) so the suite can be re-run against the same database. Every test gets a fresh
 * browser context, so every test starts on an unknown device.
 */
const run = Date.now().toString(36);
const slug = 'e2e' + run;
const ownerEmail = `owner@${slug}.test`;
const managerEmail = `manager@${slug}.test`;
const adminEmail = `admin@${slug}.test`;
const analystEmail = `analyst@${slug}.test`;

let baseURL: string;
let newPassword = PASSWORD + '!2';
/** Who is signed in on the current page: the "Confirm it's you" handler reads their newest emailed code. */
let currentEmail = '';

const host = (s: string) => `http://${s}.localhost:3000`;
let inviteToken: string;
test.beforeAll(() => { baseURL = host(slug); inviteToken = provision(slug, ownerEmail).inviteToken; });

async function open(page: Page, path: string) { await page.goto(baseURL + path); }

/** Password step only. On a new browser this ends on the code step. */
async function signIn(page: Page, email: string, password = PASSWORD, { shared = false } = {}) {
  currentEmail = email;
  await open(page, '/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  if (shared) await page.getByLabel(/This is a shared computer/).check();
  await page.getByRole('button', { name: /sign in/i }).click();
}
async function enterEmailedCode(page: Page, email = currentEmail) {
  await expect(page.getByText(/Enter the 6-digit code we emailed to/)).toBeVisible();
  await page.getByLabel('6-digit code').fill(emailedCode(slug, email));
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
}
/** Password, then the emailed code (every test is a new browser, so the code is always asked for). */
async function signInWithCode(page: Page, email: string, password = PASSWORD) {
  await signIn(page, email, password);
  await enterEmailedCode(page, email);
}
async function ownerLogin(page: Page) {
  await signInWithCode(page, ownerEmail);
  await expect(page).toHaveURL(baseURL + '/');
}
const stepUpDialog = (page: Page) => page.getByRole('dialog', { name: "Confirm it's you" });
/** Any sensitive action may ask "Confirm it's you": answer it with the signed-in user's newest emailed code. */
async function confirmItsYou(page: Page) {
  const dialog = stepUpDialog(page);
  await expect(dialog.getByText(/we emailed to/)).toBeVisible();
  await dialog.getByLabel('6-digit code').fill(emailedCode(slug, currentEmail));
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog).toHaveCount(0);
}
test.beforeEach(async ({ page }) => { await page.addLocatorHandler(stepUpDialog(page), () => confirmItsYou(page)); });

async function acceptInvite(page: Page, token: string, name: string, email: string) {
  currentEmail = email;
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

test('1. the Owner accepts the invitation and is signed straight in', async ({ page }) => {
  await acceptInvite(page, inviteToken, 'Olivia Owner', ownerEmail);
  // No authenticator app is forced on Owners any more: accepting signs in, and this browser becomes a trusted device
  await expect(page).toHaveURL(baseURL + '/');
  expect(page.url()).not.toContain('token='); // the token is removed from the address bar
  await open(page, '/settings/team');
  await expect(page.getByTestId(`member-${ownerEmail}`)).toContainText('Olivia Owner');
});

test('2. a new browser asks for the emailed code: wrong codes show the tries left, the right one signs in', async ({ page }) => {
  await signIn(page, ownerEmail, 'wrong password here');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('6-digit code')).toHaveCount(0); // a wrong password never reaches the code step

  await signIn(page, ownerEmail);
  await expect(page.getByText(/Enter the 6-digit code we emailed to/)).toBeVisible();
  await expect(page.getByText(ownerEmail)).toHaveCount(0); // the address is shown masked
  // nothing in the app is reachable with only the password
  expect(await apiStatus(page, 'GET', '/api/team/members')).toBe(401);
  await page.getByLabel('6-digit code').fill(emailedCode(slug, ownerEmail) === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/Wrong code, \d tries? left/);
  await expect(page).toHaveURL(/\/login/); // still on the code step, not sent to "session expired"
  await expect(page.getByRole('button', { name: /Send a new code/ })).toBeVisible();

  await enterEmailedCode(page, ownerEmail);
  await expect(page).toHaveURL(baseURL + '/');
  await expect(page.getByRole('link', { name: /team/i }).or(page.getByRole('button', { name: 'Team' }))).toBeVisible();
});

test('3. a trusted browser signs in without a code after sign-out; a shared computer asks every time', async ({ page }) => {
  await ownerLogin(page);
  await page.getByTitle('Sign out').click();
  await expect(page).toHaveURL(/\/login/);
  await signIn(page, ownerEmail); // same browser: trusted since the code sign-in above
  await expect(page).toHaveURL(baseURL + '/');
  await page.getByTitle('Sign out').click();

  await signIn(page, ownerEmail, PASSWORD, { shared: true });
  await expect(page.getByText(/Enter the 6-digit code we emailed to/)).toBeVisible();
  await enterEmailedCode(page, ownerEmail);
  await expect(page).toHaveURL(baseURL + '/');
});

test('4a. on a session without a fresh code, inviting asks "Confirm it\'s you" first; cancelling changes nothing', async ({ page }) => {
  await page.removeLocatorHandler(stepUpDialog(page)); // this test answers the dialog itself
  await ownerLogin(page);
  await page.getByTitle('Sign out').click();
  await signIn(page, ownerEmail); // trusted browser: no code, so the step-up windows are closed
  await expect(page).toHaveURL(baseURL + '/');
  const email = `stepup@${slug}.test`;
  await open(page, '/settings/team');
  await page.getByRole('button', { name: 'Invite member' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Role', { exact: true }).selectOption({ label: 'Analyst' });
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(stepUpDialog(page)).toBeVisible();
  await expect(stepUpDialog(page)).toContainText('10 minutes');
  await page.keyboard.press('Escape');
  await expect(stepUpDialog(page)).toHaveCount(0);
  await expect(page.getByTestId(`invite-${email}`)).toHaveCount(0);

  await page.getByRole('button', { name: 'Send invitation' }).click();
  await confirmItsYou(page);
  await expect(page.getByTestId(`invite-${email}`)).toContainText('Analyst'); // the original request was sent again
  await page.getByTestId(`invite-${email}`).getByRole('button', { name: 'Revoke' }).click(); // window still open: no second dialog
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByTestId(`invite-${email}`)).toHaveCount(0);
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
  await acceptInvite(page, emailedToken(slug, managerEmail), 'Carla Manager', managerEmail);
  await expect(page).toHaveURL(baseURL + '/'); // accepting signs in straight away
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
  await acceptInvite(page, emailedToken(slug, adminEmail), 'Adam Admin', adminEmail);
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
  await signInWithCode(page, adminEmail, newPassword); // the reset signed out every device, so this browser needs a code
  await expect(page).toHaveURL(baseURL + '/');
});

test('a deep link returns to the same page after sign-in', async ({ page }) => {
  await open(page, '/settings/team');
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fteam/);
  await page.getByLabel('Work email').fill(adminEmail);
  await page.getByLabel('Password', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: /sign in/i }).click();
  currentEmail = adminEmail;
  await enterEmailedCode(page, adminEmail);
  await expect(page).toHaveURL(baseURL + '/settings/team');
});

test('when the session ends mid-task the user sees the session-expired screen', async ({ page, context }: { page: Page; context: BrowserContext }) => {
  await signInWithCode(page, adminEmail, newPassword);
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
