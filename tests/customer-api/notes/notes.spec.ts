// test, expect      ← src/fixtures/index.ts
// findLatestNoteOn  ← src/db/queries/hub/notes.ts
import { test, expect } from '@fixtures';
import { findLatestNoteOn } from '@db/queries/hub/notes';

/**
 * WHAT:   OLD Customer API — /notes and its filters (read only).
 * FROM:   cus-api cypress/e2e/customer-api/15-notes/notes.cy.js (5 tests).
 * CHANGES DATA: no.
 */

/** Some filters return a bare array, others { data: [...] } — this returns the list either way. */
async function notesIn(response: { json(): Promise<unknown> }) {
  const body = (await response.json()) as unknown[] | { data: unknown[] };
  return Array.isArray(body) ? body : body.data;
}

test.describe('Customer API - notes', () => {
  test('returns a list of notes', async ({ customerApi }) => {
    // ACTION: GET /notes
    const response = await customerApi.notes.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a note by id', async ({ customerApi, db }) => {
    // SETUP: newest note on an order ← hub db (companyId ← .env)
    const note = await findLatestNoteOn(db.hub, customerApi.companyId, 'order_id');

    // ACTION: GET /notes/{id}
    const response = await customerApi.notes.get(note.id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('id');
  });

  test('filters notes by order', async ({ customerApi, db }) => {
    // SETUP
    const note = await findLatestNoteOn(db.hub, customerApi.companyId, 'order_id');

    // ACTION: GET /notes?order_id=...
    const response = await customerApi.notes.list({ order_id: note.order_id! });

    // CHECK
    expect(response.status()).toBe(200);
    expect((await notesIn(response)).length).toBeGreaterThan(0);
  });

  test('filters notes by customer', async ({ customerApi, db }) => {
    // SETUP: note must have a customer
    const note = await findLatestNoteOn(db.hub, customerApi.companyId, 'order_id');
    expect(note.customer_id, 'The latest order note has no customer').toBeTruthy();

    // ACTION: GET /notes?customer_id=...
    const response = await customerApi.notes.list({ customer_id: note.customer_id! });

    // CHECK
    expect(response.status()).toBe(200);
    expect((await notesIn(response)).length).toBeGreaterThan(0);
  });

  test('filters notes by subscription', async ({ customerApi, db }) => {
    // SETUP: newest note on a subscription
    const note = await findLatestNoteOn(db.hub, customerApi.companyId, 'subscription_id');

    // ACTION: GET /notes?subscription_id=...
    const response = await customerApi.notes.list({ subscription_id: note.subscription_id! });

    // CHECK
    expect(response.status()).toBe(200);
    expect((await notesIn(response)).length).toBeGreaterThan(0);
  });
});
