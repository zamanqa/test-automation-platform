import { test, expect } from '@fixtures';
import { findLatestNoteOn } from '@db/queries/hub/notes';

// Unified API - /notes and its filters (read only).
// Needs: notes attached to an order (with customer) and to a subscription.
// Changes data: no.

// some filters return a plain list, others { data: [...] }
async function notesIn(response: { json(): Promise<unknown> }) {
  const body = (await response.json()) as unknown[] | { data: unknown[] };
  return Array.isArray(body) ? body : body.data;
}

test.describe('Unified API - notes', () => {
  test('returns a list of notes', async ({ unifiedApi }) => {
    // ACTION: GET /notes
    const response = await unifiedApi.notes.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a note by id', async ({ unifiedApi, db }) => {
    // SETUP: newest note that belongs to an order
    const note = await findLatestNoteOn(db.hub, await unifiedApi.companyId(), 'order_id');

    // ACTION: GET /notes/{id}
    const response = await unifiedApi.notes.get(note.id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('id');
  });

  test('filters notes by order', async ({ unifiedApi, db }) => {
    // SETUP
    const note = await findLatestNoteOn(db.hub, await unifiedApi.companyId(), 'order_id');

    // ACTION: GET /notes?order_id=...
    const response = await unifiedApi.notes.list({ order_id: note.order_id! });

    // CHECK: at least that note comes back
    expect(response.status()).toBe(200);
    expect((await notesIn(response)).length).toBeGreaterThan(0);
  });

  test('filters notes by customer', async ({ unifiedApi, db }) => {
    // SETUP: same note; it must have a customer_id
    const note = await findLatestNoteOn(db.hub, await unifiedApi.companyId(), 'order_id');
    expect(note.customer_id, 'The latest order note has no customer').toBeTruthy();

    // ACTION: GET /notes?customer_id=...
    const response = await unifiedApi.notes.list({ customer_id: note.customer_id! });

    // CHECK
    expect(response.status()).toBe(200);
    expect((await notesIn(response)).length).toBeGreaterThan(0);
  });

  test('filters notes by subscription', async ({ unifiedApi, db }) => {
    // SETUP: newest note that belongs to a subscription
    const note = await findLatestNoteOn(db.hub, await unifiedApi.companyId(), 'subscription_id');

    // ACTION: GET /notes?subscription_id=...
    const response = await unifiedApi.notes.list({ subscription_id: note.subscription_id! });

    // CHECK
    expect(response.status()).toBe(200);
    expect((await notesIn(response)).length).toBeGreaterThan(0);
  });
});
