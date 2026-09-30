import type { CustomerApiClient } from '../CustomerApiClient';

/** /payments endpoints of the Customer API. */
export class PaymentsEndpoint {
  constructor(private readonly api: CustomerApiClient) {}

  /** POST {base}/api/{version}/payments/one-time-payments — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  createOneTimePayment(body: unknown) {
    return this.api.call('POST', '/payments/one-time-payments', { data: body });
  }

  /** GET {base}/api/{version}/payments/refund-payments. Returns Playwright's APIResponse (test checks status/body). */
  refundPayments() {
    return this.api.call('GET', '/payments/refund-payments');
  }
}
