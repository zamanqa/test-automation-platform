import 'dotenv/config';
import { z } from 'zod';

/**
 * All environment variables, grouped by what uses them.
 *
 * A group is validated the first time it is read, so running the API suites does
 * not require hub or checkout values — but a group that IS used fails immediately
 * with the list of missing variables, instead of an "undefined" deep inside a test.
 */
const str = z.string().min(1);
const port = z.coerce.number().int().positive().default(5432);

const schemas = {
  hub: z.object({
    HUB_URL: z.string().url(),
    HUB_USER_EMAIL: str,
    HUB_USER_PASSWORD: str,
    HUB_COMPANY_NAME: str,
    /** Version endpoint pinged to wake the hub API before UI tests. */
    HUB_API_HEALTH_URL: z.string().url(),
  }),

  /** Hub (Lumen) API login used to trigger crons. */
  hubApi: z.object({
    HUB_API_BASE_URL: z.string().url(),
    HUB_API_EMAIL: str,
    HUB_API_PASSWORD: str,
  }),

  checkout: z.object({
    CHECKOUT_URL: z.string().url(),
    CHECKOUT_API_URL: z.string().url(),
  }),

  /** Customer self-service portal (login page with company_id). */
  css: z.object({
    CSS_URL: z.string().url(),
  }),

  /** POS portal: login page with company_id, location id + password. */
  pos: z.object({
    POS_URL: z.string().url(),
    POS_LOCATION_ID: str,
    POS_PASSWORD: str,
  }),

  customerApi: z.object({
    CUSTOMER_API_BASE_URL: z.string().url(),
    CUSTOMER_API_VERSION: str,
    CUSTOMER_API_USERNAME: str,
    CUSTOMER_API_PASSWORD: str,
    CUSTOMER_API_COMPANY_ID: str,
  }),

  unifiedApi: z.object({
    UNIFIED_API_BASE_URL: z.string().url(),
    UNIFIED_API_VERSION: str,
    UNIFIED_API_CONSUMER_KEY: str,
    UNIFIED_API_CONSUMER_SECRET: str,
  }),

  hubDb: z.object({
    HUB_DB_HOST: str,
    HUB_DB_PORT: port,
    HUB_DB_NAME: str,
    HUB_DB_USER: str,
    HUB_DB_PASSWORD: str,
  }),

  checkoutDb: z.object({
    CHECKOUT_DB_HOST: str,
    CHECKOUT_DB_PORT: port,
    CHECKOUT_DB_NAME: str,
    CHECKOUT_DB_USER: str,
    CHECKOUT_DB_PASSWORD: str,
  }),

  testData: z.object({
    TEST_DATA_PREFIX: str.default('qa_auto_'),
  }),
};

type Schemas = typeof schemas;
type Env = { readonly [K in keyof Schemas]: z.infer<Schemas[K]> };

const cache: Partial<Record<keyof Schemas, unknown>> = {};

function load<K extends keyof Schemas>(group: K): z.infer<Schemas[K]> {
  if (!(group in cache)) {
    const result = schemas[group].safeParse(process.env);
    if (!result.success) {
      const problems = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Missing or invalid environment variables for "${group}" (check .env):\n${problems}`);
    }
    cache[group] = result.data;
  }
  return cache[group] as z.infer<Schemas[K]>;
}

/**
 * Used everywhere as env.<group>.<VARIABLE>, e.g. env.unifiedApi.UNIFIED_API_BASE_URL.
 * The Proxy turns each `env.<group>` read into load(group): the group is validated
 * the first time it is read, then cached.
 */
export const env = new Proxy({} as Env, {
  get: (_target, group: string) => load(group as keyof Schemas),
});
