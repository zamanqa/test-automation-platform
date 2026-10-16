import type { Database } from '@db/connection';

// Queries on the checkout database (db.checkout): orders made in the checkout.

export type CheckoutOrderRow = {
  order_number: string;
  payment_method: string;
  email: string;
  firstname: string;
  lastname: string;
  billing_street: string;
  billing_postal_code: string;
  billing_city: string;
  order_amount: number;
  tax_amount: number;
  cart_total_quantity: number;
  transaction_id: string | null;
  buyer_reference: string | null;
};

const ORDER_COLUMNS = `order_number, payment_method, email, firstname, lastname, billing_street, billing_postal_code,
  billing_city, order_amount, tax_amount, cart_total_quantity, transaction_id, meta->'contact'->>'buyer_reference' AS buyer_reference`;

/** Checkout order by order number (= hub order_id). Throws if none. */
export function getCheckoutOrder(checkout: Database, orderNumber: string) {
  return checkout.one<CheckoutOrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE order_number = $1`, [orderNumber]);
}

/** How many checkout orders were made with this email (each test uses a new random email). */
export async function countCheckoutOrdersByEmail(checkout: Database, email: string): Promise<number> {
  const row = await checkout.one<{ count: string }>('SELECT count(*) FROM orders WHERE email = $1', [email]);
  return Number(row.count);
}
