import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /retailers endpoints. */
export class RetailersEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET {base}/{version}/{companyId}/retailers. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.company('GET', '/retailers');
  }

  /** GET {base}/{version}/{companyId}/retailers/{locationId} — params: locationId: string. Returns Playwright's APIResponse (test checks status/body). */
  byLocation(locationId: string) {
    return this.api.company('GET', `/retailers/${locationId}`);
  }

  /** POST {base}/{version}/{companyId}/retailers — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  create(body: unknown) {
    return this.api.company('POST', '/retailers', { data: body });
  }

  /** PUT {base}/{version}/{companyId}/retailers/{retailerId} — params: retailerId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  update(retailerId: string, body: unknown) {
    return this.api.company('PUT', `/retailers/${retailerId}`, { data: body });
  }
}
