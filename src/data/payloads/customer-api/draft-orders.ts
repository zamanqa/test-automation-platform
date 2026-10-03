import { draftOrderPayload as unifiedDraftOrderPayload } from '@data/payloads/unified-api/draft-orders';
import type { SubscriptionVariantRow } from '@db/queries/hub/products';

// Same as the Unified API draft order, but price, sku and shop_variant_id are sent
// as they come from the database.
export function draftOrderPayload(variant: SubscriptionVariantRow) {
  const payload = unifiedDraftOrderPayload(variant);
  const [item] = payload.items;
  return {
    ...payload,
    items: [{ ...item, price: variant.price, sku: variant.sku, shop_variant_id: variant.shop_variant_id }],
  };
}
