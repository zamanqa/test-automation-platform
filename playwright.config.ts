import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';
import { HUB_AUTH_STATE } from './src/config/paths';

// Browser size of every UI suite (hub, checkout, POS, CSS):
//   run with --headed or --debug (you watch the browser) → the window opens maximized and fits the screen
//   run without --headed (no window)          → fixed size 1920 x 1080
// (PW_HEADED passes "--headed" on to the test workers, which do not see the command line.)
if (process.argv.includes('--headed') || process.argv.includes('--debug')) process.env.PW_HEADED = '1';
const browserWindow =
  process.env.PW_HEADED === '1'
    ? { viewport: null, deviceScaleFactor: undefined, launchOptions: { args: ['--start-maximized'] } }
    : { viewport: { width: 1920, height: 1080 } };

// Report folder of THIS run: reports/<suite>/<start time>/  (e.g. reports/hub-e2e/2026-09-28_20-15-03)
//   <suite> = the --project given on the command line (hub-e2e, customer-api ...), or "all".
//   Inside: index.html (summary + error log), html-report/ (Playwright report), test-results/ (raw files).
//   The summary reporter keeps the newest 5 runs per suite and updates reports/index.html (overview).
// REPORT_RUN_DIR carries the folder to the test workers, which load this file again later
// and would otherwise compute a different time.
if (!process.env.REPORT_RUN_DIR) {
  const projectsOnCommandLine = process.argv.filter((arg) => arg.startsWith('--project=')).map((arg) => arg.split('=')[1]);
  const suite = projectsOnCommandLine.length === 1 ? projectsOnCommandLine[0] : projectsOnCommandLine.length ? projectsOnCommandLine.join('+') : 'all';
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  process.env.REPORT_RUN_DIR = `reports/${suite}/${time}`;

  // --last-failed reads test-results/.last-run.json of the run folder. Each run has a new folder,
  // so the summary reporter keeps a copy per suite (reports/<suite>/.last-run.json) → put it in place.
  const lastRun = `reports/${suite}/.last-run.json`;
  if (process.argv.includes('--last-failed') && fs.existsSync(lastRun)) {
    fs.mkdirSync(`${process.env.REPORT_RUN_DIR}/test-results`, { recursive: true });
    fs.copyFileSync(lastRun, `${process.env.REPORT_RUN_DIR}/test-results/.last-run.json`);
  }
}
const RUN_DIR = process.env.REPORT_RUN_DIR;

/**
 * One repo, six suites. Each suite is a Playwright "project":
 *   npx playwright test --project=unified-api
 *
 * UI suites run in the installed Google Chrome (channel: 'chrome'), headless by
 * default; add --headed or use `npm run test:ui` while writing tests.
 * API suites start no browser at all.
 *
 * Every suite runs one test at a time (workers: 1): tests pick
 * "the latest open order / active subscription" from the shared dev database, so two
 * tests running at once could act on the same row. Raise a suite's workers once its
 * tests create their own data. Exceptions: checkout-e2e (one cart per shop) and customer-api
 * run their spec files side by side, tests inside a file still one at a time.
 *
 * Base URLs are read from process.env directly (not src/config/env.ts) so that
 * running one suite never requires the other suites' variables to be set.
 */
export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },

  // All output of a run goes under RUN_DIR (see the top of this file):
  //   screenshots / videos / traces → RUN_DIR/test-results, Playwright report → RUN_DIR/html-report,
  //   our summary → RUN_DIR/index.html (npm run summary opens the overview reports/index.html).
  // On GitHub (CI) also 'github', which marks failures in the pull request.
  outputDir: `${RUN_DIR}/test-results`,
  reporter: process.env.CI
    ? [['html', { open: 'never', outputFolder: `${RUN_DIR}/html-report` }], ['list'], ['github'], ['./src/reporters/summary-reporter.ts']]
    : [['html', { open: 'never', outputFolder: `${RUN_DIR}/html-report` }], ['list'], ['./src/reporters/summary-reporter.ts']],

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },

  projects: [
    // ---------- Hub ----------
    // Login flow: 'hub-setup' runs tests/hub-e2e/auth.setup.ts first (dependencies below),
    // which logs in via LoginPage and saves the browser session to HUB_AUTH_STATE.
    // Every 'hub-e2e' test then starts from that file (storageState) - already logged in.
    {
      name: 'hub-setup',
      testMatch: /hub-e2e[\\/]auth\.setup\.ts/,
      retries: 1, // a failed login (slow hub, network) is tried once more straight away
      use: { ...devices['Desktop Chrome'], channel: 'chrome', ...browserWindow, baseURL: process.env.HUB_URL },
    },
    {
      name: 'hub-e2e',
      workers: 1,
      testDir: 'tests/hub-e2e',
      testIgnore: /auth\.setup\.ts/,
      dependencies: ['hub-setup'],
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        ...browserWindow, // fits the screen when --headed (see top of this file)
        baseURL: process.env.HUB_URL,
        storageState: HUB_AUTH_STATE,
      },
    },

    // ---------- Checkout ----------
    { name: 'checkout-setup', testMatch: /checkout-e2e[\\/]checkout\.setup\.ts/ },
    {
      name: 'checkout-e2e',
      dependencies: ['checkout-setup'],
      testIgnore: /checkout\.setup\.ts/,
      // Spec files run side by side (each uses its own shop cart); tests inside one file run
      // one after another, because they share that file's cart (the Stripe voucher changes it).
      workers: 4,
      fullyParallel: false,
      // 2 minutes per test: an order test has 40 s of fixed waits (5 s Select + 5 s Pay + 30 s before the DB check)
      timeout: 120_000,
      testDir: 'tests/checkout-e2e',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        ...browserWindow, // fits the screen when --headed (see top of this file)
        baseURL: process.env.CHECKOUT_URL,
        // The checkout marks its elements with data-test-id (the hub uses the default data-testid),
        // so page.getByTestId('billing_city') → [data-test-id="billing_city"].
        testIdAttribute: 'data-test-id',
      },
    },

    // ---------- POS + CSS (UI) ----------
    // The full login URLs (with ?company_id=) are in .env: POS_URL / CSS_URL - tests open them with page.goto(env.pos.POS_URL).
    {
      name: 'pos-e2e',
      workers: 1,
      testDir: 'tests/pos-e2e',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', ...browserWindow },
    },
    // CSS: a test first places an order in the checkout (Stripe shop), then opens it in the hub (logged in
    // by hub-setup) and clicks "Login CSS". So: checkout baseURL + data-test-id, hub session, 5 min per test.
    {
      name: 'css-e2e',
      workers: 1,
      testDir: 'tests/css-e2e',
      // files run in name order (01 → 99): 01 creates the customer, 99 cancels its subscriptions at the very end
      fullyParallel: false,
      dependencies: ['hub-setup', 'checkout-setup'],
      timeout: 300_000,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        ...browserWindow, // fits the screen when --headed (see top of this file)
        baseURL: process.env.CHECKOUT_URL,
        testIdAttribute: 'data-test-id',
        storageState: HUB_AUTH_STATE,
      },
    },

    // ---------- APIs (no browser) ----------
    // customer-api: spec files run side by side (4 at a time); tests inside one file run one
    // after another (a file's tests share data, e.g. partial refund before full refund).
    { name: 'customer-api', testDir: 'tests/customer-api', workers: 4, fullyParallel: false },
    { name: 'unified-api', testDir: 'tests/unified-api', workers: 1 },
  ],
});
