import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import { checkoutDbSettings, hubDbSettings } from './databases';

type Row = QueryResultRow;

// One database. It connects on the first query, so a run that never uses it never connects.
// Always pass values as $1, $2 ... parameters, never put them into the SQL string.
export class Database {
  private pool?: Pool;

  constructor(
    readonly name: string,
    private readonly settings: () => PoolConfig,
  ) {}

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({ ...this.settings(), max: 3 });
    }
    return this.pool;
  }

  /** All rows (empty array if none). Also used for INSERT / UPDATE / DELETE. */
  async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.getPool().query<T>(sql, params);
    return result.rows;
  }

  /** The first row. Throws if there is none. */
  async one<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.query<T>(sql, params);
    if (rows.length === 0) {
      throw new Error(`[db:${this.name}] expected at least one row, got none.\nSQL: ${sql.trim()}\nParams: ${JSON.stringify(params)}`);
    }
    return rows[0];
  }

  /** The first row, or undefined. */
  async maybeOne<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params);
    return rows[0];
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = undefined;
  }
}

// Called once per worker by the `db` fixture → db.hub, db.checkout
export function createDatabases() {
  const hub = new Database('hub', hubDbSettings);
  const checkout = new Database('checkout', checkoutDbSettings);

  return {
    hub,
    checkout,
    async closeAll() {
      await hub.close();
      await checkout.close();
    },
  };
}

export type Databases = ReturnType<typeof createDatabases>;
