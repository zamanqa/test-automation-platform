import type { CustomerApiClient } from '../CustomerApiClient';

// The smaller Customer API endpoints, one class each.

export class DeliveriesEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET /deliveries */
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
  /** GET /draft-orders */
  list() {
    return this.api.call('GET', '/draft-orders');
  }
  /** GET /draft-orders/{id} */
  get(id: string) {
    return this.api.call('GET', `/draft-orders/${id}`);
  }
  /** POST /draft-orders */
  create(body: unknown) {
    return this.api.call('POST', '/draft-orders', { data: body });
  }
  /** DELETE /draft-orders/{id} */
  delete(id: string) {
    return this.api.call('DELETE', `/draft-orders/${id}`);
  }
}

export class TransactionsEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET /transactions */
  list() {
    return this.api.call('GET', '/transactions');
  }
  /** GET /transactions/{transactionId} */
  get(transactionId: string) {
    return this.api.call('GET', `/transactions/${transactionId}`);
  }
  /** GET /transactions?order_id={orderId} - only the transactions of one order. */
  listByOrder(orderId: string) {
    return this.api.call('GET', '/transactions', { params: { order_id: orderId } });
  }
}

export class RecurringPaymentsEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET /recurring-payments */
  list() {
    return this.api.call('GET', '/recurring-payments');
  }
  /** GET /recurring-payments/{id} */
  get(id: string | number) {
    return this.api.call('GET', `/recurring-payments/${id}`);
  }
}

export class ProductTrackingEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET /product-tracking */
  list() {
    return this.api.call('GET', '/product-tracking');
  }
  /** GET /product-tracking/{serialNumber} */
  get(serialNumber: string) {
    return this.api.call('GET', `/product-tracking/${serialNumber}`);
  }
  /** POST /product-tracking/{serialNumber}/repair */
  repair(serialNumber: string, deleteRecurringPayments = true) {
    return this.api.call('POST', `/product-tracking/${serialNumber}/repair`, { data: { delete_rps: deleteRecurringPayments } });
  }
  /** POST /product-tracking/{serialNumber}/stock */
  stock(serialNumber: string, location = 'Berlin', doNotRestock = false) {
    return this.api.call('POST', `/product-tracking/${serialNumber}/stock`, {
      params: { do_not_restock: doNotRestock },
      data: { location },
    });
  }
}

export class ProductsEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET /products */
  list() {
    return this.api.call('GET', '/products');
  }
  /** POST /products */
  create(body: unknown) {
    return this.api.call('POST', '/products', { data: body });
  }
  /** GET /variants */
  variants() {
    return this.api.call('GET', '/variants');
  }
  /** GET /products/{productId}/variants */
  variantsOf(productId: string | number) {
    return this.api.call('GET', `/products/${productId}/variants`);
  }
  /** POST /products/{productId}/variants */
  createVariant(productId: string | number, body: unknown) {
    return this.api.call('POST', `/products/${productId}/variants`, { data: body });
  }
  /** PUT /variants/{variantId} */
  updateVariant(variantId: string | number, body: unknown) {
    return this.api.call('PUT', `/variants/${variantId}`, { data: body });
  }
}

export class RetailersEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET /retailers */
  list() {
    return this.api.call('GET', '/retailers');
  }
  /** GET /retailers/{locationId} */
  byLocation(locationId: string) {
    return this.api.call('GET', `/retailers/${locationId}`);
  }
  /** POST /retailers */
  create(body: unknown) {
    return this.api.call('POST', '/retailers', { data: body });
  }
  /** PUT /retailers/{retailerId} */
  update(retailerId: string, body: unknown) {
    return this.api.call('PUT', `/retailers/${retailerId}`, { data: body });
  }
}

export class VouchersEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET /vouchers */
  list() {
    return this.api.call('GET', '/vouchers');
  }
  /** GET /vouchers/{code} */
  byCode(code: string) {
    return this.api.call('GET', `/vouchers/${code}`);
  }
  /** POST /vouchers */
  create(body: unknown) {
    return this.api.call('POST', '/vouchers', { data: body });
  }
  /** PUT /vouchers/{voucherId} */
  update(voucherId: string | number, body: unknown) {
    return this.api.call('PUT', `/vouchers/${voucherId}`, { data: body });
  }
}

export type NoteFilter = { order_id?: string; customer_id?: string; subscription_id?: string; transaction_id?: string };

export class NotesEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET /notes */
  list(filter: NoteFilter = {}) {
    // send only the filters that are set
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(filter)) {
      if (value !== undefined) params[key] = value;
    }
    return this.api.call('GET', '/notes', { params });
  }
  /** GET /notes/{noteId} */
  get(noteId: string | number) {
    return this.api.call('GET', `/notes/${noteId}`);
  }
}

export class DebtistEndpoint {
  constructor(private readonly api: CustomerApiClient) {}
  /** GET /debtist/claims */
  claims() {
    return this.api.call('GET', '/debtist/claims');
  }
  /** GET /debtist/claims/{claimId} */
  claim(claimId: string) {
    return this.api.call('GET', `/debtist/claims/${claimId}`);
  }
  /** GET /debtist/invoice/{invoiceId}/claim */
  claimOfInvoice(invoiceId: string) {
    return this.api.call('GET', `/debtist/invoice/${invoiceId}/claim`);
  }
  /** POST /debtist/invoice/{invoiceId}/claim */
  fileClaim(invoiceId: string) {
    return this.api.call('POST', `/debtist/invoice/${invoiceId}/claim`);
  }
  /** GET /debtist/invoices */
  invoices() {
    return this.api.call('GET', '/debtist/invoices');
  }
  /** GET /debtist/customers */
  customers() {
    return this.api.call('GET', '/debtist/customers');
  }
  /** POST /debtist/invoice/{invoiceId}/uploads - form-data "file" (a PDF). Invoice must be in a claim. Answers { upload_id: "media/<folder>/<file>" }. */
  uploadFile(invoiceId: string, fileName: string, pdf: Buffer) {
    return this.api.call('POST', `/debtist/invoice/${invoiceId}/uploads`, {
      multipart: { file: { name: fileName, mimeType: 'application/pdf', buffer: pdf } },
    });
  }
  /** GET /debtist/invoice/{invoiceId}/uploads/{uploadId} - uploadId comes from uploadFile(). Answers the file. */
  downloadFile(invoiceId: string, uploadId: string) {
    return this.api.call('GET', `/debtist/invoice/${invoiceId}/uploads/${uploadId}`);
  }
}
