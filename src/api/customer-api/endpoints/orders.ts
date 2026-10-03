import type { CustomerApiClient } from '../CustomerApiClient';

/** /orders endpoints. */
export class OrdersEndpoint {
  constructor(private readonly api: CustomerApiClient) {}

  /** GET /orders */
  list() {
    return this.api.call('GET', '/orders');
  }

  /** GET /orders/{orderId} */
  get(orderId: string) {
    return this.api.call('GET', `/orders/${orderId}`);
  }

  /** POST /orders */
  create(body: unknown) {
    return this.api.call('POST', '/orders', { data: body });
  }

  /** GET /orders/{orderId}/payment-update-link */
  paymentUpdateLink(orderId: string) {
    return this.api.call('GET', `/orders/${orderId}/payment-update-link`);
  }

  /** GET /orders/{orderId}/payment-details */
  paymentDetails(orderId: string) {
    return this.api.call('GET', `/orders/${orderId}/payment-details`);
  }

  /** POST /orders/{orderId}/notes */
  addNote(orderId: string, note: unknown) {
    return this.api.call('POST', `/orders/${orderId}/notes`, { data: note });
  }

  /** POST /orders/fulfill */
  fulfill(orderIds: string[]) {
    return this.api.call('POST', '/orders/fulfill', { data: { order_ids: orderIds } });
  }

  /** POST /orders/{orderId}/cancel */
  cancel(orderId: string) {
    return this.api.call('POST', `/orders/${orderId}/cancel`);
  }

  /** POST /orders/{orderId}/charge */
  charge(orderId: string) {
    return this.api.call('POST', `/orders/${orderId}/charge`);
  }

  /** POST /orders/{orderId}/generate-invoice */
  generateInvoice(orderId: string, sendEmail = true) {
    return this.api.call('POST', `/orders/${orderId}/generate-invoice`, { data: { send_email: sendEmail } });
  }

  /** PUT /orders/{orderId}/address */
  updateAddress(orderId: string, body: unknown) {
    return this.api.call('PUT', `/orders/${orderId}/address`, { data: body });
  }

  /** PUT /orders/{orderId}/tag */
  tag(orderId: string, tag: { tag: string; tag_date: string }) {
    return this.api.call('PUT', `/orders/${orderId}/tag`, { data: tag });
  }
}
