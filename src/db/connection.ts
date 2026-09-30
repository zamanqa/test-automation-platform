import { Pool, type QueryResultRow } from 'pg';
import { databases, type DatabaseName } from './databases';

/**
 * One database. The pool is created on the first query, so a database that a
 * test run never touches is never connected to.
 *
 * Always pass values as parameters ($1, $2 ...), never build them into the SQL string.
 *
 * DATABASE CHAIN:
 *
 *   .env  →  src/config/env.ts (env.hubDb.HUB_DB_HOST ...)
 *         →  src/db/databases.ts  { hub: () => settings, checkout: () => settings }
 *         →  createDatabases() below: one `Database` per entry  → db.hub, db.checkout
 *         →  `db` fixture (src/fixtures/index.ts) gives it to the test
 *         →  query helpers take one Database as first argument:
 *              findOrder(db.hub, orderId)   in src/db/queries/hub/orders.ts
 *                → db.hub.maybeOne(sql, params) → query() → getPool().query()
 */
export class Database {
  private pool?: Pool;

  /** `name` is a key of databases.ts ('hub' | 'checkout'); used to look up the settings. */
  constructor(readonly name: DatabaseName) {}

  /** Opens the pool on first use: calls databases[name]() → reads + validates env for that database. */
  private getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({ ...databases[this.name](), max: 3 });
    }
    return this.pool;
  }

  /** All matching rows (empty array if none). Also used for INSERT/UPDATE/DELETE. */
  async query<T extends QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.getPool().query<T>(sql, params);
    return result.rows;
  }

  /** Exactly the first row; throws with the SQL if there is none. */
  async one<T extends QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.query<T>(sql, params);
    if (rows.length === 0) {
      throw new Error(`[db:${this.name}] expected at least one row, got none.\nSQL: ${sql.trim()}\nParams: ${JSON.stringify(params)}`);
    }
    return rows[0];
  }

  /** The first row, or undefined. */
  async maybeOne<T extends QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params);
    return rows[0];
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = undefined;
  }
}

export type Databases = { readonly [K in DatabaseName]: Database } & {
  closeAll(): Promise<void>;
};

/**
 * Creates a Database for every entry in databases.ts.
 * Called once per worker by the `db` fixture; closeAll() is called by that fixture's teardown.
 */
export function createDatabases(): Databases {
  const names = Object.keys(databases) as DatabaseName[];
  const instances = Object.fromEntries(names.map((name) => [name, new Database(name)])) as Record<DatabaseName, Database>;

  return {
    ...instances,
    closeAll: async () => {
      await Promise.all(names.map((name) => instances[name].close()));
    },
  };
}
