import type { CustomerApiClient } from '../CustomerApiClient';

/** Customer Self Service endpoints of the Customer API: {base}/api/{version}/css/... */
export class CssEndpoint {
  constructor(private readonly api: CustomerApiClient) {}

  /** GET {base}/api/{version}/css/subscriptions/{subscriptionId}/deliveries — params: subscriptionId: string. Returns Playwright's APIResponse (test checks status/body). */
  subscriptionDeliveries(subscriptionId: string) {
    return this.api.call('GET', `/css/subscriptions/${subscriptionId}/deliveries`);
  }

  /** POST {base}/api/{version}/css/subscriptions/{subscriptionId}/report-issue — params: subscriptionId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  reportIssue(subscriptionId: string, body: unknown) {
    return this.api.call('POST', `/css/subscriptions/${subscriptionId}/report-issue`, { data: body });
  }

  /** PUT {base}/api/{version}/css/deliveries/{deliveryId}/shipping-date — params: deliveryId: string | number, shippingDate: string. Returns Playwright's APIResponse (test checks status/body). */
  updateShippingDate(deliveryId: string | number, shippingDate: string) {
    return this.api.call('PUT', `/css/deliveries/${deliveryId}/shipping-date`, { data: { shipping_date: shippingDate } });
  }

  /** PUT {base}/api/{version}/css/subscriptions/{subscriptionId}/change-quantity — params: subscriptionId: string, quantity: number. Consumable subscriptions only. */
  changeQuantity(subscriptionId: string, quantity: number) {
    return this.api.call('PUT', `/css/subscriptions/${subscriptionId}/change-quantity`, { data: { quantity } });
  }

  /** PUT {base}/api/{version}/css/subscriptions/{subscriptionId}/change-frequency — params: subscriptionId: string, frequency: string, interval: number. Returns Playwright's APIResponse (test checks status/body). */
  changeFrequency(subscriptionId: string, frequency: string, interval: number) {
    return this.api.call('PUT', `/css/subscriptions/${subscriptionId}/change-frequency`, {
      data: { subscription_frequency: frequency, subscription_frequency_interval: interval },
      timeout: 50_000,
    });
  }

  /** POST {base}/api/{version}/css/subscriptions/{subscriptionId}/bundle-swap — params: subscriptionId: string, productVariantId: string. Returns Playwright's APIResponse (test checks status/body). */
  bundleSwap(subscriptionId: string, productVariantId: string) {
    return this.api.call('POST', `/css/subscriptions/${subscriptionId}/bundle-swap`, { data: { product_variant_id: productVariantId } });
  }

  /** POST {base}/api/{version}/css/subscriptions/{subscriptionId}/cancel — params: subscriptionId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  cancel(subscriptionId: string, body: unknown) {
    return this.api.call('POST', `/css/subscriptions/${subscriptionId}/cancel`, { data: body });
  }

  /** POST {base}/api/{version}/css/subscriptions/{subscriptionId}/process-buyout — params: subscriptionId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  processBuyout(subscriptionId: string, body: unknown) {
    return this.api.call('POST', `/css/subscriptions/${subscriptionId}/process-buyout`, { data: body });
  }

  /** POST {base}/api/{version}/css/orders/subscriptions — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  createOrder(body: unknown) {
    return this.api.call('POST', '/css/orders/subscriptions', { data: body });
  }
}
