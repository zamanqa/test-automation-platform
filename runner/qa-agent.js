'use strict';
// QA agent for the /qa page: runs `claude -p` as a QA engineer that reads a Linear ticket or
// instructions, asks questions on the page, tests hub / checkout / POS / CSS in a browser and the APIs
// with curl, can run a suite of this repo when asked, and ends with a report posted to the Linear ticket.
//
// One claude process per run, kept alive for the whole conversation (stream-json in and out), so the
// browser keeps its session between questions. --no-session-persistence: nothing of the conversation
// (logins included) is written to Claude's transcript folder. Run history in runs/<id>/run.json has
// the credential values replaced by ••••.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const HERE = __dirname;
const RUNS = path.join(HERE, 'runs');
const PROMPT_FILE = path.join(HERE, 'qa-agent-prompt.md');

// Tools the agent may use without asking. Everything else is refused in headless mode.
const LINEAR_READ = ['get_issue', 'list_comments', 'get_attachment', 'extract_images', 'list_issues', 'get_document',
  'get_project', 'list_documents', 'get_issue_status', 'get_team', 'get_user', 'list_issue_labels', 'search_documentation']
  .map((t) => `mcp__claude_ai_Linear__${t}`);
const ALLOWED = ['Read', 'Grep', 'Glob', 'mcp__playwright', ...LINEAR_READ,
  'Bash(curl:*)', 'Bash(npx playwright test:*)'];
// Removed from the agent's context entirely (other connectors, and every Linear write).
const LINEAR_WRITE = ['create_attachment', 'create_attachment_from_upload', 'create_issue_label', 'delete_attachment',
  'delete_comment', 'delete_customer', 'delete_customer_need', 'delete_diff_comment', 'delete_status_update', 'mark_notification',
  'merge_diff', 'prepare_attachment_upload', 'resolve_diff_thread', 'restore_issue_label', 'restore_project_label',
  'retire_issue_label', 'retire_project_label', 'save_comment', 'save_customer', 'save_customer_need', 'save_diff_comment',
  'save_document', 'save_issue', 'save_issue_label', 'save_milestone', 'save_project', 'save_project_label', 'save_release',
  'save_release_note', 'save_status_update', 'share_issue', 'submit_diff_review', 'unshare_issue', 'update_diff']
  .map((t) => `mcp__claude_ai_Linear__${t}`);
const DISALLOWED = ['Read(**/.env)', 'Read(**/.auth/**)', 'mcp__claude_ai_Claude_Docs', 'mcp__claude_ai_Google_Docs', 'mcp__claude_ai_Google_Drive',
  'mcp__claude_ai_Google_Calendar', 'mcp__claude_ai_Gmail', 'mcp__claude_ai_Sentry', 'mcp__claude_ai_Atlassian', ...LINEAR_WRITE];

// Token guard: a stuck agent is stopped instead of burning the plan's usage.
const MAX_SAME_CALL = 3;       // the same tool call with the same input, this many times in a row
const MAX_CALLS_PER_TURN = 60; // tool calls between two messages to the user

const TICKET_RE = /^[A-Za-z][A-Za-z0-9]{1,9}-\d{1,7}$/;

// Runs only on the user's Claude plan (claude.ai login): an API key in the environment would bill per
// token instead, so it is removed from the agent's environment.
// On Windows the command goes through cmd.exe (claude and npx are .cmd files), so every arg is quoted.
const quote = (a) => '"' + String(a).replace(/"/g, '\\"') + '"';
const npx = process.platform === 'win32' ? { command: 'cmd', pre: ['/c', 'npx'] } : { command: 'npx', pre: [] };

function planOnlyEnv() {
  const env = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']) delete env[k];
  return env;
}

module.exports = function qaAgent({ claudeExe = 'claude', root, killTree, environment, model = 'sonnet' }) {
  const runClaude = (args, cwd) => spawn(claudeExe, args.map(quote), { cwd, shell: true, windowsHide: true, env: planOnlyEnv() });
  fs.mkdirSync(RUNS, { recursive: true });
  // A run still marked live from an earlier runner lost its agent when the runner stopped.
  for (const d of fs.readdirSync(RUNS)) {
    const f = path.join(RUNS, d, 'run.json');
    try {
      const r = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!['working', 'waiting', 'starting'].includes(r.state)) continue;
      r.state = 'stopped';
      r.ask = null;
      r.events.push({ kind: 'info', text: 'The runner was restarted, which ended this run. Nothing was posted to Linear. Start it again from New task.', at: Date.now() });
      fs.writeFileSync(f, JSON.stringify(r));
    } catch { /* not a run folder */ }
  }
  let active = null; // the one live run (memory: one browser + one agent at a time)
  const cache = new Map(); // id -> run, for runs loaded from disk

  const runDir = (id) => path.join(RUNS, id);
  const redact = (run, s) => {
    let out = String(s ?? '');
    for (const v of run.secrets) if (v.length >= 3) out = out.split(v).join('••••');
    return out;
  };
  function save(run) {
    const { child, secrets, buf, ...data } = run;
    fs.writeFileSync(path.join(runDir(run.id), 'run.json'), JSON.stringify(data));
  }
  function add(run, ev) {
    ev.at = Date.now();
    if (ev.text) ev.text = redact(run, ev.text);
    if (ev.detail) ev.detail = redact(run, ev.detail);
    run.events.push(ev);
    save(run);
  }
  function load(id) {
    if (active && active.id === id) return active;
    if (cache.has(id)) return cache.get(id);
    const f = path.join(runDir(id), 'run.json');
    if (!/^[\w-]+$/.test(id) || !fs.existsSync(f)) return null;
    const r = JSON.parse(fs.readFileSync(f, 'utf8'));
    r.secrets = [];
    cache.set(id, r);
    return r;
  }

  // One short line per tool call for the page.
  function describeTool(name, input = {}) {
    const short = name.replace(/^mcp__claude_ai_Linear__/, 'Linear: ').replace(/^mcp__playwright__browser_/, 'Browser: ');
    const arg = input.url || input.file_path || input.pattern || input.command || input.id || input.query
      || input.element || input.text || input.filename || '';
    return { name: short, detail: String(arg).slice(0, 300) };
  }

  function onMessage(run, m) {
    if (m.type === 'system' && m.subtype === 'init') {
      run.sessionTools = (m.tools || []).length;
    } else if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
      for (const c of m.message.content) {
        if (c.type === 'text' && c.text.trim()) run.lastText = c.text;
        if (c.type === 'text' && c.text.trim()) add(run, { kind: 'agent', text: c.text });
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
    add(run, { kind: 'error', text: `Stopped automatically to save your plan's usage: ${why}. Start a new run with more precise instructions.` });
    if (run.child && run.child.exitCode === null) killTree(run.child.pid);
    finish(run);
  }

  // The agent ends every turn with [[ASK]] (waits for the user) or [[REPORT]] (done).
  function endTurn(run, text) {
    const rep = text.match(/\[\[REPORT\]\]([\s\S]*?)(\[\[\/REPORT\]\]|$)/);
    if (rep && rep[1].trim()) {
      run.report = redact(run, rep[1].trim());
      const st = run.report.match(/\*\*Status:\*\*\s*\**\s*(PASSED|FAILED|BLOCKED)/i);
      run.result = st ? st[1].toUpperCase() : 'DONE';
      run.state = 'done';
      run.ask = null;
      // The agent stays open for follow-ups (closed after IDLE_MINUTES). Only the first report is posted
      // automatically; a later one waits for "Post update", so the ticket is not flooded.
      run.waitingSince = Date.now();
      run.reports = (run.reports || 0) + 1;
      if (run.reports > 1 && run.ticket) run.linear = { state: 'update' };
      save(run);
      if (run.reports === 1 && run.ticket && run.autoPost) postToLinear(run.id).catch(() => {});
      return;
    }
    const ask = text.match(/\[\[ASK\]\]([\s\S]*)$/);
    const q = (ask ? ask[1] : text).replace(/\[\[FIELDS:[^\]]*\]\]/, '').trim();
    const f = text.match(/\[\[FIELDS:\s*([^\]]+)\]\]/);
    const fields = f ? f[1].split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8)
      .map((s) => ({ name: s.replace(/\*$/, '').trim(), secret: s.endsWith('*') })) : null;
    run.ask = { question: redact(run, q || 'The agent is waiting for your reply.'), fields };
    run.state = 'waiting';
    run.waitingSince = Date.now();
    save(run);
  }

  function finish(run) {
    if (run.child && run.child.exitCode === null) { try { run.child.stdin.end(); } catch { /* gone */ } setTimeout(() => run.child && run.child.exitCode === null && killTree(run.child.pid), 5000); }
    run.secrets = [];
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

  async function start({ ticket, instructions, apps, autoPost, headless }) {
    if (active && active.state === 'done') finish(active); // a finished run kept open for follow-ups
    if (active && ['working', 'waiting', 'starting'].includes(active.state)) throw new Error('A QA run is already active. Stop it first (one run at a time, to save memory).');
    ticket = String(ticket || '').trim().toUpperCase();
    instructions = String(instructions || '').trim().slice(0, 20000);
    if (ticket && !TICKET_RE.test(ticket)) throw new Error(`"${ticket}" does not look like a Linear ticket ID (e.g. CIR-1234).`);
    if (!ticket && !instructions) throw new Error('Give a Linear ticket ID or instructions.');

    const env = await environment();
    const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + crypto.randomBytes(2).toString('hex');
    const dir = runDir(id);
    fs.mkdirSync(dir, { recursive: true });
    // "password: x" (or pass/pwd/token/secret/api key) typed into the instructions reaches the agent
    // as written, but is saved and shown as ••••.
    const secrets = [...instructions.matchAll(/\b(?:pass\w*|pwd|secret|token|api[ _-]?key)\s*[:=]\s*(\S+)/gi)].map((m) => m[1]);
    const run = { id, headless: !!headless, ticket: ticket || null, instructions: '', apps: Array.isArray(apps) ? apps : [], autoPost: autoPost !== false,
      started: Date.now(), state: 'starting', events: [], ask: null, report: null, result: null,
      linear: null, secrets, child: null, buf: '' };
    run.instructions = redact(run, instructions);
    active = run;

    // Playwright for the agent: headed (a visible window) unless the user picked headless; own browser profile in memory, files (screenshots) into the run folder.
    const mcp = { mcpServers: { playwright: { command: npx.command, args: [...npx.pre, '-y', '@playwright/mcp@latest', ...(headless ? ['--headless'] : []), '--isolated',
      '--output-dir', dir, '--viewport-size', '1440,900', '--image-responses', 'omit'] } } };
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify(mcp));

    const args = ['-p', '--model', model, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--no-session-persistence', '--setting-sources', '', '--tools', 'Read,Grep,Glob,Bash',
      '--append-system-prompt-file', PROMPT_FILE, '--mcp-config', path.join(dir, 'mcp.json'),
      '--add-dir', root,
      '--allowedTools', ...ALLOWED, '--disallowedTools', ...DISALLOWED];
    const child = runClaude(args, dir);
    run.child = child;
    run.pid = child.pid;
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
      ticket ? `Linear ticket: ${ticket}` : 'No Linear ticket: work from the instructions below.',
      instructions ? `Instructions from the user:\n${instructions}` : '',
      run.apps.length ? `Apps the user wants tested: ${run.apps.join(', ')}` : '',
      `Environment (${new Date().toISOString().slice(0, 10)}, development, SHARED dev databases):`,
      ...env.apps.map((x) => `- ${x.name}: ${x.url || 'not set in .env'}`),
      `- Test repo: ${root} (read CLAUDE.md first)`,
      `- Suites: ${env.suites.map((x) => `${x.id} (${x.tests} tests)`).join(', ')}`,
      env.testRunning ? `- A Playwright run is going now (${env.testRunning}): do NOT start another one.` : '- No Playwright run is going now.',
      `- Screenshots and files go to: ${dir}`,
      '',
      'Start with step 1 of the workflow, then send the test plan and ask before testing.',
    ].filter(Boolean).join('\n');
    add(run, { kind: 'user', text: ticket ? `Test ${ticket}${instructions ? `\n\n${instructions}` : ''}` : instructions });
    send(run, first);
    return run.id;
  }

  function reply(id, { text, fields }) {
    const run = load(id);
    if (!run || run !== active || !['waiting', 'done'].includes(run.state)) throw new Error('This run is not waiting for a reply.');
    let msg = String(text || '').trim().slice(0, 20000);
    let shown = msg;
    if (fields && run.ask && run.ask.fields) {
      const lines = [];
      const shownLines = [];
      for (const f of run.ask.fields) {
        const v = String((fields[f.name] ?? '')).slice(0, 500);
        if (f.secret && v) run.secrets.push(v);
        lines.push(`${f.name}: ${v}`);
        shownLines.push(`${f.name}: ${f.secret && v ? '••••' : v}`);
      }
      msg = `${lines.join('\n')}${msg ? `\n\n${msg}` : ''}`;
      shown = `${shownLines.join('\n')}${shown ? `\n\n${shown}` : ''}`;
    }
    if (!msg) throw new Error('Type a reply.');
    add(run, { kind: 'user', text: shown });
    send(run, msg);
  }

  function stop(id) {
    const run = load(id);
    if (!run || run !== active) throw new Error('This run is not active.');
    run.stopped = true;
    run.state = 'stopped';
    run.ask = null;
    add(run, { kind: 'info', text: 'Stopped by you. Nothing was posted to Linear.' });
    if (run.child && run.child.exitCode === null) killTree(run.child.pid);
    finish(run);
  }

  // Posts the report as a comment, through a separate one-tool Claude call: the agent itself never
  // gets Linear write access.
  function postToLinear(id) {
    const run = load(id);
    if (!run || !run.report || !run.ticket) return Promise.reject(new Error('Nothing to post: the run has no report or no ticket.'));
    if (run.linear && run.linear.state === 'posting') return Promise.reject(new Error('Already posting.'));
    run.linear = { state: 'posting' };
    save(run);
    const prompt = `Add one comment to the Linear issue ${run.ticket} with the save_comment tool. The comment body must be exactly the text between <body> and </body>, unchanged. Then reply with only the URL of the new comment (or the issue URL if no comment URL is returned).\n\n<body>\n${run.report}\n</body>`;
    return new Promise((resolve) => {
      const child = runClaude(['-p', '--model', 'haiku', '--output-format', 'json', '--no-session-persistence', '--setting-sources', '',
        '--tools', '', '--allowedTools', 'mcp__claude_ai_Linear__save_comment', '--disallowedTools',
        ...DISALLOWED.filter((t) => t !== 'mcp__claude_ai_Linear__save_comment')], runDir(run.id));
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stdin.end(prompt);
      child.on('exit', () => {
        let res = null;
        try { res = JSON.parse(out); } catch { /* bad output */ }
        const text = res && res.result ? String(res.result) : '';
        const url = (text.match(/https:\/\/linear\.app\/\S+/) || [])[0];
        run.linear = res && !res.is_error && url ? { state: 'posted', url: url.replace(/[)\].,]+$/, '') } : { state: 'failed', error: (text || 'No answer from Claude').slice(0, 300) };
        add(run, { kind: 'info', text: run.linear.state === 'posted' ? `Report posted to ${run.ticket}.` : `Posting to Linear failed: ${run.linear.error}` });
        resolve(run.linear);
      });
    });
  }

  function list() {
    return fs.readdirSync(RUNS).filter((d) => fs.existsSync(path.join(RUNS, d, 'run.json'))).sort().reverse().slice(0, 10).map((d) => {
      const r = load(d);
      return { id: r.id, ticket: r.ticket, title: r.ticket || (r.instructions || '').split('\n')[0].slice(0, 80), state: r.state, result: r.result, started: r.started };
    });
  }

  function get(id, since = 0) {
    const r = load(id);
    if (!r) return null;
    const files = fs.existsSync(runDir(id)) ? fs.readdirSync(runDir(id)).filter((f) => /\.(png|jpe?g)$/i.test(f)) : [];
    return { id: r.id, ticket: r.ticket, instructions: r.instructions, state: r.state, ask: r.ask, report: r.report, result: r.result,
      alive: !!(active && active.id === r.id && active.child && active.child.exitCode === null),
      linear: r.linear, autoPost: r.autoPost, apps: r.apps, headless: !!r.headless, started: r.started, events: r.events.slice(since), total: r.events.length, files };
  }

  // Deletes a finished run with its report and screenshots. A live run must be stopped first.
  function remove(id) {
    if (active && active.id === id && active.state === 'done') finish(active); // closes the follow-up agent
    if (active && active.id === id) throw new Error('Stop this run before deleting it.');
    if (!/^[\w-]+$/.test(id) || !fs.existsSync(path.join(runDir(id), 'run.json'))) throw new Error('Run not found.');
    fs.rmSync(runDir(id), { recursive: true, force: true });
    cache.delete(id);
  }

  function file(id, name) {
    if (!/^[\w-]+$/.test(id) || !/^[\w.-]+\.(png|jpe?g)$/i.test(name)) return null;
    const f = path.join(runDir(id), name);
    return fs.existsSync(f) ? f : null;
  }

  // A run waiting for an answer holds a Claude process and a browser (~400 MB). Nobody answering for
  // IDLE_MINUTES ends it to free memory; the history and the conversation so far stay.
  const IDLE_MINUTES = 15;
  setInterval(() => {
    const run = active;
    if (!run || !['waiting', 'done'].includes(run.state) || Date.now() - (run.waitingSince || Date.now()) < IDLE_MINUTES * 60000) return;
    if (run.state === 'done') {
      add(run, { kind: 'info', text: `Agent closed after ${IDLE_MINUTES} idle minutes to free memory. A follow-up now starts a new run with this report.` });
      finish(run);
      return;
    }
    run.stopped = true;
    run.state = 'stopped';
    run.ask = null;
    add(run, { kind: 'info', text: `Stopped after ${IDLE_MINUTES} minutes without an answer, to free memory. Nothing was posted to Linear.` });
    if (run.child && run.child.exitCode === null) killTree(run.child.pid);
    finish(run);
  }, 60000).unref();

  // Stopping the runner ends the live agent.
  function shutdown() { if (active && active.child && active.child.exitCode === null) return killTree(active.child.pid); return null; }

  return { start, reply, stop, remove, postToLinear, list, get, file, shutdown, active: () => active && { id: active.id, state: active.state } };
};
