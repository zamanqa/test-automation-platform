import { test, expect } from '@fixtures';
import { findLatestClaimWithCustomer } from '@db/queries/hub/debtist';

// Hub → Debt collection (claims at Debtist): search, status filter, claim details, comment, file upload.
// Needs: a claim with a customer (the API and hub claim tests create them).
// Changes data: adds a comment and uploads a small PDF to the newest claim (goes to Debtist dev).
test.describe.configure({ mode: 'default' });

test.describe('Hub - debt collection', () => {
  let claim: { claim_id: string; status: string; stage: string; customer_id: string | null };

  test.beforeEach(async ({ db, hubCompanyId }) => {
    const found = await findLatestClaimWithCustomer(db.hub, hubCompanyId);
    test.skip(!found, 'No debt-collection claim in the database');
    claim = found!;
    test.info().annotations.push({ type: 'claim', description: claim.claim_id });
  });

  test('finds a claim by id in the list', async ({ debtCollectionPage }) => {
    // ACTION + CHECK: search the claim id, its row shows
    await debtCollectionPage.openList();
    await debtCollectionPage.search(claim.claim_id);
  });

  test('filters the list by status', async ({ debtCollectionPage, page }) => {
    // ACTION: filter by the status of the newest claim
    await debtCollectionPage.openList();
    await debtCollectionPage.filterByStatus(claim.status);

    // CHECK: rows are shown and the URL carries the filter
    await expect(debtCollectionPage.rows.first()).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`status=${claim.status}`));
  });

  test('shows the claim details from the database', async ({ debtCollectionPage }) => {
    // ACTION: open the claim
    await debtCollectionPage.open(claim.claim_id);

    // CHECK: status, stage and customer id are the same as in the database
    await expect(debtCollectionPage.detail('Status:'), 'claim status').toHaveText(claim.status);
    await expect(debtCollectionPage.detail('Stage:'), 'claim stage').toHaveText(claim.stage);
    await expect(debtCollectionPage.detail('Customer ID:'), 'claim customer').toHaveText(claim.customer_id!);
  });

  test('adds a comment to the claim', async ({ debtCollectionPage, page }) => {
    // SETUP: unique comment text
    const comment = `qa_auto comment ${Date.now()}`;
    await debtCollectionPage.open(claim.claim_id);

    // ACTION: Activity history → Comment → text → Submit
    await debtCollectionPage.addComment(comment);

    // CHECK: the comment shows in the activity history
    await expect(page.getByText(comment).first(), 'new comment in the activity history').toBeVisible({ timeout: 30_000 });
  });

  test('uploads a PDF to the claim', async ({ debtCollectionPage, page }) => {
    // SETUP: a tiny PDF with a unique name
    const fileName = `qa_auto_claim_${Date.now()}.pdf`;
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    await debtCollectionPage.open(claim.claim_id);

    // ACTION: Upload → file → Submit
    await debtCollectionPage.uploadFile({ name: fileName, mimeType: 'application/pdf', buffer: pdf });

    // CHECK: the file shows under "Appended Files" (after a reload)
    await page.reload();
    await expect(page.getByRole('button', { name: new RegExp(fileName) }), 'uploaded file under Appended Files').toBeVisible({ timeout: 30_000 });
  });
});
