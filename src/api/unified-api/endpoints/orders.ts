import type { UnifiedApiClient } from '../UnifiedApiClient';

/**
 * /orders endpoints of the Unified Customer API.
 *
 * Pattern shared by every file in endpoints/ (both APIs):
 *   - created once inside the client:  readonly orders = new OrdersEndpoint(this)
 *   - the constructor keeps that client as `this.api`
 *   - each method = one API call: it only supplies method + path (+ body) and delegates
 *     to this.api.company(...), which adds URL, company id and auth.
 *   - methods return Playwright's APIResponse; the TEST checks status and body.
 */
export class OrdersEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET {base}/{version}/{companyId}/orders. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.company('GET', '/orders');
  }

  /** GET {base}/{version}/{companyId}/orders/{orderId} — params: orderId: string. Returns Playwright's APIResponse (test checks status/body). */
  get(orderId: string) {
    return this.api.company('GET', `/orders/${orderId}`);
  }

  /** POST /orders/full — creates an order with items. */
  createFull(body: unknown) {
    return this.api.company('POST', '/orders/full', { data: body });
  }

  /** PUT {base}/{version}/{companyId}/orders/{orderId} — params: orderId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  update(orderId: string, body: unknown) {
    return this.api.company('PUT', `/orders/${orderId}`, { data: body });
  }

  /** PUT {base}/{version}/{companyId}/orders/{orderId}/address — params: orderId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  updateAddress(orderId: string, body: unknown) {
    return this.api.company('PUT', `/orders/${orderId}/address`, { data: body });
  }

  /** GET {base}/{version}/{companyId}/orders/{orderId}/payment-update-link — params: orderId: string. Returns Playwright's APIResponse (test checks status/body). */
  paymentUpdateLink(orderId: string) {
    return this.api.company('GET', `/orders/${orderId}/payment-update-link`);
  }

  /** GET {base}/{version}/{companyId}/orders/{orderId}/payment-details — params: orderId: string. Returns Playwright's APIResponse (test checks status/body). */
  paymentDetails(orderId: string) {
    return this.api.company('GET', `/orders/${orderId}/payment-details`);
  }

  /** POST {base}/{version}/{companyId}/orders/{orderId}/notes — params: orderId: string, note: { author: string; message: string; description: string; pinned: boolean }. Returns Playwright's APIResponse (test checks status/body). */
  addNote(orderId: string, note: { author: string; message: string; description: string; pinned: boolean }) {
    return this.api.company('POST', `/orders/${orderId}/notes`, { data: note });
  }

  /** POST {base}/{version}/{companyId}/orders/fulfill — params: orderIds: string[]. Returns Playwright's APIResponse (test checks status/body). */
  fulfill(orderIds: string[]) {
    return this.api.company('POST', '/orders/fulfill', { data: { order_ids: orderIds } });
  }

  /** POST {base}/{version}/{companyId}/orders/{orderId}/cancel — params: orderId: string. Returns Playwright's APIResponse (test checks status/body). */
  cancel(orderId: string) {
    return this.api.company('POST', `/orders/${orderId}/cancel`, { data: {} });
  }

  /** POST {base}/{version}/{companyId}/orders/{orderId}/charge — params: orderId: string, message = 'Test Message'. Returns Playwright's APIResponse (test checks status/body). */
  charge(orderId: string, message = 'Test Message') {
    return this.api.company('POST', `/orders/${orderId}/charge`, { data: { message } });
  }

  /** POST {base}/{version}/{companyId}/orders/{orderId}/generate-invoice — params: orderId: string, sendEmail = true. Returns Playwright's APIResponse (test checks status/body). */
  generateInvoice(orderId: string, sendEmail = true) {
    return this.api.company('POST', `/orders/${orderId}/generate-invoice`, { data: { send_email: sendEmail } });
  }
}
