import fs from 'fs';
import { test as setup, expect } from '@fixtures';
import { env } from '@config/env';
import { HUB_AUTH_STATE } from '@config/paths';

// Logs into the hub and saves the session in .auth/hub.json. Every hub test starts from this
// file, so it is already logged in with the company selected.
// The saved login is reused for one day, as long as the hub still accepts it.
// Force a new login: npm run hub:login
setup('hub login (reused for 24 hours)', async ({ browser, page, loginPage }) => {
  // SETUP: is there a saved login younger than 24 hours?
  const oneDay = 24 * 60 * 60 * 1000;
  let savedLoginIsFresh = false;
  if (fs.existsSync(HUB_AUTH_STATE)) {
    savedLoginIsFresh = Date.now() - fs.statSync(HUB_AUTH_STATE).mtimeMs < oneDay;
  }

  // SETUP: if so, open the orders page with it. Does the hub still accept it?
  if (savedLoginIsFresh) {
    const savedSession = await browser.newContext({ storageState: HUB_AUTH_STATE });
    const checkPage = await savedSession.newPage();
    await checkPage.goto(`${env.hub.HUB_URL}en/cms/orders`);
    // logged in = order table, not logged in = password field
    const orderRow = checkPage.locator('tbody tr').first();
    const passwordField = checkPage.locator('input[type="password"]');
    await expect(orderRow.or(passwordField).first()).toBeVisible({ timeout: 30_000 });
    const stillLoggedIn = await orderRow.isVisible();
    await savedSession.close();

    if (stillLoggedIn) {
      console.log('[hub login] saved login is less than 24 hours old and still valid → reused');
      return;
    }
    console.log('[hub login] saved login was rejected by the hub (login page shown) → logging in again');
  } else {
    console.log('[hub login] no saved login, or older than 24 hours → logging in');
  }

  const { HUB_USER_EMAIL, HUB_USER_PASSWORD, HUB_COMPANY_NAME } = env.hub;

  // ACTION: login page → email + password → pick the company
  await loginPage.goto();
  await loginPage.login(HUB_USER_EMAIL, HUB_USER_PASSWORD);
  await loginPage.selectCompany(HUB_COMPANY_NAME);

  // CHECK: landed on the orders page
  await expect(page, 'After login the hub should open the orders page').toHaveURL(/cms\/orders/);

  // save the session for all hub tests
  await page.context().storageState({ path: HUB_AUTH_STATE });
  console.log('[hub login] new login saved in .auth/hub.json (valid for 24 hours)');
});
