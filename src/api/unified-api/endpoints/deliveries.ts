import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /css/api/deliveries endpoints (CSS URL pattern: no company id in the path). */
export class DeliveriesEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET /css/api/deliveries */
  list() {
    return this.api.cssRequest('GET', '/css/api/deliveries');
  }

  /** date: YYYY-MM-DD */
  onDate(shippingDate: string) {
    return this.api.cssRequest('GET', `/css/api/deliveries/${shippingDate}`);
  }
}
