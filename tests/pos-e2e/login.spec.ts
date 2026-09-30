import { test, expect } from '@fixtures';
import { env } from '@config/env';
import { findRetailer } from '@db/queries/hub/pos';

/**
 * WHAT:   POS login: the location id + password from .env open the Order list.
 *         (Owner: keep login checks short — no wrong-password / empty-field cases.)
 * NEEDS:  POS_URL, POS_LOCATION_ID, POS_PASSWORD in .env; the retailer row (retailers.location_id).
 * CHANGES DATA: no (a login updates retailers.last_login_date).
 * posPage methods ← src/pages/pos/PosPage.ts
 */
test.describe('POS - login', () => {
  test('logs in with the location id and password', async ({ posPage, db }) => {
    // SETUP: the retailer that belongs to POS_LOCATION_ID ← hub db (retailers)
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);

    // ACTION: log in
    await posPage.login();

    // CHECK: Order list is open and the header shows the retailer's name ("Equinor ASA") and Sign out
    await expect(posPage.page.getByRole('heading', { name: 'Order list' })).toBeVisible();
    await expect(posPage.page.getByText(retailer.name, { exact: true })).toBeVisible();
    await expect(posPage.signOutButton()).toBeVisible();
  });
});
