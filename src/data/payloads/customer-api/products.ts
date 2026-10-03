import { faker } from '@faker-js/faker';
import { testName } from '@data/random';

/** Request bodies for /products and /variants on the Customer API. */

const PICTURE = 'https://www.dbu.de/inc/phpThumb/phpThumb.php?src=/nadi/media/230921040008_303001.png';

/** POST /products body: unique sku + title (timestamp, qa_auto_ prefix), stock 50. */
export function createProductPayload() {
  const suffix = Date.now();
  return {
    allow_order_create: true,
    brand: 'Circuly',
    category: 'Footwear',
    buyout_retail_price: 199.99,
    meta: {},
    msrp: 249.99,
    picture_url: PICTURE,
    product_collection_id: null,
    purchase_price: 150.0,
    sku: `NK-AIR-${suffix}`,
    stock: 50,
    sync_stock: true,
    title: testName(`air_max_90_${suffix}`),
    type: 'normal',
  };
}

/** Monthly 12-month subscription variant, black / M. */
export function createVariantPayload() {
  const suffix = Date.now();
  return {
    allow_order_create: true,
    prepaid_duration: 1,
    price: 49.99,
    subscription_item: true,
    thumbnail: PICTURE,
    notify_period_before_end: 7,
    title: testName(`monthly_sub_${suffix}`),
    sku: `NK-AIR-BLK-M-${suffix}`,
    bundle_id: null,
    stock: 50,
    subscription_extension_price: 550.22,
    buyout_retail_price: 550.22,
    condition: 'new',
    duration: 12,
    frequency: 'monthly',
    options: [
      { key: 'color', value: 'black' },
      { key: 'size', value: 'M' },
    ],
  };
}

/** Variant update with a random stock of 1-100. */
export function updateVariantStockPayload() {
  return {
    allow_order_create: true,
    buyout_retail_price: 199.99,
    notify_period_before_end: 7,
    price: 49.99,
    sku: 'SKU-001',
    stock: faker.number.int({ min: 1, max: 100 }),
    subscription_extension_price: 9.99,
    title: 'Sample Product Title',
  };
}
