import { test, expect } from '@fixtures';
import { env } from '@config/env';
import { findRetailer } from '@db/queries/hub/pos';

// POS login: the location id and password from .env open the Order list.
// Needs: POS_URL, POS_LOCATION_ID, POS_PASSWORD in .env.
// Changes data: no (a login only updates the last login date).
test.describe('POS - login', () => {
  test('logs in with the location id and password', async ({ posPage, db }) => {
    // SETUP: the retailer that belongs to POS_LOCATION_ID
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);

    // ACTION: log in
    await posPage.login();

    // CHECK: the Order list is open, the header shows the retailer name and Sign out
    await expect(posPage.page.getByRole('heading', { name: 'Order list' })).toBeVisible();
    await expect(posPage.page.getByText(retailer.name, { exact: true })).toBeVisible();
    await expect(posPage.signOutButton()).toBeVisible();
  });
});
