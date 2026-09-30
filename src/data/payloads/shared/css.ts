import dayjs from 'dayjs';

// USED BY (files that import this one):
//   tests/customer-api/css/css.spec.ts
//   tests/unified-api/css/css.spec.ts

/** Request bodies for the Customer Self Service (/css/api) endpoints. Same for both APIs. Values from unified-customer-api css.cy.js. */

/** Customer the CSS actions are performed as (fixture testData.json → css.testEmail). */
export const CSS_CUSTOMER_EMAIL = 'c.test2489@gmail.com';

const inDays = (days: number) => dayjs().add(days, 'day').format('YYYY-MM-DD');

/** Report-issue body: customer CSS_CUSTOMER_EMAIL, appointment in 7 days, 10:00-11:00. */
export function reportIssuePayload() {
  return {
    customer_email: CSS_CUSTOMER_EMAIL,
    message: 'E2E test — reported an issue',
    appointment: { date: inDays(7), timeslot: { from: '10:00', to: '11:00' } },
  };
}

/** Cancel body: normal cancellation, pickup in 10 days, 08:00-12:00. */
export function cancelSubscriptionPayload() {
  return {
    customer_email: CSS_CUSTOMER_EMAIL,
    cancellation_reason: 'Normal Cancellations',
    cancellation_type: 'normal_cancellation',
    early_cancellation: false,
    message: 'E2E test — cancel subscription',
    pickup: { delivery_date: inDays(10), timeslot: { from: '08:00', to: '12:00' } },
  };
}

/** Buyout body: accepts terms and newsletter. */
export function buyoutPayload() {
  return {
    buyout_legal: [
      { tag: 'TermsAndConditions', value: true },
      { tag: 'newsletter', value: true },
    ],
  };
}

/** Customer re-orders 2 of a consumable, starting in 30 days. */
export function customerOrderPayload(item: { variant_id: string; parent_order_id: string }) {
  return {
    send_to_shop: true,
    variant_id: String(item.variant_id),
    parent_order_id: String(item.parent_order_id),
    quantity: 2,
    subscription_type: 'consumable',
    subscription_frequency: 'monthly',
    subscription_frequency_interval: 1,
    subscription_start: inDays(30),
  };
}

export { inDays };
