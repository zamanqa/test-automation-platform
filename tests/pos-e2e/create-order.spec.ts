import { test, expect } from '@fixtures';
import { env } from '@config/env';
import { testEmail } from '@data/random';
import type { PosCustomer } from '@pages/pos/PosPage';
import {
  findDraftItems,
  findDraftOrder,
  findOrderCustomer,
  findPosProduct,
  findProductsOfFilterOption,
  findRetailer,
} from '@db/queries/hub/pos';

/**
 * WHAT:   POS Create order: the Add item wizard (product → variant → configure), its filters (DB) + search, Remove item, voucher,
 *         the full flow to a new quote ("quote_…" in draft_orders.draft_id), its checkout link (opens with
 *         the item and the customer's data and the voucher), and Cancel of a quote (its id is then gone from the list).
 * NEEDS:  a product the POS can sell (active, in stock, sku + name, not qa_auto, 2+ variants) ← hub db.
 * CHANGES DATA: yes — each run creates 2 quotes with a new customer "qa_auto_…@gmail.com";
 *         the cancel test cancels its own quote.
 * posPage methods ← src/pages/pos/PosPage.ts
 */
test.describe.configure({ mode: 'default' });

const VOUCHER = '12'; // owner: any voucher; checkout only checks that it is there, not its discount

/** A new customer for every quote (owner: create a new customer with an email). */
function newCustomer(): PosCustomer {
  return {
    email: testEmail(),
    phone: '+4917656824720',
    firstName: 'Shahiduz',
    lastName: 'Zaman',
    street: 'Hansaallee',
    streetNumber: '139',
    city: 'Frankfurt am Main',
    country: 'Germany',
    postalCode: '60320',
  };
}

test.describe('POS - create order', () => {
  test.beforeEach(async ({ posPage }) => {
    await posPage.login();
  });

  test('Add item: product → variant → configure shows the sku and name, item can be removed', async ({ posPage, db }) => {
    // SETUP: a product + variant the POS can sell ← hub db
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const product = await findPosProduct(db.hub, retailer.company_id);

    // ACTION: Create order → Add item → product → variant
    await posPage.openCreateOrder();
    await posPage.chooseProduct(product.product_name, product.variant_name);

    // CHECK: Configure step shows the variant's sku and name from the DB
    await expect(posPage.configureDetail('SKU:')).toHaveText(product.sku);
    await expect(posPage.configureDetail('Name:')).toHaveText(product.variant_name);

    // ACTION: Add item
    await posPage.addConfiguredItem();

    // CHECK: the item is in "Order & items" with Edit and Remove
    await expect(posPage.item(product.variant_name)).toBeVisible();
    await expect(posPage.item(product.variant_name).getByRole('button', { name: 'Edit' })).toBeVisible();

    // ACTION: Remove
    await posPage.item(product.variant_name).getByRole('button', { name: 'Remove' }).click();

    // CHECK: no items left
    await expect(posPage.page.getByText('No items added')).toBeVisible();
  });

  test('Add item filters: a filter option shows the products that have it (DB), search finds by name', async ({ posPage, db }) => {
    // SETUP: a checkbox filter option used by products, e.g. Material "Plastic" → its products ← hub db
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const rows = await findProductsOfFilterOption(db.hub, retailer.company_id);
    test.skip(rows.length === 0, 'no product has a filter option');
    const option = rows[0].option_label;

    // ACTION: Create order → Add item → tick the option
    await posPage.openCreateOrder();
    await posPage.openProductList();
    await posPage.tickProductFilter(option);

    // CHECK: exactly the products from the DB are shown, and the filter chip is there
    await expect(posPage.productCards()).toHaveCount(rows.length);
    for (const row of rows) {
      await expect(posPage.productCards().filter({ hasText: row.product_name }).first()).toBeVisible();
    }
    await expect(posPage.page.getByText('Filters:')).toBeVisible();

    // ACTION: Clear all
    await posPage.page.getByRole('button', { name: 'Clear all' }).first().click();

    // CHECK: more products again
    await expect(posPage.productCards()).not.toHaveCount(rows.length);

    // ACTION: search the first product's name
    await posPage.page.getByRole('textbox', { name: 'Search' }).fill(rows[0].product_name);

    // CHECK: that product is shown
    await expect(posPage.productCards().filter({ hasText: rows[0].product_name }).first()).toBeVisible();
  });

  test('creates a quote with voucher 12 → draft_orders, and its checkout link opens with the data', async ({ posPage, db }) => {
    // SETUP: product ← hub db, new customer
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const product = await findPosProduct(db.hub, retailer.company_id);
    const customer = newCustomer();

    // ACTION: item + voucher 12
    await posPage.openCreateOrder();
    await posPage.chooseProduct(product.product_name, product.variant_name);
    await posPage.addConfiguredItem();
    await posPage.addVoucher(VOUCHER);

    // CHECK: voucher is taken (field locked, "Remove" button next to it)
    await expect(posPage.page.getByRole('textbox', { name: 'Voucher code' })).toBeDisabled();

    // ACTION: Continue → customer → Continue
    await posPage.continue();
    await posPage.fillCustomer(customer);
    await posPage.continue();

    // CHECK: Review shows the customer, the item and the voucher
    await expect(posPage.page.getByRole('heading', { name: 'Review' })).toBeVisible();
    await expect(posPage.page.getByText(customer.email)).toBeVisible();
    await expect(posPage.item(product.variant_name)).toBeVisible();
    await expect(posPage.page.getByText(VOUCHER, { exact: true })).toBeVisible();

    // ACTION: Create order
    const draftId = await posPage.createOrder();

    // CHECK: order page "#quote_…"
    await expect(posPage.page.getByRole('heading', { name: `#${draftId}` })).toBeVisible();

    // CHECK (DB): draft_orders row: open, this retailer + company, has a checkout link
    const draft = await findDraftOrder(db.hub, draftId);
    expect(draft, `${draftId} should be in draft_orders.draft_id`).toBeDefined();
    expect(draft!.status).toBe('open');
    expect(draft!.retailer_id).toBe(retailer.retailer_id);
    expect(draft!.company_id).toBe(retailer.company_id);
    expect(draft!.order_checkout_link).toContain('https://');

    // CHECK (DB): draft_items has the variant (sku + name), the customer has the new email
    const items = await findDraftItems(db.hub, draftId);
    expect(items).toHaveLength(1);
    expect(items[0].sku).toBe(product.sku);
    expect(items[0].name).toBe(product.variant_name);
    const savedCustomer = await findOrderCustomer(db.hub, draft!.order_customer_id);
    expect(savedCustomer.email).toBe(customer.email);

    // CHECK: the page's "Checkout link" is the one in the DB
    await expect(posPage.checkoutLink()).toHaveAttribute('href', draft!.order_checkout_link);

    // ACTION: open the checkout link
    await posPage.page.goto(draft!.order_checkout_link);

    // CHECK: checkout shows the item, and the form is filled with the customer's data
    await expect(posPage.page.getByText(product.variant_name).first()).toBeVisible({ timeout: 30_000 });
    await expect(posPage.page.getByRole('textbox', { name: 'First name *' })).toHaveValue(customer.firstName);
    await expect(posPage.page.getByRole('textbox', { name: 'Last name *' })).toHaveValue(customer.lastName);
    await expect(posPage.page.getByRole('textbox', { name: 'Email *' })).toHaveValue(customer.email);
    await expect(posPage.page.getByRole('textbox', { name: 'Street *' })).toHaveValue(customer.street);
    await expect(posPage.page.getByRole('textbox', { name: 'Street number *' })).toHaveValue(customer.streetNumber);
    await expect(posPage.page.getByRole('textbox', { name: 'Postal Code *' })).toHaveValue(customer.postalCode);
    await expect(posPage.page.getByRole('textbox', { name: 'City *' })).toHaveValue(customer.city);

    // CHECK: the voucher is there (only that it is applied — the discount amount is not checked, owner)
    await expect(posPage.page.getByRole('button', { name: 'Remove promotion code' })).toBeVisible();
    await expect(posPage.page.getByText(VOUCHER, { exact: true }).first()).toBeVisible();
  });

  test('cancels a quote → cancelled in draft_orders and gone from the list', async ({ posPage, db }) => {
    // SETUP: a new quote of our own (owner: Cancel may be used)
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const product = await findPosProduct(db.hub, retailer.company_id);
    const draftId = await posPage.createQuote(product.product_name, product.variant_name, newCustomer());

    // ACTION: order page → Cancel → confirm
    await posPage.openOrder(draftId);
    await posPage.cancelOrder(draftId);

    // CHECK (DB): status cancelled, deleted_at filled
    await expect
      .poll(async () => (await findDraftOrder(db.hub, draftId))?.status, { message: `${draftId} status in draft_orders` })
      .toBe('cancelled');
    const draft = await findDraftOrder(db.hub, draftId);
    expect(draft!.deleted_at, 'a cancelled quote is soft-deleted').not.toBeNull();

    // CHECK: the Order list no longer finds it
    await posPage.openOrderList();
    await posPage.search(draftId);
    await expect(posPage.page.getByRole('link', { name: draftId })).toHaveCount(0);
  });
});
