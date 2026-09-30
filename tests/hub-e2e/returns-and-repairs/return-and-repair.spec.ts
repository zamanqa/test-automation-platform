// test, expect              ← src/fixtures/index.ts
// getLocationStatus         ← src/db/queries/hub/product-trackings.ts
// findSerialNumberForReturn ← src/db/queries/hub/subscriptions.ts
import { test, expect } from '@fixtures';
import { getLocationStatus } from '@db/queries/hub/product-trackings';
import { findSerialNumberForReturn } from '@db/queries/hub/subscriptions';

/**
 * WHAT:   Hub UI → Returns list → Repairs list: an asset's full return-and-repair cycle.
 * FROM:   hub-e2e-automation cypress/e2e/05-repair-and-return/return-and-repair-workflow.cy.js.
 *         The 3 Cypress tests were one flow on the same asset (return → repair → check stock),
 *         so they are one test with steps here.
 * NEEDS:  an active normal checkout subscription (> 5 cycles) with a real serial number.
 * CHANGES DATA: yes — the asset goes 'to repair' and then back 'in stock'.
 * returnsAndRepairsPage methods ← src/pages/hub/ReturnsAndRepairsPage.ts
 */
test.describe('Hub - return and repair', () => {
  test('a returned asset goes to repair and comes back into stock', async ({ returnsAndRepairsPage, db, hubCompanyId }) => {
    // SETUP: serial number of a suitable subscription ← hub db
    const serialNumber = await findSerialNumberForReturn(db.hub, hubCompanyId);

    // Step 1 — ACTION: Returns list → search serial → Handle → Mark as returned
    //          CHECK:  product_trackings.location_status becomes 'to repair'
    await test.step('mark as returned → "to repair"', async () => {
      await returnsAndRepairsPage.markReturned(serialNumber);
      await expect.poll(() => getLocationStatus(db.hub, serialNumber)).toBe('to repair');
    });

    // Step 2 — ACTION: Repairs list → search serial → open → Start repair → Submit
    //          CHECK:  location_status becomes 'in stock'
    await test.step('repair → "in stock"', async () => {
      await returnsAndRepairsPage.repair(serialNumber);
      await expect.poll(() => getLocationStatus(db.hub, serialNumber)).toBe('in stock');
    });
  });
});
