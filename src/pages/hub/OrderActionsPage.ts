import { expect, type Locator, type Page } from '@playwright/test';

// Hub → order page: product list item menu (Edit Item, serial number), quote page (Cancel), order 3-dot menu.
export class OrderActionsPage {
  readonly dialog: Locator;

  constructor(private readonly page: Page) {
    this.dialog = page.getByRole('dialog');
  }

  /** Opens an order by URL and waits for the product list. */
  async openOrder(orderId: string) {
    await this.page.goto(`en/cms/orders/${orderId}`);
    await expect(this.page.getByRole('heading', { name: 'Product list' })).toBeVisible();
    await expect(this.page.getByRole('button', { name: 'Create subscription' }).first()).toBeVisible();
  }

  /** Opens any order page (also a draft order without product buttons). */
  async openOrderPage(orderId: string) {
    await this.page.goto(`en/cms/orders/${orderId}`);
    await expect(this.page.getByRole('heading', { name: 'Order', exact: true })).toBeVisible();
  }

  /** Product list row that contains this text (e.g. the SKU); index = which of the matching rows. */
  productRow(text: string, index = 0): Locator {
    return this.page.locator('tbody tr').filter({ hasText: text }).nth(index);
  }

  /** Item menu of a product row → "Edit Item" → the "Edit item" dialog. */
  async openEditItem(rowText: string, index = 0) {
    await this.productRow(rowText, index).getByRole('button').first().click();
    await this.page.getByText('Edit Item', { exact: true }).click();
    await expect(this.dialog.getByRole('heading', { name: 'Edit item' })).toBeVisible();
  }

  /** Field of the Edit item dialog by its label, e.g. 'Price *'. */
  itemField(label: string): Locator {
    return this.dialog.getByLabel(label, { exact: true });
  }

  /** Edit item: Submit → success → Close. */
  async submitItem() {
    await this.dialog.getByRole('button', { name: /^Submit/ }).click();
    await expect(this.page.getByText('Successfully requested!')).toBeVisible();
    await this.dialog.getByRole('button', { name: 'Close' }).click();
  }

  /** Edit item: types a serial number and clicks Reserve. */
  async reserveSerial(serialNumber: string) {
    await this.itemField('Serial number').fill(serialNumber);
    await this.dialog.getByRole('button', { name: 'Reserve' }).click();
  }

  /** Edit item: the red button next to the reserved serial number removes it. */
  async removeSerial() {
    await this.dialog.getByText('Serial number:').locator('xpath=following::button[1]').click();
  }

  /** Opens a quote (draft_orders) page. */
  async openQuote(draftId: string) {
    await this.page.goto(`en/cms/orders/drafts/${draftId}`);
    await expect(this.page.getByRole('heading', { name: 'Draft order' })).toBeVisible();
  }

  /** Quote page → Cancel → "Cancel quote" dialog → Cancel → "Successfully cancelled!". */
  async cancelQuote() {
    await this.page.locator('main').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(this.dialog.getByRole('heading', { name: 'Cancel quote' })).toBeVisible();
    await this.dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(this.page.getByText('Successfully cancelled!')).toBeVisible();
  }

  /**
   * Opens the order's actions menu. The page has several menus (each note has one), the order menu is the one
   * with items "order-action-...". Waits until `loadedItem` is shown.
   */
  async openOrderMenu(loadedItem: string) {
    const menuButtons = this.page.locator('main button[aria-haspopup="menu"]');
    const item = this.page.getByRole('menuitem', { name: loadedItem, exact: true });
    await expect(async () => {
      for (let i = 0; i < (await menuButtons.count()); i++) {
        await this.page.keyboard.press('Escape');
        await menuButtons.nth(i).click();
        if (await this.page.locator('[data-cy^="order-action-"]').count()) break;
      }
      await expect(item).toBeVisible({ timeout: 3_000 });
    }, `order menu with "${loadedItem}"`).toPass({ timeout: 30_000 });
  }

  /** Item of the open order menu. */
  menuItem(name: string): Locator {
    return this.page.getByRole('menuitem', { name, exact: true });
  }

  /** Order menu → "Finalise order" → consent → Submit → success. */
  async finaliseDraftOrder() {
    await this.openOrderMenu('Finalise order');
    await expect(this.menuItem('Finalise order')).toBeEnabled({ timeout: 30_000 });
    await this.menuItem('Finalise order').click();
    await expect(this.dialog.getByRole('heading', { name: 'Finalise order' })).toBeVisible();
    await this.dialog.getByText('I consent to the consequences.').click();
    await this.dialog.getByRole('button', { name: /^Submit|^Finalise/ }).click();
    await expect(this.page.getByText('Successfully requested!')).toBeVisible();
  }
}
