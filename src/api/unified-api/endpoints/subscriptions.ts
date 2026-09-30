import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /subscriptions endpoints. */
export class SubscriptionsEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET {base}/{version}/{companyId}/subscriptions. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.company('GET', '/subscriptions');
  }

  /** GET {base}/{version}/{companyId}/subscriptions/{subscriptionId} — params: subscriptionId: string. Returns Playwright's APIResponse (test checks status/body). */
  get(subscriptionId: string) {
    return this.api.company('GET', `/subscriptions/${subscriptionId}`);
  }

  /** POST {base}/{version}/{companyId}/subscriptions — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  create(body: unknown) {
    return this.api.company('POST', '/subscriptions', { data: body });
  }

  /** PUT {base}/{version}/{companyId}/subscriptions/{subscriptionId} — params: subscriptionId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  update(subscriptionId: string, body: unknown) {
    return this.api.company('PUT', `/subscriptions/${subscriptionId}`, { data: body });
  }

  /** POST {base}/{version}/{companyId}/subscriptions/{subscriptionId}/preview — params: subscriptionId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  preview(subscriptionId: string, body: unknown) {
    return this.api.company('POST', `/subscriptions/${subscriptionId}/preview`, { data: body });
  }

  /** Shortcut for update(...) above — params: subscriptionId: string. Returns Playwright's APIResponse (test checks status/body). */
  reactivate(subscriptionId: string) {
    return this.update(subscriptionId, { action: 'reactivate' });
  }

  /** Shortcut for update(...) above — params: subscriptionId: string, autoRenew: boolean. Returns Playwright's APIResponse (test checks status/body). */
  setAutoRenew(subscriptionId: string, autoRenew: boolean) {
    return this.update(subscriptionId, { action: 'auto_renew', auto_renew: autoRenew });
  }
}
