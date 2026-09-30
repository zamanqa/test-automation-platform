import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /customers and /validate-address endpoints. */
export class CustomersEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET {base}/{version}/{companyId}/customers. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.company('GET', '/customers');
  }

  /** GET {base}/{version}/{companyId}/customers/{customerId} — params: customerId: string. Returns Playwright's APIResponse (test checks status/body). */
  get(customerId: string) {
    return this.api.company('GET', `/customers/${customerId}`);
  }

  /** POST {base}/{version}/{companyId}/customers — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  create(body: unknown) {
    return this.api.company('POST', '/customers', { data: body });
  }

  /** PUT {base}/{version}/{companyId}/customers/{customerId} — params: customerId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  update(customerId: string, body: unknown) {
    return this.api.company('PUT', `/customers/${customerId}`, { data: body });
  }

  /** GET {base}/{version}/{companyId}/customers/{customerId}/balance — params: customerId: string. Returns Playwright's APIResponse (test checks status/body). */
  balance(customerId: string) {
    return this.api.company('GET', `/customers/${customerId}/balance`);
  }

  /** PUT {base}/{version}/{companyId}/customers/{customerId}/balance — params: customerId: string, amount: number. Returns Playwright's APIResponse (test checks status/body). */
  addBalance(customerId: string, amount: number) {
    return this.api.company('PUT', `/customers/${customerId}/balance`, { data: { add: amount } });
  }

  /** POST {base}/{version}/{companyId}/customers/{customerId}/referral-code — params: customerId: string. Returns Playwright's APIResponse (test checks status/body). */
  createReferralCode(customerId: string) {
    return this.api.company('POST', `/customers/${customerId}/referral-code`);
  }

  /** GET {base}/{version}/{companyId}/customers/{customerId}/referral-code — params: customerId: string. Returns Playwright's APIResponse (test checks status/body). */
  referralCode(customerId: string) {
    return this.api.company('GET', `/customers/${customerId}/referral-code`);
  }

  /** Moves everything of `source` to `target`. */
  transfer(sourceCustomerId: string, targetCustomerId: string) {
    return this.api.company('POST', '/customers/transfer', {
      data: { source_customer: sourceCustomerId, target_customer: targetCustomerId },
    });
  }

  /** POST {base}/{version}/{companyId}/validate-address — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  validateAddress(body: unknown) {
    return this.api.company('POST', '/validate-address', { data: body });
  }
}
