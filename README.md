# Swaft

**Swaft** ("Strange Web App For Technician") is a desktop-first technical workspace built on the
[Seebo](https://github.com/BoniFederico/swaftapp/tree/main/docs/seebo) template engine. It is an
Electron app (main process = Node backend, hardened IPC, React/Vite renderer) for authoring
versioned **templates**, firing structured **HTTP requests**, running sandboxed **code** and
**actions**, and wiring them together in visual **scenarios** — all inside a local `.swaft` file or
a Git-backed workspace.

> **📖 Documentation:** the full user guide is published at
> **<https://bonifederico.github.io/swaftapp/>** (source in [`docs/`](docs/)). Start with
> [Getting started](docs/getting-started.md) and [Core concepts](docs/concepts.md).

## Requirements

- **Node.js 20 LTS or newer** (developed on Node 20–24) and **npm ≥ 10**.
- **Windows or macOS** (current targets; Linux builds are produced by CI).
- **Git** on your `PATH` — optional, only for Git-backed workspaces.

## Install

```bash
npm install
```

The first install downloads the Electron binary (needs network access). If `npm run dev` later fails
with `Error: Electron uninstall`, the binary didn't unpack — reinstall with
`rm -rf node_modules package-lock.json && npm install`.

## Run the app

```bash
npm run dev      # launch the Electron app with HMR (alias: npm run see)
```

There is **no account and no sign-in** — Swaft is local-first. You land on the **homepage**, where
you create or open a workspace:

- a **local** `.swaft` file (a single portable SQLite database, optionally encrypted), or
- a **Git** workspace (a folder of plain files you can commit, branch and diff).

Then you work in the shell: the **Working Tree** (projects, folders, tags, templates), the
type-specific views (**Document / API / Code / Scenario**), the template editor with **releases**,
**environments**, **actions** with confirmation + receipts, and per-workspace **restrictions**.

## Verify

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
because they can hang the jsdom worker on some machines; opt in with
`SWAFT_RUN_HEAVY_TESTS=1 npm run test`.

## Project layout

```
packages/shared     # transport-agnostic op contract (types + Zod schemas) shared by main + renderer
apps/desktop        # Electron app
  src/main          #   main process (backend authority): ipc router, services, storage, http, git, seebo
  src/preload       #   contextBridge typed surface (allow-list)
  src/renderer      #   React + Vite UI
e2e                 # Playwright-for-Electron tests
docs                # documentation site (Jekyll + just-the-docs) → published with GitHub Pages
```

See [Building from source](docs/building-from-source.md) for the full contributor guide, and the
[docs site](https://bonifederico.github.io/swaftapp/) for everything else.
