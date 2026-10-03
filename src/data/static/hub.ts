import type { BillingAddress } from '@pages/hub/OrderCreationPage';

/** Static hub test data. From hub-e2e-automation cypress/fixtures/testData.json. */

export const billingAddress: BillingAddress = {
  givenName: 'Shahiduz',
  surname: 'Zaman',
  email: 'test.user.{{timestamp}}@circuly.io',
  phone: '+4917656824720',
  vatNumber: '159753',
  company: 'Test Company',
  street: 'WeberStr.',
  streetNumber: '25',
  addressAddition: '',
  postalCode: '60318',
  city: 'Frankfurt am Main',
  country: 'Germany',
};
