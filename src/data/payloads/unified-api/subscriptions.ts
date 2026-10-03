import { faker } from '@faker-js/faker';
import type { OpenSubscriptionItem } from '@db/queries/hub/subscriptions';

/** Request bodies for POST /subscriptions. Values from unified-customer-api subscriptionPayloads.js. */

function base(item: OpenSubscriptionItem, subscriptionStart: string) {
  return {
    additional_infos: {},
    bundle_id: null,
    frame_number: null,
    id: item.order_item_id,
    is_parent: false,
    order_id: item.order_id,
    // the sku is sent as product_id
    product_id: item.sku,
    status: 'active',
    subscription_extension_price: 100,
    subscription_id: item.subscription_id,
    subscription_start: subscriptionStart,
    subscription_type: item.subscription_type,
  };
}

/** Single (non-bundle) subscription with a random serial number. */
export function singleSubscriptionPayload(item: OpenSubscriptionItem, subscriptionStart: string) {
  return {
    ...base(item, subscriptionStart),
    bundle_data: [],
    is_bundle: false,
    serial_number: `SN-${Date.now()}-${faker.number.int({ min: 1000, max: 9999 })}`,
  };
}

/** Bundle subscription: the serial number sits on the bundle variant instead. */
export function bundleSubscriptionPayload(
  item: OpenSubscriptionItem,
  subscriptionStart: string,
  variant: { pv_id: string; shop_variant_id: string; pv_title: string },
) {
  return {
    ...base(item, subscriptionStart),
    bundle_data: [
      {
        id: variant.pv_id,
        serial_number: faker.string.numeric({ length: 12, allowLeadingZeros: false }),
        shop_variant_id: variant.shop_variant_id,
        title: variant.pv_title,
        frame_number: null,
      },
    ],
    is_bundle: true,
    serial_number: null,
  };
}
