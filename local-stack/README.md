# Circuly Local Stack

A small launcher that runs the Circuly core API and the Hub, CSS, POS and Switchboard apps on
your own PC, on the branches you pick. The API can use the shared dev database or a local Docker
one. Everything is controlled from one page: http://localhost:3999.

New PC? Start with [INSTALL.md](INSTALL.md).

## What it does

- **Backend**: runs `circuly_core_api_lumen` in Docker, on the dev DB (default) or the local
  Docker DB. It starts by itself when the launcher starts.
- **Apps**: Hub (:3000), CSS (:3020), POS (:3030), Switchboard (:3070) from
  `circuly_frontend_mono_v2`. You start only the ones you need. An app with no browser tab open
  is stopped after 10 minutes (change it in the page).
- **Branches**: `development` by default. Another branch runs from its own git worktree under
  `<circulyRoot>\_branches\`, so your main folders are never touched. Nothing is ever pushed.
- **Emails**: no email reaches a real inbox. Every company SMTP server is pointed at 127.0.0.1
  inside the API container and the launcher copies each email into MailHog
  (http://localhost:8025).
- **Telescope**: "Open Telescope" turns it on and shows the API requests. It records requests
  only, into the local Docker DB (never the shared dev DB). "Turn off Telescope" when done.
- **Progress and ready alert**: progress bars while things build, and a sound plus a
  notification when the backend and the started apps are ready.
- **Memory**: Docker is only started when the launcher needs it; two .bat files free memory.

## Daily use

| What | How |
| --- | --- |
| Start | Double-click `Circuly Launcher.bat`. Keep its window open: closing it stops the apps. |
| Hub sign-in | http://localhost:3000/en/auth/oauth-login, code by email (read it in MailHog). Not `/en/auth/login`: that is the old hosted login and sends real emails. |
| CSS / POS | The "Open" button uses `/en/auth/login?company_id=<company ID from the page>`. |
| After editing backend code | "Reload backend code" (PHP caches the code for speed). |
| Get the latest code | "Pull backend + frontend" (fast-forward only). |
| Free memory | `Stop everything (free memory).bat`: stops apps, backend, Docker and its VM. |
| Free memory in other apps | `Free memory (Chrome, VS Code, Slack, Postman).bat`: asks per app, restarts it and clears its cache. Tabs, logins and settings are kept. |

## Structure

```
local-stack/
├── Circuly Launcher.bat                 start here: starts Docker if needed, then the launcher
├── Stop everything (free memory).bat    stops apps, backend, Docker Desktop and its WSL VM
├── Free memory (Chrome, VS Code, Slack, Postman).bat
├── config.example.json                  copy to config.json (git-ignored) and fill in
├── README.md                            this file
├── INSTALL.md                           setting up a new PC
└── launcher/
    ├── server.js                        the launcher: web server on :3999, no npm packages (Node 22)
    ├── index.html                       the page
    ├── docker-compose.speed.yml         added to the backend's compose file: PHP speed settings,
    │                                    in-memory caches, local sign-in key
    ├── docker-compose.devdb.yml         added in Dev DB mode: points the API at the shared dev DB,
    │                                    jobs and cache stay local, mail to MailHog
    ├── docker-compose.telescope.yml     added only while Telescope is on
    ├── php-speed.ini                    OPcache without timestamp checks (Windows mounts are slow)
    ├── php/
    │   ├── fcgi.php                     tiny FastCGI client: runs a script inside PHP-FPM
    │   ├── warm.php                     pre-compiles the backend into OPcache after each start
    │   └── dump.php                     lists the files real requests used (for warm.php)
    ├── stop-everything.ps1              used by "Stop everything (free memory).bat"
    └── free-memory.ps1                  used by "Free memory (...).bat"
```

Made by the launcher on each PC (git-ignored): `config.json`, `launcher/oidc-signing-key.pem`,
`launcher/state.json`, `launcher/pids.json`, `launcher/telescope.php`,
`launcher/docker-compose.mailblock.yml`, `launcher/php/used-files.txt`.

## How it works (short)

- **Backend start**: `docker compose up` of the backend repo's compose file plus the files
  above, `optimize:clear`, wait for `/v1/version`, then warm PHP's code cache in the
  background (the progress shows in the page).
- **App start**: clears `.nuxt` and the build cache and runs `nuxt prepare` first (dev servers
  started on an old cache crash on Windows), then `pnpm --filter <app> dev` through `dotenv`
  with the app's `.env.<app>.local`. When the server answers, the launcher loads every module
  once so your first page load is fast. On a crash it restarts, then repairs, then gives up.
- **Stop backend**: puts the API container back on the local Docker DB, so backend tests run
  later can never reach the shared dev DB.
- **Safety**: the dev DB password is read from a file and passed as an environment variable,
  never shown. The page only answers on localhost.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| App shows a blank page or keeps crashing | Stop it, click "Repair", start again. |
| First requests to the API are slow | The PHP warm-up is still running (see the percentage). |
| API answers HTML instead of JSON | Something else uses port 8000 (`docker ps`). |
| Backend code change not visible | "Reload backend code". |
| Hub `/en/auth/login` sends real mail | Use `/en/auth/oauth-login`. |
