/** Request bodies for /invoices. Values from unified-customer-api invoicePayloads.js. */

/** Partial refund of 0.10 as one free-text product line. */
export function partialRefundPayload(invoiceId: string | number, orderId: string | number) {
  return {
    amount: 0.1,
    cumulated_items: [],
    full_refund: false,
    invoice_id: String(invoiceId),
    items: [],
    message: '',
    order_id: String(orderId),
    products: [{ amount: 0.1, product: 'Test', quantity: 1, tax_percent: 0 }],
  };
}
