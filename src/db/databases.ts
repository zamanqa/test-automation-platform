import type { PoolConfig } from 'pg';
import { env } from '@config/env';

/**
 * THE one place where databases are defined.
 *
 * Every project can use every database through the `db` fixture:
 *   test('...', async ({ db }) => { await db.hub.query(...); await db.checkout.query(...); });
 *
 * To add a database: add an entry here and its variables to src/config/env.ts and .env.example.
 * The name you use here becomes `db.<name>` everywhere, with autocomplete.
 *
 * Entries are functions so a database's env vars are only read (and validated)
 * when a test actually uses that database.
 */
export const databases = {
  hub: (): PoolConfig => ({
    host: env.hubDb.HUB_DB_HOST,
    port: env.hubDb.HUB_DB_PORT,
    database: env.hubDb.HUB_DB_NAME,
    user: env.hubDb.HUB_DB_USER,
    password: env.hubDb.HUB_DB_PASSWORD,
    ssl: false,
  }),

  checkout: (): PoolConfig => ({
    host: env.checkoutDb.CHECKOUT_DB_HOST,
    port: env.checkoutDb.CHECKOUT_DB_PORT,
    database: env.checkoutDb.CHECKOUT_DB_NAME,
    user: env.checkoutDb.CHECKOUT_DB_USER,
    password: env.checkoutDb.CHECKOUT_DB_PASSWORD,
    ssl: false,
  }),
} satisfies Record<string, () => PoolConfig>;

export type DatabaseName = keyof typeof databases;
