import { test, expect } from '@fixtures';
import { testName } from '@data/random';
import {
  countIncludedProducts,
  countVouchers,
  deleteVoucherByCode,
  findExistingVoucherCode,
  findProductForVoucher,
  findVoucherByCode,
  getVoucherId,
} from '@db/queries/hub/vouchers';

// Hub → Vouchers: list, create (amount, percent, product limit), edit, delete, validation.
// Changes data: creates qa_auto vouchers and deletes them again (cleanup deletes them too if a test fails).
test.describe.configure({ mode: 'default' });

// voucher codes must not contain spaces; testName gives qa_auto_<label>_<random>
function newCode(label: string) {
  return testName(label).toUpperCase();
}

test.describe('Hub - vouchers', () => {
  test('V1 list total matches the database and search finds a voucher by code', async ({ db, hubCompanyId, voucherPage }) => {
    // SETUP
    const expected = await countVouchers(db.hub, hubCompanyId);
    const existing = await findExistingVoucherCode(db.hub, hubCompanyId);
    test.skip(!existing, 'no voucher that is not qa_auto');

    // ACTION
    await voucherPage.openList();

    // CHECK: total = database
    await expect.poll(() => voucherPage.total(), { message: 'voucher list total' }).toBe(expected);

    // ACTION + CHECK: search by code shows that voucher
    await voucherPage.search(existing!.voucher_code);
    await expect(voucherPage.rows.filter({ hasText: existing!.voucher_code }).first()).toBeVisible();
  });

  test('V2 V5 V6 creates a fixed-amount voucher, edits it and deletes it', async ({ db, hubCompanyId, voucherPage, cleanup }) => {
    const code = newCode('v_amount');
    const name = testName('voucher');
    cleanup.add('delete the voucher', () => deleteVoucherByCode(db.hub, hubCompanyId, code));
    test.info().annotations.push({ type: 'voucher', description: code });

    await test.step('create: 5 € amount, valid, multi-use, initial payment only', async () => {
      await voucherPage.openCreate();
      await voucherPage.field('Voucher name *').fill(name);
      await voucherPage.field('Voucher code *').fill(code);
      await voucherPage.field('Description').fill('created by the hub test');
      await voucherPage.field('Discount amount *').fill('5');
      await voucherPage.submitCreate();

      await expect.poll(() => getVoucherId(db.hub, hubCompanyId, code), { message: `voucher ${code} in the database` }).toBeTruthy();
      const voucher = await findVoucherByCode(db.hub, hubCompanyId, code);
      expect(voucher!.name).toBe(name);
      expect(Number(voucher!.discount_amount)).toBe(5);
      expect(voucher!.discount_percent).toBeNull();
      expect(voucher!.valid).toBe(true);
      expect(voucher!.visible).toBe(true);
      expect(voucher!.one_time_use).toBe(false);
      expect(voucher!.recurring_discount).toBe(false);
      expect(voucher!.expiry_date, 'expiry date has the form default').not.toBeNull();
    });

    await test.step('edit: new name and valid off', async () => {
      const voucher = await findVoucherByCode(db.hub, hubCompanyId, code);
      await voucherPage.openEdit(voucher!.id);
      await voucherPage.field('Voucher name *').fill(`${name}_edited`);
      await voucherPage.setCheckbox('Valid', false);
      await voucherPage.submitUpdate();

      await expect.poll(async () => (await findVoucherByCode(db.hub, hubCompanyId, code))?.name, { message: 'voucher name after edit' }).toBe(`${name}_edited`);
      expect((await findVoucherByCode(db.hub, hubCompanyId, code))!.valid).toBe(false);
    });

    await test.step('delete from the list', async () => {
      await voucherPage.openList();
      await voucherPage.deleteFromList(code);
      await expect.poll(() => getVoucherId(db.hub, hubCompanyId, code), { message: `voucher ${code} deleted` }).toBeUndefined();
    });
  });

  test('V3 creates a percent voucher with minimum cart value, email and discount on all payments', async ({ db, hubCompanyId, voucherPage, cleanup }) => {
    const code = newCode('v_percent');
    cleanup.add('delete the voucher', () => deleteVoucherByCode(db.hub, hubCompanyId, code));

    // ACTION
    await voucherPage.openCreate();
    await voucherPage.field('Voucher name *').fill(testName('voucher'));
    await voucherPage.field('Voucher code *').fill(code);
    await voucherPage.select('Discount type', 'Percentage');
    await voucherPage.field('Discount percent *').fill('15');
    await voucherPage.field('Minimum cart value').fill('50');
    await voucherPage.field('Voucher specific email').fill('qa_auto_voucher@gmail.com');
    await voucherPage.chooseRadio('Apply discount to initial payment and all recurring payments');
    await voucherPage.setCheckbox('Limit voucher to one time use', true);
    await voucherPage.submitCreate();

    // CHECK
    await expect.poll(() => getVoucherId(db.hub, hubCompanyId, code), { message: `voucher ${code} in the database` }).toBeTruthy();
    const voucher = await findVoucherByCode(db.hub, hubCompanyId, code);
    expect(Number(voucher!.discount_percent)).toBe(15);
    expect(voucher!.discount_amount).toBeNull();
    expect(Number(voucher!.min_cart_value)).toBe(50);
    expect(voucher!.email).toBe('qa_auto_voucher@gmail.com');
    expect(voucher!.recurring_discount).toBe(true);
    expect(voucher!.one_time_use).toBe(true);
  });

  test('V4 creates a voucher limited to one product', async ({ db, hubCompanyId, voucherPage, cleanup }) => {
    // SETUP
    const product = await findProductForVoucher(db.hub, hubCompanyId);
    test.skip(!product, 'no active product with a shop id');
    const code = newCode('v_product');
    cleanup.add('delete the voucher', () => deleteVoucherByCode(db.hub, hubCompanyId, code));
    test.info().annotations.push({ type: 'product', description: product!.title });

    // ACTION
    await voucherPage.openCreate();
    await voucherPage.field('Voucher name *').fill(testName('voucher'));
    await voucherPage.field('Voucher code *').fill(code);
    await voucherPage.field('Discount amount *').fill('3');
    await voucherPage.includeProduct(product!.title);
    await voucherPage.submitCreate();

    // CHECK: one include link to the product
    await expect.poll(() => getVoucherId(db.hub, hubCompanyId, code), { message: `voucher ${code} in the database` }).toBeTruthy();
    const voucher = await findVoucherByCode(db.hub, hubCompanyId, code);
    expect(await countIncludedProducts(db.hub, voucher!.id), 'include product links').toBe(1);
  });

  test('V7 refuses a code that is already used', async ({ db, hubCompanyId, voucherPage, page }) => {
    // SETUP
    const existing = await findExistingVoucherCode(db.hub, hubCompanyId);
    test.skip(!existing, 'no voucher that is not qa_auto');
    const before = await countVouchers(db.hub, hubCompanyId);

    // ACTION
    await voucherPage.openCreate();
    await voucherPage.field('Voucher name *').fill(testName('voucher'));
    await voucherPage.field('Voucher code *').fill(existing!.voucher_code);
    await voucherPage.field('Discount amount *').fill('5');
    await voucherPage.createButton.click();

    // CHECK: error shown, still on the create page, no new voucher
    await expect(page.getByText(/already been taken/i)).toBeVisible();
    await expect(page).toHaveURL(/\/vouchers\/create/);
    expect(await countVouchers(db.hub, hubCompanyId)).toBe(before);
  });

  test('V7 refuses a code with a space', async ({ db, hubCompanyId, voucherPage, page, cleanup }) => {
    // SETUP
    const code = `${newCode('v_space')} X`;
    cleanup.add('delete the voucher if it was saved', () => deleteVoucherByCode(db.hub, hubCompanyId, code));

    // ACTION
    await voucherPage.openCreate();
    await voucherPage.field('Voucher name *').fill(testName('voucher'));
    await voucherPage.field('Voucher code *').fill(code);
    await voucherPage.field('Discount amount *').fill('5');
    await voucherPage.createButton.click();

    // CHECK: still on the create page and nothing saved
    await expect(page).toHaveURL(/\/vouchers\/create/);
    await expect(page.getByText('Voucher created!')).toBeHidden();
    expect(await getVoucherId(db.hub, hubCompanyId, code)).toBeUndefined();
  });

  test('V7 Create stays disabled without a name', async ({ voucherPage }) => {
    // ACTION
    await voucherPage.openCreate();
    await voucherPage.field('Voucher code *').fill(newCode('v_noname'));
    await voucherPage.field('Discount amount *').fill('5');

    // CHECK
    await expect(voucherPage.createButton).toBeDisabled();
  });
});
