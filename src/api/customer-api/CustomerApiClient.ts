import type { APIResponse } from '@playwright/test';
import { env } from '@config/env';
import { BaseApiClient, type HttpMethod, type RequestOptions } from '../BaseApiClient';
import { OrdersEndpoint } from './endpoints/orders';
import { CustomersEndpoint } from './endpoints/customers';
import { InvoicesEndpoint } from './endpoints/invoices';
import { PaymentsEndpoint } from './endpoints/payments';
import { SubscriptionsEndpoint } from './endpoints/subscriptions';
import { CssEndpoint } from './endpoints/css';
import { ExportsEndpoint } from './endpoints/exports';
import {
  DebtistEndpoint,
  DeliveriesEndpoint,
  DraftOrdersEndpoint,
  NotesEndpoint,
  ProductTrackingEndpoint,
  ProductsEndpoint,
  RecurringPaymentsEndpoint,
  RetailersEndpoint,
  TransactionsEndpoint,
  VouchersEndpoint,
} from './endpoints/resources';

/**
 * Customer API (old, still used by customers).
 *
 * Auth: HTTP basic auth on every request.
 * URL:  {base}/api/{version}{path} — the company comes from the credentials, not the path.
 */
export class CustomerApiClient extends BaseApiClient {
  // No constructor here: the one from BaseApiClient is inherited (it stores `request`).
  // Endpoint groups get `this` and call this.call(...); small ones live in endpoints/resources.ts.
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
  readonly exports = new ExportsEndpoint(this);

  /** Company the tests query in the database (CUSTOMER_API_COMPANY_ID). */
  get companyId(): string {
    return env.customerApi.CUSTOMER_API_COMPANY_ID;
  }

  /** GET {base}/ping — answers "pong" when the API is up (no /api/{version} in this URL). */
  ping() {
    return this.send('GET', `${this.baseUrl()}/ping`);
  }

  /** GET {base}/version — app name, API version, PHP / Laravel version (no /api/{version} in this URL). */
  version() {
    return this.send('GET', `${this.baseUrl()}/version`);
  }

  /** CUSTOMER_API_BASE_URL without a trailing slash. */
  private baseUrl() {
    return env.customerApi.CUSTOMER_API_BASE_URL.replace(/\/$/, '');
  }

  protected async authHeaders() {
    const { CUSTOMER_API_USERNAME, CUSTOMER_API_PASSWORD } = env.customerApi;
    const encoded = Buffer.from(`${CUSTOMER_API_USERNAME}:${CUSTOMER_API_PASSWORD}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }

  /** Builds {base}/api/{version}{path} and hands it to BaseApiClient.send(). Called by every endpoint group. */
  call(method: HttpMethod, path: string, options?: RequestOptions): Promise<APIResponse> {
    return this.send(method, `${this.baseUrl()}/api/${env.customerApi.CUSTOMER_API_VERSION}${path}`, options);
  }
}
