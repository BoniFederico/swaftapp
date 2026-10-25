---
title: Building from source
layout: default
nav_order: 9
---

# Building from source
{: .no_toc }

Run Swaft from a clone, run its tests, and build the installers yourself. If you only want to use
the app, [download an installer](installation.md) instead.
{: .fs-6 .fw-300 }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| [Node.js](https://nodejs.org/) | **20 LTS or newer** (`.nvmrc` pins 20) | Node 22 and 24 also work. |
| npm | **10 or newer** | Bundled with Node 20+. |
| [Git](https://git-scm.com/) | any recent | Needed to clone the repo; at runtime only for Git workspaces. |

There are **no native modules to compile** (SQLite runs as WebAssembly via `sql.js`), so no C/C++
toolchain or Python is needed. The first `npm ci` downloads the Electron binary (~100 MB), so it
needs network access.

**Linux only** — Electron needs a few desktop libraries. On Debian/Ubuntu:

```bash
sudo apt-get install -y libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2t64 libxss1 libxtst6
```

(`libasound2t64` is called `libasound2` before Ubuntu 24.04.) To keep secrets properly encrypted,
also run a keyring such as GNOME Keyring or KWallet — see
[Troubleshooting](troubleshooting.md#linux-secrets-are-only-obfuscated).

## Run the app in development

```bash
git clone https://github.com/BoniFederico/swaftapp.git
cd swaftapp
npm ci            # exact dependency versions from package-lock.json
npm run dev       # Electron + Vite with hot reload (alias: npm run see)
```

A Swaft window opens on the homepage. Renderer changes reload instantly; main-process changes
restart the app. There is no account or sign-in.

**Try it with the demo workspace:** on the homepage choose **Open → From folder** and
select `examples/demo-workspace` from your clone (see [`examples/`](https://github.com/BoniFederico/swaftapp/tree/main/examples)).
Working on a copy keeps your clone clean.

{: .note }
> The development app uses the same profile folder as an installed Swaft (preferences, recent
> workspaces, secrets): `%APPDATA%\@swaft\desktop` on Windows,
> `~/Library/Application Support/@swaft/desktop` on macOS, `~/.config/@swaft/desktop` on Linux. To
> use a throwaway profile, set `SWAFT_USER_DATA_DIR` (see [Environment variables](#environment-variables)).

## Run a production build locally

```bash
npm run build     # bundle main, preload and renderer into apps/desktop/out/
npm start         # launch that build (electron-vite preview)
```

This is what the installers contain, minus the packaging.

## Build the installers

```bash
npm run dist      # installer(s) for the current OS → apps/desktop/release/
npm run dist:dir  # unpacked app only (faster; good for a quick check)
```

electron-builder only builds for the OS it runs on:

| OS | Output in `apps/desktop/release/` |
|----|-----------------------------------|
| Windows | `Swaft-<version>-setup.exe` (NSIS installer), `win-unpacked/` |
| macOS | `Swaft-<version>-arm64.dmg`, `Swaft-<version>-x64.dmg` |
| Linux | `Swaft-<version>-x86_64.AppImage`, `swaft_<version>_amd64.deb` |

Local builds are **not code-signed**. On macOS, building without a signing identity needs
`CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist`. Official releases are built by CI for all three
platforms — see [the release process](https://github.com/BoniFederico/swaftapp/blob/main/docs/dev/releasing.md).

## Scripts

All scripts run from the repository root.

| Script | What it does |
|--------|--------------|
| `npm run dev` (`npm run see`) | Run the app in development with hot reload. |
| `npm run build` | Production build into `apps/desktop/out/`. |
| `npm start` | Launch the production build. |
| `npm run dist` | Build installers for the current OS with electron-builder. |
| `npm run dist:dir` | Build the unpacked app only. |
| `npm run typecheck` | TypeScript checks for `packages/shared` and `apps/desktop`. |
| `npm run lint` | ESLint over the repo. |
| `npm run format` | Format everything with Prettier. |
| `npm test` | Vitest unit and component tests. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run e2e` | Playwright-for-Electron end-to-end tests (run `npm run build` first). |
| `npm run verify` | `typecheck` + `lint` + `test`: the gate every PR must pass. |
| `npm run screenshots` | Rebuild and regenerate the documentation screenshots in `docs/assets/screenshots/`. |

## Tests

```bash
npm run verify                     # what CI runs on every pull request
npm run build && npm run e2e       # end-to-end: launches the real app (also run by CI)
```

- **Unit and component tests** (Vitest) sit next to the code as `*.test.ts(x)`: the `node` project
  covers `packages/` and the main process, and the `dom` project (jsdom) covers the React renderer.
- **Two heavy renderer suites** (`workspace.test.tsx`, `api.test.tsx`) are excluded by default
  because they can hang the jsdom worker on some machines. Opt in with
  `SWAFT_RUN_HEAVY_TESTS=1 npm test`.
- **End-to-end tests** (`e2e/`) launch the built app with a throwaway profile, check the homepage
  and open the demo workspace. On a Linux machine without a display, run them under a virtual X
  server: `xvfb-run --auto-servernum npm run e2e`.
- **The demo workspace** in `examples/demo-workspace/` is produced by the app's own services, and a
  test reopens it on every run, so it can't drift from the on-disk format. To regenerate it:

  ```bash
  SWAFT_WRITE_DEMO=1 npx vitest run apps/desktop/src/main/workspace/demo-workspace.test.ts
  ```

  In PowerShell: `$env:SWAFT_WRITE_DEMO='1'; npx vitest run apps/desktop/src/main/workspace/demo-workspace.test.ts`.

## Environment variables

| Variable | Effect |
|----------|--------|
| `SWAFT_USER_DATA_DIR` | Use this folder as the app profile instead of the OS default (tests use it for isolation). |
| `SWAFT_RUN_HEAVY_TESTS=1` | Include the two heavy jsdom suites in `npm test`. |
| `SWAFT_WRITE_DEMO=1` | Regenerate `examples/demo-workspace/` (see above). |
| `ELECTRON_RUN_AS_NODE` | Must **not** be set: if it is (some editors set it for their terminals), Electron starts as plain Node and the app does not open. |

## Repository layout

Swaft is an npm-workspaces monorepo:

```
packages/shared     # transport-agnostic op contract (types + Zod schemas) and interchange codecs
apps/desktop        # the Electron application
  src/main          #   main process — the backend authority: IPC router, services, storage, HTTP, git, Seebo
  src/preload       #   contextBridge surface: one allow-listed invoke channel
  src/renderer      #   React + Vite UI
  electron-builder.yml  # installer configuration
e2e                 # Playwright-for-Electron tests
examples            # the demo workspace
scripts             # docs → wiki sync, screenshot capture
docs                # this documentation site (Jekyll + just-the-docs) — also mirrored to the GitHub Wiki
```

How the pieces talk: the renderer never touches Node or the file system. It calls typed **ops**
(`packages/shared/src/ops.ts`) through the preload bridge; the main process validates each request
against its Zod schema, checks the sender and dispatches to a service. Local workspaces are loaded
into an in-memory SQLite database running in a worker thread and written back to disk on save; user
JavaScript runs in a separate utility process.

## Working on the documentation

The docs in `docs/` are the source of both this site and the
[GitHub Wiki](https://github.com/BoniFederico/swaftapp/wiki), so **edit `docs/`, never the wiki**.
Preview the site locally (needs Ruby 3.x and Bundler):

```bash
cd docs
bundle install
bundle exec jekyll serve      # http://localhost:4000/swaftapp/
```

- Pushing changes under `docs/` to `main` redeploys the site
  ([`pages.yml`](https://github.com/BoniFederico/swaftapp/blob/main/.github/workflows/pages.yml)) and
  regenerates the wiki ([`wiki.yml`](https://github.com/BoniFederico/swaftapp/blob/main/.github/workflows/wiki.yml),
  via `scripts/docs-to-wiki.mjs`). Pull requests that touch `docs/` build the site as a check.
- After a UI change, refresh the screenshots with `npm run screenshots`.
