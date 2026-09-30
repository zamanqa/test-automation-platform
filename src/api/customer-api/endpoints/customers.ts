import type { CustomerApiClient } from '../CustomerApiClient';

/** /customers and /validate-address endpoints of the Customer API. */
export class CustomersEndpoint {
  constructor(private readonly api: CustomerApiClient) {}

  /** GET {base}/api/{version}/customers. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.call('GET', '/customers');
  }

  /** GET {base}/api/{version}/customers/{customerId} — params: customerId: string. Returns Playwright's APIResponse (test checks status/body). */
  get(customerId: string) {
    return this.api.call('GET', `/customers/${customerId}`);
  }

  /** POST {base}/api/{version}/customers — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  create(body: unknown) {
    return this.api.call('POST', '/customers', { data: body });
  }

  /** PUT {base}/api/{version}/customers/{customerId} — params: customerId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  update(customerId: string, body: unknown) {
    return this.api.call('PUT', `/customers/${customerId}`, { data: body });
  }

  /** GET {base}/api/{version}/customers/{customerId}/balance — params: customerId: string. Returns Playwright's APIResponse (test checks status/body). */
  balance(customerId: string) {
    return this.api.call('GET', `/customers/${customerId}/balance`);
  }

  /** PUT {base}/api/{version}/customers/{customerId}/balance — params: customerId: string, amount: number. Returns Playwright's APIResponse (test checks status/body). */
  addBalance(customerId: string, amount: number) {
    return this.api.call('PUT', `/customers/${customerId}/balance`, { data: { add: amount } });
  }

  /** POST {base}/api/{version}/customers/{customerId}/referral-code — params: customerId: string. Returns Playwright's APIResponse (test checks status/body). */
  createReferralCode(customerId: string) {
    return this.api.call('POST', `/customers/${customerId}/referral-code`);
  }

  /** GET {base}/api/{version}/customers/{customerId}/referral-code — params: customerId: string. Returns Playwright's APIResponse (test checks status/body). */
  referralCode(customerId: string) {
    return this.api.call('GET', `/customers/${customerId}/referral-code`);
  }

  /** POST {base}/api/{version}/customers/transfer — params: sourceCustomerId: string, targetCustomerId: string. Returns Playwright's APIResponse (test checks status/body). */
  transfer(sourceCustomerId: string, targetCustomerId: string) {
    return this.api.call('POST', '/customers/transfer', {
      data: { source_customer: sourceCustomerId, target_customer: targetCustomerId },
    });
  }

  /** POST {base}/api/{version}/validate-address — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  validateAddress(body: unknown) {
    return this.api.call('POST', '/validate-address', { data: body });
  }
}
