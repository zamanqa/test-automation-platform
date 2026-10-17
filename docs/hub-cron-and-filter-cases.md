# Hub – subscription cron cases and multi-filter cases (2026-10-17)

These are new cases on top of [hub-missing-cases.md](hub-missing-cases.md). Each group gets its own new spec file; old spec files stay as they are.

The rules for every case:
- Data is picked by a DB query, per company (`companyId` fixture), using the same conditions as the backend code. Rows starting with `qa_auto` are never used.
- Expected values are calculated from the DB and the company settings, never hard-coded.
- Each test checks the DB and the hub page (status chip, dates, success message).
- Emails are checked only in `email_entries`.

Company settings on dev for "circuly shopify stripe" (734f-4c766638po). Tests read these at run time:

| `subscription_settings` | value | used by |
|---|---|---|
| auto_renew | true | C1 (if false, the job does nothing → test is skipped) |
| notice_period | 10 | C1: a subscription is renewed when subscription_end < today + 10 days |
| auto_renew_custom_duration / auto_renew_duration | true / 1 | C1: renew by 1 cycle |
| auto_renew_extend_by_billing_cycle | false | C1: normal subscriptions do NOT use frequency_interval; consumable ones do |
| max_duration | 30 | C1: if start → new end ≥ 30 cycles, auto_renew becomes false; if > 30, nothing changes |
| return_until_period | 5 | C2: return_until = now + 5 days |
| reactivate_period | 2 | C3: return_until must be between today − 4 and today − 2 days |
| force_reactivate | true | C3: if false, the job does nothing → test is skipped |
| `email_settings.notify_pending_return` | true | C2: pending-return email |

---

## File 1: `tests/hub-e2e/subscriptions/subscription-crons.spec.ts`

### C1 – Auto renew (POST `{core}/{company}/subscriptions/{subscription_id}/sync`)

Backend: `SubscriptionsController::sync` puts `SubscriptionAutoRenewQueue` on the `subscription` queue.

**Data:**
- `subscriptions` of the company with status = 'active', auto_renew = true, is_circuly_recurring = true, origin ≠ 'shopify' (Shopify subscriptions follow a different path).
- subscription_type 'normal' with frequency monthly. A second test uses a 'consumable' one with frequency_interval > 1.
- Not qa_auto, and months from subscription_start to (end + 1 cycle) < max_duration. Today 530 normal subscriptions match.

**Setup:** set subscription_end = today − 1 day. Save the old row and its open RPs first.

**Expected result** (calculated in the test):
- **Renewal length:**
  - normal: auto_renew_duration (1) × frequency.
  - consumable (or when extend_by_billing_cycle is true): auto_renew_duration × frequency_interval.
- **Subscription row:**
  - new subscription_end = old end + the renewal length (e.g. monthly → + 1 month).
  - subscription_duration = old + renewal length.
  - auto_renew_count = old + 1.
  - auto_renewed = true.
  - next_billing_date = old end + 1 day.
- **New recurring payment:** 1 new `recurring_payments` row (for consumable: one every frequency_interval):
  - billing_date = old end + 1 day.
  - amount = subscription_extension_price if > 0, else the variant's subscription_extension_price if > 0, else subscription_price.
  - quantity = subscription quantity.
  - payment_settled = false.
- **Old open RPs:** RPs with billing_date after the new next billing date that are unsettled and not failed get enabled = false.

**Checks:**
- API answer: `{ success: true, message: 'Subscription sync successfully started' }`.
- DB: poll the subscription row until auto_renew_count has gone up.
- Hub subscription page: the end date and the new RP in the Recurring payments tab.

**Negative cases:**
- Unknown id → 404 "Subscription not found."
- A subscription with auto_renew = false and end = yesterday → the job runs but the row is unchanged.

**Clean-up:** none. The renewed row stays. The owner allows this because it is the real flow.

### C2 – Expired subscription goes to pending return (POST `{core}/{company}/system/cron?class=SubscriptionEndActiveQueue&queue=subscription&wait=false`)

Backend: `SubscriptionEndActiveQueue` picks status = 'active', auto_renew = false, `date(subscription_end) < date(now − 1 day)`. It takes at most 50 rows, newest end first.

> **Note:** "1 day older than today" is **not** enough. The job needs subscription_end ≤ today − 2 days. The test sets **today − 2 days**.

**Side effect:** the job handles every expired row of the company, not only ours. Today there are 0 other rows. The test counts them first and is skipped if there are any, so no other subscription is changed.

**Data:**
- Normal: status 'active', subscription_type 'normal', not qa_auto, with open RPs.
- Digital: a second test with subscription_type 'digital'.

**Setup:** set auto_renew = false and subscription_end = today − 2 days.

**Expected result** (`SubscriptionsManager::returnSubscription`):
- **Normal or consumable:**
  - status = 'pending return'.
  - return_until = now + return_until_period (5) days.
  - return_reason = 'expired'.
  - next_billing_date = NULL.
  - real_end_date = today (if it was empty).
  - RPs that are unsettled, not failed and have no invoice get enabled = false.
  - Normal only (not consumable): a new `email_entries` row with subscription_id and success = true, the pending-return email.
- **Digital** (`endSubscription`): status = 'ended' and real_end_date = today.

**Checks:**
- API answer: `success: true, "SubscriptionEndActiveQueue task has been pushed & executed."`.
- DB: poll the status.
- Hub: the subscription shows "pending return". The Returns list finds it by serial number.

### C3 – Force reactivate (POST `{core}/{company}/subscriptions/process-to-reactivate`)

Backend: `SubscriptionController::processToBeReActivated` uses the `toReactivate` scope:
- status in ('pending return', 'pending replacement'),
- auto_reactivate = true,
- `date(return_until) < today − reactivate_period`,
- `date(return_until) > today − 2 × reactivate_period`.

The request always sends `subscription_ids`. Without them, every matching subscription of the company is reactivated (155 pending-return rows have auto_reactivate on today).

> **Note:** the date this API uses is **return_until**, not subscription_end. Reactivation does **not** change subscription_end.
>
> The example id 1877565241922182_hxtcdsjx2g_43014354632842 has auto_reactivate = false, so it would never be picked.

**Data:** a subscription with status 'pending return', type normal, auto_reactivate = true, not qa_auto.

**Setup:** set return_until = today − (reactivate_period + 1) days, which is today − 3 days.

**Steps and expected results:**
1. **Dry run** with `{ subscription_ids: [id], do_not_process: true }`:
   - Answer: `process: true`, "Found 1 subscriptions", `subscription_ids` contains the id, `reactivate_period` = 2.
   - DB unchanged.
2. **Run** with `{ subscription_ids: [id] }`. This puts `ProcessSubscriptionsToBeActivatedQueue` on the `notify` queue. Expected (`reactivateSubscription`):
   - status = 'active'.
   - reactivated_count = old + 1.
   - return_reason = 'Reactivated due to customer no return'.
   - real_end_date = NULL.
   - cancellation_date / type / reason = NULL, and cancelled_by_customer = false.
   - All unsettled RPs get enabled = true.
   - next_billing_date is set again.
   - auto_renew = true, unless the length is ≥ max_duration (then false).
   - subscription_end is unchanged.
   - A new `email_entries` row (subscription reactivated) with success = true.
3. **Negative:** return_until = today (outside the window) → "No subscriptions to process, found 0 records", DB unchanged.

**Hub check:** the subscription shows "active" again, with the RPs in the Recurring payments tab.

**To confirm on the first run:**
- Do the dev `subscription` and `notify` queue workers pick up the jobs (C1, C3)? If not, the test starts them like the existing cron tests do.
- Does the HUB_API user have the `admin-sys` permission needed for `system/cron` (C2)?

---

## File 2: `tests/hub-e2e/filters/list-filters.spec.ts` – filters with several parameters

**How a filter works:** the hub puts each filter in the URL as `field=mode:value`, e.g. `?status=matches:active||pending%20return&subscription_type=matches:normal&subscription_end=between:2026-01-01and2026-12-31`. The modes are matches (= / IN), contains (ILIKE %v%), excludes, greater, less, between (dates, end of day included), special (empty), and days/weeks/months/years (relative dates). The backend applies them in `PaginationAndFilterService` on top of `QueryService.buildFilterable<List>`.

**Default filters (found on the first run):** the hub adds `created_at=days:0and-30` to every list (recurring payments: `billing_date=days:0and30`). Each test sets the date or clears it with an empty value (`created_at=`). An empty value is dropped from the URL, so after a reload the default is back; F23 therefore uses a real date range.

**Result 2026-10-17:** `tests/hub-e2e/filters/list-filters.spec.ts`, 24/24 pass (read-only).

**For every case:**
- **Data:** the filter values are picked from the DB so the result is never empty. For example: the SKU with the most "in stock" assets, the email of the newest customer that has an order, a date range around the newest row. If the count is 0, the test is skipped.
- **Filters:** each filter is set in the filter panel, one after the other. The URL then holds all of them.
- **UI check:** the total shown = the DB count with the same conditions, and every row on page 1 meets all the conditions.
- **DB check:** a count query with the backend's base conditions plus the filters.
- **Last step:** "Clear filters" → the total is back to the unfiltered count.

| # | List | Filters combined | Base of the DB query |
|---|---|---|---|
| F1 | Orders | status = open + payment_status = paid + origin = checkout | `orders` of the company |
| F2 | Orders | customer_email contains <picked> + created_at between <range> + subscription_type = consumable | orders ⋈ order_customers |
| F3 | Orders | status matches open‖fulfilled (2 values) + voucher_code = <picked> | orders |
| F4 | Subscriptions | status = active + subscription_type = normal + subscription_frequency = monthly | `subscriptions` |
| F5 | Subscriptions | status = pending return + auto_renewed = true + subscription_end between <range> | subscriptions |
| F6 | Subscriptions | customer_email contains <picked> + item_sku = <picked> + status matches active‖cancelled | subscriptions ⋈ orders ⋈ order_customers |
| F7 | Payments | status = failed + invoice_type = <the type with most failed rows; dev has no failed "recurring payment"> + created_at between <range> | `transactions` |
| F8 | Payments | payment_service_provider contains stripe + status = succeeded + amount greater <x> | transactions |
| F9 | Invoices | type = recurring payment + paid = false + created_at last 30 days | invoices ⋈ transactions |
| F10 | Invoices | payment_status = succeeded + initial_invoice = true + amount greater <x> | same |
| F11 | Recurring payments | payment_settled = false + failed = true + billing_date between <range> | `recurring_payments` |
| F12 | Recurring payments | status = settled + payment_system = stripe + subscription_id = <picked> | recurring_payments |
| F13 | Customers | created_at between <range> + account_balance greater 0 | `customers` |
| F14 | Customers | email contains <picked domain> + created_at between <range> (customer_type is not a backend filter column) | customers |
| F15 | Debt collection | status = open + stage = precourt + created_at between <range> | `debtist_claims` (data: 33 open / precourt) |
| F16 | Returns | status = pending return + subscription_type = normal + serial_number contains <picked> | subscriptions with status in (active, pending return, pending replacement) |
| F17 | Assets | location_status = in stock + sku = <picked> | latest row per serial (`distinct_product_trackings_view`) |
| F18 | Assets | location_status matches rented out‖reserved + product_name contains <picked> + created_at between <range> | same |
| F19 | Repairs | sku = <picked> + created_at between <range> | to-repair assets (same view) |
| F20 | Products | active = true + allow_order_create = true + stock greater 0 | `products` of the company |
| F21 | Vouchers | valid = true + one_time_use = false + discount_amount greater 0 | `checkout.checkout_voucher_codes` |
| F22 | Stores | enabled = true + name contains <picked> | `retailers`, deleted_at null |
| F23 | Any list | the same filters opened directly by URL give the same total as the panel | – |
| F24 | Any list | filters + paging: the total stays the same on page 2 | – |
