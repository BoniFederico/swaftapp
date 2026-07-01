# Swaft — MVP Scope & Delivery Plan

> **Status:** Implementation-oriented MVP scope, milestones, and readiness criteria.
> **Source of truth:** [`init.md`](init.md) §21. Elaborations are marked **Recommended**; undecided
> items **Open decision**.
> **Audience:** Product, engineering leads, QA, frontend/backend engineers.
> **Companions:** all other `docs/swaft/*` documents.

---

## 1. MVP Objective

Deliver a **local-first, desktop Swaft application** that lets a single user create a local
`.swaft` workspace and productively author, version, render and execute the three template types,
with a real HTTP client, a read-only database client, code-defined confirmable actions, and the
core security model — **with the synchronization architecture in place but P2P/server
unimplemented.**

| ID | MVP success statement |
|----|-----------------------|
| **OBJ-1** | A user can sign up/sign in, then create/open a local `.swaft` workspace (optionally encrypted) and work entirely offline. |
| **OBJ-2** | Document, API and Render templates work end-to-end, including Seebo rendering, inputs, releases and changelog. |
| **OBJ-3** | Real HTTP calls and read-only SQLite/PostgreSQL queries run through the main-process backend with enforced restrictions. |
| **OBJ-4** | Seebo-generated actions are displayed, confirmed, executed (fail-fast), and produce visible receipts. |
| **OBJ-5** | The data model correctly classifies synchronized / local-only / secure-local data, so P2P/server can be added later without redesign. |
| **OBJ-6** | The app is responsive (performance budgets met) and visually coherent (single design system). |
| **OBJ-7** | Every milestone is **test-gated**: its tests are written and pass before the next milestone starts. |
| **OBJ-8** | Renderer↔main is hardened IPC; feature code is transport-agnostic, keeping the future web target viable. |

---

## 2. Recommended MVP Scope (in)

### 2.1 Platform & Foundation
- **Electron** desktop app: Node.js **main process** (backend) + React + Vite **renderer** (TypeScript).
- **Hardened IPC** (context isolation, sandbox, channel allow-list, session guard) via a typed preload bridge.
- **Transport-agnostic API client** (IPC adapter now; HTTP adapter reserved for future web).
- **Worker offloading** (`utilityProcess`/`worker_threads`) for heavy tasks (DB, crypto, render, export).
- **Sign-up / sign-in + session** (local account; Argon2id verifier in secure storage).
- **Design system foundation**: shared component library, theme (light/dark) + primary color, i18n (it/en).
- **Test harness** wired from day one (unit/component + Electron e2e) and run after every step.

### 2.2 Storage
- Local `.swaft` SQLite workspace (single file, portable, authoritative).
- Optional whole-file encryption (at minimum: adapter hook + unrecoverability warning; full crypto if feasible — see §9 risk).
- Storage-mode immutability; `local` enabled; `p2p`/`server` reserved in the model.
- Sync metadata columns present on synchronized entities (architecture-ready).

### 2.3 Navigation & Organization
- Always-visible Working Tree.
- Projects (tree filters), Folders (collections), Tags.
- Template context menu: Open, Edit, Rename, Clone, Delete, Select release.

### 2.4 Templates & Rendering
- Document, API, Render templates with their subtypes.
- Template Editor (incl. choosing the input-widget capability per input).
- Input Panel (requirement-driven, **input-widget capabilities**, last-input persistence — local-only).
- Input-widget capability catalog: at minimum textbox, number, boolean, listbox, multi-option, JSON input (import/drag-and-drop); datetime/duration/textarea Recommended.
- Seebo rendering integration (document) and render-subtype rendering (render view).
- Releases (immutable, linear) + basic changelog.
- Personal, local-only release selection.

### 2.4.1 Experience (UX)
- Modern, minimal, Material-style UI with **light and dark themes** (design tokens + root ThemeProvider).
- User-selectable **primary color** (4–5 options) and **language** (Italian, English) in Preferences (local-only).
- i18n with externalized strings; theming/i18n best practices.

### 2.5 Execution
- API View with real HTTP calls via backend: Bearer/Basic/API-key auth, allowed domains, proxy; per-template API history (deletable/clearable; metadata-only).
- Basic Database View: SQLite + PostgreSQL, read-only; dangerous-statement blocking; CSV/JSON export; metadata-only history; credentials in OS keychain.
- Actions: code-defined; display, confirmation, `Perform all` fail-fast, visible receipts.
- Document-only Batcher with shared-input resolution and Seebo merge macros.

### 2.6 Security
- Backend enforcement of execution mode, allowed domains, file boundaries, DB restrictions, action confirmation.
- Sandbox mode basics; dev mode permission gating.
- OS keychain / secure secret storage for all secrets.

---

## 3. Deferred / Out of MVP

| Deferred item | Rationale |
|---------------|-----------|
| Full **P2P** synchronization | Large; architecture is prepared (model + sync metadata) but not implemented. |
| **Server** storage mode | Future; details undefined. |
| **SSO/OIDC**, **email MFA** | Future auth features; local mode needs only a local profile. |
| **Plugin-defined actions** / marketplace | v1 actions are code-defined. |
| **Advanced permission system** | Beyond sandbox/dev gating. |
| **cURL import/export** | API model is structured; import/export is future. |
| **Advanced DB write workflows** | Read-only-first posture. |
| **Advanced encryption implementation** | If too large for MVP, ship warning + adapter hook. |
| **Configurable full HTTP history** | Metadata-only default (Open decision OD-1). |
| **Automatic DB column masking** | Not required v1. |
| **DB results as Seebo inputs** | Not required v1. |
| **Treating receipts/histories/preferences as synced** | They are local-only by design. |

---

## 4. Milestone Phases

> Phases are an ordered **Recommended** delivery sequence. Each builds on the prior; security
> enforcement is not deferred — it lands with the feature it protects. **Every phase is test-gated:**
> its tests are written and must pass before the next phase begins (OBJ-7). The **step-by-step,
> LLM-ready prompts** for these phases live in [`MVP_STEPS.md`](MVP_STEPS.md); this section is the
> summary.

### Phase 0 — Foundation, Shell, IPC, Design System, Test Harness
**Goal:** A running **Electron** app with the hardened IPC boundary, transport abstraction, design-system + theme/i18n foundations, and the test harness.

- Electron main+renderer scaffold (React/Vite, TypeScript); hardened `webPreferences`; CSP; single-instance.
- Preload `contextBridge` + IPC router (channel allow-list, DTO validation, error envelope); transport-agnostic API client (IPC adapter).
- Worker scaffolding (`utilityProcess`/`worker_threads`).
- Design system foundation (shared components, tokens), ThemeProvider (light/dark + primary color), i18n (it/en).
- Test harness (unit/component + Electron e2e) + CI; performance-budget scaffolding.

### Phase 1 — Authentication & Session
**Goal:** App gated by sign-up/sign-in with a local account.

- AuthService: sign-up, sign-in, Argon2id verifier in secure storage, session lifecycle, lockout/back-off.
- IPC session guard (non-auth ops require a session).
- Auth screens (sign-up/sign-in/locked); sign-out + lock.

### Phase 2 — Local Workspace & Persistence
**Goal:** Create/open a local `.swaft` workspace and persist core entities.

- LocalAdapter (SQLite `.swaft`, `better-sqlite3` on a DB worker); repository interfaces; schema with `schemaVersion` + sync-metadata columns.
- Workspace, project, folder, tag, settings, restriction CRUD.
- Working Tree (virtualized) + context menu (Open/Edit/Rename/Clone/Delete/Select release).
- Optional whole-file encryption (at least warning + adapter hook; full crypto if feasible).

### Phase 3 — Templates, Rendering, Releases
**Goal:** Author and render Document & Render templates; releases + changelog.

- Template CRUD; Template Editor; draft model per type; input-widget capability authoring.
- Seebo host wiring (renders on a worker); Document View (Input Panel + Main Document View).
- Input-widget capabilities + requirement-driven Input Panel; last-input persistence (local-only).
- Render View with subtype renderers (heavy renders on a worker).
- Releases (immutable, linear) + basic changelog; personal release selection.

### Phase 4 — API & Database Clients
**Goal:** Real HTTP and read-only DB clients with enforced restrictions.

- API View; structured request model; backend HTTP client; Bearer/Basic/API-key; allowed domains; proxy.
- API history (metadata-only; deletable/clearable).
- Database View; SQLite + PostgreSQL; read-only default; dangerous-statement blocking; CSV/JSON export (streamed); metadata history; credentials in OS keychain.

### Phase 5 — Actions & Batcher
**Goal:** Confirmable action execution and document composition.

- ActionService bridge to `seebo/actions`; Action Panel (only when actions exist).
- Confirmation enforcement; `Perform all` fail-fast; visible, redacted receipts.
- Sandbox/dev gating for actions; allowed-actions enforcement.
- Document-only Batcher: drag-and-drop, ordered, shared-input-once, merge macros.

### Phase 6 — Hardening, Performance, Polish & Release Readiness
**Goal:** Security review, performance, UI coherence, packaging.

- Full enforcement-matrix review; IPC hardening audit; audit events; redaction.
- Performance pass (worker offloading, virtualization, streaming, budgets) and budget verification.
- UI coherence pass (single design system, empty/loading/error states, accessibility AA).
- Packaging/signing/notarization + auto-update; schema-version gating; docs alignment.

---

## 5. Acceptance Criteria per Milestone

> Each phase also requires its tests written and **green** before proceeding (OBJ-7).

### Phase 0 — Foundation, Shell, IPC, Design System
| ID | Criterion |
|----|-----------|
| AC0-1 | The Electron app launches a single hardened window (`contextIsolation`/`sandbox` on, `nodeIntegration` off) with a strict CSP. |
| AC0-2 | The renderer reaches the main process **only** via the allow-listed preload bridge; unknown channels and external navigation are rejected (verified by tests). |
| AC0-3 | The transport-agnostic API client performs a round-trip op via the IPC adapter; the error envelope is returned for a failing op. |
| AC0-4 | ThemeProvider switches light/dark and primary color; i18n switches it/en; a shared design-system sample renders. |
| AC0-5 | The test harness runs unit/component + an Electron e2e smoke in CI. |

### Phase 1 — Authentication & Session
| ID | Criterion |
|----|-----------|
| AC1-1 | First run shows sign-up; an account is created with an Argon2id verifier stored in secure storage (never in clear, never in a file). |
| AC1-2 | Sign-in succeeds with the right password and fails generically with the wrong one; repeated failures trigger back-off/lockout. |
| AC1-3 | Until signed in, all non-auth IPC ops are rejected by the session guard (verified by tests). |
| AC1-4 | Sign-out and lock end/lock the session; unlocking requires the password; the verifier never reaches the renderer. |

### Phase 2 — Local Workspace & Persistence
| ID | Criterion |
|----|-----------|
| AC2-1 | A `local` workspace can be created, closed and reopened as a single `.swaft` file. |
| AC2-2 | Storage mode is immutable; no UI affordance changes it. |
| AC2-3 | Projects/folders/tags/settings CRUD persists and survives reopen; the Working Tree is virtualized. |
| AC2-4 | If encryption is enabled, opening with the wrong password fails clearly; the unrecoverability warning is shown at creation. |
| AC2-5 | Synchronized entities carry `updatedAt`, `updatedByDeviceId`, `revision`, `deletedAt`; DB access runs off the main thread. |

### Phase 3 — Templates, Rendering, Releases
| ID | Criterion |
|----|-----------|
| AC3-1 | A document template renders via Seebo; requirements appear in the Input Panel with the correct **widget per capability**, type and options. |
| AC3-2 | Last input values persist locally and pre-fill on reopen; they are not synchronized (verified at storage layer). |
| AC3-3 | A render template displays its subtype output (view-only; no Input/Action panel); heavy renders run on a worker. |
| AC3-4 | Creating a release produces an immutable, linearly versioned snapshot; editing the draft does not change releases. |
| AC3-5 | Release selection via the three-dot menu changes the rendered release for that user only and is not synchronized. |

### Phase 4 — API & Database Clients
| ID | Criterion |
|----|-----------|
| AC4-1 | An API template executes a real HTTP request through the backend and shows the response. |
| AC4-2 | A request to a non-allowed domain is blocked by the backend with a clear coded error. |
| AC4-3 | Bearer/Basic/API-key auth works; secrets are stored in OS keychain and never shown in clear. |
| AC4-4 | API history is per-template, metadata-only, deletable per record and clearable. |
| AC4-5 | A read-only DB connection runs a SELECT and renders results (virtualized); a `DELETE`/`DROP` is blocked. |
| AC4-6 | DB credentials are in OS keychain; query history stores metadata only (no rows); CSV/JSON export streams to file. |

### Phase 5 — Actions & Batcher
| ID | Criterion |
|----|-----------|
| AC5-1 | A render producing actions shows the Action Panel; a render with no actions shows no Action Panel. |
| AC5-2 | No action executes without explicit confirmation; backend rejects unconfirmed execution. |
| AC5-3 | `Perform all` stops at the first failure; remaining actions do not execute; the failure is visible. |
| AC5-4 | In sandbox mode, a dangerous/disallowed action is blocked even when generated by rendering. |
| AC5-5 | Receipts are visible, local-only, and contain no secrets in clear. |
| AC5-6 | The Batcher accepts only document templates, preserves order, resolves shared inputs once, and applies merge macros. |

### Phase 6 — Hardening, Performance, Polish & Release Readiness
| ID | Criterion |
|----|-----------|
| AC6-1 | The enforcement matrix ([security §17](SWAFT_SECURITY_MODEL.md)) and IPC hardening are verified by tests. |
| AC6-2 | Security-relevant events are audited and redacted (no secrets logged). |
| AC6-3 | Performance budgets (cold start, workspace open, render latency, DB first-row) are met and tracked in CI. |
| AC6-4 | UI coherence: all views use the shared design system; empty/loading/error states everywhere; AA contrast in both themes. |
| AC6-5 | Opening a workspace with a newer `schemaVersion` is rejected with a clear message. |
| AC6-6 | The app is packaged/signed/notarized with auto-update and launches on supported OSes. |

---

## 6. Risks

| ID | Risk | Impact | Mitigation |
|----|------|--------|------------|
| **RK-1** | Whole-file encryption is larger than MVP allows. | High | Ship adapter hook + unrecoverability warning; defer full crypto behind a flag (Open decision OD-S1). |
| **RK-2** | DB statement guard via string matching is bypassable (esp. PostgreSQL). | High | Use read-only role/transaction + parser; default-deny non-provably-read-only (security DB-8). |
| **RK-3** | IPC hardening gaps (renderer reaching Node/OS, unguarded channels). | High | Strict `webPreferences`, channel allow-list, sender check, session guard, DTO validation; security tests (security §3). |
| **RK-4** | Electron native modules (`better-sqlite3`, `pg`) packaging across OSes. | Medium | `electron-builder` + prebuilds/`electron-rebuild`; build per-OS in CI; spike early (SP-1). |
| **RK-5** | Electron performance/footprint (heavy work blocks main/render). | Medium | Worker offloading, virtualization, streaming; performance budgets in CI (arch §11). |
| **RK-6** | Auth security (weak hashing, verifier leakage, brute force). | High | Argon2id verifier in keychain, never to renderer, lockout/back-off; security tests (security §3a). |
| **RK-7** | Building P2P assumptions into MVP code, hard to retrofit. | Medium | Enforce repository/adapter boundary + sync classification now; no sync logic in services. |
| **RK-8** | Seebo capability/Input-Panel wiring complexity. | Medium | Use `analyze().requirements`/`options` + `stopOn` interactive pattern + capability→widget registry; spike early (§7). |
| **RK-9** | Action execution context (clients/permissions) under-specified. | Medium | Define ActionService context contract early; code-defined handlers only in v1. |
| **RK-10** | Large HTTP/DB payloads degrade UI/IPC. | Medium | Stream/paginate; metadata-only history; cap response rendering; don't ship large payloads over IPC. |
| **RK-11** | Encryption + WAL backup corruption. | Medium | Safe-copy/checkpoint guidance; warn against copying open workspaces (storage BK-4). |
| **RK-12** | Transport coupling leaks into feature code (breaks web target). | Medium | Lint/review rule: feature code uses only the API client; no direct IPC (arch FE-10/WEB-1). |

---

## 7. Technical Spikes (recommended, do early)

| ID | Spike | Question to answer |
|----|-------|--------------------|
| **SP-1** | Electron scaffold + hardened IPC + native modules | Single hardened window; preload bridge + channel allow-list; `better-sqlite3`/`pg` packaged per-OS via `electron-builder`. |
| **SP-2** | Transport abstraction | One op contract behind IpcTransport now; confirm an HttpTransport could swap in without feature-code changes. |
| **SP-3** | Auth | Argon2id verifier in `safeStorage`/keychain; session guard on IPC; lockout/back-off. |
| **SP-4** | Seebo Input Panel wiring | Map `analyze().requirements` + `options` + **`capability`→widget** to form fields; drive interactive resolution with `stopOn`; persist last inputs. |
| **SP-5** | Seebo action execution | Prepare plan in RenderService, execute via `seebo/actions` with confirmation/failFast/receipts/redaction. |
| **SP-6** | DB read-only enforcement (on a worker) | Read-only via role/transaction + statement classification for SQLite and PostgreSQL; off the main thread. |
| **SP-7** | Whole-file encryption (on a worker) | Argon2id + AEAD over the SQLite file; open/save round-trip; performance on a realistic file size. |
| **SP-8** | `.swaft` schema + sync metadata | Schema with `schemaVersion`, sync-metadata columns, migration scaffolding; confirm classification separation. |
| **SP-9** | Allowed-domain + SSRF | Anchored host matching, redirect re-validation, loopback/metadata blocking. |
| **SP-10** | Performance budgets | Establish budgets (cold start, workspace open, render latency, DB first-row); measure in CI smoke. |

---

## 8. Testing Strategy (test-gated development)

**Development is concurrent with tests.** After each development step, the step's tests are written
and run; the step is not "done" and the next step does not start until they pass (X-13 / OBJ-7).

| Layer | Tooling (Recommended) | Approach |
|-------|-----------------------|----------|
| **Unit (services/logic)** | Vitest | Each service's enforcement rules in isolation (allowed domains, DB guard, action confirmation, file boundary, auth). Mock infra services. |
| **Storage/adapter (integration)** | Vitest + better-sqlite3 | Round-trip persistence; sync-classification separation; encryption round-trip; schema-version gating/migration. |
| **IPC / security tests** | Vitest + Electron test utils | Channel allow-list, sender check, session guard, DTO validation; renderer cannot reach Node; **release-blocking**. |
| **Seebo integration** | Vitest | Render fixtures with requirements/options/actions; verify capability→widget Input Panel mapping, fail-fast `Perform all`, receipts, redaction. |
| **Op/transport contract** | Vitest | DTOs + error envelope per op; identical contract across transports; no secrets in responses. |
| **Component (renderer)** | Vitest + Testing Library | Panel-visibility matrix (Action Panel only when actions exist; view-by-type); shared-component reuse; empty/loading/error states; auth screens. |
| **E2E (smoke)** | Playwright for Electron | Sign in → create workspace → author template → render → API call → DB query → confirm action → see receipt. |
| **Performance** | CI perf checks | Budgets: cold start, workspace open, render latency, DB first-row; large DB/HTTP streaming. |

| ID | Rule |
|----|------|
| **TS-1** | Every backend enforcement point and IPC guard has at least one negative (denial) test. |
| **TS-2** | Tests assert secrets/verifier never appear in responses, receipts, history, audit, or the renderer. |
| **TS-3** | Sync-classification tests assert local-only/secure-local data is never emitted to the (future) sync surface. |
| **TS-4** | Each milestone defines and ships its tests; CI runs the full suite per step; **a red suite blocks the next milestone**. |
| **TS-5** *(Recommended)* | Maintain a meaningful coverage threshold on services/security code; do not merge below it. |

---

## 9. CI Considerations

| ID | Recommendation |
|----|----------------|
| **CI-1** | Run lint + typecheck (TypeScript) + unit/integration/security/component tests on every PR and per step. |
| **CI-2** | Run security/enforcement/IPC tests as a **required, blocking** gate. |
| **CI-3** | Build the **Electron** app (with native modules `better-sqlite3`/`pg`) on each supported OS to catch packaging regressions. |
| **CI-4** | Run the Playwright-for-Electron E2E smoke on at least one OS. |
| **CI-5** *(Recommended)* | Static checks (boundary guards): no service imports a concrete storage adapter; **no feature code imports IPC/`window` bridge directly** (transport coupling); mirrors Seebo's "core never imports execute" conformance test. |
| **CI-6** *(Recommended)* | Track performance budgets in CI; fail on regression beyond threshold. |
| **CI-7** *(Recommended)* | Dependency/license audit; no network access in unit tests; pin Electron and audit Electron security advisories. |

---

## 10. Release Readiness Criteria

The MVP is release-ready when **all** hold:

| ID | Criterion |
|----|-----------|
| **RR-1** | All Phase 0–6 acceptance criteria pass; the full test suite is green. |
| **RR-2** | The enforcement matrix ([security §17](SWAFT_SECURITY_MODEL.md)) and IPC hardening are covered by passing, blocking tests. |
| **RR-3** | No secret value or account verifier is ever returned to the renderer, stored in `.swaft`, synchronized, or logged (verified). |
| **RR-4** | Storage-mode immutability and release immutability are enforced and tested. |
| **RR-5** | Data is correctly classified (synchronized / local-only / secure-local); local-only/secure-local never reach the sync surface. |
| **RR-6** | Encryption (if shipped) round-trips correctly and communicates unrecoverability; if deferred, the warning + adapter hook are present and documented. |
| **RR-7** | Performance budgets are met; UI is coherent (single design system) with full empty/loading/error states. |
| **RR-8** | The app builds, is signed/notarized with auto-update, and launches on supported OSes. |
| **RR-9** | Open decisions affecting MVP behavior are resolved or explicitly documented as deferred. |

---

## 11. MVP Open Decisions

| ID | Topic | Recommendation |
|----|-------|----------------|
| **OD-M1** | Ship full encryption vs warning + hook. | Ship full crypto if the encryption spike (SP-7) succeeds; otherwise warning + hook, full crypto fast-follow. |
| ~~**OD-M2**~~ | Desktop shell / packaging. | **Resolved:** Electron (Architecture OD-A1); native modules via `electron-builder` + prebuilds. |
| ~~**OD-M3**~~ | Supported OS targets for MVP. | **Resolved: Windows + macOS** (Linux fast-follow). |
| **OD-M4** | HTTP history depth in MVP. | Metadata-only (product OD-1). |
| **OD-M5** | Dev-mode entry gating. | Require confirmation/permission to enter `dev` (product OD-4). |
| **OD-M6** | Session inactivity lock default. | On by default; configurable timeout (security OD-S8). |
