import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /one-time-payments and /refund-payments endpoints. */
export class PaymentsEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** POST {base}/{version}/{companyId}/one-time-payments — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  createOneTimePayment(body: unknown) {
    return this.api.company('POST', '/one-time-payments', { data: body });
  }

  /** GET {base}/{version}/{companyId}/refund-payments. Returns Playwright's APIResponse (test checks status/body). */
  refundPayments() {
    return this.api.company('GET', '/refund-payments');
  }
}
