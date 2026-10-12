# Install on a new PC

Windows 10/11, 16 GB RAM recommended (each running app uses 1.5 to 2.5 GB, Docker up to 4 GB).
About 30 minutes, most of it downloads.

## 1. Tools

1. **Git** for Windows, signed in to GitHub with access to the `circuly-dev` repos.
2. **Docker Desktop** with the WSL 2 engine (default). Start it once and finish its setup.
3. **Node 22, portable.** The apps do not run on Node 23 or newer.
   - Download the Windows x64 **zip** of the latest Node 22 from https://nodejs.org/en/download
   - Extract it so that `node.exe` is at `%USERPROFILE%\tools\node22\node.exe`
     (or anywhere else, and put that folder in `config.json` as `node22`).
   - No install and no PATH change needed. pnpm comes through Node's `corepack`.

## 2. Code

```bat
mkdir C:\Circuly\circuly_pro
cd C:\Circuly\circuly_pro
git clone https://github.com/circuly-dev/circuly_core_api_lumen.git
git clone https://github.com/circuly-dev/circuly_frontend_mono_v2.git
git clone https://github.com/zamanqa/test-automation-platform.git
cd circuly_core_api_lumen && git checkout development && cd ..
cd circuly_frontend_mono_v2 && git checkout development && cd ..
```

Another folder than `C:\Circuly\circuly_pro` works too: set `circulyRoot` in `config.json`.

## 3. Backend, once

In `C:\Circuly\circuly_pro\circuly_core_api_lumen`:

```bat
if not exist .env copy .env.local .env
docker compose build
docker compose up -d db redis
```

The launcher runs `composer install` itself the first time.
For the local Docker DB (optional), migrate and seed it as the backend repo describes; the
"Run migrations (local DB)" button in the page does the migrations later.

## 4. Dev DB password

Ask the team for the dev database host, user and password. Save the password as the only line
of a text file, for example `%USERPROFILE%\rds_password.txt`. Do not put it anywhere else.

## 5. Config

In `test-automation-platform\local-stack\`, copy `config.example.json` to `config.json` and fill it in:

| Key | Meaning |
| --- | --- |
| `circulyRoot` | Folder with both repos (default `C:\Circuly\circuly_pro`) |
| `node22` | Folder with Node 22's `node.exe` |
| `companyId` | Company that CSS and POS open (can be changed in the page) |
| `devdb.host`, `devdb.user` | Dev database host and user |
| `devdb.passwordFile` | The file from step 4 |

`%USERPROFILE%` and other `%VARS%` are expanded. `config.json` is git-ignored: never commit it.

## 6. First start

1. Double-click `Circuly Launcher.bat` (make a desktop shortcut to it if you like).
   It starts Docker Desktop if needed, opens http://localhost:3999 and starts the backend.
2. The first backend start pre-compiles the whole backend (about 10 minutes, shown as a
   percentage). After that the launcher remembers which files are used and it takes 1 to 3 minutes.
3. Frontend: click **Install dependencies** (pnpm install, 2 to 5 minutes), then **Start** the
   app you need. The first app start takes about 2 minutes.
4. Allow notifications when the page asks, to get the "ready" alert.

## 7. Optional, for less memory and speed

- **Cap Docker's memory**: create `%USERPROFILE%\.wslconfig`, then run `wsl --shutdown`:

  ```ini
  [wsl2]
  memory=4GB
  processors=4
  swap=2GB
  vmIdleTimeout=60000

  [experimental]
  autoMemoryReclaim=dropcache
  ```

- **Docker only when needed**: Docker Desktop > Settings > General > untick "Start Docker Desktop
  when you sign in". The launcher starts it when needed.
- **Faster builds**: add `C:\Circuly\circuly_pro` and the Node 22 folder to the Windows Defender
  exclusions (Windows Security > Virus & threat protection > Exclusions). Only if your IT allows it.

## Good to know

- Hub, CSS and Switchboard sign-in on the dev DB works because the dev DB has localhost redirect
  URIs for ports 3000, 3020 and 3070 in `auth.oauth_redirect_uris`. If the dev DB is restored
  from production again, these rows must be added again.
- Port 3999 (launcher), 8000 (API), 8025 (MailHog), 5433 (local DB) and 3000/3020/3030/3070
  (apps) must be free.
