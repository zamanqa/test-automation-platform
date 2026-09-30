/**
 * "Ask Claude" in the test runner — Claude Code (the `claude` CLI, logged in with the owner's Claude account)
 * looks at a failed test and proposes a fix; the fix is applied only after a click.
 *
 * STEPS (one job at a time)
 *   1. suggest(test): `claude -p` may only READ files (Read, Grep, Glob). It gets the test, its file:line and the newest
 *      report folder (error-context.md = the page at the failure). It answers: cause, fix (small diff), how sure.
 *   2. apply():       continues the same Claude session (--resume) and may now EDIT files (no commands, no tests,
 *      no database). Before that, src/, tests/ and playwright.config.ts are copied to reports/.claude-backup/
 *      → the changed files are listed afterwards, and "Undo" copies the old versions back.
 *   3. The server then queues a rerun of that one test (see server.js).
 *
 * Claude reads CLAUDE.md itself (it runs in the project folder), so the project rules apply (simple code for a QA,
 * never qa_auto data, crons stay on, ...). The output is streamed to the page as it comes (stream-json).
 * Used by runner/server.js.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BACKUP = path.join(ROOT, 'reports', '.claude-backup');
/** What Apply may change (and what the backup covers). */
const EDITABLE = ['src', 'tests', 'playwright.config.ts'];

let job = null; // the current / last Claude job: { test, mode, running, sessionId, lines, changed }
let child = null;
let send = () => {};

/** server.js passes its send(event) → the page gets { type: 'claude', ... } events. */
function init(sendEvent) {
  send = sendEvent;
}

function claudeState() {
  return job ? { ...job, lines: undefined } : null;
}

/** Everything shown so far (a page that opens later sees it too). */
function claudeLines() {
  return job ? job.lines : [];
}

function isBusy() {
  return Boolean(job && job.running);
}

function out(kind, text) {
  job.lines.push({ kind, text });
  send({ type: 'claude', kind, text, state: claudeState() });
}

/** Newest report folder of a suite (reports/<suite>/<start time>), relative to the project, or ''. */
function newestRunFolder(suite) {
  const dir = path.join(ROOT, 'reports', suite);
  if (!fs.existsSync(dir)) return '';
  const runs = fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(n)).sort();
  return runs.length ? `reports/${suite}/${runs[runs.length - 1]}` : '';
}

function suggestPrompt(test) {
  // the run where it failed (History tab), else the newest run of the suite (Run tab: the run just made)
  const runFolder = test.run ? `reports/${test.suite}/${test.run}` : newestRunFolder(test.suite);
  return `A Playwright test failed in the test runner. Find the cause and propose a fix. Do NOT change any file.

Test:  ${test.title}
File:  ${test.file}:${test.line}   (suite / Playwright project: ${test.suite})
Newest report folder: ${runFolder || '(none)'}
  The failure details are in ${runFolder}/test-results/<folder of this test>/error-context.md
  (error message, the test source around the failing line, and the page at the failure as an accessibility tree).
  Find that folder with Grep for the test title in ${runFolder}/test-results.

Rules: follow CLAUDE.md (simple, readable code for a mid-level QA; never pick test data starting with qa_auto;
never touch the Taxes / Exchange groups / Bundles tabs; crons stay on). You may only read files: do not run tests,
commands or database queries.

Answer in short, plain English, with these headings:
Cause: 1-3 sentences. Say clearly when it is a hub bug or a test-data problem rather than a problem in the test code.
Fix: the exact change per file as a small diff (only what is needed).
How sure: high / medium / low, and what would make you surer.`;
}

const APPLY_PROMPT = `Apply exactly the fix you proposed. Change only the files that need it (under src/, tests/ or
playwright.config.ts). Do not run anything. When done, list the changed files in one short line each.`;

/** Starts `claude -p` with the prompt on stdin and streams its answer. tools = the allowed tools. */
function runClaude(prompt, { tools, resume, editMode, onDone }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', '40',
    '--allowedTools', tools.join(','), '--disallowedTools', 'Bash,NotebookEdit,WebFetch,WebSearch,Task'];
  if (editMode) args.push('--permission-mode', 'acceptEdits');
  if (resume) args.push('--resume', resume);
  // shell: true → Windows finds claude.cmd (npm's launcher); no user text is in args (the prompt goes via stdin)
  child = spawn('claude', args, { cwd: ROOT, shell: true, env: { ...process.env, FORCE_COLOR: '0' } });
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) handleLine(line);
  });
  child.stderr.on('data', (chunk) => out('error', chunk.toString().trim()));
  child.on('error', (e) => out('error', `Could not start Claude: ${e.message}`));
  child.on('close', (code) => {
    if (buffer.trim()) handleLine(buffer);
    child = null;
    job.running = false;
    if (code !== 0 && !job.stopped) out('error', `Claude stopped with exit code ${code}.`);
    onDone(code === 0 && !job.stopped);
  });
  child.stdin.end(prompt);
}

/** One stream-json line → text / tool / done events for the page. */
function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return; // not JSON (should not happen) → ignore
  }
  if (message.session_id) job.sessionId = message.session_id;
  if (message.type === 'assistant') {
    for (const part of message.message?.content || []) {
      if (part.type === 'text' && part.text.trim()) out('text', part.text.trim());
      if (part.type === 'tool_use') {
        const input = part.input || {};
        const what = input.file_path || input.pattern || input.path || '';
        out('tool', `${part.name} ${String(what).replace(ROOT + path.sep, '').replace(/\\/g, '/')}`);
      }
    }
  }
  if (message.type === 'result') {
    const seconds = Math.round((message.duration_ms || 0) / 1000);
    out('info', `Claude finished in ${seconds}s${message.is_error ? ' with an error' : ''}.`);
  }
}

/** Step 1: read-only analysis of one failed test. test = { suite, run?, file, line, title, choice }. */
function suggest(test) {
  if (isBusy()) throw new Error('Claude is already working. Wait, or press Stop.');
  job = { test, mode: 'suggest', running: true, sessionId: null, lines: [], changed: [], startedAt: Date.now() };
  out('info', `Asking Claude about: ${test.title} (${test.file}:${test.line})`);
  runClaude(suggestPrompt(test), {
    tools: ['Read', 'Grep', 'Glob'],
    onDone: (ok) => {
      job.canApply = ok && Boolean(job.sessionId);
      out('info', job.canApply ? 'Check the proposal. "Apply fix" lets Claude make exactly this change.' : 'No fix to apply.');
    },
  });
}

/** Copies src/, tests/ and playwright.config.ts to reports/.claude-backup (the last backup only). */
function backup() {
  fs.rmSync(BACKUP, { recursive: true, force: true });
  for (const name of EDITABLE) {
    const from = path.join(ROOT, name);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(BACKUP, name), { recursive: true });
  }
}

/** Files under EDITABLE whose content differs from the backup (or are new / deleted). Paths relative to ROOT. */
function changedFiles() {
  const files = new Set();
  const walk = (base, rel) => {
    const full = path.join(base, rel);
    if (!fs.existsSync(full)) return;
    if (fs.statSync(full).isDirectory()) {
      for (const n of fs.readdirSync(full)) walk(base, path.join(rel, n));
    } else files.add(rel);
  };
  for (const name of EDITABLE) {
    walk(ROOT, name);
    walk(BACKUP, name);
  }
  return [...files].filter((rel) => {
    const now = path.join(ROOT, rel);
    const old = path.join(BACKUP, rel);
    if (!fs.existsSync(now) || !fs.existsSync(old)) return true;
    return !fs.readFileSync(now).equals(fs.readFileSync(old));
  }).map((rel) => rel.replace(/\\/g, '/'));
}

/** Step 2: Claude applies its proposal (same session). onApplied(test) → the server queues a rerun. */
function apply(onApplied) {
  if (isBusy()) throw new Error('Claude is already working.');
  if (!job || !job.canApply) throw new Error('Ask Claude first — there is no proposal to apply.');
  backup();
  job.mode = 'apply';
  job.stopped = false;
  job.running = true;
  job.canApply = false;
  out('info', 'Applying the fix (backup of src/, tests/ and playwright.config.ts made first)…');
  runClaude(APPLY_PROMPT, {
    tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'],
    resume: job.sessionId,
    editMode: true,
    onDone: (ok) => {
      job.changed = changedFiles();
      job.canUndo = job.changed.length > 0;
      out('info', job.changed.length ? `Changed: ${job.changed.join(', ')}` : 'No file was changed.');
      if (ok && job.changed.length) onApplied(job.test);
    },
  });
}

/** Undo: copies the backed-up versions of the changed files back (new files are deleted). */
function undo() {
  if (isBusy()) throw new Error('Claude is working — press Stop first.');
  if (!job || !job.canUndo) throw new Error('Nothing to undo.');
  for (const rel of job.changed) {
    const now = path.join(ROOT, rel);
    const old = path.join(BACKUP, rel);
    if (fs.existsSync(old)) fs.copyFileSync(old, now);
    else fs.rmSync(now, { force: true });
  }
  job.canUndo = false;
  out('info', `Undone: ${job.changed.join(', ')}`);
}

function stop() {
  if (!child) return;
  job.stopped = true;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else child.kill();
  out('info', 'Stopped.');
}

module.exports = { init, suggest, apply, undo, stop, claudeState, claudeLines, isBusy };
