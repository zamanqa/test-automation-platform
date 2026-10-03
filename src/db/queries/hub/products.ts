import type { Database } from '@db/connection';

/** Queries on products and product_variants. */

export type SubscriptionVariantRow = {
  variant_id: string;
  product_id: string;
  shop_variant_id: string;
  sku: string;
  variant_name: string;
  price: string;
  product_name: string;
};

/** Newest active product of the company. Throws if none. */
export function findLatestActiveProduct(hub: Database, companyId: string) {
  return hub.one<{ id: string; title: string; sku: string }>(
    `SELECT id, title, sku FROM public.products
      WHERE company_id = $1 AND active = true
      ORDER BY created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Newest active variant (with its product_id). Throws if none. */
export function findLatestActiveVariant(hub: Database, companyId: string) {
  return hub.one<{ id: string; product_id: string; title: string; sku: string }>(
    `SELECT pv.id, pv.product_id, pv.title, pv.sku
       FROM public.product_variants pv
       JOIN public.products pr ON pr.id = pv.product_id
      WHERE pv.company_id = $1 AND pv.active = true
      ORDER BY pv.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Variant by id (incl. stock), or undefined. */
export function findVariant(hub: Database, companyId: string, variantId: string | number) {
  return hub.maybeOne<{ id: string; product_id: string; title: string; sku: string; stock: number }>(
    'SELECT id, product_id, title, sku, stock FROM public.product_variants WHERE company_id = $1 AND id = $2',
    [companyId, variantId],
  );
}

/** Latest variant with stock; active only by default (the Customer API tests do not filter). */
export function findInStockVariant(hub: Database, companyId: string, { activeOnly = true } = {}) {
  return hub.one<{ variant_id: string; title: string; sku: string; product_id: string }>(
    `SELECT pv.id AS variant_id, pv.title, pv.sku, pv.product_id
       FROM public.product_variants pv
       JOIN public.products p ON p.id = pv.product_id AND p.company_id = pv.company_id
      WHERE pv.company_id = $1 AND pv.stock > 0 ${activeOnly ? 'AND pv.active = true' : ''}
      ORDER BY pv.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Most recently created variant, active or not. */
export function findNewestVariant(hub: Database, companyId: string) {
  return hub.one<{ id: string; product_id: string; title: string; sku: string }>(
    `SELECT id, product_id, title, sku FROM public.product_variants
      WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Product by id, or undefined. */
export function findProduct(hub: Database, companyId: string, productId: string | number) {
  return hub.maybeOne<{ id: string; title: string; sku: string; stock: number }>(
    'SELECT id, title, sku, stock FROM public.products WHERE company_id = $1 AND id = $2',
    [companyId, productId],
  );
}

/** Latest active variant of an active product that can be sold as a subscription. */
export function findSubscriptionVariant(hub: Database, companyId: string) {
  return hub.one<SubscriptionVariantRow>(
    `SELECT pv.id AS variant_id, pv.product_id, pv.shop_variant_id, pv.sku, pv.title AS variant_name,
            pv.price, p.title AS product_name
       FROM public.product_variants pv
       JOIN public.products p ON p.id = pv.product_id
      WHERE pv.company_id = $1
        AND pv.subscription_item = true
        AND pv.active = true
        AND p.active = true
      ORDER BY pv.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

// ---------- Hub UI → Products page (tests/hub-e2e/products/*) ----------

export type ProductRow = {
  id: string;
  title: string;
  sku: string;
  type: string | null;
  active: boolean;
  allow_order_create: boolean;
  msrp: number;
  purchase_price: number;
  buyout_retail_price: number;
  product_collection_id: string | null;
  title_translations: Record<string, string> | null;
};

const PRODUCT_COLUMNS = `id, title, sku, type, active, allow_order_create, msrp, purchase_price, buyout_retail_price,
            product_collection_id, title_translations`;

/** Product by SKU (all columns the Products page shows), or undefined. */
export function findProductBySku(hub: Database, companyId: string, sku: string) {
  return hub.maybeOne<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM public.products WHERE company_id = $1 AND sku = $2 ORDER BY id DESC LIMIT 1`,
    [companyId, sku],
  );
}

/** Product by id (all columns the Products page shows), or undefined. */
export function findProductById(hub: Database, companyId: string, productId: string) {
  return hub.maybeOne<ProductRow>(`SELECT ${PRODUCT_COLUMNS} FROM public.products WHERE company_id = $1 AND id = $2`, [companyId, productId]);
}

/** Newest product whose title starts with the text (e.g. 'qa_auto_hub_product'), or undefined. */
export function findNewestProductByTitle(hub: Database, companyId: string, titleStart: string) {
  return hub.maybeOne<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM public.products WHERE company_id = $1 AND title LIKE $2 ORDER BY id DESC LIMIT 1`,
    [companyId, `${titleStart}%`],
  );
}

/** Newest inactive product, or undefined. */
export function findInactiveProduct(hub: Database, companyId: string) {
  return hub.maybeOne<{ id: string }>(
    'SELECT id FROM public.products WHERE company_id = $1 AND active = false ORDER BY id DESC LIMIT 1',
    [companyId],
  );
}

/** Whether a product is active (true/false), or undefined if not found. */
export async function isProductActive(hub: Database, companyId: string, productId: string) {
  const row = await hub.maybeOne<{ active: boolean }>('SELECT active FROM public.products WHERE company_id = $1 AND id = $2', [companyId, productId]);
  return row?.active;
}

/** Number of products of the company. */
export async function countProducts(hub: Database, companyId: string) {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM public.products WHERE company_id = $1', [companyId]);
  return Number(row.count);
}

export type VariantRow = {
  id: string;
  product_id: string;
  title: string;
  sku: string;
  price: number;
  buyout_retail_price: number;
  subscription_extension_price: number;
  stock: number;
  duration: number;
  prepaid_duration: number;
  frequency: string | null;
  subscription_item: boolean;
  active: boolean;
};

/** All variants of a product (oldest first). */
export function findVariantsOfProduct(hub: Database, companyId: string, productId: string) {
  return hub.query<VariantRow>(
    `SELECT id, product_id, title, sku, price, buyout_retail_price, subscription_extension_price, stock, duration,
            prepaid_duration, frequency, subscription_item, active
       FROM public.product_variants
      WHERE company_id = $1 AND product_id = $2
      ORDER BY id`,
    [companyId, productId],
  );
}

// ---------- product attributes ----------

export type AttributeRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  data_type: string;
  level: string;
  is_filterable: boolean;
  is_visible: boolean;
  is_required: boolean;
};

/** Attribute definition by slug, or undefined. */
export function findAttributeBySlug(hub: Database, companyId: string, slug: string) {
  return hub.maybeOne<AttributeRow>(
    `SELECT id, name, slug, description, data_type, level, is_filterable, is_visible, is_required
       FROM public.product_attribute_definitions
      WHERE company_id = $1 AND slug = $2`,
    [companyId, slug],
  );
}

/** Newest attribute whose slug starts with the text (e.g. 'qa_auto_'), or undefined. */
export function findNewestAttributeBySlug(hub: Database, companyId: string, slugStart: string) {
  return hub.maybeOne<AttributeRow>(
    `SELECT id, name, slug, description, data_type, level, is_filterable, is_visible, is_required
       FROM public.product_attribute_definitions
      WHERE company_id = $1 AND slug LIKE $2
      ORDER BY id DESC LIMIT 1`,
    [companyId, `${slugStart}%`],
  );
}

/** Options (value + label) of an attribute. */
export function findAttributeOptions(hub: Database, attributeId: string) {
  return hub.query<{ value: string; label: string; translations: unknown }>(
    'SELECT value, label, translations FROM public.product_attribute_options WHERE attribute_definition_id = $1 ORDER BY id',
    [attributeId],
  );
}

/** How many products/variants have a value for this attribute. */
export async function countAttributeValues(hub: Database, attributeId: string) {
  const row = await hub.one<{ count: string }>(
    'SELECT COUNT(*) AS count FROM public.product_attribute_values WHERE attribute_definition_id = $1',
    [attributeId],
  );
  return Number(row.count);
}

// ---------- product sync ----------

/** Empties the cache tables; the product sync does not start while old cache locks are there. */
export async function clearCacheTables(hub: Database) {
  await hub.query('DELETE FROM public.cache_locks');
  await hub.query('DELETE FROM public."cache"');
}

/** Number of attribute definitions of the company. */
export async function countAttributes(hub: Database, companyId: string) {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM public.product_attribute_definitions WHERE company_id = $1', [companyId]);
  return Number(row.count);
}

/** Number of queued "assign attribute to all" jobs (public.jobs, queue default - the worker runs only every 30 min on dev). */
export async function countAssignAttributeJobs(hub: Database) {
  const row = await hub.one<{ count: string }>(
    `SELECT COUNT(*) AS count FROM public.jobs WHERE queue = 'default' AND payload LIKE '%AssignAttributeToAllJob%'`,
  );
  return Number(row.count);
}

/**
 * Newest product for "Create order" → "Add item": active, "Allow order create" on, has an active variant,
 * and NOT test data (title does not start with qa_auto). Or undefined.
 */
export function findProductForOrderItem(hub: Database, companyId: string) {
  return hub.maybeOne<{ id: string; title: string }>(
    `SELECT p.id, p.title
       FROM public.products p
      WHERE p.company_id = $1
        AND p.active = true
        AND p.allow_order_create = true
        AND p.title NOT LIKE 'qa\_auto%'
        AND EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id AND v.active = true)
      ORDER BY p.id DESC
      LIMIT 1`,
    [companyId],
  );
}

// ---------- CSS "Add new product" (tests/css-e2e/04-add-new-product.spec.ts) ----------

/**
 * A product for the CSS "Add new product" page of the customer's shop: active, allow_order_create,
 * type 'consumable', stock > 0; not qa_auto. Only products with ONE active variant (that variant also active,
 * orderable, stock > 0) - so the CSS skips the "Variants" step. Newest first. customerId = cus_…; or undefined.
 */
export function findCssProduct(hub: Database, customerId: string) {
  return hub.maybeOne<{ product_id: string; title: string; variant_id: string; stock: number }>(
    `SELECT p.id AS product_id, COALESCE(p.title_translations->>'en', p.title) AS title, v.id AS variant_id, v.stock
       FROM public.products p
       JOIN public.product_variants v ON v.product_id = p.id
      WHERE p.company_id = (SELECT company_id FROM public.customers WHERE uid = $1)
        AND p.active = true AND p.allow_order_create = true AND p."type" IN ('consumable') AND p.stock > 0
        AND v.active = true AND v.allow_order_create = true AND v.stock > 0
        AND p.title NOT LIKE 'qa\_auto%' AND v.title NOT LIKE 'qa\_auto%'
        AND (SELECT count(*) FROM public.product_variants v2 WHERE v2.product_id = p.id AND v2.active = true) = 1
      ORDER BY p.id DESC
      LIMIT 1`,
    [customerId],
  );
}

// ---------- one value, for expect.poll in the product tests ----------

/** Description of an attribute, or undefined. */
export async function getAttributeDescription(hub: Database, companyId: string, slug: string) {
  const row = await findAttributeBySlug(hub, companyId, slug);
  return row?.description;
}

/** Labels of the options of an attribute. */
export async function getAttributeOptionLabels(hub: Database, attributeId: string) {
  const labels: string[] = [];
  for (const option of await findAttributeOptions(hub, attributeId)) {
    labels.push(option.label);
  }
  return labels;
}

/** msrp of a product as a number. */
export async function getProductMsrp(hub: Database, companyId: string, productId: string) {
  const row = await findProductById(hub, companyId, productId);
  return Number(row?.msrp);
}

/** purchase_price of a product as a number. */
export async function getProductPurchasePrice(hub: Database, companyId: string, productId: string) {
  const row = await findProductById(hub, companyId, productId);
  return Number(row?.purchase_price);
}

/** product_collection_id of a product, or undefined. */
export async function getProductCollectionId(hub: Database, companyId: string, productId: string) {
  const row = await findProductById(hub, companyId, productId);
  return row?.product_collection_id;
}

/** subscription_extension_price of the first variant of a product, as a number. */
export async function getFirstVariantExtensionPrice(hub: Database, companyId: string, productId: string) {
  const variants = await findVariantsOfProduct(hub, companyId, productId);
  return Number(variants[0].subscription_extension_price);
}
