import type { Database } from '@db/connection';

/** Queries for the hub Assets tab. The list shows the latest product_trackings row per serial number. */

/** Number of assets in the list (latest row per serial), optionally only with one location status. */
export async function countAssets(hub: Database, companyId: string, status?: string): Promise<number> {
  const row = await hub.one<{ count: string }>(
    `SELECT COUNT(*) AS count FROM public.product_trackings pt
       JOIN public.distinct_product_trackings_view v ON v.id = pt.id
      WHERE pt.company_id = $1 AND ($2::text IS NULL OR pt.location_status = $2)`,
    [companyId, status ?? null],
  );
  return Number(row.count);
}

/** Newest asset (latest row per serial) with this status that is not qa_auto, or undefined. */
export function findListAsset(hub: Database, companyId: string, status: string) {
  return hub.maybeOne<{ serial_number: string; sku: string; product_name: string; location_status: string; subscription_id: string | null }>(
    `SELECT pt.serial_number, pt.sku, pt.product_name, pt.location_status, pt.subscription_id
       FROM public.product_trackings pt JOIN public.distinct_product_trackings_view v ON v.id = pt.id
      WHERE pt.company_id = $1 AND pt.location_status = $2 AND pt.serial_number NOT LIKE 'qa_auto%'
        AND pt.serial_number <> 'no-serial-number-found'
      ORDER BY pt.created_at DESC LIMIT 1`,
    [companyId, status],
  );
}

/** SKU and name of an active product variant (not qa_auto) to use in an asset CSV. Throws if none. */
export function findSkuForAssetCsv(hub: Database, companyId: string) {
  return hub.one<{ sku: string; title: string }>(
    `SELECT pv.sku, p.title FROM public.product_variants pv JOIN public.products p ON p.id = pv.product_id
      WHERE p.company_id = $1 AND p.active = true AND COALESCE(pv.sku, '') <> '' AND pv.sku NOT LIKE 'qa_auto%'
        AND COALESCE(p.title, '') <> '' AND p.title NOT LIKE 'qa_auto%'
      ORDER BY p.updated_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Number of product_trackings rows of these serial numbers. */
export async function countTrackingRows(hub: Database, serialNumbers: string[]): Promise<number> {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM public.product_trackings WHERE serial_number = ANY($1)', [serialNumbers]);
  return Number(row.count);
}

/** Highest jobs.id and uploads.id now (read before an export, then look for newer rows). */
export function getLastJobAndUploadIds(hub: Database) {
  return hub.one<{ job_id: string | null; upload_id: string | null }>(
    'SELECT (SELECT MAX(id) FROM public.jobs) AS job_id, (SELECT MAX(id) FROM public.uploads) AS upload_id',
  );
}

/** true when a data-export job or a company upload newer than these ids exists (the export was started). */
export async function hasNewDataExport(hub: Database, companyId: string, jobId: number, uploadId: number): Promise<boolean> {
  const row = await hub.one<{ found: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM public.jobs WHERE queue = 'data-export' AND id > $2)
         OR EXISTS (SELECT 1 FROM public.uploads WHERE company_id = $1 AND id > $3) AS found`,
    [companyId, jobId, uploadId],
  );
  return row.found;
}
