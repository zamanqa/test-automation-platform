import { testName } from '@data/random';

/** Request bodies for /vouchers. Same for both APIs. */

/** 20 EUR recurring one-time-use voucher valid until 2044. */
export function createVoucherPayload() {
  const suffix = Date.now();
  return {
    description: 'E2E Test Voucher',
    discount_amount: '20',
    discount_percent: null,
    email: null,
    expiry_date: '2044-04-01 00:00:00',
    name: testName(`voucher_${suffix}`),
    one_time_use: true,
    recurring_discount: true,
    valid: true,
    visible: true,
    voucher_code: `test-${suffix}`,
    specify_variants: true,
  };
}

/** Switches the voucher to 10% and turns it off. */
export function updateVoucherPayload(current: { voucher_code: string; name: string }) {
  return {
    voucher_code: current.voucher_code,
    name: `${current.name} Updated`,
    discount_percent: 10,
    one_time_use: false,
    recurring_discount: false,
    valid: false,
    visible: false,
  };
}
