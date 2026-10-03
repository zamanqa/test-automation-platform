/** Request bodies for /one-time-payments. Same for both APIs. Values from unified-customer-api paymentPayloads.js. */

/** 20.00 in two 10.00 lines at 19% tax. */
export function oneTimePaymentPayload(orderId: string) {
  return {
    amount: 20.0,
    order_id: orderId,
    message: '',
    products: [
      { product: 'Automation test 1', amount: 10.0, tax_percent: 19, quantity: 1 },
      { product: 'Automation test 2', amount: 10.0, tax_percent: 19, quantity: 1 },
    ],
  };
}
