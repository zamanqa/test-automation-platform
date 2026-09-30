import { test, type APIRequestContext, type APIResponse } from '@playwright/test';

export type RequestOptions = {
  data?: unknown;
  /** File upload (form-data), e.g. { file: { name, mimeType, buffer } }. Sent instead of JSON. */
  multipart?: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>;
  params?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  /** Defaults to false: tests assert on the status themselves. */
  failOnStatusCode?: boolean;
  timeout?: number;
};

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Shared HTTP plumbing for every API client. Subclasses decide only two things:
 * how a path becomes a URL, and which auth headers to send.
 *
 * CLASS CHAIN (same for all three APIs):
 *
 *   BaseApiClient                 ← this file: send() = the one place an HTTP call happens
 *     ├─ UnifiedApiClient         JWT login;   company(), cssRequest() build the URL, then call send()
 *     ├─ CustomerApiClient        basic auth;  call() builds the URL, then calls send()
 *     └─ HubApiClient             JWT login;   triggerRecurringPayments() etc. call send()
 *
 *   Each client also owns "endpoint groups" (e.g. unifiedApi.orders, unifiedApi.invoices).
 *   An endpoint group only knows paths; it calls back into its client:
 *
 *   test:  unifiedApi.orders.cancel(id)
 *     → OrdersEndpoint.cancel()              src/api/unified-api/endpoints/orders.ts
 *     → UnifiedApiClient.company('POST', `/orders/${id}/cancel`)   adds base URL + company id
 *     → BaseApiClient.send()                 adds JSON + auth headers (authHeaders() of the subclass)
 *     → Playwright request.fetch()           the actual HTTP request; returns APIResponse to the test
 */
export abstract class BaseApiClient {
  /**
   * `request` is Playwright's HTTP client, created in src/fixtures/index.ts and passed
   * down through the subclass constructor (`super(request)` or the inherited constructor).
   * `protected` = subclasses can use it, tests cannot.
   */
  constructor(protected readonly request: APIRequestContext) {}

  /** Implemented by each subclass: Bearer token, Basic auth, ... Called on every send(). */
  protected abstract authHeaders(): Promise<Record<string, string>>;

  /** Called by the subclasses' URL helpers (company(), call(), trigger...()). Never by tests directly. */
  protected async send(method: HttpMethod, url: string, options: RequestOptions = {}): Promise<APIResponse> {
    const { headers, failOnStatusCode = false, ...rest } = options;
    // JSON by default; for a file upload Playwright sets the form-data Content-Type itself
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

    // Error answer (400 and up): save what the API said, so a failed test shows WHY in
    // the run report reports/<suite>/<run>/index.html and in the html report (attachment "API answer").
    if (response.status() >= 400) {
      const answer = `${method} ${url} → ${response.status()}\n${(await response.text()).slice(0, 1000)}`;
      try {
        await test.info().attach('API answer', { body: answer, contentType: 'text/plain' });
      } catch {
        // called outside a running test (e.g. a helper script) → nothing to attach to
      }
    }
    return response;
  }
}
