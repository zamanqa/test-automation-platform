import type { CustomerApiClient } from '../CustomerApiClient';

/** Export endpoints of the Customer API: CSV download and background exports. */
export class ExportsEndpoint {
  constructor(private readonly api: CustomerApiClient) {}

  /** POST {base}/api/{version}/CSV — body: { type, ids?, limit?, exclude?, rename? }. Answers with the CSV text right away. */
  csv(body: unknown) {
    return this.api.call('POST', '/CSV', { data: body });
  }

  /** POST {base}/api/{version}/export — body: { type, limit, from, until, format }. Starts a background export, answers with its key. */
  start(body: unknown) {
    return this.api.call('POST', '/export', { data: body });
  }

  /** GET {base}/api/{version}/exports/{key} — key from start(). 404 "Export ID not found" until the export is ready. */
  download(key: string) {
    return this.api.call('GET', `/exports/${key}`);
  }
}
