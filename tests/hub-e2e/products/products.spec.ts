import { test, expect } from '@fixtures';
import { testName } from '@data/random';
import type { Databases } from '@db/connection';
import type { ProductPage } from '@pages/hub/ProductPage';
import {
  clearCacheTables,
  countProducts,
  findInactiveProduct,
  findNewestProductByTitle,
  findProductById,
  findProductBySku,
  findVariantsOfProduct,
  getFirstVariantExtensionPrice,
  getProductCollectionId,
  getProductMsrp,
  getProductPurchasePrice,
  isProductActive,
} from '@db/queries/hub/products';

// Hub → Products: Products and Variants tabs, "Create product" with a variant, bulk edit of prices,
// map to a product collection, product and variant pages, product sync.
// Taxes, Exchange groups and Bundles are never touched.
// Needs: products of the company.
// Changes data: creates one product "qa_auto_hub_product_…" with one variant per run (products are
// never deleted), edits its prices, maps it to a collection, empties the cache tables and starts
// a product sync (last test).
test.describe.configure({ mode: 'default' });

const PRODUCT_TITLE_START = 'qa_auto_hub_product';

// is the first product in the list active in the database?
async function firstRowIsActive(productPage: ProductPage, db: Databases, companyId: string) {
  const productId = await productPage.firstRowId();
  return isProductActive(db.hub, companyId, productId);
}

test.describe('Hub - products', () => {
  test('shows the product list with its tabs, columns and pages', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: number of products
    const total = await countProducts(db.hub, hubCompanyId);

    // ACTION: open Products
    await productPage.openList();

    // CHECK: the 6 tabs
    const page = productPage.page;
    await expect(page.getByRole('tab', { name: 'Products', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Variants', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Attributes', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Taxes', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Exchange groups', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Bundles', exact: true })).toBeVisible();

    // CHECK: the main columns
    await expect(productPage.columnHeader('ID')).toBeVisible();
    await expect(productPage.columnHeader('SKU')).toBeVisible();
    await expect(productPage.columnHeader('Title')).toBeVisible();
    await expect(productPage.columnHeader('Stock')).toBeVisible();
    await expect(productPage.columnHeader('MSRP')).toBeVisible();
    await expect(productPage.columnHeader('Purchase price')).toBeVisible();
    await expect(productPage.columnHeader('Type')).toBeVisible();

    // CHECK: last sync time and "1-10 of <total>" under the table
    await expect(productPage.page.getByText(/Last sync time:/)).toBeVisible();
    await expect(productPage.pageInfo()).toHaveText(`1-10 of ${total}`);
  });

  test('changes items per page and goes to the next page', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: needs more than 10 products
    const total = await countProducts(db.hub, hubCompanyId);
    test.skip(total <= 10, 'Only 10 or fewer products, no second page');
    await productPage.openList();

    // ACTION + CHECK: next page → "11-…"
    await productPage.nextPageButton().click();
    await expect(productPage.pageInfo()).toHaveText(new RegExp(`^11-\\d+ of ${total}$`));

    // ACTION + CHECK: 25 per page → "1-25 of <total>" (or less when there are fewer products)
    await productPage.setItemsPerPage('25');
    await expect(productPage.pageInfo()).toHaveText(`1-${Math.min(25, total)} of ${total}`);
  });

  test('finds a product by SKU and by title', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: newest product (any title)
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

    // CHECK: the first product shown is inactive in the database
    await expect.poll(() => firstRowIsActive(productPage, db, hubCompanyId), { message: 'first row is inactive in the DB' }).toBe(false);

    // ACTION: Active picker → Active
    await productPage.showOnly('Active');

    // CHECK: the first product shown is active in the database
    await expect.poll(() => firstRowIsActive(productPage, db, hubCompanyId), { message: 'first row is active in the DB' }).toBe(true);
  });

  test('filters active products with the filter panel and clears the filter', async ({ productPage, db, hubCompanyId }) => {
    // SETUP
    await productPage.openList();
    await expect(productPage.clearFilterButton()).toBeDisabled();

    // ACTION: Filter → Active = on → Add new filter → Search
    await productPage.filterActiveProducts();

    // CHECK: "Clear" is enabled and the first product is active in the database
    await expect(productPage.clearFilterButton()).toBeEnabled();
    await expect.poll(() => firstRowIsActive(productPage, db, hubCompanyId), { message: 'first row is active' }).toBe(true);

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
    // SETUP: number of products
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

    // CHECK: the form closes
    await expect(productPage.page).not.toHaveURL(/\/create/, { timeout: 30_000 });

    // CHECK: the product in the database
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

    // CHECK: its variant in the database
    const variants = await findVariantsOfProduct(db.hub, hubCompanyId, product.id);
    expect(variants, 'one variant').toHaveLength(1);
    expect(variants[0].sku).toBe(`${sku}-V1`);
    expect(Number(variants[0].price), 'variant price').toBe(15);
    expect(variants[0].stock, 'variant stock').toBe(10);
    expect(variants[0].duration, 'variant duration').toBe(12);
    expect(variants[0].subscription_item, 'subscription item').toBe(true);
  });

  test('shows the product and variant pages with the DB values', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: newest product made by these tests
    const product = await findNewestProductByTitle(db.hub, hubCompanyId, PRODUCT_TITLE_START);
    test.skip(!product, 'No qa_auto_hub_product yet, run "creates a product with a variant" first');
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

    // CHECK: SKU, stock and duration are the same as in the database
    await expect(productPage.detail('SKU')).toHaveText(variant.sku);
    await expect(productPage.detail('Stock')).toHaveText(String(variant.stock));
    await expect(productPage.detail('Duration')).toHaveText(String(variant.duration));

    // ACTION + CHECK: "View parent product" → back on the product page
    await productPage.page.getByRole('link', { name: 'View parent product' }).click();
    await expect(productPage.page).toHaveURL(new RegExp(`/cms/products/${product!.id}$`));
  });

  test('the new product can be picked in "Create order"', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: newest product made by these tests (allow order create is on)
    const product = await findNewestProductByTitle(db.hub, hubCompanyId, PRODUCT_TITLE_START);
    test.skip(!product, 'No qa_auto_hub_product yet');
    const page = productPage.page;

    // ACTION: start page → Create order → Add item → type the product title in "Select product"
    await page.goto('');
    await page.getByRole('button', { name: 'Create order', exact: true }).click();
    await page.locator('button[data-cy="btn-order-item-open-create"]').click();
    const productBox = page.locator('label', { hasText: 'Select product' }).first().locator('xpath=ancestor::div[1]').getByRole('combobox');
    await productBox.fill(product!.title);

    // CHECK: the product is offered (the order is not submitted)
    await expect(page.getByRole('option', { name: new RegExp(product!.title) }).first()).toBeVisible();
  });

  test('edits the prices of a product in the list (bulk edit)', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: newest qa_auto product
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

    // CHECK: msrp and purchase_price in the database
    await expect.poll(() => getProductMsrp(db.hub, hubCompanyId, product!.id), { message: 'msrp' }).toBe(newMsrp);
    await expect.poll(() => getProductPurchasePrice(db.hub, hubCompanyId, product!.id), { message: 'purchase_price' }).toBe(newPurchase);
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

    // CHECK: MSRP is unchanged in the database
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
    // No search here: after a search the dialog says "0 items selected" and maps nothing (hub bug).
    // The list shows the newest first, so the product is on page 1.
    await productPage.openList();

    // ACTION: tick the row → Map to product collection → first collection
    await productPage.selectRow(product!.id);
    const collection = await productPage.mapToFirstCollection();
    test.info().annotations.push({ type: 'collection', description: collection });

    // CHECK: product_collection_id is set in the database and the list shows the collection
    await expect.poll(() => getProductCollectionId(db.hub, hubCompanyId, product!.id), { message: 'product_collection_id' }).toBeTruthy();
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
    await expect(productPage.columnHeader('Product ID')).toBeVisible();
    await expect(productPage.columnHeader('SKU')).toBeVisible();
    await expect(productPage.columnHeader('Price')).toBeVisible();
    await expect(productPage.columnHeader('Extension price')).toBeVisible();
    await expect(productPage.columnHeader('Frequency')).toBeVisible();
    await expect(productPage.columnHeader('Duration')).toBeVisible();
    await expect(productPage.columnHeader('Prepaid duration')).toBeVisible();

    // ACTION: search the variant SKU → tick → Edit → Extension price → Submit changes
    await productPage.search(variant.sku);
    await productPage.selectRow(variant.id);
    await productPage.startEdit();
    await productPage.editCell(variant.id, 'Extension price', String(newPrice));
    await productPage.submitChanges();

    // CHECK: the new extension price is in the database
    await expect
      .poll(() => getFirstVariantExtensionPrice(db.hub, hubCompanyId, product!.id), { message: 'extension price' })
      .toBe(newPrice);
  });

  // Keep this test last: it starts a product sync for the whole company.
  test('product sync starts after the cache tables are emptied', async ({ productPage, db }) => {
    // SETUP: empty cache_locks and cache, else the sync does not start
    await clearCacheTables(db.hub);
    await productPage.openList();

    // ACTION: sync icon (2nd icon)
    await productPage.iconButton(1).click();

    // CHECK: message "Product sync process started"
    await expect(productPage.message('Product sync process started')).toBeVisible();
  });
});
