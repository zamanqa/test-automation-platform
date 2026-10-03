import { test as setup } from '@fixtures';
import { env } from '@config/env';
import { wakeUp } from '@api/health-check';

// Wakes the checkout API once before the checkout tests. It never fails the run,
// it only gives a sleeping server time to start.
setup('wake up the checkout API', async ({ request }) => {
  await wakeUp(request, env.checkout.CHECKOUT_API_URL, { required: false });
});
