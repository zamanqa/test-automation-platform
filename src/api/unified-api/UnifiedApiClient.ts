import type { APIRequestContext, APIResponse } from '@playwright/test';
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

/**
 * Unified Customer API (2026-04).
 *
 * Auth: POST /auth/login with consumer_key + consumer_secret returns a JWT and the
 * company_id. The token is cached per worker and renewed a minute before it expires.
 *
 * URL patterns:
 *   company endpoints → {base}/{version}/{companyId}{path}   (most endpoints, incl. /debtist/)
 *   css endpoints     → {base}/{version}{path}               (path starts with /css/)
 */
export class UnifiedApiClient extends BaseApiClient {
  // Login state, filled by ensureToken() on the first request and reused afterwards.
  private token?: string;
  private tokenExpiresAt = 0;
  private _companyId?: string;

  // Endpoint groups. Each gets `this` (the client) in its constructor so it can call
  // this.company(...) / this.cssRequest(...). Tests use them as unifiedApi.orders.list() etc.
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

  /** Created by the `unifiedApi` fixture; `super(request)` hands the HTTP client to BaseApiClient. */
  constructor(request: APIRequestContext) {
    super(request);
  }

  private get root(): string {
    const { UNIFIED_API_BASE_URL, UNIFIED_API_VERSION } = env.unifiedApi;
    return `${UNIFIED_API_BASE_URL.replace(/\/$/, '')}/${UNIFIED_API_VERSION}`;
  }

  /** The company the consumer key belongs to (known after login). */
  async companyId(): Promise<string> {
    await this.ensureToken();
    return this._companyId!;
  }

  /**
   * Logs in only when there is no token or it is about to expire.
   * Called by authHeaders() (i.e. before every request) and by companyId().
   */
  private async ensureToken(): Promise<string> {
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
    this._companyId = String(body.company_id);
    this.tokenExpiresAt = jwtExpiry(this.token);
    return this.token;
  }

  /** Required by BaseApiClient; BaseApiClient.send() calls this for every request. */
  protected async authHeaders() {
    return { Authorization: `Bearer ${await this.ensureToken()}` };
  }

  /** {base}/{version}/{companyId}{path} — used by every endpoint group except css/deliveries. */
  async company(method: HttpMethod, path: string, options?: RequestOptions): Promise<APIResponse> {
    return this.send(method, `${this.root}/${await this.companyId()}${path}`, options);
  }

  /** {base}/{version}{path} — for /css/ endpoints */
  async cssRequest(method: HttpMethod, path: string, options?: RequestOptions): Promise<APIResponse> {
    return this.send(method, `${this.root}${path}`, options);
  }
}

/** Expiry of a JWT in ms, from its `exp` claim; falls back to one hour. */
function jwtExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.exp * 1000;
  } catch {
    return Date.now() + 60 * 60 * 1000;
  }
}
