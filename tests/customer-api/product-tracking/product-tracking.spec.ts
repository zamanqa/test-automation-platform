import { test, expect } from '@fixtures';
import {
  findAsset,
  findAssetToRepair,
  findLatestRentedOutAsset,
  findRentedOutAssetOfActiveSubscription,
} from '@db/queries/hub/product-trackings';

// Customer API - /product-tracking.
// Changes data: sends one asset to repair and puts one back into stock.
// The stock test needs an asset in 'to repair'; the repair test before it creates one.
test.describe.configure({ mode: 'default' });

test.describe('Customer API - product tracking', () => {
  test('returns a list of tracked assets', async ({ customerApi }) => {
    // ACTION: GET /product-tracking
    const response = await customerApi.productTracking.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches an asset by serial number', async ({ customerApi, db }) => {
    // SETUP: newest rented-out asset
    const asset = await findLatestRentedOutAsset(db.hub, customerApi.companyId);

    // ACTION: GET /product-tracking/{serial}
    const response = await customerApi.productTracking.get(asset.serial_number);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('serial_number', asset.serial_number);
    expect(await findAsset(db.hub, customerApi.companyId, asset.serial_number)).toBeDefined();
  });

  test('sends a rented-out asset to repair', async ({ customerApi, db }) => {
    // SETUP: rented-out asset of an active subscription
    const asset = await findRentedOutAssetOfActiveSubscription(db.hub, customerApi.companyId);

    // ACTION: POST /product-tracking/{serial}/repair
    const response = await customerApi.productTracking.repair(asset.serial_number);

    // CHECK: location_status in the database becomes 'to repair'
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, message: 'Updated' });
    expect((await findAsset(db.hub, customerApi.companyId, asset.serial_number))?.location_status).toBe('to repair');
  });

  test('puts an asset from repair back into stock', async ({ customerApi, db }) => {
    // SETUP: an asset in 'to repair' (created by the previous test)
    const asset = await findAssetToRepair(db.hub, customerApi.companyId);
    expect(asset, 'Needs an asset in "to repair" (the repair test creates one)').toBeDefined();

    // ACTION: POST /product-tracking/{serial}/stock
    const response = await customerApi.productTracking.stock(asset!.serial_number);

    // CHECK: this endpoint answers with a list; the database status is 'in stock'
    expect(response.status()).toBe(200);
    expect((await response.json())[0]).toMatchObject({ success: true, message: 'Updated' });
    expect((await findAsset(db.hub, customerApi.companyId, asset!.serial_number))?.location_status).toBe('in stock');
  });
});
