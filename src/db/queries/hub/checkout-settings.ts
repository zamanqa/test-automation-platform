import type { Database } from '@db/connection';

// Checkout settings of a shop (hub database, schema "checkout"), keyed by api_key.
// After a change the checkout API still uses its cached copy: call refreshCheckoutSettings() (src/api/checkout-settings.ts).
// updated_at = now() tells the refresh that the settings changed.

/** Switches in checkout.checkout_features that show a contact-form field or make it required. */
export type FeatureSwitch =
  | 'allow_company_inputs'
  | 'require_company_input'
  | 'allow_vat_number'
  | 'require_vat_number'
  | 'allow_date_of_birth'
  | 'require_date_of_birth'
  | 'allow_notes'
  | 'allow_address_addition'
  | 'allow_buyer_reference';

const FEATURE_SWITCHES: FeatureSwitch[] = [
  'allow_company_inputs', 'require_company_input', 'allow_vat_number', 'require_vat_number', 'allow_date_of_birth',
  'require_date_of_birth', 'allow_notes', 'allow_address_addition', 'allow_buyer_reference',
];

/** Current value of a feature switch. Throws if the shop has no checkout_features row. */
export async function getCheckoutFeature(hub: Database, apiKey: string, name: FeatureSwitch): Promise<boolean> {
  if (!FEATURE_SWITCHES.includes(name)) throw new Error(`unknown checkout feature ${name}`);
  const row = await hub.one<{ value: boolean }>(
    `SELECT "${name}" AS value FROM checkout.checkout_features WHERE api_key = $1`, [apiKey]);
  return row.value;
}

/** Sets a feature switch on or off. */
export async function setCheckoutFeature(hub: Database, apiKey: string, name: FeatureSwitch, value: boolean) {
  if (!FEATURE_SWITCHES.includes(name)) throw new Error(`unknown checkout feature ${name}`);
  await hub.query(
    `UPDATE checkout.checkout_features SET "${name}" = $2, updated_at = now() WHERE api_key = $1`, [apiKey, value]);
}

/** Phone validation switch (checkout_limitations.validate_phone_number). Throws if none. */
export async function getPhoneValidation(hub: Database, apiKey: string): Promise<boolean> {
  const row = await hub.one<{ validate_phone_number: boolean }>(
    'SELECT validate_phone_number FROM checkout.checkout_limitations WHERE api_key = $1', [apiKey]);
  return row.validate_phone_number;
}

/** Sets the phone validation switch on or off. */
export async function setPhoneValidation(hub: Database, apiKey: string, value: boolean) {
  await hub.query(
    'UPDATE checkout.checkout_limitations SET validate_phone_number = $2, updated_at = now() WHERE api_key = $1',
    [apiKey, value]);
}

/** Postal code limit: on/off and the allowed patterns, e.g. ['603xx'] (x = any digit). Throws if none. */
export function getPostalCodeLimit(hub: Database, apiKey: string) {
  return hub.one<{ limit_postal_codes: boolean; postal_codes: string[] }>(
    'SELECT limit_postal_codes, postal_codes FROM checkout.checkout_limitations WHERE api_key = $1', [apiKey]);
}

/** Sets the postal code limit and its patterns. */
export async function setPostalCodeLimit(hub: Database, apiKey: string, on: boolean, postalCodes: string[]) {
  await hub.query(
    `UPDATE checkout.checkout_limitations SET limit_postal_codes = $2, postal_codes = $3::jsonb, updated_at = now()
      WHERE api_key = $1`,
    [apiKey, on, JSON.stringify(postalCodes)]);
}

/** "Different shipping address" switch (checkout_shipping_settings.allow_different_shipping). Throws if none. */
export async function getDifferentShipping(hub: Database, apiKey: string): Promise<boolean> {
  const row = await hub.one<{ allow_different_shipping: boolean }>(
    'SELECT allow_different_shipping FROM checkout.checkout_shipping_settings WHERE api_key = $1', [apiKey]);
  return row.allow_different_shipping;
}

/** Sets the "different shipping address" switch on or off. */
export async function setDifferentShipping(hub: Database, apiKey: string, value: boolean) {
  await hub.query(
    'UPDATE checkout.checkout_shipping_settings SET allow_different_shipping = $2, updated_at = now() WHERE api_key = $1',
    [apiKey, value]);
}

/** The checkout API address the hub uses for this shop, e.g. https://checkout.api.development.circuly.io/v1. Throws if none. */
export async function getCheckoutApiUrl(hub: Database, apiKey: string): Promise<string> {
  const row = await hub.one<{ checkout_url: string }>(
    'SELECT checkout_url FROM checkout.checkout_general_settings WHERE api_key = $1', [apiKey]);
  return row.checkout_url;
}

/** The shop's checkboxes on the payment step (checkout_stylings.checkboxes), e.g. [{ tag: 'TermsAndConditions', required: false, ... }]. Throws if none. */
export async function getCheckoutCheckboxes(hub: Database, apiKey: string): Promise<Record<string, unknown>[]> {
  const row = await hub.one<{ checkboxes: Record<string, unknown>[] }>(
    'SELECT checkboxes FROM checkout.checkout_stylings WHERE api_key = $1', [apiKey]);
  return row.checkboxes;
}

/** Saves the shop's checkboxes (the whole list). */
export async function setCheckoutCheckboxes(hub: Database, apiKey: string, checkboxes: Record<string, unknown>[]) {
  await hub.query(
    'UPDATE checkout.checkout_stylings SET checkboxes = $2::jsonb, updated_at = now() WHERE api_key = $1',
    [apiKey, JSON.stringify(checkboxes)]);
}
