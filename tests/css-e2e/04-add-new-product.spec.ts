import { test, expect } from '@fixtures';
import { readCssData } from '@data/css';
import { findCssProduct } from '@db/queries/hub/products';
import { countOrdersOfCustomer, getCompanyIdOfCustomer } from '@db/queries/hub/customers';

/**
 * WHAT:   CSS → "Add new product" → click a product in the list → step 03 (quantity, frequency, start) → Finalize
 *         → "Confirm order" → "Subscribe now" → a new order of the customer is in the DB (owner).
 * NEEDS:  .auth/css-data.json from 01-css-login.spec.ts; a product of the shop: active, allow_order_create, type consumable, stock > 0 (owner).
 * CHANGES DATA: yes — a new order (binding purchase on dev) for the CSS test customer.
 */
test.describe('CSS - add new product', () => {
  test('adds a product with stock to the customer', async ({ cssPage, db }) => {
    // SETUP: product with positive stock ← hub db
    const data = readCssData();
    test.skip(!data, 'no .auth/css-data.json — run 01-css-login.spec.ts first');
    const product = await findCssProduct(db.hub, data!.customerId);
    test.skip(!product, 'no active, orderable consumable product in stock');
    test.info().annotations.push({ type: 'product', description: `${product!.product_id} ${product!.title} (stock ${product!.stock})` });

    // SETUP: number of orders of the customer before ← hub db
    const companyId = await getCompanyIdOfCustomer(db.hub, data!.customerId);
    const ordersBefore = await countOrdersOfCustomer(db.hub, companyId, data!.customerId);

    // ACTION: Login CSS → Add new product → click the product in the list
    // (not via Search: typing in Search shows a 500 page "Cannot create property 'value' on string ''" — CSS bug, 2026-09-29)
    await cssPage.loginFromHub(data!.customerId);
    await cssPage.page.getByRole('button', { name: 'Add new product' }).click();
    await cssPage.page.getByRole('heading', { name: product!.title, exact: true, level: 3 }).first().click();

    // CHECK: step 03 of that product: quantity 1, frequency, start date
    await expect(cssPage.page).toHaveURL(new RegExp(`step=03&product=${product!.product_id}`));
    await expect(cssPage.page.getByRole('heading', { name: product!.title, level: 3 })).toBeVisible();
    await expect(cssPage.page.getByRole('spinbutton', { name: 'Quantity' })).toHaveValue('1');
    await expect(cssPage.page.getByRole('textbox', { name: 'Subscription start' })).not.toHaveValue('');

    // ACTION: Finalize → "Confirm order" dialog → Subscribe now
    await cssPage.page.getByRole('button', { name: 'Finalize' }).click();
    const dialog = cssPage.page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Confirm order' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Subscribe now' }).click();

    // CHECK (DB): the customer has one order more
    await expect
      .poll(() => countOrdersOfCustomer(db.hub, companyId, data!.customerId), { message: `orders of ${data!.customerId}`, timeout: 60_000 })
      .toBe(ordersBefore + 1);
  });
});
