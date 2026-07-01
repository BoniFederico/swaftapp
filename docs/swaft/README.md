# Swaft Documentation

**Swaft** ("Strange Web App for Technician") is a desktop-first technical application for AM teams,
developers and power users, built on the **Seebo** template engine ([`../seebo/`](../seebo/)).

This directory contains the formal documentation set for Swaft. The authoritative source of product,
architecture, UI, storage, security and data-model decisions is [`init.md`](init.md); the documents
below elaborate it into implementation-ready specifications.

## Document Set

| # | Document | Audience | Summary |
|---|----------|----------|---------|
| — | [`init.md`](init.md) | All | **Authoritative** initial decisions (source of truth). See "Decisions that supersede `init.md`" below. |
| 1 | [`SWAFT_PRODUCT_SPEC.md`](SWAFT_PRODUCT_SPEC.md) | Product, all | Product requirements: overview, goals/non-goals, personas, use cases, auth, workspace/template/release concepts, storage modes, feature list, MVP vs future, open decisions. |
| 2 | [`SWAFT_ARCHITECTURE.md`](SWAFT_ARCHITECTURE.md) | Frontend, backend, security | Electron shell (main/renderer), hardened IPC, transport abstraction, service/repository layers, storage adapters, auth, Seebo & action integration, workers, performance, web portability. |
| 3 | [`SWAFT_DATA_MODEL.md`](SWAFT_DATA_MODEL.md) | Backend, frontend (DTOs), security | Domain entities (incl. account/session), fields, relationships, sync metadata, and data classification (synchronized / local-only / secure-local / encrypted). |
| 4 | [`SWAFT_UI_SPEC.md`](SWAFT_UI_SPEC.md) | Frontend, design | Auth screens, navigation, homepage, wizard, workspace shell, Working Tree, Document/API/Render/Database views, editor, batcher, settings, design system/theming/i18n, UI coherence, panel-visibility matrix. |
| 5 | [`SWAFT_SECURITY_MODEL.md`](SWAFT_SECURITY_MODEL.md) | Security, backend | Threat model, IPC hardening, authentication, secrets, encryption, P2P trust, sandbox/dev modes, allowed domains, DB/action safety, audit, data minimization, recovery limits. |
| 6 | [`SWAFT_STORAGE_SYNC_MODEL.md`](SWAFT_STORAGE_SYNC_MODEL.md) | Backend, security | Local `.swaft` SQLite storage, app-level account/preferences storage, encryption, import/export, sync scope & metadata, last-write-wins, server-mode reservation, adapter abstraction, immutability, backup, migration. |
| 7 | [`SWAFT_MVP_SCOPE.md`](SWAFT_MVP_SCOPE.md) | Product, eng leads, QA | MVP scope, milestone phases, acceptance criteria, risks, spikes, test-gated strategy, CI, release readiness. |
| 8 | [`MVP_STEPS.md`](MVP_STEPS.md) | Implementers (LLM/human) | **Step-by-step, per-milestone prompts** to implement the MVP end-to-end (one prompt per milestone, test-gated). |
| 9 | [`NEXT_STEPS.md`](NEXT_STEPS.md) | Implementers (LLM/human) | **Post-MVP** milestone prompts for everything deferred (P2P, server, SSO/MFA, plugins, web app, …). |

## Consolidated Decisions (quick reference)

| Area | Decision |
|------|----------|
| Shell / stack | **Electron** (main process = Node backend) + React/Vite (TypeScript); **hardened IPC**; transport abstraction for future web. |
| IPC security | `contextIsolation`+`sandbox`+`nodeIntegration:false`; preload `contextBridge` allow-list; session guard; DTO validation; no local HTTP/port. |
| Authentication | Sign-up/sign-in + session; **local account** (Argon2id verifier in secure storage) in MVP; SSO/OIDC/MFA future. |
| Storage modes | `local` (MVP), `p2p` (future), `server` (reserved) — **immutable** after creation. |
| Local storage | Single SQLite-based `.swaft` file; optional whole-file encryption (unrecoverable if key lost); app-level store for account/preferences. |
| Template types | `document`, `api`, `render` — each maps to one view; Working Tree always visible. |
| Releases | Immutable, linear semantic snapshots; release selection is personal/local-only. |
| HTTP | Real backend client; structured model (not cURL); Bearer/Basic/API-key; allowed domains; proxy. |
| Database | SQLite + PostgreSQL; read-only default; dangerous statements blocked; CSV/JSON export; metadata-only history. |
| Actions | Code-defined (v1); always confirmed; `Perform all` fail-fast; visible receipts. |
| Input Panel | Driven by **input-widget capabilities** (one Seebo capability per frontend widget: textbox, listbox, boolean, multi-option, JSON input, …); the capability chosen per input picks its widget. |
| UX | Modern, minimal, Material-style; **single design system (reused, coherent)**; light/dark themes; primary color (4–5); language (it/en); local-only. |
| Performance | Worker offloading; virtualized lists; streamed payloads; performance budgets; responsive within Electron. |
| Testing | **Test-gated**: tests written and green after each step before the next. |
| Sync | Real-time P2P (future); device identity + signed invitations + allowlist + encrypted keys + revocation; last-write-wins. |
| Execution modes | `sandbox` (restricted) / `dev` (permissioned). |

## Decisions that supersede `init.md`

`init.md` remains the authoritative origin, but the following were decided later in the docs:

| Topic | `init.md` | Current decision |
|-------|-----------|------------------|
| Desktop shell | Tauri + secure local HTTP API | **Electron** + hardened IPC + transport abstraction (Arch §1–§5, OD-A1). |
| Authentication | SSO/OIDC/MFA future; "local profile" only | **Sign-up/sign-in + session** (local account) in MVP; advanced methods still future (Product §10.4, Security §3a, Data §20). |
| Input Panel | typed inputs via capabilities | Inputs are **widget capabilities**; the capability selects the UI widget (UI §9.1.1, Arch §8.2.1). |
| UX/theming | (unspecified) | Material-style, light/dark, primary color, i18n it/en, single coherent design system (UI §23). |

## Reading Order

- **New to Swaft:** [`SWAFT_PRODUCT_SPEC.md`](SWAFT_PRODUCT_SPEC.md) → [`SWAFT_ARCHITECTURE.md`](SWAFT_ARCHITECTURE.md) → [`SWAFT_MVP_SCOPE.md`](SWAFT_MVP_SCOPE.md).
- **Backend:** Architecture → Data Model → Storage/Sync → Security.
- **Frontend:** Product Spec → UI Spec → Architecture (frontend sections) → Data Model (DTOs).
- **Security review:** Security Model → Storage/Sync → Data Model → Architecture.

## Conventions

- **Open decision** — not yet decided; resolve before/within the affected milestone.
- **Recommended** — an inference beyond `init.md`, proposed as the default; does not override `init.md`.
- Data classification: 🟢 synchronized · 🔵 local-only · 🟠 secure-local.

## Open Decisions Index

Per-document open decisions are listed at the end of each file. Cross-document themes:

| Theme | Where |
|-------|-------|
| HTTP history depth (metadata-only vs configurable full) | Product OD-1, Data OD-D1, Security OD-S3, MVP OD-M4 |
| Server storage details | Product OD-2, Storage OD-ST3 |
| Plugin actions (future) | Product OD-3 |
| Execution-mode change gating | Product OD-4, UI OD-UI-4, Security OD-S6, MVP OD-M5 |
| Encryption primitives & MVP depth | Architecture OD-A3, Security OD-S1, MVP OD-M1 |
| DB statement-guard method | Architecture OD-A4, Security OD-S4 |
| Conflict granularity / logical clock | Data OD-D5, Storage OD-ST2/OD-ST6 |
| Desktop shell / packaging / OS targets | Architecture OD-A1 — **resolved** (Electron), MVP OD-M2 — **resolved**, OD-M3 — **resolved** (Windows + macOS) |
| Input-widget capability names & full set | UI OD-UI-6 — **resolved** (catalog §9.1.1 confirmed) |
| Primary-color palette | UI OD-UI-7 — **resolved** (5 primaries, default Blue); theme default OD-UI-8 |
| Account scope & storage (local vs server-ready) | Architecture OD-A7, Data OD-D7/OD-D8, Storage OD-ST7/OD-ST8 |
| Account password ↔ workspace key wrapping | Security OD-S7 — **resolved** (separate) |
| Session inactivity lock default | Security OD-S8, MVP OD-M6 |
| Worker strategy | Architecture OD-A8 — **resolved** (`worker_threads`) |
