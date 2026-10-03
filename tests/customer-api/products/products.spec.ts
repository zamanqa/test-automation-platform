import { test, expect } from '@fixtures';
import { createProductPayload, createVariantPayload, updateVariantStockPayload } from '@data/payloads/customer-api/products';
import { findLatestActiveVariant, findNewestVariant, findProduct, findVariant } from '@db/queries/hub/products';

// Customer API - /products and /variants.
// Changes data: creates a product and a variant, changes the stock of a variant.
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
    // SETUP: newest active variant
    const variant = await findLatestActiveVariant(db.hub, customerApi.companyId);

    // ACTION: GET /products/{product_id}/variants
    const response = await customerApi.products.variantsOf(variant.product_id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('is_paginated');
  });

  test('creates a product', async ({ customerApi, db }) => {
    // ACTION: new product with a unique sku and a qa_auto_ title
    const response = await customerApi.products.create(createProductPayload());

    // CHECK: the new product is in the database
    expect([200, 201]).toContain(response.status());
    const { id } = await response.json();
    expect(id).toBeTruthy();
    expect(await findProduct(db.hub, customerApi.companyId, id)).toBeDefined();
  });

  test('creates a variant for the newest product', async ({ customerApi, db }) => {
    // SETUP: product of the newest variant (any status)
    const { product_id } = await findNewestVariant(db.hub, customerApi.companyId);

    // ACTION: POST /products/{product_id}/variants - monthly 12-month subscription variant
    const response = await customerApi.products.createVariant(product_id, createVariantPayload());

    // CHECK: the new variant is in the database
    expect([200, 201]).toContain(response.status());
    const { id } = await response.json();
    expect(id).toBeTruthy();
    expect(await findVariant(db.hub, customerApi.companyId, id)).toBeDefined();
  });

  test('updates the stock of the newest variant', async ({ customerApi, db }) => {
    // SETUP: newest variant; the body has a random stock of 1-100
    const variant = await findNewestVariant(db.hub, customerApi.companyId);
    const payload = updateVariantStockPayload();

    // ACTION: PUT /variants/{id}
    const response = await customerApi.products.updateVariant(variant.id, payload);

    // CHECK: the database has the stock we sent
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
