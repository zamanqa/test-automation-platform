import { test, expect } from '@fixtures';
import { testName } from '@data/random';
import {
  countAssets,
  countTrackingRows,
  findListAsset,
  findSkuForAssetCsv,
  getLastJobAndUploadIds,
  hasNewDataExport,
} from '@db/queries/hub/assets';
import { getLocationStatus } from '@db/queries/hub/product-trackings';

// Hub → Assets: list totals and search, asset page, CSV import, status changes, export.
// Needs: rented-out and in-stock assets, an active product variant with a SKU.
// Changes data: imports 2 qa_auto assets by CSV and changes only their status (real assets are only read).
test.describe.configure({ mode: 'default' });

test.describe('Hub - assets', () => {
  test('A1 list total and the "in stock" filter match the database', async ({ db, hubCompanyId, assetPage }) => {
    // SETUP
    const all = await countAssets(db.hub, hubCompanyId);
    const inStock = await countAssets(db.hub, hubCompanyId, 'in stock');

    // ACTION + CHECK: all assets (no date filter)
    await assetPage.openList();
    await expect.poll(() => assetPage.total(), { message: 'asset list total' }).toBe(all);

    // ACTION + CHECK: location status in stock
    await assetPage.openList({ location_status: 'in stock' });
    await expect.poll(() => assetPage.total(), { message: 'in-stock assets' }).toBe(inStock);
  });

  test('A2 search by serial number shows that asset', async ({ db, hubCompanyId, assetPage }) => {
    // SETUP
    const asset = await findListAsset(db.hub, hubCompanyId, 'in stock');
    test.skip(!asset, 'no in-stock asset');

    // ACTION
    await assetPage.openList();
    await assetPage.searchInput.fill(asset!.serial_number);

    // CHECK
    await expect.poll(() => assetPage.total(), { message: `search ${asset!.serial_number}` }).toBe(1);
    await expect(assetPage.rows.first()).toContainText(asset!.sku);
  });

  test('A3 A6 asset page of a rented-out asset shows its data and its status cannot be changed', async ({ db, hubCompanyId, assetPage, page }) => {
    // SETUP
    const asset = await findListAsset(db.hub, hubCompanyId, 'rented out');
    test.skip(!asset, 'no rented-out asset');
    test.info().annotations.push({ type: 'asset', description: asset!.serial_number });

    // ACTION
    await assetPage.openAsset(asset!.serial_number);

    // CHECK: status from the database is shown
    await expect(page.locator('main').getByText('rented out', { exact: true }).first()).toBeVisible();

    // CHECK: the status cannot be changed - the dialog only offers the current status
    await assetPage.openStatusList('rented out');
    await expect(assetPage.statusOptions()).toHaveText(['rented out']);
    test.info().annotations.push({
      type: 'INFO',
      description: 'menu item "Change asset status" stays enabled although the API says allow_status_change = false',
    });
  });

  test('A8 A7 A4 A5 imports 2 assets from CSV and changes their status', async ({ db, hubCompanyId, assetPage, page }) => {
    const product = await findSkuForAssetCsv(db.hub, hubCompanyId);
    const inStockSerial = testName('sn_csv');
    const toRepairSerial = testName('sn_csv');
    test.info().annotations.push({ type: 'serial numbers', description: `${inStockSerial}, ${toRepairSerial}` });

    await test.step('A8 import a CSV with an in-stock and a to-repair asset', async () => {
      const csv = [
        'sku,product_name,serial_number,status',
        `"${product.sku}","${product.title}",${inStockSerial},in stock`,
        `"${product.sku}","${product.title}",${toRepairSerial},to repair`,
      ].join('\n');
      await assetPage.openList();
      await assetPage.importCsv(`${inStockSerial}.csv`, csv);
      await expect(assetPage.dialog.getByText('Successfully requested!')).toBeVisible();

      await expect
        .poll(() => getLocationStatus(db.hub, inStockSerial), { message: `${inStockSerial} imported`, timeout: 60_000 })
        .toBe('in stock');
      await expect.poll(() => getLocationStatus(db.hub, toRepairSerial), { message: `${toRepairSerial} imported` }).toBe('to repair');
    });

    await test.step('A7 an in-stock asset offers in stock, bought out, removed and stolen', async () => {
      await assetPage.openAsset(inStockSerial);
      await assetPage.openStatusList('in stock');
      await expect(assetPage.statusOptions()).toHaveText(['in stock', 'bought out', 'removed', 'stolen']);
      await page.keyboard.press('Escape');
    });

    await test.step('A4 in stock → stolen → in stock', async () => {
      await assetPage.openAsset(inStockSerial);
      await assetPage.changeStatus('in stock', 'stolen');
      await expect.poll(() => getLocationStatus(db.hub, inStockSerial), { message: `${inStockSerial} status` }).toBe('stolen');

      await assetPage.openAsset(inStockSerial);
      await assetPage.changeStatus('stolen', 'in stock');
      await expect.poll(() => getLocationStatus(db.hub, inStockSerial), { message: `${inStockSerial} status` }).toBe('in stock');
    });

    await test.step('A5 to repair → bought out', async () => {
      await assetPage.openAsset(toRepairSerial);
      await assetPage.changeStatus('to repair', 'bought out');
      await expect.poll(() => getLocationStatus(db.hub, toRepairSerial), { message: `${toRepairSerial} status` }).toBe('bought out');
    });
  });

  test('A9 a CSV without the status column is refused', async ({ db, assetPage }) => {
    // SETUP
    const serial = testName('sn_csv_bad');
    const csv = ['sku,product_name,serial_number', `SKU1,Product,${serial}`].join('\n');

    // ACTION
    await assetPage.openList();
    await assetPage.importCsv(`${serial}.csv`, csv);

    // CHECK: error in the dialog, nothing imported
    await expect(assetPage.dialog.getByText('Empty or unrecognized format')).toBeVisible();
    expect(await countTrackingRows(db.hub, [serial])).toBe(0);
  });

  test('A10 export of the in-stock assets is started', async ({ db, hubCompanyId, assetPage }) => {
    // SETUP
    const before = await getLastJobAndUploadIds(db.hub);

    // ACTION
    await assetPage.openList({ location_status: 'in stock' });
    await assetPage.exportList();

    // CHECK: a data-export job (or its upload) was created
    await expect
      .poll(() => hasNewDataExport(db.hub, hubCompanyId, Number(before.job_id ?? 0), Number(before.upload_id ?? 0)), { message: 'data export started' })
      .toBe(true);
  });
});
