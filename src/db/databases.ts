import type { PoolConfig } from 'pg';
import { env } from '@config/env';

// Connection settings for each database. They are functions, so the .env values
// are only read when a test really uses that database.
// To add a database: add a function here, its variables to src/config/env.ts and .env.example,
// and one line in createDatabases() (src/db/connection.ts).

export function hubDbSettings(): PoolConfig {
  return {
    host: env.hubDb.HUB_DB_HOST,
    port: env.hubDb.HUB_DB_PORT,
    database: env.hubDb.HUB_DB_NAME,
    user: env.hubDb.HUB_DB_USER,
    password: env.hubDb.HUB_DB_PASSWORD,
    ssl: false,
  };
}

export function checkoutDbSettings(): PoolConfig {
  return {
    host: env.checkoutDb.CHECKOUT_DB_HOST,
    port: env.checkoutDb.CHECKOUT_DB_PORT,
    database: env.checkoutDb.CHECKOUT_DB_NAME,
    user: env.checkoutDb.CHECKOUT_DB_USER,
    password: env.checkoutDb.CHECKOUT_DB_PASSWORD,
    ssl: false,
  };
}
