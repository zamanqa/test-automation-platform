import type { Database } from '@db/connection';

// USED BY (files that import this one):
//   tests/customer-api/notes/notes.spec.ts
//   tests/unified-api/notes/notes.spec.ts

/** Queries on notes. */

export type NoteRow = {
  id: string;
  author: string;
  customer_id: string | null;
  order_id: string | null;
  subscription_id: string | null;
  transaction_id: string | null;
};

/** Number of notes of an order with exactly this message (0 after the note was deleted). */
export async function countOrderNotes(hub: Database, orderId: string, message: string): Promise<number> {
  const row = await hub.one<{ count: string }>(
    'SELECT COUNT(*) AS count FROM public.notes WHERE order_id = $1 AND message = $2',
    [orderId, message],
  );
  return Number(row.count);
}

/** Latest note attached to something; `on` is the column that must be set. */
export function findLatestNoteOn(hub: Database, companyId: string, on: 'order_id' | 'subscription_id' | 'transaction_id') {
  return hub.one<NoteRow>(
    `SELECT id, author, customer_id, order_id, subscription_id, transaction_id
       FROM public.notes
      WHERE company_id = $1 AND ${on} IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [companyId],
  );
}
