import type { CustomerApiClient } from '../CustomerApiClient';

/** CSV download and background exports */
export class ExportsEndpoint {
  constructor(private readonly api: CustomerApiClient) {}

  /** POST /CSV - body: { type, ids?, limit?, exclude?, rename? }. Answers with the CSV text right away. */
  csv(body: unknown) {
    return this.api.call('POST', '/CSV', { data: body });
  }

  /** POST /export - body: { type, limit, from, until, format }. Starts a background export, answers with its key. */
  start(body: unknown) {
    return this.api.call('POST', '/export', { data: body });
  }

  /** GET /exports/{key} - key from start(). 404 "Export ID not found" until the export is ready. */
  download(key: string) {
    return this.api.call('GET', `/exports/${key}`);
  }
}
