import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /customers and /validate-address endpoints. */
export class CustomersEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET /customers */
  list() {
    return this.api.company('GET', '/customers');
  }

  /** GET /customers/{customerId} */
  get(customerId: string) {
    return this.api.company('GET', `/customers/${customerId}`);
  }

  /** POST /customers */
  create(body: unknown) {
    return this.api.company('POST', '/customers', { data: body });
  }

  /** PUT /customers/{customerId} */
  update(customerId: string, body: unknown) {
    return this.api.company('PUT', `/customers/${customerId}`, { data: body });
  }

  /** GET /customers/{customerId}/balance */
  balance(customerId: string) {
    return this.api.company('GET', `/customers/${customerId}/balance`);
  }

  /** PUT /customers/{customerId}/balance */
  addBalance(customerId: string, amount: number) {
    return this.api.company('PUT', `/customers/${customerId}/balance`, { data: { add: amount } });
  }

  /** POST /customers/{customerId}/referral-code */
  createReferralCode(customerId: string) {
    return this.api.company('POST', `/customers/${customerId}/referral-code`);
  }

  /** GET /customers/{customerId}/referral-code */
  referralCode(customerId: string) {
    return this.api.company('GET', `/customers/${customerId}/referral-code`);
  }

  /** Moves everything of `source` to `target`. */
  transfer(sourceCustomerId: string, targetCustomerId: string) {
    return this.api.company('POST', '/customers/transfer', {
      data: { source_customer: sourceCustomerId, target_customer: targetCustomerId },
    });
  }

  /** POST /validate-address */
  validateAddress(body: unknown) {
    return this.api.company('POST', '/validate-address', { data: body });
  }
}
