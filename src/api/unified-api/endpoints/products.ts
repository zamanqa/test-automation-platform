import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /products endpoints. */
export class ProductsEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET {base}/{version}/{companyId}/products. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.company('GET', '/products');
  }

  /** GET {base}/{version}/{companyId}/products/variants. Returns Playwright's APIResponse (test checks status/body). */
  variants() {
    return this.api.company('GET', '/products/variants');
  }

  /** GET {base}/{version}/{companyId}/products/{productId}/variants — params: productId: string | number. Returns Playwright's APIResponse (test checks status/body). */
  variantsOf(productId: string | number) {
    return this.api.company('GET', `/products/${productId}/variants`);
  }
}
