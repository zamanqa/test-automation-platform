import type { CustomerApiClient } from '../CustomerApiClient';

/** /payments endpoints. */
export class PaymentsEndpoint {
  constructor(private readonly api: CustomerApiClient) {}

  /** POST /payments/one-time-payments */
  createOneTimePayment(body: unknown) {
    return this.api.call('POST', '/payments/one-time-payments', { data: body });
  }

  /** GET /payments/refund-payments */
  refundPayments() {
    return this.api.call('GET', '/payments/refund-payments');
  }
}
