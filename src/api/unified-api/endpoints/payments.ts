import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /one-time-payments and /refund-payments endpoints. */
export class PaymentsEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** POST /one-time-payments */
  createOneTimePayment(body: unknown) {
    return this.api.company('POST', '/one-time-payments', { data: body });
  }

  /** GET /refund-payments */
  refundPayments() {
    return this.api.company('GET', '/refund-payments');
  }
}
