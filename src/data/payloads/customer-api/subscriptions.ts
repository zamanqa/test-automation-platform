/** Request bodies for /subscriptions on the Customer API. Values from cus-api subscriptionPayloads.js. */

type Item = { item_id: string; order_id: string; order_item_id: string; sku: string };

/** Subscription id the API derives for an order item. */
export function subscriptionIdOf(item: Item): string {
  return `${item.order_id}_${item.order_item_id}_${item.sku}`;
}

/** subscriptionStart: DD-MM-YYYY */
export function consumableSubscriptionPayload(item: Item, subscriptionStart: string) {
  return {
    order_id: item.order_id,
    id: item.order_item_id,
    product_id: item.sku,
    serial_number: `serial-${Date.now()}`,
    subscription_start: subscriptionStart,
    status: 'active',
  };
}

/** Normal subscription with one bundle entry (the order item itself). subscriptionStart: DD-MM-YYYY */
export function bundleSubscriptionPayload(item: Item, subscriptionStart: string) {
  return {
    order_id: item.order_id,
    id: item.order_item_id,
    product_id: item.sku,
    // without a serial number the API answers 422
    serial_number: `serial-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    status: 'active',
    bundle_id: null,
    subscription_start: subscriptionStart,
    bundle_data: [{ id: item.item_id, serial_number: `bundle-sn-${Date.now()}-1`, frame_number: `frame-${Date.now()}-1` }],
  };
}

/** POST /subscriptions/{id}/notes body */
export function subscriptionNotePayload() {
  return { author: 'amine', message: 'test', description: 'test', serial_number: 'na', pinned: false, include_order_id: false };
}
