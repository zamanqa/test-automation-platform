import fs from 'node:fs';
import { CSS_DATA_FILE } from '@config/paths';

// The CSS test customer saved by tests/css-e2e/01-css-login.spec.ts
export type CssData = {
  orderId: string;
  customerId: string;
  normal: { subscriptionId: string; product: string; invoiceIds: string[] };
  consumable: { subscriptionId: string; product: string };
};

/** Reads .auth/css-data.json, or undefined if 01-css-login.spec.ts has not run yet. */
export function readCssData(): CssData | undefined {
  if (!fs.existsSync(CSS_DATA_FILE)) return undefined;
  return JSON.parse(fs.readFileSync(CSS_DATA_FILE, 'utf8'));
}
