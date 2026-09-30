import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /invoices and /paginated-invoices endpoints. */
export class InvoicesEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET {base}/{version}/{companyId}/paginated-invoices. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.company('GET', '/paginated-invoices');
  }

  /** e.g. invoice-_22360 */
  get(invoiceNumber: string) {
    return this.api.company('GET', `/invoices/${invoiceNumber}`);
  }

  /** POST {base}/{version}/{companyId}/invoices/{invoiceNumber}/settle — params: invoiceNumber: string. Returns Playwright's APIResponse (test checks status/body). */
  settle(invoiceNumber: string) {
    return this.api.company('POST', `/invoices/${invoiceNumber}/settle`);
  }

  /** POST {base}/{version}/{companyId}/invoices/{invoiceId}/refund — params: invoiceId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  refund(invoiceId: string, body: unknown) {
    return this.api.company('POST', `/invoices/${invoiceId}/refund`, { data: body });
  }
}
