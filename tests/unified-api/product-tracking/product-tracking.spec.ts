import { test, expect } from '@fixtures';
import {
  findAsset,
  findAssetToRepair,
  findLatestRentedOutAsset,
  findRentedOutAssetOfActiveSubscription,
} from '@db/queries/hub/product-trackings';

// Unified API - /product-tracking (assets by serial number).
// Needs: rented-out assets of active subscriptions.
// Changes data: sends one asset to repair (its recurring payments are deleted),
// puts one 'to repair' asset back in stock.
// The stock test needs an asset in 'to repair'; the repair test before it creates one.
test.describe.configure({ mode: 'default' });

test.describe('Unified API - product tracking', () => {
  test('returns a list of tracked assets', async ({ unifiedApi }) => {
    // ACTION: GET /product-tracking
    const response = await unifiedApi.productTracking.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches an asset by serial number', async ({ unifiedApi, db }) => {
    // SETUP: newest asset with location_status 'rented out'
    const companyId = await unifiedApi.companyId();
    const asset = await findLatestRentedOutAsset(db.hub, companyId);

    // ACTION: GET /product-tracking/{serial_number}
    const response = await unifiedApi.productTracking.get(asset.serial_number);

    // CHECK: the API returns the same serial, and the row exists in the database
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('serial_number', asset.serial_number);
    expect(await findAsset(db.hub, companyId, asset.serial_number)).toBeDefined();
  });

  test('sends a rented-out asset to repair', async ({ unifiedApi, db }) => {
    // SETUP: rented-out asset that belongs to an ACTIVE subscription
    const companyId = await unifiedApi.companyId();
    const asset = await findRentedOutAssetOfActiveSubscription(db.hub, companyId);

    // ACTION: POST /product-tracking/{serial}/repair { delete_rps: true }
    const response = await unifiedApi.productTracking.repair(asset.serial_number);

    // CHECK: API message, and the asset's location_status in the database is now 'to repair'
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, message: 'Updated' });
    expect((await findAsset(db.hub, companyId, asset.serial_number))?.location_status).toBe('to repair');
  });

  test('puts an asset from repair back into stock', async ({ unifiedApi, db }) => {
    // SETUP: most recently updated asset in 'to repair' (the previous test just made one)
    const companyId = await unifiedApi.companyId();
    const asset = await findAssetToRepair(db.hub, companyId);
    expect(asset, 'Needs an asset in "to repair" (the repair test creates one)').toBeDefined();

    // ACTION: POST /product-tracking/{serial}/stock?do_not_restock=false { location: 'Berlin' }
    const response = await unifiedApi.productTracking.stock(asset!.serial_number);

    // CHECK: this endpoint answers with a list → first entry; database status is 'in stock'
    expect(response.status()).toBe(200);
    expect((await response.json())[0]).toMatchObject({ success: true, message: 'Updated' });
    expect((await findAsset(db.hub, companyId, asset!.serial_number))?.location_status).toBe('in stock');
  });
});
