import type { APIResponse } from '@playwright/test';
import { env } from '@config/env';
import { BaseApiClient } from '../BaseApiClient';

/**
 * Hub (Lumen) internal API, used by the hub tests to trigger cron jobs directly.
 *
 * Auth: POST {base}/v1/auth/login with a hub user's email + password returns a JWT.
 * URL:  {base}/v1/{companyId}/circulydb/...
 */
export class HubApiClient extends BaseApiClient {
  // Created by the `hubApi` fixture (constructor inherited from BaseApiClient).
  // Used only by tests/hub-e2e/cron/cron.spec.ts. Token is fetched on the first call.
  private token?: string;

  private get root(): string {
    return `${env.hubApi.HUB_API_BASE_URL.replace(/\/$/, '')}/v1`;
  }

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;
    const response = await this.request.post(`${this.root}/auth/login`, {
      data: { email: env.hubApi.HUB_API_EMAIL, password: env.hubApi.HUB_API_PASSWORD },
    });
    if (!response.ok()) throw new Error(`Hub API login failed: ${response.status()} ${await response.text()}`);
    const body = await response.json();
    if (!body.success || !body.token) throw new Error(`Hub API login returned no token: ${JSON.stringify(body)}`);
    this.token = body.token as string;
    return this.token;
  }

  protected async authHeaders() {
    return { Authorization: `Bearer ${await this.ensureToken()}` };
  }

  /**
   * POST {root}/{companyId}/recurring-payments — queues the recurring-payment jobs of a company (what the rp cron does).
   * (The old ".../circulydb/recurring-payments" route was removed from the hub API; 404 since 2026-09.)
   */
  triggerRecurringPayments(companyId: string): Promise<APIResponse> {
    return this.send('POST', `${this.root}/${companyId}/recurring-payments`, { failOnStatusCode: true });
  }

  /** POST {root}/{companyId}/invoices/charge-queue — queues the invoice-charge jobs (what the invoiceCharge cron does). */
  triggerInvoiceCharge(companyId: string): Promise<APIResponse> {
    return this.send('POST', `${this.root}/${companyId}/invoices/charge-queue`, { failOnStatusCode: true });
  }
}

/** N from a trigger response message like "... num of required queues: 3". */
export function queuedJobCount(message: string): number | undefined {
  const match = message.match(/num of required queues[:\s]+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}
