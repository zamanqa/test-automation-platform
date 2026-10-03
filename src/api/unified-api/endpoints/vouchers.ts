import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /vouchers endpoints. */
export class VouchersEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET /vouchers */
  list() {
    return this.api.company('GET', '/vouchers');
  }

  /** GET /vouchers/{code} */
  byCode(code: string) {
    return this.api.company('GET', `/vouchers/${code}`);
  }

  /** POST /vouchers */
  create(body: unknown) {
    return this.api.company('POST', '/vouchers', { data: body });
  }

  /** PUT /vouchers/{voucherId} */
  update(voucherId: string | number, body: unknown) {
    return this.api.company('PUT', `/vouchers/${voucherId}`, { data: body });
  }
}
