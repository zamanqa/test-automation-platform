import type { Database } from '@db/connection';

// USED BY (files that import this one):
//   tests/css-e2e/03-refer-a-friend.spec.ts
//   tests/css-e2e/04-add-new-product.spec.ts
//   tests/customer-api/customers/customers.spec.ts
//   tests/unified-api/customers/customers.spec.ts

/** Queries on customers, customer_account and referral codes. */

export type CustomerRow = { uid: string; email: string; first_name: string; last_name: string; external_customer_id: string | null };

/** First customer ever created for the company. companyId ← API login or .env. Throws if none. */
export function findOldestCustomer(hub: Database, companyId: string) {
  return hub.one<CustomerRow>(
    `SELECT uid, email, first_name, last_name, external_customer_id
       FROM public.customers
      WHERE company_id = $1
      ORDER BY created_at ASC
      LIMIT 1`,
    [companyId],
  );
}

/** Customer by uid (e.g. "cus_..."), or undefined. */
export function findCustomer(hub: Database, uid: string) {
  return hub.maybeOne<CustomerRow>(
    'SELECT uid, email, first_name, last_name, external_customer_id FROM public.customers WHERE uid = $1',
    [uid],
  );
}

/** Customer by email (compared lower-case), or undefined. */
export function findCustomerByEmail(hub: Database, email: string) {
  return hub.maybeOne<CustomerRow>(
    'SELECT uid, email, first_name, last_name, external_customer_id FROM public.customers WHERE email = LOWER($1)',
    [email],
  );
}

/** Balance (store credit) row of a customer, by email. */
export function findCustomerAccount(hub: Database, email: string) {
  return hub.maybeOne<{ remaining_amount: string; amount: string }>(
    'SELECT remaining_amount, amount FROM public.customer_account WHERE referrer_email = $1',
    [email],
  );
}

/** The two most recently created customers that have at least one order. */
export function findTwoRecentCustomersWithOrders(hub: Database, companyId: string) {
  return hub.query<CustomerRow>(
    `SELECT c.uid, c.email, c.first_name, c.last_name, c.external_customer_id
       FROM public.customers c
      WHERE c.company_id = $1
        AND EXISTS (
          SELECT 1
            FROM public.orders o
            JOIN public.order_customers oc ON oc.company_id = o.company_id AND oc.id = o.order_customer_id
           WHERE oc.customer_id = c.uid AND o.company_id = $1)
      ORDER BY c.created_at DESC
      LIMIT 2`,
    [companyId],
  );
}

/** How many orders are linked to a customer (via order_customers). Used after a customer transfer. */
export async function countOrdersOfCustomer(hub: Database, companyId: string, customerUid: string): Promise<number> {
  const row = await hub.one<{ count: string }>(
    `SELECT COUNT(*) AS count
       FROM public.orders o
       JOIN public.order_customers oc ON oc.company_id = o.company_id AND oc.id = o.order_customer_id
      WHERE o.company_id = $1 AND oc.customer_id = $2`,
    [companyId, customerUid],
  );
  return Number(row.count);
}

// ---------- referral codes (checkout.checkout_voucher_codes, in the hub database) ----------

export function deleteReferralCodesOfEmail(hub: Database, email: string) {
  return hub.query('DELETE FROM checkout.checkout_voucher_codes WHERE referrer_email = $1', [email]);
}

/** Deletes one referral code (the test registers this as a cleanup step). */
export function deleteReferralCode(hub: Database, code: string) {
  return hub.query('DELETE FROM checkout.checkout_voucher_codes WHERE voucher_code = $1', [code]);
}

// ---------- hub customer page (tests/hub-e2e/customers/customers.spec.ts) ----------

/** Newest customer of the company that has at least one order, or undefined. */
export function findLatestCustomerWithOrder(hub: Database, companyId: string) {
  return hub.maybeOne<CustomerRow & { default_locale: string | null }>(
    `SELECT c.uid, c.email, c.first_name, c.last_name, c.external_customer_id, c.default_locale
       FROM public.customers c
      WHERE c.company_id = $1
        AND EXISTS (SELECT 1 FROM public.order_customers oc WHERE oc.customer_id = c.uid)
      ORDER BY c.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** default_locale of a customer ('en', 'de' ...), or undefined. */
export async function getCustomerLocale(hub: Database, uid: string) {
  const row = await hub.maybeOne<{ default_locale: string | null }>('SELECT default_locale FROM public.customers WHERE uid = $1', [uid]);
  return row?.default_locale ?? undefined;
}

/** Sets default_locale directly (cleanup: put the old language back). */
export function setCustomerLocale(hub: Database, uid: string, locale: string | null) {
  return hub.query('UPDATE public.customers SET default_locale = $2 WHERE uid = $1', [uid, locale]);
}

/** Number of notes on a customer with exactly this message. */
export async function countCustomerNotes(hub: Database, uid: string, message: string): Promise<number> {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM public.notes WHERE customer_id = $1 AND message = $2', [uid, message]);
  return Number(row.count);
}


/** Referral code of a customer email (checkout.checkout_voucher_codes.voucher_code), or undefined. */
export function findReferralCodeOfEmail(hub: Database, email: string) {
  return hub.maybeOne<{ voucher_code: string }>('SELECT voucher_code FROM checkout.checkout_voucher_codes WHERE referrer_email = $1', [email]);
}

/** company_id of a customer (cus_…). Throws if none. */
export async function getCompanyIdOfCustomer(hub: Database, uid: string): Promise<string> {
  const row = await hub.one<{ company_id: string }>('SELECT company_id FROM public.customers WHERE uid = $1', [uid]);
  return row.company_id;
}
