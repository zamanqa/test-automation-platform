import { faker } from '@faker-js/faker';
import { testEmail } from '@data/random';

// USED BY (files that import this one):
//   tests/customer-api/customers/customers.spec.ts
//   tests/unified-api/customers/customers.spec.ts

/** Request bodies for /customers. Same for both APIs. Values from unified-customer-api customerPayloads.js. */

export function createCustomerPayload() {
  return {
    email: testEmail(),
    phone: '+4917656824720',
    default_locale: 'en',
    marketing_consent: true,
    date_of_birth: null,
    first_name: 'Shahiduz',
    last_name: 'Zaman',
    company: 'Circuly',
    street: 'Fritz Tarnow Str 21',
    address_addition: 'test',
    postal_code: '60320',
    city: 'Frankfurt',
    region: '',
    country: 'Germany',
    external_customer_id: randomExternalId(),
  };
}

/** 4-digit external customer id, as a string. */
export function randomExternalId(): string {
  return String(faker.number.int({ min: 1000, max: 9999 }));
}

/** POST /validate-address body: a real address in Rome (expected valid). */
export function validateAddressPayload() {
  return { street: 'Via Raffaele Conforti 124', postal_code: '00136', city: 'Roma', region: 'Roma', country: 'IT' };
}
