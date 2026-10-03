import type { APIResponse } from '@playwright/test';
import { env } from '@config/env';
import { BaseApiClient, type HttpMethod, type RequestOptions } from '../BaseApiClient';
import { OrdersEndpoint } from './endpoints/orders';
import { CustomersEndpoint } from './endpoints/customers';
import { InvoicesEndpoint } from './endpoints/invoices';
import { PaymentsEndpoint } from './endpoints/payments';
import { SubscriptionsEndpoint } from './endpoints/subscriptions';
import { DeliveriesEndpoint } from './endpoints/deliveries';
import { DraftOrdersEndpoint } from './endpoints/draft-orders';
import { TransactionsEndpoint } from './endpoints/transactions';
import { RecurringPaymentsEndpoint } from './endpoints/recurring-payments';
import { ProductTrackingEndpoint } from './endpoints/product-tracking';
import { ProductsEndpoint } from './endpoints/products';
import { RetailersEndpoint } from './endpoints/retailers';
import { VouchersEndpoint } from './endpoints/vouchers';
import { CssEndpoint } from './endpoints/css';
import { NotesEndpoint } from './endpoints/notes';
import { DebtistEndpoint } from './endpoints/debtist';

// Unified Customer API (version 2026-04).
// Login: POST /auth/login with consumer key + secret → token and company_id.
// The token is kept and renewed one minute before it expires.
// URLs: most endpoints {base}/{version}/{companyId}{path}, css endpoints {base}/{version}{path}
export class UnifiedApiClient extends BaseApiClient {
  private token?: string;
  private tokenExpiresAt = 0;
  private loggedInCompanyId?: string;

  // used in tests as unifiedApi.orders.list() etc.
  readonly orders = new OrdersEndpoint(this);
  readonly customers = new CustomersEndpoint(this);
  readonly invoices = new InvoicesEndpoint(this);
  readonly payments = new PaymentsEndpoint(this);
  readonly subscriptions = new SubscriptionsEndpoint(this);
  readonly deliveries = new DeliveriesEndpoint(this);
  readonly draftOrders = new DraftOrdersEndpoint(this);
  readonly transactions = new TransactionsEndpoint(this);
  readonly recurringPayments = new RecurringPaymentsEndpoint(this);
  readonly productTracking = new ProductTrackingEndpoint(this);
  readonly products = new ProductsEndpoint(this);
  readonly retailers = new RetailersEndpoint(this);
  readonly vouchers = new VouchersEndpoint(this);
  readonly css = new CssEndpoint(this);
  readonly notes = new NotesEndpoint(this);
  readonly debtist = new DebtistEndpoint(this);

  private get root(): string {
    return `${env.unifiedApi.UNIFIED_API_BASE_URL.replace(/\/$/, '')}/${env.unifiedApi.UNIFIED_API_VERSION}`;
  }

  /** The company of the consumer key (known after login) */
  async companyId(): Promise<string> {
    await this.getToken();
    return this.loggedInCompanyId as string;
  }

  // Logs in only when there is no token yet or it expires within a minute
  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;

    const response = await this.request.post(`${this.root}/auth/login`, {
      data: {
        consumer_key: env.unifiedApi.UNIFIED_API_CONSUMER_KEY,
        consumer_secret: env.unifiedApi.UNIFIED_API_CONSUMER_SECRET,
      },
      headers: { Accept: 'application/json' },
    });
    if (!response.ok()) {
      throw new Error(`Unified API login failed: ${response.status()} ${await response.text()}`);
    }

    const body = await response.json();
    this.token = body.token as string;
    this.loggedInCompanyId = String(body.company_id);
    this.tokenExpiresAt = tokenExpiry(this.token);
    return this.token;
  }

  protected async authHeaders() {
    return { Authorization: `Bearer ${await this.getToken()}` };
  }

  /** {base}/{version}/{companyId}{path} */
  async company(method: HttpMethod, path: string, options?: RequestOptions): Promise<APIResponse> {
    const companyId = await this.companyId();
    return this.send(method, `${this.root}/${companyId}${path}`, options);
  }

  /** {base}/{version}{path} - for the /css/ endpoints */
  async cssRequest(method: HttpMethod, path: string, options?: RequestOptions): Promise<APIResponse> {
    return this.send(method, `${this.root}${path}`, options);
  }
}

// Expiry time (ms) from the token's "exp" value. If it cannot be read: one hour from now.
function tokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.exp * 1000;
  } catch {
    return Date.now() + 60 * 60 * 1000;
  }
}
