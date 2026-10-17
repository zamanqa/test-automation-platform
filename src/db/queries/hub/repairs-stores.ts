import type { Database } from '@db/connection';

/** Queries for the extra hub Repairs and Stores tests. */

/** Newest asset whose latest tracking row is 'to repair', with its subscription and customer, or undefined. */
export function findRepairPageData(hub: Database, companyId: string) {
  return hub.maybeOne<{ serial_number: string; sku: string; product_name: string; subscription_id: string; customer_id: string; email: string; last_name: string | null }>(
    `SELECT pt.serial_number, pt.sku, pt.product_name, pt.subscription_id, s.customer_id, c.email, c.last_name
       FROM public.product_trackings pt
       JOIN public.subscriptions s ON s.subscription_id = pt.subscription_id AND s.company_id = pt.company_id
       JOIN public.customers c ON c.uid = s.customer_id
      WHERE pt.company_id = $1 AND pt.location_status = 'to repair' AND COALESCE(pt.serial_number, '') <> ''
        AND pt.serial_number NOT LIKE 'qa_auto%' AND COALESCE(pt.sku, '') <> ''
        AND pt.id = (SELECT MAX(x.id) FROM public.product_trackings x WHERE x.company_id = pt.company_id AND x.serial_number = pt.serial_number)
      ORDER BY pt.id DESC LIMIT 1`,
    [companyId],
  );
}

/** Number of stores (retailers) of the company that are not deleted. */
export async function countStores(hub: Database, companyId: string): Promise<number> {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM public.retailers WHERE company_id = $1 AND deleted_at IS NULL', [companyId]);
  return Number(row.count);
}

/** Newest real (not qa_auto) store with a location id and password, or undefined. */
export function findStore(hub: Database, companyId: string) {
  return hub.maybeOne<{ location_id: string; name: string }>(
    `SELECT location_id, name FROM public.retailers
      WHERE company_id = $1 AND deleted_at IS NULL AND COALESCE(location_id, '') <> '' AND location_id NOT ILIKE 'qa%auto%'
        AND COALESCE(password, '') <> ''
      ORDER BY created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Number of stores of the company with this name (any state). */
export async function countStoresWithName(hub: Database, companyId: string, name: string): Promise<number> {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM public.retailers WHERE company_id = $1 AND name = $2', [companyId, name]);
  return Number(row.count);
}

/** Deletes stores of the company with this (qa_auto) name (cleanup in case a validation test created one). */
export function deleteStoresWithName(hub: Database, companyId: string, name: string) {
  return hub.query('DELETE FROM public.retailers WHERE company_id = $1 AND name = $2', [companyId, name]);
}

/** Number of sites of the company that are not deleted. */
export async function countSites(hub: Database, companyId: string): Promise<number> {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM public.sites WHERE company_id = $1 AND deleted_at IS NULL', [companyId]);
  return Number(row.count);
}

/** A site of the company by name, with its address city, or undefined. */
export function findSiteByName(hub: Database, companyId: string, name: string) {
  return hub.maybeOne<{ id: string; name: string; enabled: boolean; city: string | null; deleted_at: string | null }>(
    `SELECT s.id, s.name, s.enabled, a.city, s.deleted_at
       FROM public.sites s LEFT JOIN public.addresses a ON a.address_id = s.address_id
      WHERE s.company_id = $1 AND s.name = $2
      ORDER BY s.id DESC LIMIT 1`,
    [companyId, name],
  );
}

/** Deletes sites of the company whose name starts with this text, with their addresses (cleanup). */
export async function deleteSitesByNameStart(hub: Database, companyId: string, nameStart: string) {
  const rows = await hub.query<{ id: string; address_id: string | null }>('SELECT id, address_id FROM public.sites WHERE company_id = $1 AND name LIKE $2', [
    companyId,
    `${nameStart}%`,
  ]);
  for (const row of rows) {
    await hub.query('DELETE FROM public.sites WHERE id = $1', [row.id]);
    if (row.address_id) await hub.query('DELETE FROM public.addresses WHERE address_id = $1 AND company_id = $2', [row.address_id, companyId]);
  }
}

/** POS address set for the company (pos_settings.identifier) - the hub's "POS login" opens it, or undefined. */
export async function getPosIdentifier(hub: Database, companyId: string): Promise<string | undefined> {
  const row = await hub.maybeOne<{ identifier: string | null }>('SELECT identifier FROM public.pos_settings WHERE company_id = $1', [companyId]);
  return row?.identifier ?? undefined;
}
