import { test, expect } from '@fixtures';
import { getLocationStatus } from '@db/queries/hub/product-trackings';
import { findSerialNumberForReturn } from '@db/queries/hub/subscriptions';

// Hub → Returns list → Repairs list: an asset is returned, repaired and back in stock.
// Needs: an active normal checkout subscription (more than 5 cycles) with a real serial number.
// Changes data: the asset goes to 'to repair' and then back to 'in stock'.
test.describe('Hub - return and repair', () => {
  test('a returned asset goes to repair and comes back into stock', async ({ returnsAndRepairsPage, db, hubCompanyId }) => {
    // SETUP: serial number of a suitable subscription
    const serialNumber = await findSerialNumberForReturn(db.hub, hubCompanyId);

    // Returns list → search serial → Handle → Mark as returned → status 'to repair'
    await test.step('mark as returned → "to repair"', async () => {
      await returnsAndRepairsPage.markReturned(serialNumber);
      await expect.poll(() => getLocationStatus(db.hub, serialNumber)).toBe('to repair');
    });

    // Repairs list → search serial → open → Start repair → Submit → status 'in stock'
    await test.step('repair → "in stock"', async () => {
      await returnsAndRepairsPage.repair(serialNumber);
      await expect.poll(() => getLocationStatus(db.hub, serialNumber)).toBe('in stock');
    });
  });
});
