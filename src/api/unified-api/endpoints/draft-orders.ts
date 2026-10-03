import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /draft-orders endpoints. */
export class DraftOrdersEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET /draft-orders */
  list() {
    return this.api.company('GET', '/draft-orders');
  }

  /** GET /draft-orders/{id} */
  get(id: string) {
    return this.api.company('GET', `/draft-orders/${id}`);
  }

  /** POST /draft-orders */
  create(body: unknown) {
    return this.api.company('POST', '/draft-orders', { data: body });
  }

  /** DELETE /draft-orders/{id} */
  delete(id: string) {
    return this.api.company('DELETE', `/draft-orders/${id}`);
  }
}
