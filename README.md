# Swaft

**Swaft** ("Strange Web App for Technician") — a desktop-first technical app built on the
[Seebo](docs/seebo/) engine. Electron (main process = Node backend) + React/Vite renderer, hardened
IPC, transport-agnostic API client.

> **Documentation:** see [`docs/swaft/`](docs/swaft/) — start with
> [`README`](docs/swaft/README.md), [`SWAFT_MVP_SCOPE.md`](docs/swaft/SWAFT_MVP_SCOPE.md), and the
> step-by-step build guide [`MVP_STEPS.md`](docs/swaft/MVP_STEPS.md). The user-authored code
> feature (capability/action templates) is designed in
> [`analisi_codice_utente.md`](analisi_codice_utente.md).

## Requirements

- **Node.js 20 LTS or newer** (the repo is developed on Node 20–24).
- npm ≥ 10
- Windows or macOS (MVP targets)

## Install

```bash
npm install
```

The first install downloads the Electron binary (needs network access). If `npm run dev` ever fails
with `Error: Electron uninstall`, the binary did not unpack — reinstall with
`rm -rf node_modules package-lock.json && npm install`.

## Run the app (see it)

```bash
npm run dev      # launch the Electron app with HMR
# or:
npm run see      # alias of dev
```

First run: the **sign-up gate** asks you to create the local account that protects the device
(Argon2id verifier kept in OS secure storage). After signing in you land on the **homepage** —
create or open a `.swaft` workspace, then work in the shell: **Working Tree** (projects, folders,
tags, templates), **Document / API / Code views**, template editor with releases, environments,
actions with confirmation + receipts, and per-workspace restrictions.

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

Two heavy renderer suites (`workspace.test.tsx`, `api.test.tsx`) are excluded from the default run
because they can hang the jsdom worker on some machines; opt in with:

```bash
SWAFT_RUN_HEAVY_TESTS=1 npm run test
```

The e2e smoke launches the **built** app against a throwaway profile (`SWAFT_USER_DATA_DIR`), signs
up through the real IPC path and asserts the homepage — it never touches your real account.

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
