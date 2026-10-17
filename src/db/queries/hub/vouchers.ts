import type { Database } from '@db/connection';

/** Hub vouchers (table checkout.checkout_voucher_codes in the hub database). Delete is a hard delete. */

export type VoucherRow = {
  id: string;
  name: string;
  voucher_code: string;
  description: string | null;
  discount_amount: string | null;
  discount_percent: string | null;
  min_cart_value: string | null;
  email: string | null;
  valid: boolean;
  visible: boolean;
  one_time_use: boolean;
  recurring_discount: boolean;
  expiry_date: string | null; // YYYY-MM-DD
};

/** Voucher of the company by its code, or undefined. */
export function findVoucherByCode(hub: Database, companyId: string, code: string) {
  return hub.maybeOne<VoucherRow>(
    `SELECT id, name, voucher_code, description, discount_amount, discount_percent, min_cart_value, email, valid, visible,
            one_time_use, recurring_discount, to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date
       FROM checkout.checkout_voucher_codes WHERE company_id = $1 AND voucher_code = $2`,
    [companyId, code],
  );
}

/** Id of the voucher with this code, or undefined (for expect.poll). */
export async function getVoucherId(hub: Database, companyId: string, code: string) {
  return (await findVoucherByCode(hub, companyId, code))?.id;
}

/** Number of vouchers of the company. */
export async function countVouchers(hub: Database, companyId: string): Promise<number> {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM checkout.checkout_voucher_codes WHERE company_id = $1', [companyId]);
  return Number(row.count);
}

/** Number of products linked to a voucher as "include". */
export async function countIncludedProducts(hub: Database, voucherId: string): Promise<number> {
  const row = await hub.one<{ count: string }>(
    'SELECT COUNT(*) AS count FROM checkout.voucher_codes_include_products_pivot WHERE voucher_id = $1',
    [voucherId],
  );
  return Number(row.count);
}

/** Code of an existing voucher of the company that is not qa_auto, or undefined. */
export function findExistingVoucherCode(hub: Database, companyId: string) {
  return hub.maybeOne<{ voucher_code: string }>(
    `SELECT voucher_code FROM checkout.checkout_voucher_codes
      WHERE company_id = $1 AND voucher_code NOT LIKE 'qa_auto%' AND name NOT LIKE 'qa_auto%'
      ORDER BY created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Active product with a shop id and title (not qa_auto), to limit a voucher to. Or undefined. */
export function findProductForVoucher(hub: Database, companyId: string) {
  return hub.maybeOne<{ id: string; title: string; shop_id: string }>(
    `SELECT id, title, shop_id FROM public.products
      WHERE company_id = $1 AND active = true AND COALESCE(shop_id, '') <> '' AND COALESCE(title, '') <> ''
        AND title NOT LIKE 'qa_auto%' AND sku NOT LIKE 'qa_auto%'
      ORDER BY updated_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Deletes a voucher by code with its product links (cleanup when a test fails before its own delete step). */
export async function deleteVoucherByCode(hub: Database, companyId: string, code: string) {
  const voucher = await findVoucherByCode(hub, companyId, code);
  if (!voucher) return;
  await hub.query('DELETE FROM checkout.voucher_codes_include_products_pivot WHERE voucher_id = $1', [voucher.id]);
  await hub.query('DELETE FROM checkout.voucher_codes_exclude_products_pivot WHERE voucher_id = $1', [voucher.id]);
  await hub.query('DELETE FROM checkout.voucher_codes_include_product_variants_pivot WHERE voucher_id = $1', [voucher.id]);
  await hub.query('DELETE FROM checkout.voucher_codes_exclude_product_variants_pivot WHERE voucher_id = $1', [voucher.id]);
  await hub.query('DELETE FROM checkout.checkout_voucher_codes WHERE id = $1', [voucher.id]);
}
