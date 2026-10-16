import { test, expect } from '@fixtures';
import { findNewestInvoicePerEInvoiceType, getEInvoiceFormats } from '@db/queries/hub/invoices';

// Hub → e-invoices: the newest invoice of each type initial, recurring payment, cumulated invoice,
// one time payment, refund, buyout, cancellation, full_refund, replacement, partial_refund has both
// e-invoice formats (zugferd + xrechnung) in e_invoices. Database only, no UI.
// Needs: the hub company has e-invoices on (xrechnung).
// Changes data: nothing.
test.describe('Hub - e-invoices', () => {
  test('every invoice type has both e-invoice formats', async ({ db, hubCompanyId }) => {
    // SETUP: newest invoice of each of these types
    const invoices = await findNewestInvoicePerEInvoiceType(db.hub, hubCompanyId);
    test.skip(invoices.length === 0, 'No invoice of these types for the hub company');
    for (const invoice of invoices) {
      test.info().annotations.push({ type: invoice.type, description: `${invoice.invoice_number} (id ${invoice.id})` });
    }

    // CHECK: each one has an xrechnung and a zugferd row (soft: every invoice is checked, failures list their ids)
    for (const invoice of invoices) {
      const formats = await getEInvoiceFormats(db.hub, hubCompanyId, invoice.id);
      expect.soft(formats, `e-invoice formats of ${invoice.type} invoice ${invoice.invoice_number} (id ${invoice.id})`).toEqual(['xrechnung', 'zugferd']);
    }
  });
});
