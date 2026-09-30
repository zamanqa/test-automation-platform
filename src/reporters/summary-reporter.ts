import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult, TestStep } from '@playwright/test/reporter';

/**
 * Our own test report. Playwright calls it automatically (see "reporter" in playwright.config.ts).
 * After every run it:
 *   1. prints a short table in the terminal: PASS / FAIL / FLAKY / SKIP per test, and WHY
 *   2. writes <run folder>/index.html — the run folder is reports/<suite>/<start time>
 *      (set in playwright.config.ts), e.g. reports/hub-e2e/2026-09-28_20-15-03:
 *        - counters and a filter (All / Failed / Flaky / Skipped / Passed) + search box
 *        - one table per suite
 *        - at the very end: the ERROR LOG — for every failed test the full error, the code line,
 *          the steps it ran (the failing step in red), what the API answered, the screenshot,
 *          and links to the video / trace / error context
 *   3. deletes run folders (and zips) older than 3 days (KEEP_DAYS)
 *   4. rewrites the overview reports/index.html: every suite with its last runs (npm run summary)
 * One run folder holds:
 *   index.html     this page
 *   html-report/   Playwright's own report (npm run report) — its trace viewer = step-by-step debugging
 *   test-results/  screenshots, videos, traces, error-context.md of failed tests
 *   summary.json   the counters, read by the overview page
 * and next to it <start time>.zip — the whole run folder in one file, to download or send (Windows).
 */

const REPORTS = 'reports';
/** Reports and history entries older than this are deleted (owner, 2026-09-29). */
const KEEP_DAYS = 3;
/** This run's folder, set in playwright.config.ts (e.g. reports/hub-e2e/2026-09-28_20-15-03). */
const RUN_DIR = process.env.REPORT_RUN_DIR ?? `${REPORTS}/all/unknown-run`;

type Status = 'failed' | 'flaky' | 'skipped' | 'passed';

type Row = {
  status: Status;
  suite: string; // e.g. hub-e2e
  file: string; // e.g. hub-e2e/orders/order-list.spec.ts:40
  title: string; // e.g. Hub - order list › exports selected orders
  seconds: number;
  note: string; // short: first error line or the skip reason
  failedRun?: TestResult; // for the error log
};

export default class SummaryReporter implements Reporter {
  private allTests!: Suite;

  // Playwright calls this at the start and gives us all tests of the run
  onBegin(_config: FullConfig, suite: Suite) {
    this.allTests = suite;
    // Lines for the browser test runner (runner/server.js reads them to show progress). Only when started from there.
    if (process.env.TEST_RUNNER_UI) console.log(`@@TOTAL ${suite.allTests().length}`);
  }

  // Playwright calls these when a test starts / ends
  onTestBegin(test: TestCase) {
    if (process.env.TEST_RUNNER_UI) console.log(`@@RUNNING ${test.parent.project()?.name ?? ''} › ${test.titlePath().slice(3).join(' › ')}`);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    // @@DONE <status> <file:line> <project> › <title>   (file:line lets the runner re-run exactly this test)
    const fileLine = `${test.location.file.replace(/\\/g, '/').split('/tests/')[1]}:${test.location.line}`;
    if (process.env.TEST_RUNNER_UI) console.log(`@@DONE ${result.status} ${fileLine} ${test.parent.project()?.name ?? ''} › ${test.titlePath().slice(3).join(' › ')}`);
  }

  // Playwright calls this at the end of the run
  onEnd(result: FullResult) {
    const rows: Row[] = [];
    for (const test of this.allTests.allTests()) {
      if (test.results.length === 0) continue; // test did not run
      rows.push(this.makeRow(test));
    }
    if (rows.length === 0) return; // nothing ran (e.g. --list)

    this.printTable(rows);

    // this run's page + counters
    fs.mkdirSync(RUN_DIR, { recursive: true });
    fs.writeFileSync(path.join(RUN_DIR, 'index.html'), this.makeHtml(rows, result));
    const count = (status: string) => rows.filter((row) => row.status === status).length;
    const summary = {
      status: result.status,
      date: new Date().toISOString(),
      seconds: Math.round(result.duration / 1000),
      tests: rows.length,
      passed: count('passed'),
      failed: count('failed'),
      flaky: count('flaky'),
      skipped: count('skipped'),
      // every test's result — used by the runner's History and Compare views
      results: rows.map((row) => ({ file: row.file, title: row.title, status: row.status })),
    };
    fs.writeFileSync(path.join(RUN_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
    addToHistory(summary);

    // delete this suite's runs older than 3 days, then refresh the overview page
    deleteOldRuns(path.dirname(RUN_DIR));
    writeOverview();
    this.ran = true;
  }

  private ran = false;

  // Playwright calls this after ALL reporters finished (so the html report and videos are complete):
  // pack the run folder into <run folder>.zip — one file to download or send.
  async onExit() {
    if (!this.ran) return;
    // keep the list of failed tests for the next "--last-failed" run of this suite (see playwright.config.ts)
    const lastRun = path.join(RUN_DIR, 'test-results', '.last-run.json');
    if (fs.existsSync(lastRun)) fs.copyFileSync(lastRun, path.join(path.dirname(RUN_DIR), '.last-run.json'));
    const zipped = zipRunFolder();
    writeOverview();
    console.log(`This run: ${RUN_DIR}/index.html${zipped ? `   Download: ${RUN_DIR}.zip` : ''}   All runs: ${REPORTS}/index.html (npm run summary)\n`);
  }

  /** One line of the report for one test. */
  private makeRow(test: TestCase): Row {
    const lastRun = test.results[test.results.length - 1];
    let status: Status = 'passed';
    if (test.outcome() === 'flaky') status = 'flaky'; // failed first, passed on retry
    if (test.outcome() === 'unexpected') status = 'failed';
    if (lastRun.status === 'skipped') status = 'skipped';

    let note = '';
    let failedRun: TestResult | undefined;
    if (status === 'skipped') {
      const skipNote = test.annotations.find((annotation) => annotation.type === 'skip');
      note = skipNote?.description ?? 'skipped';
    }
    if (status === 'failed' || status === 'flaky') {
      failedRun = test.results.find((run) => run.status !== 'passed') ?? lastRun;
      note = firstLine(clean(failedRun.error?.message ?? failedRun.status));
    }

    let seconds = 0;
    for (const run of test.results) seconds += run.duration / 1000;

    return {
      status,
      suite: test.parent.project()?.name ?? '',
      file: `${test.location.file.replace(/\\/g, '/').split('/tests/')[1]}:${test.location.line}`,
      title: test.titlePath().slice(3).join(' › '),
      seconds,
      note,
      failedRun,
    };
  }

  /** Prints the table in the terminal. */
  private printTable(rows: Row[]) {
    const label = { failed: '✗ FAIL ', flaky: '! FLAKY', skipped: '- SKIP ', passed: '✓ PASS ' };
    const order: Status[] = ['failed', 'flaky', 'skipped', 'passed'];
    const sorted = [...rows].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    console.log('\n──────── Test summary ────────');
    for (const row of sorted) {
      console.log(`${label[row.status]}  [${row.suite}] ${row.file}  ${row.title}  (${row.seconds.toFixed(1)}s)`);
      if (row.note) console.log(`           ${row.note}`);
    }
    const count = (status: string) => rows.filter((row) => row.status === status).length;
    console.log(`──────── ${count('passed')} passed · ${count('failed')} failed · ${count('flaky')} flaky · ${count('skipped')} skipped ────────`);
  }

  // ---------------------------------------------------------------- the run's web page

  private makeHtml(rows: Row[], result: FullResult): string {
    const count = (status: string) => rows.filter((row) => row.status === status).length;
    const ran = rows.length - count('skipped');
    const passRate = ran === 0 ? 0 : Math.round(((count('passed') + count('flaky')) / ran) * 100);
    const failed = rows.filter((row) => row.failedRun);

    // one table per suite, in the order they appear
    const suites: string[] = [];
    for (const row of rows) if (!suites.includes(row.suite)) suites.push(row.suite);
    let suiteSections = '';
    for (const suite of suites) {
      const suiteRows = rows.filter((row) => row.suite === suite);
      const suiteFailed = suiteRows.filter((row) => row.status === 'failed').length;
      let tableRows = '';
      for (const row of suiteRows) {
        const errorLink = row.failedRun ? ` <a class="jump" href="#err-${failed.indexOf(row) + 1}">error ↓</a>` : '';
        tableRows += `
        <tr class="row ${row.status}" data-status="${row.status}">
          <td><span class="badge ${row.status}">${row.status}</span></td>
          <td><div class="title">${esc(row.title)}</div><div class="file">${esc(row.file)}</div></td>
          <td class="time">${row.seconds.toFixed(1)}s</td>
          <td class="note">${esc(row.note)}${errorLink}</td>
        </tr>`;
      }
      suiteSections += `
      <section class="suite">
        <h2>${esc(suite)} <span class="suite-count">${suiteRows.length} tests${suiteFailed ? ` · <b class="red">${suiteFailed} failed</b>` : ''}</span></h2>
        <table>
          <thead><tr><th>Result</th><th>Test</th><th>Time</th><th>Why failed / skipped</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </section>`;
    }

    // the error log: one block per failed / flaky test
    let errorLog = '';
    failed.forEach((row, index) => {
      errorLog += this.errorBlock(row, index + 1);
    });
    if (!errorLog) errorLog = '<p class="ok">No errors in this run.</p>';

    const suiteName = path.basename(path.dirname(RUN_DIR));
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(suiteName)} test report</title>
<style>
  :root { --red:#cf222e; --green:#1a7f37; --yellow:#9a6700; --grey:#6e7781; --line:#e3e6eb; --bg:#f6f7f9; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; margin: 0; background: var(--bg); color: #1c2330; }
  header { background: #1c2330; color: white; padding: 20px 32px; }
  header h1 { margin: 0 0 4px; font-size: 22px; }
  header .meta { color: #b7c0cc; font-size: 13px; }
  header a { color: #9ecbff; }
  main { padding: 20px 32px 60px; max-width: 1400px; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  .card { background: white; border-radius: 10px; padding: 12px 18px; min-width: 120px; border-left: 6px solid var(--grey); box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  .card .n { font-size: 26px; font-weight: 700; } .card .l { font-size: 12px; color: var(--grey); text-transform: uppercase; }
  .card.failed { border-color: var(--red); } .card.passed { border-color: var(--green); } .card.flaky { border-color: var(--yellow); }
  .bar { height: 10px; background: #e9ecef; border-radius: 5px; overflow: hidden; margin: 8px 0 18px; max-width: 520px; }
  .bar div { height: 100%; background: var(--green); }
  .tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
  .tools button { border: 1px solid var(--line); background: white; border-radius: 16px; padding: 5px 14px; cursor: pointer; font-size: 13px; }
  .tools button.on { background: #1c2330; color: white; }
  .tools input { border: 1px solid var(--line); border-radius: 16px; padding: 6px 12px; min-width: 260px; }
  .suite { margin-top: 22px; }
  .suite h2 { font-size: 17px; margin: 0 0 6px; } .suite-count { font-size: 13px; color: var(--grey); font-weight: normal; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  th { background: #eef1f4; font-size: 12px; text-transform: uppercase; color: #4b5563; }
  th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--line); font-size: 13px; }
  tr.failed td { background: #fff5f5; }
  .title { font-weight: 600; } .file, .time { color: var(--grey); font-size: 12px; } .time { white-space: nowrap; }
  .note { color: var(--red); font-family: Consolas, monospace; font-size: 12px; } tr.skipped .note { color: var(--grey); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; color: white; font-size: 11px; text-transform: uppercase; }
  .badge.passed { background: var(--green); } .badge.failed { background: var(--red); } .badge.flaky { background: var(--yellow); } .badge.skipped { background: var(--grey); }
  .red { color: var(--red); } a.jump { margin-left: 6px; font-family: "Segoe UI", sans-serif; }
  h2.log { margin-top: 40px; border-top: 3px solid var(--red); padding-top: 14px; }
  .err { background: white; border-radius: 10px; padding: 16px 18px; margin: 16px 0; border-left: 6px solid var(--red); box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  .err h3 { margin: 0 0 4px; font-size: 16px; } .err .file { margin-bottom: 10px; }
  .err h4 { margin: 14px 0 6px; font-size: 13px; text-transform: uppercase; color: #4b5563; }
  pre { background: #1c2330; color: #f0f3f6; padding: 12px; border-radius: 6px; white-space: pre-wrap; font-size: 12px; margin: 0; overflow-x: auto; }
  pre.api { background: #fff8e6; color: #5c4400; }
  ol.steps { margin: 0; padding-left: 28px; font-size: 12px; font-family: Consolas, monospace; }
  ol.steps li { padding: 1px 0; } ol.steps li.bad { color: var(--red); font-weight: 700; } ol.steps .d { color: var(--grey); }
  .shots img { max-width: 100%; border: 1px solid var(--line); border-radius: 6px; margin-top: 4px; }
  .links a { margin-right: 14px; } code { background: #eef1f4; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  .ok { color: var(--green); font-weight: 600; }
</style>
</head>
<body>
<header>
  <h1>${esc(suiteName)} — ${esc(result.status.toUpperCase())}</h1>
  <div class="meta">${new Date().toLocaleString()} · ${rows.length} tests · ${formatDuration(result.duration)} ·
    <a href="html-report/index.html">Playwright report (screenshots, video)</a> · traces: <code>npm run report</code> ·
    <a href="../${esc(path.basename(RUN_DIR))}.zip">⬇ download this run (.zip)</a> ·
    <a href="../../index.html">all runs</a></div>
</header>
<main>
  <div class="cards">
    <div class="card failed"><div class="n">${count('failed')}</div><div class="l">failed</div></div>
    <div class="card flaky"><div class="n">${count('flaky')}</div><div class="l">flaky</div></div>
    <div class="card"><div class="n">${count('skipped')}</div><div class="l">skipped</div></div>
    <div class="card passed"><div class="n">${count('passed')}</div><div class="l">passed</div></div>
    <div class="card"><div class="n">${passRate}%</div><div class="l">pass rate (of tests that ran)</div></div>
  </div>
  <div class="bar"><div style="width:${passRate}%"></div></div>
  <div class="tools">
    <button class="on" data-filter="all">All</button>
    <button data-filter="failed">Failed</button>
    <button data-filter="flaky">Flaky</button>
    <button data-filter="skipped">Skipped</button>
    <button data-filter="passed">Passed</button>
    <input id="search" placeholder="Search test name or file…">
    ${failed.length ? '<a href="#error-log">Jump to the error log ↓</a>' : ''}
  </div>
  ${suiteSections}
  <h2 class="log" id="error-log">Error log (${failed.length})</h2>
  ${errorLog}
</main>
<script>
  // filter buttons + search box: hide the table rows that do not match
  let filter = 'all';
  const search = document.getElementById('search');
  function apply() {
    const text = search.value.toLowerCase();
    document.querySelectorAll('tr.row').forEach((row) => {
      const statusOk = filter === 'all' || row.dataset.status === filter;
      const textOk = row.textContent.toLowerCase().includes(text);
      row.style.display = statusOk && textOk ? '' : 'none';
    });
  }
  document.querySelectorAll('.tools button').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tools button').forEach((b) => b.classList.remove('on'));
      button.classList.add('on');
      filter = button.dataset.filter;
      apply();
    });
  });
  search.addEventListener('input', apply);
</script>
</body>
</html>`;
  }

  /** One block of the error log: error, code line, steps, API answer, screenshot, links. */
  private errorBlock(row: Row, number: number): string {
    const run = row.failedRun!;
    const error = run.error;
    let html = `
    <div class="err" id="err-${number}">
      <h3>${number}. <span class="badge ${row.status}">${row.status}</span> [${esc(row.suite)}] ${esc(row.title)}</h3>
      <div class="file">${esc(row.file)} · ${(run.duration / 1000).toFixed(1)}s</div>
      <h4>Error</h4>
      <pre>${esc(clean(error?.message ?? run.status))}</pre>`;

    // the line of test code where it failed (Playwright gives a small snippet)
    if (error?.snippet) html += `<h4>Where in the code</h4><pre>${esc(clean(error.snippet))}</pre>`;

    // what the API answered (BaseApiClient.send saves it for status 400 and up)
    for (const file of run.attachments) {
      if (file.name === 'API answer' && file.body) html += `<h4>API answer</h4><pre class="api">${esc(file.body.toString())}</pre>`;
    }

    // the steps the test ran, the failing one in red (the trace shows each step with a page snapshot)
    const steps: string[] = [];
    collectSteps(run.steps, 0, steps);
    if (steps.length) {
      const shown = steps.slice(-40); // the last 40 steps lead to the error
      const heading = steps.length > 40 ? `Steps (last 40 of ${steps.length})` : 'Steps';
      html += `<h4>${heading}</h4><ol class="steps" start="${steps.length - shown.length + 1}">${shown.join('')}</ol>`;
    }

    // screenshot(s) at the moment of failure
    const images = run.attachments.filter((file) => file.contentType.startsWith('image/') && file.path);
    if (images.length) {
      html += '<h4>Screenshot at the failure</h4><div class="shots">';
      // the picture is put INTO the page (base64), so index.html alone still shows it after a download
      for (const image of images) {
        const picture = fs.existsSync(image.path!) ? `data:${image.contentType};base64,${fs.readFileSync(image.path!).toString('base64')}` : relative(image.path!);
        html += `<a href="${relative(image.path!)}"><img src="${picture}" alt="screenshot"></a>`;
      }
      html += '</div>';
    }

    // links to the video, the trace and the error context
    const links: string[] = [];
    for (const file of run.attachments) {
      if (!file.path) continue;
      if (file.name === 'video') links.push(`<a href="${relative(file.path)}">▶ video</a>`);
      if (file.name === 'error-context') links.push(`<a href="${relative(file.path)}">error context (page at the failure)</a>`);
      if (file.name === 'trace') {
        const tracePath = path.relative(process.cwd(), file.path).replace(/\\/g, '/');
        links.push(`trace = step-by-step debugging with a picture per action: <code>npx playwright show-trace ${esc(tracePath)}</code>`);
      }
    }
    if (links.length) html += `<h4>Debug</h4><div class="links">${links.join(' ')}</div>`;

    return html + '\n    </div>';
  }
}

// ---------------------------------------------------------------- helpers

/** Flattens a test's steps into list items: user steps, page actions, checks and hooks (not fixtures). */
function collectSteps(steps: TestStep[], depth: number, out: string[]) {
  for (const step of steps) {
    if (step.category === 'fixture' || step.category === 'attach') continue;
    const show = ['test.step', 'pw:api', 'expect', 'hook'].includes(step.category);
    if (show) {
      const indent = '&nbsp;&nbsp;'.repeat(depth);
      const mark = step.error ? '✗ ' : '';
      out.push(`<li class="${step.error ? 'bad' : ''}">${indent}${mark}${esc(step.title)} <span class="d">${step.duration}ms</span></li>`);
    }
    collectSteps(step.steps, show ? depth + 1 : depth, out);
  }
}

/** Text safe to put into HTML. */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Removes terminal colour codes. */
function clean(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/** First non-empty line, without "Error: " in front. */
function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  return line.replace(/^Error:\s*/, '').slice(0, 200);
}

/** Path of an attachment relative to the run's index.html (so images and links work when the page is opened). */
function relative(file: string): string {
  return path.relative(RUN_DIR, file).replace(/\\/g, '/');
}

/** 125000 ms → "2m 5s". */
function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

/** Run folders are named by start time (2026-09-28_20-15-03), so sorting the names sorts by time. Newest first. */
function runFoldersOf(suiteDir: string): string[] {
  if (!fs.existsSync(suiteDir)) return [];
  return fs
    .readdirSync(suiteDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(name))
    .sort()
    .reverse();
}

/**
 * reports/history.json: one short entry per run (counts + each test's status), newest last.
 * Entries older than KEEP_DAYS are dropped → the runner's trends and "unstable tests".
 */
function addToHistory(summary: { results: { file: string; title: string; status: string }[] } & Record<string, unknown>) {
  const file = path.join(REPORTS, 'history.json');
  let history: Record<string, unknown>[] = [];
  if (fs.existsSync(file)) {
    try {
      history = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      history = []; // broken file → start again
    }
  }
  const suite = path.basename(path.dirname(RUN_DIR));
  // per test only "file:line → status" (short), titles stay in the run's summary.json
  const statusOf: Record<string, string> = {};
  const titleOf: Record<string, string> = {};
  for (const test of summary.results) {
    statusOf[test.file] = test.status;
    titleOf[test.file] = test.title;
  }
  history.push({
    suite,
    run: path.basename(RUN_DIR),
    date: summary.date,
    seconds: summary.seconds,
    tests: summary.tests,
    passed: summary.passed,
    failed: summary.failed,
    flaky: summary.flaky,
    skipped: summary.skipped,
    statusOf,
    titleOf,
  });
  history = history.filter((entry) => !isOlderThanKeepDays(String(entry.run)));
  fs.writeFileSync(file, JSON.stringify(history));
}

/** True when a run name (2026-09-28_20-15-03 = its start time) is older than KEEP_DAYS. */
function isOlderThanKeepDays(run: string): boolean {
  const start = new Date(run.replace(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/, '$1T$2:$3:$4'));
  return Number.isFinite(start.getTime()) && Date.now() - start.getTime() > KEEP_DAYS * 24 * 60 * 60 * 1000;
}

/** Deletes the run folders (and their .zip) of one suite that are older than KEEP_DAYS. */
function deleteOldRuns(suiteDir: string) {
  for (const old of runFoldersOf(suiteDir).filter(isOlderThanKeepDays)) {
    fs.rmSync(path.join(suiteDir, old), { recursive: true, force: true });
    fs.rmSync(path.join(suiteDir, `${old}.zip`), { force: true });
  }
}

/**
 * Packs this run's folder into <run folder>.zip (next to it). Windows: its own tar.exe writes zip files.
 * Elsewhere (Linux CI) it is skipped — there the CI artifact download is already a zip.
 * Returns true when the zip was made.
 */
function zipRunFolder(): boolean {
  if (process.platform !== 'win32') return false;
  const suiteDir = path.dirname(RUN_DIR);
  const run = path.basename(RUN_DIR);
  const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  const done = spawnSync(tar, ['-a', '-c', '-f', `${run}.zip`, run], { cwd: suiteDir });
  if (done.status !== 0) {
    console.log(`Could not make ${RUN_DIR}.zip: ${String(done.stderr ?? '').trim()}`);
    return false;
  }
  return true;
}

/** reports/index.html: one table per suite with its last runs (read from each run's summary.json). */
function writeOverview() {
  let sections = '';
  for (const suite of fs.readdirSync(REPORTS).sort()) {
    const suiteDir = path.join(REPORTS, suite);
    if (!fs.statSync(suiteDir).isDirectory()) continue;
    let runRows = '';
    for (const run of runFoldersOf(suiteDir)) {
      const summaryFile = path.join(suiteDir, run, 'summary.json');
      if (!fs.existsSync(summaryFile)) continue;
      const s = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
      let colour = 'passed';
      if (s.flaky > 0) colour = 'flaky';
      if (s.failed > 0) colour = 'failed';
      const when = `${run.slice(0, 10)} ${run.slice(11).replace(/-/g, ':')}`;
      runRows += `
        <tr><td><span class="badge ${colour}">${esc(String(s.status))}</span></td>
          <td><a href="${suite}/${run}/index.html">${when}</a></td>
          <td>${s.passed} passed</td><td class="${s.failed ? 'red' : ''}">${s.failed} failed</td>
          <td>${s.flaky} flaky</td><td>${s.skipped} skipped</td><td>${formatDuration(s.seconds * 1000)}</td>
          <td><a href="${suite}/${run}/html-report/index.html">Playwright report</a></td>
          <td>${fs.existsSync(path.join(suiteDir, `${run}.zip`)) ? `<a href="${suite}/${run}.zip">⬇ download .zip</a>` : ''}</td></tr>`;
    }
    if (runRows) sections += `<section><h2>${esc(suite)}</h2><table>${runRows}</table></section>`;
  }
  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Test runs</title><style>
  body { font-family: "Segoe UI", Arial, sans-serif; margin: 0; background: #f6f7f9; color: #1c2330; }
  header { background: #1c2330; color: white; padding: 20px 32px; } header h1 { margin: 0; font-size: 22px; }
  header p { margin: 4px 0 0; color: #b7c0cc; font-size: 13px; }
  main { padding: 10px 32px 40px; max-width: 1100px; } h2 { font-size: 17px; margin: 24px 0 6px; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  td { padding: 8px 10px; border-bottom: 1px solid #e3e6eb; font-size: 13px; } .red { color: #cf222e; font-weight: 600; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; color: white; font-size: 11px; text-transform: uppercase; }
  .passed { background: #1a7f37; } .failed { background: #cf222e; } .flaky { background: #9a6700; }
</style></head><body>
<header><h1>Test runs</h1><p>The runs of the last ${KEEP_DAYS} days of each suite, newest first. Click a run for its summary and error log.</p></header>
<main>${sections || '<p>No runs yet.</p>'}</main></body></html>`;
  fs.writeFileSync(path.join(REPORTS, 'index.html'), page);
}
