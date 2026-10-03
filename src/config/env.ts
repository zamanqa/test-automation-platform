import 'dotenv/config';
import { z } from 'zod';

// All .env variables, grouped by what uses them.
// A group is checked the first time a test reads it, so an API run does not need the hub values.
// A missing value fails right away with the variable name.

const text = z.string().min(1);
const url = z.string().url();
const port = z.coerce.number().int().positive().default(5432);

const groups = {
  hub: z.object({
    HUB_URL: url,
    HUB_USER_EMAIL: text,
    HUB_USER_PASSWORD: text,
    HUB_COMPANY_NAME: text,
    HUB_API_HEALTH_URL: url, // pinged to wake the hub API before UI tests
  }),

  // hub (Lumen) API login, used to start crons
  hubApi: z.object({
    HUB_API_BASE_URL: url,
    HUB_API_EMAIL: text,
    HUB_API_PASSWORD: text,
  }),

  checkout: z.object({
    CHECKOUT_URL: url,
    CHECKOUT_API_URL: url,
  }),

  css: z.object({
    CSS_URL: url,
  }),

  pos: z.object({
    POS_URL: url,
    POS_LOCATION_ID: text,
    POS_PASSWORD: text,
  }),

  customerApi: z.object({
    CUSTOMER_API_BASE_URL: url,
    CUSTOMER_API_VERSION: text,
    CUSTOMER_API_USERNAME: text,
    CUSTOMER_API_PASSWORD: text,
    CUSTOMER_API_COMPANY_ID: text,
  }),

  unifiedApi: z.object({
    UNIFIED_API_BASE_URL: url,
    UNIFIED_API_VERSION: text,
    UNIFIED_API_CONSUMER_KEY: text,
    UNIFIED_API_CONSUMER_SECRET: text,
  }),

  hubDb: z.object({
    HUB_DB_HOST: text,
    HUB_DB_PORT: port,
    HUB_DB_NAME: text,
    HUB_DB_USER: text,
    HUB_DB_PASSWORD: text,
  }),

  checkoutDb: z.object({
    CHECKOUT_DB_HOST: text,
    CHECKOUT_DB_PORT: port,
    CHECKOUT_DB_NAME: text,
    CHECKOUT_DB_USER: text,
    CHECKOUT_DB_PASSWORD: text,
  }),

  testData: z.object({
    TEST_DATA_PREFIX: text.default('qa_auto_'),
  }),
};

const checked: Record<string, unknown> = {};

function read<T>(name: string, schema: z.ZodType<T>): T {
  if (!(name in checked)) {
    const result = schema.safeParse(process.env);
    if (!result.success) {
      const problems = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
      throw new Error(`Missing or invalid environment variables for "${name}" (check .env):\n${problems}`);
    }
    checked[name] = result.data;
  }
  return checked[name] as T;
}

// Use it as env.<group>.<VARIABLE>, e.g. env.hub.HUB_URL
export const env = {
  get hub() { return read('hub', groups.hub); },
  get hubApi() { return read('hubApi', groups.hubApi); },
  get checkout() { return read('checkout', groups.checkout); },
  get css() { return read('css', groups.css); },
  get pos() { return read('pos', groups.pos); },
  get customerApi() { return read('customerApi', groups.customerApi); },
  get unifiedApi() { return read('unifiedApi', groups.unifiedApi); },
  get hubDb() { return read('hubDb', groups.hubDb); },
  get checkoutDb() { return read('checkoutDb', groups.checkoutDb); },
  get testData() { return read('testData', groups.testData); },
};
