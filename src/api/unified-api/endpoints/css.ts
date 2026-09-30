import type { UnifiedApiClient } from '../UnifiedApiClient';

/** Customer Self Service endpoints: {base}/{version}/css/api/... (no company id in the path). */
export class CssEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET {base}/{version}/css/api/subscriptions/{subscriptionId}/deliveries — params: subscriptionId: string. Returns Playwright's APIResponse (test checks status/body). */
  subscriptionDeliveries(subscriptionId: string) {
    return this.api.cssRequest('GET', `/css/api/subscriptions/${subscriptionId}/deliveries`);
  }

  /** POST {base}/{version}/css/api/subscriptions/{subscriptionId}/report-issue — params: subscriptionId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  reportIssue(subscriptionId: string, body: unknown) {
    return this.api.cssRequest('POST', `/css/api/subscriptions/${subscriptionId}/report-issue`, { data: body });
  }

  /** PUT {base}/{version}/css/api/deliveries/{deliveryId}/shipping-date — params: deliveryId: string | number, shippingDate: string. Returns Playwright's APIResponse (test checks status/body). */
  updateShippingDate(deliveryId: string | number, shippingDate: string) {
    return this.api.cssRequest('PUT', `/css/api/deliveries/${deliveryId}/shipping-date`, { data: { shipping_date: shippingDate } });
  }

  /** PUT {base}/{version}/css/api/subscriptions/{subscriptionId}/change-frequency — params: subscriptionId: string, frequency: string, interval: number. Returns Playwright's APIResponse (test checks status/body). */
  changeFrequency(subscriptionId: string, frequency: string, interval: number) {
    return this.api.cssRequest('PUT', `/css/api/subscriptions/${subscriptionId}/change-frequency`, {
      data: { subscription_frequency: frequency, subscription_frequency_interval: interval },
      timeout: 50_000,
    });
  }

  /** POST {base}/{version}/css/api/subscriptions/{subscriptionId}/bundle-swap — params: subscriptionId: string, productVariantId: string. Returns Playwright's APIResponse (test checks status/body). */
  bundleSwap(subscriptionId: string, productVariantId: string) {
    return this.api.cssRequest('POST', `/css/api/subscriptions/${subscriptionId}/bundle-swap`, { data: { product_variant_id: productVariantId } });
  }

  /** POST {base}/{version}/css/api/subscriptions/{subscriptionId}/cancel — params: subscriptionId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  cancel(subscriptionId: string, body: unknown) {
    return this.api.cssRequest('POST', `/css/api/subscriptions/${subscriptionId}/cancel`, { data: body });
  }

  /** POST {base}/{version}/css/api/subscriptions/{subscriptionId}/process-buyout — params: subscriptionId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  processBuyout(subscriptionId: string, body: unknown) {
    return this.api.cssRequest('POST', `/css/api/subscriptions/${subscriptionId}/process-buyout`, { data: body });
  }

  /** POST {base}/{version}/css/api/orders/subscriptions — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  createOrder(body: unknown) {
    return this.api.cssRequest('POST', '/css/api/orders/subscriptions', { data: body });
  }
}
