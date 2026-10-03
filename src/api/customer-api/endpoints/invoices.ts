import type { CustomerApiClient } from '../CustomerApiClient';

/** /invoices endpoints. */
export class InvoicesEndpoint {
  constructor(private readonly api: CustomerApiClient) {}

  /** GET /invoices */
  list() {
    return this.api.call('GET', '/invoices');
  }

  /** By invoices.id (not the invoice number). */
  get(invoiceId: string | number) {
    return this.api.call('GET', `/invoices/${invoiceId}`);
  }

  /** GET /invoices-with-items/{invoiceId} */
  withItems(invoiceId: string | number) {
    return this.api.call('GET', `/invoices-with-items/${invoiceId}`);
  }

  /** GET /invoices/{invoiceId}/download */
  download(invoiceId: string | number) {
    return this.api.call('GET', `/invoices/${invoiceId}/download`);
  }

  /** POST /invoices/{invoiceNumber}/settle */
  settle(invoiceNumber: string) {
    return this.api.call('POST', `/invoices/${invoiceNumber}/settle`);
  }

  /** POST /invoices/{invoiceNumber}/refund */
  refund(invoiceNumber: string, body: unknown) {
    return this.api.call('POST', `/invoices/${invoiceNumber}/refund`, { data: body });
  }
}
