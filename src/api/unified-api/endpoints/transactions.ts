import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /transactions endpoints. */
export class TransactionsEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET /transactions */
  list() {
    return this.api.company('GET', '/transactions');
  }

  /** GET /transactions/{transactionId} */
  get(transactionId: string) {
    return this.api.company('GET', `/transactions/${transactionId}`);
  }
}
