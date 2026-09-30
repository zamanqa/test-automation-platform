# CLAUDE.md — test-automation-platform

Project memory for future sessions (people and Claude). Read this first.

## What this is

Playwright + TypeScript automation for Circuly, migrated from four Cypress repos
(2026-09-23). One repo, four suites (= Playwright projects), one shared code base:

| Suite | Tests | Old repo (still exists, untouched) |
|---|---|---|
| `tests/unified-api` | 74 | `zamanqa/unified-customer-api` |
| `tests/customer-api` | 97 | `zamanqa/cus-api` (old API, still used by customers) |
| `tests/hub-e2e` | 91 + login setup | `zamanqa/hub-e2e-automation` |
| `tests/checkout-e2e` | 12 + wake-up setup | `zamanqa/checkout-e2e` |
| `tests/pos-e2e` | 17 (2026-09-29) | new — POS portal (StoreConnect) |
| `tests/css-e2e` | 11 + login (2026-09-29) | new — customer self-service portal |

Load tests stay separate in `zamanqa/loadtesting` (k6). `circuly-dev/performance-tests`
is the developers' repo — not used here.

## Owner and rules

- Owned and run only by the Senior SQA (Md Shahiduz Zaman). Development environment only.
- **Do not commit or push without explicit confirmation.** Remote: https://github.com/zamanqa/test-automation-platform
  (PUBLIC, owner's choice; first push 2026-09-30). Never commit `.env`, `.auth/` or `reports/` (git-ignored).
- The databases are the shared dev databases with full read/write access. Tests
  change real rows; crons are switched off during some tests. Ask before running
  data-changing tests unless the owner has said to proceed.

## Commands (Windows: use `npm.cmd` if PowerShell blocks `npm`)

```bash
npm install
npx playwright install ffmpeg      # once: video recording on failure
npm run test:ui                    # Playwright UI mode, for writing tests
npm run hub / hub:headed / checkout:headless / api:unified / api:customer
npm run hub:login                  # force a new hub login (normally reused for 24 h, see auth.setup.ts)
npx playwright test --project=unified-api -g "cancels"
npm run typecheck && npm run lint
npm run checkout                   # headed; all checkout spec files at once (one per shop), tests in a file in order
npm run stripe / adyen / braintree / mollie   # one checkout file, headed (full screen)
npm run api:customer               # all customer-api files, 4 files at a time (tests in a file in order)
npm run api:customer -- invoices.spec          # one customer-api file (API = no browser, --headed has no effect)
npm run runner                     # browser test runner http://localhost:4455 (runner/server.js): run suite/file/test/last failed, headed or headless,
#                                    queue, live log, rerun failed (reruns use the chosen Mode, 2026-09-29), env check, notification;
#                                    🐞 Debug (UI suites) = --debug: Chrome + Playwright Inspector, paused before each test (setup too), F10 step / F8 resume; Reports (open/PDF/zip/delete/compare), History, Settings
#                                    Test sync: tests/ is watched → counts per suite + added/deleted shown; "⟳ Sync tests" by hand
#                                    Claude tab: "🤖 Ask Claude" on a failed test → claude CLI (owner's login) proposes a fix read-only;
#                                    "Apply fix" edits (backup in reports/.claude-backup, "Undo") and reruns that test. runner/claude.js
npm run summary                    # open reports/index.html: every suite, its runs of the last 3 days → click a run for summary + error log
npm run report                     # Playwright report of the newest run (screenshots, video, trace); npm run report -- hub-e2e
# Reports: reports/<suite>/<start time>/ {index.html, html-report/, test-results/, summary.json} + <start time>.zip (download);
# runs older than 3 days are deleted (reporter + runner); runner lists are paginated (10 per page). A suite folder appears on its first run. --last-failed works per suite (reports/<suite>/.last-run.json).
```

## How the code connects (read in this order)

1. `playwright.config.ts` — the 4 projects, Chrome (`channel: 'chrome'`), workers: 1 per suite.
   UI suites: headless = 1920x1080; `--headed`/`--debug` = maximized window that fits the screen (`browserWindow`, 2026-09-30).
2. `src/fixtures/index.ts` — **the wiring point**. Test asks for `{ db, unifiedApi, orderListPage, ... }`
   → fixture creates the class. Header comment has the full map.
3. `src/config/env.ts` — every `.env` variable, validated per group on first use (`env.hub.HUB_URL`).
4. Databases: `src/db/databases.ts` (the one list: `hub`, `checkout`) → `connection.ts` (`Database`,
   `createDatabases`) → `src/db/queries/hub/*.ts` (plain functions, first arg = `db.hub`).
5. API: `src/api/BaseApiClient.ts` (`send()`) ← `UnifiedApiClient` (JWT) / `CustomerApiClient` (basic auth)
   / `HubApiClient` (Lumen login, crons). Endpoint groups in `*/endpoints/` call back into their client.
6. Pages: `src/pages/hub/*`, `src/pages/checkout/*` (+ `payment/` for provider iframes). Constructor gets `page`.
7. Data: `src/data/payloads/{unified-api,customer-api,shared}`, `src/data/static/{hub,checkout}.ts`,
   `src/data/random.ts` (everything created is prefixed `TEST_DATA_PREFIX`, default `qa_auto_`).
8. `src/db/cleanup.ts` — undo steps that run after a test even when it fails.

Annotated example spec: `tests/unified-api/orders/orders.spec.ts`.

## Code style — keep it SIMPLE (owner is a QA, not a developer; 2026-09-27)

- Write tests as plain steps a mid-level QA can read: one action per line, short plain-English comments.
- Use direct checks on the page: `await expect(locator).toHaveText('(19%)')`, `toBeVisible()`, `toHaveURL(/\/de\//)`.
- Write values in the test when only that test uses them ('Germany', 'Weiter'); no data tables + loops to save lines.
- Avoid: `expect.poll(async …)`, `flatMap`/`reduce`/`evaluateAll`, `as const`/`satisfies`/`keyof` types, spread tricks,
  `test.step` inside loops, generic helpers with many options. A little repetition is fine.
- Page objects: small methods named after what the user does; return a locator or one value.
- The checkout files (src/pages/checkout, tests/checkout-e2e, src/reporters) follow this style — copy them.

## Comment convention (keep it when adding code — the owner reads the code through these)

- **Test files:** top block `WHAT / FROM / NEEDS / CHANGES DATA`; every test is split into
  `// SETUP`, `// ACTION`, `// CHECK`. (Older suites also have `← src/...` arrows on imports and values;
  new checkout code leaves them out to stay short.)
  "INFO only" = an annotation in the report, not a pass/fail check.
- **Query / payload / data files:** a `// USED BY` block after the imports lists the importing files
  (regenerate by hand when you add a user); each exported function has a one-line `/** */`:
  what it returns, "or undefined" (maybeOne) vs "Throws if none" (one).
- **Endpoint methods:** `/** <HTTP METHOD> <full URL pattern> — params ... */`.
- **Page-object methods:** what the user action is on screen, where parameters come from.
- **Classes:** what creates them (usually a fixture) and what the constructor receives.

## Conventions

- Tests import `test`/`expect` from `@fixtures`, never `@playwright/test` (lint enforces).
- No fixed waits: wait for a locator, URL, or `expect.poll(() => dbQuery())`.
- SQL values as parameters (`$1`), never string-built.
- **Never pick existing data starting with `qa_auto`** as test input (owner, 2026-09-29): add `NOT LIKE 'qa_auto%'`.
  "Add item" in Create order takes its product from `findProductForOrderItem` (active, has an active variant, not qa_auto),
  typed into "Select product" — the list options have no name, they are matched by the title text.
- Missing test data → `test.skip(!row, 'reason')`, never a silent pass.
- A suite may not import another suite's API client / page objects (lint enforces).
- Chains that passed ids between tests became one test with `test.step`.
- `tests/**/mode: 'default'` keeps tests in a file in order without skipping on failure.

## Verified so far (2026-09-23)

- tsc + eslint clean; 231 tests listed.
- Read-only API tests: 74/76 pass. Failures are environment, not migration:
  customer-api `/invoices/detailed` returns 503 after ~31s (Heroku timeout) — test deleted on owner request 2026-09-29;
  customer-api draft-order delete → 404 because the first draft is already converted to an order.
- Read-only hub UI tests: 22/22 pass (after fixing company search selector and
  waiting for a stable pagination total).
- **Not yet run:** anything that changes data (order create/cancel/fulfil, refunds, crons,
  subscription actions, all checkout payments).

- 2026-09-25: checkout locators rewritten for the new checkout UI; `stripe.spec.ts` 4/4 pass
  (card, SEPA, invoice, voucher).
- 2026-09-27: adyen.spec 4/4 and braintree.spec 3/3 pass (incl. "payment methods are shown and
  selectable"); mollie.spec 6/6 pass (card, SEPA, invoice × Saleor + WooCommerce) after choosing the method before Continue (the earlier "Pay disabled" skip was our flow, not the shop).
  Stripe read-only checks (country, invalid voucher, shipping method, language) 4/4 pass.
- 2026-09-27: customer-api +12 tests from the Postman collection (health, exports, transactions by order,
  debtist claim list = read-only, 10/10 pass). Data-changing, approved + pass: css change-quantity, additional_infos,
  partial refund (0.01 of invoice_items.id) + full refund ({full_refund:true}), bought_out, debtist PDF upload/download.
  Refund facts: refund invoice (type refund) appears ~7 s later via Stripe webhook; invoice_items.refunded_amount is NOT filled on dev.
  Subscription PUT actions: only action=bought_out|repair (Postman next_action:return is ignored by the API).
  Debtist upload route is /debtist/invoice/{invoiceId}/uploads (Postman /claims/... is outdated).
  API facts: POST /export only starts a job (GET /exports/{key} stays 404 without the queue worker);
  GET /payments/refund-payments is 404 on version 2025-08; no notes with a transaction_id exist for the test company.

- 2026-09-28: hub-e2e re-checked against Cypress test by test: all 63 tests and every DB query condition match.
  Hub login is saved in .auth/hub.json and reused for 24 h; before reuse it opens the orders page — if the
  login page shows instead, it logs in again (hub-setup has retries: 1). Simplified: plain one-value queries
  for expect.poll (getSubscriptionStatus, isPaymentSettled, countInvoicedPayments ...), each poll has a
  `message` naming the record. order-workflow fulfil/charge are now real DB checks (Cypress only logged them).
  Read-only hub run: 25/26 pass. Known: "opens the payment method update page" fails when run ALONE — the
  menu item is disabled until "charges the initial payment" (earlier in the same file) has run.
  Invoice "PDF" button needs exact name (a "Regenerate pdf" button also exists).
  Hub UI changes (2026-09-28): subscription list shortens ids ("702812...602954") → open by link href; 3-dot menu
  items are disabled until the page has loaded → runAction retries; attribute / extension-price dialogs use
  labelled inputs (getByRole spinbutton/textbox). DB effects: attributes → subscription_price + subscription_duration
  (= hub length − order_items.subscription_duration_prepaid), old RPs deleted + new ones created;
  extension price → subscription_extension_price; extend N → subscription_duration +N, +N open RPs, subscription_end +N months.

- 2026-09-28 full run (all 4 suites at once, 17.5 min): 219 pass, 34 fail. Fixed since: hub cron trigger routes
  (no more `/circulydb/`: POST /{ver}/{company}/recurring-payments and /invoices/charge-queue); rp worker enabled by
  queue name (enableQueueWorkers — the worker commands changed); cron waits 10 min (rp worker takes 5 jobs/round);
  order/subscription opened by exact link (not first row); order + subscription 3-dot menus wait until enabled;
  dialogs by label (buyout, serial, pending return consent, "Change all future payments" switch + "Item Amount");
  menu item by exact name ("Reactivate subscription" ≠ "Auto reactivate subscription"); invoice search clears filters;
  unified refund answer is now {message}. **Crons: owner rule — never leave cms_crons off; resetAllCrons turns ALL on.**
  Do NOT run all suites at once for data-changing tests: customer-api and unified-api pick the same "latest" rows
  (customer-api fulfil found its order "cancelled" by the unified cancel test).
  Still open (data/environment): hub "Mark as fulfilled" disabled for the cms order awaiting payment; customer-api
  bundle subscription needs serial_number (422 — FIXED 2026-09-29: random serial in bundleSubscriptionPayload); unified referral code already exists for the customer (400);
  unified charge "Order with status open cannot be charged!"; customer-api CSV answers text/html (API bug — tests check Content-Disposition instead and show it as an "INFO: API bug" note, owner 2026-09-29);
  bundle-swap 500 "No query results for model BundleCollection"; partial refund 400 (item refundable 0.00);
  stripe card checkout timed out (120 s) during the parallel run.

- 2026-09-28 hub: +27 new tests (order actions 11, customers 7, invoice actions 5, debt collection 5, subscription
  auto-reactivate + buyout invoice within 1 min). Hub facts:
  - Records are opened by URL, not by list click: after a list click the hub kept the PREVIOUS subscription loaded
    and an action went to the wrong subscription.
  - Order tabs "Products"/"Subscriptions" are sub-tabs of General. "Charge initial payment" fulfils a cms order by
    itself; "Mark as fulfilled" is only offered on open + paid orders.
  - Extend N cycles adds N × interval months to subscription_duration.
  - "Edit order" opens /orders/{id}/edit and creates a 'clone' order. "Create invoice" needs a row in transactions.
  - Country, tag and customer locale are dropdowns (locale options: Deutsch | English).
  - Invoice cancel needs the preview iframe loaded first, else "The html field is required".
  - HUB_API_HEALTH_URL is now https://core.api.development.circuly.io/v1/version (old Cloud Run URL = 503).
  - Known hub bug: "+ B2B Partner" → 405 (POST customers/companies not supported); dialog closes silently. Test removed on owner request.

- 2026-09-29 hub Products: tests/hub-e2e/products/{products,attributes}.spec.ts, 25 tests, all pass (ProductPage.ts).
  Owner rules: never touch Taxes / Exchange groups / Bundles tabs; products are never deleted from the frontend
  (each run adds one "qa_auto_hub_product_…"); negative stock is allowed; the sync test is LAST in both files and
  first runs DELETE FROM cache_locks + "cache" (else the sync does not start).
  Facts: product and variant pages are read-only — editing is only the list's bulk edit (tick row → Edit → cell → Submit changes);
  price inputs drop a comma ("15,00" → 1500) → type plain numbers. Icons right of "Edit attributes": refresh, product sync,
  column visibility. Modal backdrops keep moving → clicks inside Filter / Map-to-collection / Assign-to-all need force.
  Filter "Active": the default operator "contains" finds nothing → choose "Is". Active picker options can both be ticked.
  After a search, "Map to product collection" says "0 items selected" and maps nothing (hub bug) → test ticks the row without searching.
  "Assign to all" only queues AssignAttributeToAllJob (queue default; worker every 30 min) → test checks the job, not the values.
  Attribute option value is slugified (qa_value_1 → qa-value-1) and saved at once by "Add option".
- Hub Returns / Repairs lists (2026-09-29): the search box is cleared while the list loads its rows and saved filters
  (Repairs has 2: Created date, Blocked) → ReturnsAndRepairsPage.search() types again until the text stays; repair() opens
  the row that has the serial link (not the first row). The Returns list shows active + pending return + pending replacement
  subscriptions (QueryService::buildFilterableReturns). Owner: the test may use the CSS test subscription (keep query as is).
- Hub refunds (invoice-list.spec): findRefundableRecurringInvoice skips transaction_id qa_auto% (owner), non-Stripe payments
  (a "TR_…" refund writes no refund transaction → picked again) and amount 0 (paid by account balance → Refund disabled).
  No DB check after "Successfully requested!" (owner: the refund invoice can come late) → full = nth 0, partial = nth 1, cancel = nth 2.
- Customer "Process open orders" is enabled only if the customer has an unprocessed order → test takes a checkout order
  not in subscriptions (owner) and opens ITS customer. The dialog shows one order at a time ("1 / N"); ‹ › stay disabled
  until that order is processed → the test checks the shown order belongs to the customer (DB), then Close.

- 2026-09-29 POS (tests/pos-e2e, PosPage.ts, queries hub/pos.ts), 17/17 pass. Login = retailers row (location_id = POS_LOCATION_ID,
  name shown in header). Owner: login = only "logs in" (no wrong-password / empty-field cases). A POS order is a quote:
  draft_orders.draft_id 'quote_…', items in draft_items (sku, name), customer in order_customers; Order list count = draft_orders
  of the retailer with deleted_at null; Cancel → status cancelled + deleted_at. Voucher 12 is NOT saved on the quote (discount 0) — it
  only applies in the checkout; owner: any voucher, check that it is there (Review; checkout "Remove promotion code"), never its discount. The checkout link opens
  with the item and the customer's data filled. "Start subscription" (any not-started row, owner) → subscriptions row with the typed
  serial_number (owner: check the DB row only, no tab counts); the not-started tab = order_items without a subscriptions row.
  Create order keeps an unfinished order in the browser → openCreateOrder presses Reset. Country = listbox button, not a select.
  Product for Add item: findPosProduct (active, orderable, in stock, sku + name, not qa_auto, 2+ variants so the Variant step shows).
  Filters (owner: test every page's filter): Order list Status (?status=open|completed, count = draft_orders), started Status
  (?status=active, count = subscriptions), search on all 3 lists, Add item checkbox filters (option → products via product_attribute_values
  on variants = findProductsOfFilterOption). Cancelled quote id must not show in the list. Customer step without data → Review is NOT a bug (owner).

## Token efficiency in this repo

- Run the narrowest thing: `npx playwright test <file>:<line> --project=<p> --reporter=line`,
  output piped through `tail -40`. `npm run typecheck && npm run lint` before any test run.
- On a failure, grep `reports/<suite>/<run>/test-results/<test>/error-context.md` for the relevant part; open the
  screenshot only when the text is not enough.
- `node_modules/`, `playwright-report/` and `.auth/` are blocked from reading (`.claude/settings.json`).
- Never start a Playwright run while another one runs in this folder: runs wipe each other's
  the same run folder, and the checkout tests share one cart per shop.
- Checkout DOM questions: answer them once with a temporary read-only spec (fill the form, never
  Continue/Pay), delete it after, and write the answer into "Checkout facts" below.

## Checkout facts (live page, verified 2026-09-25)

- Each field's `data-test-id` sits on the wrapper `<div>` AND the `<input>` → use
  `getByRole('textbox').and(getByTestId(id))`. The checkout project sets `testIdAttribute: 'data-test-id'`.
- Steps do not change the URL. Step 2 = billing form hidden + `btn-pay` visible; on step 2 the
  `next-step` button becomes the payment "Select".
- Shipping methods (`shipping-method-<db id>`) load async after the contact form is complete; a
  Continue click before that is ignored (handled in `CheckoutPage.continue()`).
- Date pickers: day buttons are labelled "Sunday, September 27, 2026"; pick the first enabled one.
- Voucher `12` = −5 € (40 → 35 €). It is stored on the server-side cart → a test that applies it
  must remove it (`cleanup`). Summary ids: `cart-sum`, `shipping-cost`, `implemented-voucher-value`.
- Stripe Payment Element: tabs `getByRole('tab', { name })`; card inputs `name=number|expiry|cvc`;
  SEPA `getByRole('textbox', { name: 'IBAN' })`.
- Owner-requested fixed pauses: 5 s after payment Select and Pay, 30 s before the DB order check.
- Adyen (Shopify): buttons `selection-btn-{scheme|sepadirectdebit|paypal|ideal|twint}`; choosing one hides
  the others, "Change payment" (`change-payment-method`, 2 in DOM → use the visible one) brings them back;
  Select = `select-payment-method`. Braintree (Shopware 6): Drop-in buttons "Paying with Card|PayPal|Google Pay".
  Mollie: method buttons `mollie-payment-method-{creditcard|ideal|bancontact|kbc|sepa}` are on the CONTACT-FORM
  step and must be clicked BEFORE Continue (else Pay stays disabled); Pay redirects to Mollie's hosted page. Invoice = `select-invoice`
  (Stripe shop: `select-offline-invoice`).
- `fillBillingDetails()` works for every shop: each field is filled only if shown and editable.
- Stripe shop countries: DE 19% · AT 20% · BE 21% · NO 25% · ES 0% (no shipping methods). Prices include tax →
  total unchanged, only the tax part moves. Tax is calculated a moment AFTER the shipping methods appear → poll it.
- Shipping methods: chosen one has class `border-primary` (no aria state). Stripe cart: 3 methods (free default, 10 €, 200 €).
- Invalid voucher → "Could not redeem voucher." inside `div[data-test-id=voucher-code-input]`.
- Language: `locale-button` → `locale-item` "Deutsch"/"English"; URL /de/ ↔ /en/; Continue = "Weiter"/"Continue".

## Compact instructions

When compacting, keep: the current task and next step, files changed, the owner's decisions and
confirmations, test results (pass/fail + cause), open questions. Drop: raw tool output, DOM dumps,
file contents that are already saved on disk.

## Known open points

- Test data: `addresses.germany.phone` is `4917656824720`, but the phone field pre-fills `+49`, so
  the result is `+494917656824720`. Owner has not decided on the fix yet.

- Checkout database connection (`CHECKOUT_DB_*`) not yet provided; `src/db/queries/checkout/` is empty.
- Customer API has two candidate base URLs (Heroku one used; a Cloud Run one is mentioned in cus-api notes).
- Old repos are public and contain credentials (checkout-e2e DB creds + Cypress record key,
  hub admin password, CronPage.js hub API password, cypress.health-check.config.js DB creds).
  Owner was advised to make them private and rotate.
- Subscription/invoice list filters use generated headlessui ids (`#headlessui-listbox-button-v-0-2-3`)
  copied from Cypress — fragile if the hub UI changes.
- unified-customer-api has support code for access-keys and csv but never had specs — not migrated.

- 2026-09-29 CSS (tests/css-e2e/01-css-login.spec.ts, 1 test, pass): Stripe checkout by card → hub order → "Create subscription" for the
  first normal row ("[EN] Tip/Gratuity | white") and the consumable row ("Simple product no variant | Black / Medium") → customer → "Login CSS"
  (retried once from the customer page). css-e2e project = checkout baseURL + data-test-id + hub storageState (hub-setup + checkout-setup).
  The order's "Product list" loads after the order info → wait for a "Create subscription" button before reading rows.
  The test then charges the first 2 open RPs of the NORMAL subscription only (owner: a consumable RP's "Charge recurring payment" is always
  disabled) and saves .auth/css-data.json (order, customer, subscription ids, product names, normal invoice ids). The CSS session can NOT be
  reused from a storageState file (it opens the login page) → every CSS test logs in by "Login CSS" on the hub customer page.
  CSS pages: dashboard (cards, Upcoming deliveries / Your Orders tabs, Your invoices), /css/deliveries/<date>, /css/profile,
  /css/refer-a-friend, /css/orders/create. Card dropdown + button opens /css/subscriptions/<id>?action=frequency_change|quantity_change|
  cancel_subscription|report_issue (or /buyout). Consumable: frequency, quantity, cancel, report issue. Normal: cancel (+ Pickup Date),
  buy product (buyout), report issue (+ Appointment date). Cancellation type: Normal | Extraordinary. Time unit: weekly | monthly.
  CssPage.loginFromHub(customerId) = hub customer page → Login CSS (retry once); other CSS tests read .auth/css-data.json (readCssData, src/data/css.ts)
  → run 01-css-login.spec.ts first. Refer a friend: "Create referral code" → checkout.checkout_voucher_codes (referrer_email), removed by cleanup.
  Outstanding amount (owner flow): invoices.paid=false + transactions.status='failed' by invoice_number → dashboard box "Outstanding amount"
  → list page (invoice radio pre-selected) → "Pay outstanding amount (10,00 €)" → Payment page (Stripe iframe, Card tab) → "Pay …" → invoices.paid=true.
  CSS shows invoice_number (invoice-_24110); /css/invoices/<invoices.id>. Delivery "Change shipping date" = calendar dialog + "Shift all future deliveries".
  File order (css-e2e fullyParallel: false): 01-css-login writes css-data.json → 02..05 → 99-cancel-and-report runs LAST (owner).
  Read css-data.json INSIDE tests/beforeEach, never at describe level (files load before 01 runs → old customer).
  Add new product (owner): product active + allow_order_create + type 'consumable' + stock > 0 (findCssProduct, one variant → step 03);
  Finalize → dialog "Confirm order" → "Subscribe now" → +1 order of the customer. CSS product Search → 500 page (bug) → click in the list.
  Update payment method: link → /css/update-payment-method → button → /en/pay/<token> (Stripe form, "Save payment method"; not saved).
  Cancel form: type → "Cancellation reason *" (first option, owner) → message → Pickup Date (normal only; calendar: free days lack class
  "!pointer-events-none", then a time slot, Select) → Cancel now → status not 'active' (owner; consumable became 'pending return').
  Report: message → Appointment date (normal only) → Send → "Thank You" (owner: UI only). The subscription form resets itself when
  /actions + /delivery-dates load (openSubscriptionAction waits for them), and text typed AFTER picking a date is lost → message first.
  Without a reason the API answers 400 but the CSS shows no error. 99 resets both subscriptions first (resetCssCancellation: status active +
  cancellation_date/type/reason NULL + cancelled_by_customer false — status alone is not enough, owner). Dashboard "active (+2)" filter → 500 page (bug?).
- 2026-09-29 Update payment method (owner): ALWAYS card 4242 4242 4242 4242 (payments.stripeCard). Check = newest customer_payment_methods
  row (ORDER BY id DESC) for customer_id AND order_id is a NEW id, enabled = true, last_4_digit 4242 (findNewestPaymentMethod).
  One update adds rows for SEVERAL orders of the customer → never check "newest row of the customer" alone.
  CSS: profile link (all orders) / delivery link (?order_id=) → /css/update-payment-method → button → /en/pay/<token> → Stripe → "Save payment method"
  (CssPage.saveCard). The delivery's order can be an "Add new product" order → read order_id from the link's href.
  Hub: order menu "update payment method" → "Click here" → checkout.…/<shop>/update-payment-method?order_id=&customer_id=&hash= →
  Stripe → "Update payment method" (OrderWorkflowPage.updatePaymentMethodByCard). Own file tests/hub-e2e/orders/order-payment-method.spec.ts
  (owner) on the latest checkout order paid by Stripe card, not qa_auto (findLatestCheckoutCardOrder); css-e2e 06 does it on the CSS test order.
  order-workflow.spec.ts keeps the old "opens the page" test.
- CSS dashboard loads in steps: first "Your Subscriptions (0)" — a click then is lost → loginFromHub waits for a count >= 1.
  Dashboard has 3 tables (Your Orders tab, Upcoming deliveries tab, Your invoices) → never use a bare 'tbody tr' (openFirstDelivery picks the
  table with column "Shipping date"). The "Upcoming deliveries" tab only shows while an active consumable subscription exists → after 99
  it is gone; 05 skips then (run the full suite: 05 comes before 99).
