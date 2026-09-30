import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /transactions endpoints. */
export class TransactionsEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET {base}/{version}/{companyId}/transactions. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.company('GET', '/transactions');
  }

  /** GET {base}/{version}/{companyId}/transactions/{transactionId} — params: transactionId: string. Returns Playwright's APIResponse (test checks status/body). */
  get(transactionId: string) {
    return this.api.company('GET', `/transactions/${transactionId}`);
  }
}
