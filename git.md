# Swaft — Git Workspace Mode

> **Status:** Design proposal (analysis + architecture). **No code is written yet.**
> **Audience:** Swaft maintainers.
> **Companions:** [`docs/swaft/SWAFT_STORAGE_SYNC_MODEL.md`](docs/swaft/SWAFT_STORAGE_SYNC_MODEL.md),
> [`docs/swaft/SWAFT_DATA_MODEL.md`](docs/swaft/SWAFT_DATA_MODEL.md),
> [`docs/swaft/SWAFT_ARCHITECTURE.md`](docs/swaft/SWAFT_ARCHITECTURE.md),
> [`docs/swaft/SWAFT_SECURITY_MODEL.md`](docs/swaft/SWAFT_SECURITY_MODEL.md).
>
> This document is written in English to stay consistent with the `docs/swaft/` corpus it
> cross-references and with the code identifiers it quotes. An Italian version can be produced on request.

---

## Table of contents

1. [Current architecture — analysis](#1-current-architecture--analysis)
2. [Criticalities found (incl. doc ↔ code drift)](#2-criticalities-found)
3. [Proposed architecture](#3-proposed-architecture)
4. [On-disk file format](#4-on-disk-file-format)
5. [Folder structure](#5-folder-structure)
6. [Proposed UX](#6-proposed-ux)
7. [User flows](#7-user-flows)
8. [Components to modify](#8-components-to-modify)
9. [Implementation plan (phased)](#9-implementation-plan-phased)
10. [Risks and open problems](#10-risks-and-open-problems)
11. [Open decisions](#11-open-decisions)
12. [Suggestions & improvements over the initial idea](#12-suggestions--improvements-over-the-initial-idea)
13. [Future evolution of Git mode](#13-future-evolution-of-git-mode)

---

## 1. Current architecture — analysis

Swaft is an Electron desktop app organized as an npm-workspaces monorepo:

- **`packages/shared`** — the typed op contract (Zod schemas + `OP_NAMES` + `OpContracts`). Single runtime dep: `zod`.
- **`apps/desktop`** — `src/main` (Node/Electron main process), `src/preload` (context bridge), `src/renderer` (React 18 UI). Electron **43.1.1** (bundles Node 22). Storage engine: **`sql.js`** (SQLite compiled to WASM).

### 1.1 Storage: one opaque encrypted SQLite blob per workspace

A workspace is a **single `.swaft` file** that is a serialized SQLite image, optionally wrapped in whole-file AES-256-GCM encryption. There is no directory, no per-entity file.

- Lifecycle owner: [`WorkspaceService`](apps/desktop/src/main/workspace/WorkspaceService.ts) holds exactly one open workspace (`state: OpenState | null`, line 45) and serializes all transitions through a promise queue (`locked()`, lines 60–64).
- **Create** (`doCreate`, lines 70–106): `createBackend()` → `new LocalAdapter(backend)` → `adapter.initialize()` (runs `SCHEMA_DDL`, stamps `SCHEMA_VERSION`, inserts the singleton `workspace_meta` row) → `adapter.serialize()` → optional `crypto.encrypt(image, password)` → `fs.write(location, bytes)`.
- **Open** (`doOpen`, lines 112–165): `fs.read(path)` → `crypto.isEncrypted` / `decrypt` → `createBackend(image)` → `adapter.migrateToCurrent()` → read `workspace_meta`.
- **Save** (lines 168–178): `adapter.serialize()` → optional encrypt → `fs.write(path, bytes)`. The whole DB is re-serialized and the whole file is overwritten atomically on **every** save.
- **DB engine**: `sql.js`, serialized via `db.export()` → `Uint8Array` ([`sqlite.ts`](apps/desktop/src/main/storage/sqlite.ts) 114–117), run on a **worker thread** ([`worker-db-backend.ts`](apps/desktop/src/main/storage/worker-db-backend.ts)) with an in-process fallback for tests. Services depend only on the `DbBackend` interface ([`db-backend.ts`](apps/desktop/src/main/storage/db-backend.ts) 9–19).
- **Filesystem port**: `WorkspaceFs { read(path), write(path,bytes) }` ([`WorkspaceService.ts`](apps/desktop/src/main/workspace/WorkspaceService.ts) 14–17), wired in [`app-bootstrap.ts`](apps/desktop/src/main/app-bootstrap.ts) to `fs.readFile` and `writeFileAtomic` (temp-file + rename, [`atomic-file.ts`](apps/desktop/src/main/storage/atomic-file.ts)). The port is **single-file oriented**.

### 1.2 The data model already separates "versionable" from "local"

Schema is at **`SCHEMA_VERSION = 25`** ([`schema.ts`](apps/desktop/src/main/storage/schema.ts) 14). Tables split cleanly into two classes — and this split is *exactly* the include/exclude partition Git mode needs:

| Class | Tables | Fate in Git mode |
|-------|--------|-------------------|
| 🟢 **SYNC** (carry sync-meta columns) | `workspace_meta`, `projects`, `folders`, `tags`, `workspace_settings`, `templates`, `releases`, `changelog`, `template_tags`, `environments` | **Versioned** (written to the repo) |
| 🔵 **LOCAL** (no sync-meta) | `local_input_state`, `release_selection`, `api_history`, `api_action_runs`, `receipts`, `environment_selection`, `scenario_runs`, `scenario_run_steps` | **Excluded** (history/cache/temp — never committed) |

Every 🟢 row carries `created_at`, `updated_at`, `updated_by_device_id`, `revision`, `deleted_at`, stamped by [`RepoBase`](apps/desktop/src/main/workspace/RepoBase.ts) (16–58). These were designed for a **future P2P last-write-wins engine that was never built** — important for §2 and §3.

- **Environments** live in the SYNC table `environments` (`id, name, description, owner_kind, owner_id, vars` where `vars` is a JSON string→string map), plus a LOCAL `environment_selection` row for the active choice ([`schema.ts`](apps/desktop/src/main/storage/schema.ts) 167–182). So "persist Environments in the repo" = "project the `environments` table."
- **Secrets are never in the file.** They live in the OS keychain via `SecretService` (`safeStorage` → `secrets.json`, app-level). Files/DB only store opaque `secretRef` references. This is unchanged by Git mode and is a key safety property.

### 1.3 App-level store (outside any workspace)

[`AppStore`](apps/desktop/src/main/app-store/AppStore.ts) is a single JSON doc at `userData/app-store.json`: `deviceId`, `preferences` (theme/color/language), `recent[]` (`{path, name, encrypted, lastOpenedAt}`, capped at 10), and `trustedCode` hashes. Recent entries key on a **file path** and do not record storage mode or format.

### 1.4 IPC: one channel, an op registry

- Single Electron channel `swaft:invoke`; the op name travels in the payload ([`preload/index.ts`](apps/desktop/src/preload/index.ts), [`ipc/channels.ts`](apps/desktop/src/main/ipc/channels.ts)). The preload exposes **only** `invoke(op, payload)`.
- Adding an op is a **shared-package + handler + service** change with **zero preload/router edits**: add to `OP_NAMES`, add a Zod request schema in `OP_REQUEST_SCHEMAS`, add an `OpContracts` entry, add a handler in [`transport/handlers.ts`](apps/desktop/src/main/transport/handlers.ts), register a service slot in [`services.ts`](apps/desktop/src/main/services.ts) + [`app-bootstrap.ts`](apps/desktop/src/main/app-bootstrap.ts). The router allow-list is derived from `OP_NAMES` automatically.
- Renderer calls `api.call('op', payload)` through `ApiClient` → `window.swaft.invoke` → router (sender + allow-list) → dispatch (session guard + Zod validation) → handler → service.

### 1.5 Renderer & top bar

- React **Context only** (no router, no Redux/zustand). Top-level "route" is simply *workspace open?* → `WorkspaceView`, else `Homepage` ([`App.tsx`](apps/desktop/src/renderer/src/App.tsx)).
- The open-workspace **top bar** is `.ws-topbar` in [`WorkspaceView.tsx`](apps/desktop/src/renderer/src/workspace/WorkspaceView.tsx) 208–247, split into `.ws-identity` (left: name + badges) and **`.ws-actions` (top-right)**: `EnvironmentPicker`, Settings, Lock, Close. The **top-right corner is where a Git widget belongs**, modeled on `EnvironmentPicker` (a trigger button + `usePopover` + portalled panel).
- The **create wizard** ([`CreateWorkspaceWizard.tsx`](apps/desktop/src/renderer/src/workspace/CreateWorkspaceWizard.tsx)) shows storage mode as a **static immutable badge** ("Local file (.swaft)", lines 108–114). Execution mode, by contrast, is a real `<Select>` (lines 116–124) — the pattern to copy when storage mode becomes selectable. The top-bar storage badge is hardcoded to "Local" ([`WorkspaceView.tsx`](apps/desktop/src/renderer/src/workspace/WorkspaceView.tsx) 226).
- CSS: one global `styles.css` with design tokens; badges are the `.ui-badge` class; reusable kit in `ui/` (`Dialog`, `Menu`, `Select`, `Button`, `IconButton`, `usePopover`, `createPortal`). **No git/branch icon exists yet.**

---

## 2. Criticalities found

### 2.1 Documentation ↔ implementation drift (must be reconciled)

The docs describe abstractions that **do not exist in code**. Any Git design that "just adds an adapter" per the docs would be building on fiction. Concretely:

| Documented (in `docs/swaft/`) | Reality in code |
|-------------------------------|-----------------|
| A storage-adapter abstraction `LocalAdapter` / `P2PAdapter` / `ServerAdapter` selected by immutable `storageMode` (STORAGE §10, ARCHITECTURE §7). | **Only `LocalAdapter` exists.** No `StorageAdapter` interface, no `P2PAdapter`/`ServerAdapter`, **no mode→adapter selector**. `LocalAdapter` is instantiated directly. |
| Services depend on **repository interfaces** (`TemplateRepo`, `ReleaseRepo`, …), not concrete storage (rule **BE-3**). | **Not realized.** Every service issues **raw SQL** via `this.ws.requireAdapter().run/all/get` ([`RepoBase.ts`](apps/desktop/src/main/workspace/RepoBase.ts) 12–13). The swap seam is the `DbBackend`/SQL layer, not a repository layer. |
| `storageMode ∈ {local, p2p, server}`, others "reserved". | `StorageMode` is a bare TS union ([`ops.ts`](packages/shared/src/ops.ts) 703) with **no runtime validation**, **hard-coded to `'local'`** ([`WorkspaceService.ts`](apps/desktop/src/main/workspace/WorkspaceService.ts) 80), **never switched on** anywhere. `p2p`/`server` are unreferenced. |
| Encryption is integrated "transparently into the **LocalAdapter** open/save path". | Encryption lives in **`WorkspaceService`**, not `LocalAdapter`. |
| Storage engine is **`better-sqlite3`** (native) (ARCHITECTURE §… multiple mentions). | Implementation uses **`sql.js`** (WASM). No native modules in play. |
| P2P sync (real-time, LWW, device trust, invitations, revocation) — large sections of STORAGE & SECURITY. | **None implemented.** Sync-meta columns exist but no reconciliation engine reads them; saves overwrite the whole file. |

**Consequence:** the good news is the blast radius for Git is *small* precisely because there's no real adapter/repository indirection to satisfy — but the docs will actively mislead implementers and must be updated alongside this feature.

### 2.2 Structural criticalities for a Git (readable-files) mode

1. **The persistence format is a monolithic binary blob.** `db.export()` produces one SQLite image; encryption makes it fully opaque. Neither is diffable or mergeable — the opposite of the Git goal.
2. **The FS port assumes a single file path**, not a directory of files. Atomic write is single-target temp+rename; a directory needs multi-file write with its own consistency story.
3. **Sync-meta churn.** `revision`, `updated_by_device_id`, `updated_at`, `deleted_at` change on every edit and differ per device. If projected verbatim into versioned files they would cause **constant, meaningless diffs and gratuitous merge conflicts**. (They exist only for the unbuilt P2P engine.)
4. **No Git library and a hard offline constraint.** None of `simple-git` / `isomorphic-git` / `nodegit` / `dugite` are in the tree, and the dev environment cannot reliably `npm install` (README notes install needs network; `node_modules` is git-ignored; project memory flags offline blocks). There is also **no existing `child_process`/`execFile` precedent** in the app to model a shell-out on (Electron `utilityProcess`/worker threads are the only out-of-process patterns; `node:child_process` is explicitly *denied to untrusted user code* — but note that denial does **not** apply to the trusted main process, see §3.4).
5. **DB↔files drift & external edits.** In Git mode the working store is still an in-memory DB, but the truth is now files that the user (or `git pull`, or another tool) can change behind Swaft's back. There is no reload-from-disk path today.
6. **Single-workspace, path-centric recents.** `AppStore.recent` stores file paths and can't currently represent "a folder / a repo".

---

## 3. Proposed architecture

### 3.1 Guiding principle: Git is a *persistence backend*, not a new domain

The initial framing ("a second **type** of Workspace") is fine at the UX level, but architecturally the cleanest model is: **Git mode is a different way to persist the same workspace**, orthogonal to the domain model. The SQLite working store, the services, the repositories, the IPC ops, and the entire UI stay the same. Only *where and how bytes hit disk* changes.

This yields the **minimal blast radius**: we do **not** rewrite services to read/write files. We keep the in-memory SQLite DB as the runtime engine and add a **projection layer** that dumps the SYNC tables to readable files on save and hydrates them back on open.

```
              ┌──────────────────────────────────────────────┐
              │  Services (Template/Release/Env/Settings/…)   │  ← unchanged
              │         raw SQL via LocalAdapter               │
              └───────────────────────┬──────────────────────┘
                                      │  DbBackend (sql.js worker)   ← unchanged
                                      │  in-memory SQLite image
              ┌───────────────────────┴──────────────────────┐
              │        WorkspacePersistence (NEW port)         │
              │   load(): build DB image   save(): flush DB    │
              └──────┬───────────────────────────────┬────────┘
        selected by  │                                │
    workspace mode   ▼                                ▼
        ┌────────────────────────┐        ┌────────────────────────────────┐
        │  LocalFilePersistence  │        │        GitPersistence           │
        │  (today's behavior:    │        │  Projection(DB⇄dir of files)    │
        │   1 encrypted .swaft)  │        │  + GitService (status/commit/…) │
        └────────────────────────┘        └────────────────────────────────┘
```

This is a **scoped, honest realization of the documented adapter abstraction** — but placed at the *persistence* boundary (where a real seam already almost exists: `serialize()` + `createBackend(bytes)` + `WorkspaceFs`), not by inventing the never-built repository layer.

### 3.2 The `WorkspacePersistence` port

Replace the single-file-centric `WorkspaceFs` with a persistence strategy that owns *both* directions of the round trip:

```ts
interface WorkspacePersistence {
  /** Load a workspace into a fresh DB image (bytes for local file; hydrated rows for git). */
  open(target: OpenTarget): Promise<{ image?: Uint8Array; hydrate?: (db: LocalAdapter) => Promise<void>; summary meta }>;
  /** Flush the current DB to disk (whole-file for local; changed entity files for git). */
  save(db: LocalAdapter): Promise<void>;
  close(): Promise<void>;
  readonly kind: 'local' | 'git';
}
```

- **`LocalFilePersistence`** = today's code, extracted verbatim: read → decrypt → `image`; on save `serialize()` → encrypt → atomic write. **Zero behavioral change for existing `.swaft` users.**
- **`GitPersistence`** = new. On open, it reads the repo files and INSERTs projected rows into a fresh in-memory DB; on save, it SELECTs the SYNC tables and writes/removes the corresponding files. It also owns the `GitService`.

`WorkspaceService` keeps its lock queue and single-open-workspace model; it just delegates the byte/file work to the injected persistence. `storageMode` finally becomes a real branch point (choose the persistence at open/create).

### 3.3 The projection layer (DB ⇄ files)

A small, declarative **entity registry** drives both directions. One descriptor per SYNC table:

```ts
type EntityProjection = {
  table: string;                 // e.g. 'templates'
  dir: string;                   // e.g. 'templates'
  toFiles(row): FileOut[];       // → JSON (+ optional extracted source sidecar)
  fromFiles(files): Row;         // JSON (+ sidecar) → row
  sourceField?: string;          // extract this big text column to a real file
};
```

Rules that make files clean and mergeable:

- **Strip sync-meta on write, regenerate on read.** Versioned files contain **only stable domain fields** (no `revision`, `updated_by_device_id`, `updated_at`, `deleted_at`). Git *is* the version control; those columns are re-stamped with neutral defaults on hydrate. This eliminates the churn/conflict problem of §2.2(3).
- **Deletion = file removal**, not a tombstone. Git tracks deletes natively.
- **Extract `source` to a real file.** For `document`/`render`/capability templates the Seebo source becomes `source.<ext>` (e.g. `.md`, `.sql`, `.js`, `.html`) so GitHub shows syntax-highlighted, line-level diffs instead of a JSON-escaped blob. API templates keep their structured request in JSON.
- **Canonical serialization**: sorted keys, 2-space indent, trailing newline, `\n` line endings. Deterministic output → minimal diffs, order-independent merges.

### 3.4 Git integration: shell to the system `git` (recommended), isomorphic-git as fallback

Given the **hard offline constraint** (can't reliably add an npm dependency), the pragmatic and immediately-workable choice is to **shell out to the user's installed `git` binary from the main process** via `child_process.execFile`.

- **Security note (pre-empting the obvious objection):** the codebase denies `node:child_process` to *untrusted user capability code* ([`guard`](apps/desktop/src/main/usercode/guard.test.ts)). That denial is about the sandbox; it does **not** constrain the **trusted main process**, which already has full system access (file I/O, network, keychain). A `GitService` in main using `execFile('git', …)` is fully consistent with the security model. We never pass user content as shell arguments unquoted; `execFile` (not `exec`) avoids a shell entirely.
- **Pros:** no install needed (works offline **today**), full git feature set, **SSH + the user's existing credential helpers/config for free**, cross-platform where git is present.
- **Cons:** requires `git` on `PATH` (detect at startup; if absent, disable Git-mode creation and show a clear message), we parse `--porcelain` output, some cross-platform quirks.

**Alternative — bundle `isomorphic-git`** (pure JS, no native build, runs in Electron main). Pros: zero runtime dependency on a system git, deterministic. Cons: **must be installed** (blocked by the offline constraint right now), HTTPS-only auth is awkward, no SSH, larger surface to reimplement. Recommend keeping it as a **future bundled fallback** for users without git installed, behind the same `GitService` interface.

| Approach | Offline-installable now | Needs git on user machine | SSH / cred helpers | Native build | Feature completeness |
|----------|:---:|:---:|:---:|:---:|:---:|
| **System `git` via execFile (recommended)** | ✅ (nothing to install) | ⚠️ yes | ✅ free | ✅ none | ✅ full |
| `isomorphic-git` (bundled) | ❌ (npm fetch) | ✅ no | ❌ HTTPS-token only | ✅ none | ⚠️ good |
| `simple-git` (wraps system git) | ❌ (npm fetch) | ⚠️ yes | ✅ | ✅ none | ✅ full |
| `nodegit` | ❌ | ✅ no | ✅ | ❌ native/ABI pain | ✅ full |

`GitService` is defined as an **interface** so the backend (system-git vs isomorphic-git) is swappable without touching callers.

### 3.5 Keeping Local File mode compatible

`LocalFilePersistence` is the current path renamed and isolated. `.swaft` files keep opening, saving, encrypting, and migrating exactly as today. `storageMode` is stored in `workspace_meta` and drives which persistence is chosen. Because the mode is written at create time and read at open time, **immutability is preserved** (a workspace is either a `.swaft` or a repo, never converted in place — conversion is an explicit export/import, mirroring existing rule SM-3).

---

## 4. On-disk file format

### 4.1 Format choice: canonical JSON + extracted source sidecars

- **JSON**, not SQLite — human-readable, matches the existing Zod/DTO shapes 1:1, trivially serializable, `js-yaml` isn't needed. (YAML was considered for settings/env for prettiness but rejected for uniformity and to avoid a second parser in the trust path.)
- **Deterministic writer**: keys sorted, 2-space indent, `\n` newlines, trailing newline. This is the single most important lever for mergeability.
- **Extracted source**: the large free-text field of a template's draft is written to a **sidecar file with the right extension**, so diffs are meaningful and GitHub-highlighted. JSON holds the structured metadata and points at the sidecar implicitly (by convention `source.<ext>` next to `template.json`).
- **No sync-meta, no secrets, no local data** in any file (see §3.3 and §1.2).

### 4.2 Example files

`workspace.json` (root manifest):

```json
{
  "formatVersion": 1,
  "schemaVersion": 25,
  "name": "Acme Ops",
  "icon": "🚀",
  "executionMode": "sandbox"
}
```

`settings.json`:

```json
{
  "allowedHttpDomains": ["api.acme.test"],
  "allowedActions": ["jira.createIssue"],
  "allowedCapabilities": ["env", "template"],
  "proxy": null,
  "locale": "it-IT",
  "batcherEnabled": true
}
```

`environments/<id>.json`:

```json
{
  "name": "staging",
  "description": "Staging environment",
  "ownerKind": "workspace",
  "ownerId": null,
  "vars": { "baseUrl": "https://staging.acme.test", "tenant": "acme" }
}
```

`templates/<id>/template.json` (a `document`):

```json
{
  "type": "document",
  "subtype": "markdown",
  "name": "Release notes",
  "description": null,
  "projectId": "<project-id>",
  "folderId": null,
  "tags": ["ops", "public"],
  "order": 3
}
```

…with its body in `templates/<id>/source.md` (a normal Markdown file). An `api` template instead stores the structured request in `template.json` (`method/url/headers/query/body/auth`, with `auth.secretRef` — never the secret) and has no source sidecar.

`templates/<id>/releases/<version>.json` — the immutable release snapshot (self-contained, includes its own source, since releases must survive template edits).

### 4.3 What is NOT in the repo

Excluded entirely (never projected): `local_input_state`, `release_selection`, `api_history`, `api_action_runs`, `receipts`, `environment_selection`, `scenario_runs`, `scenario_run_steps` — i.e. **all history, run logs, last-input values, active-environment selection, default-release selection**. Also excluded: encryption (Git mode is plaintext by design), secrets (keychain), and the app-level store.

A generated **`.gitignore`** is written into the repo to defend users who point Swaft at an existing repo or keep other files there, and a **`.gitattributes`** enforces `* text=auto eol=lf` so Windows/macOS/Linux don't produce line-ending noise (a real cross-platform footgun).

---

## 5. Folder structure

**Recommended: flat, id-keyed collections mirroring the relational model.**

```
<repo root>/
├─ workspace.json               # manifest (name, icon, executionMode, formatVersion, schemaVersion)
├─ settings.json                # workspace settings (non-secret)
├─ tags.json                    # all tags (small, one file)
├─ projects/
│  └─ <project-id>.json
├─ folders/
│  └─ <folder-id>.json
├─ environments/
│  └─ <environment-id>.json
├─ templates/
│  └─ <template-id>/
│     ├─ template.json
│     ├─ source.<ext>           # documents/render/capabilities only
│     └─ releases/
│        └─ <version>.json      # immutable
├─ changelog.jsonl              # append-only, one JSON object per line (see §11)
├─ .gitignore                   # generated
├─ .gitattributes               # generated (eol=lf)
└─ .swaft/                      # OPTIONAL local cache (git-ignored): last DB image, index — never committed
```

**Why flat & id-keyed** (over nesting templates under their project/folder on disk):

- **Stability** — the user asked explicitly for "stable nel tempo". An id never changes, so a file **never renames**; renaming a template or moving it between projects/folders is a one-line field change inside `template.json`, not a file move. File moves are the #1 cause of ugly Git history and merge pain.
- **Faithful to the model** — a template's `projectId`/`folderId` are nullable and mutable; templates are *filtered* by projects, not owned by them. Nesting would force awkward "root/orphan" folders and lossy encodings.
- **Trade-off** — flat id-dirs are less human-navigable on GitHub than `projects/acme/templates/release-notes/`. Mitigations: human `name` lives inside every file; a future read-only "browse" could add slug symlinks. (Slug-in-filename is rejected because it reintroduces rename churn.) See open decision **OD-G3**.

---

## 6. Proposed UX

### 6.1 Creating / opening a Git workspace

Turn the create wizard's immutable storage badge into a real choice (copy the execution-mode `<Select>` pattern):

- **Local file (default)** — unchanged flow (pick `.swaft` location, optional encryption).
- **Git** — no encryption option (disabled with a hint: "Git workspaces are stored as plain, versioned files"). Then a sub-choice:
  - **Use a folder** *(recommended primary)* — pick a directory. If empty → `git init` + scaffold + initial commit. If it already contains a Swaft workspace → adopt it. If it's a non-empty non-Swaft repo → confirm before scaffolding.
  - **Clone from URL** *(secondary, Phase 2)* — enter an HTTPS/SSH URL and a destination folder; Swaft clones then opens.

**Recommendation on "one or both":** support **both**, but ship **"Use a folder" first**. It covers the most common real workflow — the user already clones/manages the repo with their own Git client, and just points Swaft at it — with **zero credential handling** in-app. In-app **Clone** is a convenience that pulls in auth/host-key complexity, so it's Phase 2.

### 6.2 The Git panel (top-right)

**Placement — confirmed best spot:** the first child of `.ws-actions` in [`WorkspaceView.tsx`](apps/desktop/src/renderer/src/workspace/WorkspaceView.tsx) (top-right, left of `EnvironmentPicker`), rendered **only when `storageMode === 'git'`**. Build it exactly like `EnvironmentPicker`: a compact trigger button + `usePopover` + a portalled panel. Add a branch/git icon to [`ui/icons.tsx`](apps/desktop/src/renderer/src/ui/icons.tsx).

**Trigger button** shows: a branch glyph, the **current branch name**, and a **dirty indicator** (a dot / count when the working tree has uncommitted changes; a clean check when not). Optional ahead/behind counters (`↑2 ↓1`) once fetch is wired.

**Panel contents (v1 — the "common ops without becoming a full Git client" set):**

- Current branch + clean/dirty status line.
- **Branch switcher** (dropdown of local branches; `+ New branch…`).
- **Changes list** — the uncommitted files, grouped (added/modified/deleted), each showing the friendly entity name (resolve `templates/<id>/…` → the template's `name`), not just the path.
- **Commit** — a message textarea + "Commit" button (stages all workspace files and commits).
- **Pull** and **Push** buttons, with a spinner + last-result toast.
- **Fetch** (cheap; enables ahead/behind) — **include**.
- **Discard changes** (per-file and "discard all") — **include**, behind a confirm; very useful and low-risk.
- **Create branch** — **include** (trivial, common).

**Evaluate / defer:**

- **Stash** — *defer.* Swaft auto-projects the DB to files on save, so the working tree is normally "clean or committed"; stashing an app-managed tree is confusing. Low value initially.
- **Checkout tag** — *defer.* Read-only historical browsing belongs with the future "commit history / diff" feature (§13).
- **Conflict resolution** — *minimal v1:* detect a conflicted merge/pull, **block** and show a clear "resolve conflicts in your Git tool, then reload" message with the conflicted files. Assisted/in-app merge is future (§13).
- **Merge branches, rebase, cherry-pick, reset --hard** — *out of scope* (this is a client, not a Git IDE).

---

## 7. User flows

### 7.1 Create (folder)
1. Wizard → Git → "Use a folder" → pick empty dir.
2. Main: `git init`, write `.gitignore`/`.gitattributes`, scaffold `workspace.json` + empty collections, build a fresh in-memory DB, `git add -A` + initial commit.
3. Workspace opens; the Git panel shows `main`, clean.

### 7.2 Open (existing repo)
1. Homepage → Open → pick a folder containing `workspace.json` (or select from recents).
2. Main: read `formatVersion` (migrate files if older, reject if newer), hydrate a fresh DB from the files, read `git status`.
3. Workspace opens; panel shows branch + dirty state.

### 7.3 Edit → save → commit → push
1. User edits a template; `ws.save()` fires as today, but now **projects changed entities to files** (working tree changes).
2. The panel's "Changes" list updates (`git status --porcelain`).
3. User writes a message → **Commit** (`git add -A` scoped to workspace files, `git commit -m`).
4. User clicks **Push** (`git push`); auth via the user's git credentials (system-git) or a token (isomorphic-git).

### 7.4 Pull / switch branch → reload
1. User clicks **Pull** (or switches branch). Main runs `git pull` / `git checkout <branch>`.
2. **Critical:** the files on disk changed under the app, so Swaft **closes and rebuilds the in-memory DB from the new files**, then refreshes the UI (broadcast a "workspace reloaded" event; re-fetch tree/tabs). Unsaved in-memory edits are guarded first (prompt to commit/discard) — reuse the existing dirty-tab confirmation machinery.

### 7.5 Conflict (v1)
1. Pull/merge reports conflicts → Swaft does **not** try to auto-resolve; it surfaces the conflicted files and a "resolve externally, then Reload" action. Reload re-hydrates once the tree is clean.

---

## 8. Components to modify

**Shared contract** — [`packages/shared/src/ops.ts`](packages/shared/src/ops.ts)
- Narrow `StorageMode` to `'local' | 'git'` (drop `p2p`/`server` — unreferenced; see §11/OD-G1). Add `storageMode` to `workspaceCreateRequestSchema`.
- Add a `git.*` op group: `git.status`, `git.commit`, `git.push`, `git.pull`, `git.fetch`, `git.branches`, `git.checkout`, `git.createBranch`, `git.discard`, `git.changes` (+ request schemas, DTOs, `OpContracts` entries, `OP_NAMES`).

**Main process**
- **New** `main/workspace/persistence/` — `WorkspacePersistence` port, `LocalFilePersistence` (extracted from `WorkspaceService`), `GitPersistence`.
- **New** `main/workspace/projection/` — entity registry + DB⇄files serialize/hydrate.
- **New** `main/git/GitService.ts` — the `GitService` interface + `SystemGitService` (execFile) impl; startup git-availability probe.
- **Edit** [`WorkspaceService.ts`](apps/desktop/src/main/workspace/WorkspaceService.ts) — select persistence by mode; stop hard-coding `'local'` (line 80); route create/open/save/close through the port; add a `reload()` path for pull/branch-switch.
- **Edit** [`transport/handlers.ts`](apps/desktop/src/main/transport/handlers.ts) — handlers for the `git.*` ops.
- **Edit** [`services.ts`](apps/desktop/src/main/services.ts) + [`app-bootstrap.ts`](apps/desktop/src/main/app-bootstrap.ts) — register `GitService`; inject the chosen persistence; extend the native dialog to pick **folders** (`properties: ['openDirectory']`) alongside files.
- **Edit** [`AppStore.ts`](apps/desktop/src/main/app-store/AppStore.ts) — let `recent[]` represent a repo folder (add a `mode`/`kind` field; keep back-compat with existing path-only entries).
- **No change** to preload, IPC router, `DbBackend`, `sql.js`, or any domain service — that's the point of §3.1.

**Renderer**
- **New** `renderer/src/git/` — `GitProvider` (context: branch, dirty, changes, ops), `GitPanel` (top-right popover), `GitStatusButton` (trigger). Model on `environment/EnvironmentProvider.tsx` + `EnvironmentPicker.tsx`.
- **Edit** [`WorkspaceView.tsx`](apps/desktop/src/renderer/src/workspace/WorkspaceView.tsx) — mount `GitStatusButton` in `.ws-actions` when mode is git; unhardcode the storage badge (line 226) to read `current.storageMode`; wire a "workspace reloaded" refresh.
- **Edit** [`CreateWorkspaceWizard.tsx`](apps/desktop/src/renderer/src/workspace/CreateWorkspaceWizard.tsx) — storage mode `<Select>` (local/git); Git sub-form (folder vs clone); disable encryption for git.
- **Edit** [`ui/icons.tsx`](apps/desktop/src/renderer/src/ui/icons.tsx) — add branch/git/push/pull icons.
- **Edit** i18n catalogs — new strings; revise `wizard.storageImmutable` and the storage-mode copy.

**Docs** — update `SWAFT_STORAGE_SYNC_MODEL.md`, `SWAFT_DATA_MODEL.md`, `SWAFT_ARCHITECTURE.md` to (a) mark P2P/server **deprecated/removed**, (b) correct `sql.js`-vs-`better-sqlite3` and the encryption-location note, (c) document `local | git` and the persistence-port abstraction.

---

## 9. Implementation plan (phased)

**Phase 0 — Reconcile & deprecate (small, do first).**
Narrow `StorageMode` to `'local' | 'git'`; remove `p2p`/`server` from type, wizard copy, and docs. Introduce the `WorkspacePersistence` port and refactor **today's** behavior into `LocalFilePersistence` with **no functional change** (pure refactor, fully covered by existing `WorkspaceService` tests). Ship this alone; it de-risks everything else.

**Phase 1 — Projection layer (no Git yet).**
Build the DB⇄files registry and a "directory workspace" persistence that reads/writes the folder of JSON + source sidecars (still no git commands). Add round-trip tests: create in DB → dump → hydrate → assert deep equality of all SYNC entities. This is the correctness core; get it bullet-proof before touching git.

**Phase 2 — GitService + panel (folder mode).**
`SystemGitService` (execFile: `status`, `add`, `commit`, `branch`, `checkout`, `pull`, `push`, `fetch`, `restore`); startup availability probe. `git.*` ops + handlers. The top-right `GitPanel` (branch, changes, commit, pull, push, fetch, create branch, discard). Create/open via **folder**. Reload-on-pull/branch-switch flow.

**Phase 3 — Clone from URL + auth.**
In-app clone (system-git first for free SSH/credential-helper support). Destination picker, progress, error surfaces. Store any in-app HTTPS token via `SecretService` (keychain), never in files.

**Phase 4 — Polish & conflict-safety.**
Conflict detection + "resolve externally, then Reload" escape hatch. External-change detection (re-read on window focus / fs watch). Friendly entity names in the changes list. Ahead/behind counters.

**Phase 5 (future) — see §13.**

---

## 10. Risks and open problems

1. **JSON merge conflicts.** Even with stable formatting, two branches editing the same entity conflict. *Mitigations:* one file per entity (small blast radius), sync-meta stripped, sorted keys; extracted source files merge like normal code. Assisted merge is future.
2. **DB↔files drift / external edits.** The truth is on disk; pull, branch-switch, or an external editor invalidate the in-memory DB. *Mitigation:* explicit **reload** after any tree-changing git op; guard unsaved edits first; optional fs-watch in Phase 4.
3. **Multi-file write atomicity.** A save touches many files; a crash mid-save could leave a partial tree. *Mitigation:* write to a temp dir + swap, or write-all-then-`git add`; the repo's own `git status` makes partial state visible and recoverable. Serialize saves through the existing lock queue; ensure git ops share that lock so a commit can't race a save.
4. **Concurrency between save and git ops.** A commit during an in-flight projection could stage half a save. *Mitigation:* run projection-save and all `git.*` ops through one queue.
5. **Secrets leaking into commits.** Env `vars` and settings are plaintext in files. Although *secrets* use the keychain, a careless user could type a token into an env var. *Mitigation:* the generated `.gitignore`, a one-time "this repo is plaintext — don't put secrets in env vars" notice, and (future) a pre-commit scan.
6. **`git` not installed** (system-git approach). *Mitigation:* probe at startup; if absent, disable Git-mode creation with a clear message and (future) offer the bundled isomorphic-git fallback.
7. **Format migrations.** Files carry `formatVersion`; unlike SQL migrations, these are JSON transforms. Need a forward-only file-migration path mirroring the SQL migrator (reject newer, upgrade older). Extra surface to maintain.
8. **Performance on large workspaces.** Dumping N entities to N files and running `git status` on every save. *Mitigation:* dirty-tracking (only re-write changed entities via the `revision` counter), debounce, and keep an optional cached DB image in the git-ignored `.swaft/`.
9. **Cross-platform line endings / path length.** Handled by `.gitattributes` (eol=lf) and short id-based paths (avoid deep nesting → Windows MAX_PATH).
10. **Offline `npm install`** blocks the isomorphic-git route right now — hence system-git first.
11. **Docs will mislead** until updated (see §2.1) — bundle the doc updates with the code.

---

## 11. Open decisions

| ID | Topic | Recommendation |
|----|-------|----------------|
| **OD-G1** | Remove `p2p`/`server` from `StorageMode`, or keep as `@deprecated`? | **Remove.** They're unreferenced; a narrow `'local' \| 'git'` is cleaner. Keep the sync-meta *columns* (cheap, non-breaking) but stop projecting them. |
| **OD-G2** | Git backend: system-git vs bundled isomorphic-git? | **System-git first** (offline-friendly, SSH/creds free); isomorphic-git as a future bundled fallback behind the same interface. |
| **OD-G3** | Filenames: pure id vs slug-based? | **Pure id** (stability/no-rename); friendly name inside the file. Revisit if navigability complaints appear. |
| **OD-G4** | Changelog file vs derive from `git log`? | **Ship `changelog.jsonl`** (append-only merges cleanly) in v1; **future**: unify with git history and drop the redundant file. |
| **OD-G5** | Extract template `source` to a sidecar file? | **Yes** — biggest readability/diff win; API templates stay JSON-only. |
| **OD-G6** | Commit granularity: auto-commit on save vs explicit? | **Explicit commit** via the panel. Save only updates the working tree, which *is* the "see local changes before commit" surface. |
| **OD-G7** | Folder-only vs also in-app Clone in v1? | **Folder first** (no credential handling); Clone in Phase 3. |
| **OD-G8** | Where does the active-environment selection live for git? | **Local only** (`environment_selection`, never committed) — selection is personal, exactly as today. |
| **OD-G9** | Should Git mode ever be encrypted? | **No** (user requirement + the whole point is readable files). Keep encryption exclusive to Local File mode. |

---

## 12. Suggestions & improvements over the initial idea

These are places where I'd diverge from or extend the original brief, with reasons:

1. **Model Git as a persistence backend, not a parallel domain (§3.1).** The initial "second type of Workspace" is right for the user, but implementing it as an orthogonal persistence strategy keeps *every service, repository, IPC op, and view unchanged*. The alternative (rewriting services to read/write files) would be a large, risky rewrite for no user-visible gain.
2. **Keep SQLite as the in-memory working store; project to files only at the persistence edge (§3.3).** Reuses 100% of the query layer; the only new code is a ~10-entry projection registry.
3. **Strip the sync-meta from versioned files (§3.3).** `revision`/`updated_by_device_id`/`updated_at`/`deleted_at` were built for a P2P engine that was never shipped. In Git mode, **git is the version control** — committing those fields would create constant noise and needless conflicts. Deletions become file removals.
4. **Extract template `source` to real, extension-typed files (§4.1).** This is the single biggest "readable & mergeable" win — Markdown/SQL/JS diffs instead of escaped JSON blobs.
5. **Flat, id-keyed layout (§5).** Directly serves the user's "stable & mergeable" goals: files never rename, moves are field edits, no lossy project-nesting.
6. **Shell to system `git` rather than bundling a library (§3.4).** Uniquely respects the project's documented **offline constraint** — it works *today* with nothing to install, and inherits the user's SSH keys, credential helpers, and git config for free.
7. **Generated `.gitattributes` (eol=lf) and `.gitignore` (§4.3).** Cheap, prevents the two most common cross-platform Git headaches (line-ending churn; accidental commit of local caches).
8. **Explicit commits; save just updates the working tree (§6.2 / OD-G6).** Makes "view local changes before commit" fall out of `git status` naturally, and keeps commit authorship intentional.
9. **Reload-on-pull/branch-switch as a first-class flow (§7.4).** The one genuinely new runtime concern; designing it in from the start avoids silent DB↔disk drift.
10. **Do Phase 0 (deprecate p2p/server + extract `LocalFilePersistence`) as a standalone, behavior-preserving refactor** before any git code — it pays down the doc/impl drift and creates the seam cleanly.
11. **Fix the docs as part of the feature (§2.1).** Not glamorous, but the docs currently describe adapters/repositories/`better-sqlite3`/P2P that don't exist; leaving them would mislead every future contributor.

---

## 13. Future evolution of Git mode

- **Multiple remotes** — manage `origin` + additional remotes; per-remote push/pull; upstream tracking UI.
- **Auto-sync** — opt-in background fetch + pull-on-open + push-on-commit (or on a debounce), with conflict-safe guards. Turns Swaft into a lightweight "Dropbox for workspaces" without a server.
- **Assisted conflict resolution** — an entity-aware 3-way merge UI: because files are per-entity JSON with stable keys, Swaft can present "your version / their version / merged" at the *field* level for a template/env, far friendlier than raw text merge.
- **Commit history & time-travel** — read `git log` for a workspace/entity; open any entity "as of" a commit read-only; restore a past release/template version.
- **In-app diff viewer** — render the diff of the *rendered* template or the structured request, not just the raw JSON — a domain-aware diff.
- **Repository templates** — "New workspace from a starter repo" (a curated set of templates/environments) via clone-and-detach.
- **Git LFS** — for large attachments/binary assets a workspace might grow to carry (e.g. big fixtures), with a guided `git lfs track`.
- **Commit signing** — GPG/SSH-signed commits (free when shelling to system git with the user's config); a "verified" badge in history.
- **Protected-branch / review workflow** — commit to a feature branch + "open PR" deep-link to the host (GitHub/GitLab), so workspace changes flow through normal code review.
- **Selective sync / sparse projection** — choose which projects/folders a given clone materializes, for very large shared workspaces.
- **Unify changelog with git history** (OD-G4) — drop the projected `changelog.jsonl` and derive the in-app changelog from commits, removing a redundant, churn-prone file.
- **Pre-commit secret scan** — warn before committing anything that looks like a token/key in env vars or settings.
```
