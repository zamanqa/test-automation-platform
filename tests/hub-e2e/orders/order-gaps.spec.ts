import { test, expect } from '@fixtures';
import { testName } from '@data/random';
import { getLocationStatus } from '@db/queries/hub/product-trackings';
import { getLastEmailEntryId } from '@db/queries/hub/subscription-crons';
import { findNewOrderEmail, getNewOrderEmailTemplate, getOrderAndTransactionNotify, setNotifyOrders } from '@db/queries/hub/email-entries';
import {
  countNewSubscriptionsOfOrder,
  countOrdersAfter,
  countOrdersOfEmail,
  deleteNewSubscriptionsOfOrder,
  countOrdersWithTag,
  findConsumableOrderWithAllSubscriptions,
  findDraftOrder,
  findEditableOrderItem,
  findFulfilledOrderWithoutSubscription,
  findOpenQuote,
  findOrdersToFulfil,
  findOrderItemValues,
  findOrderStatus,
  findOrderTagAndEmail,
  findOrderWithStatus,
  findSettledCancelledOrder,
  findQuoteStatus,
  getLastOrderPk,
  getLastSubscriptionIdOfOrder,
  getOrderItemSerial,
  getOrderStatus,
  getQuoteStatus,
  setOrderItemValues,
  setOrderStatus,
} from '@db/queries/hub/orders-more';

// Hub → orders: the cases that were missing - bulk fulfil (cancelled order = bug CIR-1595), item edit + serial number, finalise a draft order,
// cancel a quote, quote email (a quote has no edit), disabled menu items, no "Create subscription" on a consumable order, order email, filters.
// Changes data: fulfils 2 orders, edits one order item (old values put back), reserves and removes a qa_auto serial,
// finalises one draft order, cancels one quote; subscriptions started for a cancelled order are deleted.
test.describe.configure({ mode: 'default' });

test.describe('Hub - order gaps', () => {
  test('O1 bulk "Mark fulfilled" fulfils 2 orders', async ({ db, hubCompanyId, hubListPage, orderListPage }) => {
    // SETUP
    const orders = await findOrdersToFulfil(db.hub, hubCompanyId, 2);
    test.skip(orders.length < 2, 'fewer than 2 open paid orders without subscription items');
    const first = orders[0].order_id;
    const second = orders[1].order_id;
    test.info().annotations.push({ type: 'orders', description: `${first}, ${second}` });

    // ACTION: list with only these 2 orders → tick both → Mark fulfilled
    await hubListPage.open('orders', { id: `matches:${first}||${second}`, created_at: '' });
    await hubListPage.expectTotal(2, 'the 2 orders are listed');
    await orderListPage.selectOrder(first);
    await orderListPage.selectOrder(second);
    await orderListPage.markSelectedFulfilled();

    // CHECK: both fulfilled (the bulk action is PUT /orders; it does not fill fulfillment_date)
    await expect.poll(() => getOrderStatus(db.hub, first), { message: `status of ${first}` }).toBe('fulfilled');
    await expect.poll(() => getOrderStatus(db.hub, second), { message: `status of ${second}` }).toBe('fulfilled');
    test.info().annotations.push({ type: 'INFO', description: `fulfillment_date of ${first}: ${(await findOrderStatus(db.hub, first))!.fulfillment_date}` });
  });

  test('O2 bulk "Mark fulfilled" must not fulfil a cancelled order (bug CIR-1595)', async ({ db, hubCompanyId, hubListPage, orderListPage, cleanup }) => {
    // SETUP: PUT /orders only skips draft and fulfilled orders, so the cancelled order is put back by cleanup,
    // and subscriptions it starts for the cancelled order are deleted again
    const order = await findOrderWithStatus(db.hub, hubCompanyId, 'cancelled');
    test.skip(!order, 'no cancelled order');
    const lastSubscriptionId = await getLastSubscriptionIdOfOrder(db.hub, order!.order_id);
    cleanup.add('order back to cancelled', () => setOrderStatus(db.hub, order!.order_id, 'cancelled'));
    cleanup.add('delete subscriptions started for the cancelled order', () => deleteNewSubscriptionsOfOrder(db.hub, order!.order_id, lastSubscriptionId));
    test.info().annotations.push({ type: 'order', description: order!.order_id });

    // ACTION
    await hubListPage.open('orders', { id: order!.order_id, created_at: '' });
    await orderListPage.selectOrder(order!.order_id);
    await orderListPage.markSelectedFulfilled();

    // CHECK: after the list has loaded again the order is still cancelled
    await hubListPage.open('orders', { id: order!.order_id, created_at: '' });
    await hubListPage.expectTotal(1, 'the order is listed again');
    expect.soft(await countNewSubscriptionsOfOrder(db.hub, order!.order_id, lastSubscriptionId), 'BUG: subscriptions were started for a cancelled order').toBe(0);
    expect(await getOrderStatus(db.hub, order!.order_id), 'BUG: a cancelled order was set to fulfilled').toBe('cancelled');
  });

  test('O3 O4 O5 O6 edits an order item, reserves a serial number, refuses it twice and removes it', async ({
    db,
    hubCompanyId,
    orderActionsPage,
    page,
    cleanup,
  }) => {
    const item = await findEditableOrderItem(db.hub, hubCompanyId);
    test.skip(!item, 'no subscription item without subscription on an open order');
    cleanup.add('old item values back', () => setOrderItemValues(db.hub, item!));
    const serial = testName('sn_order');
    test.info().annotations.push({ type: 'order item', description: `${item!.order_id} / ${item!.order_item_id}, serial ${serial}` });

    await test.step('O3 edit price, duration and tracking number', async () => {
      await orderActionsPage.openOrder(item!.order_id);
      await orderActionsPage.openEditItem(item!.sku);
      await orderActionsPage.itemField('Price *').fill('11');
      await orderActionsPage.itemField('Duration *').fill('6');
      await orderActionsPage.itemField('Tracking number').fill('QA-TRACK-1');
      await orderActionsPage.submitItem();

      await expect.poll(async () => (await findOrderItemValues(db.hub, item!.order_item_id)).tracking_number, { message: 'tracking number' }).toBe('QA-TRACK-1');
      const after = await findOrderItemValues(db.hub, item!.order_item_id);
      expect(Number(after.price)).toBe(11);
      expect(after.subscription_duration).toBe(6);
    });

    await test.step('O4 reserve a new serial number', async () => {
      await orderActionsPage.openOrder(item!.order_id);
      await orderActionsPage.openEditItem(item!.sku);
      await orderActionsPage.reserveSerial(serial);
      await expect(page.getByText('Serial number reserved.')).toBeVisible();

      await expect.poll(() => getOrderItemSerial(db.hub, item!.order_item_id), { message: 'serial of the order item' }).toBe(serial);
      expect(await getLocationStatus(db.hub, serial)).toBe('reserved');
    });

    await test.step('O5 the same serial number cannot be reserved again (on the second item with this SKU)', async () => {
      await orderActionsPage.openOrder(item!.order_id);
      test.skip((await orderActionsPage.productRow(item!.sku, 1).count()) === 0, 'no second item with the same SKU');
      await orderActionsPage.openEditItem(item!.sku, 1);
      await orderActionsPage.reserveSerial(serial);
      await expect(page.getByText('Serial number already reserved')).toBeVisible();
    });

    await test.step('O6 remove the serial number', async () => {
      await orderActionsPage.openOrder(item!.order_id);
      await orderActionsPage.openEditItem(item!.sku);
      await orderActionsPage.removeSerial();
      await expect(page.getByText('Serial number removed.')).toBeVisible();

      await expect.poll(() => getOrderItemSerial(db.hub, item!.order_item_id), { message: 'serial of the order item' }).toBeNull();
      expect(await getLocationStatus(db.hub, serial)).toBe('in stock');
    });
  });

  test('O7 finalises a draft order into a new order', async ({ db, hubCompanyId, orderActionsPage }) => {
    // SETUP
    const draft = await findDraftOrder(db.hub, hubCompanyId);
    test.skip(!draft, 'no draft order with items');
    const lastPk = await getLastOrderPk(db.hub);
    test.info().annotations.push({ type: 'draft order', description: draft!.order_id });

    // ACTION
    await orderActionsPage.openOrderPage(draft!.order_id);
    await orderActionsPage.finaliseDraftOrder();

    // CHECK: a new order exists and the draft order is gone
    await expect.poll(() => countOrdersAfter(db.hub, hubCompanyId, lastPk), { message: 'new order from the draft', timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(() => getOrderStatus(db.hub, draft!.order_id), { message: `draft order ${draft!.order_id}` }).not.toBe('draft');
  });

  test('O8 cancels a quote', async ({ db, hubCompanyId, orderActionsPage }) => {
    // SETUP
    const quote = await findOpenQuote(db.hub, hubCompanyId);
    test.skip(!quote, 'no open quote');
    test.info().annotations.push({ type: 'quote', description: quote!.draft_id });

    // ACTION
    await orderActionsPage.openQuote(quote!.draft_id);
    await orderActionsPage.cancelQuote();

    // CHECK: status cancelled and deleted
    await expect.poll(() => getQuoteStatus(db.hub, quote!.draft_id), { message: `status of ${quote!.draft_id}` }).toBe('cancelled');
    expect((await findQuoteStatus(db.hub, quote!.draft_id))!.deleted).toBe(true);
  });

  test('O9 a quote has no edit (only "Send email" and Cancel); "Order - Quote" email is written for the quote', async ({ db, hubCompanyId, orderActionsPage, emailSendPage, page }) => {
    // SETUP: the hub has no "Edit quote" - the old /drafts/{id}/edit page loads an order, not a quote, and nothing links to it
    const quote = await findOpenQuote(db.hub, hubCompanyId);
    test.skip(!quote, 'no open quote');
    const lastEmailId = await getLastEmailEntryId(db.hub);
    test.info().annotations.push({ type: 'quote', description: quote!.draft_id });

    // ACTION
    await orderActionsPage.openQuote(quote!.draft_id);

    // CHECK: no edit button on the quote page
    await expect(page.locator('main').getByRole('button', { name: /^Edit/ })).toHaveCount(0);
    await expect(page.locator('[data-cy="order-draft-action-cancel"]')).toBeVisible();

    // ACTION: Resend email → "Order - Quote"
    await emailSendPage.send('Order - Quote', 'qa_auto_hub_email@gmail.com');

    // CHECK: email_entries row for the quote (order_id = draft id; dev SMTP may fail, so success is only info)
    await expect.poll(() => getNewOrderEmailTemplate(db.hub, quote!.draft_id, lastEmailId), { message: 'quote email in email_entries' }).toBeTruthy();
    const email = await findNewOrderEmail(db.hub, quote!.draft_id, lastEmailId);
    expect(email!.to).toEqual(['qa_auto_hub_email@gmail.com']);
    test.info().annotations.push({ type: 'INFO email', description: `${email!.template_id}, success ${email!.success}` });
  });

  test('O11 a cancelled order cannot be cancelled again or marked as fulfilled', async ({ db, hubCompanyId, orderActionsPage, page }) => {
    // SETUP: a cancelled order O2 has not just touched (its backend run goes on after the answer)
    const order = await findSettledCancelledOrder(db.hub, hubCompanyId);
    test.skip(!order, 'no cancelled order');
    const actionsLoaded = page.waitForResponse((r) => r.url().includes(`/orders/${order!.order_id}/actions`));

    // ACTION: open the order and wait until its allowed actions are loaded
    await page.goto(`en/cms/orders/${order!.order_id}`);
    await actionsLoaded;
    await orderActionsPage.openOrderMenu('Cancel order');

    // CHECK
    await expect(orderActionsPage.menuItem('Cancel order')).toBeDisabled();
    await expect(orderActionsPage.menuItem('Mark as fulfilled')).toBeDisabled();
  });

  test('O11b a fulfilled order without subscriptions can still be cancelled (by design), but not marked as fulfilled again', async ({ db, hubCompanyId, orderActionsPage, page }) => {
    // SETUP: with restrict_cancellation, an order whose subscription started more than cancellation_offset days ago cannot be cancelled
    const order = await findFulfilledOrderWithoutSubscription(db.hub, hubCompanyId);
    test.skip(!order, 'no fulfilled order without subscriptions');
    const actionsLoaded = page.waitForResponse((r) => r.url().includes(`/orders/${order!.order_id}/actions`));

    // ACTION: open the menu only, nothing is clicked
    await page.goto(`en/cms/orders/${order!.order_id}`);
    await actionsLoaded;
    await orderActionsPage.openOrderMenu('Cancel order');

    // CHECK
    await expect(orderActionsPage.menuItem('Cancel order')).toBeEnabled();
    await expect(orderActionsPage.menuItem('Mark as fulfilled')).toBeDisabled();
  });

  test('O12 items of a consumable order that already have subscriptions offer no "Create subscription"', async ({ db, hubCompanyId, page }) => {
    // SETUP: owner - a consumable order is not processed here, its items already have their subscription
    const order = await findConsumableOrderWithAllSubscriptions(db.hub, hubCompanyId);
    test.skip(!order, 'no consumable order where every item has a subscription');
    test.info().annotations.push({ type: 'order', description: `${order!.order_id} (${order!.items} items)` });

    // ACTION: open the order and wait for its product list
    await page.goto(`en/cms/orders/${order!.order_id}`);
    const productList = page.getByText('Product list', { exact: true }).locator('xpath=following::table[1]');
    await expect(productList.locator('tbody tr')).toHaveCount(Number(order!.items), { timeout: 30_000 });

    // CHECK: no item has a "Create subscription" button
    await expect(productList.getByRole('button', { name: 'Create subscription' })).toHaveCount(0);
  });

  test('O10 sends the "Order - Confirmation" email', async ({ db, hubCompanyId, emailSendPage, page, cleanup }) => {
    // SETUP: order emails can be switched off for the company → on for this test, old value back after
    const order = await findOrderWithStatus(db.hub, hubCompanyId, 'fulfilled');
    test.skip(!order, 'no fulfilled order');
    const before = await getOrderAndTransactionNotify(db.hub, hubCompanyId);
    await setNotifyOrders(db.hub, hubCompanyId, true);
    cleanup.add('notify_orders back', () => setNotifyOrders(db.hub, hubCompanyId, before.notify_orders));
    const lastEmailId = await getLastEmailEntryId(db.hub);

    // ACTION
    await page.goto(`en/cms/orders/${order!.order_id}`);
    await emailSendPage.send('Order - Confirmation', 'qa_auto_hub_email@gmail.com');

    // CHECK: email_entries row for this order (dev SMTP may fail, so success is only info)
    await expect
      .poll(() => getNewOrderEmailTemplate(db.hub, order!.order_id, lastEmailId), { message: 'email in email_entries' })
      .toBeTruthy();
    const email = await findNewOrderEmail(db.hub, order!.order_id, lastEmailId);
    expect(email!.to).toEqual(['qa_auto_hub_email@gmail.com']);
    test.info().annotations.push({ type: 'INFO email', description: `${email!.template_id}, success ${email!.success}` });
  });

  test('O13 filters orders by tag and by customer email', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const picked = await findOrderTagAndEmail(db.hub, hubCompanyId);
    test.skip(!picked?.tag || !picked?.email, 'no tagged order or no checkout customer');
    const tagCount = await countOrdersWithTag(db.hub, hubCompanyId, picked!.tag);
    const emailCount = await countOrdersOfEmail(db.hub, hubCompanyId, picked!.email);
    test.info().annotations.push({ type: 'filters', description: `tag ${picked!.tag}, email ${picked!.email}` });

    // ACTION + CHECK: tag
    await hubListPage.open('orders', { tag: picked!.tag, created_at: '' });
    await hubListPage.expectTotal(tagCount, `orders with tag ${picked!.tag}`);

    // ACTION + CHECK: customer email
    await hubListPage.open('orders', { customer_email: picked!.email, created_at: '' });
    await hubListPage.expectTotal(emailCount, `orders of ${picked!.email}`);
  });
});
