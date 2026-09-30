import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /css/api/deliveries endpoints (CSS URL pattern: no company id in the path). */
export class DeliveriesEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET {base}/{version}/css/api/deliveries. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.cssRequest('GET', '/css/api/deliveries');
  }

  /** date: YYYY-MM-DD */
  onDate(shippingDate: string) {
    return this.api.cssRequest('GET', `/css/api/deliveries/${shippingDate}`);
  }
}
