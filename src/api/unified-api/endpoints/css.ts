import type { UnifiedApiClient } from '../UnifiedApiClient';

/** Customer Self Service endpoints: /css/api/... (no company id in the path). */
export class CssEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET /css/api/subscriptions/{subscriptionId}/deliveries */
  subscriptionDeliveries(subscriptionId: string) {
    return this.api.cssRequest('GET', `/css/api/subscriptions/${subscriptionId}/deliveries`);
  }

  /** POST /css/api/subscriptions/{subscriptionId}/report-issue */
  reportIssue(subscriptionId: string, body: unknown) {
    return this.api.cssRequest('POST', `/css/api/subscriptions/${subscriptionId}/report-issue`, { data: body });
  }

  /** PUT /css/api/deliveries/{deliveryId}/shipping-date */
  updateShippingDate(deliveryId: string | number, shippingDate: string) {
    return this.api.cssRequest('PUT', `/css/api/deliveries/${deliveryId}/shipping-date`, { data: { shipping_date: shippingDate } });
  }

  /** PUT /css/api/subscriptions/{subscriptionId}/change-frequency */
  changeFrequency(subscriptionId: string, frequency: string, interval: number) {
    return this.api.cssRequest('PUT', `/css/api/subscriptions/${subscriptionId}/change-frequency`, {
      data: { subscription_frequency: frequency, subscription_frequency_interval: interval },
      timeout: 50_000,
    });
  }

  /** POST /css/api/subscriptions/{subscriptionId}/bundle-swap */
  bundleSwap(subscriptionId: string, productVariantId: string) {
    return this.api.cssRequest('POST', `/css/api/subscriptions/${subscriptionId}/bundle-swap`, { data: { product_variant_id: productVariantId } });
  }

  /** POST /css/api/subscriptions/{subscriptionId}/cancel */
  cancel(subscriptionId: string, body: unknown) {
    return this.api.cssRequest('POST', `/css/api/subscriptions/${subscriptionId}/cancel`, { data: body });
  }

  /** POST /css/api/subscriptions/{subscriptionId}/process-buyout */
  processBuyout(subscriptionId: string, body: unknown) {
    return this.api.cssRequest('POST', `/css/api/subscriptions/${subscriptionId}/process-buyout`, { data: body });
  }

  /** POST /css/api/orders/subscriptions */
  createOrder(body: unknown) {
    return this.api.cssRequest('POST', '/css/api/orders/subscriptions', { data: body });
  }
}
