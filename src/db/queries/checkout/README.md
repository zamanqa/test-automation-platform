# Checkout database queries

Empty until the checkout database connection details are in `.env`
(`CHECKOUT_DB_*`). Add one file per table/topic, following `../hub/orders.ts`:

```ts
import type { Database } from '@db/connection';

export function findCart(checkout: Database, cartId: string) {
  return checkout.one('SELECT * FROM carts WHERE id = $1', [cartId]);
}
```
