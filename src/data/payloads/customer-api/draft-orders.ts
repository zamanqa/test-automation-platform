import { draftOrderPayload as unifiedDraftOrderPayload } from '@data/payloads/unified-api/draft-orders';
import type { SubscriptionVariantRow } from '@db/queries/hub/products';

// USED BY (files that import this one):
//   tests/customer-api/draft-orders/draft-orders.spec.ts

/**
 * Request body for POST /draft-orders on the Customer API. Same as the Unified API one
 * except the item keeps the database types (cus-api draftOrderPayloads.js): price as
 * returned, sku = variant sku, shop_variant_id unconverted.
 */
export function draftOrderPayload(variant: SubscriptionVariantRow) {
  const payload = unifiedDraftOrderPayload(variant);
  const [item] = payload.items;
  return {
    ...payload,
    items: [{ ...item, price: variant.price, sku: variant.sku, shop_variant_id: variant.shop_variant_id }],
  };
}
