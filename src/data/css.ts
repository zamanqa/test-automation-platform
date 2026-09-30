import fs from 'node:fs';
import { CSS_DATA_FILE } from '@config/paths';

// USED BY (files that import this one):
//   tests/css-e2e/02-outstanding-amount.spec.ts
//   tests/css-e2e/03-refer-a-friend.spec.ts
//   tests/css-e2e/04-add-new-product.spec.ts
//   tests/css-e2e/05-update-payment-method.spec.ts
//   tests/css-e2e/99-cancel-and-report.spec.ts

/** The CSS test customer written by tests/css-e2e/01-css-login.spec.ts (.auth/css-data.json). */
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
