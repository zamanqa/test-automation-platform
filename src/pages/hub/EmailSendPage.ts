import { expect, type Locator, type Page } from '@playwright/test';

// "Resend email" icon button on hub record pages (subscription ...) → template → "Send - <template>" dialog.
export class EmailSendPage {
  readonly dialog: Locator;

  constructor(private readonly page: Page) {
    this.dialog = page.getByRole('dialog');
  }

  /** The icon button whose tooltip is "Resend email" (the tooltip element points at its button). */
  async resendButton(): Promise<Locator> {
    const tooltip = this.page.locator('[data-tw-tooltip]', { hasText: 'Resend email' }).first();
    await expect(tooltip).toBeAttached();
    const id = await tooltip.getAttribute('data-tw-tooltip');
    return this.page.locator(`[data-tw-tooltip-owner="${id}"]`);
  }

  /** Resend email → template (e.g. "Subscription - Created") → dialog "Send ..." → To → Submit → "Email request sent!". */
  async send(templateTitle: string, to: string) {
    await (await this.resendButton()).click();
    await this.page.getByRole('listitem').filter({ hasText: templateTitle }).first().click();
    await expect(this.dialog.getByRole('heading', { name: /^Send/ })).toBeVisible();
    await this.dialog.getByRole('textbox', { name: 'To' }).fill(to);
    await this.dialog.getByRole('button', { name: /^Submit|^Send/ }).click();
    await expect(this.dialog.getByText('Email request sent!')).toBeVisible();
  }
}
