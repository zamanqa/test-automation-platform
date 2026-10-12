'use strict';
// Circuly Local launcher: a small local web server (http://localhost:3999) that runs the core API
// in Docker (on the shared dev DB or the local Docker DB) and the Hub / CSS / POS / Switchboard
// frontends, each on the branch picked in the page. No dependencies; run with Node 22.
// Nothing here ever pushes to git: it only fetches, creates worktrees and fast-forwards.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');

const HERE = __dirname;
// Machine-specific values live in ../config.json (git-ignored; copy config.example.json).
// %VARS% in it are expanded, e.g. "%USERPROFILE%\\tools\\node22".
const CONFIG_FILE = path.join(HERE, '..', 'config.json');
if (!fs.existsSync(CONFIG_FILE)) {
  console.error(`Missing ${CONFIG_FILE}. Copy config.example.json to config.json and fill it in (see INSTALL.md).`);
  process.exit(1);
}
const expand = (v) => (typeof v === 'string' ? v.replace(/%([^%]+)%/g, (m, k) => process.env[k] ?? m) : v);
const LOCAL = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const ROOT = expand(LOCAL.circulyRoot || 'C:\\Circuly\\circuly_pro');
const CFG = {
  port: 3999,
  repos: {
    backend: path.join(ROOT, 'circuly_core_api_lumen'),
    frontend: path.join(ROOT, 'circuly_frontend_mono_v2'),
  },
  branchesDir: path.join(ROOT, '_branches'),
  node22: expand(LOCAL.node22 || path.join(os.homedir(), 'tools', 'node22')),
  devdbPasswordFile: expand((LOCAL.devdb || {}).passwordFile || ''),
  devdbOverride: path.join(HERE, 'docker-compose.devdb.yml'),
  composeProject: 'circuly_core_api_lumen',
  defaultBranch: 'development',
};
// The compose files mount files from this folder; they find it through LAUNCHER_DIR.
process.env.LAUNCHER_DIR = HERE.replace(/\\/g, '/');

// Local-only RSA key the API signs sign-in id_tokens with. Made on first start, never committed.
const OIDC_KEY_FILE = path.join(HERE, 'oidc-signing-key.pem');
if (!fs.existsSync(OIDC_KEY_FILE)) {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(OIDC_KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }));
}

const APPS = {
  hub: { name: 'Hub', pkg: 'nuxt-hub', env: 'apps\\nuxt-hub\\.env.hub.local', port: 3000, company: false },
  css: { name: 'CSS', pkg: 'nuxt-css', env: 'apps\\nuxt-css\\.env.css.local', port: 3020, company: true },
  pos: { name: 'POS', pkg: 'nuxt-pos', env: 'apps\\nuxt-pos\\.env.pos.local', port: 3030, company: true },
  switchboard: { name: 'Switchboard', pkg: 'nuxt-switchboard', env: 'apps\\nuxt-switchboard\\.env.switchboard.local', port: 3070, company: false },
};

// ---------- persisted settings (branches are NOT persisted: development is always the default) ----------
const STATE_FILE = path.join(HERE, 'state.json');
const saved = readJson(STATE_FILE, {});
const settings = {
  backendBranch: CFG.defaultBranch,
  frontendBranch: CFG.defaultBranch,
  db: saved.db === 'local' ? 'local' : 'dev',
  companyId: saved.companyId || LOCAL.companyId || '',
  autoStopMinutes: Number.isInteger(saved.autoStopMinutes) ? saved.autoStopMinutes : 10, // 0 = never
};
const worktreeBranches = saved.worktreeBranches || {}; // folder -> branch, for detached worktrees
function persist() {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ db: settings.db, companyId: settings.companyId, autoStopMinutes: settings.autoStopMinutes, worktreeBranches }, null, 2));
}
function readJson(f, dflt) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } }

// ---------- process helpers ----------
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
function pushLines(buf, chunk, max = 400) {
  for (const line of stripAnsi(chunk.toString()).split(/\r?\n/)) {
    if (line.trim() !== '') buf.push(line);
  }
  if (buf.length > max) buf.splice(0, buf.length - max);
}
function nodeEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  env.PATH = `${CFG.node22};${process.env.PATH}`;
  env.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0';
  env.FORCE_COLOR = '0';
  // ipv4first: WSL's wslrelay.exe also listens on [::1]:8000 and answers with HTML, and Node tries
  // ::1 first for "localhost", so the apps' server-side calls missed the API. dotenv does not
  // override variables that are already set, so this replaces Hub's own NODE_OPTIONS (kept below).
  // 4 GB heap cap per dev server (was 8): enough for the build, and V8 cleans up sooner.
  env.NODE_OPTIONS = '--dns-result-order=ipv4first --max-old-space-size=4096 --max-http-header-size=8192';
  return env;
}
function run(cmd, args, { cwd, env, log, shell = false, verbatim = false } = {}) {
  return new Promise((resolve) => {
    let out = '';
    const p = spawn(cmd, args, { cwd, env: env || process.env, windowsHide: true, shell, windowsVerbatimArguments: verbatim });
    const on = (d) => { out += d; if (log) pushLines(log, d); };
    p.stdout.on('data', on);
    p.stderr.on('data', on);
    p.on('error', (e) => { out += String(e); if (log) log.push(String(e)); resolve({ code: -1, out }); });
    p.on('close', (code) => resolve({ code, out }));
  });
}
const git = (dir, ...args) => run('git', ['-C', dir, ...args]);
const docker = (...args) => run('docker', args);

// ---------- jobs (one long operation at a time, its log is shown in the page) ----------
let job = null;
function startJob(title, fn) {
  if (job && job.status === 'running') throw new Error(`Busy: "${job.title}" is still running.`);
  job = { title, status: 'running', log: [], started: Date.now() };
  const j = job;
  fn(j).then(
    () => { j.status = 'done'; j.log.push('✔ Done'); },
    (e) => { j.status = 'failed'; j.log.push(`✖ ${e.message}`); },
  );
}
async function step(j, label, cmd, args, opts = {}) {
  j.log.push(`▶ ${label}`);
  const r = await run(cmd, args, { ...opts, log: j.log });
  if (r.code !== 0) throw new Error(`${label} failed (exit ${r.code})`);
  return r;
}

// ---------- branches & folders ----------
const safeName = (b) => b.replace(/[^A-Za-z0-9._-]+/g, '-');
const branchCache = { backend: [], frontend: [] };

async function listBranches(kind) {
  const r = await git(CFG.repos[kind], 'for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin', 'refs/heads');
  const set = new Set();
  for (let b of r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    if (b.startsWith('origin/')) b = b.slice(7);
    if (b === 'HEAD' || b === 'origin') continue;
    set.add(b);
  }
  const rank = (b) => (b === 'development' ? 0 : b === 'main' ? 1 : 2);
  branchCache[kind] = [...set].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return branchCache[kind];
}
async function currentBranch(dir) {
  const r = await git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
  return r.code === 0 ? r.out.trim() : null;
}
async function folderFor(kind, branch) {
  const main = CFG.repos[kind];
  if ((await currentBranch(main)) === branch) return { dir: main, isMain: true };
  return { dir: path.join(CFG.branchesDir, kind, safeName(branch)), isMain: false };
}
async function branchOfFolder(kind, dir) {
  if (path.resolve(dir).toLowerCase() === CFG.repos[kind].toLowerCase()) return currentBranch(dir);
  return worktreeBranches[path.resolve(dir).toLowerCase()] || path.basename(dir);
}
function assertBranch(kind, branch) {
  if (typeof branch !== 'string' || !branchCache[kind].includes(branch)) {
    throw new Error(`Unknown ${kind} branch "${branch}". Refresh the branch list.`);
  }
}
async function ensureFolder(j, kind, branch) {
  const f = await folderFor(kind, branch);
  if (fs.existsSync(f.dir)) return f;
  const main = CFG.repos[kind];
  const remote = (await git(main, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`)).code === 0;
  fs.mkdirSync(path.dirname(f.dir), { recursive: true });
  await step(j, `Create ${kind} folder for "${branch}"`, 'git', ['-C', main, 'worktree', 'add', '--detach', f.dir, remote ? `origin/${branch}` : branch]);
  worktreeBranches[path.resolve(f.dir).toLowerCase()] = branch;
  persist();
  if (kind === 'backend') {
    // .env is git-ignored, so a fresh worktree has none.
    fs.copyFileSync(path.join(main, '.env'), path.join(f.dir, '.env'));
    j.log.push('Copied .env from the main backend folder.');
  }
  return f;
}
async function repoInfo(kind, branch) {
  const f = await folderFor(kind, branch);
  const info = { branch, dir: f.dir, isMain: f.isMain, exists: fs.existsSync(f.dir) };
  if (!info.exists) return info;
  const [log, st] = await Promise.all([
    git(f.dir, 'log', '-1', '--format=%h · %s · %cr'),
    git(f.dir, 'status', '--porcelain'),
  ]);
  info.commit = log.out.trim();
  info.changed = st.out.split(/\r?\n/).filter(Boolean).length;
  info.prepared = kind === 'frontend' ? fs.existsSync(path.join(f.dir, 'node_modules')) : fs.existsSync(path.join(f.dir, 'vendor'));
  return info;
}

// ---------- backend ----------
let pendingMigrations = null; // null = not checked
async function inspectApp() {
  const r = await docker('inspect', 'core_api_app', '--format', '{{json .Mounts}}|{{json .Config.Env}}|{{.State.Status}}');
  if (r.code !== 0) return { status: 'missing' };
  const [mounts, env, status] = r.out.trim().split('|');
  let source = null;
  let dbHost = null;
  let telescope = false;
  try {
    const all = JSON.parse(mounts);
    const m = all.find((x) => x.Destination === '/var/www/html');
    source = m ? m.Source : null;
    telescope = all.some((x) => x.Destination === TELESCOPE_TARGET);
    const e = JSON.parse(env).find((x) => x.startsWith('DB_HOST='));
    dbHost = e ? e.slice(8) : null;
  } catch { /* ignore */ }
  return { status, source, dbHost, telescope };
}
function matchFolder(source) {
  if (!source) return null;
  const norm = (p) => p.replace(/\\/g, '/').toLowerCase().replace(/^[a-z]:/, '').replace(/^\/run\/desktop\/mnt\/host\/[a-z]/, '').replace(/^\/mnt\/[a-z]/, '');
  const s = norm(source);
  const candidates = [CFG.repos.backend, ...Object.keys(worktreeBranches)];
  return candidates.find((d) => s.endsWith(norm(d))) || null;
}
// /v1/version is rate limited (30 a minute). Every open launcher tab polls status every 2.5s, so the
// answer is cached for 10s (and 429 counts as up) instead of using up the API's request budget.
const apiCache = { at: 0, value: null };
async function apiVersion(fresh = false) {
  if (!fresh && apiCache.value && Date.now() - apiCache.at < 10000) return apiCache.value;
  let value;
  try {
    const res = await fetch('http://localhost:8000/v1/version', { signal: AbortSignal.timeout(4000) });
    if (res.status === 429 && apiCache.value && apiCache.value.up) value = apiCache.value;
    else if (!res.ok) value = { up: false, code: res.status };
    else value = { up: true, database: (await res.json()).Database };
  } catch { value = { up: false }; }
  apiCache.at = Date.now();
  apiCache.value = value;
  return value;
}
async function backendStatus() {
  const [app, web, api] = await Promise.all([
    inspectApp(),
    docker('inspect', 'core_api_webserver', '--format', '{{.State.Status}}'),
    apiVersion(),
  ]);
  const folder = matchFolder(app.source);
  return {
    container: app.status,
    telescope: app.status === 'running' && app.telescope,
    webserver: web.code === 0 ? web.out.trim() : 'missing',
    folder: folder || app.source,
    branch: folder ? await branchOfFolder('backend', folder) : null,
    db: app.dbHost ? (app.dbHost === DEVDB.host ? 'dev' : 'local') : null,
    api,
    pendingMigrations,
  };
}
function composeArgs(dir, dev, speed = true) {
  const a = ['compose', '-p', CFG.composeProject, '-f', path.join(dir, 'docker-compose.yml')];
  if (speed) a.push('-f', path.join(HERE, 'docker-compose.speed.yml'), '-f', MAILBLOCK_FILE);
  if (dev) a.push('-f', CFG.devdbOverride);
  if (speed && telescopeWanted) a.push('-f', TELESCOPE_COMPOSE);
  return a;
}

// ---------- Telescope (only when asked for) ----------
// Off by default and after every launcher start. Turning it on recreates the API container with
// launcher/telescope.php mounted over config/telescope.php. That copy is made from the running
// branch's own config with three changes: only the request watcher (endpoints), entries stored in
// the local Docker Postgres (never the shared dev DB), and the launcher's own /v1/version checks
// ignored. Turning it off recreates the container without it, so it costs nothing while off.
const TELESCOPE_CONFIG = path.join(HERE, 'telescope.php');
const TELESCOPE_COMPOSE = path.join(HERE, 'docker-compose.telescope.yml');
const TELESCOPE_TARGET = '/var/www/html/config/telescope.php';
let telescopeWanted = false;
const TELESCOPE_CONNECTION = `// Added by the Circuly launcher: Telescope writes to the local Docker Postgres, never the shared dev DB.
config(['database.connections.launcher_telescope' => array_merge(config('database.connections.pgsql'), [
    'host' => 'db', 'port' => 5432, 'database' => 'postgres', 'username' => 'postgres',
    'password' => 'secret', 'search_path' => 'public', 'sslmode' => 'prefer',
])]);
`;
function writeTelescopeConfig(dir) {
  let src = fs.readFileSync(path.join(dir, 'config', 'telescope.php'), 'utf8');
  const change = (re, to) => {
    if (!re.test(src)) throw new Error(`config/telescope.php on this branch looks different (${re}); Telescope was not turned on.`);
    src = src.replace(re, to);
  };
  change(/env\('TELESCOPE_ENABLED',\s*(true|false)\)/, 'true');
  change(/'connection'\s*=>\s*env\('DB_CONNECTION',\s*'[^']*'\)/, "'connection' => 'launcher_telescope'");
  change(/env\('TELESCOPE_(\w+)_WATCHER',\s*(true|false)\)/g, (_, w) => (w === 'REQUEST' ? 'true' : 'false'));
  change(/'ignore_paths'\s*=>\s*\[/, "$&\n        'v1/version',");
  change(/^return \[/m, `${TELESCOPE_CONNECTION}\nreturn [`);
  fs.writeFileSync(TELESCOPE_CONFIG, src);
}
function setTelescope(on) {
  startJob(on ? 'Turn on Telescope (requests only)' : 'Turn off Telescope', async (j) => {
    const app = await inspectApp();
    if (app.status !== 'running') throw new Error('Start the backend first.');
    const dir = matchFolder(app.source);
    if (!dir) throw new Error('Could not tell which backend folder is running. Restart the backend.');
    const dev = !!(app.dbHost && app.dbHost === DEVDB.host);
    if (on) {
      writeTelescopeConfig(dir);
      await run('docker', ['start', 'core_api_postgres']);
    }
    telescopeWanted = on;
    await saveUsedFiles().catch(() => {});
    await writeMailBlock(j);
    await step(j, 'Recreate the API container', 'docker',
      [...composeArgs(dir, dev), 'up', '-d', '--no-build', '--no-deps', 'app'], { env: backendEnv(dev) });
    await step(j, 'Restart nginx', 'docker', ['restart', 'core_api_webserver']);
    await step(j, 'Clear cached config', 'docker', ['exec', 'core_api_app', 'php', 'artisan', 'optimize:clear']);
    if (on) {
      const t = await run('docker', ['exec', 'core_api_postgres', 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', "select to_regclass('public.telescope_entries')"]);
      if (!t.out.trim()) {
        await step(j, 'Create the Telescope tables (local DB)', 'docker',
          ['exec', 'core_api_app', 'php', 'artisan', 'migrate', '--database=launcher_telescope', '--path=database/migrations/telescope', '--force', '--no-interaction']);
      }
      await step(j, 'Clear old Telescope entries (local DB)', 'docker',
        ['exec', 'core_api_postgres', 'psql', '-U', 'postgres', '-d', 'postgres', '-c', 'TRUNCATE telescope_entries, telescope_entries_tags, telescope_monitoring']);
    }
    await waitForApi(j, 60);
    warmPhp();
    j.log.push(on ? 'Telescope is on: http://localhost:8000/telescope/requests' : 'Telescope is off.');
  });
}

// ---------- email safety ----------
// Most emails (sign-in codes, order mails, …) are sent by EmailEntryObserver through PHPMailer with
// each company's own SMTP settings from email_settings (Mailgun, MailerSend, …), not through
// Laravel's mailer. On the dev DB those are real servers, so the launcher points every SMTP host
// found there at 127.0.0.1 inside the API container (nothing can leave this machine), and then
// relays each email it saved in email_entries into MailHog, so you still receive them locally.
const MAILBLOCK_FILE = path.join(HERE, 'docker-compose.mailblock.yml');
const KNOWN_SMTP_HOSTS = [
  'smtp.eu.mailgun.org', 'smtp.mailgun.org', 'smtp.sendgrid.net', 'smtp.postmarkapp.com',
  'smtp.mailersend.net', 'sandbox.smtp.mailtrap.io', 'live.smtp.mailtrap.io', 'smtp.gmail.com',
  'smtp.office365.com', 'smtp-mail.outlook.com', 'smtp-relay.brevo.com', 'smtp-relay.sendinblue.com',
  'smtp.sparkpostmail.com', 'smtp.mandrillapp.com', 'in-v3.mailjet.com', 'smtp.zoho.eu', 'smtp.zoho.com',
  'email-smtp.eu-central-1.amazonaws.com', 'email-smtp.eu-west-1.amazonaws.com', 'email-smtp.us-east-1.amazonaws.com',
];
const DEVDB = {
  host: (LOCAL.devdb || {}).host || '',
  port: String((LOCAL.devdb || {}).port || '5432'),
  db: (LOCAL.devdb || {}).database || 'postgres',
  user: (LOCAL.devdb || {}).user || '',
};
function devdbPassword() {
  return fs.readFileSync(CFG.devdbPasswordFile, 'utf8').split(/\r?\n/)[0].trim();
}
// psql through the local postgres container (no psql on Windows). The password is passed by
// environment name only, never on a command line.
function psql(conn, sql) {
  const host = conn.host === 'db' ? 'localhost' : conn.host;
  return run('docker', ['exec', '-e', 'PGPASSWORD', 'core_api_postgres', 'psql', '-h', host, '-p', String(conn.port || 5432),
    '-U', conn.user, '-d', conn.db, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { env: { ...process.env, PGPASSWORD: conn.password } });
}
async function appDbConn() {
  const r = await docker('inspect', 'core_api_app', '--format', '{{json .Config.Env}}');
  if (r.code !== 0) return null;
  const env = Object.fromEntries(JSON.parse(r.out).map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]));
  return { host: env.DB_HOST, port: env.DB_PORT, db: env.DB_DATABASE, user: env.DB_USERNAME, password: env.DB_PASSWORD };
}
async function writeMailBlock(j) {
  const hosts = new Set(KNOWN_SMTP_HOSTS);
  let warn = [];
  if (fs.existsSync(CFG.devdbPasswordFile)) {
    const r = await psql({ ...DEVDB, password: devdbPassword() }, 'select distinct lower(trim(host)) from email_settings where host is not null and trim(host) <> \'\'');
    if (r.code !== 0) throw new Error('Could not read the SMTP hosts from the dev DB, so real emails could not be blocked. Not starting.');
    for (const h of r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
      if (/^[\d.]+$|:/.test(h)) warn.push(h); else if (!['mailhog', 'mailpit', 'localhost'].includes(h)) hosts.add(h);
    }
  }
  const yml = ['# Written by the launcher on every backend start: SMTP hosts from email_settings -> 127.0.0.1.',
    'services:', '    app:', '        extra_hosts:', ...[...hosts].sort().map((h) => `            - "${h}:127.0.0.1"`), ''].join('\n');
  fs.writeFileSync(MAILBLOCK_FILE, yml);
  j.log.push(`Blocked ${hosts.size} SMTP host(s) inside the API container; emails are relayed to MailHog instead.`);
  if (warn.length) j.log.push(`⚠ These SMTP hosts are IP addresses and cannot be blocked by name: ${warn.join(', ')}`);
}

const relay = { logFile: null, offset: 0, queue: new Map(), done: new Set(), count: 0, last: null, error: null, mode: null };
function relayReset(dir, mode) {
  relay.logFile = path.join(dir, 'storage', 'logs', 'laravel.log');
  relay.offset = fs.existsSync(relay.logFile) ? fs.statSync(relay.logFile).size : 0;
  relay.queue.clear();
  relay.mode = mode;
  relay.error = null;
}
function readNewLogIds() {
  if (!relay.logFile || !fs.existsSync(relay.logFile)) return;
  const size = fs.statSync(relay.logFile).size;
  if (size < relay.offset) relay.offset = 0; // rotated
  if (size === relay.offset) return;
  const fd = fs.openSync(relay.logFile, 'r');
  const buf = Buffer.alloc(Math.min(size - relay.offset, 5 * 1024 * 1024));
  fs.readSync(fd, buf, 0, buf.length, relay.offset);
  fs.closeSync(fd);
  relay.offset += buf.length;
  for (const m of buf.toString('utf8').matchAll(/email_entry_created \{[^\n]*?"id":(\d+)/g)) {
    if (!relay.done.has(m[1])) relay.queue.set(m[1], Date.now());
  }
}
function b64lines(s) { return Buffer.from(s, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n'); }
const hdr = (s) => `=?UTF-8?B?${Buffer.from(String(s || ''), 'utf8').toString('base64')}?=`;
function smtpSend(rcpts, raw) {
  const net = require('net');
  return new Promise((resolve, reject) => {
    const sock = net.connect(1025, '127.0.0.1');
    const cmds = ['HELO launcher.local', 'MAIL FROM:<launcher@circuly.local>', ...rcpts.map((r) => `RCPT TO:<${r}>`), 'DATA', `${raw}\r\n.`, 'QUIT'];
    let buf = '';
    sock.setTimeout(10000, () => { sock.destroy(); reject(new Error('MailHog timeout')); });
    sock.on('error', reject);
    sock.on('data', (d) => {
      buf += d.toString();
      while (buf.includes('\n')) {
        const line = buf.slice(0, buf.indexOf('\n')); buf = buf.slice(buf.indexOf('\n') + 1);
        if (/^\d{3}-/.test(line)) continue; // multi-line reply
        if (/^[45]/.test(line)) { sock.destroy(); return reject(new Error(`MailHog: ${line.trim()}`)); }
        const next = cmds.shift();
        if (next === undefined) { sock.end(); return resolve(); }
        sock.write(`${next}\r\n`);
      }
    });
    sock.on('close', () => resolve());
  });
}
async function relayTick() {
  try {
    readNewLogIds();
    const ready = [...relay.queue.entries()].filter(([, t]) => Date.now() - t > 4000).map(([id]) => id);
    if (!ready.length) return;
    const conn = await appDbConn();
    if (!conn) return;
    const r = await psql(conn, `select coalesce(json_agg(e), '[]') from (select id, company_id, template_id, "to", cc, subject, body, success, error, created_at from email_entries where id in (${ready.map(Number).join(',')})) e`);
    if (r.code !== 0) throw new Error(r.out.trim().split('\n').pop());
    for (const e of JSON.parse(r.out.trim() || '[]')) {
      relay.queue.delete(String(e.id));
      relay.done.add(String(e.id));
      // Local Docker DB: mails that reached MailHog directly are already there.
      if (relay.mode === 'local' && e.success === true) continue;
      const to = [...(e.to || []), ...(e.cc || [])].map(String).filter((x) => /^[^\s<>@]+@[^\s<>@]+$/.test(x));
      if (!to.length) continue;
      const raw = [
        `From: ${hdr('Circuly (local copy)')} <launcher@circuly.local>`,
        `To: ${(e.to || []).join(', ')}`,
        e.cc && e.cc.length ? `Cc: ${e.cc.join(', ')}` : null,
        `Subject: ${hdr(e.subject)}`,
        `Date: ${new Date(e.created_at + 'Z').toUTCString()}`,
        `X-Circuly-Email-Entry: ${e.id}`,
        `X-Circuly-Company: ${e.company_id || ''}`,
        `X-Circuly-Template: ${e.template_id || ''}`,
        `X-Circuly-Real-Send: ${e.success ? 'SUCCEEDED - check the SMTP block' : 'blocked'}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        b64lines(e.body || ''),
      ].filter((x) => x !== null).join('\r\n');
      await smtpSend(to, raw);
      relay.count += 1;
      relay.last = { subject: e.subject, to: (e.to || []).join(', '), at: Date.now() };
    }
    // Rows that never showed up (rolled back) are dropped after a minute.
    for (const [id, t] of relay.queue) if (Date.now() - t > 60000) relay.queue.delete(id);
    relay.error = null;
  } catch (e) {
    relay.error = e.message;
  }
}
let relayBusy = false;
setInterval(async () => { if (relayBusy) return; relayBusy = true; await relayTick(); relayBusy = false; }, 3000);
async function waitForApi(j, seconds = 180) {
  j.log.push('Waiting for http://localhost:8000 …');
  for (let t = 0; t < seconds; t += 3) {
    const v = await apiVersion(true);
    if (v.up) { j.log.push(`API is up · ${v.database}`); return; }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('The API did not answer within 3 minutes (docker logs core_api_app).');
}
async function checkMigrations(j) {
  const r = await run('docker', ['exec', 'core_api_app', 'php', 'artisan', 'migrate:status', '--pending', '--no-ansi'], { log: null });
  const list = [];
  for (const line of r.out.split(/\r?\n/)) {
    const m = line.match(/^\s*(\S+)\s+\.+\s*Pending/);
    // Telescope is switched off in this setup, so its table never matters.
    if (m && !m[1].includes('telescope')) list.push(m[1]);
  }
  pendingMigrations = list;
  if (j) j.log.push(list.length ? `⚠ ${list.length} migration(s) on this branch are not in the database: ${list.join(', ')}` : 'Database has every migration this branch knows about.');
}
function backendEnv(dev) {
  const env = { ...process.env };
  env.CIRCULY_OIDC_SIGNING_KEY = fs.readFileSync(path.join(HERE, 'oidc-signing-key.pem')).toString('base64');
  if (dev) {
    if (!fs.existsSync(CFG.devdbPasswordFile)) throw new Error(`Password file not found: ${CFG.devdbPasswordFile}`);
    env.CIRCULY_DEVDB_PASSWORD = fs.readFileSync(CFG.devdbPasswordFile, 'utf8').split(/\r?\n/)[0].trim();
    env.CIRCULY_DEVDB_HOST = DEVDB.host;
    env.CIRCULY_DEVDB_PORT = DEVDB.port;
    env.CIRCULY_DEVDB_DATABASE = DEVDB.db;
    env.CIRCULY_DEVDB_USER = DEVDB.user;
  }
  return env;
}
function startBackend() {
  const branch = settings.backendBranch;
  const dev = settings.db === 'dev';
  assertBranch('backend', branch);
  startJob(`Start backend · ${branch} · ${dev ? 'dev DB' : 'local DB'}`, async (j) => {
    const { dir } = await ensureFolder(j, 'backend', branch);
    const env = backendEnv(dev);
    if (telescopeWanted) writeTelescopeConfig(dir);
    pendingMigrations = null;
    await saveUsedFiles().catch(() => {}); // before the restart empties OPcache
    await run('docker', ['start', 'core_api_postgres']); // psql runs from this container
    await writeMailBlock(j);
    await step(j, 'docker compose up (app, webserver, redis, mailhog, db)', 'docker',
      [...composeArgs(dir, dev), 'up', '-d', '--no-build', '--no-deps', 'app', 'webserver', 'redis', 'mailhog', 'db'], { env });
    if (!fs.existsSync(path.join(dir, 'vendor'))) {
      await step(j, 'composer install (first run of this branch, takes a few minutes)', 'docker',
        ['exec', 'core_api_app', 'composer', 'install', '--no-interaction', '--prefer-dist', '--no-progress']);
    }
    await step(j, 'Clear cached config', 'docker', ['exec', 'core_api_app', 'php', 'artisan', 'optimize:clear']);
    await waitForApi(j);
    relayReset(dir, dev ? 'dev' : 'local');
    await checkMigrations(j);
    warmPhp();
  });
}

// OPcache never checks file timestamps here (php-speed.ini), so code changes need a PHP reload.
function reloadBackendCode() {
  startJob('Reload backend code (PHP)', async (j) => {
    const app = await inspectApp();
    if (app.status !== 'running') throw new Error('The backend is not running.');
    await saveUsedFiles().catch(() => {});
    await step(j, 'Reload PHP-FPM (clears OPcache)', 'docker', ['exec', '-u', 'root', 'core_api_app', 'kill', '-USR2', '1']);
    await step(j, 'Clear cached config, routes and views', 'docker', ['exec', 'core_api_app', 'php', 'artisan', 'optimize:clear']);
    await waitForApi(j, 60);
    warmPhp();
    j.log.push('Warming up in the background (about 1-3 min).');
  });
}

// Compile the backend into OPcache in the background after every start (see launcher/php/warm.php).
// Until it finishes, the first request on each code path can take ~10s, which is longer than the
// apps wait for some calls (Switchboard gives up on a sign-in code request after 10s).
const warm = { state: 'idle', result: null, started: null };
// Merge the scripts real requests used into launcher/php/used-files.txt (read by warm.php).
const USED_FILES = path.join(HERE, 'php', 'used-files.txt');
async function saveUsedFiles() {
  const app = await inspectApp();
  if (app.status !== 'running') return;
  const r = await run('docker', ['exec', 'core_api_app', 'php', '/opt/launcher/fcgi.php', '/opt/launcher/dump.php']);
  if (r.code !== 0) return;
  const set = new Set(fs.existsSync(USED_FILES) ? fs.readFileSync(USED_FILES, 'utf8').split(/\r?\n/).filter(Boolean) : []);
  const before = set.size;
  for (const f of r.out.split(/\r?\n/)) if (/^[\w./-]+\.php$/.test(f)) set.add(f);
  if (set.size !== before) fs.writeFileSync(USED_FILES, [...set].sort().join('\n') + '\n');
}
setInterval(() => { if (warm.state !== 'running') saveUsedFiles().catch(() => {}); }, 5 * 60 * 1000);
async function warmPhp() {
  warm.state = 'running';
  warm.started = Date.now();
  warm.result = null;
  warm.progress = null;
  await run('docker', ['exec', 'core_api_app', 'rm', '-f', '/tmp/launcher-warm']);
  // warm.php writes "done total" to /tmp/launcher-warm as it goes; read it for the progress bar.
  const poll = setInterval(async () => {
    const p = await run('docker', ['exec', 'core_api_app', 'cat', '/tmp/launcher-warm']);
    const m = p.out.match(/^(\d+) (\d+)/);
    if (m && warm.state === 'running') warm.progress = { done: +m[1], total: Math.max(+m[2], +m[1]) };
  }, 3000);
  const r = await run('docker', ['exec', 'core_api_app', 'php', '/opt/launcher/fcgi.php', '/opt/launcher/warm.php']);
  clearInterval(poll);
  warm.state = r.code === 0 && /compiled=/.test(r.out) ? 'done' : 'failed';
  warm.result = r.out.trim().split(/\r?\n/).pop();
  warm.progress = null;
}
function stopBackend() {
  startJob('Stop backend (container back to main folder + local DB)', async (j) => {
    await saveUsedFiles().catch(() => {});
    // Recreate the app container without the dev-DB override, on the main folder, so the backend
    // test suite (which runs inside core_api_app) can never reach the shared dev DB.
    await step(j, 'Reset core_api_app to the local DB', 'docker',
      [...composeArgs(CFG.repos.backend, false, false), 'up', '-d', '--no-build', '--no-deps', 'app']);
    await step(j, 'Stop webserver and mailhog', 'docker',
      [...composeArgs(CFG.repos.backend, false, false), 'stop', 'webserver', 'mailhog']);
    pendingMigrations = null;
  });
}
function migrateLocal() {
  startJob('Run migrations on the LOCAL Docker DB', async (j) => {
    const app = await inspectApp();
    if (app.dbHost !== 'db') throw new Error(`Refused: the API container uses "${app.dbHost}", not the local Docker DB. Migrations are never run on the shared dev DB from here.`);
    await step(j, 'php artisan migrate', 'docker', ['exec', 'core_api_app', 'php', 'artisan', 'migrate', '--force', '--no-ansi']);
    await checkMigrations(j);
  });
}

// ---------- frontend apps ----------
const procs = {}; // id -> { child, dir, branch, log, started }
async function probe(port) {
  try {
    const res = await fetch(`http://localhost:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(2500) });
    return res.status;
  } catch { return 0; }
}
function runningFrontendDir() {
  const p = Object.values(procs).find((x) => x.child && x.child.exitCode === null);
  return p ? p.dir : null;
}
// A dev server that was killed mid-write can leave its .nuxt / Vite cache in a state that makes
// Node crash with an access violation (exit 0xC0000005) on the first request. Rebuilding fixes it.
const ACCESS_VIOLATION = 3221225477;
async function repairApp(id, log) {
  const app = APPS[id];
  const dir = procs[id] ? procs[id].dir : (await folderFor('frontend', settings.frontendBranch)).dir;
  const appDir = path.join(dir, 'apps', app.pkg);
  log.push(`▶ Repair ${app.name}: clearing .nuxt and the Vite cache, then nuxt prepare`);
  for (const d of ['.nuxt', path.join('node_modules', '.cache')]) {
    fs.rmSync(path.join(appDir, d), { recursive: true, force: true });
  }
  const r = await run('cmd.exe', ['/d', '/s', '/c', `""..\\..\\node_modules\\.bin\\dotenv.cmd" -e ${path.basename(app.env)} -- "node_modules\\.bin\\nuxt.cmd" prepare"`],
    { cwd: appDir, env: nodeEnv(), log, verbatim: true });
  if (r.code !== 0) throw new Error(`nuxt prepare failed for ${app.name}`);
}
async function startApp(id, { attempt = 0 } = {}) {
  const restarted = attempt > 0;
  const app = APPS[id];
  if (!app) throw new Error('Unknown app');
  if (procs[id] && procs[id].child.exitCode === null) return;
  const branch = settings.frontendBranch;
  assertBranch('frontend', branch);
  const f = await folderFor('frontend', branch);
  if (!fs.existsSync(path.join(f.dir, 'node_modules'))) throw new Error(`Frontend "${branch}" is not prepared yet. Click "Prepare frontend branch" first.`);
  const other = runningFrontendDir();
  if (other && other.toLowerCase() !== f.dir.toLowerCase()) throw new Error('Other apps are running from a different frontend branch. Stop them first (Stop all).');
  if (await probe(app.port)) throw new Error(`Port ${app.port} is already in use by another program.`);
  const log = restarted && procs[id] ? procs[id].log : [];
  // Every fresh start begins from a clean .nuxt and build cache (~25s). Started on a cache left by an
  // earlier run, the dev server crashed (0xC0000005) on its first request nearly every time, which
  // cost a full 2-minute build before the restart. (Also, `nuxt dev` does not regenerate
  // .nuxt/tsconfig.server.json, which repairApp's `nuxt prepare` writes.)
  if (!restarted) {
    procs[id] = { child: { exitCode: 0, pid: 0 }, dir: f.dir, branch, log, repairing: true };
    try { await repairApp(id, log); } finally { procs[id].repairing = false; }
  }
  const cmdline = `"node_modules\\.bin\\dotenv.cmd" -e ${app.env} -- corepack pnpm --filter ${app.pkg} dev`;
  const child = spawn('cmd.exe', ['/d', '/s', '/c', `"${cmdline}"`], { cwd: f.dir, env: nodeEnv(), windowsHide: true, windowsVerbatimArguments: true });
  const entry = { child, dir: f.dir, branch, log, started: Date.now(), stopping: false, repairing: false };
  child.stdout.on('data', (d) => pushLines(log, d));
  child.stderr.on('data', (d) => pushLines(log, d));
  child.on('close', async (code) => {
    log.push(`— process exited (${code}) —`);
    savePids();
    // First crash: just restart (keeps the build cache, much faster). Second: clear the cache. Then give up.
    if (code === ACCESS_VIOLATION && !entry.stopping && attempt < 2) {
      entry.repairing = true;
      try {
        if (attempt === 1) await repairApp(id, log);
        else log.push('▶ Crashed; restarting (build cache kept)');
        await startApp(id, { attempt: attempt + 1 });
      } catch (e) {
        log.push(`✖ Repair failed: ${e.message}`);
      } finally {
        entry.repairing = false;
      }
    }
  });
  procs[id] = entry;
  savePids();
}
// PIDs of the app processes, so a launcher that crashed or was killed does not leave dev servers
// behind holding the .nuxt and cache folders (two Hubs on one folder break each other).
const PIDS_FILE = path.join(HERE, 'pids.json');
function savePids() {
  const pids = Object.values(procs).filter((p) => p.child.exitCode === null).map((p) => p.child.pid);
  try { fs.writeFileSync(PIDS_FILE, JSON.stringify(pids)); } catch { /* ignore */ }
}
async function killLeftovers() {
  const pids = readJson(PIDS_FILE, []).filter((p) => Number.isInteger(p));
  if (!pids.length) return;
  // Only kill a saved PID if it is still a dev-server process (PIDs get reused).
  const r = await run('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { @(${pids.join(',')}) -contains $_.ProcessId } | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`]);
  for (const line of r.out.split(/\r?\n/)) {
    const [pid, cmd] = [line.slice(0, line.indexOf('|')), line.slice(line.indexOf('|') + 1)];
    if (pid && /dotenv|pnpm|nuxt/i.test(cmd)) { await killTree(pid); console.log(`Stopped a leftover app process (${pid}).`); }
  }
  fs.writeFileSync(PIDS_FILE, '[]');
}
function killTree(pid) {
  return run('taskkill', ['/PID', String(pid), '/T', '/F']);
}
async function stopApp(id) {
  queued.delete(id);
  const p = procs[id];
  if (p && p.child.exitCode === null) { p.stopping = true; return killTree(p.child.pid); }
  // Left over from an earlier launcher session: stop whatever listens on the app's port.
  const r = await run('netstat', ['-ano', '-p', 'TCP']);
  const re = new RegExp(`^\\s*TCP\\s+\\S+:${APPS[id].port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, 'i');
  for (const line of r.out.split(/\r?\n/)) {
    const m = line.match(re);
    if (m && m[1] !== '0') await killTree(m[1]);
  }
}
async function appStatus(id) {
  const app = APPS[id];
  const p = procs[id];
  const alive = !!(p && p.child.exitCode === null);
  const code = await probe(app.port);
  // CSS and POS open on their sign-in page for the chosen company, as on css/pos.development.circuly.io.
  const q = app.company && settings.companyId ? `/en/auth/login?company_id=${encodeURIComponent(settings.companyId)}` : '/';
  const url = `http://localhost:${app.port}${q}`;
  let state = 'stopped';
  if (alive) {
    // Once the server has answered, a slow probe (it is busy building) does not mean "starting" again.
    if (code && code !== 503) p.listened = true;
    state = !p.listened ? 'starting' : p.ready ? 'running' : 'compiling';
    if (state === 'compiling' && !p.warming) warmApp(p, url);
  } else if (p && p.repairing) state = 'repairing';
  else if (code) state = 'external';
  else if (queued.has(id)) state = 'queued';
  // One percentage across the whole start: the dev server's own build steps (read from its log)
  // take it to 45%, loading the page modules (counted) the rest.
  let progress = null;
  if (state === 'starting' || state === 'repairing') {
    const since = p.log.findLastIndex((l) => /^(— process exited|▶ )/.test(l));
    const text = p.log.slice(since + 1).join('\n');
    let percent = state === 'repairing' ? 3 : 5;
    for (const [re, v] of [[/Nitro \d/, 12], [/Vite client built/, 22], [/Vite server built/, 32], [/Nitro server built/, 45]]) if (re.test(text)) percent = v;
    progress = { percent };
  } else if (state === 'compiling') {
    const f = p.progress && p.progress.total > 1 ? p.progress : null;
    progress = { percent: 45 + (f ? Math.floor((f.done / f.total) * 54) : 0), done: f ? f.done : 0, total: f ? f.total : 0 };
  }
  // The module total grows as imports are discovered; never let the shown percentage go backwards.
  if (progress && p) progress.percent = p.maxPercent = Math.max(p.maxPercent || 0, progress.percent);
  const autoStopped = state === 'stopped' && !!(p && p.autoStopped);
  return { id, name: app.name, port: app.port, state, branch: alive ? p.branch : null, url, progress, autoStopped };
}
// Four dev servers building at once crashed each other (0xC0000005, several restarts each) and took
// ~7 minutes. One at a time: the next app starts once the previous one has finished its server build.
// Each dev server holds 1.5-2.5 GB. An app nobody has open is stopped after settings.autoStopMinutes.
// An open browser tab keeps a connection to its app (Vite's live-reload socket), so "in use" means
// some other process has an established connection to the app's port.
setInterval(async () => {
  if (!settings.autoStopMinutes) return;
  const live = Object.entries(procs).filter(([, p]) => p.child.exitCode === null && p.ready);
  if (!live.length) return;
  const r = await run('netstat', ['-ano', '-p', 'tcp']);
  const own = new Set([process.pid, ...live.map(([, p]) => p.child.pid)]);
  const used = new Set();
  for (const line of r.out.split(/\r?\n/)) {
    const m = line.trim().split(/\s+/);
    if (m[3] !== 'ESTABLISHED' || own.has(+m[4])) continue;
    used.add(+m[2].split(':').pop());
  }
  for (const [id, p] of live) {
    if (used.has(APPS[id].port)) { p.lastUsed = Date.now(); continue; }
    const idle = Date.now() - (p.lastUsed || p.readyAt || Date.now());
    if (idle > settings.autoStopMinutes * 60000) {
      p.log.push(`— stopped automatically: no browser tab open for ${settings.autoStopMinutes} min —`);
      p.autoStopped = true;
      stopApp(id).catch(() => {});
    }
  }
}, 60000);
const queued = new Set();
async function startAllStaged() {
  const ids = [];
  for (const id of Object.keys(APPS)) if ((await appStatus(id)).state === 'stopped') ids.push(id);
  ids.forEach((id) => queued.add(id));
  for (const id of ids) {
    if (!queued.has(id)) continue; // stopped while waiting
    queued.delete(id);
    await startApp(id);
    const until = Date.now() + 180000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = (await appStatus(id)).state;
      if (st === 'compiling' || st === 'running' || st === 'stopped') break;
    }
  }
}
// A Nuxt dev server answers as soon as it listens, but builds each page on its first visit (about a
// minute). Loading the start page once, following redirects to the sign-in page, does that build, so
// "running" means the app opens quickly.
// The browser then loads ~2,000 separate modules that Vite transforms on first request, which takes
// a minute or more with a blank page. So the launcher also walks the module graph (every "/_nuxt/…"
// import, recursively) once; that fills Vite's cache and gives a real progress count.
function warmApp(p, url) {
  p.warming = true;
  p.progress = { done: 0, total: 1, phase: 'server' };
  (async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
    const html = await res.text();
    if (res.status >= 500) return;
    const origin = new URL(url).origin;
    const seen = new Set();
    const queue = [];
    const add = (src) => {
      const clean = src.replace(/&amp;/g, '&');
      if (!clean.startsWith('/_nuxt/') || seen.has(clean)) return;
      // Test files sit next to pages (app/pages/**/__test__). Requesting one makes Vite fail and show
      // an error overlay in every open tab of the app, so they are never fetched.
      if (/\/__tests?__\/|\.(spec|test)\.[cm]?[jt]sx?(\?|$)/.test(clean)) return;
      seen.add(clean);
      queue.push(clean);
    };
    const IMPORTS = /(?:import|from|export\s*\*\s*from)\s*\(?\s*["'](\/_nuxt\/[^"']+)["']/g;
    for (const m of html.matchAll(/(?:src|href)="(\/_nuxt\/[^"]+)"/g)) add(m[1]);
    p.progress.phase = 'browser';
    const worker = async () => {
      while (queue.length) {
        const src = queue.shift();
        try {
          const r = await fetch(origin + src, { signal: AbortSignal.timeout(120000) });
          const body = await r.text();
          if (/javascript|typescript/.test(r.headers.get('content-type') || '')) for (const m of body.matchAll(IMPORTS)) add(m[1]);
        } catch { /* one module failing does not block the rest */ }
        p.progress.done++;
        p.progress.total = seen.size;
      }
    };
    // Workers exit when the queue is momentarily empty, so loop until nothing new was found.
    while (queue.length) await Promise.all(Array.from({ length: 8 }, worker));
    p.ready = true;
    p.readyAt = Date.now();
  })()
    .catch(() => {})
    .finally(() => { p.warming = false; });
}
function prepareFrontend(install) {
  const branch = settings.frontendBranch;
  assertBranch('frontend', branch);
  startJob(`${install ? 'Install dependencies' : 'Prepare frontend'} · ${branch}`, async (j) => {
    const { dir } = await ensureFolder(j, 'frontend', branch);
    if (install || !fs.existsSync(path.join(dir, 'node_modules'))) {
      await step(j, 'pnpm install (1-4 min)', 'cmd.exe', ['/d', '/c', 'corepack pnpm install'], { cwd: dir, env: nodeEnv() });
    } else {
      j.log.push('Dependencies already installed.');
    }
  });
}

// ---------- git actions ----------
function fetchAll() {
  startJob('Refresh branches (git fetch)', async (j) => {
    for (const kind of ['backend', 'frontend']) {
      await step(j, `git fetch ${kind}`, 'git', ['-C', CFG.repos[kind], 'fetch', '--prune', 'origin']);
      await listBranches(kind);
    }
  });
}
function pullLatest(kind) {
  const branch = kind === 'backend' ? settings.backendBranch : settings.frontendBranch;
  assertBranch(kind, branch);
  startJob(`Pull latest ${kind} · ${branch}`, (j) => pullSteps(j, kind, branch));
}
// The "Pull backend + frontend" button. Both are tried even if one fails; the job fails if either did.
function pullAll() {
  assertBranch('backend', settings.backendBranch);
  assertBranch('frontend', settings.frontendBranch);
  startJob(`Pull latest backend · ${settings.backendBranch} + frontend · ${settings.frontendBranch}`, async (j) => {
    const failed = [];
    for (const kind of ['backend', 'frontend']) {
      j.log.push(`━━ ${kind} ━━`);
      try {
        await pullSteps(j, kind, kind === 'backend' ? settings.backendBranch : settings.frontendBranch);
      } catch (e) {
        failed.push(kind);
        j.log.push(`✖ ${kind}: ${e.message}`);
      }
    }
    if (failed.length) throw new Error(`Pull failed for ${failed.join(' and ')} (see above).`);
  });
}
async function pullSteps(j, kind, branch) {
  {
    const f = await folderFor(kind, branch);
    if (!fs.existsSync(f.dir)) throw new Error('That branch has no folder yet; it is created on first start.');
    if (f.isMain) {
      await step(j, 'git pull --ff-only', 'git', ['-C', f.dir, 'pull', '--ff-only']);
    } else {
      await step(j, 'git fetch', 'git', ['-C', CFG.repos[kind], 'fetch', 'origin', branch]);
      await step(j, `checkout origin/${branch}`, 'git', ['-C', f.dir, 'checkout', '--detach', `origin/${branch}`]);
    }
    if (kind === 'frontend') j.log.push('If package.json changed, click "Install dependencies".');
    if (kind === 'backend') {
      const b = await backendStatus();
      if (b.api && b.api.up && b.folder && b.folder.toLowerCase() === f.dir.toLowerCase()) {
        await saveUsedFiles().catch(() => {});
        await step(j, 'Reload PHP so the new code is used', 'docker', ['exec', '-u', 'root', 'core_api_app', 'kill', '-USR2', '1']);
        await step(j, 'Clear cached config, routes and views', 'docker', ['exec', 'core_api_app', 'php', 'artisan', 'optimize:clear']);
        await waitForApi(j, 60);
        await checkMigrations(j);
        warmPhp();
      }
      j.log.push('If composer.json changed, restart the backend from a fresh folder or run composer install.');
    }
  }
}
function removeFolder(kind) {
  const branch = kind === 'backend' ? settings.backendBranch : settings.frontendBranch;
  assertBranch(kind, branch);
  startJob(`Remove ${kind} folder · ${branch}`, async (j) => {
    const f = await folderFor(kind, branch);
    if (f.isMain) throw new Error('This is your main folder; it is never removed.');
    if (kind === 'frontend' && runningFrontendDir()?.toLowerCase() === f.dir.toLowerCase()) throw new Error('Stop the apps first.');
    if (kind === 'backend') {
      const b = await backendStatus();
      if (b.folder && b.folder.toLowerCase() === f.dir.toLowerCase()) throw new Error('The backend is running from this folder. Stop it first.');
    }
    // No --force: git refuses when the folder has uncommitted changes.
    await step(j, 'git worktree remove', 'git', ['-C', CFG.repos[kind], 'worktree', 'remove', f.dir]);
    delete worktreeBranches[path.resolve(f.dir).toLowerCase()];
    persist();
  });
}

// ---------- HTTP ----------
async function status() {
  const [backend, apps, bRepo, fRepo] = await Promise.all([
    backendStatus(),
    Promise.all(Object.keys(APPS).map(appStatus)),
    repoInfo('backend', settings.backendBranch),
    repoInfo('frontend', settings.frontendBranch),
  ]);
  const mail = await probe(8025);
  return {
    settings, backend, apps, repos: { backend: bRepo, frontend: fRepo }, mailhog: mail !== 0,
    relay: { count: relay.count, last: relay.last, error: relay.error, active: !!relay.logFile },
    warm: { state: warm.state, result: warm.result, progress: warm.progress || null, seconds: warm.started ? Math.round((Date.now() - warm.started) / 1000) : null },
    job: job && { title: job.title, status: job.status, log: job.log.slice(-200) },
  };
}
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  // Only this machine, and only pages served from this launcher (blocks DNS-rebinding / CSRF).
  const host = (req.headers.host || '').split(':')[0];
  if (!['localhost', '127.0.0.1'].includes(host)) return send(res, 403, { error: 'forbidden' });
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, fs.readFileSync(path.join(HERE, 'index.html')), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, await status());
    if (req.method === 'GET' && url.pathname === '/api/branches') {
      return send(res, 200, { backend: branchCache.backend, frontend: branchCache.frontend });
    }

    if (req.method !== 'POST' || req.headers['x-launcher'] !== '1') return send(res, 404, { error: 'not found' });
    const body = await readBody(req);
    const p = url.pathname;
    if (p === '/api/settings') {
      if (body.backendBranch !== undefined) { assertBranch('backend', body.backendBranch); settings.backendBranch = body.backendBranch; }
      if (body.frontendBranch !== undefined) { assertBranch('frontend', body.frontendBranch); settings.frontendBranch = body.frontendBranch; }
      if (body.db !== undefined) settings.db = body.db === 'local' ? 'local' : 'dev';
      if (body.companyId !== undefined) settings.companyId = String(body.companyId).trim().slice(0, 64);
      if (body.autoStopMinutes !== undefined) settings.autoStopMinutes = [0, 10, 30, 60, 120].includes(+body.autoStopMinutes) ? +body.autoStopMinutes : 10;
      persist();
    } else if (p === '/api/backend/start') startBackend();
    else if (p === '/api/backend/stop') stopBackend();
    else if (p === '/api/backend/migrate') migrateLocal();
    else if (p === '/api/backend/reload') reloadBackendCode();
    else if (p === '/api/telescope') setTelescope(!!body.on);
    else if (p === '/api/backend/check-migrations') await checkMigrations(null);
    else if (p === '/api/frontend/prepare') prepareFrontend(false);
    else if (p === '/api/frontend/install') prepareFrontend(true);
    else if (p === '/api/git/fetch') fetchAll();
    else if (p === '/api/git/pull-all') pullAll();
    else if (p === '/api/git/pull')pullLatest(body.kind === 'frontend' ? 'frontend' : 'backend');
    else if (p === '/api/git/remove') removeFolder(body.kind === 'frontend' ? 'frontend' : 'backend');
    else if (p === '/api/apps/stop-all') await Promise.all(Object.keys(APPS).map(stopApp));
    else {
      const a = p.match(/^\/api\/app\/(\w+)\/(start|stop|repair)$/);
      if (!a || !APPS[a[1]]) return send(res, 404, { error: 'not found' });
      if (a[2] === 'start') await startApp(a[1]);
      else if (a[2] === 'stop') await stopApp(a[1]);
      else {
        if (procs[a[1]] && procs[a[1]].child.exitCode === null) throw new Error('Stop the app before repairing it.');
        const log = procs[a[1]] ? procs[a[1]].log : [];
        await repairApp(a[1], log);
      }
    }
    return send(res, 200, { ok: true });
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
});

// Closing the launcher window (SIGHUP on Windows), Ctrl+C or Ctrl+Break stops the apps it started.
async function shutdown() {
  await Promise.all(Object.values(procs).filter((p) => p.child.exitCode === null).map((p) => killTree(p.child.pid)));
  savePids();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGBREAK', shutdown);
process.on('SIGHUP', shutdown);

// Backend already running from an earlier launcher session: pick up the email relay again.
backendStatus().then((b) => {
  if (b.api && b.api.up && b.folder && fs.existsSync(b.folder)) relayReset(b.folder, b.db);
}).catch(() => {});

Promise.all([listBranches('backend'), listBranches('frontend'), killLeftovers().catch(() => {})]).then(() => {
  server.listen(CFG.port, '127.0.0.1', () => console.log(`Circuly launcher on http://localhost:${CFG.port}  (close this window to stop the apps)`));
  // The backend always comes up with the launcher; apps are started by hand, one at a time.
  apiVersion(true).then((v) => { if (!v.up) try { startBackend(); } catch (e) { console.log(e.message); } });
});
