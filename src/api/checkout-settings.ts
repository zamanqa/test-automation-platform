import { expect, type APIRequestContext } from '@playwright/test';
import { env } from '@config/env';
import type { Databases } from '@db/connection';
import type { Cleanup } from '@db/cleanup';
import {
  getCheckoutApiUrl, getCheckoutCheckboxes, getCheckoutFeature, getDifferentShipping, getPhoneValidation, getPostalCodeLimit,
  setCheckoutCheckboxes, setCheckoutFeature, setDifferentShipping, setPhoneValidation, setPostalCodeLimit, type FeatureSwitch,
} from '@db/queries/hub/checkout-settings';

// The checkout API keeps a cached copy of each shop's settings for 24 h.
// After a settings change in the database, the cache is refreshed the way the hub does it.
// The switch* functions change one setting for a test and put the old value back afterwards (cleanup).

/**
 * POST {api}/settings/refresh for the shop on every checkout API address given. The refresh runs in the
 * background, so it then waits until GET {api}/{apiKey}/styling shows the new value of `setting`.
 */
export async function refreshCheckoutSettings(
  request: APIRequestContext,
  apiUrls: string[],
  apiKey: string,
  setting: string,
  value: unknown,
) {
  for (const apiUrl of apiUrls) {
    await request.post(`${apiUrl}/settings/refresh?api_key=${apiKey}&update_only_if_outdated=1`, {
      headers: { Accept: 'application/json' },
    });
  }
  for (const apiUrl of apiUrls) {
    await expect
      .poll(() => readStylingValue(request, apiUrl, apiKey, setting), {
        message: `${setting} = ${String(value)} in ${apiUrl} styling`,
        timeout: 60_000,
      })
      .toEqual(value);
  }
}

/** One value of GET {api}/{apiKey}/styling, e.g. 'allow_notes' → true. A dot reads deeper: 'limits.delivery_countries'. */
export async function readStylingValue(request: APIRequestContext, apiUrl: string, apiKey: string, setting: string) {
  const response = await request.get(`${apiUrl}/${apiKey}/styling`, { headers: { Accept: 'application/json' } });
  let value = await response.json();
  for (const part of setting.split('.')) {
    value = value?.[part];
  }
  return value;
}

/** The checkout API addresses to refresh for a shop: the one in .env and the one the hub has for this shop. */
export async function checkoutApis(db: Databases, apiKey: string) {
  return [`${new URL(env.checkout.CHECKOUT_API_URL).origin}/v1`, await getCheckoutApiUrl(db.hub, apiKey)];
}

/** Sets a checkout feature switch for the test (e.g. 'allow_notes'), old value back after the test. */
export async function switchCheckoutFeature(
  db: Databases, request: APIRequestContext, cleanup: Cleanup, apiKey: string, name: FeatureSwitch, value: boolean,
) {
  const apis = await checkoutApis(db, apiKey);
  const oldValue = await getCheckoutFeature(db.hub, apiKey, name);
  cleanup.add(`${name} back to ${oldValue}`, async () => {
    await setCheckoutFeature(db.hub, apiKey, name, oldValue);
    await refreshCheckoutSettings(request, apis, apiKey, name, oldValue);
  });
  await setCheckoutFeature(db.hub, apiKey, name, value);
  await refreshCheckoutSettings(request, apis, apiKey, name, value);
}

/** Sets phone validation on or off for the test, old value back after the test. */
export async function switchPhoneValidation(
  db: Databases, request: APIRequestContext, cleanup: Cleanup, apiKey: string, value: boolean,
) {
  const apis = await checkoutApis(db, apiKey);
  const oldValue = await getPhoneValidation(db.hub, apiKey);
  cleanup.add(`validate_phone_number back to ${oldValue}`, async () => {
    await setPhoneValidation(db.hub, apiKey, oldValue);
    await refreshCheckoutSettings(request, apis, apiKey, 'validate_phone_number', oldValue);
  });
  await setPhoneValidation(db.hub, apiKey, value);
  await refreshCheckoutSettings(request, apis, apiKey, 'validate_phone_number', value);
}

/** Sets "different shipping address" on or off for the test, old value back after the test. */
export async function switchDifferentShipping(
  db: Databases, request: APIRequestContext, cleanup: Cleanup, apiKey: string, value: boolean,
) {
  const apis = await checkoutApis(db, apiKey);
  const oldValue = await getDifferentShipping(db.hub, apiKey);
  cleanup.add(`allow_different_shipping back to ${oldValue}`, async () => {
    await setDifferentShipping(db.hub, apiKey, oldValue);
    await refreshCheckoutSettings(request, apis, apiKey, 'allow_different_shipping', oldValue);
  });
  await setDifferentShipping(db.hub, apiKey, value);
  await refreshCheckoutSettings(request, apis, apiKey, 'allow_different_shipping', value);
}

/** Sets the postal code limit for the test (e.g. on, ['603xx']), old values back after the test. */
export async function switchPostalCodeLimit(
  db: Databases, request: APIRequestContext, cleanup: Cleanup, apiKey: string, on: boolean, postalCodes: string[],
) {
  const apis = await checkoutApis(db, apiKey);
  const old = await getPostalCodeLimit(db.hub, apiKey);
  cleanup.add('postal code limit back', async () => {
    await setPostalCodeLimit(db.hub, apiKey, old.limit_postal_codes, old.postal_codes);
    await refreshCheckoutSettings(request, apis, apiKey, 'limits.restricted_shipping_postal_code', old.limit_postal_codes);
  });
  await setPostalCodeLimit(db.hub, apiKey, on, postalCodes);
  await refreshCheckoutSettings(request, apis, apiKey, 'limits.restricted_shipping_postal_code', on);
}

/** Makes the first payment-step checkbox (terms) required or not for the test, old list back after the test. */
export async function switchFirstCheckboxRequired(
  db: Databases, request: APIRequestContext, cleanup: Cleanup, apiKey: string, required: boolean,
) {
  const apis = await checkoutApis(db, apiKey);
  const oldCheckboxes = await getCheckoutCheckboxes(db.hub, apiKey);
  cleanup.add('checkboxes back', async () => {
    await setCheckoutCheckboxes(db.hub, apiKey, oldCheckboxes);
    await refreshCheckoutSettings(request, apis, apiKey, 'checkboxes.0.required', oldCheckboxes[0]?.required);
  });
  const checkboxes = oldCheckboxes.map((checkbox, index) => (index === 0 ? { ...checkbox, required } : checkbox));
  await setCheckoutCheckboxes(db.hub, apiKey, checkboxes);
  await refreshCheckoutSettings(request, apis, apiKey, 'checkboxes.0.required', required);
}
