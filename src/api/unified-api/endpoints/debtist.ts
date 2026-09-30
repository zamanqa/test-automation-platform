import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /debtist endpoints (debt collection): {base}/{version}/{companyId}/debtist/... */
export class DebtistEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET {base}/{version}/{companyId}/debtist/claims. Returns Playwright's APIResponse (test checks status/body). */
  claims() {
    return this.api.company('GET', '/debtist/claims');
  }

  /** GET {base}/{version}/{companyId}/debtist/claims/{claimId} — params: claimId: string. Returns Playwright's APIResponse (test checks status/body). */
  claim(claimId: string) {
    return this.api.company('GET', `/debtist/claims/${claimId}`);
  }

  /** GET {base}/{version}/{companyId}/debtist/invoice/{invoiceId}/claim — params: invoiceId: string. Returns Playwright's APIResponse (test checks status/body). */
  claimOfInvoice(invoiceId: string) {
    return this.api.company('GET', `/debtist/invoice/${invoiceId}/claim`);
  }

  /** POST {base}/{version}/{companyId}/debtist/invoice/{invoiceId}/claim — params: invoiceId: string. Returns Playwright's APIResponse (test checks status/body). */
  fileClaim(invoiceId: string) {
    return this.api.company('POST', `/debtist/invoice/${invoiceId}/claim`);
  }

  /** GET {base}/{version}/{companyId}/debtist/invoices. Returns Playwright's APIResponse (test checks status/body). */
  invoices() {
    return this.api.company('GET', '/debtist/invoices');
  }

  /** GET {base}/{version}/{companyId}/debtist/customers. Returns Playwright's APIResponse (test checks status/body). */
  customers() {
    return this.api.company('GET', '/debtist/customers');
  }
}
