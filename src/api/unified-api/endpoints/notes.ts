import type { UnifiedApiClient } from '../UnifiedApiClient';

export type NoteFilter = { order_id?: string; customer_id?: string; subscription_id?: string; transaction_id?: string };

/** /notes endpoints. */
export class NotesEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** All notes, optionally filtered, e.g. list({ order_id }). */
  list(filter: NoteFilter = {}) {
    // send only the filters that are set
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(filter)) {
      if (value !== undefined) params[key] = value;
    }
    return this.api.company('GET', '/notes', { params });
  }

  /** GET /notes/{noteId} */
  get(noteId: string | number) {
    return this.api.company('GET', `/notes/${noteId}`);
  }
}
