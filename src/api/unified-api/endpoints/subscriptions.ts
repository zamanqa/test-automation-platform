import type { UnifiedApiClient } from '../UnifiedApiClient';

/** /subscriptions endpoints. */
export class SubscriptionsEndpoint {
  constructor(private readonly api: UnifiedApiClient) {}

  /** GET /subscriptions */
  list() {
    return this.api.company('GET', '/subscriptions');
  }

  /** GET /subscriptions/{subscriptionId} */
  get(subscriptionId: string) {
    return this.api.company('GET', `/subscriptions/${subscriptionId}`);
  }

  /** POST /subscriptions */
  create(body: unknown) {
    return this.api.company('POST', '/subscriptions', { data: body });
  }

  /** PUT /subscriptions/{subscriptionId} */
  update(subscriptionId: string, body: unknown) {
    return this.api.company('PUT', `/subscriptions/${subscriptionId}`, { data: body });
  }

  /** POST /subscriptions/{subscriptionId}/preview */
  preview(subscriptionId: string, body: unknown) {
    return this.api.company('POST', `/subscriptions/${subscriptionId}/preview`, { data: body });
  }

  /** Same as update() with one field */
  reactivate(subscriptionId: string) {
    return this.update(subscriptionId, { action: 'reactivate' });
  }

  /** Same as update() with one field */
  setAutoRenew(subscriptionId: string, autoRenew: boolean) {
    return this.update(subscriptionId, { action: 'auto_renew', auto_renew: autoRenew });
  }
}
