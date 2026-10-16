'use strict';
// Coverage agent for the /coverage page: runs `claude -p` that reads the frontend, the two backends and
// this test repo, and lists the test cases that are missing (including the DB effect a test should check).
// The project repos are read only (Read / Grep / Glob and a few read-only git commands). In this test repo it
// may also write tests (tests/**, src/**, CLAUDE.md only), run typecheck + lint, and run a test after the user approves.
// It never commits or pushes. No browser, no curl.
//
// Also: "Pull" for the three project repos (development + main, fast-forward only, never touches local
// changes) and the last scanned commit per repo, so "New changes" shows only what came in since.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const HERE = __dirname;
const RUNS = path.join(HERE, 'runs', 'coverage');
const STATE_FILE = path.join(RUNS, 'state.json');
const PROMPT_FILE = path.join(HERE, 'coverage-agent-prompt.md');
const BRANCH = 'development';

const MAX_SAME_CALL = 3;
const MAX_CALLS_PER_TURN = 80;
const IDLE_MINUTES = 15;

const quote = (a) => '"' + String(a).replace(/"/g, '\\"') + '"';
const slash = (p) => p.replace(/\\/g, '/');

function planOnlyEnv() {
  const env = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']) delete env[k];
  return env;
}

function git(dir, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, ...args], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout).trim(), err: String(stderr || (err && err.message) || '').trim() });
    });
  });
}

module.exports = function coverageAgent({ claudeExe = 'claude', root, killTree, testRunning = () => null, model = 'sonnet' }) {
  const parent = path.resolve(root, '..');
  const PROJECTS = [
    { id: 'frontend', name: 'Frontend', apps: 'Hub, Checkout, POS, CSS', dir: path.join(parent, 'circuly_frontend_mono_v2') },
    { id: 'core-api', name: 'Core API', apps: 'Hub, CSS, POS', dir: path.join(parent, 'circuly_core_api_lumen') },
    { id: 'checkout-api', name: 'Checkout API', apps: 'Checkout', dir: path.join(parent, 'checkout-api') },
  ];
  // Merges tab only (never pulled or read by the agent): the old customers API and this test repo.
  const MERGE_REPOS = [...PROJECTS,
    { id: 'customers-api', name: 'Customers API', dir: path.join(parent, 'customers_api_lumen') },
    { id: 'tests', name: 'Test automation', dir: root },
  ];
  const APPS = ['Hub', 'Checkout', 'POS', 'CSS'];

  const runClaude = (args, cwd) => spawn(claudeExe, args.map(quote), { cwd, shell: true, windowsHide: true, env: planOnlyEnv() });
  fs.mkdirSync(RUNS, { recursive: true });
  for (const d of fs.readdirSync(RUNS)) {
    const f = path.join(RUNS, d, 'run.json');
    try {
      const r = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!['working', 'waiting', 'starting'].includes(r.state)) continue;
      r.state = 'stopped';
      r.ask = null;
      r.events.push({ kind: 'info', text: 'The runner was restarted, which ended this run.', at: Date.now() });
      fs.writeFileSync(f, JSON.stringify(r));
    } catch { /* not a run folder */ }
  }

  const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { scanned: {} }; } };
  const writeState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

  // ---- projects: status and pull ----

  async function projectStatus(p) {
    if (!fs.existsSync(path.join(p.dir, '.git'))) return { id: p.id, name: p.name, apps: p.apps, dir: p.dir, missing: true };
    const [branch, changes, head, scannedLog] = await Promise.all([
      git(p.dir, ['branch', '--show-current']),
      git(p.dir, ['status', '--porcelain', '--untracked-files=no']),
      git(p.dir, ['log', '-1', '--format=%h|%s|%cr', `origin/${BRANCH}`]),
      Promise.resolve(readState().scanned[p.id] || null),
    ]);
    const [sha, subject, when] = head.out.split('|');
    let newCommits = null;
    if (scannedLog) {
      const c = await git(p.dir, ['rev-list', '--count', `${scannedLog.sha}..origin/${BRANCH}`]);
      newCommits = c.ok ? Number(c.out) : null;
    }
    return { id: p.id, name: p.name, apps: p.apps, dir: p.dir, branch: branch.out, localChanges: changes.out ? changes.out.split('\n').length : 0,
      head: sha ? { sha, subject, when } : null, scanned: scannedLog, newCommits, lastPull: (readState().pulled || {})[p.id] || null };
  }
  const projects = () => Promise.all(PROJECTS.map(projectStatus));

  // Pull = the repo becomes an exact copy of GitHub: development checked out and reset to
  // origin/development, untracked files removed (git-ignored ones like .env, node_modules, vendor stay),
  // main moved to origin/main. These are the developers' repos: the owner never commits in them.
  let pulling = false;
  async function pull() {
    if (pulling) throw new Error('A pull is already going.');
    pulling = true;
    try {
      const results = [];
      for (const p of PROJECTS) {
        const lines = [];
        if (!fs.existsSync(path.join(p.dir, '.git'))) { results.push({ id: p.id, name: p.name, ok: false, lines: [`not found: ${p.dir}`] }); continue; }
        const before = (await git(p.dir, ['rev-parse', '--short', `origin/${BRANCH}`])).out;
        const f = await git(p.dir, ['fetch', 'origin', BRANCH, 'main']);
        if (!f.ok) { results.push({ id: p.id, name: p.name, ok: false, lines: [`fetch failed: ${f.err.split('\n').pop()}`] }); continue; }
        const current = (await git(p.dir, ['branch', '--show-current'])).out;
        const changed = (await git(p.dir, ['status', '--porcelain'])).out;
        const exists = (await git(p.dir, ['rev-parse', '--verify', '--quiet', BRANCH])).ok;
        const steps = [
          exists ? ['switch', '-f', BRANCH] : ['switch', '-f', '-c', BRANCH, '--track', `origin/${BRANCH}`],
          ['reset', '--hard', `origin/${BRANCH}`],
          ['clean', '-fd'],
          ['branch', '-f', 'main', 'origin/main'],
        ];
        let ok = true;
        for (const s of steps) {
          const r = await git(p.dir, s);
          if (!r.ok) { ok = false; lines.push(`git ${s.join(' ')} failed: ${r.err.split('\n').filter(Boolean).pop()}`); break; }
        }
        const after = (await git(p.dir, ['rev-parse', '--short', `origin/${BRANCH}`])).out;
        const count = before && before !== after ? (await git(p.dir, ['rev-list', '--count', `${before}..${after}`])).out : '0';
        lines.push(`origin/${BRANCH}: ${count} new commit(s)${count !== '0' ? ` (${before} → ${after})` : ''}`);
        if (current !== BRANCH) lines.push(`switched ${current || '(detached)'} → ${BRANCH}`);
        if (changed) lines.push(`${changed.split('\n').length} local change(s) removed`);
        if (ok) lines.push(`now ${BRANCH} = GitHub, main = GitHub`);
        results.push({ id: p.id, name: p.name, ok, lines });
      }
      const s = readState();
      s.pulled = s.pulled || {};
      for (const r of results) s.pulled[r.id] = Date.now();
      writeState(s);
      return results;
    } finally { pulling = false; }
  }

  // ---- merges: what landed on development / main in the last N days (from the origin/* refs) ----

  const SEP = '\x1f';
  const repoUrl = async (p) => (await git(p.dir, ['remote', 'get-url', 'origin'])).out.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');

  // One line per change on the branch itself (--first-parent): a merged PR, a squash-merged PR, a sync
  // merge ("Merge branch 'main' into development") or a commit pushed straight to the branch.
  function describeCommit(subject, parents) {
    let m = subject.match(/^Merge pull request #(\d+) from ([^\s]+)/);
    if (m) return { kind: 'PR', pr: Number(m[1]), from: m[2].replace(/^[^/]+\//, '') };
    m = subject.match(/^Merge (?:remote-tracking )?branch '([^']+)'/);
    if (m) return { kind: 'sync', from: m[1].replace(/^origin\//, '') };
    m = subject.match(/\(#(\d+)\)\s*$/);
    if (m) return { kind: 'PR', pr: Number(m[1]), squash: true };
    return { kind: parents > 1 ? 'merge' : 'direct' };
  }

  async function merges({ days, branch, repos }) {
    days = Math.min(Math.max(parseInt(days, 10) || 7, 1), 365);
    branch = branch === 'main' ? 'main' : BRANCH;
    const other = branch === 'main' ? BRANCH : 'main';
    const chosen = MERGE_REPOS.filter((p) => !repos || !repos.length || repos.includes(p.id));
    const out = [];
    for (const p of chosen) {
      if (!fs.existsSync(path.join(p.dir, '.git'))) { out.push({ id: p.id, name: p.name, missing: true }); continue; }
      const [log, notInOther, url] = await Promise.all([
        git(p.dir, ['log', '--first-parent', `--since=${days}.days.ago`, `--format=%H${SEP}%h${SEP}%cI${SEP}%an${SEP}%s${SEP}%P`, `origin/${branch}`]),
        git(p.dir, ['rev-list', `origin/${other}..origin/${branch}`]),
        repoUrl(p),
      ]);
      const missingInOther = new Set(notInOther.out.split('\n').filter(Boolean));
      const commits = log.out.split('\n').filter(Boolean).map((line) => {
        const [sha, short, date, author, subject, parents] = line.split(SEP);
        const d = describeCommit(subject, parents.split(' ').filter(Boolean).length);
        const tickets = [...new Set(subject.match(/\b[A-Z]{2,6}-\d{1,6}\b/g) || [])];
        return { sha, short, date, author, subject, ...d, tickets, inOther: !missingInOther.has(sha),
          link: d.pr ? `${url}/pull/${d.pr}` : `${url}/commit/${sha}` };
      });
      out.push({ id: p.id, name: p.name, url, commits, notInOtherCount: missingInOther.size, error: log.ok ? null : log.err });
    }
    const s = readState();
    return { days, branch, other, lastPull: s.pulled || {}, lastFetch: s.fetched || null, repos: out };
  }

  // Files of one commit (for the row details). A merge commit shows what it brought in (diff to its first parent).
  async function mergeFiles(repoId, sha) {
    const p = MERGE_REPOS.find((x) => x.id === repoId);
    if (!p || !/^[0-9a-f]{7,40}$/.test(String(sha))) throw new Error('Unknown repo or commit.');
    const r = await git(p.dir, ['diff', '--stat=200', '--stat-count=80', `${sha}^1`, sha]);
    return { files: r.ok ? r.out : r.err };
  }

  // Fetch only (no checkout / reset): refreshes origin/development and origin/main for the merges view.
  async function fetchAll() {
    const results = [];
    for (const p of MERGE_REPOS) {
      const r = await git(p.dir, ['fetch', 'origin', BRANCH, 'main']);
      results.push({ id: p.id, name: p.name, ok: r.ok, error: r.ok ? null : r.err.split('\n').pop() });
    }
    const s = readState();
    s.fetched = Date.now();
    writeState(s);
    return results;
  }

  // ---- agent runs (same pattern as qa-agent.js) ----

  let active = null;
  const cache = new Map();
  const runDir = (id) => path.join(RUNS, id);
  function save(run) {
    const { child, buf, ...data } = run;
    fs.writeFileSync(path.join(runDir(run.id), 'run.json'), JSON.stringify(data));
  }
  function add(run, ev) { ev.at = Date.now(); run.events.push(ev); save(run); }
  function load(id) {
    if (active && active.id === id) return active;
    if (cache.has(id)) return cache.get(id);
    const f = path.join(runDir(id), 'run.json');
    if (!/^[\w-]+$/.test(id) || !fs.existsSync(f)) return null;
    const r = JSON.parse(fs.readFileSync(f, 'utf8'));
    cache.set(id, r);
    return r;
  }

  function describeTool(name, input = {}) {
    const arg = input.file_path || input.pattern || input.command || input.path || '';
    return { name, detail: String(arg).slice(0, 300) };
  }

  function onMessage(run, m) {
    if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
      for (const c of m.message.content) {
        if (c.type === 'text' && c.text.trim()) { run.lastText = c.text; add(run, { kind: 'agent', text: c.text }); }
        if (c.type === 'tool_use') {
          const d = describeTool(c.name, c.input);
          add(run, { kind: 'tool', text: d.name, detail: d.detail });
          guard(run, c.name + JSON.stringify(c.input || {}));
        }
      }
    } else if (m.type === 'user' && m.message && Array.isArray(m.message.content)) {
      for (const c of m.message.content) {
        if (c.type === 'tool_result' && c.is_error) {
          const t = Array.isArray(c.content) ? c.content.map((x) => x.text || '').join(' ') : String(c.content || '');
          add(run, { kind: 'tool-error', text: t.slice(0, 400) });
        }
      }
    } else if (m.type === 'result') {
      endTurn(run, m.result || run.lastText || '');
    }
  }

  function guard(run, key) {
    run.turnCalls = (run.turnCalls || 0) + 1;
    run.sameCalls = key === run.lastCall ? (run.sameCalls || 1) + 1 : 1;
    run.lastCall = key;
    let why = null;
    if (run.sameCalls >= MAX_SAME_CALL) why = `it repeated the same step ${MAX_SAME_CALL} times in a row`;
    else if (run.turnCalls >= MAX_CALLS_PER_TURN) why = `it used ${MAX_CALLS_PER_TURN} steps without checking back with you`;
    if (!why || run.stopped) return;
    run.stopped = true;
    run.state = 'failed';
    run.ask = null;
    add(run, { kind: 'error', text: `Stopped automatically to save your plan's usage: ${why}. Start a new run with a smaller selection.` });
    if (run.child && run.child.exitCode === null) killTree(run.child.pid);
    finish(run);
  }

  // Every turn ends with [[PLAN]] (approve or change), [[ASK]] (answer) or a [[REPORT]] block.
  function endTurn(run, text) {
    const rep = text.match(/\[\[REPORT\]\]([\s\S]*?)(\[\[\/REPORT\]\]|$)/);
    if (rep && rep[1].trim()) {
      run.report = rep[1].trim();
      const st = run.report.match(/\*\*Status:\*\*\s*\**\s*(GAPS FOUND|COVERED)/i);
      run.result = st ? st[1].toUpperCase() : 'DONE';
      run.state = 'done';
      run.ask = null;
      run.waitingSince = Date.now();
      // "New changes" run: these commits are now scanned
      if (run.mode === 'changes' && run.ranges && !run.marked) {
        const s = readState();
        for (const r of run.ranges) s.scanned[r.id] = { sha: r.to, at: Date.now() };
        writeState(s);
        run.marked = true;
      }
      save(run);
      refreshChanges(run);
      return;
    }
    refreshChanges(run);
    const isPlan = /\[\[PLAN\]\]\s*$/.test(text.trim());
    const q = text.replace(/\[\[(PLAN|ASK)\]\]\s*$/, '').trim();
    run.ask = { question: q || 'The agent is waiting for your reply.', plan: isPlan };
    run.state = 'waiting';
    run.waitingSince = Date.now();
    save(run);
  }

  // Files of the test repo the agent changed in this run: git status now, minus what was already changed at the start.
  const repoStatus = async () => (await git(root, ['status', '--porcelain', '--untracked-files=all', '--', 'tests', 'src', 'CLAUDE.md'])).out.split('\n').filter(Boolean);
  async function refreshChanges(run) {
    const before = new Set(run.baseline || []);
    run.changed = (await repoStatus()).filter((l) => !before.has(l)).map((l) => l.slice(3));
    save(run);
  }

  function finish(run) {
    if (run.child && run.child.exitCode === null) { try { run.child.stdin.end(); } catch { /* gone */ } setTimeout(() => run.child && run.child.exitCode === null && killTree(run.child.pid), 5000); }
    if (active === run) active = null;
    cache.set(run.id, run);
  }

  function send(run, text) {
    run.turnCalls = 0;
    run.lastCall = null;
    run.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
    run.state = 'working';
    run.ask = null;
    save(run);
  }

  // mode 'gaps' = find what is not covered; 'changes' = only the commits since the last scan.
  async function start({ mode, apps, instructions }) {
    if (active && active.state === 'done') finish(active);
    if (active && ['working', 'waiting', 'starting'].includes(active.state)) throw new Error('A coverage run is already active. Stop it first.');
    mode = mode === 'changes' ? 'changes' : 'gaps';
    apps = (Array.isArray(apps) ? apps : []).filter((a) => APPS.includes(a));
    if (!apps.length) throw new Error('Pick at least one app.');
    instructions = String(instructions || '').trim().slice(0, 20000);

    const status = await projects();
    const ranges = [];
    if (mode === 'changes') {
      for (const p of status) {
        if (p.missing || !p.head) continue;
        const to = (await git(p.dir, ['rev-parse', `origin/${BRANCH}`])).out;
        // first scan of a repo: the last 7 days
        const from = p.scanned ? p.scanned.sha : (await git(p.dir, ['rev-list', '-1', '--before=7 days ago', `origin/${BRANCH}`])).out;
        const n = from ? Number((await git(p.dir, ['rev-list', '--count', `${from}..${to}`])).out) : null;
        ranges.push({ id: p.id, name: p.name, from, to, count: n, firstScan: !p.scanned });
      }
      if (!ranges.some((r) => r.count)) throw new Error('No new commits on development since the last scan. Pull first?');
    }

    const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + crypto.randomBytes(2).toString('hex');
    fs.mkdirSync(runDir(id), { recursive: true });
    const run = { id, mode, apps, instructions, ranges, started: Date.now(), state: 'starting', events: [], ask: null, report: null, result: null, child: null, buf: '',
      baseline: await repoStatus(), changed: [] };
    active = run;

    const repos = [...PROJECTS.map((p) => p.dir), root];
    // writes: only these paths of the test repo (relative to the cwd = test repo); everything else is refused
    const allowed = ['Read', 'Grep', 'Glob', 'Edit(tests/**)', 'Edit(src/**)', 'Edit(CLAUDE.md)',
      'Bash(npm run typecheck)', 'Bash(npm run lint)', 'Bash(npx eslint:*)', 'Bash(npx playwright test:*)'];
    for (const r of repos) for (const c of ['log', 'diff', 'show', 'blame', 'ls-files', 'rev-list']) allowed.push(`Bash(git -C ${slash(r)} ${c}:*)`);
    const disallowed = ['Read(**/.env)', 'Read(**/.env.*)', 'Read(**/.auth/**)', 'Read(**/node_modules/**)', 'Read(**/vendor/**)',
      ...PROJECTS.map((p) => `Edit(/${slash(p.dir).replace(/^([A-Za-z]):/, (m, d) => '/' + d.toLowerCase())}/**)`), 'mcp__claude_ai_Linear', 'mcp__claude_ai_Claude_Docs',
      'mcp__claude_ai_Google_Docs', 'mcp__claude_ai_Google_Drive', 'mcp__claude_ai_Google_Calendar', 'mcp__claude_ai_Gmail', 'mcp__claude_ai_Sentry', 'mcp__claude_ai_Atlassian'];
    const args = ['-p', '--model', model, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config', '--tools', 'Read,Grep,Glob,Edit,Write,Bash',
      '--append-system-prompt-file', PROMPT_FILE, ...repos.flatMap((r) => ['--add-dir', r]),
      '--allowedTools', ...allowed, '--disallowedTools', ...disallowed];
    const child = runClaude(args, root);
    run.child = child;
    child.stdout.on('data', (d) => {
      run.buf += d.toString('utf8');
      let i;
      while ((i = run.buf.indexOf('\n')) >= 0) {
        const line = run.buf.slice(0, i).trim();
        run.buf = run.buf.slice(i + 1);
        if (!line) continue;
        try { onMessage(run, JSON.parse(line)); } catch { /* not JSON */ }
      }
    });
    let errTail = '';
    child.stderr.on('data', (d) => { errTail = (errTail + d.toString('utf8')).slice(-2000); });
    child.on('exit', (code) => {
      if (['working', 'starting', 'waiting'].includes(run.state)) {
        run.state = run.stopped ? 'stopped' : 'failed';
        if (!run.stopped) add(run, { kind: 'error', text: `The agent process ended (code ${code}). ${errTail.trim().split('\n').slice(-3).join(' ')}` });
        run.ask = null;
        save(run);
      }
      finish(run);
    });
    child.on('error', (e) => { run.state = 'failed'; add(run, { kind: 'error', text: e.message }); finish(run); });

    const first = [
      `Mode: ${mode === 'changes' ? 'changes (only the new commits below)' : 'gaps (what is not covered yet)'}`,
      `Apps: ${apps.join(', ')}`,
      instructions ? `Instructions from the user:\n${instructions}` : '',
      `Date: ${new Date().toISOString().slice(0, 10)}. Branch to analyse: ${BRANCH} (origin/${BRANCH}).`,
      'Repos (use these exact paths in git -C):',
      ...status.map((p) => `- ${p.name} (${p.apps}): ${slash(p.dir)}${p.missing ? ' — NOT FOUND' : `, working copy on ${p.branch}${p.branch !== BRANCH ? ` (NOT ${BRANCH}: read files with git show origin/${BRANCH}:<path>)` : ''}${p.localChanges ? `, ${p.localChanges} uncommitted file(s) (ignore them, they are not on ${BRANCH})` : ''}`}`),
      `- Test repo: ${slash(root)} (read CLAUDE.md first). You may write tests here (tests/**, src/**, CLAUDE.md) after the user approves.`,
      testRunning() ? `- A Playwright run is going now (${testRunning()}): do NOT start another one.` : '- No Playwright run is going now (ask before you run one).',
      ...(mode === 'changes' ? ['', 'New commits to analyse:', ...ranges.map((r) => `- ${r.name}: ${r.count ? `${r.count} commit(s), range ${r.from.slice(0, 10)}..${r.to.slice(0, 10)}${r.firstScan ? ' (first scan: last 7 days)' : ''}` : 'nothing new'}`)] : []),
      '',
      'Start with step 1 of the workflow, then send your PLAN and wait for approval.',
    ].filter(Boolean).join('\n');
    const title = mode === 'changes' ? `New changes · ${apps.join(', ')}` : `Coverage gaps · ${apps.join(', ')}`;
    run.title = instructions ? `${title} · ${instructions.split('\n')[0].slice(0, 60)}` : title;
    add(run, { kind: 'user', text: [title, instructions].filter(Boolean).join('\n\n') });
    send(run, first);
    return run.id;
  }

  // approve = go ahead with the plan; ignore = drop what the agent just suggested (plan or question).
  function reply(id, { text, approve, ignore }) {
    const run = load(id);
    if (!run || run !== active || !['waiting', 'done'].includes(run.state)) throw new Error('This run is not waiting for a reply.');
    let msg = String(text || '').trim().slice(0, 20000);
    if (approve) msg = `Approved, go ahead.${msg ? `\n\n${msg}` : ''}`;
    else if (ignore) {
      msg = `Ignore what you just suggested: do not do it and do not suggest it again in this chat.${msg
        ? `\n\nInstead: ${msg}` : '\n\nReply in one short line and ask what I want next, ending with [[ASK]].'}`;
    }
    if (!msg) throw new Error('Type a reply.');
    add(run, { kind: 'user', text: msg });
    send(run, msg);
  }

  function stop(id) {
    const run = load(id);
    if (!run || run !== active) throw new Error('This run is not active.');
    run.stopped = true;
    run.state = 'stopped';
    run.ask = null;
    add(run, { kind: 'info', text: 'Stopped by you.' });
    if (run.child && run.child.exitCode === null) killTree(run.child.pid);
    finish(run);
  }

  // Close = end the chat: the agent process is stopped, the history and report stay.
  function close(id) {
    const run = load(id);
    if (!run) throw new Error('Run not found.');
    if (run === active) {
      run.stopped = true;
      if (run.child && run.child.exitCode === null) killTree(run.child.pid);
      finish(run);
    }
    if (run.state !== 'done') run.state = 'closed';
    run.ask = null;
    run.closed = true;
    add(run, { kind: 'info', text: 'Chat closed by you.' });
  }

  function list() {
    return fs.readdirSync(RUNS).filter((d) => fs.existsSync(path.join(RUNS, d, 'run.json'))).sort().reverse().slice(0, 10).map((d) => {
      const r = load(d);
      return { id: r.id, title: r.title, mode: r.mode, state: r.state, result: r.result, started: r.started };
    });
  }

  function get(id, since = 0) {
    const r = load(id);
    if (!r) return null;
    return { id: r.id, title: r.title, mode: r.mode, apps: r.apps, instructions: r.instructions, ranges: r.ranges, state: r.state, ask: r.ask,
      report: r.report, result: r.result, closed: !!r.closed, changed: r.changed || [], alive: !!(active && active.id === r.id && active.child && active.child.exitCode === null),
      started: r.started, events: r.events.slice(since), total: r.events.length };
  }

  function remove(id) {
    if (active && active.id === id && active.state === 'done') finish(active);
    if (active && active.id === id) throw new Error('Stop this run before deleting it.');
    if (!/^[\w-]+$/.test(id) || !fs.existsSync(path.join(runDir(id), 'run.json'))) throw new Error('Run not found.');
    fs.rmSync(runDir(id), { recursive: true, force: true });
    cache.delete(id);
  }

  setInterval(() => {
    const run = active;
    if (!run || !['waiting', 'done'].includes(run.state) || Date.now() - (run.waitingSince || Date.now()) < IDLE_MINUTES * 60000) return;
    if (run.state === 'done') {
      add(run, { kind: 'info', text: `Agent closed after ${IDLE_MINUTES} idle minutes to free memory. A follow-up starts a new run with this report.` });
      return finish(run);
    }
    run.stopped = true;
    run.state = 'stopped';
    run.ask = null;
    add(run, { kind: 'info', text: `Stopped after ${IDLE_MINUTES} minutes without an answer, to free memory.` });
    if (run.child && run.child.exitCode === null) killTree(run.child.pid);
    finish(run);
  }, 60000).unref();

  function shutdown() { if (active && active.child && active.child.exitCode === null) return killTree(active.child.pid); return null; }

  return { projects, pull, merges, mergeFiles, fetchAll, start, reply, stop, close, remove, list, get, shutdown, active: () => active && { id: active.id, state: active.state } };
};
