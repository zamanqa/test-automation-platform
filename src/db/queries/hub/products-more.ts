import type { Database } from '@db/connection';

/** Queries for the extra hub product tests (SKU validation, bulk switches, variant duration, attribute options). */

/** SKU of the newest real (not qa_auto) product of the company, or undefined. */
export function findRealProductSku(hub: Database, companyId: string) {
  return hub.maybeOne<{ sku: string }>(
    `SELECT sku FROM public.products
      WHERE company_id = $1 AND COALESCE(sku, '') <> '' AND sku NOT ILIKE 'qa_auto%' AND title NOT ILIKE 'qa_auto%'
      ORDER BY id DESC LIMIT 1`,
    [companyId],
  );
}

/** Number of products of the company with this SKU. */
export async function countProductsWithSku(hub: Database, companyId: string, sku: string): Promise<number> {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM public.products WHERE company_id = $1 AND sku = $2', [companyId, sku]);
  return Number(row.count);
}

/** Number of products of the company with exactly this title. */
export async function countProductsWithTitle(hub: Database, companyId: string, title: string): Promise<number> {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM public.products WHERE company_id = $1 AND title = $2', [companyId, title]);
  return Number(row.count);
}

/** Deletes products of the company with this (qa_auto) title and their variants (cleanup of a wrongly created product). */
export async function deleteProductsWithTitle(hub: Database, companyId: string, title: string) {
  await hub.query('DELETE FROM public.product_variants WHERE product_id IN (SELECT id FROM public.products WHERE company_id = $1 AND title = $2)', [companyId, title]);
  await hub.query('DELETE FROM public.products WHERE company_id = $1 AND title = $2', [companyId, title]);
}

/** allow_order_create of a product. */
export async function getAllowOrderCreate(hub: Database, productId: string): Promise<boolean> {
  const row = await hub.one<{ allow_order_create: boolean }>('SELECT allow_order_create FROM public.products WHERE id = $1', [productId]);
  return row.allow_order_create;
}

/** Writes allow_order_create back (cleanup). */
export function setAllowOrderCreate(hub: Database, productId: string, value: boolean) {
  return hub.query('UPDATE public.products SET allow_order_create = $2 WHERE id = $1', [productId, value]);
}

/** duration of a variant. */
export async function getVariantDuration(hub: Database, variantId: string): Promise<number> {
  const row = await hub.one<{ duration: number }>('SELECT duration FROM public.product_variants WHERE id = $1', [variantId]);
  return Number(row.duration);
}

/** Writes the duration of a variant back (cleanup). */
export function setVariantDuration(hub: Database, variantId: string, duration: number) {
  return hub.query('UPDATE public.product_variants SET duration = $2 WHERE id = $1', [variantId, duration]);
}

/** Options of an attribute as "value|label" texts, in list order. */
export async function getAttributeOptionPairs(hub: Database, attributeId: string): Promise<string[]> {
  const rows = await hub.query<{ pair: string }>(
    `SELECT value || '|' || label AS pair FROM public.product_attribute_options WHERE attribute_definition_id = $1 ORDER BY id`,
    [attributeId],
  );
  return rows.map((r) => r.pair);
}

/** Deletes an attribute of the company by slug with its options and values (cleanup). */
export async function deleteAttributeBySlug(hub: Database, companyId: string, slug: string) {
  const rows = await hub.query<{ id: string }>('SELECT id FROM public.product_attribute_definitions WHERE company_id = $1 AND slug = $2', [companyId, slug]);
  for (const row of rows) {
    await hub.query('DELETE FROM public.product_attribute_values WHERE attribute_definition_id = $1', [row.id]);
    await hub.query('DELETE FROM public.product_attribute_options WHERE attribute_definition_id = $1', [row.id]);
    await hub.query('DELETE FROM public.product_attribute_definitions WHERE id = $1', [row.id]);
  }
}

/** Name and slug of the newest real (not qa_auto) attribute of the company, or undefined. */
export function findRealAttribute(hub: Database, companyId: string) {
  return hub.maybeOne<{ name: string; slug: string }>(
    `SELECT name, slug FROM public.product_attribute_definitions
      WHERE company_id = $1 AND slug NOT ILIKE 'qa_auto%' AND slug NOT ILIKE 'qa-auto%'
      ORDER BY id DESC LIMIT 1`,
    [companyId],
  );
}
