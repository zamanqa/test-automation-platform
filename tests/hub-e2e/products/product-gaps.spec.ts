import { test, expect } from '@fixtures';
import { testName } from '@data/random';
import { findAttributeBySlug, findNewestProductByTitle, findVariantsOfProduct } from '@db/queries/hub/products';
import {
  countProductsWithSku,
  deleteAttributeBySlug,
  countProductsWithTitle,
  deleteProductsWithTitle,
  findRealAttribute,
  findRealProductSku,
  getAllowOrderCreate,
  getAttributeOptionPairs,
  getVariantDuration,
  setAllowOrderCreate,
  setVariantDuration,
} from '@db/queries/hub/products-more';

// Hub → Products: the cases that were missing - create without SKU / with a SKU that is already used,
// bulk edit of a switch column (Active is not editable in the list), variant bulk edit of the duration
// (stock is not editable), attribute option edit and delete, attribute with a slug that is already used.
// Needs: the qa_auto_hub_product of products.spec.ts. Taxes, Exchange groups and Bundles are never touched.
// Changes data: switches "Allow order create" of the qa_auto product off and on, changes its variant duration (put back),
// creates one qa_auto attribute (deleted again). A product created with a used SKU is deleted by cleanup.
test.describe.configure({ mode: 'default' });

const PRODUCT_TITLE_START = 'qa_auto_hub_product';

test.describe('Hub - product gaps', () => {
  test('PR1a "Create product" without a SKU creates nothing', async ({ productPage, db, hubCompanyId, cleanup }) => {
    // SETUP
    const title = testName('no_sku');
    cleanup.add('delete a product created without SKU', () => deleteProductsWithTitle(db.hub, hubCompanyId, title));
    await productPage.openCreateForm();

    // ACTION: only a title → Create product
    await productPage.input('Title *').fill(title);
    await productPage.clickCreate();

    // CHECK: still on the create form, no product with this title
    await expect(productPage.page).toHaveURL(/\/create/);
    await productPage.waitUntilLoaded();
    expect(await countProductsWithTitle(db.hub, hubCompanyId, title), 'products created without SKU').toBe(0);
  });

  test('PR1b "Create product" with a SKU that is already used is refused (bug CIR-1597)', async ({ productPage, db, hubCompanyId, cleanup }) => {
    // SETUP: SKU of a real product; the product is deleted again if the hub creates it
    const existing = await findRealProductSku(db.hub, hubCompanyId);
    test.skip(!existing, 'no real product with a SKU');
    const before = await countProductsWithSku(db.hub, hubCompanyId, existing!.sku);
    const title = testName('dup_sku');
    cleanup.add('delete a product created with the used SKU', () => deleteProductsWithTitle(db.hub, hubCompanyId, title));
    test.info().annotations.push({ type: 'sku', description: existing!.sku });

    // ACTION
    await productPage.openCreateForm();
    await productPage.input('Title *').fill(title);
    await productPage.input('SKU *').fill(existing!.sku);
    await productPage.chooseType('normal');
    const answer = productPage.page.waitForResponse((r) => r.request().method() === 'POST' && /\/products$/.test(new URL(r.url()).pathname));
    await productPage.clickCreate();

    // CHECK: the API refuses, the form stays open, no second product with this SKU
    const response = await answer;
    test.info().annotations.push({ type: 'API answer', description: `${response.status()} ${(await response.text()).slice(0, 200)}` });
    expect(response.status(), 'create answer').toBeGreaterThanOrEqual(400);
    await expect(productPage.page).toHaveURL(/\/create/);
    expect(await countProductsWithSku(db.hub, hubCompanyId, existing!.sku), `products with SKU ${existing!.sku}`).toBe(before);
  });

  test('PR2 bulk edit switches "Allow order create" off and on again; Active is not editable', async ({ productPage, db, hubCompanyId, cleanup }) => {
    // SETUP
    const product = await findNewestProductByTitle(db.hub, hubCompanyId, PRODUCT_TITLE_START);
    test.skip(!product, 'No qa_auto_hub_product yet');
    const before = await getAllowOrderCreate(db.hub, product!.id);
    cleanup.add('allow_order_create back', () => setAllowOrderCreate(db.hub, product!.id, before));
    await productPage.openList();
    await productPage.search(product!.sku);

    await test.step('switch off', async () => {
      await productPage.selectRow(product!.id);
      await productPage.startEdit();
      // Active has no input in edit mode
      await expect((await productPage.cell(product!.id, 'Active')).locator('input')).toHaveCount(0);
      await (await productPage.cell(product!.id, 'Allow order create')).locator('input').click();
      await productPage.submitChanges();
      await expect.poll(() => getAllowOrderCreate(db.hub, product!.id), { message: 'allow_order_create' }).toBe(!before);
    });

    await test.step('switch on again', async () => {
      // load the list again, else the row still shows the old switch state
      await productPage.openList();
      await productPage.search(product!.sku);
      await productPage.selectRow(product!.id);
      await productPage.startEdit();
      await (await productPage.cell(product!.id, 'Allow order create')).locator('input').click();
      await productPage.submitChanges();
      await expect.poll(() => getAllowOrderCreate(db.hub, product!.id), { message: 'allow_order_create' }).toBe(before);
    });
  });

  test('PR3 variants bulk edit changes the duration; stock is not editable', async ({ productPage, db, hubCompanyId, cleanup }) => {
    // SETUP
    const product = await findNewestProductByTitle(db.hub, hubCompanyId, PRODUCT_TITLE_START);
    test.skip(!product, 'No qa_auto_hub_product yet');
    const variant = (await findVariantsOfProduct(db.hub, hubCompanyId, product!.id))[0];
    const oldDuration = await getVariantDuration(db.hub, variant.id);
    cleanup.add('variant duration back', () => setVariantDuration(db.hub, variant.id, oldDuration));
    await productPage.openList('Variants');
    await productPage.search(variant.sku);

    // ACTION: tick → Edit → Duration → Submit changes
    await productPage.selectRow(variant.id);
    await productPage.startEdit();
    await expect((await productPage.cell(variant.id, 'Stock')).getByRole('textbox')).toHaveCount(0);
    await productPage.editCell(variant.id, 'Duration', String(oldDuration + 1));
    await productPage.submitChanges();

    // CHECK
    await expect.poll(() => getVariantDuration(db.hub, variant.id), { message: 'variant duration' }).toBe(oldDuration + 1);
  });

  test('PR5 edits and deletes an option of an attribute', async ({ productPage, db, hubCompanyId, cleanup }) => {
    // SETUP: own select attribute with one option
    const slug = testName('attr_opt');
    cleanup.add('delete the test attribute', () => deleteAttributeBySlug(db.hub, hubCompanyId, slug));
    await productPage.openCreateAttributeForm();
    await productPage.input('Name *').fill(slug);
    await productPage.input('Slug *').fill(slug);
    await productPage.choose('Data type', 'Select');
    await productPage.choose('Level', 'Product');
    await productPage.page.locator('main').getByRole('button', { name: 'Create attribute' }).click();
    await expect.poll(() => findAttributeBySlug(db.hub, hubCompanyId, slug), { message: `attribute ${slug}` }).toBeTruthy();
    const attribute = (await findAttributeBySlug(db.hub, hubCompanyId, slug))!;
    await productPage.openAttribute(attribute.id);
    await productPage.input('Value').fill('qa_option');
    await productPage.input('Label').fill('QA option');
    await productPage.page.getByRole('button', { name: 'Add option' }).click();
    await expect.poll(() => getAttributeOptionPairs(db.hub, attribute.id), { message: 'options' }).toEqual(['qa-option|QA option']);

    // ACTION: option row → pencil → new label → save
    // the row's own buttons have no name: up, down, edit, delete; in edit mode: save, cancel
    const optionRow = productPage.page.getByText('QA option', { exact: true }).locator('xpath=ancestor::div[./button][1]');
    await optionRow.locator(':scope > button').nth(2).click();
    // the edit row comes first, the "new option" form below it has the same labels
    const editLabel = productPage.page.getByRole('textbox', { name: 'Label' }).first();
    await expect(productPage.page.getByRole('textbox', { name: 'Value' }).first()).toHaveValue('qa-option');
    await editLabel.fill('QA option edited');
    await editLabel.locator('xpath=ancestor::div[./button][1]').locator(':scope > button').first().click();

    // CHECK: label saved
    await expect(productPage.page.getByText('QA option edited', { exact: true })).toBeVisible();
    await expect.poll(() => getAttributeOptionPairs(db.hub, attribute.id), { message: 'options after edit' }).toEqual(['qa-option|QA option edited']);

    // ACTION: trash
    await productPage.page.getByText('QA option edited', { exact: true }).locator('xpath=ancestor::div[./button][1]').locator(':scope > button').nth(3).click();

    // CHECK: option removed
    await expect(productPage.page.getByText('QA option edited', { exact: true })).toBeHidden();
    await expect.poll(() => getAttributeOptionPairs(db.hub, attribute.id), { message: 'options after delete' }).toEqual([]);
  });

  test('PR6 an attribute with a slug that is already used is refused', async ({ productPage, db, hubCompanyId }) => {
    // SETUP
    const existing = await findRealAttribute(db.hub, hubCompanyId);
    test.skip(!existing, 'no real attribute');
    await productPage.openCreateAttributeForm();

    // ACTION: same slug → Create attribute
    await productPage.input('Name *').fill(testName('attr_dup'));
    await productPage.input('Slug *').fill(existing!.slug);
    await productPage.choose('Data type', 'Select');
    await productPage.choose('Level', 'Product');
    const answer = productPage.page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('attribute'));
    await productPage.page.locator('main').getByRole('button', { name: 'Create attribute' }).click();

    // CHECK: API refuses, error shown, form stays open
    expect((await answer).status(), 'create answer').toBeGreaterThanOrEqual(400);
    await expect(productPage.page.getByText(/slug has already been taken/i)).toBeVisible();
    await expect(productPage.page).toHaveURL(/\/product-attributes\/create/);
  });
});
