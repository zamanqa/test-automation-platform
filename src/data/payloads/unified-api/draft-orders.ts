import dayjs from 'dayjs';
import { testEmail } from '@data/random';
import type { SubscriptionVariantRow } from '@db/queries/hub/products';

// POST /draft-orders body. The product comes from the variant row the test found in the database.

const address = {
  address_addition: '12',
  alpha2: 'de',
  alpha3: '',
  city: 'Frankfurt am Main',
  company: '',
  country: 'Germany',
  first_name: 'E2E',
  last_name: 'Test',
  note: '',
  postal_code: '60320',
  region: null,
  street: 'Fritz Str.',
  street_number: '21',
};

/** One-month subscription draft order for the given variant, starting today. */
export function draftOrderPayload(variant: SubscriptionVariantRow) {
  const today = dayjs();
  return {
    remarks: '',
    charge_by_invoice: false,
    customer: {
      email: testEmail('circuly.io'),
      phone: '+4928388',
      vat_number: '',
      external_customer_id: `e2e-${Date.now()}`,
      default_locale: 'de',
      date_of_birth: null,
      marketing_consent: false,
      billing: { ...address },
      shipping: { ...address },
    },
    items: [
      {
        discount_amount: 0,
        expected_revenue: 0,
        name: `${variant.product_name} | ${variant.variant_name}`,
        price: Number(variant.price),
        product_id: Number(variant.product_id),
        quantity: 1,
        sku: String(variant.shop_variant_id),
        sku_name: variant.sku,
        subscription: true,
        subscription_duration: 1,
        subscription_duration_prepaid: 1,
        subscription_end: today.add(1, 'month').format('YYYY-MM-DD'),
        subscription_frequency: 'monthly',
        subscription_frequency_interval: 1,
        subscription_start: today.format('YYYY-MM-DD'),
        subscription_type: 'normal',
        thumbnail: '',
        variant_id: Number(variant.variant_id),
        voucher_code: null,
        shop_variant_id: String(variant.shop_variant_id),
      },
    ],
  };
}
