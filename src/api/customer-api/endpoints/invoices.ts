import type { CustomerApiClient } from '../CustomerApiClient';

/** /invoices endpoints of the Customer API. */
export class InvoicesEndpoint {
  constructor(private readonly api: CustomerApiClient) {}

  /** GET {base}/api/{version}/invoices. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.call('GET', '/invoices');
  }

  /** By invoices.id (not the invoice number). */
  get(invoiceId: string | number) {
    return this.api.call('GET', `/invoices/${invoiceId}`);
  }

  /** GET {base}/api/{version}/invoices-with-items/{invoiceId} — params: invoiceId: string | number. Returns Playwright's APIResponse (test checks status/body). */
  withItems(invoiceId: string | number) {
    return this.api.call('GET', `/invoices-with-items/${invoiceId}`);
  }

  /** GET {base}/api/{version}/invoices/{invoiceId}/download — params: invoiceId: string | number. Returns Playwright's APIResponse (test checks status/body). */
  download(invoiceId: string | number) {
    return this.api.call('GET', `/invoices/${invoiceId}/download`);
  }

  /** POST {base}/api/{version}/invoices/{invoiceNumber}/settle — params: invoiceNumber: string. Returns Playwright's APIResponse (test checks status/body). */
  settle(invoiceNumber: string) {
    return this.api.call('POST', `/invoices/${invoiceNumber}/settle`);
  }

  /** POST {base}/api/{version}/invoices/{invoiceNumber}/refund — params: invoiceNumber: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  refund(invoiceNumber: string, body: unknown) {
    return this.api.call('POST', `/invoices/${invoiceNumber}/refund`, { data: body });
  }
}
