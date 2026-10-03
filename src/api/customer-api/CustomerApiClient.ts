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

// Customer API (the old API, still used by customers).
// Basic auth on every request. URL: {base}/api/{version}{path}
// The company comes from the login, not from the URL.
export class CustomerApiClient extends BaseApiClient {
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

  /** The company the tests look up in the database (CUSTOMER_API_COMPANY_ID) */
  get companyId(): string {
    return env.customerApi.CUSTOMER_API_COMPANY_ID;
  }

  /** GET {base}/ping - answers "pong" when the API is up */
  ping() {
    return this.send('GET', `${this.baseUrl()}/ping`);
  }

  /** GET {base}/version - app name, API version, PHP and Laravel version */
  version() {
    return this.send('GET', `${this.baseUrl()}/version`);
  }

  private baseUrl() {
    return env.customerApi.CUSTOMER_API_BASE_URL.replace(/\/$/, '');
  }

  protected async authHeaders() {
    const { CUSTOMER_API_USERNAME, CUSTOMER_API_PASSWORD } = env.customerApi;
    const encoded = Buffer.from(`${CUSTOMER_API_USERNAME}:${CUSTOMER_API_PASSWORD}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }

  /** {base}/api/{version}{path} - used by every endpoint group */
  call(method: HttpMethod, path: string, options?: RequestOptions): Promise<APIResponse> {
    return this.send(method, `${this.baseUrl()}/api/${env.customerApi.CUSTOMER_API_VERSION}${path}`, options);
  }
}
