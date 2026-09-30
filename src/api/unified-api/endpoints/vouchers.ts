import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /vouchers endpoints. */
export class VouchersEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET {base}/{version}/{companyId}/vouchers. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.company('GET', '/vouchers');
  }

  /** GET {base}/{version}/{companyId}/vouchers/{code} — params: code: string. Returns Playwright's APIResponse (test checks status/body). */
  byCode(code: string) {
    return this.api.company('GET', `/vouchers/${code}`);
  }

  /** POST {base}/{version}/{companyId}/vouchers — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  create(body: unknown) {
    return this.api.company('POST', '/vouchers', { data: body });
  }

  /** PUT {base}/{version}/{companyId}/vouchers/{voucherId} — params: voucherId: string | number, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  update(voucherId: string | number, body: unknown) {
    return this.api.company('PUT', `/vouchers/${voucherId}`, { data: body });
  }
}
