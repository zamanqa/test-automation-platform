/**
 * Test runner in the browser — start with:  npm run runner   → opens http://localhost:4455
 *
 * WHAT IT DOES
 *   Run tab:      choose a suite, run all tests / one file / one test / only the last failed, headed or headless;
 *                 or add runs to a QUEUE (they run one after another). Watch the running test, the live log and
 *                 the failed tests (each with "Rerun"). The page shows a desktop notification when a run ends.
 *                 Environment check at the top (hub, APIs, database, crons).
 *   Reports tab:  every run of every suite (Hub_e2e_<time> ...): open, PDF, .zip, delete, compare two runs.
 *   History tab:  pass rate per run (chart) and unstable tests (failed in some of the last runs).
 *   Settings tab: the .env values and which ones are missing.
 *   Test sync:    tests/ is watched; a new, changed or deleted spec file → the test list of every suite is read again
 *                 → the page shows the real counts (+ what was added / deleted). "⟳ Sync tests" does it by hand.
 *   Claude tab:   "🤖 Ask Claude" on a failed test → Claude Code proposes a fix (read-only); "Apply fix" lets it edit,
 *                 then that test is rerun; "Undo" puts the old files back. See runner/claude.js.
 *
 * HOW
 *   A small web server (Node's built-in http, no extra packages) that starts
 *   `node node_modules/@playwright/test/cli.js test --project=... [file[:line]] [--headed]` as a child process
 *   and streams its output to the page (Server-Sent Events). The summary reporter prints @@TOTAL / @@RUNNING /
 *   @@DONE lines when TEST_RUNNER_UI is set; this server turns them into progress on the page.
 *   Reports are the run folders the summary reporter writes: reports/<suite>/<start time>/ (+ .zip),
 *   and reports/history.json (one entry per run, entries older than 3 days are dropped).
 *
 * SAFETY
 *   - Listens on 127.0.0.1 only (this PC).
 *   - Only one run at a time (the dev database is shared); more runs wait in the queue.
 *   - Only suites, files and tests from Playwright's own test list can be run (no free text reaches the command).
 *   - After "Stop" the tests' undo steps do not run → the server switches ALL hub crons back on (owner's rule).
 *   - The Settings tab shows the .env values in full — fine because the page is reachable only from this PC.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PORT = Number(process.env.RUNNER_PORT || 4455);
const ROOT = path.resolve(__dirname, '..');
const REPORTS = path.join(ROOT, 'reports');
const PLAYWRIGHT_CLI = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const claude = require('./claude');
require('dotenv').config({ path: path.join(ROOT, '.env') });

// The suites (Playwright projects) that can be run. browser: false = API suite, headed/headless makes no difference.
const SUITES = [
  { id: 'hub-e2e', label: 'Hub_e2e', name: 'Hub (UI)', browser: true },
  { id: 'checkout-e2e', label: 'Checkout_e2e', name: 'Checkout (UI)', browser: true },
  { id: 'pos-e2e', label: 'Pos_e2e', name: 'POS (UI)', browser: true },
  { id: 'css-e2e', label: 'Css_e2e', name: 'CSS (UI)', browser: true },
  { id: 'customer-api', label: 'Customer_api', name: 'Customer API', browser: false },
  { id: 'unified-api', label: 'Unified_api', name: 'Unified API', browser: false },
];
const LABELS = { all: 'All' };
for (const suite of SUITES) LABELS[suite.id] = suite.label;

// ---------------------------------------------------------------- the current run + the queue

let run = null; // the current / last run (see startRun)
const queue = []; // runs waiting: [{ id, choice, description, at (added, ms) }]
let nextQueueId = 1;
const logLines = []; // last lines of the current / last run (a page that opens later still sees them)
const listeners = new Set(); // open event streams (one per browser tab)

function send(event) {
  if (event.type === 'log') {
    logLines.push(event.text);
    if (logLines.length > 5000) logLines.shift();
  }
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of listeners) res.write(data);
}

claude.init((event) => send(event)); // Claude's answer goes to the page like the test log

function state() {
  const waiting = queue.map((item) => ({ id: item.id, description: item.description, at: item.at }));
  if (!run) return { running: false, queue: waiting };
  const { child, ...rest } = run;
  return { running: !run.finished, ...rest, queue: waiting };
}

const isRunning = () => Boolean(run && !run.finished);

/**
 * Checks a choice { project, scope: all|file|test|failed, file, line, headed } against the test list
 * and turns it into Playwright arguments. Throws for anything unknown.
 */
async function buildRun(choice) {
  const suite = SUITES.find((s) => s.id === choice.project);
  if (!suite) throw new Error('Unknown suite');
  const args = [PLAYWRIGHT_CLI, 'test', `--project=${suite.id}`];
  let what = 'all tests';
  if (choice.scope === 'file' || choice.scope === 'test') {
    const files = await listTests(suite.id);
    const file = files.find((f) => f.file === choice.file);
    if (!file) throw new Error(`Unknown test file: ${choice.file}`);
    if (choice.scope === 'file') {
      args.push(`tests/${file.file}`);
      what = file.file;
    } else {
      const test = file.tests.find((t) => String(t.line) === String(choice.line));
      if (!test) throw new Error(`Unknown test: ${choice.file}:${choice.line}`);
      args.push(`tests/${file.file}:${test.line}`);
      what = test.title;
    }
  }
  if (choice.scope === 'failed') {
    args.push('--last-failed');
    what = 'tests that failed last time';
  }
  // Debug (🐞 button): Playwright's --debug opens Chrome + the Playwright Inspector, pauses before the first step and
  // waits for "Step over" / "Resume" (no test timeout). UI suites only: an API test has no page to step through.
  const debug = Boolean(choice.debug && suite.browser);
  const headed = Boolean(choice.headed && suite.browser) || debug;
  if (debug) args.push('--debug');
  else if (headed) args.push('--headed');
  const mode = debug ? 'debug' : headed ? 'headed' : suite.browser ? 'headless' : 'API';
  return { suite, args, what, headed, debug, description: `${suite.name}: ${what} · ${mode}` };
}

/** Starts a run now (the caller made sure nothing is running). */
function startRun(built) {
  logLines.length = 0;
  const child = spawn(process.execPath, built.args, {
    cwd: ROOT,
    env: { ...process.env, TEST_RUNNER_UI: '1', FORCE_COLOR: '0' },
  });
  run = {
    child,
    project: built.suite.id,
    what: built.what,
    headed: built.headed,
    debug: built.debug,
    command: `npx playwright ${built.args.slice(1).join(' ')}`,
    startedAt: Date.now(),
    total: 0,
    done: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    current: '',
    errors: [], // [{ title, file, line }]
    finished: false,
    stopped: false,
  };
  send({ type: 'start', state: state() });
  send({ type: 'log', text: `$ ${run.command}` });

  let buffer = '';
  const onData = (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) handleLine(line);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', (code) => {
    if (buffer) handleLine(buffer);
    run.finished = true;
    run.endedAt = Date.now();
    run.exitCode = code;
    run.current = '';
    if (run.stopped) switchCronsOn();
    send({ type: 'end', state: state() });
    startNextFromQueue();
  });
}

/** When a run ends (and was not stopped): start the next queued run. */
async function startNextFromQueue() {
  if (isRunning() || queue.length === 0) return;
  const item = queue.shift();
  try {
    startRun(await buildRun(item.choice));
  } catch (e) {
    send({ type: 'log', text: `✗ Queued run skipped (${item.description}): ${e.message}` });
    startNextFromQueue();
  }
}

/** One output line: progress markers from the summary reporter, everything else goes to the log. */
function handleLine(line) {
  if (line.startsWith('@@TOTAL ')) {
    run.total = Number(line.slice(8));
    return send({ type: 'progress', state: state() });
  }
  if (line.startsWith('@@RUNNING ')) {
    run.current = line.slice(10);
    return send({ type: 'progress', state: state() });
  }
  if (line.startsWith('@@DONE ')) {
    // @@DONE <status> <file:line> <project> › <title>
    const [, status, fileLine, ...title] = line.split(' ');
    run.done++;
    if (status === 'passed') run.passed++;
    else if (status === 'skipped') run.skipped++;
    else {
      run.failed++;
      const at = fileLine.lastIndexOf(':');
      run.errors.push({ title: title.join(' '), status, file: fileLine.slice(0, at), line: fileLine.slice(at + 1), at: Date.now() });
    }
    return send({ type: 'progress', state: state() });
  }
  send({ type: 'log', text: line });
}

function stopRun() {
  queue.length = 0; // Stop also empties the queue
  if (!run || run.finished) return send({ type: 'progress', state: state() });
  run.stopped = true;
  send({ type: 'log', text: '■ Stopped by user (queue cleared).' });
  // kill Playwright and every browser / worker it started
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(run.child.pid), '/T', '/F']);
  else run.child.kill('SIGTERM');
}

// ---------------------------------------------------------------- database: crons + environment check

function hubDbClient() {
  const { Client } = require('pg');
  return new Client({
    host: process.env.HUB_DB_HOST,
    port: Number(process.env.HUB_DB_PORT),
    database: process.env.HUB_DB_NAME,
    user: process.env.HUB_DB_USER,
    password: process.env.HUB_DB_PASSWORD,
    connectionTimeoutMillis: 8000,
  });
}

/** After a Stop the tests' cleanup did not run → turn ALL hub crons back on (owner's rule: never leave them off). */
async function switchCronsOn() {
  const client = hubDbClient();
  try {
    await client.connect();
    await client.query('UPDATE public.cms_crons SET active = true, running = false');
    send({ type: 'log', text: '✓ All hub crons switched back on after Stop.' });
  } catch (e) {
    send({ type: 'log', text: `✗ Could not switch the crons back on: ${e.message}` });
  } finally {
    client.end().catch(() => {});
  }
}

/** One web address → { ok, detail } (any answer below 500 counts as "reachable"). */
async function checkUrl(url) {
  if (!url) return { ok: false, detail: 'not set in .env' };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'manual' });
    return { ok: response.status < 500, detail: `HTTP ${response.status}` };
  } catch (e) {
    return { ok: false, detail: e.cause?.code || e.message };
  }
}

/** Environment check shown at the top of the Run tab. */
async function environmentCheck() {
  const customerPing = process.env.CUSTOMER_API_BASE_URL ? `${process.env.CUSTOMER_API_BASE_URL.replace(/\/$/, '')}/ping` : '';
  const checks = await Promise.all([
    checkUrl(process.env.HUB_URL).then((r) => ({ name: 'Hub (web)', ...r })),
    checkUrl(process.env.HUB_API_HEALTH_URL).then((r) => ({ name: 'Hub API', ...r })),
    checkUrl(process.env.CHECKOUT_URL).then((r) => ({ name: 'Checkout (web)', ...r })),
    checkUrl(process.env.CHECKOUT_API_URL).then((r) => ({ name: 'Checkout API', ...r })),
    checkUrl(customerPing).then((r) => ({ name: 'Customer API', ...r })),
    checkUrl(process.env.UNIFIED_API_BASE_URL).then((r) => ({ name: 'Unified API', ...r })),
  ]);
  const client = hubDbClient();
  try {
    await client.connect();
    const crons = (await client.query('SELECT COUNT(*) FILTER (WHERE active) AS on, COUNT(*) AS total FROM public.cms_crons')).rows[0];
    checks.push({ name: 'Hub database', ok: true, detail: 'connected' });
    checks.push({ name: 'Hub crons', ok: Number(crons.on) === Number(crons.total), detail: `${crons.on} of ${crons.total} on` });
  } catch (e) {
    checks.push({ name: 'Hub database', ok: false, detail: e.message });
  } finally {
    client.end().catch(() => {});
  }
  return checks;
}

// ---------------------------------------------------------------- settings (.env, secrets hidden)

/**
 * Every variable of .env.example with its group and value, plus which ones are missing.
 * Values are shown in full (owner's choice, 2026-09-28) — the page is only reachable from this PC (127.0.0.1).
 */
function settings() {
  const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8').split(/\r?\n/);
  const rows = [];
  let group = '';
  for (const line of example) {
    const heading = line.match(/^#\s*-+\s*(.+?)\s*-+\s*$/);
    if (heading) group = heading[1];
    const variable = line.match(/^([A-Z0-9_]+)=/);
    if (!variable) continue;
    const name = variable[1];
    const value = process.env[name];
    rows.push({ group, name, set: Boolean(value), value: value || '' });
  }
  return rows;
}

// ---------------------------------------------------------------- test list (from Playwright itself)

const testListCache = {}; // project → { at, files }

/** All files and tests of a suite: [{ file: 'hub-e2e/orders/order-list.spec.ts', tests: [{ title, line }] }]. */
function listTests(project, refresh = false) {
  const cached = testListCache[project];
  if (cached && !refresh && Date.now() - cached.at < 10 * 60_000) return Promise.resolve(cached.files);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PLAYWRIGHT_CLI, 'test', '--list', '--reporter=json', `--project=${project}`], {
      cwd: ROOT,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.on('close', () => {
      try {
        const report = JSON.parse(out.slice(out.indexOf('{')));
        const files = [];
        for (const fileSuite of report.suites) {
          const tests = [];
          collectSpecs(fileSuite, [], tests);
          if (tests.length) files.push({ file: fileSuite.file ?? fileSuite.title, tests });
        }
        files.sort((a, b) => a.file.localeCompare(b.file));
        testListCache[project] = { at: Date.now(), files };
        resolve(files);
      } catch (e) {
        reject(new Error(`Could not read the test list: ${e.message}`));
      }
    });
  });
}

function collectSpecs(suite, describes, out) {
  for (const spec of suite.specs ?? []) out.push({ title: [...describes, spec.title].join(' › '), line: spec.line });
  for (const child of suite.suites ?? []) collectSpecs(child, [...describes, child.title], out);
}

// ---------------------------------------------------------------- test count sync
// The runner watches tests/: when a spec file is added, changed or deleted, it reads Playwright's test list of
// every suite again (--list) → the page shows the real number of tests and what was added / deleted.
// "⟳ Sync tests" on the page does the same by hand.

let testCounts = null; // { at, suites: { id: { files, tests } }, total, added: [...], removed: [...], changedFiles: [...] }
let syncRunning = null; // the sync going on now (a second request waits for it)

/** Reads the test list of every suite again and sends the new counts to the page. changedFiles = what the watcher saw. */
function syncTests(changedFiles = []) {
  if (syncRunning) return syncRunning.then(() => syncTests(changedFiles));
  syncRunning = (async () => {
    // before: every test as "suite › file › title" (only suites already read once)
    const idsOf = (id, files) => files.flatMap((file) => file.tests.map((t) => `${id} › ${file.file} › ${t.title}`));
    const before = new Set(SUITES.flatMap((suite) => (testListCache[suite.id] ? idsOf(suite.id, testListCache[suite.id].files) : [])));
    const hadBefore = SUITES.every((suite) => testListCache[suite.id]);
    const lists = await Promise.all(SUITES.map((suite) => listTests(suite.id, true).catch(() => [])));
    const suites = {};
    const after = new Set();
    SUITES.forEach((suite, i) => {
      suites[suite.id] = { files: lists[i].length, tests: lists[i].reduce((sum, file) => sum + file.tests.length, 0) };
      for (const id of idsOf(suite.id, lists[i])) after.add(id);
    });
    testCounts = {
      at: Date.now(),
      suites,
      total: Object.values(suites).reduce((sum, c) => sum + c.tests, 0),
      added: hadBefore ? [...after].filter((id) => !before.has(id)) : [],
      removed: hadBefore ? [...before].filter((id) => !after.has(id)) : [],
      changedFiles,
    };
    send({ type: 'tests-changed', counts: testCounts });
    return testCounts;
  })().finally(() => (syncRunning = null));
  return syncRunning;
}

/** Watches tests/ (Windows + macOS: recursive). Waits 2 s after the last change, then syncs once. */
function watchTests() {
  const changed = new Set();
  let timer = null;
  try {
    fs.watch(path.join(ROOT, 'tests'), { recursive: true }, (_event, name) => {
      if (!name || !/\.(ts|js)$/.test(name)) return;
      changed.add(`tests/${String(name).replace(/\\/g, '/')}`);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const files = [...changed];
        changed.clear();
        syncTests(files).catch((e) => send({ type: 'log', text: `✗ Test list sync failed: ${e.message}` }));
      }, 2000);
    });
  } catch (e) {
    console.log(`! Cannot watch tests/ (${e.message}) — use "⟳ Sync tests" on the page.`);
  }
}

// ---------------------------------------------------------------- reports, history, compare

const RUN_NAME = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Reports and history entries older than this are deleted (owner, 2026-09-29). Same rule in src/reporters/summary-reporter.ts. */
const KEEP_DAYS = 3;

/** True when a run name (2026-09-28_20-15-03 = its start time) is older than KEEP_DAYS. */
function isOlderThanKeepDays(run) {
  const start = new Date(String(run).replace(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/, '$1T$2:$3:$4'));
  return Number.isFinite(start.getTime()) && Date.now() - start.getTime() > KEEP_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Deletes run folders (+ .zip) and history.json entries older than KEEP_DAYS — also when no new run happened.
 * Called before the Reports and History lists are read. A running run is never touched (it is newer).
 */
function deleteOldReports() {
  if (!fs.existsSync(REPORTS)) return;
  for (const suite of fs.readdirSync(REPORTS)) {
    const suiteDir = path.join(REPORTS, suite);
    if (!fs.statSync(suiteDir).isDirectory()) continue;
    for (const name of fs.readdirSync(suiteDir)) {
      const run = name.replace(/\.zip$/, '');
      if (RUN_NAME.test(run) && isOlderThanKeepDays(run)) fs.rmSync(path.join(suiteDir, name), { recursive: true, force: true });
    }
  }
  const historyFile = path.join(REPORTS, 'history.json');
  const entries = readJson(historyFile, null);
  if (Array.isArray(entries)) {
    const kept = entries.filter((entry) => !isOlderThanKeepDays(entry.run));
    if (kept.length !== entries.length) fs.writeFileSync(historyFile, JSON.stringify(kept));
  }
}

/** Every run folder of every suite, newest first: [{ suite, run, name, summary, hasHtml }]. */
function listReports() {
  deleteOldReports();
  const runs = [];
  if (!fs.existsSync(REPORTS)) return runs;
  for (const suite of fs.readdirSync(REPORTS)) {
    const suiteDir = path.join(REPORTS, suite);
    if (!fs.statSync(suiteDir).isDirectory()) continue;
    for (const name of fs.readdirSync(suiteDir)) {
      if (!RUN_NAME.test(name)) continue;
      const summary = readJson(path.join(suiteDir, name, 'summary.json'), null);
      if (summary) delete summary.results; // the list stays small; compare reads the results itself
      runs.push({
        suite,
        run: name,
        name: `${LABELS[suite] ?? suite}_${name}`,
        summary,
        hasHtml: fs.existsSync(path.join(suiteDir, name, 'html-report', 'index.html')),
      });
    }
  }
  return runs.sort((a, b) => (a.run < b.run ? 1 : -1));
}

/** Checks suite + run name and returns the run folder (so a request can never reach other folders). */
function runFolder(suite, name) {
  if (!/^[a-z0-9+-]+$/.test(suite || '') || !RUN_NAME.test(name || '')) return null;
  const dir = path.join(REPORTS, suite, name);
  return fs.existsSync(dir) ? dir : null;
}

/** The run's .zip (made now if missing; Windows tar.exe writes zip files). */
function zipOf(dir) {
  const zip = `${dir}.zip`;
  if (!fs.existsSync(zip) && process.platform === 'win32') {
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    spawnSync(tar, ['-a', '-c', '-f', path.basename(zip), path.basename(dir)], { cwd: path.dirname(dir) });
  }
  return fs.existsSync(zip) ? zip : null;
}

/** The run's summary page printed to report.pdf with Google Chrome (headless, through Playwright). Made once. */
async function pdfOf(dir) {
  const pdf = path.join(dir, 'report.pdf');
  if (fs.existsSync(pdf)) return pdf;
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch({ channel: 'chrome' }); // the installed Google Chrome, like the UI tests
  try {
    const page = await browser.newPage();
    await page.goto(`file:///${path.join(dir, 'index.html').replace(/\\/g, '/')}`);
    // on paper: no filter buttons / search box
    await page.addStyleTag({ content: '.tools { display: none !important; } .err { break-inside: avoid-page; }' });
    await page.pdf({ path: pdf, format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  } finally {
    await browser.close();
  }
  return pdf;
}

/** Runs of one suite from reports/history.json, oldest first (for the trend chart and unstable tests). */
function history(suite) {
  deleteOldReports();
  return readJson(path.join(REPORTS, 'history.json'), []).filter((entry) => entry.suite === suite);
}

/**
 * Two runs of the same suite: which tests newly fail, got fixed, still fail, or exist in only one run.
 * a = the older run, b = the newer run.
 */
function compare(suite, a, b) {
  const older = readJson(path.join(runFolder(suite, a) || '', 'summary.json'), null);
  const newer = readJson(path.join(runFolder(suite, b) || '', 'summary.json'), null);
  if (!older?.results || !newer?.results) throw new Error('Both runs need a summary with test results (runs from today on).');
  const before = new Map(older.results.map((t) => [t.file, t]));
  const out = { newlyFailing: [], fixed: [], stillFailing: [], onlyInNewer: [], onlyInOlder: [] };
  for (const test of newer.results) {
    const old = before.get(test.file);
    const bad = test.status === 'failed';
    if (!old) out.onlyInNewer.push(test);
    else if (bad && old.status !== 'failed') out.newlyFailing.push(test);
    else if (!bad && old.status === 'failed' && test.status === 'passed') out.fixed.push(test);
    else if (bad) out.stillFailing.push(test);
    before.delete(test.file);
  }
  out.onlyInOlder = [...before.values()];
  return out;
}

// ---------------------------------------------------------------- web server

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webm': 'video/webm', '.zip': 'application/zip', '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf' };

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const q = (name) => url.searchParams.get(name);
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      res.writeHead(200, { 'Content-Type': TYPES['.html'] });
      return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    }
    if (p === '/api/suites') return json(res, 200, SUITES);
    if (p === '/api/counts') return json(res, 200, testCounts || (await syncTests()));
    if (p === '/api/sync' && req.method === 'POST') return json(res, 200, await syncTests(['(Sync tests button)']));
    if (p === '/api/tests') return json(res, 200, await listTests(q('project'), url.searchParams.has('refresh')));
    if (p === '/api/state') return json(res, 200, { state: state(), log: logLines });
    if (p === '/api/check') return json(res, 200, await environmentCheck());
    if (p === '/api/settings') return json(res, 200, settings());
    if (p === '/api/history') return json(res, 200, history(q('suite')));
    if (p === '/api/compare') return json(res, 200, compare(q('suite'), q('a'), q('b')));
    if (p === '/api/reports' && req.method === 'GET') return json(res, 200, listReports());

    // run now (only when nothing runs)
    if (p === '/api/run' && req.method === 'POST') {
      if (isRunning()) throw new Error('A run is already going. Add this one to the queue, or press Stop.');
      startRun(await buildRun(await readBody(req)));
      return json(res, 200, { ok: true });
    }
    // add to the queue (starts at once when nothing runs)
    if (p === '/api/queue' && req.method === 'POST') {
      const choice = await readBody(req);
      if (choice.debug) throw new Error('Debug runs are started with the 🐞 Debug button, not queued.');
      const built = await buildRun(choice); // check it now, so a wrong choice is refused at once
      queue.push({ id: nextQueueId++, choice, description: built.description, at: Date.now() });
      send({ type: 'progress', state: state() });
      startNextFromQueue();
      return json(res, 200, { ok: true });
    }
    if (p === '/api/queue' && req.method === 'DELETE') {
      const index = queue.findIndex((item) => String(item.id) === q('id'));
      if (index >= 0) queue.splice(index, 1);
      send({ type: 'progress', state: state() });
      return json(res, 200, { ok: true });
    }
    // ---- Claude (runner/claude.js) ----
    if (p === '/api/claude' && req.method === 'GET') return json(res, 200, { state: claude.claudeState(), lines: claude.claudeLines() });
    if (p === '/api/claude/suggest' && req.method === 'POST') {
      const body = await readBody(req);
      // only a test from Playwright's own list (buildRun refuses anything else)
      const built = await buildRun({ project: body.project, scope: 'test', file: body.file, line: body.line });
      // run = the report folder where it failed (History tab); only a real run folder of that suite is passed on
      const run = runFolder(built.suite.id, body.run) ? body.run : null;
      claude.suggest({ suite: built.suite.id, run, file: `tests/${body.file}`, line: String(body.line), title: built.what, choice: { project: body.project, file: body.file, line: body.line } });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/claude/apply' && req.method === 'POST') {
      if (isRunning()) throw new Error('A test run is going — apply the fix after it has finished.');
      const body = await readBody(req);
      const headed = body.headed !== false; // the page sends its "3. Mode" choice; headed when not given
      claude.apply(async (test) => {
        // rerun only that test, now or after the queue. The fix may move the test → read the list again
        // and find it by its title; if it is not found (renamed), rerun the whole file.
        const files = await listTests(test.choice.project, true);
        const file = files.find((f) => f.file === test.choice.file);
        const found = file && file.tests.find((t) => t.title === test.title);
        const choice = found
          ? { project: test.choice.project, scope: 'test', file: test.choice.file, line: found.line, headed }
          : { project: test.choice.project, scope: 'file', file: test.choice.file, headed };
        queue.push({ id: nextQueueId++, choice, description: `Rerun after Claude's fix: ${test.title}`, at: Date.now() });
        send({ type: 'progress', state: state() });
        startNextFromQueue();
      });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/claude/undo' && req.method === 'POST') {
      claude.undo();
      return json(res, 200, { ok: true });
    }
    if (p === '/api/claude/stop' && req.method === 'POST') {
      claude.stop();
      return json(res, 200, { ok: true });
    }

    if (p === '/api/stop' && req.method === 'POST') {
      stopRun();
      return json(res, 200, { ok: true });
    }

    if (p === '/api/reports' && req.method === 'DELETE') {
      const dir = runFolder(q('suite'), q('run'));
      if (!dir) return json(res, 404, { error: 'Report not found' });
      if (isRunning() && run.project === q('suite')) return json(res, 409, { error: 'That suite is running now.' });
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(`${dir}.zip`, { force: true });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/download') {
      const dir = runFolder(q('suite'), q('run'));
      const zip = dir && zipOf(dir);
      if (!zip) return json(res, 404, { error: 'No zip for this report' });
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${LABELS[q('suite')] ?? q('suite')}_${q('run')}.zip"` });
      return fs.createReadStream(zip).pipe(res);
    }
    if (p === '/api/pdf') {
      const dir = runFolder(q('suite'), q('run'));
      if (!dir || !fs.existsSync(path.join(dir, 'index.html'))) return json(res, 404, { error: 'Report not found' });
      const pdf = await pdfOf(dir);
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${LABELS[q('suite')] ?? q('suite')}_${q('run')}.pdf"` });
      return fs.createReadStream(pdf).pipe(res);
    }
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'hello', state: state() })}\n\n`);
      listeners.add(res);
      req.on('close', () => listeners.delete(res));
      return;
    }

    // files of a report: /reports/<suite>/<run>/...
    if (p.startsWith('/reports/')) {
      const file = path.normalize(path.join(ROOT, decodeURIComponent(p)));
      if (!file.startsWith(REPORTS + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      return fs.createReadStream(file).pipe(res);
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (e) {
    json(res, 400, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const address = `http://localhost:${PORT}`;
  console.log(`Test runner: ${address}   (Ctrl+C to stop the server)`);
  watchTests();
  syncTests().catch(() => {}); // first count at start
  if (!fs.existsSync(PLAYWRIGHT_CLI)) console.log(`! Playwright not found at ${PLAYWRIGHT_CLI} — run npm install first.`);
  if (!process.argv.includes('--no-open') && process.platform === 'win32') spawn('cmd', ['/c', 'start', '', address], { detached: true });
});
