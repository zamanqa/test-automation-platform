import type { Database } from '@db/connection';

// Voucher codes of the checkout shops (hub database, schema "checkout").
// Only plain vouchers: no email limit, no referral, no minimum cart value, not qa_auto.

const PLAIN_VOUCHER = `
  api_key = $1 AND email IS NULL AND referrer_email IS NULL AND min_cart_value IS NULL
  AND voucher_code NOT LIKE 'qa_auto%'`;

/** A voucher of the shop that is switched on but past its expiry date, or undefined. */
export function findExpiredVoucher(hub: Database, apiKey: string) {
  return hub.maybeOne<{ voucher_code: string }>(
    `SELECT voucher_code FROM checkout.checkout_voucher_codes
      WHERE ${PLAIN_VOUCHER} AND valid = true AND expiry_date < current_date
      ORDER BY id DESC LIMIT 1`,
    [apiKey],
  );
}

/** A voucher of the shop that is switched off (valid = false) and not expired, or undefined. */
export function findDisabledVoucher(hub: Database, apiKey: string) {
  return hub.maybeOne<{ voucher_code: string }>(
    `SELECT voucher_code FROM checkout.checkout_voucher_codes
      WHERE ${PLAIN_VOUCHER} AND valid = false AND expiry_date > current_date
      ORDER BY id DESC LIMIT 1`,
    [apiKey],
  );
}
