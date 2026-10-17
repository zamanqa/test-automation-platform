import { test, expect } from '@fixtures';
import { env } from '@config/env';
import { countRetailerQuotes, findNewestRetailerQuote, findRetailer, getNewestQuoteId } from '@db/queries/hub/pos';

// POS navigation and checks without data: list search and order, 404 page, sign out, language,
// and the Create order steps (Reset, Back, Ship to store, voucher, submit without items or with a wrong email).
// Needs: login only.
// Changes data: no (a Create order without items is refused, no quote is created).
test.describe('POS - navigation and validation', () => {
  test.beforeEach(async ({ posPage }) => {
    await posPage.login();
  });

  test('a search without a match shows an empty list', async ({ posPage }) => {
    // ACTION: search a text no quote has
    await posPage.openOrderList();
    await posPage.search('qa_no_match_xyz');

    // CHECK: "... of 0 results" and no quote link in the table
    await expect(posPage.pageInfo()).toContainText('of 0 results');
    await expect(posPage.rows().getByRole('link')).toHaveCount(0);
  });

  test('clearing the search shows the whole list again, as many quotes as in the DB', async ({ posPage, db }) => {
    // SETUP: number of quotes of the retailer
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const total = await countRetailerQuotes(db.hub, retailer.retailer_id, retailer.company_id);

    // ACTION: search a text without a match, then empty the search box
    await posPage.openOrderList();
    await posPage.search('qa_no_match_xyz');
    await expect(posPage.pageInfo()).toContainText('of 0 results');
    await posPage.search('');

    // CHECK: "... of <total> results" and 5 rows again
    await expect(posPage.pageInfo()).toContainText(`of ${total} results`);
    await expect(posPage.rows()).toHaveCount(5);
  });

  test('the order list shows the newest quote first', async ({ posPage, db }) => {
    // SETUP: newest quote of the retailer
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const newest = await getNewestQuoteId(db.hub, retailer.retailer_id, retailer.company_id);
    test.skip(!newest, 'no quote for this retailer');

    // ACTION: open the Order list
    await posPage.openOrderList();

    // CHECK: sorted by Created at, newest first; the first row is the newest quote
    await expect(posPage.page).toHaveURL(/sort=created_at&desc=true/);
    await expect(posPage.rows().first().getByRole('link', { name: newest })).toBeVisible();
  });

  test('an unknown quote id shows the 404 page, "Take me back" goes to the order list', async ({ posPage }) => {
    // ACTION: open a quote that does not exist
    await posPage.page.goto(`${posPage.origin}/en/protected/orders/quote_00000000`);

    // CHECK: 404 page with the path
    await expect(posPage.page.getByRole('heading', { name: '404' })).toBeVisible();
    await expect(posPage.page.getByText('Page not found: /en/protected/orders/quote_00000000')).toBeVisible();

    // ACTION: Take me back
    await posPage.page.getByRole('button', { name: 'Take me back' }).click();

    // CHECK: the Order list is shown
    await expect(posPage.page).toHaveURL(/\/en\/protected\/orders/);
    await expect(posPage.page.getByRole('heading', { name: 'Order list' })).toBeVisible();
  });

  test('Sign out goes to the login page', async ({ posPage }) => {
    // ACTION: Sign out
    await posPage.openOrderList();
    await posPage.signOutButton().click();

    // CHECK: the login page is shown
    await expect(posPage.page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(posPage.page).toHaveURL(/\/en\/auth\//);
  });

  test('after Sign out, the order list and a quote link open the login page', async ({ posPage, db }) => {
    // SETUP: a quote of the retailer, signed out
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const quote = await findNewestRetailerQuote(db.hub, retailer.retailer_id, retailer.company_id);
    test.skip(!quote, 'no quote for this retailer');
    await posPage.openOrderList();
    await posPage.signOutButton().click();
    await expect(posPage.page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    // ACTION + CHECK: the Order list goes to login
    await posPage.page.goto(`${posPage.origin}/en/protected/orders`);
    await expect(posPage.page).toHaveURL(/\/en\/auth\/login/);
    await expect(posPage.page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    // ACTION + CHECK: the quote page goes to login
    await posPage.page.goto(`${posPage.origin}/en/protected/orders/${quote!.draft_id}`);
    await expect(posPage.page).toHaveURL(/\/en\/auth\/login/);
    await expect(posPage.page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('the language menu switches to Deutsch and back to English', async ({ posPage }) => {
    // ACTION: en → Deutsch
    await posPage.openOrderList();
    await posPage.page.getByRole('button', { name: 'en', exact: true }).click();
    await posPage.page.getByRole('menuitem', { name: 'Deutsch' }).click();

    // CHECK: German URL and texts, same page
    await expect(posPage.page).toHaveURL(/\/de\/protected\/orders/);
    await expect(posPage.page.getByRole('heading', { name: 'Bestellübersicht' })).toBeVisible();
    await expect(posPage.page.getByRole('button', { name: 'Abmelden' })).toBeVisible();

    // ACTION: de → English (the menu stays open after the switch: Escape closes it first)
    await posPage.page.keyboard.press('Escape');
    await posPage.page.getByRole('button', { name: 'de', exact: true }).click();
    await posPage.page.getByRole('menuitem', { name: 'English' }).click();

    // CHECK: English again
    await expect(posPage.page).toHaveURL(/\/en\/protected\/orders/);
    await expect(posPage.page.getByRole('heading', { name: 'Order list' })).toBeVisible();
  });

  test('Create order: Reset goes back to step 01 and empties the typed customer', async ({ posPage }) => {
    // SETUP: Customer step with an email
    await posPage.openCreateOrder();
    await posPage.continue();
    await posPage.page.getByRole('textbox', { name: 'Email *' }).fill('qa_reset@example.com');

    // ACTION: Reset
    await posPage.page.getByRole('button', { name: 'Reset' }).click();

    // CHECK: step 01 with no items
    await expect(posPage.page).toHaveURL(/step=01/);
    await expect(posPage.page.getByText('No items added')).toBeVisible();

    // CHECK: the Customer step has an empty email
    await posPage.continue();
    await expect(posPage.page.getByRole('textbox', { name: 'Email *' })).toHaveValue('');
  });

  test('Create order: Back and Continue keep the typed email', async ({ posPage }) => {
    // SETUP: Customer step with an email
    await posPage.openCreateOrder();
    await posPage.continue();
    await posPage.page.getByRole('textbox', { name: 'Email *' }).fill('qa_back@example.com');

    // ACTION: Continue to Review, then Back
    await posPage.continue();
    await expect(posPage.page.getByRole('heading', { name: 'Review' })).toBeVisible();
    await expect(posPage.page.getByText('qa_back@example.com')).toBeVisible();
    await posPage.page.getByRole('button', { name: 'Back' }).click();

    // CHECK: Customer step, email still there
    await expect(posPage.page).toHaveURL(/step=02/);
    await expect(posPage.page.getByRole('textbox', { name: 'Email *' })).toHaveValue('qa_back@example.com');
  });

  test('Create order: "Ship to store" is ticked and shows the store address', async ({ posPage }) => {
    // ACTION: open the Customer step
    await posPage.openCreateOrder();
    await posPage.continue();

    // CHECK: Ship to store ticked, store address shown, "Same as shipping" can not be changed
    await expect(posPage.page.getByRole('checkbox', { name: 'Ship to store' })).toBeChecked();
    await expect(posPage.page.getByText('Hansaallee 139')).toBeVisible();
    await expect(posPage.page.getByText('60320, Troll, Germany')).toBeVisible();
    await expect(posPage.page.getByRole('checkbox', { name: 'Same as shipping' })).toBeDisabled();
  });

  test('Create order: a voucher code is kept as typed and shown on Review', async ({ posPage }) => {
    // ACTION: type an unknown code (the POS does not check codes, the checkout does)
    await posPage.openCreateOrder();
    await posPage.addVoucher('qa_unknown_code');

    // CHECK: the code is locked in with a Remove button
    await expect(posPage.page.getByRole('textbox', { name: 'Voucher code' })).toBeDisabled();
    await expect(posPage.page.getByRole('textbox', { name: 'Voucher code' })).toHaveValue('qa_unknown_code');
    await expect(posPage.page.getByRole('button', { name: 'Remove' })).toBeVisible();

    // CHECK: Review shows the code
    await posPage.continue();
    await posPage.continue();
    await expect(posPage.page.getByRole('heading', { name: 'Review' })).toBeVisible();
    await expect(posPage.page.getByText('qa_unknown_code')).toBeVisible();

    // ACTION + CHECK: Reset removes the code
    await posPage.page.getByRole('button', { name: 'Reset' }).click();
    await expect(posPage.page.getByRole('textbox', { name: 'Voucher code' })).toHaveValue('');
  });

  test('Create order with no items is blocked and creates no quote', async ({ posPage, db }) => {
    // SETUP: number of quotes before
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const before = await countRetailerQuotes(db.hub, retailer.retailer_id, retailer.company_id);

    // ACTION: no item, no customer → Review → Create order
    await posPage.openCreateOrder();
    await posPage.continue();
    await posPage.continue();
    await expect(posPage.page.getByRole('heading', { name: 'Review' })).toBeVisible();
    await posPage.page.getByRole('button', { name: 'Create order' }).click();

    // CHECK: the item message is shown, the page stays on Review
    await expect(posPage.page.getByText('The order must include at least one item')).toBeVisible();
    await expect(posPage.page).toHaveURL(/step=03/);

    // CHECK: readable messages without field names (soft: today the raw validation text is shown, bug CIR-1593)
    await expect.soft(posPage.page.getByText('customer.billing.city -')).toHaveCount(0);

    // CHECK: no new quote in the DB
    expect(await countRetailerQuotes(db.hub, retailer.retailer_id, retailer.company_id)).toBe(before);

    // clean up the unfinished order in the browser
    await posPage.page.getByRole('button', { name: 'Reset' }).click();
  });

  test('an invalid email is refused on the Customer step', async ({ posPage }) => {
    // Fails today: Continue moves on to Review without a message (bug CIR-1593)
    // SETUP: Customer step
    await posPage.openCreateOrder();
    await posPage.continue();

    // ACTION: wrong email → Continue
    await posPage.page.getByRole('textbox', { name: 'Email *' }).fill('not-an-email');
    await posPage.continue();

    // CHECK: an email message, still on the Customer step
    await expect(posPage.page.getByText(/email/i).filter({ hasText: /valid/i })).toBeVisible();
    await expect(posPage.page.getByRole('heading', { name: 'Customer' })).toBeVisible();
    await expect(posPage.page).toHaveURL(/step=02/);

    // clean up the unfinished order in the browser
    await posPage.page.getByRole('button', { name: 'Reset' }).click();
  });
});
