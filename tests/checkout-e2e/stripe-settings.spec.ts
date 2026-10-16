import { test, expect } from '@fixtures';
import { addresses, carts } from '@data/static/checkout';
import {
  switchCheckoutFeature, switchDifferentShipping, switchFirstCheckboxRequired, switchPhoneValidation, switchPostalCodeLimit,
} from '@api/checkout-settings';

// Contact-form fields that a checkout setting switches on/off or makes required (Shopify + Stripe shop).
// Each test changes the setting in the hub DB (schema checkout), refreshes the checkout API cache, checks the form,
// and puts the old value back after the test (cleanup), also when it fails.
// Needs: hub DB write access; the checkout API refresh route POST /v1/settings/refresh.
// The form keeps typed values in the browser, so checks of an empty form use openWithEmptyForm().
// Changes data: the shop's checkout settings for a few seconds per test (everyone using this shop sees it). Nothing is paid.

const shop = carts.shopifyStripe;

test.describe('Checkout settings - Shopify + Stripe - contact form fields', () => {
  test.describe.configure({ mode: 'default' }); // in order, one at a time; a failure does not skip the rest

  test('company: required → error when empty; optional → no error; off → hidden', async ({ checkoutPage, db, request, cleanup }) => {
    // SETUP: company field shown and required
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'allow_company_inputs', true);
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'require_company_input', true);

    // ACTION: open an empty form and click Continue
    await checkoutPage.openWithEmptyForm(shop);
    await checkoutPage.nextStepButton.click();

    // CHECK: "Company is required."
    await expect(checkoutPage.fieldBox('billing_company')).toContainText('Company is required.');

    // SETUP: company optional
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'require_company_input', false);

    // ACTION + CHECK: the field is still shown, no error after Continue
    await checkoutPage.openWithEmptyForm(shop);
    await checkoutPage.nextStepButton.click();
    await expect(checkoutPage.fieldBox('billing_first_name')).toContainText('First name is required.'); // the form was checked
    await expect(checkoutPage.fieldBox('billing_company')).toBeVisible();
    await expect(checkoutPage.fieldBox('billing_company')).not.toContainText('is required');

    // SETUP + CHECK: company switched off → the field is not shown
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'allow_company_inputs', false);
    await checkoutPage.open(shop);
    await expect(checkoutPage.fieldBox('billing_company')).toBeHidden();
  });

  test('VAT number: required → error when empty; optional → no error; off → hidden', async ({ checkoutPage, db, request, cleanup }) => {
    // SETUP: VAT field shown and required
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'allow_vat_number', true);
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'require_vat_number', true);

    // ACTION + CHECK: Continue on an empty form → "VAT number is required."
    await checkoutPage.openWithEmptyForm(shop);
    await checkoutPage.nextStepButton.click();
    await expect(checkoutPage.fieldBox('vat_number')).toContainText('VAT number is required.');

    // SETUP: VAT optional
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'require_vat_number', false);

    // ACTION + CHECK: the field is shown, no error after Continue
    await checkoutPage.openWithEmptyForm(shop);
    await checkoutPage.nextStepButton.click();
    await expect(checkoutPage.fieldBox('billing_first_name')).toContainText('First name is required.');
    await expect(checkoutPage.fieldBox('vat_number')).toBeVisible();
    await expect(checkoutPage.fieldBox('vat_number')).not.toContainText('is required');

    // SETUP + CHECK: VAT switched off → the field is not shown
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'allow_vat_number', false);
    await checkoutPage.open(shop);
    await expect(checkoutPage.fieldBox('vat_number')).toBeHidden();
  });

  test('date of birth: required → error when empty; optional → no error; off → hidden', async ({ checkoutPage, db, request, cleanup }) => {
    // SETUP: date of birth shown and required
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'allow_date_of_birth', true);
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'require_date_of_birth', true);

    // ACTION + CHECK: Continue on an empty form → "Date of birth is required."
    await checkoutPage.openWithEmptyForm(shop);
    await checkoutPage.nextStepButton.click();
    await expect(checkoutPage.fieldBox('date_of_birth')).toContainText('Date of birth is required.');

    // ACTION + CHECK: fill the whole form (picks the youngest allowed birth date) → the payment step opens
    await checkoutPage.fillBillingDetails(addresses.germany);
    await checkoutPage.continue();

    // SETUP: date of birth optional
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'require_date_of_birth', false);

    // ACTION + CHECK: the field is shown, no error after Continue
    await checkoutPage.openWithEmptyForm(shop);
    await checkoutPage.nextStepButton.click();
    await expect(checkoutPage.fieldBox('billing_first_name')).toContainText('First name is required.');
    await expect(checkoutPage.fieldBox('date_of_birth')).toBeVisible();
    await expect(checkoutPage.fieldBox('date_of_birth')).not.toContainText('is required');

    // SETUP + CHECK: date of birth switched off → the field is not shown
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'allow_date_of_birth', false);
    await checkoutPage.open(shop);
    await expect(checkoutPage.fieldBox('date_of_birth')).toBeHidden();
  });

  test('buyer reference: on → shown, max 255 characters; off → hidden', async ({ checkoutPage, db, request, cleanup }) => {
    // SETUP: buyer reference / Leitweg-ID switched on, contact form filled
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'allow_buyer_reference', true);
    await checkoutPage.openWithEmptyForm(shop);
    await checkoutPage.fillBillingDetails(addresses.germany);

    // ACTION: type 256 characters and click Continue
    await checkoutPage.typeInField('buyer_reference', 'x'.repeat(256));
    await checkoutPage.nextStepButton.click();

    // CHECK: error, the payment step does not open
    await expect(checkoutPage.fieldBox('buyer_reference')).toContainText('Buyer reference / Leitweg-ID must be at most 255 characters.');
    await expect(checkoutPage.payButton).toBeHidden();

    // ACTION + CHECK: 255 characters are allowed → no error, Continue opens the payment step
    await checkoutPage.typeInField('buyer_reference', 'x'.repeat(255));
    await expect(checkoutPage.fieldBox('buyer_reference')).not.toContainText('at most 255');
    await checkoutPage.continue();

    // SETUP + CHECK: switched off → the field is not shown
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'allow_buyer_reference', false);
    await checkoutPage.openWithEmptyForm(shop);
    await expect(checkoutPage.fieldBox('buyer_reference')).toBeHidden();
  });

  test('notes and address remark: on → shown and optional; off → hidden', async ({ checkoutPage, db, request, cleanup }) => {
    // SETUP: both switched on
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'allow_notes', true);
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'allow_address_addition', true);

    // ACTION + CHECK: both are shown and give no error when empty
    await checkoutPage.openWithEmptyForm(shop);
    await checkoutPage.nextStepButton.click();
    await expect(checkoutPage.fieldBox('billing_first_name')).toContainText('First name is required.');
    await expect(checkoutPage.fieldBox('billing_notes')).toBeVisible();
    await expect(checkoutPage.fieldBox('billing_notes')).not.toContainText('is required');
    await expect(checkoutPage.fieldBox('billing_address_addition')).toBeVisible();
    await expect(checkoutPage.fieldBox('billing_address_addition')).not.toContainText('is required');

    // SETUP + CHECK: both switched off → not shown
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'allow_notes', false);
    await switchCheckoutFeature(db, request, cleanup, shop.apiKey, 'allow_address_addition', false);
    await checkoutPage.open(shop);
    await expect(checkoutPage.fieldBox('billing_notes')).toBeHidden();
    await expect(checkoutPage.fieldBox('billing_address_addition')).toBeHidden();
  });

  test('phone validation: on → phone required and checked; off → any text', async ({ checkoutPage, db, request, cleanup }) => {
    // SETUP: phone validation on, contact form filled
    await switchPhoneValidation(db, request, cleanup, shop.apiKey, true);
    await checkoutPage.openWithEmptyForm(shop);
    await checkoutPage.fillBillingDetails(addresses.germany);

    // ACTION + CHECK: empty phone → error
    await checkoutPage.typeInField('phone', '');
    await checkoutPage.nextStepButton.click();
    await expect(checkoutPage.fieldBox('phone')).toContainText('Phone must be valid.');

    // ACTION + CHECK: letters → error, the payment step does not open
    await checkoutPage.typeInField('phone', 'abc');
    await checkoutPage.nextStepButton.click();
    await expect(checkoutPage.fieldBox('phone')).toContainText('Phone must be valid.');
    await expect(checkoutPage.payButton).toBeHidden();

    // ACTION + CHECK: a real German mobile number → the payment step opens
    await checkoutPage.typeInField('phone', '+4917656824720');
    await checkoutPage.continue();

    // SETUP: phone validation off
    await switchPhoneValidation(db, request, cleanup, shop.apiKey, false);

    // ACTION + CHECK: letters are accepted → the payment step opens
    await checkoutPage.openWithEmptyForm(shop);
    await checkoutPage.fillBillingDetails(addresses.germany);
    await checkoutPage.typeInField('phone', 'abc');
    await checkoutPage.continue();
  });

  test('different shipping address: on → switch shows shipping fields with required checks; off → no switch', async ({ page, checkoutPage, db, request, cleanup }) => {
    // SETUP: "different shipping address" allowed
    await switchDifferentShipping(db, request, cleanup, shop.apiKey, true);

    // ACTION: fill the billing address, switch on "Different shipping address", click Continue
    await checkoutPage.openWithEmptyForm(shop);
    await checkoutPage.fillBillingDetails(addresses.germany);
    await page.getByTestId('switch_different_shipping').getByRole('switch').click();
    await checkoutPage.nextStepButton.click();

    // CHECK: the shipping fields are shown and the required ones say so; the payment step does not open
    await expect(checkoutPage.fieldBox('shipping_first_name')).toContainText('First name is required.');
    await expect(checkoutPage.fieldBox('shipping_last_name')).toContainText('Last name is required.');
    await expect(checkoutPage.fieldBox('shipping_street')).toContainText('Street is required.');
    await expect(checkoutPage.fieldBox('shipping_street_number')).toContainText('Street number is required.');
    await expect(checkoutPage.fieldBox('shipping_postal_code')).toContainText('Postal Code is required.');
    await expect(checkoutPage.fieldBox('shipping_city')).toContainText('City is required.');
    await expect(checkoutPage.payButton).toBeHidden();

    // SETUP + CHECK: switched off → the switch is not shown
    await switchDifferentShipping(db, request, cleanup, shop.apiKey, false);
    await checkoutPage.openWithEmptyForm(shop);
    await expect(page.getByTestId('switch_different_shipping')).toBeHidden();
  });

  test('postal code limit 603xx: 10115 is refused, 60320 is accepted', async ({ checkoutPage, db, request, cleanup }) => {
    // SETUP: only postal codes 603xx allowed
    await switchPostalCodeLimit(db, request, cleanup, shop.apiKey, true, ['603xx']);

    // ACTION: a Berlin postal code → Continue
    await checkoutPage.openWithEmptyForm(shop);
    await checkoutPage.fillBillingDetails({ ...addresses.germany, postalCode: '10115', city: 'Berlin' });
    await checkoutPage.clickContinue();

    // CHECK: "limit reached, postal code area", the payment step does not open
    await expect(checkoutPage.errorAlert()).toContainText('limit reached, postal code area');
    await expect(checkoutPage.payButton).toBeHidden();

    // ACTION + CHECK: a Frankfurt postal code (603xx) → the payment step opens
    await checkoutPage.openWithEmptyForm(shop);
    await checkoutPage.fillBillingDetails(addresses.germany);
    await checkoutPage.continue();
  });

  test('postal code limit with patterns of different length: 60320 matches 603xx and is accepted', async ({ checkoutPage, db, request, cleanup }) => {
    // SETUP: two patterns, 1010 (4 digits) and 603xx (5 digits)
    await switchPostalCodeLimit(db, request, cleanup, shop.apiKey, true, ['1010', '603xx']);

    // ACTION: Frankfurt 60320 → Continue
    await checkoutPage.openWithEmptyForm(shop);
    await checkoutPage.fillBillingDetails(addresses.germany);
    await checkoutPage.clickContinue();

    // CHECK: no "out of bounds" error, the payment step opens (bug CIR-1591: every pattern must have the code's length)
    await expect(checkoutPage.payButton).toBeVisible();
    await expect(checkoutPage.errorAlert()).toBeHidden();
  });

  test('terms checkbox: required → Pay disabled until ticked; not required → Pay enabled at once', async ({ checkoutPage, db, request, cleanup }) => {
    // SETUP: the first checkbox (terms) required
    await switchFirstCheckboxRequired(db, request, cleanup, shop.apiKey, true);
    await checkoutPage.openWithEmptyForm(shop);
    await checkoutPage.fillBillingDetails(addresses.germany);
    await checkoutPage.continue();

    // ACTION + CHECK: choose invoice without ticking → Pay is disabled
    await checkoutPage.selectInvoice();
    await expect(checkoutPage.payButton).toBeDisabled();

    // ACTION + CHECK: tick the checkboxes → Pay is enabled (not clicked)
    await checkoutPage.acceptAllCheckboxes();
    await expect(checkoutPage.payButton).toBeEnabled();

    // SETUP: the checkbox not required
    await switchFirstCheckboxRequired(db, request, cleanup, shop.apiKey, false);

    // ACTION + CHECK: choose invoice without ticking → Pay is enabled (not clicked)
    await checkoutPage.openWithEmptyForm(shop);
    await checkoutPage.fillBillingDetails(addresses.germany);
    await checkoutPage.continue();
    await checkoutPage.selectInvoice();
    await expect(checkoutPage.payButton).toBeEnabled();
  });
});
