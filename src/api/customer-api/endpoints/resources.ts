import type { CustomerApiClient } from '../CustomerApiClient';

/**
 * Smaller Customer API resources, one class each: deliveries, draft orders,
 * transactions, recurring payments, product tracking, products, retailers,
 * vouchers, notes and debtist.
 */

export class DeliveriesEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET {base}/api/{version}/deliveries. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.call('GET', '/deliveries');
  }
  /** date: YYYY-MM-DD */
  onDate(shippingDate: string) {
    return this.api.call('GET', `/deliveries/${encodeURIComponent(shippingDate)}`);
  }
}

export class DraftOrdersEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET {base}/api/{version}/draft-orders. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.call('GET', '/draft-orders');
  }
  /** GET {base}/api/{version}/draft-orders/{id} — params: id: string. Returns Playwright's APIResponse (test checks status/body). */
  get(id: string) {
    return this.api.call('GET', `/draft-orders/${id}`);
  }
  /** POST {base}/api/{version}/draft-orders — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  create(body: unknown) {
    return this.api.call('POST', '/draft-orders', { data: body });
  }
  /** DELETE {base}/api/{version}/draft-orders/{id} — params: id: string. Returns Playwright's APIResponse (test checks status/body). */
  delete(id: string) {
    return this.api.call('DELETE', `/draft-orders/${id}`);
  }
}

export class TransactionsEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET {base}/api/{version}/transactions. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.call('GET', '/transactions');
  }
  /** GET {base}/api/{version}/transactions/{transactionId} — params: transactionId: string. Returns Playwright's APIResponse (test checks status/body). */
  get(transactionId: string) {
    return this.api.call('GET', `/transactions/${transactionId}`);
  }
  /** GET {base}/api/{version}/transactions?order_id={orderId} — only the transactions of one order. */
  listByOrder(orderId: string) {
    return this.api.call('GET', '/transactions', { params: { order_id: orderId } });
  }
}

export class RecurringPaymentsEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET {base}/api/{version}/recurring-payments. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.call('GET', '/recurring-payments');
  }
  /** GET {base}/api/{version}/recurring-payments/{id} — params: id: string | number. Returns Playwright's APIResponse (test checks status/body). */
  get(id: string | number) {
    return this.api.call('GET', `/recurring-payments/${id}`);
  }
}

export class ProductTrackingEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET {base}/api/{version}/product-tracking. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.call('GET', '/product-tracking');
  }
  /** GET {base}/api/{version}/product-tracking/{serialNumber} — params: serialNumber: string. Returns Playwright's APIResponse (test checks status/body). */
  get(serialNumber: string) {
    return this.api.call('GET', `/product-tracking/${serialNumber}`);
  }
  /** POST {base}/api/{version}/product-tracking/{serialNumber}/repair — params: serialNumber: string, deleteRecurringPayments = true. Returns Playwright's APIResponse (test checks status/body). */
  repair(serialNumber: string, deleteRecurringPayments = true) {
    return this.api.call('POST', `/product-tracking/${serialNumber}/repair`, { data: { delete_rps: deleteRecurringPayments } });
  }
  /** POST {base}/api/{version}/product-tracking/{serialNumber}/stock — params: serialNumber: string, location = 'Berlin', doNotRestock = false. Returns Playwright's APIResponse (test checks status/body). */
  stock(serialNumber: string, location = 'Berlin', doNotRestock = false) {
    return this.api.call('POST', `/product-tracking/${serialNumber}/stock`, {
      params: { do_not_restock: doNotRestock },
      data: { location },
    });
  }
}

export class ProductsEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET {base}/api/{version}/products. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.call('GET', '/products');
  }
  /** POST {base}/api/{version}/products — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  create(body: unknown) {
    return this.api.call('POST', '/products', { data: body });
  }
  /** GET {base}/api/{version}/variants. Returns Playwright's APIResponse (test checks status/body). */
  variants() {
    return this.api.call('GET', '/variants');
  }
  /** GET {base}/api/{version}/products/{productId}/variants — params: productId: string | number. Returns Playwright's APIResponse (test checks status/body). */
  variantsOf(productId: string | number) {
    return this.api.call('GET', `/products/${productId}/variants`);
  }
  /** POST {base}/api/{version}/products/{productId}/variants — params: productId: string | number, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  createVariant(productId: string | number, body: unknown) {
    return this.api.call('POST', `/products/${productId}/variants`, { data: body });
  }
  /** PUT {base}/api/{version}/variants/{variantId} — params: variantId: string | number, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  updateVariant(variantId: string | number, body: unknown) {
    return this.api.call('PUT', `/variants/${variantId}`, { data: body });
  }
}

export class RetailersEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET {base}/api/{version}/retailers. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.call('GET', '/retailers');
  }
  /** GET {base}/api/{version}/retailers/{locationId} — params: locationId: string. Returns Playwright's APIResponse (test checks status/body). */
  byLocation(locationId: string) {
    return this.api.call('GET', `/retailers/${locationId}`);
  }
  /** POST {base}/api/{version}/retailers — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  create(body: unknown) {
    return this.api.call('POST', '/retailers', { data: body });
  }
  /** PUT {base}/api/{version}/retailers/{retailerId} — params: retailerId: string, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  update(retailerId: string, body: unknown) {
    return this.api.call('PUT', `/retailers/${retailerId}`, { data: body });
  }
}

export class VouchersEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET {base}/api/{version}/vouchers. Returns Playwright's APIResponse (test checks status/body). */
  list() {
    return this.api.call('GET', '/vouchers');
  }
  /** GET {base}/api/{version}/vouchers/{code} — params: code: string. Returns Playwright's APIResponse (test checks status/body). */
  byCode(code: string) {
    return this.api.call('GET', `/vouchers/${code}`);
  }
  /** POST {base}/api/{version}/vouchers — params: body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  create(body: unknown) {
    return this.api.call('POST', '/vouchers', { data: body });
  }
  /** PUT {base}/api/{version}/vouchers/{voucherId} — params: voucherId: string | number, body: unknown. Returns Playwright's APIResponse (test checks status/body). */
  update(voucherId: string | number, body: unknown) {
    return this.api.call('PUT', `/vouchers/${voucherId}`, { data: body });
  }
}

export type NoteFilter = { order_id?: string; customer_id?: string; subscription_id?: string; transaction_id?: string };

export class NotesEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET {base}/api/{version}/notes — params: filter: NoteFilter = {}. Returns Playwright's APIResponse (test checks status/body). */
  list(filter: NoteFilter = {}) {
    const params = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined)) as Record<string, string>;
    return this.api.call('GET', '/notes', { params });
  }
  /** GET {base}/api/{version}/notes/{noteId} — params: noteId: string | number. Returns Playwright's APIResponse (test checks status/body). */
  get(noteId: string | number) {
    return this.api.call('GET', `/notes/${noteId}`);
  }
}

export class DebtistEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET {base}/api/{version}/debtist/claims. Returns Playwright's APIResponse (test checks status/body). */
  claims() {
    return this.api.call('GET', '/debtist/claims');
  }
  /** GET {base}/api/{version}/debtist/claims/{claimId} — params: claimId: string. Returns Playwright's APIResponse (test checks status/body). */
  claim(claimId: string) {
    return this.api.call('GET', `/debtist/claims/${claimId}`);
  }
  /** GET {base}/api/{version}/debtist/invoice/{invoiceId}/claim — params: invoiceId: string. Returns Playwright's APIResponse (test checks status/body). */
  claimOfInvoice(invoiceId: string) {
    return this.api.call('GET', `/debtist/invoice/${invoiceId}/claim`);
  }
  /** POST {base}/api/{version}/debtist/invoice/{invoiceId}/claim — params: invoiceId: string. Returns Playwright's APIResponse (test checks status/body). */
  fileClaim(invoiceId: string) {
    return this.api.call('POST', `/debtist/invoice/${invoiceId}/claim`);
  }
  /** GET {base}/api/{version}/debtist/invoices. Returns Playwright's APIResponse (test checks status/body). */
  invoices() {
    return this.api.call('GET', '/debtist/invoices');
  }
  /** GET {base}/api/{version}/debtist/customers. Returns Playwright's APIResponse (test checks status/body). */
  customers() {
    return this.api.call('GET', '/debtist/customers');
  }
  /** POST {base}/api/{version}/debtist/invoice/{invoiceId}/uploads — form-data "file" (a PDF). Invoice must be in a claim. Answers { upload_id: "media/<folder>/<file>" }. */
  uploadFile(invoiceId: string, fileName: string, pdf: Buffer) {
    return this.api.call('POST', `/debtist/invoice/${invoiceId}/uploads`, {
      multipart: { file: { name: fileName, mimeType: 'application/pdf', buffer: pdf } },
    });
  }
  /** GET {base}/api/{version}/debtist/invoice/{invoiceId}/uploads/{uploadId} — uploadId ← upload_id from uploadFile(). Answers the file. */
  downloadFile(invoiceId: string, uploadId: string) {
    return this.api.call('GET', `/debtist/invoice/${invoiceId}/uploads/${uploadId}`);
  }
}
