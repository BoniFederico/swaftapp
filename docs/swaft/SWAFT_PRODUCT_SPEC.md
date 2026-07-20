# Swaft — Product Specification

> **Status:** Authoritative product requirements document (PRD).
> **Source of truth:** [`init.md`](init.md). Where this document elaborates beyond `init.md`,
> the elaboration is marked **Recommended**. Where a decision is not yet made, it is marked
> **Open decision**. No statement in this document overrides `init.md`.
> **Audience:** Product, frontend engineers, backend engineers, designers, security reviewers.

---

## 1. Product Overview

### 1.1 Definition

**Swaft** ("**S**trange **W**eb **A**pp **F**or **T**echnician") is a **desktop-first technical
application** for AM (Application Management) teams, developers, technicians and power users. It
provides a single workspace for creating, rendering, organizing, executing and sharing structured
technical templates.

Swaft is built on the **Seebo** template engine (see [`docs/seebo/`](../seebo/)). Seebo provides a
pure, terminating, suspendable template language with typed values, declarative input requirements
(`require`), external data resolution (`capability`), and declarative effects (`action`). Swaft is
the application shell, persistence layer, security boundary and user interface around that engine.

### 1.2 Product Pillars

| # | Pillar | Meaning |
|---|--------|---------|
| 1 | **Desktop-first** | The primary delivery target is an **Electron** desktop application optimized for technical desktop workflows. A limited web app may follow; the architecture supports it via a transport abstraction. |
| 2 | **Local-first** | A workspace can exist entirely on the local machine as a single `.swaft` file. No server is required to be productive. |
| 3 | **Explicit security** | Dangerous operations are restricted by default. Every action requires confirmation. The main process — not the UI — enforces all security rules. App access is gated by sign-in. |
| 4 | **Structured over textual** | API requests are a structured request model, never cURL strings. Templates and releases are structured, versioned entities. |
| 5 | **Immutable releases** | Template releases are immutable semantic snapshots. Users choose which release to use. |
| 6 | **Predictable synchronization** | What is synchronized vs. local-only is explicitly defined. Conflict resolution is deterministic (last-write-wins). |
| 7 | **Performance-conscious** | Despite Electron's overhead, the app must stay responsive: heavy work off the main thread/render thread, virtualized lists, streamed large payloads, performance budgets tracked. |
| 8 | **Coherent, attractive UI** | A single design system; components are reused, never reinvented per screen; consistent Material-style look in light/dark. |
| 9 | **No scope creep** | Features not defined in `init.md` (and these derived specs) must not be added implicitly. |

> **Shell decision (consolidated, supersedes `init.md` §3):** the desktop shell is **Electron**
> (main process = Node.js backend; hardened IPC between renderer and main; transport abstraction for
> future web). See [`SWAFT_ARCHITECTURE.md`](SWAFT_ARCHITECTURE.md) §1–§5.

### 1.3 Relationship to Seebo

| Concern | Owned by Seebo | Owned by Swaft |
|---------|----------------|----------------|
| Template language, parsing, evaluation | ✅ | |
| Input requirements (`require`) and resolution (`capability`) | ✅ engine mechanism | ✅ UI, wiring, persistence |
| Action *preparation* (`ActionPlan`) | ✅ | |
| Action *execution* (`seebo/actions`) | ✅ execution layer | ✅ invocation, confirmation UX, policy, receipts |
| Persistence, workspaces, projects, folders, releases | | ✅ |
| HTTP client, DB client | | ✅ |
| Storage modes, P2P sync, encryption | | ✅ |
| Security enforcement, sandbox/dev modes | partial (engine policy/limits) | ✅ (process/OS boundary) |

---

## 2. Goals and Non-Goals

### 2.1 Goals

- **G1** — Provide a local-first workspace stored as a single portable `.swaft` SQLite file.
- **G2** — Let users author, version and render **document** and **api** templates (the original `render` type was folded into `document` subtypes), plus user-authored **capability**/**action** code templates.
- **G3** — Provide a real HTTP client and a real (read-only-by-default) database client, both executed in the backend.
- **G4** — Generate and execute Seebo-produced **actions** under explicit confirmation and backend enforcement.
- **G5** — Provide immutable, linearly versioned releases with personal (non-synchronized) release selection.
- **G6** — Provide a strict security model: hardened Electron IPC, secure secret storage, optional whole-file encryption, sandbox/dev modes, allowed domains.
- **G7** — Reserve and architecturally support `p2p` and `server` storage modes, with a precise synchronization classification, without requiring full P2P/server implementation in the MVP.
- **G8** — Keep the architecture portable toward a future limited web app (transport abstraction).
- **G9** — Provide **sign-up / sign-in** and session management gating app access, with a local account in MVP and a design ready for future SSO/OIDC/MFA and server accounts.
- **G10** — Deliver a **performant, coherent, attractive** desktop experience within Electron's constraints.

### 2.2 Non-Goals

- **N1** — Swaft is **not** a general-purpose IDE or code editor.
- **N2** — Swaft does **not** expose a public/LAN network API; the desktop app has no local HTTP server (renderer↔main is hardened IPC).
- **N3** — Swaft does **not** offer in-place storage-mode migration (storage mode is immutable).
- **N4** — Swaft does **not** provide encryption-key recovery or backdoors.
- **N5** — Swaft does **not** treat database results as Seebo input values (v1).
- **N6** — Swaft does **not** auto-execute actions; nothing runs without explicit confirmation.
- **N7** — Swaft does **not** add product areas beyond those defined here.

---

## 3. Personas

| ID | Persona | Description | Primary needs |
|----|---------|-------------|---------------|
| **P1** | **AM Technician** | Application-management operator running repeatable technical procedures. | Repeatable document generation, controlled actions, safe HTTP/DB inspection, audit/receipts. |
| **P2** | **Developer / Integrator** | Builds and tests integrations and APIs. | Structured API templates, real HTTP client with auth/proxy, DB inspection, dev-mode operations. |
| **P3** | **Power User / Technical Author** | Authors structured technical templates and previews. | Document & render templates, releases/changelog, batcher composition. |
| **P4** | **Team Lead / Workspace Owner** | Owns workspace configuration and (future) team sharing. | Restrictions, allowed domains, execution mode, releases, (future) P2P device management. |
| **P5** | **Security Reviewer** *(Recommended)* | Audits the safety of the application and workspace configuration. | Clear trust boundaries, backend enforcement, audit events, secret handling. |

---

## 4. Main Use Cases

| ID | Use case | Persona(s) | Template type / area |
|----|----------|-----------|----------------------|
| **UC-0** | Sign up (first run) / sign in to access the app; sign out / lock. | P1–P4 | Authentication |
| **UC-1** | Create a local workspace as a `.swaft` file (optionally encrypted). | P1–P4 | Workspace |
| **UC-2** | Author a document template, fill the Input Panel, render output. | P1, P3 | Document |
| **UC-3** | Render produces actions; user reviews, confirms and executes; views receipts. | P1, P2 | Document / Actions |
| **UC-4** | Author and execute a structured HTTP request; inspect response; review history. | P2 | API |
| **UC-5** | Author a render-only preview (mermaid, swagger, echarts, markdown, …). | P3 | Render |
| **UC-6** | Connect to a SQLite/PostgreSQL database read-only; run a query; export CSV/JSON. | P1, P2 | Database |
| **UC-7** | Create an immutable release of a template; record changelog; select a release to use. | P3, P4 | Release |
| **UC-8** | Compose multiple document templates in the Batcher with shared inputs and merge macros. | P3 | Batcher |
| **UC-9** | Configure workspace settings: execution mode, allowed domains, restrictions, proxy. | P4 | Settings |
| **UC-10** | *(Future)* Invite a device, sync a workspace over P2P, revoke a device. | P4 | P2P |

---

## 5. Workspace Concept

### 5.1 Definition

A **workspace** is the top-level container and unit of storage, sharing and security. It contains:

- Projects, Folders, Tags, Restrictions
- Templates and their immutable Template Releases
- Workspace Settings (execution mode, allowed domains, proxy, etc.)
- Changelog entries
- Storage-mode configuration (immutable)
- Synchronization configuration (P2P/server)

### 5.2 Workspace Invariants

| ID | Invariant |
|----|-----------|
| **WS-1** | A workspace has exactly one **storage mode** (`local`, `p2p`, `server`), set at creation and **immutable** thereafter. |
| **WS-2** | A workspace has exactly one **execution mode** (`sandbox` or `dev`) at a time; it may be changed (subject to permissions) — only the *storage* mode is immutable. |
| **WS-3** | In `local` mode the workspace is a single portable `.swaft` SQLite file. |
| **WS-4** | Local-only data (§9) never leaves the device, regardless of storage mode. |
| **WS-5** | Secrets/credentials are never stored in synchronized workspace data; they live in OS secure storage. |

> **Note on execution mode:** `init.md` §18.2 lists `executionMode` as a workspace field but does
> not declare it immutable (only *storage* mode is immutable, §4.3). Whether changing execution mode
> requires elevated permission is an **Open decision** (see §13). Recommended: changing to `dev`
> requires a confirmation/permission step; changing back to `sandbox` is always allowed.

---

## 6. Projects, Folders, Templates, Tags, Restrictions

### 6.1 Concept Summary

| Concept | Role |
|---------|------|
| **Project** | A macro-folder that **filters the Working Tree**. Projects scope which templates/folders are shown. |
| **Folder** | Acts as an **HTTP collection** for API templates; general grouping container for templates. |
| **Template** | The core authored unit. One of four types: `document`, `api`, `capability`, `action` (the original `render` type was folded into `document` subtypes). |
| **Tag** | A label applied to templates for cross-cutting organization/filtering. |
| **Restriction** | A workspace-level constraint (e.g. allowed HTTP domains, allowed actions, allowed capabilities) enforced by the backend. |

### 6.2 Project / Folder Rules

| ID | Rule |
|----|------|
| **PF-1** | A Project is a macro-folder whose primary function is to filter the Working Tree view. |
| **PF-2** | A Folder groups templates; for API templates a Folder acts as an HTTP collection. |
| **PF-3** | Projects, Folders, Tags and Restrictions are **synchronized** workspace data in P2P mode. |
| **PF-4** *(Recommended)* | Folder nesting is allowed; a template belongs to at most one Folder and optionally one Project. |

### 6.3 Restrictions (workspace-enforced)

Restrictions are synchronized workspace settings that the backend enforces. They include:

- **Allowed HTTP domains** (outbound HTTP allow-list).
- **Allowed actions** (which action types may be executed).
- **Allowed capabilities** (which Seebo capabilities may resolve data).
- **Execution-mode-derived restrictions** (sandbox file/DB/action limits).

---

## 7. Template Types

Swaft supports **four template types**, each mapped to exactly one primary view. (The original
`render` type was folded into `document` subtypes: a renderable subtype simply has no inputs.)

| Type | Primary view | Purpose |
|------|--------------|---------|
| `document` | **Document View** | Input-driven document rendering with optional generated actions; renderable subtypes (html, markdown, mermaid, swagger, echarts, …) cover the former `render` type. |
| `api` | **API View** | Structured HTTP request execution (real HTTP client). |
| `capability` | **Code View** | User-authored Seebo capability (sandboxed JavaScript) usable from formulas. |
| `action` | **Code View** | User-authored Seebo action (sandboxed JavaScript) with confirmation + receipt. |

### 7.1 Document Templates

- **Composition:** `Input Panel + Main Document View + optional Action Panel`.
- The Action Panel is shown **only when rendering produces one or more actions**.
- **Subtypes:** `html`, `markdown`, `eml`, `csv`, `json`, `xml`, `yaml`, `txt`, `javascript`, `python`, `sql`, `plain`.
- **Persistence:** template definition, releases, and the **last input values per template** (last input values are **local-only**, not synchronized).

### 7.2 API Templates

- **View:** API View only.
- **Canonical model:** a **structured JSON-like HTTP request object** — *not* cURL. (See `init.md` §8.4.2.)
- **Subtypes (HTTP methods):** `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.
- **Persistence:** the structured request, releases, and **API call history per template** (local-only; deletable per record; clearable per template).
- **Execution:** all calls go through the local backend HTTP client; allowed-domain and proxy rules are enforced by the backend.
- **cURL import/export:** **Future** (not the canonical format).

### 7.3 Render Templates

- **View:** Render View only — standalone, view-only, not action-oriented.
- **Subtypes:** `html`, `markdown`, `eml`, `mermaid`, `swagger`, `openapi`, `echarts`, `json-preview`.
- No Input Panel, no Action Panel, no execution controls.

> **Open decision:** Whether Render templates accept input parameters before rendering. `init.md`
> describes Render View as "view-only" with no Input Panel; the Recommended default is that Render
> templates render from their stored definition with no interactive input.

---

## 8. Release Model

| ID | Rule |
|----|------|
| **R-1** | A template **release** is an **immutable** semantic snapshot of the template at release time. |
| **R-2** | Versioning is **linear** per template (e.g. `v1.0.0 → v1.1.0 → v2.0.0`); versions are semantic labels. |
| **R-3** | Releases (and changelog) are **common to all template types**. |
| **R-4** | Releases are **synchronized** in P2P mode. |
| **R-5** | **Release selection** (which release a user renders/uses) is **personal, local-only, not synchronized**, set via the Working Tree three-dot menu. |
| **R-6** | A template always has an editable **current draft**; a release is created by snapshotting the draft. |

> **Recommended:** Default release selection, when a user has not chosen one, resolves to the latest
> release; if no releases exist, the current draft is used. This default is itself local-only.

---

## 9. Storage Modes and Data Classification

### 9.1 Storage Modes

| Mode | Description | MVP status |
|------|-------------|-----------|
| `local` | Single `.swaft` SQLite file on the local machine. Requires only a **local profile**. | **MVP** |
| `p2p` | Real-time synchronization with allowed peer devices (LAN, internet, or both). | Architecture-ready; **deferred** implementation. |
| `server` | Server-backed storage/synchronization. | **Reserved** mode; future-oriented; details undefined. |

Storage mode is **immutable** after workspace creation (§5.2 WS-1). Migration, if ever offered, is an explicit export/import or clone — never an in-place mutation.

### 9.2 Synchronization Classification

Every persisted entity is classified as exactly one of:

| Classification | Meaning |
|----------------|---------|
| **Synchronized** | Included in P2P synchronization (shared workspace data). |
| **Local-only** | Stored locally; never synchronized; personal to the device. |
| **Secure-local** | Stored/referenced via OS keychain / secure secret storage; never synchronized. |

**Synchronized:** templates, template releases, workspace settings, projects, folders, tags, restrictions, changelog.

**Local-only:** last input values, API call history, database query history, user preferences, default release selection per template, local action receipts.

**Secure-local:** API tokens, basic-auth credentials, API keys, database credentials, proxy credentials, workspace encryption key/password material.

> Full field-level classification is in [`SWAFT_DATA_MODEL.md`](SWAFT_DATA_MODEL.md); sync mechanics
> are in [`SWAFT_STORAGE_SYNC_MODEL.md`](SWAFT_STORAGE_SYNC_MODEL.md).

---

## 10. High-Level Feature List

### 10.1 Workspace & Navigation
- Create/open local `.swaft` workspace; optional whole-file encryption.
- Always-visible **Working Tree** (common to all layouts).
- Projects (tree filters), Folders (collections), Tags, Restrictions.
- Working Tree context menu: Open, Edit, Rename, Clone, Delete, Select release.

### 10.2 Templates & Rendering
- Document, API and Render templates with their subtypes.
- Seebo rendering integration (typed inputs via `require`, resolution via capabilities).
- **Input Panel driven by input-widget capabilities**: a catalog of Swaft Seebo capabilities (textbox, listbox, boolean, multi-option, JSON input with import/drag-and-drop, …), one per frontend widget; the capability chosen per input determines its widget.
- Input Panel with last-input-value persistence (local-only).
- Template Editor.
- Releases (immutable, linear) + changelog.

### 10.2.1 Experience (UX)
- Modern, minimal, **Material-style** UI.
- **Light and dark themes**; user-selectable **primary color** (4–5 options).
- **Localized UI** (initial languages: Italian and English), following theming/i18n best practices.
- Theme, primary color and language are **local-only** preferences.

### 10.3 Execution
- Real backend **HTTP client**: Bearer/Basic/API-key auth, per-workspace allowed domains, proxy support; per-template call history.
- Real backend **Database client**: SQLite + PostgreSQL, read-only by default, dangerous-statement blocking, CSV/JSON export, metadata-only history; credentials in OS keychain.
- **Actions**: code-defined (v1), generated by Seebo rendering, always confirmed, `Perform all` is fail-fast, receipts visible in UI.
- **Batcher**: temporary, document-templates-only, drag-and-drop, ordered, shared-input resolution, Seebo merge macros.

### 10.4 Authentication & Security
- **Sign-up / sign-in** gating app access; local account + session (MVP); Argon2id password verifier in secure storage; designed for future SSO/OIDC/MFA.
- Hardened Electron IPC (context isolation, sandbox, channel allow-list, session guard) — no local HTTP server.
- Main-process enforcement of execution mode, allowed domains, file boundaries, DB restrictions, action confirmation.
- Sandbox/dev execution modes.
- OS keychain / secure secret storage for all secrets and the account verifier.
- Optional whole-file workspace encryption (unrecoverable if key lost).

### 10.5 Synchronization (architecture-ready)
- P2P model: device identities, signed invitations, device allowlist, encrypted workspace keys, revocation, last-write-wins.
- Explicit synchronized vs. local-only vs. secure-local classification.

---

## 11. MVP vs Future Scope

> Authoritative milestone breakdown is in [`SWAFT_MVP_SCOPE.md`](SWAFT_MVP_SCOPE.md). Summary below.

### 11.1 In MVP

| Area | MVP inclusion |
|------|---------------|
| Shell / stack | **Electron** + React/Vite (TypeScript) + Node.js main-process backend + hardened IPC + transport abstraction. |
| Auth | Sign-up/sign-in + session (local account; Argon2id verifier in secure storage). |
| Storage | Local `.swaft` SQLite workspace; optional whole-file encryption (warning-grade if full impl is too large). |
| Navigation | Always-visible Working Tree; context menu; projects/folders/tags. |
| Templates | Document, API, Render; Template Editor; Input Panel (input-widget capabilities); releases + basic changelog. |
| Views | Document View, API View, Render View, basic Database View. |
| HTTP | Real HTTP calls via backend; API history; Bearer/Basic/API-key; allowed domains; proxy. |
| Database | SQLite + PostgreSQL, read-only; dangerous-statement blocking; CSV/JSON export; metadata history. |
| Actions | Code-defined actions; display, confirmation, receipts; `Perform all` fail-fast. |
| Batcher | Document-only batcher with merge macros. |
| UX | Material-style design system; light/dark themes; primary color; i18n (it/en); coherent, reused components. |
| Performance | Workers for heavy tasks; virtualized lists; streamed payloads; performance budgets. |
| Security | Hardened IPC; sandbox mode basics; dev-mode permissions; main-process enforcement; OS keychain secrets. |
| Testing | Tests written and run after each development step (test-gated milestones). |
| Sync | **Data classification and model support only** — no P2P implementation; architecture ready. |

### 11.2 Deferred / Future

- Full **P2P** synchronization implementation.
- **Server** storage mode.
- **SSO / OIDC** and **email MFA** (basic local sign-up/sign-in *is* in MVP; these advanced methods are deferred).
- Future web app build (transport HTTP target).
- **Plugin-defined actions** / plugin marketplace.
- Advanced permission system.
- **cURL** import/export.
- Advanced DB write workflows.
- Advanced encryption implementation (if too large for MVP).
- Configurable full HTTP history (beyond metadata-only).
- Automatic sensitive-column masking for DB.
- Treating DB results as Seebo inputs.

---

## 12. Cross-Cutting Requirements

| ID | Requirement |
|----|-------------|
| **X-1** | Security is enforced in the **main process**, never only in the UI/renderer. |
| **X-2** | Local-only and synchronized data boundaries are preserved at the storage layer. |
| **X-3** | Template releases are immutable. |
| **X-4** | Storage mode is immutable. |
| **X-5** | API templates use a structured model, never cURL as canonical storage. |
| **X-6** | Every action execution requires explicit user confirmation. |
| **X-7** | The Working Tree is always visible across all layouts. |
| **X-8** | The right-hand view is determined solely by the opened template's type. |
| **X-9** | App access is gated by sign-in; non-auth operations require an active session. |
| **X-10** | The renderer accesses the backend only through the transport-agnostic client; no direct IPC in feature code (web-portability). |
| **X-11** | UI uses a single design system; components are reused and consistent, never reinvented per screen. |
| **X-12** | Heavy work runs off the main/render thread; the app stays responsive (performance budgets). |
| **X-13** | Development is **test-gated**: tests are written and run after each step and must pass before proceeding. |
| **X-14** | No feature outside this scope is introduced implicitly. |

---

## 13. Open Decisions

| ID | Topic | Current state | Recommendation |
|----|-------|---------------|----------------|
| **OD-1** | **HTTP history scope** | `init.md` §22.1: metadata-only recommended; configurable full history is open. | Keep metadata-only in MVP; gate full-body history behind an explicit future opt-in flag. |
| **OD-2** | **Server storage details** | `init.md` §22.2: `server` is a valid, reserved, immutable mode; behavior undefined. | Defer; ensure data model reserves the mode without server-specific assumptions. |
| **OD-3** | **Plugin actions** | `init.md` §22.3: actions are code-defined in v1; plugins are future. | Defer; any plugin system must preserve confirmation, execution-mode enforcement and receipts. |
| **OD-4** | **Execution-mode mutability/permission** | Not specified; only storage mode is immutable. | Allow change; require a permission/confirmation step to enter `dev`. |
| **OD-5** | **Render template input** | Render View is view-only; input behavior unspecified. | Render from stored definition; no interactive input in v1. |
| **OD-6** | **Default release fallback** | Selection is personal/local-only; fallback unspecified. | Latest release, else current draft. |
| **OD-7** | **Multi-profile on one device (local mode)** | Local mode "needs only a local profile"; multiplicity unspecified. | Single local profile per device in MVP. |

---

## 14. Glossary

| Term | Definition |
|------|------------|
| **Workspace** | Top-level container; unit of storage, sharing and security. |
| **Storage mode** | `local` \| `p2p` \| `server`; immutable after creation. |
| **Execution mode** | `sandbox` \| `dev`; governs allowed dangerous operations. |
| **Template** | Authored unit of type `document`, `api`, `capability` or `action`. |
| **Release** | Immutable semantic snapshot of a template. |
| **Release selection** | Personal, local-only choice of which release to use. |
| **Working Tree** | Always-visible navigation tree of projects/folders/templates. |
| **Project** | Macro-folder that filters the Working Tree. |
| **Folder** | Grouping container; HTTP collection for API templates. |
| **Action** | A declarative Seebo effect, prepared by the engine and executed under confirmation. |
| **Receipt** | Local record of an executed action's outcome. |
| **Batcher** | Temporary, document-only composition tool. |
| **Seebo** | The underlying template engine ([`docs/seebo/`](../seebo/)). |
| **Local profile** | Minimal local identity required for `local` mode. |
