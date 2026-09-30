import type { Database } from '@db/connection';

// USED BY (files that import this one):
//   src/fixtures/index.ts

/** Queries on general_company_settings (one row per company). */

/** Company uid (= company_id everywhere else) by the display name the hub shows. */
export async function findCompanyIdByName(hub: Database, name: string): Promise<string> {
  const row = await hub.one<{ uid: string }>('SELECT uid FROM general_company_settings WHERE name = $1', [name]);
  return row.uid;
}
