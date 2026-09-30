// test, expect        ← src/fixtures/index.ts
// create/update...Payload ← src/data/payloads/customer-api/products.ts
// find...             ← src/db/queries/hub/products.ts
import { test, expect } from '@fixtures';
import { createProductPayload, createVariantPayload, updateVariantStockPayload } from '@data/payloads/customer-api/products';
import { findLatestActiveVariant, findNewestVariant, findProduct, findVariant } from '@db/queries/hub/products';

/**
 * WHAT:   OLD Customer API — /products, /variants.
 * FROM:   cus-api cypress/e2e/customer-api/11-product/product-variants.cy.js (7 tests).
 * CHANGES DATA: yes — creates a product, creates a variant, changes a variant's stock.
 * (The Unified API suite only has the 4 read tests.)
 */
test.describe('Customer API - products and variants', () => {
  test('returns a list of products', async ({ customerApi }) => {
    // ACTION: GET /products
    const response = await customerApi.products.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('returns a paginated list of variants', async ({ customerApi }) => {
    // ACTION: GET /variants
    const response = await customerApi.products.variants();

    // CHECK
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('is_paginated', true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  test('returns the variants of a product', async ({ customerApi, db }) => {
    // SETUP: newest active variant → product_id ← hub db
    const variant = await findLatestActiveVariant(db.hub, customerApi.companyId);

    // ACTION: GET /products/{product_id}/variants
    const response = await customerApi.products.variantsOf(variant.product_id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('is_paginated');
  });

  test('creates a product', async ({ customerApi, db }) => {
    // ACTION: POST /products — unique sku/title (timestamp + qa_auto_ prefix)
    const response = await customerApi.products.create(createProductPayload());

    // CHECK: new `id` ← API response exists in the products table
    expect([200, 201]).toContain(response.status());
    const { id } = await response.json();
    expect(id).toBeTruthy();
    expect(await findProduct(db.hub, customerApi.companyId, id)).toBeDefined();
  });

  test('creates a variant for the newest product', async ({ customerApi, db }) => {
    // SETUP: product of the most recently created variant (any status) ← hub db
    const { product_id } = await findNewestVariant(db.hub, customerApi.companyId);

    // ACTION: POST /products/{product_id}/variants — monthly 12-month subscription variant
    const response = await customerApi.products.createVariant(product_id, createVariantPayload());

    // CHECK: new variant `id` ← API response exists in product_variants
    expect([200, 201]).toContain(response.status());
    const { id } = await response.json();
    expect(id).toBeTruthy();
    expect(await findVariant(db.hub, customerApi.companyId, id)).toBeDefined();
  });

  test('updates the stock of the newest variant', async ({ customerApi, db }) => {
    // SETUP: newest variant; payload has a random stock 1..100 (← payload.stock)
    const variant = await findNewestVariant(db.hub, customerApi.companyId);
    const payload = updateVariantStockPayload();

    // ACTION: PUT /variants/{id}
    const response = await customerApi.products.updateVariant(variant.id, payload);

    // CHECK: the database stock equals the value we sent
    expect([200, 201]).toContain(response.status());
    expect(Number((await findVariant(db.hub, customerApi.companyId, variant.id))?.stock)).toBe(payload.stock);
  });

  test('returns the variants of a product that owns a known variant', async ({ customerApi, db }) => {
    // SETUP
    const variant = await findLatestActiveVariant(db.hub, customerApi.companyId);

    // ACTION: GET /products/{product_id}/variants
    const response = await customerApi.products.variantsOf(variant.product_id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await findVariant(db.hub, customerApi.companyId, variant.id)).toBeDefined();
  });
});
