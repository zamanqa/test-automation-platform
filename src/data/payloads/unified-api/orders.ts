import { testEmail } from '@data/random';

// Bodies for the Unified API /orders endpoints.
// The products are fixed ids on dev; if they are deleted there, update them here.

const germanAddress = {
  address_addition: '',
  alpha2: 'de',
  alpha3: '',
  city: 'Frankfurt am Main',
  company: '',
  country: 'Germany',
  first_name: 'Shahiduz',
  last_name: 'Zaman',
  note: '',
  postal_code: '60320',
  region: null,
  street: 'Hansaallee',
  street_number: '139',
};

const subscriptionItemDefaults = {
  discount_amount: 0,
  expected_revenue: 0,
  site_id: null,
  subscription: true,
  subscription_duration: 10,
  subscription_duration_prepaid: 1,
  subscription_end: '2027-02-15',
  subscription_frequency: 'monthly',
  subscription_frequency_interval: 1,
  subscription_start: '2026-04-16',
  voucher_code: null,
};

// POST /orders/full body: 2 subscription items, German address, random qa_auto_ email.
// chargeByInvoice true = pay by invoice, false = charge the card later.
export function createOrderPayload({ chargeByInvoice = true } = {}) {
  return {
    remarks: '',
    charge_by_invoice: chargeByInvoice,
    billing: { ...germanAddress },
    shipping: { ...germanAddress },
    currency: 'EUR',
    discount: 0,
    email: testEmail(),
    is_tax_free: false,
    order_items: [
      {
        ...subscriptionItemDefaults,
        name: 'Simple product no variant | White / Medium',
        original_price: 0.56,
        price: 0.56,
        product_id: '6466',
        quantity: 2,
        sku: '43014354632842',
        sku_name: '24890002',
        subscription_type: 'normal',
        thumbnail:
          'https://cdn.shopify.com/s/files/1/0371/7631/1946/files/download_ad3c11c0-9efa-4cda-ab03-fc6ba07e8400.jpg?v=1695297013',
        variant_id: '7819',
        shop_variant_id: '43014354632842',
      },
      {
        ...subscriptionItemDefaults,
        name: 'Product Sync Test | S',
        original_price: 55,
        price: 55,
        product_id: '6465',
        quantity: 1,
        sku: '47124960510090',
        sku_name: 'SKU-5864',
        subscription_type: 'consumable',
        thumbnail: 'https://cdn.shopify.com/s/files/1/0371/7631/1946/files/1884787.jpg?v=1704999519',
        variant_id: '7815',
        shop_variant_id: '47124960510090',
      },
    ],
    order_name: '',
    phone: '4917656824720',
    shipping_amount: 0,
    status: 'open',
    total_item_count: 2,
    vat_number: '',
  };
}
