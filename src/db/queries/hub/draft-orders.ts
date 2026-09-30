import type { Database } from '@db/connection';

// USED BY (files that import this one):
//   tests/customer-api/draft-orders/draft-orders.spec.ts
//   tests/hub-e2e/orders/create-order.spec.ts
//   tests/unified-api/draft-orders/draft-orders.spec.ts

/** Queries on draft_orders. */

export type DraftOrderRow = { id: string; draft_id: string; status: string; order_checkout_link: string | null; deleted_at: string | null };

/** Not-deleted draft order by its numeric `id` (the Unified API returns this id), or undefined. */
export function findDraftOrder(hub: Database, companyId: string, id: string) {
  return hub.maybeOne<DraftOrderRow>(
    `SELECT id, draft_id, status, order_checkout_link, deleted_at
       FROM public.draft_orders
      WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [companyId, id],
  );
}

/** Not-deleted draft order by its draft_id (the Customer API returns draft_id as `id`). */
export function findDraftOrderByDraftId(hub: Database, companyId: string, draftId: string) {
  return hub.maybeOne<DraftOrderRow>(
    `SELECT id, draft_id, status, order_checkout_link, deleted_at
       FROM public.draft_orders
      WHERE company_id = $1 AND draft_id = $2 AND deleted_at IS NULL`,
    [companyId, draftId],
  );
}

/** Soft-deleted draft order by its draft_id (returns undefined while it is not deleted). */
export function findDeletedDraftOrder(hub: Database, draftId: string) {
  return hub.maybeOne<DraftOrderRow>(
    `SELECT id, draft_id, status, order_checkout_link, deleted_at
       FROM public.draft_orders
      WHERE draft_id = $1 AND deleted_at IS NOT NULL`,
    [draftId],
  );
}
