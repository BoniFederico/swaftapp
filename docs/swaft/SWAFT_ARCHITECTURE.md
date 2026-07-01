# Swaft — Architecture

> **Status:** Implementation-oriented architecture specification.
> **Source of truth:** [`init.md`](init.md) and the Seebo engine docs ([`docs/seebo/`](../seebo/)).
> Elaborations beyond `init.md` are marked **Recommended**; undecided items **Open decision**.
> **Audience:** Frontend engineers, backend engineers, security reviewers.

---

## 1. Architectural Overview

> **Shell decision (consolidated):** Swaft is an **Electron** desktop application. The Electron
> **main process** is Node.js and hosts the backend (services, Seebo, storage, infra). The
> **renderer process** runs the React + Vite UI. Frontend ↔ backend communication is **hardened
> IPC** (not a local HTTP server), accessed through a **transport-agnostic API client** so a future
> web app can swap IPC for HTTP without touching feature code. *(This supersedes the earlier Tauri +
> local-HTTP-API decision in `init.md` §3; see §13 OD-A1.)*

Swaft is a **two-process desktop application** with a clean service boundary:

1. **Electron main process (Node.js)** — the authority for storage, execution and security: service
   layer, Seebo engine host, repositories/storage adapters, and infra services (HTTP, DB, Secret,
   Crypto, Audit, Auth). Heavy work is offloaded to **worker processes** (§4.5, §11).
2. **Electron renderer process (React + Vite, TypeScript)** — the UI only. It holds **UI state only**
   and reaches the backend through a minimal, typed **preload bridge** (`contextBridge`).
3. **Transport abstraction** — the renderer's API client targets a **transport adapter** (IPC on
   desktop; HTTP for the future web app). Feature code is transport-agnostic.

The renderer never touches the filesystem, the network, the database or secrets directly. **All
privileged operations flow through the main-process service layer, which is the single security
enforcement point.** UI-level checks are convenience only.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Electron Application                               │
│                                                                                │
│  ┌─────────────────────────────┐   hardened IPC   ┌───────────────────────────┐ │
│  │  Renderer Process            │  (contextBridge, │  Main Process (Node.js)    │ │
│  │  React + Vite (TypeScript)   │   channel allow- │  authority / enforcement   │ │
│  │  - Working Tree              │   list, typed)   │                            │ │
│  │  - Document/API/Render/DB    │ ───────────────► │  - IPC router (thin)       │ │
│  │    views, Editor, Batcher    │                  │  - Service layer           │ │
│  │  - Auth screens              │ ◄─────────────── │  - Seebo engine host       │ │
│  │  - UI state only             │   typed result   │  - Repository / storage    │ │
│  │                              │                  │  - Infra services          │ │
│  │  API client → transport      │                  │  - Auth / session          │ │
│  │  adapter (IPC | HTTP*)       │                  └──────────┬─────────────────┘ │
│  └─────────────────────────────┘                             │                   │
│                                       ┌──────────────────────┤ utilityProcess /  │
│                                       ▼                       │ worker_threads    │
│                                  heavy tasks (render, crypto, │ (off main thread) │
│                                  large DB/export)             ▼                   │
└──────────────────────────────────────────────────────────────┼───────────────────┘
                                                               │
            ┌──────────────────────────────────┬───────────────┼───────────────┬─────────────┐
            ▼                 ▼                 ▼               ▼               ▼             ▼
     .swaft (SQLite)    OS keychain       remote HTTP      SQLite/PG       P2P peers     web backend*
     workspace file     (secrets +        (allowed         databases       (future)      (* future
     (opt. encrypted)   account creds)     domains/proxy)                                 web app)
```

`* HTTP transport / web backend` is the **future** web-portability path (§12); not built in MVP.

### 1.1 Trust Boundaries

| Boundary | Trusted side | Untrusted / lower-trust side |
|----------|--------------|------------------------------|
| Renderer ↔ Main (IPC) | Main process (enforces all rules) | Renderer (UX only; treated as untrusted content host) |
| Main ↔ `.swaft` data | Main | Workspace data (untrusted content, sanitized) |
| Main ↔ Seebo engine | Main host code | Template source + resolved data (untrusted; Seebo runs them safely) |
| Main ↔ remote HTTP / DB | Main | External endpoints (subject to allowed domains / read-only DB) |
| Main ↔ OS keychain | Main | — (secrets never cross to renderer in clear) |

> **Renderer is untrusted by design.** With `contextIsolation` on, `sandbox` on, and
> `nodeIntegration` off, the renderer cannot reach Node/OS APIs. It only sees the minimal typed
> surface the preload `contextBridge` exposes. Every privileged call is validated in the main
> process before execution (§5, [`SWAFT_SECURITY_MODEL.md`](SWAFT_SECURITY_MODEL.md) §3).

---

## 2. Electron Shell

### 2.1 Process Model

| Process | Role |
|---------|------|
| **Main process (Node.js)** | Backend authority: services, Seebo host, repositories/adapters, infra services (HTTP/DB/Secret/Crypto/Audit/Auth). Owns all filesystem/network/DB/secret access. |
| **Renderer process** | React + Vite UI; UI state only; no Node/OS access. |
| **Preload script** | Runs in an isolated context; exposes a **minimal typed API** over `contextBridge` (channel allow-list). The only bridge between renderer and main. |
| **Worker process(es)** | `utilityProcess` / `worker_threads` for heavy/long tasks (large renders, crypto, big DB result/export streaming) so the main process stays responsive (§4.5, §11). |

### 2.2 Window / Shell Responsibilities

| Responsibility | Detail |
|----------------|--------|
| Window | A single `BrowserWindow` loads the renderer; hardened `webPreferences` (§5.1). |
| Process lifecycle | Main process owns app lifecycle; workers are spawned/supervised by the main process and terminated on exit. |
| Secret storage | Main process accesses OS keychain / secure secret storage (Recommended: `keytar`-style native or Electron `safeStorage`). |
| File dialogs | Native open/save dialogs (main process) for `.swaft` files, imports and exports. |
| Single-instance / file association | **Recommended** single-instance lock; `.swaft` file association/`open-file`. |
| Auto-update | Electron auto-update (e.g. `electron-updater`) — see §12 / MVP packaging. |

### 2.3 Hardened `webPreferences` (mandatory)

`contextIsolation: true` · `sandbox: true` · `nodeIntegration: false` · `nodeIntegrationInWorker:
false` · no `@electron/remote` · strict `Content-Security-Policy` · navigation/`window.open` locked
to app origin (`will-navigate` / `setWindowOpenHandler` deny external). Details and rationale in
[`SWAFT_SECURITY_MODEL.md`](SWAFT_SECURITY_MODEL.md) §3.

> **Packaging:** Electron bundles Node and Chromium, so there is **no separate backend binary** to
> ship and **no local HTTP port** to secure. Native modules (`better-sqlite3`, Postgres driver) are
> built via `electron-builder` + prebuilds/`electron-rebuild`. Code signing/notarization per OS.
> *(This resolves the former sidecar/packaging open decision — §13 OD-A1.)*

---

## 3. React + Vite Renderer (Frontend)

### 3.1 Responsibilities

- Render the UI: Working Tree, Document/API/Render/Database views, Input Panel, Template Editor, Batcher, Settings, **Auth screens**.
- Manage **UI/local state only** (selection, panel visibility, form drafts).
- Call the backend through the **transport-agnostic API client** (IPC adapter on desktop).
- Surface backend-enforced outcomes: blocked operations, confirmations, receipts, errors.

### 3.2 Frontend Module Structure (Recommended)

```
renderer/src/
├── app/                  # App bootstrap, routing, providers, auth/session gating
├── auth/                 # Sign-in / sign-up / session screens and flows
├── shell/                # Workspace shell layout (header + Working Tree + view area)
│   ├── WorkspaceHeader/
│   └── WorkingTree/      # tree, context menus, release selection
├── views/
│   ├── document/         # Input Panel + Main Document View + Action Panel
│   ├── api/              # API View (structured request editor + response + history)
│   ├── render/           # Render View (subtype renderers; heavy renders via worker)
│   └── database/         # Database View (connection, query, results, export)
├── editor/               # Template Editor (all template types)
├── batcher/              # Batcher (document-only composition)
├── settings/             # Workspace Settings, profile
├── api-client/           # Transport-agnostic client for the backend
│   ├── transport/        # transport adapters: ipc.ts (desktop) | http.ts (future web)
│   ├── client.ts         # typed call(channel, payload) + error-envelope mapping
│   └── endpoints/        # per-domain typed endpoint modules
├── domain/               # Shared TS types mirroring backend DTOs (no logic)
├── state/                # UI state stores (Recommended: lightweight, per-view)
├── theme/                # Material-style design tokens, light/dark themes, primary-color palette, ThemeProvider
├── i18n/                 # Localization: string catalogs (it, en), i18n provider, formatters
├── input-widgets/        # Input Panel widget registry (capability → widget mapping)
└── ui/                   # Design-system components, empty/loading/error states
```

### 3.3 Frontend Rules

| ID | Rule |
|----|------|
| **FE-1** | The renderer performs **no** direct filesystem, network, DB or secret access; everything goes through the preload bridge to the main process. |
| **FE-2** | The renderer never receives secrets in clear (only references/labels). |
| **FE-3** | The view shown is determined by template type (`document`→Document View, `api`→API View, `render`→Render View). |
| **FE-4** | The Working Tree is rendered by the shell and is always present. |
| **FE-5** *(Recommended)* | TypeScript is used; backend DTOs are mirrored as TS types in `domain/` (shared package). |
| **FE-6** | The renderer may run Seebo's pure static passes (`validate`/`analyze`) for editor UX, but **authoritative** rendering/execution happens in the main process. |
| **FE-7** | UI is Material-style with light/dark themes via design tokens and a root ThemeProvider; theme, primary color and language are local-only preferences (see [`SWAFT_UI_SPEC.md`](SWAFT_UI_SPEC.md) §23). |
| **FE-8** | All user-facing copy is externalized to i18n catalogs (initial locales `it`, `en`); no hard-coded strings or literal colors in components. |
| **FE-9** | The Input Panel renders inputs via an **input-widget registry** keyed by the requirement's Seebo `capability` (see [`SWAFT_UI_SPEC.md`](SWAFT_UI_SPEC.md) §9.1.1 and §8.2.1 below). |
| **FE-10** | Feature code calls the backend **only** through the transport-agnostic API client; it must not reference IPC/`window` bridge APIs directly (keeps the web target swappable). |
| **FE-11** | UI components are drawn **only** from the shared design system (no one-off components); consistency is enforced (see [`SWAFT_UI_SPEC.md`](SWAFT_UI_SPEC.md) §23.6). |

### 3.4 Transport Abstraction (desktop IPC ↔ future web HTTP)

The renderer's API client is **transport-agnostic**. A `Transport` interface is implemented by:

| Adapter | Target | Mechanism |
|---------|--------|-----------|
| **IpcTransport** | Desktop (Electron) | `contextBridge`-exposed `invoke(channel, payload)` → main-process IPC router. |
| **HttpTransport** *(future)* | Web app | `fetch` to an authenticated HTTP backend hosting the same service layer. |

```
 feature code → endpoints/ → api-client.call(op, payload)
                                   │
                                   ▼
                            Transport (interface)
                          ┌─────────┴──────────┐
                    IpcTransport          HttpTransport (future)
                    (preload bridge)      (remote backend)
```

| ID | Rule |
|----|------|
| **TR-1** | The same operation contract (op name + DTO + error envelope) is used regardless of transport. |
| **TR-2** | Swapping IPC ↔ HTTP must require **no** changes in feature code (only the transport adapter). |
| **TR-3** | Security enforcement lives in the **service layer**, not the transport, so it holds for both desktop and web (§4.4 BE-2). |

---

## 4. Main-Process Backend

### 4.1 Responsibilities (from `init.md` §3.3, hosted in the Electron main process)

- Workspace file access; SQLite-backed `.swaft` storage.
- Template/release persistence; release selection.
- Document rendering (Seebo host), batcher rendering.
- Action execution (via `seebo/actions`).
- HTTP request execution; API history.
- Database connection/query execution; export.
- **Authentication / session management** (sign-up, sign-in, session lifecycle) — §4.6.
- Security enforcement (execution mode, allowed domains, file boundaries, DB restrictions, action confirmation, IPC validation).
- P2P synchronization support (future).
- Secure credential access (OS keychain).

### 4.2 Backend Layering

```
            ┌─────────────────────────────────────────────────────────┐
 inbound    │                     IPC Router (thin)                     │
 (renderer) │   channel allow-list · session/auth guard · DTO          │
            │   validation · error mapping · NO business logic         │
            │   (a future HttpServer adapter maps the same ops to HTTP) │
            └───────────────────────────┬─────────────────────────────┘
                                        │ calls
            ┌───────────────────────────▼─────────────────────────────┐
            │                    Service Layer                          │
            │   auth · workspace · template · release · render ·        │
            │   batcher · action · http · database · settings · sync    │
            │   → enforces ALL security rules (execution mode, allowed  │
            │     domains, DB restrictions, confirmation, session)      │
            └───────┬───────────────┬───────────────┬─────────────────┘
                    │               │               │
        ┌───────────▼──┐   ┌────────▼────────┐  ┌───▼──────────────────┐
        │  Repository   │   │ Engine Host     │  │ Infrastructure       │
        │  / Storage    │   │ (Seebo)         │  │ Services             │
        │  abstraction  │   │ render/analyze/ │  │ HTTP · DB · Secret · │
        │               │   │ actions plan    │  │ Crypto · Audit       │
        └───────┬───────┘   └─────────────────┘  └──────────────────────┘
                │
        ┌───────▼────────────────────────────┐
        │ Storage Adapters                     │
        │  Local (SQLite .swaft) | P2P | Server│
        └──────────────────────────────────────┘
```

### 4.3 Backend Module Structure (Recommended)

```
main/                     # Electron main process
├── bootstrap/            # app lifecycle, BrowserWindow, hardened webPreferences, CSP
├── ipc/                  # IPC router (thin): channel allow-list, session/auth guard,
│   │                     #   DTO validation, error mapping, NO business logic
│   └── channels.ts       # the single registry of allowed channels (ops)
├── preload/              # preload script: contextBridge typed surface (allow-listed)
├── transport/            # op dispatch shared by IPC and (future) HttpServer adapter
├── services/             # Business logic + security enforcement
│   └── auth/             # sign-up/sign-in, session lifecycle, password hashing
├── engine/               # Seebo host: createEngine config, capability wiring,
│                         #   render orchestration, action plan/execute bridge
├── repository/           # Repository interfaces (storage-agnostic)
├── storage/
│   ├── local/            # SQLite .swaft adapter (better-sqlite3)
│   ├── p2p/              # (future)
│   └── server/           # (future)
├── infra/
│   ├── http-client/      # outbound HTTP, auth, proxy, allowed-domain gate
│   ├── db-client/        # SQLite/PostgreSQL drivers, statement guard
│   ├── secret/           # OS keychain / safeStorage bridge
│   ├── crypto/           # whole-file encryption, key derivation, password hashing
│   └── audit/            # audit event sink
├── workers/              # utilityProcess/worker_threads entrypoints (render, crypto, export)
├── security/             # execution-mode policy, restriction evaluation, IPC guards
└── shared/               # DTOs, errors, validation, sync metadata helpers (shared with renderer)
```

### 4.4 Backend Rules

| ID | Rule |
|----|------|
| **BE-1** | The IPC router contains no business logic; it enforces the channel allow-list, validates DTOs, checks the session/auth guard, and delegates to services. |
| **BE-2** | The service layer is the **only** place security rules are enforced; every privileged operation passes through it (so rules hold for both IPC and the future HTTP transport). |
| **BE-3** | Services depend on **repository interfaces**, not concrete storage adapters. |
| **BE-4** | Infrastructure services (HTTP/DB/Secret/Crypto/Audit/Auth) are injected, not imported ad hoc, to keep them mockable and auditable. |
| **BE-5** | The backend never returns secret values to the renderer; only references/labels/metadata. |
| **BE-6** | Every IPC channel is on an explicit allow-list and is guarded by the session/auth check (except the auth channels themselves and a minimal bootstrap set). |

### 4.5 Worker Offloading

To keep the main process (and therefore IPC) responsive, **CPU-heavy or long-running work runs off
the main thread** in `utilityProcess` or `worker_threads`:

| Workload | Why offloaded |
|----------|---------------|
| Heavy Seebo renders / batch renders | Bound CPU; keep IPC responsive. |
| Whole-file encryption / KDF (Argon2id) | CPU/memory intensive. |
| Large DB result handling / CSV-JSON export streaming | Avoid blocking; stream to disk. |
| Large HTTP response processing | Avoid blocking the main thread. |

The DB connection itself (`better-sqlite3` is synchronous) is kept off the main thread (Recommended:
a dedicated DB worker) so synchronous queries never block IPC.

### 4.6 Authentication & Session (overview)

Swaft includes **sign-up / sign-in** and session management (extends `init.md`, which deferred
SSO/OIDC/MFA but assumed a local profile). The **AuthService** owns it:

| Concern | MVP behavior |
|---------|--------------|
| Account model | **Local account** (email/username + password) that owns the local profile. |
| Password storage | Password **verifier** hashed with **Argon2id**; stored secure-local (OS keychain / `safeStorage`), never in `.swaft`, never synchronized. |
| Sign-up | Create the local account + profile; derive and store the verifier. |
| Sign-in | Verify the password; establish an in-memory **session** (the renderer is gated until signed in). |
| Session lifetime | Bound to the app session; lock on timeout/lock action (Recommended); re-auth to unlock. |
| IPC guard | Non-auth IPC channels require an active session (BE-6). |
| Future | SSO/OIDC, MFA, server-backed accounts plug into AuthService later (see [`NEXT_STEPS.md`](NEXT_STEPS.md)). |

> Auth data model is in [`SWAFT_DATA_MODEL.md`](SWAFT_DATA_MODEL.md) §20; security requirements in
> [`SWAFT_SECURITY_MODEL.md`](SWAFT_SECURITY_MODEL.md) §3a.

---

## 5. Renderer ↔ Main IPC (hardened) & Transport

The former "secure local HTTP API" is **replaced by hardened Electron IPC**. There is no local HTTP
server and no network port in the desktop app; the only renderer→main surface is the allow-listed
`contextBridge` API.

### 5.1 IPC Security Properties

| Property | Requirement |
|----------|-------------|
| Isolation | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. The renderer has no Node/OS access. |
| Bridge | Preload exposes a **minimal, typed** API via `contextBridge`; no raw `ipcRenderer` is exposed. |
| Channel allow-list | Only explicitly registered channels (ops) are callable; unknown channels are rejected. |
| Auth guard | Non-auth channels require an active session (§4.6). |
| Validation | Every payload is validated against its DTO schema in the main process before any service runs. |
| Sender check | The main process verifies the IPC sender frame is the app's own window (no remote/iframe senders). |
| CSP / navigation | Strict CSP; external navigation and `window.open` are denied; only the app origin loads. |
| No network surface | No loopback port, no CORS to manage — the desktop attack surface of a local server is removed. |

### 5.2 Request/Response Contract

- Each operation is an **op** (channel) with a **structured JSON-serializable** request and response DTO.
- The session/auth guard is enforced in the main process per op (not via a transmitted token over a port); non-auth ops require an active session.
- Blocked operations return a **clear, coded error** (Recommended shape below) — never a silent failure and never leaking secret values. The same envelope is used by the future HTTP transport.

```jsonc
// Recommended error envelope (transport-agnostic)
{
  "error": {
    "code": "DOMAIN_NOT_ALLOWED",      // stable code
    "message": "Host api.example.com is not in the workspace allow-list.",
    "category": "policy",              // policy | validation | execution | auth | not_found | internal
    "details": { "host": "api.example.com" }   // never contains secrets
  }
}
```

### 5.3 Operation Categories (from `init.md` §19.2, plus auth)

Authentication & session · Workspace lifecycle · Working Tree operations · Template CRUD · Release
management · Release selection · Document rendering · Batcher rendering · Action execution · HTTP
request execution · API history management · Database connection & query execution · Database export
· Settings & restrictions · P2P device/invitation management (future) · Secure credential references.

### 5.4 Mandatory Backend Enforcement Points (from `init.md` §19.3)

| Operation | Backend enforcement |
|-----------|---------------------|
| Any non-auth op (IPC) | Channel allow-list, sender-frame check, active-session guard, DTO validation |
| HTTP request execution | Allowed domains, proxy rules, credential access |
| Database query execution | Read-only default, dangerous-statement blocking, execution mode |
| File-write action | Workspace/export-folder boundary in sandbox mode |
| Action execution | Confirmation requirement, dangerous-action blocking |
| P2P sync (future) | Device identity, allowlist, invitation signature, revocation |
| Credential retrieval | OS keychain / secure secret storage |

---

## 6. Module Boundaries and Service Layer

### 6.1 Core Services

| Service | Responsibility | Key enforcement |
|---------|----------------|-----------------|
| **AuthService** | Sign-up/sign-in; password hashing (Argon2id); session lifecycle; lock/unlock. | Verifier secure-local; IPC session guard; no secrets to renderer. |
| **WorkspaceService** | Create/open/close workspace; storage mode (immutable); encryption lifecycle. | Storage-mode immutability; encryption warnings. |
| **TemplateService** | Template CRUD, draft editing, clone/rename/delete; tag/project/folder association. | Type/subtype validity. |
| **ReleaseService** | Create immutable releases; list; changelog. | Release immutability; linear versioning. |
| **ReleaseSelectionService** | Per-template personal release selection. | Local-only; never synchronized. |
| **RenderService** | Drive Seebo to render document templates; collect requirements + action plan. | Capability allow-list; output limits. |
| **BatcherService** | Compose document templates; resolve shared inputs once; apply merge macros. | Document-only; ordered. |
| **ActionService** | Bridge to `seebo/actions`; confirmation gating; `Perform all` fail-fast; receipts. | Confirmation; allowed actions; sandbox blocking. |
| **HttpService** | Execute structured HTTP requests; auth; proxy; history. | Allowed domains; proxy rules; credential access. |
| **DatabaseService** | Connect; execute queries; export; metadata history. | Read-only default; dangerous-statement blocking. |
| **SettingsService** | Workspace settings, restrictions, execution mode. | Restriction integrity; permission to enter `dev`. |
| **SecretService** | Store/reference/retrieve secrets via OS keychain. | Secrets never returned in clear to FE. |
| **AuditService** | Record security-relevant events. | Append-only; redaction. |
| **SyncService** *(future)* | P2P/server synchronization, device trust. | Device identity, allowlist, revocation, LWW. |

### 6.2 Dependency Direction

```
ipc-router → services → (repository interfaces | engine host | infra services)
services → repository interfaces → storage adapters
(future) http-server → services   (same services, different transport)
```

- Dependencies flow **inward** toward services; storage adapters and infra services are implementations behind interfaces.
- The **transport** (IPC router today, HTTP server later) is a thin entrypoint; it never holds business logic, so both transports reuse identical services and enforcement.
- The **Seebo pure core** is never asked to perform effects; only the backend's ActionService invokes `seebo/actions`.

---

## 7. Repository / Storage Abstraction

### 7.1 Principle

The service layer talks to **repository interfaces** (e.g. `TemplateRepository`,
`ReleaseRepository`, `SettingsRepository`, `HistoryRepository`). Concrete persistence is provided
by a **storage adapter** selected by the workspace's immutable storage mode.

```
        ┌──────────────────────────────────────────────┐
        │              Repository Interfaces             │
        │  TemplateRepo · ReleaseRepo · SettingsRepo ·   │
        │  HistoryRepo · ReceiptRepo · DeviceRepo …      │
        └───────────────┬───────────────┬───────────────┘
                        │ implemented by │
        ┌───────────────▼──┐  ┌──────────▼──────┐  ┌──────────────┐
        │  LocalAdapter     │  │  P2PAdapter     │  │ ServerAdapter│
        │  (SQLite .swaft)  │  │  (future)       │  │ (future)     │
        └──────────────────┘  └─────────────────┘  └──────────────┘
```

### 7.2 Storage Adapter Contract (Recommended)

| Concern | Contract |
|---------|----------|
| Synchronized entities | CRUD + carry sync metadata (`updatedAt`, `updatedByDeviceId`, `revision`, `deletedAt`; logical clock if used). |
| Local-only entities | CRUD; never emitted to sync. |
| Secure-local references | Store only references; values via SecretService. |
| Transactions | Atomic writes within a workspace operation. |
| Encryption | Local adapter integrates whole-file encryption transparently (CryptoService). |

> Detailed sync metadata and conflict rules are in [`SWAFT_STORAGE_SYNC_MODEL.md`](SWAFT_STORAGE_SYNC_MODEL.md).

### 7.3 Storage Adapters

| Adapter | Mode | Status | Notes |
|---------|------|--------|-------|
| **LocalAdapter** | `local` | **MVP** | Single `.swaft` SQLite file; optional whole-file encryption; authoritative local store. |
| **P2PAdapter** | `p2p` | **Future** | Real-time sync over LAN/internet/both; device trust; LWW; reuses repository interfaces. |
| **ServerAdapter** | `server` | **Future / reserved** | Server-backed storage; details undefined; must not break local/P2P classification. |

---

## 8. Seebo Integration

### 8.1 Engine Host

The backend hosts the Seebo engine via `createEngine(config)`. Swaft supplies:

- **Vocabulary**: builtins plus any Swaft-registered types/functions/macros (Recommended: minimal in MVP).
- **Capabilities**: the resolution layer that feeds `require(...)` inputs — including the **Input Widget capability catalog** (§8.2.1) that drives the Input Panel, plus any Swaft data-source capabilities.
- **Policy**: `allowedCapabilities` (must include the input-widget capabilities), `allowedFunctions`/`allowedTypes`, `trustLevel`, `capabilityRules`, `redact`, `audit`, and `action` policy (allowed action types/environments, forced confirmation).
- **Limits / clock / locale**: resource bounds, injected clock (determinism), workspace locale.

### 8.2 Document Rendering Flow

Seebo's pure core is synchronous; the only async layer is the driver. Swaft renders a document template as follows:

```
 Input Panel values ──┐
                      ▼
 RenderService: engine.start(template, values)
       │
       ▼
 engine.run(state)  ──►  status: 'waiting' (pending requirements)
       │                        │
       │                 RenderService resolves via capabilities / Input Panel
       │                 (interactive needs surfaced to UI via stopOn)
       ▼
 status: 'completed' ──► output (rendered document)
       │
       ▼
 result.actions (ActionPlan)  ──►  Action Panel shown only if non-empty
```

- **Requirements → Input Panel.** `analyze(template).requirements` (with `options` from
  `type.constraints.values`) drives Input Panel field generation. Each requirement's **`capability`**
  selects the input widget (§8.2.1). Interactive requirements are returned to the UI using `stopOn`,
  filled by the user, then resolution resumes.
- **Last input values** are persisted **local-only** per template and pre-fill the Input Panel.
- **Actions** are *prepared only* by the core (`result.actions` / `analyze(...).actions`); they are
  never executed during rendering (see §9).

### 8.2.1 Input Widget Capabilities

Swaft registers a **catalog of input capabilities**, one per frontend input widget (textbox,
textarea, number, boolean, listbox, multi-option, JSON input, datetime, duration — see
[`SWAFT_UI_SPEC.md`](SWAFT_UI_SPEC.md) §9.1.1). This is the mechanism by which a template input maps
to a concrete UI control.

| Aspect | Detail |
|--------|--------|
| Registration | Each input capability is registered in the Seebo host (`createEngine` `capabilities`) and added to `policy.allowedCapabilities`. |
| Authoring | A template input is `require({ id, type, capability: '<widget>' , ... })`; the author picks the capability (widget) in the Template Editor. The choice is part of the template definition and is captured in releases. |
| Resolution model | Input capabilities are **interactive**: their resolver yields no value on its own; at render time they are listed in `stopOn`, so their requirements are returned to the Input Panel, the user supplies values, and resolution resumes. |
| Widget mapping | The frontend reads each requirement's `capability` and renders the mapped widget; `type` + `options` refine it (coercion, select choices). |
| Extensibility | New widgets are added by registering a new input capability + a frontend widget, without changing the rendering flow or the Input Panel contract. |

```
 Template input:  require({ id:'plan', type: array().constraints({ values:['Free','Pro'] }),
                            capability:'multiOption', label:'Plans' })
        │  analyze() ──► requirement { id:'plan', capability:'multiOption', options:['Free','Pro'] }
        ▼
 Input Panel:  capability 'multiOption' ──► multi-select widget, choices = options
        │  user selects values ──► resolved
        ▼
 render resumes with the provided values
```

| ID | Rule |
|----|------|
| **INPUTCAP-1** | The Input Panel selects each widget by the requirement's **capability**, not by type alone. |
| **INPUTCAP-2** | Input capabilities are interactive (resolved by the host UI via `stopOn`). |
| **INPUTCAP-3** | The input-capability set is part of `allowedCapabilities`; Recommended: allowed by default in every workspace. |

### 8.3 Seebo State Persistence (Recommended)

`PublicState` is JSON-serializable. Swaft does **not** need to persist intermediate state across
sessions for MVP; rendering is re-driven from the template + last input values. Persisting in-flight
state is an optional future optimization.

---

## 9. Action Execution Integration

### 9.1 Preparation vs. Execution

Per Seebo's contract, the **pure core never executes an action** — it only prepares an
`ActionPlan`. Execution happens solely through `seebo/actions`, invoked by Swaft's **ActionService**.

```
 RenderService ── result.actions (ActionPlan) ──► UI Action Panel
                                                       │  user reviews + confirms
                                                       ▼
 ActionService.executePlan(plan, {
     confirmedActions,      // only confirmed ids may run
     failFast: true,        // 'Perform all' stops at first error
     actor, permissions,    // permission checks (fail-closed)
     environment,           // sandbox/dev-derived
     clients,               // injected effect clients
     audit, redact          // audit + redaction hooks
 })
        │
        ▼
 ActionReceipt[] ── persisted as LOCAL-ONLY receipts ──► UI Receipts
```

### 9.2 Swaft Enforcement Around Actions

| Rule | Enforcement |
|------|-------------|
| Every action requires confirmation | ActionService passes only confirmed ids in `confirmedActions`; backend gate, not UI-only. |
| `Perform all` is fail-fast | `failFast: true`: execute in document order, stop on first failure; remaining not executed; failure surfaced. |
| Sandbox blocks dangerous actions | Execution-mode policy denies disallowed action types/environments (fail-closed). |
| Allowed actions per workspace | Restriction-derived `allowedActions` enforced before any handler runs. |
| Receipts visible + local-only | Receipts persisted as local-only data and shown in UI. |
| Actions are code-defined (v1) | Handlers registered in backend host code via `defineAction`; no plugin/UI-defined actions in v1. |

---

## 10. Infrastructure Services

### 10.1 HTTP Client Service

| Aspect | Detail |
|--------|--------|
| Execution | **All** API-template and template-driven HTTP calls run here (never in the frontend). |
| Model | Structured request object (method, url, headers, query, body, auth) — never cURL canonically. |
| Auth | Bearer token, Basic auth, API key (MVP). Credentials resolved from SecretService. |
| Allowed domains | Outbound host checked against per-workspace allow-list **before** the request; blocked → coded error. |
| Proxy | Proxy configuration supported; proxy credentials stored securely. |
| History | Per-template call history; metadata-only (Recommended); deletable per record; clearable per template; local-only. |

### 10.2 Database Client Service

| Aspect | Detail |
|--------|--------|
| Engines | SQLite, PostgreSQL (MVP). |
| Default | **Read-only** (`readOnlyDefault: true`). |
| Dangerous statements | `DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `TRUNCATE`, `CREATE` blocked unless dev permissions allow. Sandbox forbids writes outright. |
| Credentials | Stored in OS keychain / secure secret storage; never in `.swaft`, never synchronized. |
| History | Metadata-only, local-only, not synchronized (no result rows stored). |
| Export | CSV, JSON. |
| Seebo coupling | DB results are **not** Seebo inputs (v1). |
| Masking | Not required (v1). |

> **Recommended statement guard:** parse/classify statements server-side; default-deny anything not
> provably read-only. Do not rely on string matching alone for PostgreSQL (use a parser or
> read-only transaction / role).

### 10.3 Secret Service

- Single gateway to OS keychain / secure secret storage.
- Stores: HTTP auth secrets, API keys, DB credentials, proxy credentials, workspace encryption material.
- Returns **references/labels** to the frontend; **never** clear values.
- Secrets are never written to `.swaft` synchronized data and never synchronized.

### 10.4 Crypto Service

- Implements **optional whole-file encryption** of the `.swaft` workspace.
- Key derivation from user password/key; **no recovery** if lost (no backdoor).
- Encryption metadata must not expose sensitive contents.
- Integrated transparently into the LocalAdapter open/save path.

> **Open decision:** Exact KDF/cipher and whether MVP ships full encryption or a warning-grade
> placeholder (see [`SWAFT_MVP_SCOPE.md`](SWAFT_MVP_SCOPE.md)). Recommended: authenticated encryption
> (e.g. AES-GCM or XChaCha20-Poly1305) with a memory-hard KDF (e.g. Argon2id).

### 10.5 Audit Service

- Records security-relevant events: action executions/denials, blocked HTTP domains, blocked DB statements, credential access, (future) P2P device events.
- **Recommended:** append-only; redaction of sensitive values; local in MVP, synchronizable design deferred.

---

## 11. Performance Considerations

Electron is heavier than a native shell, so performance is a **first-class design constraint**: keep
the main thread and IPC responsive, render efficiently, and never block on heavy work. These are
binding guidance (the user requested performance-conscious decisions throughout).

### 11.1 Process & IPC

| ID | Consideration | Guidance |
|----|---------------|----------|
| **PERF-1** | Main-thread protection | The main process must stay responsive; offload CPU-heavy/long work to `utilityProcess`/`worker_threads` (§4.5). Never run heavy synchronous work on the main thread that serves IPC. |
| **PERF-2** | IPC chattiness | Batch/debounce chatty calls (tree expansion, editor validation); prefer coarse ops over many fine ones. Avoid sending large payloads across IPC — paginate/stream and pass handles/cursors. |
| **PERF-3** | IPC payload size | Keep DTOs lean; stream large DB/HTTP/export payloads to disk and return references, not megabytes over IPC. |
| **PERF-4** | Renderer ↔ worker | Heavy renders (mermaid/echarts/swagger) and parsing run in a Web Worker (renderer) or a main-side worker, not on the React render thread. |

### 11.2 Renderer

| ID | Consideration | Guidance |
|----|---------------|----------|
| **PERF-5** | Bundle size / startup | Code-split by route/view (Vite dynamic import); lazy-load heavy views (DB grid, charts, swagger). Production build; no devtools in prod. |
| **PERF-6** | Long lists | Virtualize the Working Tree and DB result grids; avoid rendering thousands of DOM nodes. |
| **PERF-7** | Editor responsiveness | Run Seebo `validate`/`analyze` (pure, synchronous) for inline feedback; debounce; move large parses to a worker. Authoritative render stays in the backend. |
| **PERF-8** | Re-render discipline | Memoize; keep UI state local/per-view; avoid a heavy global store that re-renders the app on every change. |
| **PERF-9** | Memory | One `BrowserWindow`; dispose listeners/subscriptions; avoid leaks in long sessions; cap in-memory history/result buffers. |

### 11.3 Backend & Data

| ID | Consideration | Guidance |
|----|---------------|----------|
| **PERF-10** | SQLite | Use `better-sqlite3` (fast, synchronous) on a dedicated DB worker; WAL journaling; prepared statements; indices on hot lookups (template/folder/project, history by template). |
| **PERF-11** | DB result sets | Stream/paginate query results; export streams to file; never persist result rows in history. |
| **PERF-12** | HTTP responses | Cap/stream large responses; store only metadata in history. |
| **PERF-13** | Seebo limits & cache | Apply Seebo's configurable limits (input/token/node/nesting/step/output, phases, timeout); enable `astCache` for `analyze` where helpful; v1 resumes by full re-evaluation, so keep templates within limits. |
| **PERF-14** | Encryption I/O | Whole-file encryption is full-file load/save; run KDF/cipher in a worker; consider chunked re-encryption for large workspaces (future). |

| ID | Rule |
|----|------|
| **PERF-R1** | A change that introduces blocking work on the main process or the React render thread is not acceptable; move it to a worker. |
| **PERF-R2** | Establish performance budgets (Recommended): cold start, workspace open, render latency, DB query first-row; track in CI smoke (see [`SWAFT_MVP_SCOPE.md`](SWAFT_MVP_SCOPE.md)). |

---

## 12. Future Web App Portability

The architecture is designed so a **limited web app** can reuse most layers, via the **transport
abstraction** (§3.4): desktop uses the IPC transport; the web app swaps in an HTTP transport against
a hosted backend running the **same service layer**.

| Layer | Desktop (Electron) | Future Web App |
|-------|--------------------|----------------|
| Renderer (React + Vite) | Reused as-is | Reused; transport adapter set to HTTP. |
| Transport | **IpcTransport** (preload bridge) | **HttpTransport** to an authenticated remote backend. |
| Op/DTO/error contract | Shared, transport-agnostic | **Identical** contract over HTTP. |
| Service layer | Electron main process | Same services hosted server-side. |
| Auth | Local account + session (AuthService) | Server-backed accounts/SSO (same AuthService contract, different impl). |
| Repository / adapters | LocalAdapter (SQLite `.swaft`) | Server/P2P adapters; `local`-file semantics not applicable. |
| Seebo host | Main process | Server — Seebo runs identically client or server. |
| Secrets | OS keychain / `safeStorage` | Server-side secret management (different SecretService impl). |

| ID | Portability rule |
|----|------------------|
| **WEB-1** | The renderer accesses the backend **only** through the transport-agnostic API client; no direct IPC/`window`-bridge usage in feature code (FE-10). |
| **WEB-2** | The op/DTO/error contract is stable and transport-agnostic; the HTTP transport reuses it verbatim. |
| **WEB-3** | Security enforcement lives in services (not the transport), so it survives a hosted deployment. |
| **WEB-4** | OS-keychain and local-file behaviors are adapter concerns, swappable for the web target. |
| **WEB-5** | Electron-only APIs (dialogs, `safeStorage`, file association) sit behind a thin **platform shim** so the renderer never calls them directly. |

> **Note:** The web app is explicitly a *future, limited* target ([`NEXT_STEPS.md`](NEXT_STEPS.md)).
> No web-specific feature is in scope now; the requirement is only that the boundaries above stay clean.

---

## 13. Open Decisions (Architecture)

| ID | Topic | Recommendation |
|----|-------|----------------|
| ~~**OD-A1**~~ | Desktop shell / backend packaging. | **Resolved:** **Electron** (main process = Node backend; hardened IPC; transport abstraction). No sidecar/local-HTTP. |
| **OD-A2** | Seebo in-flight state persistence across sessions. | Not persisted in MVP; re-drive from template + inputs. |
| **OD-A3** | Encryption primitives and MVP depth. | Argon2id + AEAD; ship at least warning + adapter hook in MVP. |
| **OD-A4** | DB statement-guard implementation (parser vs read-only role). | Prefer read-only role/transaction + parser; never string-match alone. |
| **OD-A5** | Frontend state library. | Lightweight per-view stores; avoid heavy global state. |
| **OD-A6** | Audit storage location and sync. | Local-only in MVP; synchronizable design deferred. |
| **OD-A7** | Auth account scope (local-only vs server-ready). | Local account in MVP; AuthService contract designed for future server/SSO. |
| ~~**OD-A8**~~ | Worker strategy (`utilityProcess` vs `worker_threads`). | **Resolved: `worker_threads`** as the default for offloaded work (DB, crypto, render, export). `utilityProcess` may still be used where full process isolation is specifically required. |
