import type { CustomerApiClient } from '../CustomerApiClient';

/** Customer self-service endpoints: /css/... */
export class CssEndpoint {
  constructor(private readonly api: CustomerApiClient) {}

  /** GET /css/subscriptions/{subscriptionId}/deliveries */
  subscriptionDeliveries(subscriptionId: string) {
    return this.api.call('GET', `/css/subscriptions/${subscriptionId}/deliveries`);
  }

  /** POST /css/subscriptions/{subscriptionId}/report-issue */
  reportIssue(subscriptionId: string, body: unknown) {
    return this.api.call('POST', `/css/subscriptions/${subscriptionId}/report-issue`, { data: body });
  }

  /** PUT /css/deliveries/{deliveryId}/shipping-date */
  updateShippingDate(deliveryId: string | number, shippingDate: string) {
    return this.api.call('PUT', `/css/deliveries/${deliveryId}/shipping-date`, { data: { shipping_date: shippingDate } });
  }

  /** PUT /css/subscriptions/{subscriptionId}/change-quantity - consumable subscriptions only */
  changeQuantity(subscriptionId: string, quantity: number) {
    return this.api.call('PUT', `/css/subscriptions/${subscriptionId}/change-quantity`, { data: { quantity } });
  }

  /** PUT /css/subscriptions/{subscriptionId}/change-frequency */
  changeFrequency(subscriptionId: string, frequency: string, interval: number) {
    return this.api.call('PUT', `/css/subscriptions/${subscriptionId}/change-frequency`, {
      data: { subscription_frequency: frequency, subscription_frequency_interval: interval },
      timeout: 50_000,
    });
  }

  /** POST /css/subscriptions/{subscriptionId}/bundle-swap */
  bundleSwap(subscriptionId: string, productVariantId: string) {
    return this.api.call('POST', `/css/subscriptions/${subscriptionId}/bundle-swap`, { data: { product_variant_id: productVariantId } });
  }

  /** POST /css/subscriptions/{subscriptionId}/cancel */
  cancel(subscriptionId: string, body: unknown) {
    return this.api.call('POST', `/css/subscriptions/${subscriptionId}/cancel`, { data: body });
  }

  /** POST /css/subscriptions/{subscriptionId}/process-buyout */
  processBuyout(subscriptionId: string, body: unknown) {
    return this.api.call('POST', `/css/subscriptions/${subscriptionId}/process-buyout`, { data: body });
  }

  /** POST /css/orders/subscriptions */
  createOrder(body: unknown) {
    return this.api.call('POST', '/css/orders/subscriptions', { data: body });
  }
}
