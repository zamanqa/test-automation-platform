import { test, expect } from '@fixtures';
import { env } from '@config/env';
import { testEmail } from '@data/random';
import type { PosCustomer } from '@pages/pos/PosPage';
import {
  findDraftItems,
  findDraftOrder,
  getDraftOrderStatus,
  findOrderCustomer,
  findPosProduct,
  findProductsOfFilterOption,
  findRetailer,
} from '@db/queries/hub/pos';

// POS → Create order: the Add item steps (product → variant → configure), filters and search,
// Remove item, voucher, a new quote ("quote_…") and its checkout link, and Cancel of a quote.
// Needs: a product the POS can sell (active, in stock, sku and name, not qa_auto, 2 or more variants).
// Changes data: each run creates 2 quotes with a new qa_auto_ customer; the cancel test cancels its own quote.
test.describe.configure({ mode: 'default' });

const VOUCHER = '12'; // only checked that it is there, not its discount

// a new customer for every quote
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
    // SETUP: a product + variant the POS can sell
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const product = await findPosProduct(db.hub, retailer.company_id);

    // ACTION: Create order → Add item → product → variant
    await posPage.openCreateOrder();
    await posPage.chooseProduct(product.product_name, product.variant_name);

    // CHECK: the Configure step shows the sku and name of the variant
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
    // SETUP: a filter option that products have, e.g. Material "Plastic", and those products
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const rows = await findProductsOfFilterOption(db.hub, retailer.company_id);
    test.skip(rows.length === 0, 'no product has a filter option');
    const option = rows[0].option_label;

    // ACTION: Create order → Add item → tick the option
    await posPage.openCreateOrder();
    await posPage.openProductList();
    await posPage.tickProductFilter(option);

    // CHECK: exactly those products are shown, and the filter chip is there
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
    // SETUP: product
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const product = await findPosProduct(db.hub, retailer.company_id);
    const customer = newCustomer();

    // ACTION: item + voucher 12
    await posPage.openCreateOrder();
    await posPage.chooseProduct(product.product_name, product.variant_name);
    await posPage.addConfiguredItem();
    await posPage.addVoucher(VOUCHER);

    // CHECK: the voucher is taken (the field is locked)
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

    // CHECK: the quote is in the database: open, this retailer and company, with a checkout link
    const draft = await findDraftOrder(db.hub, draftId);
    expect(draft, `${draftId} should be in draft_orders.draft_id`).toBeDefined();
    expect(draft!.status).toBe('open');
    expect(draft!.retailer_id).toBe(retailer.retailer_id);
    expect(draft!.company_id).toBe(retailer.company_id);
    expect(draft!.order_checkout_link).toContain('https://');

    // CHECK: its item is the variant (sku and name), and the customer has the new email
    const items = await findDraftItems(db.hub, draftId);
    expect(items).toHaveLength(1);
    expect(items[0].sku).toBe(product.sku);
    expect(items[0].name).toBe(product.variant_name);
    const savedCustomer = await findOrderCustomer(db.hub, draft!.order_customer_id);
    expect(savedCustomer.email).toBe(customer.email);

    // CHECK: the "Checkout link" on the page is the one in the database
    await expect(posPage.checkoutLink()).toHaveAttribute('href', draft!.order_checkout_link);

    // ACTION: open the checkout link
    await posPage.page.goto(draft!.order_checkout_link);

    // CHECK: the checkout shows the item, and the form has the customer's data
    await expect(posPage.page.getByText(product.variant_name).first()).toBeVisible({ timeout: 30_000 });
    await expect(posPage.page.getByRole('textbox', { name: 'First name *' })).toHaveValue(customer.firstName);
    await expect(posPage.page.getByRole('textbox', { name: 'Last name *' })).toHaveValue(customer.lastName);
    await expect(posPage.page.getByRole('textbox', { name: 'Email *' })).toHaveValue(customer.email);
    await expect(posPage.page.getByRole('textbox', { name: 'Street *' })).toHaveValue(customer.street);
    await expect(posPage.page.getByRole('textbox', { name: 'Street number *' })).toHaveValue(customer.streetNumber);
    await expect(posPage.page.getByRole('textbox', { name: 'Postal Code *' })).toHaveValue(customer.postalCode);
    await expect(posPage.page.getByRole('textbox', { name: 'City *' })).toHaveValue(customer.city);

    // CHECK: the voucher is applied (the discount amount is not checked)
    await expect(posPage.page.getByRole('button', { name: 'Remove promotion code' })).toBeVisible();
    await expect(posPage.page.getByText(VOUCHER, { exact: true }).first()).toBeVisible();
  });

  test('cancels a quote → cancelled in draft_orders and gone from the list', async ({ posPage, db }) => {
    // SETUP: a new quote of our own
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const product = await findPosProduct(db.hub, retailer.company_id);
    const draftId = await posPage.createQuote(product.product_name, product.variant_name, newCustomer());

    // ACTION: order page → Cancel → confirm
    await posPage.openOrder(draftId);
    await posPage.cancelOrder(draftId);

    // CHECK: status cancelled and deleted_at set
    await expect
      .poll(() => getDraftOrderStatus(db.hub, draftId), { message: `${draftId} status in draft_orders` })
      .toBe('cancelled');
    const draft = await findDraftOrder(db.hub, draftId);
    expect(draft!.deleted_at, 'a cancelled quote is soft-deleted').not.toBeNull();

    // CHECK: the Order list no longer finds it
    await posPage.openOrderList();
    await posPage.search(draftId);
    await expect(posPage.page.getByRole('link', { name: draftId })).toHaveCount(0);
  });
});
