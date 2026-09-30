import { faker } from '@faker-js/faker';

// USED BY (files that import this one):
//   tests/customer-api/orders/orders.spec.ts

/**
 * Request body for POST /orders on the Customer API. Values from cus-api orderPayloads.js.
 *
 * WHERE THE VALUES COME FROM:
 *   order_id        ← faker: random 12-digit number (new every call)
 *   product_id, sku, stripe_customer_id, transaction_id
 *                   ← fixed dev values copied from Cypress (must exist on dev)
 *   everything else ← fixed test data copied from Cypress
 */

const address = {
  first_name: 'Shahiduz',
  last_name: 'Zaman',
  street: 'Hansaallee',
  postal_code: '00136',
  city: 'Frankfurt',
  country: 'Germany',
  company: 'test',
  note: '',
};

/** Open Stripe/visa order with one subscription item and a random 12-digit order_id. */
export function createOrderPayload() {
  return {
    order_id: faker.string.numeric({ length: 12, allowLeadingZeros: false }),
    discount: 0,
    shipping_amount: 5,
    tax_amount: 2.22,
    tax_percent: 19,
    amount: 13.91,
    total_item_count: 0,
    currency: 'EUR',
    payment_provider: 'stripe',
    payment_method_token: 'visa',
    payment_method: 'card',
    status: 'open',
    payment_status: 'payment_required',
    stripe_customer_id: 'cus_S834yW7AJkxpzJ',
    history: {},
    transaction_id: 'pi_3RDmxtK2HSLAqiWw1KPzpmzd',
    psp_object: {},
    tag: null,
    tag_date: null,
    replace_order_id: null,
    order_name: '2489',
    email: 'test@circuly.io',
    phone: '+49123456789',
    billing: { ...address },
    shipping: { ...address },
    items: [
      {
        product_id: '5371732131978',
        name: 'Simple product no variant',
        sku: '43014354567306',
        thumbnail: 'https://cdn.shopify.com/s/files/1/0371/7631/1946/products/783px-Test-Logo_svg.png?v=1695297223',
        voucher_code: null,
        quantity: 1,
        price: 8.91,
        discount_amount: 0,
        row_total_incl_tax: 8.91,
        row_total: 7.49,
        row_total_incl_discount: 80.0,
        tax_amount: 1.42,
        tax_percent: 19,
        base_price_incl_tax: '8.91',
        base_price: 7.49,
        delivery_date: null,
        subscription_duration: 5,
        expected_revenue: 44.55,
        subscription: true,
        subscription_id: 'sub_0000012345',
        subscription_start: '18-09-2024',
        subscription_end: '2025-04-26',
        subscription_frequency: 'monthly',
        original_price: 0,
        subscription_duration_prepaid: 1,
        subscription_type: 'normal',
        subscription_frequency_interval: 1,
      },
    ],
  };
}
