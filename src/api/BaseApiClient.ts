import { test, type APIRequestContext, type APIResponse } from '@playwright/test';

export type RequestOptions = {
  data?: unknown;
  // file upload as form-data, e.g. { file: { name, mimeType, buffer } }
  multipart?: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>;
  params?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  failOnStatusCode?: boolean; // default false: the test checks the status itself
  timeout?: number;
};

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// Base class of UnifiedApiClient, CustomerApiClient and HubApiClient.
// Each client builds its own URL and login header; send() makes the request.
//
// Example: unifiedApi.orders.cancel(id)
//   → endpoints/orders.ts → UnifiedApiClient.company() adds base URL + company id → send()
export abstract class BaseApiClient {
  // `request` is Playwright's HTTP client, made by the fixture
  constructor(protected readonly request: APIRequestContext) {}

  protected abstract authHeaders(): Promise<Record<string, string>>;

  protected async send(method: HttpMethod, url: string, options: RequestOptions = {}): Promise<APIResponse> {
    const { headers, failOnStatusCode = false, ...rest } = options;

    // JSON by default. For a file upload Playwright sets the content type itself.
    const contentType: Record<string, string> = options.multipart ? {} : { 'Content-Type': 'application/json' };
    const response = await this.request.fetch(url, {
      method,
      headers: {
        ...contentType,
        Accept: 'application/json',
        ...(await this.authHeaders()),
        ...headers,
      },
      failOnStatusCode,
      ...rest,
    });

    // On an error answer, attach the response to the report so a failed test shows why
    if (response.status() >= 400) {
      const answer = `${method} ${url} → ${response.status()}\n${(await response.text()).slice(0, 1000)}`;
      try {
        await test.info().attach('API answer', { body: answer, contentType: 'text/plain' });
      } catch {
        // not inside a test, nothing to attach to
      }
    }
    return response;
  }
}
