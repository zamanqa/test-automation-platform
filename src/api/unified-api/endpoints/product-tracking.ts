import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /product-tracking endpoints (assets by serial number). */
export class ProductTrackingEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET /product-tracking */
  list() {
    return this.api.company('GET', '/product-tracking');
  }

  /** GET /product-tracking/{serialNumber} */
  get(serialNumber: string) {
    return this.api.company('GET', `/product-tracking/${serialNumber}`);
  }

  /** Sends the asset to repair; delete_rps removes its open recurring payments. */
  repair(serialNumber: string, deleteRecurringPayments = true) {
    return this.api.company('POST', `/product-tracking/${serialNumber}/repair`, { data: { delete_rps: deleteRecurringPayments } });
  }

  /** POST /product-tracking/{serialNumber}/stock */
  stock(serialNumber: string, location = 'Berlin', doNotRestock = false) {
    return this.api.company('POST', `/product-tracking/${serialNumber}/stock`, {
      params: { do_not_restock: doNotRestock },
      data: { location },
    });
  }
}
