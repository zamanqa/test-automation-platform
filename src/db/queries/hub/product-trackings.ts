import type { Database } from '@db/connection';

// USED BY (files that import this one):
//   tests/customer-api/product-tracking/product-tracking.spec.ts
//   tests/hub-e2e/returns-and-repairs/return-and-repair.spec.ts
//   tests/unified-api/product-tracking/product-tracking.spec.ts

/** Queries on product_trackings (assets with serial numbers). */

export type ProductTrackingRow = {
  serial_number: string;
  product_name: string;
  location_status: string;
  location: string | null;
  subscription_id: string | null;
};

const COLUMNS = 'pt.serial_number, pt.product_name, pt.location_status, pt.location, pt.subscription_id';

/** Latest asset currently rented out. */
export function findLatestRentedOutAsset(hub: Database, companyId: string) {
  return hub.one<ProductTrackingRow>(
    `SELECT ${COLUMNS} FROM public.product_trackings pt
      WHERE pt.company_id = $1 AND pt.location_status = 'rented out'
      ORDER BY pt.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Latest rented-out asset with a serial number that belongs to an active subscription. */
export function findRentedOutAssetOfActiveSubscription(hub: Database, companyId: string) {
  return hub.one<ProductTrackingRow>(
    `SELECT ${COLUMNS}
       FROM public.product_trackings pt
       JOIN public.subscriptions s
         ON s.subscription_id = pt.subscription_id AND s.company_id = pt.company_id AND s.status = 'active'
      WHERE pt.company_id = $1
        AND pt.location_status = 'rented out'
        AND pt.serial_number IS NOT NULL AND pt.serial_number != ''
        AND pt.subscription_id IS NOT NULL
      ORDER BY pt.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Most recently updated asset waiting for repair. */
export function findAssetToRepair(hub: Database, companyId: string) {
  return hub.maybeOne<ProductTrackingRow>(
    `SELECT ${COLUMNS} FROM public.product_trackings pt
      WHERE pt.company_id = $1 AND pt.location_status = 'to repair'
        AND pt.serial_number IS NOT NULL AND pt.serial_number != ''
      ORDER BY pt.updated_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Latest location status of an asset, any company. */
export async function getLocationStatus(hub: Database, serialNumber: string): Promise<string | undefined> {
  const row = await hub.maybeOne<{ location_status: string }>(
    'SELECT location_status FROM public.product_trackings WHERE serial_number = $1 ORDER BY created_at DESC LIMIT 1',
    [serialNumber],
  );
  return row?.location_status;
}

/** Latest tracking row of a serial number in the company, or undefined. `.location_status` = where the asset is. */
export function findAsset(hub: Database, companyId: string, serialNumber: string) {
  return hub.maybeOne<ProductTrackingRow>(
    `SELECT ${COLUMNS} FROM public.product_trackings pt
      WHERE pt.company_id = $1 AND pt.serial_number = $2
      ORDER BY pt.updated_at DESC LIMIT 1`,
    [companyId, serialNumber],
  );
}
