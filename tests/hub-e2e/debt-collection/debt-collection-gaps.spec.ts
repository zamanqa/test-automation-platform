import { test, expect } from '@fixtures';
import { findLatestClaimWithCustomer } from '@db/queries/hub/debtist';
import { findUnpaidInvoiceForActions, unblockAutoClaim } from '@db/queries/hub/invoices';
import { blockAutoClaimWithReason, claimHasComment, findClaimWithPayments, getClaimFiles } from '@db/queries/hub/debt-collection-more';

// Hub → debt collection: the cases that were missing - file download, comment saved in the timeline,
// financial details and payments table against the DB, a non-PDF upload, the auto-claim blocked banner.
// Needs: a claim with files and payments (the hub claim tests create them).
// Changes data: adds one comment at Debtist dev, tries one .txt upload, blocks one invoice for a moment (unblocked by cleanup).
test.describe.configure({ mode: 'default' });

// "302,00 €" and 302 → both "30200"
function digits(value: string | number) {
  const text = typeof value === 'number' ? value.toFixed(2) : value;
  return text.replace(/\D/g, '').replace(/^0+/, '');
}

test.describe('Hub - debt collection gaps', () => {
  test('D1 downloads a file of the claim', async ({ db, hubCompanyId, debtCollectionPage, page }) => {
    // SETUP
    const claim = await findClaimWithPayments(db.hub, hubCompanyId);
    test.skip(!claim, 'no claim with files');
    // shown name = path without "media/<reference>/" and the date prefix
    const shownName = claim!.file_urls[0].replace(`media/${claim!.reference}/`, '').replace(/^\d{2}-\d{2}-\d{4}-/, '').trim();
    test.info().annotations.push({ type: 'claim', description: `${claim!.claim_id} / ${shownName}` });

    // ACTION: Appended Files → click the file
    await debtCollectionPage.open(claim!.claim_id);
    const answer = page.waitForResponse((r) => r.url().includes(`/claims/${claim!.claim_id}/uploads/media/`));
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: shownName }).click();

    // CHECK: the API answers 200 and the browser saves a file
    expect((await answer).status(), 'download answer').toBe(200);
    expect((await download).suggestedFilename(), 'saved file name').not.toBe('');
  });

  test('D2 a new comment is saved in the activity timeline', async ({ db, hubCompanyId, debtCollectionPage, page }) => {
    // SETUP
    const claim = await findLatestClaimWithCustomer(db.hub, hubCompanyId);
    test.skip(!claim, 'no claim');
    const comment = `qa_auto timeline ${Date.now()}`;

    // ACTION
    await debtCollectionPage.open(claim!.claim_id);
    await debtCollectionPage.addComment(comment);

    // CHECK: shown in the timeline and saved in debtist_claims.activities
    await expect(page.getByText(comment).first(), 'comment in the timeline').toBeVisible({ timeout: 30_000 });
    await expect.poll(() => claimHasComment(db.hub, claim!.claim_id, comment), { message: 'comment in activities', timeout: 60_000 }).toBe(true);
  });

  test('D3 financial details show the amounts of the claim and its invoices', async ({ db, hubCompanyId, debtCollectionPage }) => {
    // SETUP
    const claim = await findClaimWithPayments(db.hub, hubCompanyId);
    test.skip(!claim, 'no claim with payments');

    // ACTION
    await debtCollectionPage.open(claim!.claim_id);

    // CHECK: original amount = DB = sum of the invoices; total paid = DB
    await expect(debtCollectionPage.detail('Original amount')).toContainText(/\d/);
    expect(digits(await debtCollectionPage.detail('Original amount').innerText()), 'original amount').toBe(digits(Number(claim!.original_amount_due)));
    expect(Number(claim!.invoice_sum), 'original amount = sum of the claimed invoices').toBe(Number(claim!.original_amount_due));
    expect(digits(await debtCollectionPage.detail('Total paid').innerText()), 'total paid').toBe(digits(Number(claim!.total_paid)));
  });

  test('D4 the payments table has one row per payment of the claim', async ({ db, hubCompanyId, debtCollectionPage, page }) => {
    // SETUP
    const claim = await findClaimWithPayments(db.hub, hubCompanyId);
    test.skip(!claim, 'no claim with payments');

    // ACTION
    await debtCollectionPage.open(claim!.claim_id);

    // CHECK
    const table = page.getByRole('heading', { name: 'Payments', exact: true }).locator('xpath=following::table[1]');
    await expect(table.locator('tbody tr')).toHaveCount(claim!.payment_count);
  });

  test('D5 a text file is not added to the claim (bug CIR-1596: any file type is accepted)',async ({ db, hubCompanyId, debtCollectionPage, page }) => {
    // SETUP
    const claim = await findLatestClaimWithCustomer(db.hub, hubCompanyId);
    test.skip(!claim, 'no claim');
    const before = await getClaimFiles(db.hub, claim!.claim_id);

    // ACTION: Upload → a .txt file → Submit
    await debtCollectionPage.open(claim!.claim_id);
    await page.getByRole('button', { name: 'Upload' }).first().click();
    const dialog = page.getByRole('dialog').last();
    // the file picker only offers images and PDFs
    await expect(dialog.locator('input[type="file"]')).toHaveAttribute('accept', 'image/*, application/pdf');
    await dialog.locator('input[type="file"]').setInputFiles({ name: `qa_auto_${Date.now()}.txt`, mimeType: 'text/plain', buffer: Buffer.from('not a pdf') });
    const upload = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/uploads'), { timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Submit' }).click();

    // CHECK: the upload is refused, no success message, file_urls unchanged
    const response = await upload;
    expect(response.status(), 'upload answer for a .txt file').toBeGreaterThanOrEqual(400);
    await expect(page.getByText('File uploaded successfully.')).toBeHidden();
    expect(await getClaimFiles(db.hub, claim!.claim_id)).toBe(before);
  });

  test('D6 an invoice blocked from auto-claim shows the banner with the reason', async ({ db, hubCompanyId, invoiceListPage, page, cleanup }) => {
    // SETUP
    const invoice = await findUnpaidInvoiceForActions(db.hub, hubCompanyId);
    test.skip(!invoice, 'no unpaid invoice');
    await blockAutoClaimWithReason(db.hub, invoice!.id, 'qa_auto banner reason');
    cleanup.add('unblock auto-claim', () => unblockAutoClaim(db.hub, invoice!.id));

    // ACTION
    await invoiceListPage.openById(invoice!.id);

    // CHECK
    const banner = page.locator('[data-cy="auto-claim-blocked-banner"]');
    await expect(banner.getByText('Auto-claim blocked')).toBeVisible();
    await expect(banner.getByText('Reason: qa_auto banner reason')).toBeVisible();
    await expect(banner.locator('[data-cy="auto-claim-blocked-unblock"]')).toBeVisible();
  });
});
