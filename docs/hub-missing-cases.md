# Hub – missing test cases (2026-10-17)

How I built this list:
- Read the 19 hub spec files we have today (113 tests).
- Read the hub action menus in `circuly_frontend_mono_v2/apps/nuxt-hub` (each menu item is enabled by a flag from `GET /{ver}/{company}/<entity>/{id}/actions`).
- Read the matching backend routes in `circuly_core_api_lumen/routes/merchant.php` and their controllers.
- Checked the dev DB for company "circuly shopify stripe" to make sure test data exists.

Every case below uses this pattern:
- **Pick data from the DB.** Never use rows that start with `qa_auto`. If no row is found, the test is skipped.
- **Check the UI.** The success dialog or message is shown.
- **Check the DB.** The row has the new value (`expect.poll`).

"Already covered" lists what we have now. Only the missing cases are numbered.

---

## 1. Orders

Already covered: list filters, search, count, export, paging, Draft and Consumable tabs; create order (3 kinds) and quote; detail and notes; cancel and reopen; edit (clone); create invoice; tag; create subscriptions; charge one-time and initial; mark fulfilled; update billing customer; update payment method.

| # | Case | Data (DB) | Expected UI | Expected DB |
|---|---|---|---|---|
| O1 | Bulk "Mark as fulfilled" for 2 orders from the list | 2 `orders` of the company, status not in (cancelled, draft, fulfilled), payment_status paid | Success dialog | Both `orders.status = 'fulfilled'`, plus an `order_histories` row for each |
| O2 | Bulk fulfil when every selected order is cancelled or fulfilled | 1 cancelled order | Error "No orders were found that meet fulfillment criteria." | Status unchanged |
| O3 | Products tab → edit an order item (price, duration, tracking number) | open order with an item that has no subscription | Success | `order_items` price, subscription_duration and tracking_number are the new values |
| O4 | Order item → add serial number (reserve) | open order item without a serial number, plus an `in stock` asset | Success | New latest `product_trackings` row for the serial with `location_status = 'reserved'` |
| O5 | Add a serial number that is already reserved | a serial whose latest status is reserved | Error "Serial number already reserved" | No new `product_trackings` row |
| O6 | Remove the reserved serial number (clean-up of O4) | the O4 item | Success | Serial removed from the item, asset no longer reserved |
| O7 | Draft tab → open a draft → Finalise | `draft_orders` status open, not qa_auto | Success | New `orders` row for the draft, `draft_orders.status = 'completed'` |
| O8 | Draft tab → cancel a draft | open draft created by the test | Success | `draft_orders.status = 'cancelled'`, deleted_at set |
| O9 | ~~Draft → edit (change the item quantity)~~ → quote email (no edit exists, see Results) | open quote | "Email request sent!" | `email_entries` row with order_id = draft id |
| O10 | Order page → Send email (order confirmation template) | latest checkout order | "Email sent" message | New `email_entries` row: order_id, template_id, success = true |
| O11 | Menu items are disabled when the order does not allow them | fulfilled order | "Cancel order" and "Mark as fulfilled" are disabled | – (matches `/orders/{id}/actions`) |
| O12 | ~~Process a consumable order~~ (owner: not done) → consumable order whose items all have a subscription: no "Create subscription" button | consumable order | No button | – |
| O13 | List: search by customer email, filter by tag | tag set by the existing tag test | Rows shown | Count = `orders` with that email / tag |

## 2. Subscriptions

Already covered: list filters, export, paging; 14 menu actions (auto-renew, auto-reactivate, buyout, interval, quantity, length and price, extension price, extend, reactivate, serial, end (digital), pending return, swap, open order).

| # | Case | Data (DB) | Expected UI | Expected DB |
|---|---|---|---|---|
| S1 | Import subscriptions from CSV | CSV with qa_auto serials for an existing order | Success | New `subscriptions` rows with those serial numbers |
| S2 | Replace the serial with one already used by another active subscription | 2 active subscriptions | Warning "serial number exists", nothing saved | `serial_number` unchanged |
| S3 | Change quantity to 0 | active consumable subscription | Validation error | quantity unchanged |
| S4 | Extend by 0 cycles / extension price below 0 | active normal subscription | Validation error | unchanged |
| S5 | Menu items are disabled for an ended subscription | ended subscription | Buyout, Extend and Change quantity are disabled | matches `/subscriptions/{id}/actions` |
| S6 | Detail tabs show DB data: Payments, Recurring payments, Billing, Bundle items | active subscription with 3+ RPs | Rows shown | Row count = `recurring_payments` / `transactions` of that subscription |
| S7 | Send subscription email | active subscription | "Email sent" | `email_entries` row with subscription_id and success = true |
| S8 | List: search by serial number and by customer email; filter status "pending return" | – | Rows shown | Count = DB |

## 3. Payments (Transactions tab) – no tests yet

| # | Case | Data (DB) | Expected UI | Expected DB |
|---|---|---|---|---|
| P1 | List total after clearing filters | – | Total shown | = `transactions` count of the company |
| P2 | Filter status "failed" (also "succeeded") | – | Every row shows that status | Count = DB |
| P3 | Search by transaction_id | latest succeeded transaction | 1 row | – |
| P4 | Open a transaction: amount, PSP, type, invoice type and number, order, customer, subscription | same | Values shown | = `transactions` + `invoices` row |
| P5 | Download invoice PDF from the transaction | transaction with an invoice | File `<invoice_number>.pdf` | – |
| P6 | Send email (payment successful template) | succeeded transaction of the test customer | "Email sent", or "Transaction email sending has been disabled" when `email_settings.notify_transactions` is false | `email_entries` row with transaction_id, template_id, success = true |
| P7 | The order, customer and subscription links open the right records | same | URL has the ids | – |
| P8 | Paging and page size | – | Works | – |

## 4. Invoices

Already covered: list search and filters, open, PDF, full and partial refund, cancel and regenerate, mark paid, block auto-claim, claim, charge, e-invoice rows (DB only).

| # | Case | Data (DB) | Expected UI | Expected DB |
|---|---|---|---|---|
| I1 | Menu → Regenerate PDF | paid recurring invoice | "Regenerating…" then success | `invoices.updated_at` is newer |
| I2 | Menu → Download ZUGFeRD and Download XRechnung | newest invoice of each type, including cancellation, full_refund and partial_refund (the types with no rows today) | File downloaded | `e_invoices` rows `zugferd` and `xrechnung` exist for that invoice |
| I3 | Unblock auto-claim (pair with the block test) | invoice with `auto_claim_blocked = true` | Success | `auto_claim_blocked = false`, blocked_at and reason NULL |
| I4 | Edit invoice (`/invoices/{id}/edit`) | unpaid invoice; needs the invoice edit feature setting | Success, or "Unauthorized feature access." | Invoice HTML and updated_at changed |
| I5 | Bulk download: select 2 invoices → zip | 2 paid invoices | Zip downloaded with 2 PDFs | – |
| I6 | Cumulated invoices tab | – | Rows shown | Count = invoices of type `cumulated invoice` |
| I7 | Refund more than the refundable amount | paid invoice | Validation error | No new refund invoice or transaction |
| I8 | Paid invoice: Mark as paid and Charge are disabled | paid invoice | Menu items disabled | matches `/invoices/{id}/actions` |
| I9 | Invoice detail: transactions table | invoice with 2+ transactions | Rows shown | = `transactions` with that invoice_number |
| I10 | Send invoice email | paid invoice | "Email sent" | `email_entries` row with invoice_number, plus `e_invoices` rows created (EInvoiceService) |

## 5. Recurring payments

Already covered (on the subscription page only): delete, settle, unsettle, charge, change all future amounts. The tab `/cms/recurring-payments` has no tests.

| # | Case | Data (DB) | Expected UI | Expected DB |
|---|---|---|---|---|
| R1 | Tab list total; filter status settled / not settled / failed | – | Total shown | Count = `recurring_payments` of the company with that status |
| R2 | Search by subscription id and by order id | open RP | Rows of that subscription only | – |
| R3 | Edit one RP (amount and quantity) without "change all future" | open RP of an active normal subscription | Success | Only that RP has the new amount and quantity; the other open RPs are unchanged |
| R4 | Edit with amount < 0 or quantity 0 | same | Validation error | unchanged |
| R5 | Charge a failed RP from the tab menu | `recurring_payments` failed = true, Stripe card order | Success | `payment_settled = true`, plus a new `invoices` row and a new `transactions` row |
| R6 | Settled RP: Settle is disabled; not-settled RP: Unsettle is disabled | one of each | Menu items disabled | matches `/recurring-payments/{id}/actions` |
| R7 | View order / View subscription from the RP menu | – | Opens the right ids | – |

## 6. Customers

Already covered: find by id, page tabs, balance +5/−5, language, Login CSS, process open orders, note.

| # | Case | Data (DB) | Expected UI | Expected DB |
|---|---|---|---|---|
| C1 | Edit customer: phone, VAT, date of birth, external id, marketing consent | customer with a checkout order, not qa_auto | Success | `customers` row has the new values (old values restored by cleanup) |
| C2 | Edit billing and shipping address | same | Success | `addresses` rows updated (old values restored) |
| C3 | Data transfer: source email → target email, with consent | 2 test customers (see question 2) | Success | Orders and subscriptions of the source now have the target customer_id |
| C4 | Data transfer without consent / unknown email | – | Validation error | nothing moved |
| C5 | List: search by email and name, paging | – | Rows shown | Count = DB |
| C6 | Tabs Subscriptions, Assets, Payments, Pending actions | customer with 2+ subscriptions | Rows shown | Counts = `subscriptions` / `product_trackings` / `transactions` of that customer |
| C7 | Account balance: remove more than the balance, or enter text | customer with balance 0 | Validation error | `customer_account_history` has no new row |
| C8 | Note: edit and delete on the customer page | note created by the existing test | Success | `notes` row updated, then deleted |

## 7. Debt collection

Already covered: find, filter by status, details, comment, PDF upload.

| # | Case | Data (DB) | Expected UI | Expected DB |
|---|---|---|---|---|
| D1 | Download the uploaded PDF | claim with file_urls | File downloaded | – |
| D2 | The new comment shows in the activity timeline | claim used by the comment test | Comment text visible | `debtist_claims.activities` contains it |
| D3 | Financial details = invoice amounts | claim with invoice_ids | Amounts shown | Sum = `invoices` amounts of those ids |
| D4 | Payments table | claim with payments | Rows shown | = `debtist_claims.payments` |
| D5 | Upload a non-PDF or too large file | – | Error | file_urls unchanged |
| D6 | Invoice blocked from auto-claim shows the banner | invoice with `auto_claim_blocked = true` | Banner visible | – |

## 8. Returns

Already covered: Mark as returned → asset `to repair` (asset status only).

| # | Case | Data (DB) | Expected UI | Expected DB |
|---|---|---|---|---|
| RT1 | Mark as returned also ends the subscription | same as now | Success | `subscriptions.status = 'ended'`, real_end_date = today, open RPs deleted |
| RT2 | Mark as returned with "delete open recurring payments" switched off | active subscription with open RPs | Success | Open RPs still exist |
| RT3 | Handle → Mark as bought | active normal subscription with a serial | Success | Latest `product_trackings` row is `bought out`, subscription ended |
| RT4 | List shows active + pending return + pending replacement; filter "pending return" | – | Rows shown | Count = DB |
| RT5 | Search by order id | – | Row shown | – |
| RT6 | Serial shared by 2 active subscriptions | if such data exists | Error "Serial number is shared among multiple subscriptions" | Nothing changed |

## 9. Assets – no tests yet

Data on dev: rented out 3596, in stock 411, bought out 405, pending buyout 406, to repair 257, reserved 101, stolen 12, broken 1.

| # | Case | Data (DB) | Expected UI | Expected DB |
|---|---|---|---|---|
| A1 | List total; filter location status "in stock" | – | Total shown | = distinct serials (`distinct_product_trackings_view`) with that status |
| A2 | Search by serial number | latest `in stock` asset | 1 row | – |
| A3 | Asset page: SKU, name, status, subscription link, insights | same | Values shown | = latest `product_trackings` row |
| A4 | Change status in stock → stolen, then back to in stock | `in stock` asset, not qa_auto | Success | New latest `product_trackings` row with `stolen`, then `in stock` |
| A5 | Change status to repair → bought out | `to repair` asset | Success | Latest row `bought out` |
| A6 | "Rented out" asset: Change status is disabled | rented-out asset | Menu item disabled | `allow_status_change = false` |
| A7 | Only the allowed statuses are offered (in stock: bought out, removed, stolen) | in-stock asset | Option list | – |
| A8 | Import assets from CSV (sku, product_name, serial_number, status) | qa_auto serials, existing SKU | Success | New `product_trackings` rows |
| A9 | Import a CSV without the "status" column | – | Error | No rows |
| A10 | Export CSV | – | File with columns sku, product_name, serial_number, status, location_id | Row count = DB |

## 10. Products

Already covered: 25 tests (list, filters, create with variant, pages, bulk price edit, collection map, variants, attributes, sync). Taxes, Exchange groups and Bundles stay untouched.

| # | Case | Data (DB) | Expected UI | Expected DB |
|---|---|---|---|---|
| PR1 | Create product: missing SKU, or SKU already used | – | Validation error | No new `products` row |
| PR2 | Bulk edit: set the qa_auto test product inactive, then active again | the product created by the test | Success | `products.active` false, then true |
| PR3 | Variants bulk edit: stock | the qa_auto variant | Success | `product_variants.stock` = new value |
| PR4 | Title translations (add German title) | the qa_auto product | Success | Translation row saved |
| PR5 | Attribute: edit and delete an option | attribute created by the test | Success | `product_attribute` option updated, then removed |
| PR6 | Attribute with a name that already exists | – | Validation error | – |

## 11. Repairs

Already covered: Start repair → asset `in stock`.

| # | Case | Data (DB) | Expected UI | Expected DB |
|---|---|---|---|---|
| RP1 | ~~Filters "New" and "Blocked"~~ (dropped by owner) | | | |
| RP2 | Repair page shows the asset and subscription data | `to repair` asset | Values shown | = `product_trackings` + `subscriptions` |
| RP3 | ~~Repair questions saved~~ (dropped by owner) | | | |
| RP4 | Export button | – | CSV downloaded | Row count = DB |

## 12. Vouchers – no tests yet

Data on dev: 50 vouchers, 26 valid, none qa_auto. Table `checkout.checkout_voucher_codes`. Delete is a hard delete.

| # | Case | Data (DB) | Expected UI | Expected DB |
|---|---|---|---|---|
| V1 | List total; search by code | – | Rows shown | Count = DB |
| V2 | Create a fixed-amount voucher (`qa_auto_v_…`, 5 €, valid) | – | Success | Row: discount_amount 5, valid true, one_time_use and recurring_discount as chosen, company_id |
| V3 | Create a percent voucher with expiry date, min cart value and email | – | Success | Row: discount_percent, expiry_date, min_cart_value, email |
| V4 | Create a voucher limited to a product / variant | active product, not qa_auto | Success | Row in `voucher_codes_include_products_pivot` (or `..._variants_pivot`) |
| V5 | Edit: change name, set valid off | the V2 voucher | Success | Row updated |
| V6 | Delete | the V2 voucher | Success | Row gone |
| V7 | Code already used / code with a space / no amount and no percent / no name | – | Validation errors | No new row |
| V8 | (optional) The new voucher works in the Stripe checkout | the V2 voucher | Discount −5 € | `carts.voucher_*` |

## 13. Stores – no tests yet

Data on dev: 54 retailers (stores), 4 sites. Both use soft delete. There is no API route to delete a store.

| # | Case | Data (DB) | Expected UI | Expected DB |
|---|---|---|---|---|
| ST1 | Stores tab: list total and search | – | Rows shown | = `retailers` of the company, deleted_at null |
| ST2 | ~~Create store~~ (dropped: can't be cleaned up) | | | |
| ST3 | Create store validation: location_id already used / with a space / city, street or postal code empty | – | Validation error | No new row |
| ST4 | ~~Edit store~~ (dropped: needs the ST2 store) | | | |
| ST5 | ~~New store logs into POS~~ (dropped: needs the ST2 store) | | | |
| ST6 | "POS login" button opens the POS login page | – | URL of the POS | – |
| ST7 | Sites tab: list, create site, edit, delete | – | Success | `sites` row created and updated, deleted_at set |

---

## Owner answers (2026-10-17)

1. **Emails (O10, S7, P6, I10):** sending them from dev is fine. Check each one only in `email_entries` (template_id, the order / subscription / transaction / invoice number, success = true).
2. **Customer data transfer (C3):** allowed.
3. **Rows that can't be cleaned up** (new stores): skip those tests → ST2, ST4 and ST5 dropped.
4. **CSV imports (S1, A8):** qa_auto serial numbers are OK.
5. **B2B order, CRIF, order dissect:** not needed.
6. **Repairs "Blocked" filter and repair questions:** not needed → RP1 and RP3 dropped.
7. **Order of work:** any order.
8. **Files:** new tests go only in new files. Old tests stay as they are.

The subscription cron cases (auto renew, pending return, force reactivate) and the multi-parameter filter cases are in [hub-cron-and-filter-cases.md](hub-cron-and-filter-cases.md).

---

## Results (2026-10-17)

All cases are written in new files under `tests/hub-e2e/` and were run one file at a time.

| Tab | File | Result |
|---|---|---|
| Orders | `orders/order-gaps.spec.ts` | O1, O3–O13 + O11b pass · O2 **fails = bug CIR-1595** |
| Subscriptions | `subscriptions/subscription-gaps.spec.ts` | S1–S8 pass |
| Payments | `payments/payments.spec.ts` | P1–P8 pass |
| Invoices | `invoices/invoice-gaps.spec.ts` | I1–I10 pass |
| Recurring payments | `recurring-payments/recurring-payments-tab.spec.ts` | R1–R7 pass |
| Customers | `customers/customer-gaps.spec.ts` | C1, C3–C8 pass (C2 dropped) |
| Debt collection | `debt-collection/debt-collection-gaps.spec.ts` | D1–D4, D6 pass · D5 **fails = bug CIR-1596** |
| Returns | `returns/returns-gaps.spec.ts` | RT1–RT5 pass · RT6 dropped (see below) |
| Assets | `assets/assets.spec.ts` | A1–A10 pass |
| Products | `products/product-gaps.spec.ts` | PR1a, PR2, PR3, PR5, PR6 pass · PR1b **fails = bug CIR-1597** · PR4 dropped |
| Repairs | `repairs/repairs-gaps.spec.ts` | RP2, RP4 pass |
| Vouchers | `vouchers/vouchers.spec.ts` | V1–V7 pass (V8 optional, not written: hub tests may not use checkout pages) |
| Stores | `stores/stores.spec.ts` | ST1, ST3, ST6 pass · ST7 **fails = bug CIR-1598** (address part) |
| Crons / filters | `subscriptions/subscription-crons.spec.ts`, `filters/list-filters.spec.ts` | C1–C3 and F1–F24 pass |

### Bugs (Linear)

- **CIR-1595** (High): bulk "Mark fulfilled" sets a cancelled order to fulfilled and starts its subscriptions (seen: 3 subscriptions with 11 RPs each on order 7163356872842). O2 now deletes subscriptions it causes.
- **CIR-1596** (Low): debt-collection claim upload accepts any file type and size (no check in hub or API).
- **CIR-1597** (Medium): "Create product" accepts a SKU another product already has.
- **CIR-1598** (Medium): "Edit site" does not save address changes (site-form copies the site by reference).

### Real behaviour that differs from the cases above (tests check the real behaviour)

| Case | Case list said | Real behaviour |
|---|---|---|
| O2 | Error "No orders were found…" | No error; the cancelled order is fulfilled → bug CIR-1595 |
| O9 | Draft → edit quantity | A quote has no edit: the quote page only has "Resend email" (template "Order - Quote") and Cancel. `/orders/drafts/{id}/edit` loads an order, not a quote, and nothing links to it. O9 now sends the quote email (`email_entries.order_id` = draft id). |
| O11 | Fulfilled order: Cancel disabled | Cancel is allowed for open, fulfilled and delivered orders, unless `restrict_cancellation` and the subscription started more than `cancellation_offset` days ago. O11 uses a cancelled order, O11b a fulfilled order without subscriptions. |
| I10 | Send invoice email | The invoice page has no email action (invoice emails go from the payment page, P6). I10 checks that, and that the PDF download writes the `e_invoices` rows. |
| C1 | Edit billing city | Address fields are disabled in "Edit customer"; C1 checks that. |
| C6 | Tabs | Sections on the General tab, each with its own total: Orders, Subscriptions (once per order item), Payments (distinct transaction ids), Assets (latest row per serial). |
| R4 | quantity 0 refused | Quantity is disabled for normal subscriptions (checked in R3); R4 checks a negative amount. |
| A6 | Change status disabled | The menu item stays enabled; the dialog only offers the current status (A3/A6). |
| D5 | Non-PDF refused | Accepted (201) → bug CIR-1596. The picker only suggests images/PDF. |
| RT1 | Open RPs deleted | Open RPs are disabled (`enabled = false`), not deleted. |
| RT3 | Subscription ended | Status becomes `manual bought out` (hub = manual), asset `bought out`. |
| RT6 | Shared serial error | Not reachable from the hub: the Handle dialog works by subscription id; the error is only in the API route `assets/{serial}/repair`, and it compares one subscription_id, so it cannot trigger. Dropped. |
| PR2 | Bulk edit Active | Active is not editable in the list (only on the edit page, which exists only for Circuly-shop companies). PR2 switches "Allow order create" instead. |
| PR3 | Variant stock | Stock is not editable in the variants list; PR3 edits Duration. |
| PR4 | Title translations | Not editable after create for this shop type (the create test already saves the German title). Dropped. |
| ST6 | POS URL | Opens `pos_settings.identifier` + `/en/auth/login?location_id=&password=` — for the test company that is `hz-dev.pos.circuly.org`, not the dev POS in `.env` (company setting, not a code bug). |
| ST7 | Delete site | No delete in the hub UI (only the API). The test site is deleted by cleanup. |
