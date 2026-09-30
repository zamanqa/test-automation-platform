// USED BY (files that import this one):
//   tests/customer-api/invoices/invoices.spec.ts

/** Request bodies for POST /invoices/{number}/refund on the Customer API (Postman: "refund invoice updated logic"). */

/** Full refund: the whole invoice. */
export function fullRefundPayload() {
  return { full_refund: true };
}

/** Partial refund of one invoice item. itemId ← invoice_items.id, amount ← part of that item's price. */
export function partialRefundPayload(itemId: string, amount: number) {
  return {
    amount: amount,
    full_refund: false,
    refund_items: [{ invoice_item_id: Number(itemId), amount: amount }],
    message: 'QA automation: partial refund',
  };
}
