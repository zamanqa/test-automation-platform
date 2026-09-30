import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /recurring-payments endpoints. */
export class RecurringPaymentsEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET {base}/{version}/{companyId}/recurring-payments. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.company('GET', '/recurring-payments');
  }

  /** GET {base}/{version}/{companyId}/recurring-payments/{id} — params: id: string | number. Returns Playwright's APIResponse (test checks status/body). */
  get(id: string | number) {
    return this.api.company('GET', `/recurring-payments/${id}`);
  }
}
