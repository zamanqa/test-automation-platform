import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /debtist endpoints (debt collection): /debtist/... */
export class DebtistEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET /debtist/claims */
  claims() {
    return this.api.company('GET', '/debtist/claims');
  }

  /** GET /debtist/claims/{claimId} */
  claim(claimId: string) {
    return this.api.company('GET', `/debtist/claims/${claimId}`);
  }

  /** GET /debtist/invoice/{invoiceId}/claim */
  claimOfInvoice(invoiceId: string) {
    return this.api.company('GET', `/debtist/invoice/${invoiceId}/claim`);
  }

  /** POST /debtist/invoice/{invoiceId}/claim */
  fileClaim(invoiceId: string) {
    return this.api.company('POST', `/debtist/invoice/${invoiceId}/claim`);
  }

  /** GET /debtist/invoices */
  invoices() {
    return this.api.company('GET', '/debtist/invoices');
  }

  /** GET /debtist/customers */
  customers() {
    return this.api.company('GET', '/debtist/customers');
  }
}
