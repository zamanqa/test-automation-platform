import type { UnifiedApiClient } from '../UnifiedApiClient';

export type NoteFilter = { order_id?: string; customer_id?: string; subscription_id?: string; transaction_id?: string };

/** /notes endpoints. */
export class NotesEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** All notes, optionally filtered, e.g. list({ order_id }). */
  list(filter: NoteFilter = {}) {
    const params = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined)) as Record<string, string>;
    return this.api.company('GET', '/notes', { params });
  }

  /** GET {base}/{version}/{companyId}/notes/{noteId} — params: noteId: string | number. Returns Playwright's APIResponse (test checks status/body). */
  get(noteId: string | number) {
    return this.api.company('GET', `/notes/${noteId}`);
  }
}
