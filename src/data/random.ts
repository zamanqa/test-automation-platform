import { faker } from '@faker-js/faker';
import { env } from '@config/env';

// USED BY (files that import this one):
//   src/data/payloads/customer-api/products.ts
//   src/data/payloads/shared/customers.ts
//   src/data/payloads/shared/retailers.ts
//   src/data/payloads/shared/vouchers.ts
//   src/data/payloads/unified-api/draft-orders.ts
//   src/data/payloads/unified-api/orders.ts
//   src/pages/checkout/CheckoutPage.ts

/**
 * Random test values. Everything identifying carries TEST_DATA_PREFIX so rows a
 * run created can be found (and removed) in the database afterwards.
 */
export function testEmail(domain = 'gmail.com'): string {
  return `${env.testData.TEST_DATA_PREFIX}${faker.string.alphanumeric(10).toLowerCase()}@${domain}`;
}

/** Prefixed name, e.g. testName('retailer') → "qa_auto_retailer_ab12cd". */
export function testName(label: string): string {
  return `${env.testData.TEST_DATA_PREFIX}${label}_${faker.string.alphanumeric(6).toLowerCase()}`;
}
