# Swaft

**Swaft** ("Strange Web App for Technician") — a desktop-first technical app built on the
[Seebo](docs/seebo/) engine. Electron (main process = Node backend) + React/Vite renderer, hardened
IPC, transport-agnostic API client.

> **Documentation:** see [`docs/swaft/`](docs/swaft/) — start with
> [`README`](docs/swaft/README.md), [`SWAFT_MVP_SCOPE.md`](docs/swaft/SWAFT_MVP_SCOPE.md), and the
> step-by-step build guide [`MVP_STEPS.md`](docs/swaft/MVP_STEPS.md).

## Requirements

- **Node.js 20 LTS recommended.** Electron 33's installer (`extract-zip`) can **silently fail to
  unpack the Electron binary on Node 23+** (including Node 24): `npm install` succeeds but
  `npm run dev` then fails with `Error: Electron uninstall`. Use Node 20 LTS for a clean install, or
  apply the recovery below.
- npm ≥ 10
- Windows or macOS (MVP targets)

## Install

```bash
npm install
```

The first install downloads the Electron binary (needs network access).

### If `npm run dev` says `Error: Electron uninstall` (Node 23+/24)

The Electron binary did not unpack. Easiest fix: switch to **Node 20 LTS** and reinstall:

```bash
# with nvm-windows / nvm
nvm install 20 && nvm use 20
rm -rf node_modules package-lock.json   # (PowerShell: Remove-Item -Recurse -Force node_modules, package-lock.json)
npm install
```

Or recover the binary in place (the zip is already cached): extract
`%LOCALAPPDATA%\electron\Cache\<hash>\electron-v33.4.11-win32-x64.zip` into
`node_modules\electron\dist\` and create `node_modules\electron\path.txt` containing `electron.exe`.

## Run the app (see it)

```bash
npm run dev      # launch the Electron app with HMR
# or:
npm run see      # alias of dev
```

You should see the **Swaft** window with: a **theme toggle** (light/dark), the **5 primary colors**,
and a **“Ping backend”** button that round-trips `system.ping` through the hardened IPC bridge and
shows `pong=true …`.

## Verify (conformance checks)

```bash
npm run verify   # typecheck + lint + unit/component tests
```

Individually:

```bash
npm run typecheck
npm run lint
npm run test            # Vitest (unit + component)
npm run build           # production build (out/)
npm run e2e             # Playwright-for-Electron smoke (run `npm run build` first)
```

## “See it” after each milestone

Every milestone in [`docs/swaft/MVP_STEPS.md`](docs/swaft/MVP_STEPS.md) ends with a **See it**
command so you can launch the app and verify conformance before moving on. The two constants:

- **Run it:** `npm run dev`
- **Check it:** `npm run verify` (and `npm run e2e` once built)

What “seeing it” shows grows per milestone (M0 foundation → M1 IPC demo → M2 themed design system →
M3 sign-in gate → M4 create/open workspace → … → M11 packaged app).

## Project layout

```
packages/shared     # transport-agnostic op contracts + error envelope (used by main + renderer)
apps/desktop        # Electron app
  src/main          #   main process (backend authority): bootstrap, ipc router, transport, workers
  src/preload       #   contextBridge typed surface (allow-list)
  src/renderer      #   React + Vite UI (api-client/transport, theme, app)
e2e                 # Playwright-for-Electron tests
docs/swaft          # specifications + MVP/NEXT step prompts
docs/seebo          # the Seebo engine docs
```

> Architecture rationale and rules: [`docs/swaft/SWAFT_ARCHITECTURE.md`](docs/swaft/SWAFT_ARCHITECTURE.md).
> Security model: [`docs/swaft/SWAFT_SECURITY_MODEL.md`](docs/swaft/SWAFT_SECURITY_MODEL.md).
