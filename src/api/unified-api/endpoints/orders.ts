import type { UnifiedApiClient } from '../UnifiedApiClient';

// /orders endpoints. Each method is one API call; the test checks status and body.
export class OrdersEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET /orders */
  list() {
    return this.api.company('GET', '/orders');
  }

  /** GET /orders/{orderId} */
  get(orderId: string) {
    return this.api.company('GET', `/orders/${orderId}`);
  }

  /** POST /orders/full - creates an order with items. */
  createFull(body: unknown) {
    return this.api.company('POST', '/orders/full', { data: body });
  }

  /** PUT /orders/{orderId} */
  update(orderId: string, body: unknown) {
    return this.api.company('PUT', `/orders/${orderId}`, { data: body });
  }

  /** PUT /orders/{orderId}/address */
  updateAddress(orderId: string, body: unknown) {
    return this.api.company('PUT', `/orders/${orderId}/address`, { data: body });
  }

  /** GET /orders/{orderId}/payment-update-link */
  paymentUpdateLink(orderId: string) {
    return this.api.company('GET', `/orders/${orderId}/payment-update-link`);
  }

  /** GET /orders/{orderId}/payment-details */
  paymentDetails(orderId: string) {
    return this.api.company('GET', `/orders/${orderId}/payment-details`);
  }

  /** POST /orders/{orderId}/notes */
  addNote(orderId: string, note: { author: string; message: string; description: string; pinned: boolean }) {
    return this.api.company('POST', `/orders/${orderId}/notes`, { data: note });
  }

  /** POST /orders/fulfill */
  fulfill(orderIds: string[]) {
    return this.api.company('POST', '/orders/fulfill', { data: { order_ids: orderIds } });
  }

  /** POST /orders/{orderId}/cancel */
  cancel(orderId: string) {
    return this.api.company('POST', `/orders/${orderId}/cancel`, { data: {} });
  }

  /** POST /orders/{orderId}/charge */
  charge(orderId: string, message = 'Test Message') {
    return this.api.company('POST', `/orders/${orderId}/charge`, { data: { message } });
  }

  /** POST /orders/{orderId}/generate-invoice */
  generateInvoice(orderId: string, sendEmail = true) {
    return this.api.company('POST', `/orders/${orderId}/generate-invoice`, { data: { send_email: sendEmail } });
  }
}
