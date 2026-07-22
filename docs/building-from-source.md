---
title: Building from source
layout: default
nav_order: 6
---

# Building from source
{: .no_toc }

For contributors and anyone who wants to run, test or package Swaft themselves.
{: .fs-6 .fw-300 }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

## Prerequisites

- **Node.js 20 LTS or newer** and **npm ≥ 10**.
- A working **network connection** on first install (to download the Electron binary).
- **[Git](https://git-scm.com/)** — required at runtime only for Git-backed workspaces.

## Repository layout

Swaft is an **npm-workspaces monorepo**:

```
packages/shared     # transport-agnostic op contract (types, Zod schemas) shared by main + renderer
apps/desktop        # the Electron application
  src/main          #   main process — the backend authority (IPC router, services, storage, HTTP, git, seebo)
  src/preload       #   contextBridge surface (the allow-listed bridge between renderer and main)
  src/renderer      #   React + Vite UI
e2e                 # Playwright-for-Electron smoke tests
docs                # this documentation site (Jekyll + just-the-docs)
```

The app is built on the [Seebo](seebo/index.md) engine (the `seebo` npm package) and persists local
workspaces to a SQLite database run in a worker.

## Install & run

```bash
git clone https://github.com/BoniFederico/swaftapp.git
cd swaft
npm install
npm run dev        # launch the app with hot-reload (alias: npm run see)
```

If `npm run dev` reports `Error: Electron uninstall`, the Electron binary didn't unpack — reinstall:

```bash
rm -rf node_modules package-lock.json && npm install
```

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` / `npm run see` | Run the app in development with HMR. |
| `npm run build` | Production build into `out/`. |
| `npm run dist` | Package a distributable with electron-builder. |
| `npm run dist:dir` | Package into an unpacked directory (faster, for local checks). |
| `npm run typecheck` | TypeScript checks for `shared` + `desktop`. |
| `npm run lint` | ESLint over the repo. |
| `npm run format` | Prettier write. |
| `npm run test` | Vitest unit + component tests. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run e2e` | Playwright-for-Electron smoke (build first). |
| `npm run verify` | `typecheck` + `lint` + `test` — the standard gate. |

## Testing notes

Run the standard gate before pushing:

```bash
npm run verify
```

Two renderer suites (`workspace.test.tsx`, `api.test.tsx`) are **excluded by default** because they
can hang the jsdom worker on some machines. Opt in explicitly:

```bash
SWAFT_RUN_HEAVY_TESTS=1 npm run test
```

The **end-to-end** smoke test drives the **built** app against a throwaway profile
(`SWAFT_USER_DATA_DIR`) through the real IPC path — it never touches a real workspace. Build first:

```bash
npm run build
npm run e2e
```

## Packaging a desktop build

```bash
npm run dist        # installable artifacts (Windows / macOS / Linux, per electron-builder config)
npm run dist:dir    # unpacked directory only
```

Continuous integration runs typecheck + lint + tests on Linux
([`.github/workflows/ci.yml`](https://github.com/BoniFederico/swaftapp/blob/main/.github/workflows/ci.yml));
multi-OS release artifacts are produced by the release workflow.

## Contributing to these docs

This site lives in [`docs/`](https://github.com/BoniFederico/swaftapp/tree/main/docs) and is built with
Jekyll + [just-the-docs](https://just-the-docs.com/). Preview it locally:

```bash
cd docs
bundle install
bundle exec jekyll serve      # http://localhost:4000/swaftapp/
```

Every push to `docs/` on the default branch redeploys the site via
[`.github/workflows/pages.yml`](https://github.com/BoniFederico/swaftapp/blob/main/.github/workflows/pages.yml).
