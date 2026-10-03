import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /products endpoints. */
export class ProductsEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET /products */
  list() {
    return this.api.company('GET', '/products');
  }

  /** GET /products/variants */
  variants() {
    return this.api.company('GET', '/products/variants');
  }

  /** GET /products/{productId}/variants */
  variantsOf(productId: string | number) {
    return this.api.company('GET', `/products/${productId}/variants`);
  }
}
