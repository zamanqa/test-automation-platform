import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /retailers endpoints. */
export class RetailersEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET /retailers */
  list() {
    return this.api.company('GET', '/retailers');
  }

  /** GET /retailers/{locationId} */
  byLocation(locationId: string) {
    return this.api.company('GET', `/retailers/${locationId}`);
  }

  /** POST /retailers */
  create(body: unknown) {
    return this.api.company('POST', '/retailers', { data: body });
  }

  /** PUT /retailers/{retailerId} */
  update(retailerId: string, body: unknown) {
    return this.api.company('PUT', `/retailers/${retailerId}`, { data: body });
  }
}
