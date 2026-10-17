import { test, expect } from '@fixtures';
import { env } from '@config/env';
import { testName } from '@data/random';
import {
  countSites,
  countStores,
  countStoresWithName,
  deleteSitesByNameStart,
  deleteStoresWithName,
  findSiteByName,
  findStore,
  getPosIdentifier,
} from '@db/queries/hub/repairs-stores';

// Hub → Stores: stores list and search, "Create store" validation, POS login button, Sites tab create and edit.
// Store create / edit is not tested (a store cannot be deleted - owner). Sites have no delete in the hub UI.
// Changes data: creates and edits one site "qa_auto_site_…" (deleted again by cleanup).
test.describe.configure({ mode: 'default' });

test.describe('Hub - stores', () => {
  test('ST1 the stores list total matches the database and the search finds a store', async ({ db, hubCompanyId, hubListPage, page }) => {
    // SETUP
    const expected = await countStores(db.hub, hubCompanyId);
    const store = await findStore(db.hub, hubCompanyId);
    test.skip(!store, 'no store');

    // ACTION + CHECK: total
    await hubListPage.open('stores', {});
    await hubListPage.expectTotal(expected, 'stores of the company');

    // ACTION + CHECK: search by location id
    await page.locator('main input[placeholder="Search..."]').first().fill(store!.location_id);
    // the list shortens long location ids ("retailer-...57558920"), so check the name in the only row
    await hubListPage.expectTotal(1, `stores found for ${store!.location_id}`);
    await expect(page.locator('tbody tr').first()).toContainText(store!.name);
  });

  test('ST3 "Create store" refuses a location id with a space, empty address fields and a used location id', async ({ db, hubCompanyId, page, cleanup }) => {
    // SETUP
    const existing = await findStore(db.hub, hubCompanyId);
    test.skip(!existing, 'no store');
    const name = testName('store');
    cleanup.add('delete a store created by mistake', () => deleteStoresWithName(db.hub, hubCompanyId, name));
    const before = await countStores(db.hub, hubCompanyId);

    // ACTION: Create store → location id with a space, name and password, address empty → Submit
    await page.goto('en/cms/stores#stores');
    await page.getByRole('button', { name: 'Create store' }).click();
    const dialog = page.getByRole('dialog').last();
    await dialog.getByLabel('Location ID').fill('qa auto');
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Password').fill('qaAuto1234');
    await dialog.locator('[data-cy="btn-submit"]').click();

    // CHECK: field messages, nothing saved
    await expect(dialog.getByText('Only alphanumeric characters and dashes are allowed')).toBeVisible();
    await expect(dialog.getByText('Field is required')).toHaveCount(4);
    expect(await countStores(db.hub, hubCompanyId)).toBe(before);

    // ACTION: valid address, but the location id of an existing store
    await dialog.getByLabel('Location ID').fill(existing!.location_id);
    await dialog.getByLabel('Street').fill('Teststrasse 1');
    await dialog.getByLabel('Postal code').fill('10115');
    await dialog.getByLabel('City').fill('Berlin');
    await dialog.getByLabel('Country').click();
    await page.getByRole('option', { name: 'Germany', exact: true }).click();
    const answer = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/retailers'));
    await dialog.locator('[data-cy="btn-submit"]').click();

    // CHECK: the API refuses it and shows why, no store with the new name
    expect((await answer).status(), 'create answer').toBeGreaterThanOrEqual(400);
    await expect(dialog.getByText(/location id has already been taken/i)).toBeVisible();
    expect(await countStoresWithName(db.hub, hubCompanyId, name)).toBe(0);
  });

  test('ST6 "POS login" opens the POS login page for the store', async ({ db, hubCompanyId, hubListPage, page }) => {
    // SETUP
    const store = await findStore(db.hub, hubCompanyId);
    test.skip(!store, 'no store');

    // ACTION: search the store → POS login button of its row
    await hubListPage.open('stores', {});
    await page.locator('main input[placeholder="Search..."]').first().fill(store!.location_id);
    await hubListPage.expectTotal(1, `stores found for ${store!.location_id}`);
    const row = page.locator('tbody tr').first();
    await expect(row).toContainText(store!.name);
    const popup = page.waitForEvent('popup');
    await row.locator('[data-cy="store-action-pos-login"]').click();

    // CHECK: a new tab on <pos_settings.identifier>/en/auth/login with the store's location id
    const pos = await popup;
    const url = new URL(pos.url());
    const identifier = (await getPosIdentifier(db.hub, hubCompanyId))!;
    expect(url.origin, 'POS host = pos_settings.identifier').toBe(new URL(identifier.startsWith('http') ? identifier : `https://${identifier}`).origin);
    expect(url.pathname).toBe('/en/auth/login');
    expect(url.searchParams.get('location_id')).toBe(store!.location_id);
    test.info().annotations.push({ type: 'INFO', description: `POS of the company: ${url.origin} (dev POS in .env: ${env.pos.POS_URL})` });
    await pos.close();
  });

  test('ST7 Sites tab: list total, create a site and edit it', async ({ db, hubCompanyId, hubListPage, page, cleanup }) => {
    // SETUP
    const name = testName('site');
    cleanup.add('delete the test site', () => deleteSitesByNameStart(db.hub, hubCompanyId, name));
    const total = await countSites(db.hub, hubCompanyId);

    await test.step('list total', async () => {
      await page.goto('en/cms/stores#sites');
      await hubListPage.expectTotal(total, 'sites of the company');
    });

    await test.step('create', async () => {
      await page.getByRole('button', { name: 'Create site' }).click();
      const dialog = page.getByRole('dialog').last();
      await dialog.getByLabel('Name').fill(name);
      await dialog.getByLabel('Street').fill('Teststrasse 1');
      await dialog.getByLabel('Postal code').fill('10115');
      await dialog.getByLabel('City').fill('Berlin');
      await dialog.getByLabel('Country').click();
      await page.getByRole('option', { name: 'Germany', exact: true }).click();
      await dialog.locator('[data-cy="btn-submit"]').click();
      await expect(dialog.getByText('Successfully requested!')).toBeVisible();
      await dialog.locator('[data-cy="btn-close"]').click();
      await expect.poll(() => findSiteByName(db.hub, hubCompanyId, name), { message: `site ${name}` }).toBeTruthy();
      const site = (await findSiteByName(db.hub, hubCompanyId, name))!;
      expect(site.city).toBe('Berlin');
      expect(site.enabled).toBe(true);
    });

    await test.step('edit: new name and city (city: bug CIR-1598)', async () => {
      const row = page.locator('tbody tr').filter({ hasText: name }).first();
      await row.getByRole('button').last().click();
      await page.getByRole('menuitem', { name: 'Edit site' }).click();
      const dialog = page.getByRole('dialog').last();
      await dialog.getByLabel('Name').fill(`${name}_edited`);
      await dialog.getByLabel('City').fill('Hamburg');
      const update = page.waitForRequest((r) => r.method() === 'PUT' && r.url().includes('/sites/'));
      await dialog.locator('[data-cy="btn-submit"]').click();
      await expect(dialog.getByText('Successfully requested!')).toBeVisible();
      const sent = (await update).postDataJSON() as { address?: { city?: string } };
      const answer = await (await (await update).response())!.json();
      test.info().annotations.push({ type: 'PUT sites', description: `sent city ${sent.address?.city}, answer city ${answer?.address?.city}` });
      await expect.poll(() => findSiteByName(db.hub, hubCompanyId, `${name}_edited`), { message: 'site with the new name' }).toBeTruthy();
      expect((await findSiteByName(db.hub, hubCompanyId, `${name}_edited`))!.city, 'BUG CIR-1598: the new city is not saved').toBe('Hamburg');
    });
  });
});
