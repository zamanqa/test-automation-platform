import type { CustomerApiClient } from '../CustomerApiClient';

/** /orders endpoints of the Customer API. */
export class OrdersEndpoint {
  constructor(private readonly api: CustomerApiClient) {}

  /** GET {base}/api/{version}/orders. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.call('GET', '/orders');
  }

  /** GET {base}/api/{version}/orders/{orderId} — params: orderId: string. Returns Playwright's APIResponse (test checks status/body). */
  get(orderId: string) {
    return this.api.call('GET', `/orders/${orderId}`);
  }

  /** POST {base}/api/{version}/orders — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  create(body: unknown) {
    return this.api.call('POST', '/orders', { data: body });
  }

  /** GET {base}/api/{version}/orders/{orderId}/payment-update-link — params: orderId: string. Returns Playwright's APIResponse (test checks status/body). */
  paymentUpdateLink(orderId: string) {
    return this.api.call('GET', `/orders/${orderId}/payment-update-link`);
  }

  /** GET {base}/api/{version}/orders/{orderId}/payment-details — params: orderId: string. Returns Playwright's APIResponse (test checks status/body). */
  paymentDetails(orderId: string) {
    return this.api.call('GET', `/orders/${orderId}/payment-details`);
  }

  /** POST {base}/api/{version}/orders/{orderId}/notes — params: orderId: string, note: unknown. Returns Playwright's APIResponse (test checks status/body). */
  addNote(orderId: string, note: unknown) {
    return this.api.call('POST', `/orders/${orderId}/notes`, { data: note });
  }

  /** POST {base}/api/{version}/orders/fulfill — params: orderIds: string[]. Returns Playwright's APIResponse (test checks status/body). */
  fulfill(orderIds: string[]) {
    return this.api.call('POST', '/orders/fulfill', { data: { order_ids: orderIds } });
  }

  /** POST {base}/api/{version}/orders/{orderId}/cancel — params: orderId: string. Returns Playwright's APIResponse (test checks status/body). */
  cancel(orderId: string) {
    return this.api.call('POST', `/orders/${orderId}/cancel`);
  }

  /** POST {base}/api/{version}/orders/{orderId}/charge — params: orderId: string. Returns Playwright's APIResponse (test checks status/body). */
  charge(orderId: string) {
    return this.api.call('POST', `/orders/${orderId}/charge`);
  }

  /** POST {base}/api/{version}/orders/{orderId}/generate-invoice — params: orderId: string, sendEmail = true. Returns Playwright's APIResponse (test checks status/body). */
  generateInvoice(orderId: string, sendEmail = true) {
    return this.api.call('POST', `/orders/${orderId}/generate-invoice`, { data: { send_email: sendEmail } });
  }

  /** PUT {base}/api/{version}/orders/{orderId}/address — params: orderId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  updateAddress(orderId: string, body: unknown) {
    return this.api.call('PUT', `/orders/${orderId}/address`, { data: body });
  }

  /** PUT {base}/api/{version}/orders/{orderId}/tag — params: orderId: string, tag: { tag: string; tag_date: string }. Returns Playwright's APIResponse (test checks status/body). */
  tag(orderId: string, tag: { tag: string; tag_date: string }) {
    return this.api.call('PUT', `/orders/${orderId}/tag`, { data: tag });
  }
}
