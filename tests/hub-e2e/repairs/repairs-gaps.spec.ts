import { test, expect } from '@fixtures';
import { countAssets, getLastJobAndUploadIds, hasNewDataExport } from '@db/queries/hub/assets';
import { findRepairPageData } from '@db/queries/hub/repairs-stores';

// Hub → Repairs: the cases that were missing - the repair page shows the asset, subscription and customer,
// list total and export. (Filters "New"/"Blocked" and repair questions were dropped by the owner.)
// Needs: an asset in 'to repair'.
// Changes data: starts one data export (job on queue 'data-export').
test.describe.configure({ mode: 'default' });

test.describe('Hub - repairs gaps', () => {
  test('RP2 the repair page shows the asset, its subscription and the customer', async ({ db, hubCompanyId, page }) => {
    // SETUP
    const repair = await findRepairPageData(db.hub, hubCompanyId);
    test.skip(!repair, "no asset in 'to repair'");
    test.info().annotations.push({ type: 'asset', description: `${repair!.serial_number} / ${repair!.subscription_id}` });

    // ACTION: the link of the repairs list = /repairs/<subscription id>?sku=<sku>
    await page.goto(`en/cms/repairs/${repair!.subscription_id}?sku=${encodeURIComponent(repair!.sku)}`);

    // CHECK: asset row with product, serial link, subscription link and "Start repair"
    const row = page.locator('tbody tr').filter({ has: page.locator(`a[href*="/assets/${repair!.serial_number}"]`) });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(repair!.product_name);
    await expect(row.locator(`a[href*="/subscriptions/${repair!.subscription_id}"]`)).toBeVisible();
    await expect(row.getByRole('button', { name: 'Start repair' })).toBeVisible();

    // CHECK: "Customer details" shows the subscription's customer
    await expect(page.getByRole('heading', { name: 'Customer details' })).toBeVisible();
    await expect(page.getByRole('row', { name: `Email: ${repair!.email}` })).toBeVisible();
    await expect(page.getByRole('row', { name: /^Surname:/ })).toHaveText(`Surname:${repair!.last_name ?? ''}`);
  });

  test('RP4 list total matches the database and the export is started', async ({ db, hubCompanyId, hubListPage, assetPage }) => {
    // SETUP
    const expected = await countAssets(db.hub, hubCompanyId, 'to repair');
    const before = await getLastJobAndUploadIds(db.hub);

    // ACTION + CHECK: list without the default date filter
    await hubListPage.open('repairs', { created_at: '' });
    await hubListPage.expectTotal(expected, "assets in 'to repair'");

    // ACTION: Export → Export
    await assetPage.exportList();

    // CHECK: a data-export job (or its upload) was created
    await expect
      .poll(() => hasNewDataExport(db.hub, hubCompanyId, Number(before.job_id ?? 0), Number(before.upload_id ?? 0)), { message: 'data export started' })
      .toBe(true);
  });
});
