import { test, expect } from '@fixtures';
import { testName } from '@data/random';
import {
  clearCacheTables,
  countAttributes,
  countAssignAttributeJobs,
  countAttributeValues,
  findAttributeBySlug,
  findAttributeOptions,
  findNewestAttributeBySlug,
} from '@db/queries/hub/products';

/**
 * WHAT:   Hub UI → Products → Attributes tab: list, create, edit, add an option, "Assign to all",
 *         reset attribute cache, delete, and the product sync (last test).
 * NEEDS:  nothing — the attribute is created by the test.
 * CHANGES DATA: yes — creates attribute "qa_auto_attr_…", queues "assign to all" (job, default queue), then deletes it
 *         (the delete removes its values too); empties the cache tables and starts a product sync (last test).
 * productPage methods ← src/pages/hub/ProductPage.ts
 */
test.describe.configure({ mode: 'default' });

const SLUG_START = 'qa_auto_attr';

test.describe('Hub - product attributes', () => {
  test('shows the attribute list with its columns', async ({ productPage }) => {
    // ACTION: open Products → Attributes
    await productPage.openList('Attributes');

    // CHECK: the columns and the buttons of the tab
    for (const column of ['Name', 'Slug', 'Data type', 'Level', 'Filterable', 'Visible']) {
      await expect(productPage.columnHeader(column)).toBeVisible();
    }
    await expect(productPage.page.getByRole('button', { name: 'Create attribute' })).toBeVisible();
    await expect(productPage.page.getByRole('button', { name: 'Reset attribute cache' })).toBeVisible();
  });

  test('"Create attribute" needs a name and a slug', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: number of attributes ← hub db
    const before = await countAttributes(db.hub, hubCompanyId);
    await productPage.openCreateAttributeForm();

    // ACTION: Create attribute with an empty form
    await productPage.page.locator('main').getByRole('button', { name: 'Create attribute' }).click();

    // CHECK: no attribute was created
    await productPage.waitUntilLoaded();
    expect(await countAttributes(db.hub, hubCompanyId), 'number of attributes after an empty Create').toBe(before);
  });

  test('creates a select attribute on product level', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: new name = slug (prefix qa_auto_)
    const slug = testName('attr');
    test.info().annotations.push({ type: 'attribute', description: slug });
    await productPage.openCreateAttributeForm();

    // ACTION: name, slug, data type Select, level Product, Filterable on → Create attribute
    await productPage.input('Name *').fill(slug);
    await productPage.input('Slug *').fill(slug);
    await productPage.choose('Data type', 'Select');
    await productPage.choose('Level', 'Product');
    await productPage.page.getByRole('switch', { name: 'Filterable' }).click();
    await productPage.page.locator('main').getByRole('button', { name: 'Create attribute' }).click();

    // CHECK: the form closes and product_attribute_definitions has the row ← hub db
    await expect(productPage.page).not.toHaveURL(/\/product-attributes\/create/, { timeout: 30_000 });
    await expect.poll(() => findAttributeBySlug(db.hub, hubCompanyId, slug), { message: `attribute ${slug} in the DB` }).toBeTruthy();
    const attribute = (await findAttributeBySlug(db.hub, hubCompanyId, slug))!;
    expect(attribute.name).toBe(slug);
    expect(attribute.data_type).toBe('select');
    expect(attribute.level).toBe('product');
    expect(attribute.is_filterable, 'filterable').toBe(true);
    expect(attribute.is_visible, 'visible (default on)').toBe(true);
  });

  test('edits the description of the attribute', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: newest qa_auto attribute ← hub db
    const attribute = await findNewestAttributeBySlug(db.hub, hubCompanyId, SLUG_START);
    test.skip(!attribute, 'No qa_auto_attr yet — run "creates a select attribute" first');
    const description = `QA automation ${Date.now()}`;
    await productPage.openAttribute(attribute!.id);
    const update = productPage.page.getByRole('button', { name: 'Update attribute' });
    await expect(update, '"Update attribute" before any change').toBeDisabled();

    // ACTION: Description → Update attribute
    await productPage.input('Description').fill(description);
    await expect(update).toBeEnabled();
    await update.click();

    // CHECK: product_attribute_definitions.description ← hub db
    await expect.poll(async () => (await findAttributeBySlug(db.hub, hubCompanyId, attribute!.slug))?.description, { message: 'description' }).toBe(description);
  });

  test('adds an option to the attribute', async ({ productPage, db, hubCompanyId }) => {
    // SETUP
    const attribute = await findNewestAttributeBySlug(db.hub, hubCompanyId, SLUG_START);
    test.skip(!attribute, 'No qa_auto_attr yet');
    await productPage.openAttribute(attribute!.id);

    // ACTION: Options → Value + Label → Add option (saved at once; the hub turns the value into "qa-value-1")
    await productPage.input('Value').fill('qa_value_1');
    await productPage.input('Label').fill('QA value 1');
    await productPage.page.getByRole('button', { name: 'Add option' }).click();

    // CHECK: the option is listed, and product_attribute_options has it ← hub db
    await expect(productPage.page.getByText('QA value 1(qa-value-1)')).toBeVisible();
    await expect.poll(async () => (await findAttributeOptions(db.hub, attribute!.id)).map((o) => o.label), { message: 'option labels' }).toContain('QA value 1');
  });

  test('"Assign to all" queues the assignment to every product', async ({ productPage, db, hubCompanyId }) => {
    // SETUP: attribute + number of queued assign jobs ← hub db
    const attribute = await findNewestAttributeBySlug(db.hub, hubCompanyId, SLUG_START);
    test.skip(!attribute, 'No qa_auto_attr yet');
    const jobsBefore = await countAssignAttributeJobs(db.hub);
    await productPage.openList('Attributes');

    // ACTION: row menu → Assign to all → Value = first option → Confirm
    await productPage.assignToAll(attribute!.name);

    // CHECK: message "Attribute assignment queued. …" and one more AssignAttributeToAllJob in public.jobs ← hub db.
    // The values themselves are written later by the "default" queue worker (every 30 min on dev) → not waited for.
    await expect(productPage.message(/Attribute assignment queued/)).toBeVisible();
    await expect.poll(() => countAssignAttributeJobs(db.hub), { message: 'queued assign jobs' }).toBe(jobsBefore + 1);
  });

  test('"Reset attribute cache" queues a rebuild', async ({ productPage }) => {
    // SETUP
    await productPage.openList('Attributes');

    // ACTION: Reset attribute cache
    await productPage.page.getByRole('button', { name: 'Reset attribute cache' }).click();

    // CHECK: message "Attribute cache rebuild queued. …"
    await expect(productPage.message(/Attribute cache rebuild queued/)).toBeVisible();
  });

  test('deletes the attribute', async ({ productPage, db, hubCompanyId }) => {
    // SETUP
    const attribute = await findNewestAttributeBySlug(db.hub, hubCompanyId, SLUG_START);
    test.skip(!attribute, 'No qa_auto_attr yet');
    await productPage.openList('Attributes');

    // ACTION: row menu → Delete attribute → confirm
    await productPage.deleteAttribute(attribute!.name);

    // CHECK: the attribute and its values are gone ← hub db
    await expect.poll(() => findAttributeBySlug(db.hub, hubCompanyId, attribute!.slug), { message: 'attribute deleted' }).toBeUndefined();
    expect(await countAttributeValues(db.hub, attribute!.id), 'values of the deleted attribute').toBe(0);
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
