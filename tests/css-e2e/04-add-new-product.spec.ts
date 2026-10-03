import { test, expect } from '@fixtures';
import { readCssData } from '@data/css';
import { findCssProduct } from '@db/queries/hub/products';
import { countOrdersOfCustomer, getCompanyIdOfCustomer } from '@db/queries/hub/customers';

// CSS → "Add new product" → click a product → step 03 (quantity, frequency, start) → Finalize
// → "Confirm order" → "Subscribe now" → the customer has a new order.
// Needs: .auth/css-data.json from 01-css-login.spec.ts; an active, orderable consumable product with stock.
// Changes data: a new order for the CSS test customer.
test.describe('CSS - add new product', () => {
  test('adds a product with stock to the customer', async ({ cssPage, db }) => {
    // SETUP: product with positive stock
    const data = readCssData();
    test.skip(!data, 'no .auth/css-data.json, run 01-css-login.spec.ts first');
    const product = await findCssProduct(db.hub, data!.customerId);
    test.skip(!product, 'no active, orderable consumable product in stock');
    test.info().annotations.push({ type: 'product', description: `${product!.product_id} ${product!.title} (stock ${product!.stock})` });

    // SETUP: number of orders of the customer before
    const companyId = await getCompanyIdOfCustomer(db.hub, data!.customerId);
    const ordersBefore = await countOrdersOfCustomer(db.hub, companyId, data!.customerId);

    // ACTION: Login CSS → Add new product → click the product in the list
    // (not with Search: typing there shows a 500 page, a CSS bug)
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

    // CHECK: the customer has one order more
    await expect
      .poll(() => countOrdersOfCustomer(db.hub, companyId, data!.customerId), { message: `orders of ${data!.customerId}`, timeout: 60_000 })
      .toBe(ordersBefore + 1);
  });
});
