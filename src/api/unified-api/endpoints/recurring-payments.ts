import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /recurring-payments endpoints. */
export class RecurringPaymentsEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET /recurring-payments */
  list() {
    return this.api.company('GET', '/recurring-payments');
  }

  /** GET /recurring-payments/{id} */
  get(id: string | number) {
    return this.api.company('GET', `/recurring-payments/${id}`);
  }
}
