import { test, expect } from '@fixtures';
import { testName } from '@data/random';
import {
  clearCacheTables,
  countProducts,
  findInactiveProduct,
  findNewestProductByTitle,
  findProductById,
  findProductBySku,
  findVariantsOfProduct,
  isProductActive,
} from '@db/queries/hub/products';

/**
 * WHAT:   Hub UI → Products: the Products and Variants tabs, "Create product" (with a variant),
 *         bulk edit of prices, map to product collection, product + variant pages, product sync.
 *         Taxes, Exchange groups and Bundles are NOT touched (owner's rule).
 * NEEDS:  products of the company (company_id ← hubCompanyId fixture, '734f-4c766638po').
 * CHANGES DATA: yes — creates one product "qa_auto_hub_product_…" with one variant per run (products are
 *         never deleted from the hub), edits that product's prices, maps it to a collection,
 *         empties the cache tables and starts a product sync (last test).
 * productPage methods ← src/pages/hub/ProductPage.ts
 */
test.describe.configure({ mode: 'default' });

const PRODUCT_TITLE_START = 'qa_auto_hub_product';

test.describe('Hub - products', () => {
  test('shows the product list with its tabs, columns and pages', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: number of products ← hub db
    const total = await countProducts(db.hub, hubCompanyId);

    // ACTION: open Products
    await productPage.openList();

    // CHECK: the 6 tabs, the main columns, and "1-10 of <total>" under the table
    for (const tab of ['Products', 'Variants', 'Attributes', 'Taxes', 'Exchange groups', 'Bundles']) {
      await expect(productPage.page.getByRole('tab', { name: tab, exact: true })).toBeVisible();
    }
    for (const column of ['ID', 'SKU', 'Title', 'Stock', 'MSRP', 'Purchase price', 'Type']) {
      await expect(productPage.columnHeader(column)).toBeVisible();
    }
    await expect(productPage.page.getByText(/Last sync time:/)).toBeVisible();
    await expect(productPage.pageInfo()).toHaveText(`1-10 of ${total}`);
  });

  test('changes items per page and goes to the next page', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: needs more than 10 products
    const total = await countProducts(db.hub, hubCompanyId);
    test.skip(total <= 10, 'Only 10 or fewer products — no second page');
    await productPage.openList();

    // ACTION + CHECK: next page → "11-…"
    await productPage.nextPageButton().click();
    await expect(productPage.pageInfo()).toHaveText(new RegExp(`^11-\\d+ of ${total}$`));

    // ACTION + CHECK: 25 per page → "1-<min(25,total)> of <total>"
    await productPage.setItemsPerPage('25');
    await expect(productPage.pageInfo()).toHaveText(`1-${Math.min(25, total)} of ${total}`);
  });

  test('finds a product by SKU and by title', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: newest product (any title) ← hub db
    const any = await findNewestProductByTitle(db.hub, hubCompanyId, '');
    test.skip(!any, 'No product in the database');
    await productPage.openList();

    // ACTION + CHECK: search by SKU → the product is the first row
    await productPage.search(any!.sku);
    await expect(productPage.rowOf(any!.id)).toBeVisible();

    // ACTION + CHECK: search by title → the product is the first row
    await productPage.search(any!.title);
    await expect(productPage.rowOf(any!.id)).toBeVisible();
  });

  test('shows only inactive products, then only active ones', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: there must be an inactive product
    test.skip(!(await findInactiveProduct(db.hub, hubCompanyId)), 'No inactive product in the database');
    await productPage.openList();

    // ACTION: Active picker → Inactive
    await productPage.showOnly('Inactive');
    // CHECK: the first product shown is inactive in the DB
    await expect.poll(async () => isProductActive(db.hub, hubCompanyId, await productPage.firstRowId()), { message: 'first row is inactive in the DB' }).toBe(false);

    // ACTION: Active picker → Active
    await productPage.showOnly('Active');
    // CHECK: the first product shown is active in the DB
    await expect.poll(async () => isProductActive(db.hub, hubCompanyId, await productPage.firstRowId()), { message: 'first row is active in the DB' }).toBe(true);
  });

  test('filters active products with the filter panel and clears the filter', async ({ productPage, db, hubCompanyId }) => {
    // SETUP
    await productPage.openList();
    await expect(productPage.clearFilterButton()).toBeDisabled();

    // ACTION: Filter → Active = on → Add new filter → Search
    await productPage.filterActiveProducts();

    // CHECK: "Clear" is enabled and the first product is active in the DB
    await expect(productPage.clearFilterButton()).toBeEnabled();
    await expect.poll(async () => isProductActive(db.hub, hubCompanyId, await productPage.firstRowId()), { message: 'first row is active' }).toBe(true);

    // ACTION + CHECK: Clear → the button is disabled again
    await productPage.clearFilterButton().click();
    await expect(productPage.clearFilterButton()).toBeDisabled();
  });

  test('hides and shows a column with the column-visibility button', async ({ productPage }) => {
    // SETUP
    await productPage.openList();
    await expect(productPage.columnHeader('MSRP')).toBeVisible();

    // ACTION: column icon (3rd icon) → untick MSRP
    await productPage.iconButton(2).click();
    await expect(productPage.dialog().getByRole('heading', { name: 'Column visibility' })).toBeVisible();
    await productPage.dialog().getByRole('checkbox', { name: 'MSRP', exact: true }).click();
    await productPage.page.keyboard.press('Escape');
    // CHECK: the MSRP column is gone
    await expect(productPage.columnHeader('MSRP')).toBeHidden();

    // ACTION + CHECK: column icon → tick MSRP again → the column is back
    await productPage.iconButton(2).click();
    await productPage.dialog().getByRole('checkbox', { name: 'MSRP', exact: true }).click();
    await productPage.page.keyboard.press('Escape');
    await expect(productPage.columnHeader('MSRP')).toBeVisible();
  });

  test('refresh button reloads the product list', async ({ productPage }) => {
    // SETUP
    await productPage.openList();

    // ACTION: refresh icon (1st icon) → wait for the product list request
    const reload = productPage.page.waitForResponse((r) => r.url().includes('/products?') && r.request().method() === 'GET');
    await productPage.iconButton(0).click();

    // CHECK: the list was loaded again (200) and still shows rows
    expect((await reload).status(), 'product list request after refresh').toBe(200);
    await expect(productPage.rows.first()).toBeVisible();
  });

  test('"Create product" needs a title and a SKU; Reset empties the form', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: number of products ← hub db
    const before = await countProducts(db.hub, hubCompanyId);
    await productPage.openCreateForm();

    // ACTION: type a title + SKU → Reset
    await productPage.input('Title *').fill('qa_auto_reset_check');
    await productPage.input('SKU *').fill('qa_auto_reset_check');
    await productPage.page.getByRole('button', { name: 'Reset' }).click();
    // CHECK: both fields are empty again
    await expect(productPage.input('Title *')).toHaveValue('');
    await expect(productPage.input('SKU *')).toHaveValue('');

    // ACTION: Create product with the empty form
    await productPage.clickCreate();
    // CHECK: no product was created
    await productPage.waitUntilLoaded();
    expect(await countProducts(db.hub, hubCompanyId), 'number of products after an empty Create').toBe(before);
  });

  test('creates a product with a variant', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: new title + SKU (prefix qa_auto_)
    const title = testName('hub_product');
    const sku = title.toUpperCase();
    test.info().annotations.push({ type: 'product', description: `${title} / ${sku}` });
    await productPage.openCreateForm();

    // ACTION: fill the form, add one variant, Create product
    await productPage.input('Title *').fill(title);
    await productPage.input('SKU *').fill(sku);
    await productPage.chooseType('normal');
    await productPage.input('German (de)').fill(`${title} DE`);
    await productPage.input('Purchase price').fill('20');
    await productPage.input('MSRP').fill('99');
    await productPage.input('Buyout retail price').fill('80');
    await productPage.page.getByRole('switch', { name: 'Allow order create' }).click();
    await productPage.addVariant({ title: `${title} variant`, sku: `${sku}-V1`, price: '15', stock: '10', duration: '12' });
    await productPage.clickCreate();

    // CHECK: the form closes (URL is no longer /create)
    await expect(productPage.page).not.toHaveURL(/\/create/, { timeout: 30_000 });

    // CHECK: products row ← hub db
    await expect.poll(() => findProductBySku(db.hub, hubCompanyId, sku), { message: `product ${sku} in the DB` }).toBeTruthy();
    const product = (await findProductBySku(db.hub, hubCompanyId, sku))!;
    expect(product.title).toBe(title);
    expect(product.type).toBe('normal');
    expect(product.active, 'active').toBe(true);
    expect(product.allow_order_create, 'allow_order_create').toBe(true);
    expect(Number(product.purchase_price), 'purchase_price').toBe(20);
    expect(Number(product.msrp), 'msrp').toBe(99);
    expect(Number(product.buyout_retail_price), 'buyout_retail_price').toBe(80);
    expect(product.title_translations?.de, 'German title').toBe(`${title} DE`);

    // CHECK: product_variants row ← hub db
    const variants = await findVariantsOfProduct(db.hub, hubCompanyId, product.id);
    expect(variants, 'one variant').toHaveLength(1);
    expect(variants[0].sku).toBe(`${sku}-V1`);
    expect(Number(variants[0].price), 'variant price').toBe(15);
    expect(variants[0].stock, 'variant stock').toBe(10);
    expect(variants[0].duration, 'variant duration').toBe(12);
    expect(variants[0].subscription_item, 'subscription item').toBe(true);
  });

  test('shows the product and variant pages with the DB values', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: newest product created by this suite ← hub db
    const product = await findNewestProductByTitle(db.hub, hubCompanyId, PRODUCT_TITLE_START);
    test.skip(!product, 'No qa_auto_hub_product yet — run "creates a product with a variant" first');
    const variant = (await findVariantsOfProduct(db.hub, hubCompanyId, product!.id))[0];

    // ACTION: open the product page
    await productPage.openProduct(product!.id);
    // CHECK: title, SKU and the variant list
    await expect(productPage.page.getByRole('heading', { name: product!.title, level: 1 })).toBeVisible();
    await expect(productPage.page.getByText(`SKU: ${product!.sku}`, { exact: true })).toBeVisible();
    await expect(productPage.page.getByRole('heading', { name: /^Variants/ })).toBeVisible();

    // ACTION: click the variant → variant page
    await productPage.page.getByRole('link', { name: variant.title }).click();
    await expect(productPage.page).toHaveURL(new RegExp(`/cms/variants/${variant.id}`));
    // CHECK: SKU, stock, duration of the variant = DB
    await expect(productPage.detail('SKU')).toHaveText(variant.sku);
    await expect(productPage.detail('Stock')).toHaveText(String(variant.stock));
    await expect(productPage.detail('Duration')).toHaveText(String(variant.duration));

    // ACTION + CHECK: "View parent product" → back on the product page
    await productPage.page.getByRole('link', { name: 'View parent product' }).click();
    await expect(productPage.page).toHaveURL(new RegExp(`/cms/products/${product!.id}$`));
  });

  test('the new product can be picked in "Create order"', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: newest product created by this suite (allow order create = on) ← hub db
    const product = await findNewestProductByTitle(db.hub, hubCompanyId, PRODUCT_TITLE_START);
    test.skip(!product, 'No qa_auto_hub_product yet');
    const page = productPage.page;

    // ACTION: start page → Create order → Add item → type the product title in "Select product"
    await page.goto('');
    await page.getByRole('button', { name: 'Create order', exact: true }).click();
    await page.locator('button[data-cy="btn-order-item-open-create"]').click();
    const productBox = page.locator('label', { hasText: 'Select product' }).first().locator('xpath=ancestor::div[1]').getByRole('combobox');
    await productBox.fill(product!.title);

    // CHECK: the product is offered (nothing is saved — the order is not submitted)
    await expect(page.getByRole('option', { name: new RegExp(product!.title) }).first()).toBeVisible();
  });

  test('edits the prices of a product in the list (bulk edit)', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: newest qa_auto product ← hub db; new MSRP = old + 1
    const product = await findNewestProductByTitle(db.hub, hubCompanyId, PRODUCT_TITLE_START);
    test.skip(!product, 'No qa_auto_hub_product yet');
    const newMsrp = Number(product!.msrp) + 1;
    const newPurchase = Number(product!.purchase_price) + 1;
    await productPage.openList();
    await productPage.search(product!.sku);

    // ACTION: tick the row → Edit → MSRP + Purchase price → Submit changes
    await productPage.selectRow(product!.id);
    await productPage.startEdit();
    await productPage.editCell(product!.id, 'MSRP', String(newMsrp));
    await productPage.editCell(product!.id, 'Purchase price', String(newPurchase));
    await productPage.submitChanges();

    // CHECK: products.msrp and purchase_price ← hub db
    await expect.poll(async () => Number((await findProductById(db.hub, hubCompanyId, product!.id))?.msrp), { message: 'msrp' }).toBe(newMsrp);
    await expect.poll(async () => Number((await findProductById(db.hub, hubCompanyId, product!.id))?.purchase_price), { message: 'purchase_price' }).toBe(newPurchase);
  });

  test('Cancel in bulk edit keeps the old price; "Select all" selects every row', async ({ productPage, db, hubCompanyId }) => {
    // SETUP
    const product = await findNewestProductByTitle(db.hub, hubCompanyId, PRODUCT_TITLE_START);
    test.skip(!product, 'No qa_auto_hub_product yet');
    await productPage.openList();
    await productPage.search(product!.sku);

    // ACTION: Edit → type a new MSRP → Cancel
    await productPage.selectRow(product!.id);
    await productPage.startEdit();
    await productPage.editCell(product!.id, 'MSRP', '12345');
    await productPage.cancelEdit();

    // CHECK: MSRP unchanged in the DB
    expect(Number((await findProductById(db.hub, hubCompanyId, product!.id))?.msrp), 'msrp after Cancel').toBe(Number(product!.msrp));

    // ACTION + CHECK: clear search → select one row → "Select all" → "<total> items are selected"
    await productPage.openList();
    await productPage.selectRow(await productPage.firstRowId());
    await productPage.page.getByRole('button', { name: 'Select all' }).click();
    const total = await countProducts(db.hub, hubCompanyId);
    await expect(productPage.page.getByText(`${total} items are selected`)).toBeVisible();
  });

  test('maps the product to a product collection', async ({ productPage, db, hubCompanyId }) => {
    // SETUP
    const product = await findNewestProductByTitle(db.hub, hubCompanyId, PRODUCT_TITLE_START);
    test.skip(!product, 'No qa_auto_hub_product yet');
    // No search here: after a search the dialog says "0 items selected" and maps nothing (hub bug, 2026-09-29).
    // The list is sorted newest first → our new product is on page 1.
    await productPage.openList();

    // ACTION: tick the row → Map to product collection → first collection
    await productPage.selectRow(product!.id);
    const collection = await productPage.mapToFirstCollection();
    test.info().annotations.push({ type: 'collection', description: collection });

    // CHECK: products.product_collection_id is set ← hub db; the list shows the collection
    await expect.poll(async () => (await findProductById(db.hub, hubCompanyId, product!.id))?.product_collection_id, { message: 'product_collection_id' }).toBeTruthy();
    await productPage.openList();
    await productPage.search(product!.sku);
    await expect(await productPage.cell(product!.id, 'Product collection')).toContainText(collection); // shown as "#<id><name>"
  });

  test('Variants tab: finds the variant and edits its extension price (bulk edit)', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: variant of the newest qa_auto product; new extension price = old + 1
    const product = await findNewestProductByTitle(db.hub, hubCompanyId, PRODUCT_TITLE_START);
    test.skip(!product, 'No qa_auto_hub_product yet');
    const variant = (await findVariantsOfProduct(db.hub, hubCompanyId, product!.id))[0];
    const newPrice = Number(variant.subscription_extension_price) + 1;
    await productPage.openList('Variants');
    for (const column of ['Product ID', 'SKU', 'Price', 'Extension price', 'Frequency', 'Duration', 'Prepaid duration']) {
      await expect(productPage.columnHeader(column)).toBeVisible();
    }

    // ACTION: search the variant SKU → tick → Edit → Extension price → Submit changes
    await productPage.search(variant.sku);
    await productPage.selectRow(variant.id);
    await productPage.startEdit();
    await productPage.editCell(variant.id, 'Extension price', String(newPrice));
    await productPage.submitChanges();

    // CHECK: product_variants.subscription_extension_price ← hub db
    await expect
      .poll(async () => Number((await findVariantsOfProduct(db.hub, hubCompanyId, product!.id))[0].subscription_extension_price), { message: 'extension price' })
      .toBe(newPrice);
  });

  // Keep this test LAST: it starts a product sync for the whole company.
  test('product sync starts after the cache tables are emptied', async ({ productPage, db }) => {
    // SETUP: empty cache_locks and cache (else the sync does not start — owner, 2026-09-29)
    await clearCacheTables(db.hub);
    await productPage.openList();

    // ACTION: sync icon (2nd icon)
    await productPage.iconButton(1).click();

    // CHECK: message "Product sync process started"
    await expect(productPage.message('Product sync process started')).toBeVisible();
  });
});
