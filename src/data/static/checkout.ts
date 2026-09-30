// Test data for the checkout tests (tests/checkout-e2e/*.spec.ts).
// Copied from the Cypress project: cypress/fixtures/api-keys-cartid.json and checkout-data.json.

/** A test cart. The checkout URL is {CHECKOUT_URL}{apiKey}/{cartId}. */
export type Cart = { apiKey: string; cartId: string };

/** One test cart per shop + payment provider. */
export const carts = {
  shopifyStripe: { apiKey: 'dev_shopify_stripe', cartId: 'dev_shopify_stripe_do_not_use_e2e' },
  shopifyAdyen: { apiKey: 'dev_shopify_adyen', cartId: 'dev_shopify_adyen_do_not_use_e2e' },
  saleorMollie: { apiKey: 'dev_saleor_mollie', cartId: 'dev_sailor_mollie_e2e' },
  woocommerceMollie: { apiKey: 'dev_woocommerce_stripe', cartId: 'dev_woocommarce_stripe' }, // pays with Mollie
  shopware6Braintree: { apiKey: 'dev_shopware6_braintree', cartId: 'dev_shopware6_braintree_e2e' },
};

/** What we type into the contact form. */
export type CheckoutAddress = {
  firstName: string;
  lastName: string;
  phone: string;
  company: string;
  vatNumber: string;
  street: string;
  streetNumber: string;
  addressRemark: string;
  postalCode: string;
  city: string;
  country: string;
  notes: string;
};

/** Test addresses. (Other countries are in the Cypress file checkout-data.json if needed later.) */
export const addresses = {
  germany: {
    firstName: 'Shahiduz',
    lastName: 'Zaman',
    phone: '4917656824720',
    company: 'Circuly',
    vatNumber: '12345',
    street: 'Hansaallee',
    streetNumber: '139',
    addressRemark: 'QA test address remark',
    postalCode: '60320',
    city: 'Frankfurt am Main',
    country: 'Germany',
    notes: 'This is a Test Note',
  },
};

/** Voucher code that exists in the Stripe shop: code 12 takes 5 € off (40,00 € → 35,00 €). */
export const vouchers = {
  stripe: { code: '12', discount: 5 },
};

/** A voucher code that does not exist (for the "invalid voucher" test). */
export const invalidVoucher = 'QA_INVALID_999';

/** Test card data. */
export type Card = { cardNumber: string; cardName: string; expiry: string; cvc: string };

/** Test cards and bank accounts of the payment providers (test values, not real). */
export const payments = {
  stripeCard: { cardNumber: '4242424242424242', cardName: 'Zaman', expiry: '0330', cvc: '737' },
  sepaIban: 'DE89370400440532013000',
  adyenCard: { cardNumber: '4917 6100 0000 0000', cardName: 'Zaman', expiry: '0330', cvc: '737' },
  adyenSepa: { holderName: 'A. Schneider', iban: 'DE87 1234 5678 1234 5678 90' },
  braintreeCard: { cardNumber: '4111111111111111', cardName: 'Zaman', expiry: '0330', cvc: '737' },
  mollieCard: { cardNumber: '4543474002249996', cardName: 'Zaman', expiry: '0330', cvc: '737' },
};
