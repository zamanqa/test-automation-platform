import type { Database } from '@db/connection';

// Queries on the checkout database (db.checkout): carts and their items.

export type CartRow = {
  voucher_code: string | null;
  voucher_discount: number;
  voucher_min_applied: boolean | null;
  voucher_remaining_amount: number | null;
  shipping_cost: number;
  shipping_method: { id: number; price: number } | null;
  alpha2: string;
  tax_percent: number;
};

/** The cart with its voucher, shipping and tax values. Throws if none. */
export function getCart(checkout: Database, cartId: string) {
  return checkout.one<CartRow>(
    `SELECT voucher_code, voucher_discount, voucher_min_applied, voucher_remaining_amount, shipping_cost,
            shipping_method, alpha2, tax_percent
       FROM carts WHERE cart_id = $1`,
    [cartId],
  );
}

/** Items of the cart (name, quantity, price), oldest first. Empty list if none. */
export function findCartItems(checkout: Database, cartId: string) {
  return checkout.query<{ name: string; quantity: number; price: number }>(
    'SELECT name, quantity, price FROM cart_items WHERE cart_id = $1 ORDER BY id',
    [cartId],
  );
}
