import type { APIRequestContext } from '@playwright/test';

const HEALTHY = [200, 301, 302];

// Calls a URL until the server answers. Heroku / Cloud Run servers sleep when idle.
// Throws if it is still down after all attempts, unless required is false.
export async function wakeUp(
  request: APIRequestContext,
  url: string,
  { attempts = 2, delayMs = 15_000, okStatuses = HEALTHY, required = true } = {},
): Promise<void> {
  let lastStatus = 0;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await request.get(url, { failOnStatusCode: false, timeout: 30_000 }).catch(() => null);
    lastStatus = response ? response.status() : 0;
    if (okStatuses.includes(lastStatus)) return;

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (!required) return;
  throw new Error(`${url} is not healthy after ${attempts} attempts (last status: ${lastStatus})`);
}
