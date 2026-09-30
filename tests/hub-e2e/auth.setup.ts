// test (renamed `setup` here), expect ← src/fixtures/index.ts
// env            ← src/config/env.ts (HUB_USER_EMAIL, HUB_USER_PASSWORD, HUB_COMPANY_NAME from .env)
// HUB_AUTH_STATE ← src/config/paths.ts ('.auth/hub.json' — where the logged-in session is saved)
import fs from 'fs';
import { test as setup, expect } from '@fixtures';
import { env } from '@config/env';
import { HUB_AUTH_STATE } from '@config/paths';

/**
 * WHAT:   Logs into the hub and saves the browser session (cookies + storage) in .auth/hub.json.
 *         The saved login is reused for ONE DAY:
 *           - file younger than 24 hours AND the hub still accepts it → no new login
 *           - no file, older than 24 hours, or the hub shows the login page → log in again now
 * WHY:    playwright.config.ts runs this 'hub-setup' project before 'hub-e2e', and every hub
 *         test starts from the saved file (storageState) → already logged in, company selected.
 *         Replaces cy.session + cy.login() in the old repo.
 * FORCE A NEW LOGIN: npm run hub:login
 * CHANGES DATA: no.
 */
setup('hub login (reused for 24 hours)', async ({ browser, page, loginPage }) => {
  // SETUP: is there a saved login younger than 24 hours?
  const oneDay = 24 * 60 * 60 * 1000;
  let savedLoginIsFresh = false;
  if (fs.existsSync(HUB_AUTH_STATE)) {
    savedLoginIsFresh = Date.now() - fs.statSync(HUB_AUTH_STATE).mtimeMs < oneDay;
  }

  // SETUP: if so, open the orders page with it — does the hub still accept it?
  if (savedLoginIsFresh) {
    const savedSession = await browser.newContext({ storageState: HUB_AUTH_STATE });
    const checkPage = await savedSession.newPage();
    await checkPage.goto(`${env.hub.HUB_URL}en/cms/orders`);
    // wait until EITHER the order table (logged in) OR the password field (login page) shows
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

  // Values ← .env via env.hub (validated: fails with a clear message if one is missing)
  const { HUB_USER_EMAIL, HUB_USER_PASSWORD, HUB_COMPANY_NAME } = env.hub;

  // ACTION: login page → email + password → company picker → pick the company
  //         (each method is in src/pages/hub/LoginPage.ts)
  await loginPage.goto();                                   // opens {HUB_URL}en/auth/login
  await loginPage.login(HUB_USER_EMAIL, HUB_USER_PASSWORD); // waits for /auth/company
  await loginPage.selectCompany(HUB_COMPANY_NAME);          // search + click the company

  // CHECK: landed on the orders page
  await expect(page, 'After login the hub should open the orders page').toHaveURL(/cms\/orders/);

  // Save the session for all hub tests (the file's time = start of the 24-hour period)
  await page.context().storageState({ path: HUB_AUTH_STATE });
  console.log('[hub login] new login saved in .auth/hub.json (valid for 24 hours)');
});
