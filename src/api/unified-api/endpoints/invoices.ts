import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /invoices and /paginated-invoices endpoints. */
export class InvoicesEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET /paginated-invoices */
  list() {
    return this.api.company('GET', '/paginated-invoices');
  }

  /** e.g. invoice-_22360 */
  get(invoiceNumber: string) {
    return this.api.company('GET', `/invoices/${invoiceNumber}`);
  }

  /** POST /invoices/{invoiceNumber}/settle */
  settle(invoiceNumber: string) {
    return this.api.company('POST', `/invoices/${invoiceNumber}/settle`);
  }

  /** POST /invoices/{invoiceId}/refund */
  refund(invoiceId: string, body: unknown) {
    return this.api.company('POST', `/invoices/${invoiceId}/refund`, { data: body });
  }
}
