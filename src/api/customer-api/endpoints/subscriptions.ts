import type { CustomerApiClient } from '../CustomerApiClient';

/** /subscriptions endpoints. */
export class SubscriptionsEndpoint {
  constructor(private readonly api: CustomerApiClient) {}

  /** GET /subscriptions */
  list() {
    return this.api.call('GET', '/subscriptions');
  }

  /** GET /subscriptions/{subscriptionId} */
  get(subscriptionId: string) {
    return this.api.call('GET', `/subscriptions/${subscriptionId}`);
  }

  /** POST /subscriptions */
  create(body: unknown) {
    return this.api.call('POST', '/subscriptions', { data: body });
  }

  /** PUT /subscriptions/{subscriptionId} */
  update(subscriptionId: string, body: unknown) {
    return this.api.call('PUT', `/subscriptions/${subscriptionId}`, { data: body });
  }

  /** POST /subscriptions/{subscriptionId}/notes */
  addNote(subscriptionId: string, body: unknown) {
    return this.api.call('POST', `/subscriptions/${subscriptionId}/notes`, { data: body });
  }

  /** POST /subscriptions/{subscriptionId}/reactivate */
  reactivate(subscriptionId: string) {
    return this.api.call('POST', `/subscriptions/${subscriptionId}/reactivate`);
  }

  /** PUT /subscriptions/{subscriptionId}/auto-renew */
  setAutoRenew(subscriptionId: string, autoRenew: boolean) {
    return this.api.call('PUT', `/subscriptions/${subscriptionId}/auto-renew`, { data: { auto_renew: autoRenew } });
  }
}
