import type { CustomerApiClient } from '../CustomerApiClient';

/** /subscriptions endpoints of the Customer API. */
export class SubscriptionsEndpoint {
  constructor(private readonly api: CustomerApiClient) {}

  /** GET {base}/api/{version}/subscriptions. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.call('GET', '/subscriptions');
  }

  /** GET {base}/api/{version}/subscriptions/{subscriptionId} — params: subscriptionId: string. Returns Playwright's APIResponse (test checks status/body). */
  get(subscriptionId: string) {
    return this.api.call('GET', `/subscriptions/${subscriptionId}`);
  }

  /** POST {base}/api/{version}/subscriptions — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  create(body: unknown) {
    return this.api.call('POST', '/subscriptions', { data: body });
  }

  /** PUT {base}/api/{version}/subscriptions/{subscriptionId} — params: subscriptionId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  update(subscriptionId: string, body: unknown) {
    return this.api.call('PUT', `/subscriptions/${subscriptionId}`, { data: body });
  }

  /** POST {base}/api/{version}/subscriptions/{subscriptionId}/notes — params: subscriptionId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  addNote(subscriptionId: string, body: unknown) {
    return this.api.call('POST', `/subscriptions/${subscriptionId}/notes`, { data: body });
  }

  /** POST {base}/api/{version}/subscriptions/{subscriptionId}/reactivate — params: subscriptionId: string. Returns Playwright's APIResponse (test checks status/body). */
  reactivate(subscriptionId: string) {
    return this.api.call('POST', `/subscriptions/${subscriptionId}/reactivate`);
  }

  /** PUT {base}/api/{version}/subscriptions/{subscriptionId}/auto-renew — params: subscriptionId: string, autoRenew: boolean. Returns Playwright's APIResponse (test checks status/body). */
  setAutoRenew(subscriptionId: string, autoRenew: boolean) {
    return this.api.call('PUT', `/subscriptions/${subscriptionId}/auto-renew`, { data: { auto_renew: autoRenew } });
  }
}
