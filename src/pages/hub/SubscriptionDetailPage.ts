import { expect, type Locator, type Page } from '@playwright/test';

export type SubscriptionAction =
  | 'Auto-reactivate subscription'
  | 'Auto-renew subscription'
  | 'Buyout subscription'
  | 'Change quantity'
  | 'Change billing frequency'
  | 'Change subscription attributes'
  | 'Change subscription extension price'
  | 'Extend subscription'
  | 'Reactivate subscription'
  | 'Replace serial number'
  | 'Set as pending return'
  | 'Set as ended'
  | 'Swap subscription item'
  | 'View order';

export type RecurringPaymentAction =
  | 'Delete recurring payment'
  | 'Charge recurring payment'
  | 'Edit recurring payment(s)'
  | 'Mark as not paid'
  | 'Mark as settled';

/** Hub → subscription page. */
export class SubscriptionDetailPage {
  readonly modal: Locator;
  readonly modalSubmit: Locator;
  readonly modalClose: Locator;
  readonly confirmButton: Locator;
  readonly successMessage: Locator;
  readonly autoRenewToggle: Locator;

  constructor(private readonly page: Page) {
    this.modal = page.locator('[id^="headlessui-dialog-panel"]');
    this.modalSubmit = page.locator('[data-cy="btn-submit"]');
    this.modalClose = page.locator('[data-cy="btn-close"]');
    this.confirmButton = page.locator('button', { hasText: 'Confirm' });
    this.successMessage = page.getByText('Successfully requested!');
    this.autoRenewToggle = page.locator('button[aria-label="Auto renew"]');
  }

  /**
   * Opens the 3-dot menu and clicks an action.
   * The menu items are disabled for a moment while the page still loads the subscription,
   * so: open the menu → is the action enabled? If not, close the menu and try again (max 30 s).
   */
  async runAction(action: SubscriptionAction) {
    const menuButton = this.page.locator('button[aria-haspopup="menu"]:not(.header-btn)').last();
    // exact name: "Reactivate subscription" must not match "Auto reactivate subscription"
    const item = this.page.getByRole('menuitem', { name: action, exact: true });
    await expect(async () => {
      await this.page.keyboard.press('Escape'); // close the menu if it is open
      await menuButton.click();
      await expect(item).toBeEnabled({ timeout: 3_000 });
    }, `menu action "${action}" should be enabled`).toPass({ timeout: 30_000 });
    // a normal click sometimes reports "outside of the viewport" while the menu animates open;
    // sending the click event straight to the menu item avoids that
    await item.dispatchEvent('click');
  }

  /** Checks a dialog is open and shows `title`. */
  async expectModal(title: string) {
    await expect(this.modal.first()).toBeVisible();
    await expect(this.page.getByText(title).first()).toBeVisible();
  }

  /** "Successfully requested!" → close → gone. */
  async closeSuccess() {
    await expect(this.successMessage).toBeVisible();
    await this.modalClose.click();
    await expect(this.successMessage).toBeHidden();
  }

  // ---------- specific dialogs ----------

  /**
   * Menu → "Auto-renew subscription" → checks the dialog text → Disable/Enable → success →
   * checks the switch on the page flipped.
   * currentlyOn: true = auto-renew is ON now (dialog offers "Disable"); false = OFF now ("Enable").
   */
  async toggleAutoRenew(currentlyOn: boolean) {
    await this.runAction('Auto-renew subscription');
    await this.expectModal('Auto renew subscription');
    await expect(this.page.getByText(`This subscription is currently ${currentlyOn ? '' : 'not '}auto-renewing.`)).toBeVisible();
    await expect(this.page.getByText(currentlyOn ? 'Would you like to disable it' : 'Would you like to enable it?')).toBeVisible();
    await expect(this.modalSubmit).toContainText(currentlyOn ? 'Disable' : 'Enable');
    await this.modalSubmit.click();
    await this.closeSuccess();
    // the switch on the page is not refreshed after the dialog → reload, then it shows the new state
    await this.page.reload();
    await expect(this.autoRenewToggle, 'auto-renew switch after reload').toHaveAttribute('aria-checked', String(!currentlyOn));
  }

  /**
   * Menu → "Auto-reactivate subscription" → "Disable" / "Enable" → success → close.
   * currentlyOn: true = it is on now (the dialog offers "Disable"); false = off now ("Enable").
   */
  async toggleAutoReactivate(currentlyOn: boolean) {
    await this.runAction('Auto-reactivate subscription');
    await this.expectModal('Auto reactivate subscription');
    const button = currentlyOn ? 'Disable' : 'Enable';
    await this.page.getByRole('dialog').last().getByRole('button', { name: button, exact: true }).click();
    await this.closeSuccess();
  }

  /** Menu → "Buyout subscription" → invoice line text → Buyout → success → close. */
  async buyout(invoiceLineText: string) {
    await this.runAction('Buyout subscription');
    await this.page.getByRole('dialog').getByRole('textbox', { name: 'Invoice line item text' }).fill(invoiceLineText);
    await this.modalSubmit.click();
    await this.closeSuccess();
  }

  /** Menu → "Change billing frequency" → interval → Save changes → success → close. */
  async changeBillingInterval(interval: string) {
    await this.runAction('Change billing frequency');
    await this.expectModal('Change billing frequency');
    await expect(this.page.locator('[data-cy="frequency"]')).toBeVisible();
    await expect(this.modalSubmit).toContainText('Save changes');
    const input = this.page.locator('[data-cy="interval"] input').locator('visible=true').first();
    await input.fill(interval);
    await this.modalSubmit.click();
    await this.closeSuccess();
  }

  /** Menu → "Change quantity" → quantity → Save changes → success → close (consumables only). */
  async changeQuantity(quantity: number) {
    await this.runAction('Change quantity');
    await this.expectModal('Change quantity');
    await expect(this.modalSubmit).toContainText('Save changes');
    await this.page.locator('input[path="quantity"]').locator('visible=true').first().fill(String(quantity));
    await this.modalSubmit.click();
    await this.closeSuccess();
  }

  /** Menu → "Change subscription attributes" → length + installment price → Submit → success. */
  async changeAttributes(length: string, installmentPrice: string) {
    await this.runAction('Change subscription attributes');
    await this.expectModal('Change subscription attributes');
    const dialog = this.page.getByRole('dialog');
    await dialog.getByRole('spinbutton', { name: 'Subscription length' }).fill(length);
    await dialog.getByRole('spinbutton', { name: 'Subscription installment unit price' }).fill(installmentPrice);
    await this.page.keyboard.press('Tab'); // leave the field, so the form recalculates the total
    await dialog.getByRole('button', { name: 'Submit' }).click();
    await this.closeSuccess();
  }

  /** Dialogs that are one input + Confirm (extension price, extend). */
  async confirmWithValue(action: SubscriptionAction, input: Locator, value: string) {
    await this.runAction(action);
    await input.fill(value);
    await this.confirmButton.click();
    await expect(this.successMessage).toBeVisible();
    await this.modalClose.click();
  }

  /** Menu → "Change subscription extension price" → price → Confirm → success. */
  async changeExtensionPrice(price: string) {
    const input = this.page.getByRole('dialog').getByRole('textbox', { name: 'New extension price' });
    await this.confirmWithValue('Change subscription extension price', input, price);
  }

  /** Menu → "Extend subscription" → number of cycles → Confirm → success. */
  async extend(cycles: string) {
    await this.confirmWithValue('Extend subscription', this.page.locator('input[type="number"]').first(), cycles);
  }

  /** Menu action that only needs Confirm (reactivate, set as ended, set as pending return).
   * checkConsent: tick the consent checkbox first (pending return needs it). */
  async confirmAction(action: SubscriptionAction, { checkConsent = false } = {}) {
    await this.runAction(action);
    // only look inside the dialog (the page behind it has table checkboxes too)
    const dialog = this.page.getByRole('dialog');
    if (checkConsent) await dialog.getByRole('checkbox').first().check();
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(this.successMessage).toBeVisible();
    await this.modalClose.click();
  }

  /** Menu → "Replace serial number" → new + previous serial → Confirm → success. */
  async replaceSerialNumber(previous: string, next: string) {
    await this.runAction('Replace serial number');
    const dialog = this.page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'New serial number' }).fill(next);
    await dialog.getByRole('textbox', { name: 'Previous serial number' }).fill(previous);
    await this.confirmButton.click();
    await expect(this.successMessage).toBeVisible();
    await this.modalClose.click();
  }

  /** Menu → "Swap subscription item" → Continue → Submit → success. */
  async swapItem() {
    await this.runAction('Swap subscription item');
    await this.page.locator('button', { hasText: 'Continue' }).click();
    await this.page.locator('button', { hasText: 'Submit' }).click();
    await expect(this.successMessage).toBeVisible();
    await this.modalClose.click();
  }

  // ---------- recurring payments table ----------

  async showRecurringPayments(pageSize = 50) {
    const section = this.page.locator('p', { hasText: 'Recurring payments' }).locator('xpath=ancestor::*[contains(@class,"space-y-2")][1]');
    await section.scrollIntoViewIfNeeded();
    await section.getByTestId('select-page-size').first().locator('button[aria-haspopup="listbox"]').click();
    await this.page.getByRole('listbox').getByRole('option').filter({ hasText: String(pageSize) }).first().click();
  }

  /**
   * Opens the row menu of one recurring payment and picks an action.
   * Like the 3-dot menu, the items are disabled while the page still loads → reopen the menu until the action is enabled (max 30 s).
   */
  async runPaymentAction(rpId: string, action: RecurringPaymentAction) {
    const table = this.page.locator('table').filter({ has: this.page.locator('th', { hasText: 'Recurring ID' }) });
    const row = table.locator('tbody tr').filter({ has: this.page.locator('td', { hasText: new RegExp(`^\\s*${rpId}\\s*$`) }) });
    const item = this.page.getByRole('menuitem', { name: action, exact: true });
    await expect(async () => {
      await this.page.keyboard.press('Escape'); // close the menu if it is open
      await row.locator('button[role="button"]').last().click();
      await expect(item).toBeEnabled({ timeout: 3_000 });
    }, `recurring payment ${rpId}: "${action}" should be enabled`).toPass({ timeout: 30_000 });
    await item.click();
  }

  /** Row menu of one recurring payment → "Charge recurring payment" → consequences → Submit → "invoice was generated" → Close. */
  async chargeRecurringPayment(rpId: string) {
    await this.runPaymentAction(rpId, 'Charge recurring payment');
    await this.confirmConsequences();
    await this.closeDialog('Your invoice was generated successfully!');
  }

  /** Dialogs with an "I understand the consequences." checkbox and Submit. */
  async confirmConsequences() {
    await this.page.getByText('I understand the consequences.').click();
    await this.page.locator('button', { hasText: 'Submit' }).click();
  }

  /** Waits for `message` (default "Successfully requested!") and clicks Close. */
  async closeDialog(message = 'Successfully requested!') {
    await expect(this.page.getByText(message)).toBeVisible();
    await this.page.locator('button', { hasText: 'Close' }).click();
  }

  /** Confirm button of the mark-as dialogs carries the same text as the menu item. */
  async confirmMarkAs(label: 'Mark as settled' | 'Mark as not paid') {
    await this.page.locator('button', { hasText: label }).click();
  }

  /** In the edit dialog: "Change all future payments" → Item Amount → Submit changes. */
  async editFuturePaymentsAmount(amount: number) {
    const dialog = this.page.getByRole('dialog');
    await dialog.getByRole('switch', { name: 'Change all future payments' }).click();
    await dialog.getByRole('spinbutton', { name: 'Item Amount' }).fill(String(amount));
    await dialog.getByRole('button', { name: 'Submit changes' }).click();
  }
}
