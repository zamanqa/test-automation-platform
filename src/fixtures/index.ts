import { test as base, expect } from '@playwright/test';
import { env } from '@config/env';
import { createDatabases, type Databases } from '@db/connection';
import { findCompanyIdByName } from '@db/queries/hub/companies';
import { Cleanup } from '@db/cleanup';
import { UnifiedApiClient } from '@api/unified-api/UnifiedApiClient';
import { CustomerApiClient } from '@api/customer-api/CustomerApiClient';
import { HubApiClient } from '@api/hub-api/HubApiClient';
import { LoginPage } from '@pages/hub/LoginPage';
import { OrderListPage } from '@pages/hub/OrderListPage';
import { OrderDetailPage } from '@pages/hub/OrderDetailPage';
import { OrderCreationPage } from '@pages/hub/OrderCreationPage';
import { OrderWorkflowPage } from '@pages/hub/OrderWorkflowPage';
import { SubscriptionListPage } from '@pages/hub/SubscriptionListPage';
import { SubscriptionDetailPage } from '@pages/hub/SubscriptionDetailPage';
import { InvoiceListPage } from '@pages/hub/InvoiceListPage';
import { ReturnsAndRepairsPage } from '@pages/hub/ReturnsAndRepairsPage';
import { CustomerPage } from '@pages/hub/CustomerPage';
import { ProductPage } from '@pages/hub/ProductPage';
import { DebtCollectionPage } from '@pages/hub/DebtCollectionPage';
import { HubListPage } from '@pages/hub/HubListPage';
import { VoucherPage } from '@pages/hub/VoucherPage';
import { AssetPage } from '@pages/hub/AssetPage';
import { PaymentPage } from '@pages/hub/PaymentPage';
import { RecurringTabPage } from '@pages/hub/RecurringTabPage';
import { OrderActionsPage } from '@pages/hub/OrderActionsPage';
import { EmailSendPage } from '@pages/hub/EmailSendPage';
import { CheckoutPage } from '@pages/checkout/CheckoutPage';
import { PosPage } from '@pages/pos/PosPage';
import { CssPage } from '@pages/css/CssPage';
import { StripePayment } from '@pages/checkout/payment/StripePayment';
import { AdyenPayment } from '@pages/checkout/payment/AdyenPayment';
import { BraintreePayment } from '@pages/checkout/payment/BraintreePayment';
import { MolliePayment } from '@pages/checkout/payment/MolliePayment';

// Every test imports test and expect from here:
//   import { test, expect } from '@fixtures';
//   test('...', async ({ db, unifiedApi, orderListPage }) => { ... });
//
// A fixture is only created when a test asks for it, so an API test never opens a browser.
// Worker fixtures (db, API clients) are created once per worker and shared by its tests.
// Test fixtures (pages, cleanup) are created new for every test.

type WorkerFixtures = {
  db: Databases; // db.hub, db.checkout
  hubCompanyId: string; // company of HUB_COMPANY_NAME
  unifiedApi: UnifiedApiClient;
  customerApi: CustomerApiClient;
  hubApi: HubApiClient; // starts crons
};

type TestFixtures = {
  cleanup: Cleanup;

  // hub pages
  loginPage: LoginPage;
  orderListPage: OrderListPage;
  orderDetailPage: OrderDetailPage;
  orderCreationPage: OrderCreationPage;
  orderWorkflowPage: OrderWorkflowPage;
  subscriptionListPage: SubscriptionListPage;
  subscriptionDetailPage: SubscriptionDetailPage;
  invoiceListPage: InvoiceListPage;
  returnsAndRepairsPage: ReturnsAndRepairsPage;
  customerPage: CustomerPage;
  productPage: ProductPage;
  debtCollectionPage: DebtCollectionPage;
  hubListPage: HubListPage;
  voucherPage: VoucherPage;
  assetPage: AssetPage;
  paymentPage: PaymentPage;
  recurringTabPage: RecurringTabPage;
  orderActionsPage: OrderActionsPage;
  emailSendPage: EmailSendPage;

  // checkout, POS and CSS pages
  checkoutPage: CheckoutPage;
  posPage: PosPage;
  cssPage: CssPage;
  stripePayment: StripePayment;
  adyenPayment: AdyenPayment;
  braintreePayment: BraintreePayment;
  molliePayment: MolliePayment;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  db: [
    async ({}, use) => {
      const db = createDatabases();
      await use(db);
      await db.closeAll();
    },
    { scope: 'worker' },
  ],

  hubCompanyId: [
    async ({ db }, use) => {
      const companyId = await findCompanyIdByName(db.hub, env.hub.HUB_COMPANY_NAME);
      await use(companyId);
    },
    { scope: 'worker' },
  ],

  unifiedApi: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext();
      await use(new UnifiedApiClient(request)); // keeps its login token for the whole worker
      await request.dispose();
    },
    { scope: 'worker' },
  ],

  customerApi: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext();
      await use(new CustomerApiClient(request));
      await request.dispose();
    },
    { scope: 'worker' },
  ],

  hubApi: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext();
      await use(new HubApiClient(request));
      await request.dispose();
    },
    { scope: 'worker' },
  ],

  // undo steps added during the test run after it, pass or fail
  cleanup: async ({}, use) => {
    const cleanup = new Cleanup();
    await use(cleanup);
    await cleanup.runAll();
  },

  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  orderListPage: async ({ page }, use) => use(new OrderListPage(page)),
  orderDetailPage: async ({ page }, use) => use(new OrderDetailPage(page)),
  orderCreationPage: async ({ page }, use) => use(new OrderCreationPage(page)),
  orderWorkflowPage: async ({ page }, use) => use(new OrderWorkflowPage(page)),
  subscriptionListPage: async ({ page }, use) => use(new SubscriptionListPage(page)),
  subscriptionDetailPage: async ({ page }, use) => use(new SubscriptionDetailPage(page)),
  invoiceListPage: async ({ page }, use) => use(new InvoiceListPage(page)),
  returnsAndRepairsPage: async ({ page }, use) => use(new ReturnsAndRepairsPage(page)),
  customerPage: async ({ page }, use) => use(new CustomerPage(page)),
  productPage: async ({ page }, use) => use(new ProductPage(page)),
  debtCollectionPage: async ({ page }, use) => use(new DebtCollectionPage(page)),
  hubListPage: async ({ page }, use) => use(new HubListPage(page)),
  voucherPage: async ({ page }, use) => use(new VoucherPage(page)),
  assetPage: async ({ page }, use) => use(new AssetPage(page)),
  paymentPage: async ({ page }, use) => use(new PaymentPage(page)),
  recurringTabPage: async ({ page }, use) => use(new RecurringTabPage(page)),
  orderActionsPage: async ({ page }, use) => use(new OrderActionsPage(page)),
  emailSendPage: async ({ page }, use) => use(new EmailSendPage(page)),
  checkoutPage: async ({ page }, use) => use(new CheckoutPage(page)),
  posPage: async ({ page }, use) => use(new PosPage(page)),
  cssPage: async ({ page }, use) => use(new CssPage(page)),
  stripePayment: async ({ page }, use) => use(new StripePayment(page)),
  adyenPayment: async ({ page }, use) => use(new AdyenPayment(page)),
  braintreePayment: async ({ page }, use) => use(new BraintreePayment(page)),
  molliePayment: async ({ page }, use) => use(new MolliePayment(page)),
});

// test.skip(condition, reason) on the first try fails the try instead, so the test runs once more
// straight away (test data may be there a moment later). Only on the last try is it really skipped.
const playwrightSkip = test.skip;
function skipOrRetry(condition: boolean, reason: string) {
  const info = test.info();
  if (condition && info.retry < info.project.retries) {
    throw new Error(`Skipped on try ${info.retry + 1} (${reason}) - trying once more`);
  }
  playwrightSkip(condition, reason);
}
test.skip = skipOrRetry as typeof test.skip;

export { expect };
