import { test, expect } from '@fixtures';
import { findLatestActiveProduct, findLatestActiveVariant, findVariant } from '@db/queries/hub/products';

// Unified API - /products and variants (read only).
// Needs: active products/variants.
// Changes data: no.
test.describe('Unified API - products and variants', () => {
  test('returns a list of products', async ({ unifiedApi, db }) => {
    // SETUP: make sure the company has an active product (throws if not)
    await findLatestActiveProduct(db.hub, await unifiedApi.companyId());

    // ACTION: GET /products
    const response = await unifiedApi.products.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('returns a paginated list of variants', async ({ unifiedApi }) => {
    // ACTION: GET /products/variants
    const response = await unifiedApi.products.variants();

    // CHECK: paginated response with data
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('is_paginated', true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  test('returns the variants of a product', async ({ unifiedApi, db }) => {
    // SETUP: newest active variant → its product_id
    const variant = await findLatestActiveVariant(db.hub, await unifiedApi.companyId());

    // ACTION: GET /products/{product_id}/variants
    const response = await unifiedApi.products.variantsOf(variant.product_id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('is_paginated');
  });

  test('returns the variants of a product that owns a known variant', async ({ unifiedApi, db }) => {
    // SETUP: same variant as above
    const companyId = await unifiedApi.companyId();
    const variant = await findLatestActiveVariant(db.hub, companyId);

    // ACTION: GET /products/{product_id}/variants
    const response = await unifiedApi.products.variantsOf(variant.product_id);

    // CHECK: API answers, and the variant exists by id in the database
    expect(response.status()).toBe(200);
    expect(await findVariant(db.hub, companyId, variant.id)).toBeDefined();
  });
});
