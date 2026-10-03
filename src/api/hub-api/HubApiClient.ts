import type { APIResponse } from '@playwright/test';
import { env } from '@config/env';
import { BaseApiClient } from '../BaseApiClient';

// Hub (Lumen) API. The cron tests use it to start the cron jobs directly.
// Login: POST {base}/v1/auth/login with email + password → token
export class HubApiClient extends BaseApiClient {
  private token?: string;

  private get root(): string {
    return `${env.hubApi.HUB_API_BASE_URL.replace(/\/$/, '')}/v1`;
  }

  private async getToken(): Promise<string> {
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
    return { Authorization: `Bearer ${await this.getToken()}` };
  }

  /** POST {root}/{companyId}/recurring-payments - queues the recurring payment jobs (same as the rp cron) */
  triggerRecurringPayments(companyId: string): Promise<APIResponse> {
    return this.send('POST', `${this.root}/${companyId}/recurring-payments`, { failOnStatusCode: true });
  }

  /** POST {root}/{companyId}/invoices/charge-queue - queues the invoice charge jobs (same as the invoiceCharge cron) */
  triggerInvoiceCharge(companyId: string): Promise<APIResponse> {
    return this.send('POST', `${this.root}/${companyId}/invoices/charge-queue`, { failOnStatusCode: true });
  }
}

/** The number from a message like "... num of required queues: 3" */
export function queuedJobCount(message: string): number | undefined {
  const match = message.match(/num of required queues[:\s]+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}
