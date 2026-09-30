// USED BY (files that import this one):
//   tests/customer-api/orders/orders.spec.ts
//   tests/unified-api/orders/orders.spec.ts

/** Order request bodies that are the same for both APIs. Values from orderPayloads.js (both repos). */

/** PUT /orders/{id}/address: new date of birth plus billing and shipping address. */
export function updateAddressPayload() {
  const address = {
    alpha2: 'de',
    alpha3: 'deu',
    last_name: 'Nordmann',
    street: 'Nordsjøen 1',
    postal_code: '60123',
    city: 'Troll',
    country: 'Germany',
    note: '',
    region: '',
  };
  return {
    date_of_birth: '2000-05-01',
    address: {
      billing: { ...address, first_name: 'Olagfhfhfghfg', company: 'New company name', address_addition: 'hgfhgfh' },
      shipping: { ...address, first_name: 'Olaghfghfghgfh', company: '', address_addition: 'gfh' },
    },
  };
}
