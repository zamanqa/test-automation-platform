import { test, expect } from '@fixtures';
import { readCssData } from '@data/css';
import { deleteReferralCode, deleteReferralCodesOfEmail, findCustomer, findReferralCodeOfEmail } from '@db/queries/hub/customers';

/**
 * WHAT:   CSS → "Refer a friend" → "Create referral code" → the code is shown and saved in the DB.
 * NEEDS:  .auth/css-data.json from 01-css-login.spec.ts (the CSS test customer); hub login (hub-setup).
 * CHANGES DATA: yes — creates a referral code (checkout.checkout_voucher_codes); removed again after the test.
 */
test.describe('CSS - refer a friend', () => {
  test('creates a referral code', async ({ cssPage, db, cleanup }) => {
    // SETUP: the CSS test customer and its email ← hub db
    const data = readCssData();
    test.skip(!data, 'no .auth/css-data.json — run 01-css-login.spec.ts first');
    const customer = await findCustomer(db.hub, data!.customerId);
    expect(customer, `customer ${data!.customerId}`).toBeDefined();

    // SETUP: a customer can have only one code → remove an old one first
    await deleteReferralCodesOfEmail(db.hub, customer!.email);

    // ACTION: Login CSS → Refer a friend → Create referral code
    await cssPage.loginFromHub(data!.customerId);
    await cssPage.openReferAFriend();
    await cssPage.page.getByRole('button', { name: 'Create referral code' }).click();

    // CHECK (DB): the customer now has a referral code
    await expect
      .poll(async () => (await findReferralCodeOfEmail(db.hub, customer!.email))?.voucher_code, { message: `referral code of ${customer!.email}` })
      .toBeTruthy();
    const code = (await findReferralCodeOfEmail(db.hub, customer!.email))!.voucher_code;
    cleanup.add('delete referral code', () => deleteReferralCode(db.hub, code));
    test.info().annotations.push({ type: 'referral code', description: code });

    // CHECK: the page shows that code, and "Create referral code" is gone
    await expect(cssPage.page.getByText(code)).toBeVisible();
    await expect(cssPage.page.getByRole('button', { name: 'Create referral code' })).toBeHidden();
  });
});
