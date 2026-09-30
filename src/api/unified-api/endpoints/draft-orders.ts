import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /draft-orders endpoints. */
export class DraftOrdersEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET {base}/{version}/{companyId}/draft-orders. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.company('GET', '/draft-orders');
  }

  /** GET {base}/{version}/{companyId}/draft-orders/{id} — params: id: string. Returns Playwright's APIResponse (test checks status/body). */
  get(id: string) {
    return this.api.company('GET', `/draft-orders/${id}`);
  }

  /** POST {base}/{version}/{companyId}/draft-orders — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  create(body: unknown) {
    return this.api.company('POST', '/draft-orders', { data: body });
  }

  /** DELETE {base}/{version}/{companyId}/draft-orders/{id} — params: id: string. Returns Playwright's APIResponse (test checks status/body). */
  delete(id: string) {
    return this.api.company('DELETE', `/draft-orders/${id}`);
  }
}
