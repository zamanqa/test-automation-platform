import type { Database } from '@db/connection';

/** Queries on retailers. */

export type RetailerRow = { id: string; retailer_id: string; location_id: string; name: string; enabled: boolean };

const COLUMNS = 'id, retailer_id, location_id, name, enabled';

/** Newest retailer of the company. Throws if none. */
export function findLatestRetailer(hub: Database, companyId: string) {
  return hub.one<RetailerRow>(
    `SELECT ${COLUMNS} FROM public.retailers WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Retailer by location_id, or undefined. */
export function findRetailerByLocation(hub: Database, companyId: string, locationId: string) {
  return hub.maybeOne<RetailerRow>(
    `SELECT ${COLUMNS} FROM public.retailers WHERE company_id = $1 AND location_id = $2`,
    [companyId, locationId],
  );
}

/** By retailer_id, which is the `id` the API returns. */
export function findRetailer(hub: Database, companyId: string, retailerId: string) {
  return hub.maybeOne<RetailerRow>(
    `SELECT ${COLUMNS} FROM public.retailers WHERE company_id = $1 AND retailer_id = $2`,
    [companyId, retailerId],
  );
}
