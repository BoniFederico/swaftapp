# Swaft — MVP Implementation Steps (LLM-ready milestone prompts)

> **Purpose.** This file breaks the Swaft MVP into ordered **milestones**, each written as a
> **self-contained prompt** you can hand to an implementing LLM (or engineer). Do them **in order**:
> implement a milestone, ensure its tests are green, then move to the next. After the last milestone,
> the **MVP product is ready** per [`SWAFT_MVP_SCOPE.md`](SWAFT_MVP_SCOPE.md) §10.
>
> **Authoritative specs** (every milestone references them): [`SWAFT_PRODUCT_SPEC.md`](SWAFT_PRODUCT_SPEC.md),
> [`SWAFT_ARCHITECTURE.md`](SWAFT_ARCHITECTURE.md), [`SWAFT_DATA_MODEL.md`](SWAFT_DATA_MODEL.md),
> [`SWAFT_UI_SPEC.md`](SWAFT_UI_SPEC.md), [`SWAFT_SECURITY_MODEL.md`](SWAFT_SECURITY_MODEL.md),
> [`SWAFT_STORAGE_SYNC_MODEL.md`](SWAFT_STORAGE_SYNC_MODEL.md), and the Seebo engine docs
> ([`../seebo/`](../seebo/)).

---

## How to use this file

1. Start at **M0** and proceed sequentially to **M11**.
2. Paste the milestone's **PROMPT** block into the implementing LLM. Always also provide (or let it read) the **Global Context** below and the referenced doc sections.
3. The milestone is **done only when its tests are written and green** (test-gated, per `SWAFT_MVP_SCOPE.md` §8). Do not start the next milestone with a red suite.
4. **See it & verify** after each milestone (below) — launch the app and run the conformance checks.
5. If a milestone reveals a needed decision, resolve it against the specs (or mark an Open Decision) — do **not** invent product changes that conflict with the specs.

> **M0–M6 status: implemented in this repo.** Scaffold + hardened IPC (allow-list + sender check +
> per-op zod DTO validation) + transport-agnostic API client (`rawCall`) + worker scaffolding +
> **M2 design system** (tokens, light/dark/system ThemeProvider, 5 primary colors, i18n it/en,
> shared component library: Button/Card/TextField/Select/Switch/Dialog/Toast/Table/states) +
> component gallery + visible IPC diagnostics + **M3 auth/session** (local **multi-account** AuthService
> keyed by username, Argon2id verifier via `hash-wasm` protected at rest with Electron `safeStorage`,
> in-memory single session, per-account lockout/back-off, **session-guarded dispatch**, public/session
> op classification, sign-in/sign-up toggle + locked screens + account header with Lock/Sign-out icons) + **M4 workspaces** (app-level store for
> deviceId/preferences/recent; `.swaft` persistence via **sql.js (SQLite WASM)** behind an async
> `DbBackend` run on a **dedicated DB worker** with in-process fallback; `SCHEMA_DDL` with
> sync-metadata on 🟢 entities + a 🔵 local-only table; **forward-only schema gate**; immutable `local`
> storage mode; optional whole-file **AES-256-GCM + Argon2id** encryption with unrecoverability
> warning; homepage + Create-Workspace wizard + native open/save dialogs + preference persistence) + **M5
> workspace shell** (schema **v2** with workspace_settings + restrictions and a **forward-only
> v1→v2 migration**; OrganizationService/SettingsService over a sync-metadata + soft-delete RepoBase;
> project/folder/tag CRUD, settings with **dev-mode confirmation gating**, restrictions, all 🟢
> synchronized; workspace-required guard; renderer shell with a **virtualized Working Tree** +
> context menus + workspace Settings panel + app-level Preferences dialog) + **M6 Seebo engine +
> documents** (real `seebo` npm engine loaded via dynamic `import` and typed by a local facade;
> **SeeboHost** registers the input-widget capability catalog — textbox/textarea/number/boolean/
> listbox/multiOption/jsonInput/datetimebox/durationbox — as interactive capabilities with a
> settings-derived policy; schema **v5** `templates` table + TemplateService CRUD; **RenderService**
> surfacing `analyze()` requirements and rendering via `stebo()`; per-template **input state** (🔵
> local-only); Document View = **Input Panel** (one widget per capability, options-aware) + output/
> diagnostics/waiting states).
> Passes `npm run verify` + `npm run build` (90 tests green). Continue from **M7**.
>
> **Resolved OD-M6-SEEBO.** Seebo is the published `seebo` npm package (ESM-only, no types). The main
> process loads it via dynamic `import('seebo')` (kept external by the bundler) and types it through a
> local facade (`seebo-module.ts`). `datetime`/`duration` are reserved Seebo type names, so those
> widgets use the producer names `datetimebox`/`durationbox`.
>
> **Resolved OD-M4-DB.** The `.swaft` engine is **sql.js (SQLite WASM)**, not `better-sqlite3`: pure
> WASM avoids native-module ABI/build pain (consistent with the hash-wasm Argon2id decision) and runs
> identically in the main process, the DB worker, and Node test runners. `better-sqlite3` remains a
> reserved future swap behind the `DbBackend`/repository interfaces; the worker offload is finalized
> and perf-validated in M11.

## See it & verify (after every milestone)

Two constants, run from the repo root:

| Command | Purpose |
|---------|---------|
| `npm run dev` (alias `npm run see`) | **Launch the app** and look at it. |
| `npm run verify` | **Conformance**: `typecheck` + `lint` + unit/component tests (must be green). |
| `npm run build` then `npm run e2e` | **End-to-end** smoke on the built app (Playwright for Electron). |

What you should **see** when you run `npm run dev`, per milestone:

| Milestone | Launch shows (and conformance to check) |
|-----------|------------------------------------------|
| **M0** | Swaft window: theme toggle (light/dark), 5 primary colors, **“Ping backend”** → `pong=true …` (proves hardened IPC round-trip). `npm run verify` green. |
| **M1** | Same window; a demo op round-trips; unknown channels/invalid payloads are rejected (visible in a small diagnostics area or via tests). |
| **M2** | A themed **design-system sample** (buttons/inputs/dialog/table), instant light/dark + primary-color switch, **it/en** language switch. |
| **M3** | App **opens on the sign-in/sign-up screen**; after signing in you reach an (empty) home; sign-out/lock returns to sign-in. |
| **M4** | Create a workspace via the **wizard** → it opens; reopen a saved `.swaft`; (if enabled) wrong encryption password is rejected. |
| **M5** | The **workspace shell**: virtualized Working Tree with projects/folders/tags; context menus; Settings. |
| **M6** | Open a **document template**, fill the **Input Panel** (correct widget per capability), and see it **render**. |
| **M7** | **Render View** for render templates; create a **release** + changelog; switch the selected release in the tree. |
| **M8** | **API View**: send a real HTTP request; blocked-domain error; per-template history. |
| **M9** | **Database View**: run a read-only query (virtualized results); a `DELETE`/`DROP` is blocked; export CSV/JSON. |
| **M10** | A render that produces **actions** shows the Action Panel; confirm + execute; **Perform all** fail-fast; **receipts**; Batcher. |
| **M11** | The **packaged, signed app** launches; performance budgets met; full coherent UI. |

Each milestone prompt below repeats its **See it** line so the implementer wires up something visible
and you can confirm conformance before moving on.

---

## Global Context (applies to every milestone)

> Include this section's content alongside each milestone prompt.

**Product.** Swaft ("Strange Web App for Technician") — a desktop-first technical app built on the
**Seebo** template engine. See the specs above; **do not contradict them**.

**Stack & shell.**
- **Electron** desktop app. **Main process = Node.js backend** (authority/enforcement). **Renderer = React + Vite + TypeScript** (UI only).
- Renderer ↔ main is **hardened IPC** via a typed preload `contextBridge`. **No local HTTP server / no network port.**
- The renderer calls the backend **only** through a **transport-agnostic API client** (IPC adapter now; HTTP adapter reserved for a future web app). Feature code must never touch IPC directly.
- Native modules: `better-sqlite3` (SQLite), Postgres driver. Build with `electron-builder` + prebuilds/`electron-rebuild`.

**Hard rules (must always hold).**
- Security is enforced in the **main process**, never only in the UI. (`SWAFT_SECURITY_MODEL.md`)
- Renderer hardening: `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`; channel allow-list; sender check; session guard; DTO validation; strict CSP; deny external navigation.
- App is **gated by sign-in**; non-auth ops require an active session.
- Secrets and the account verifier live in OS keychain / `safeStorage`; **never** in `.swaft`, never synchronized, never sent to the renderer in clear.
- Data classification is respected: 🟢 synchronized / 🔵 local-only / 🟠 secure-local (`SWAFT_DATA_MODEL.md`).
- **Performance:** heavy/long work runs off the main thread and off the React render thread (workers); lists are virtualized; large payloads are streamed, not shipped whole over IPC.
- **UI coherence:** a single shared design system; reuse components; design tokens only; no one-off styling. Material-style; light/dark; primary color; i18n it/en.
- **Test-gated:** write tests with each step; the suite must be green before proceeding.

**Recommended tooling.** TypeScript everywhere; pnpm or npm workspaces (monorepo); Vite (renderer);
`electron-builder` (package); **Vitest** (unit/integration/component) + **Testing Library**;
**Playwright for Electron** (e2e); ESLint/Prettier; Argon2id (`argon2`); AEAD + Argon2id for
encryption; Material-style component system (e.g. MUI or a tokenized equivalent — keep it single and
consistent); an i18n library (e.g. `i18next`).

**Recommended repository layout.**
```
swaft/
├── packages/
│   ├── shared/        # DTOs, op contracts, error envelope, TS types (used by main + renderer)
│   ├── main/          # Electron main process (backend): bootstrap, ipc, services, engine, storage, infra, workers
│   ├── preload/       # contextBridge typed surface (allow-list)
│   └── renderer/      # React + Vite UI (app, auth, shell, views, editor, batcher, api-client, theme, i18n, ui)
├── e2e/               # Playwright-for-Electron tests
└── (CI config, electron-builder config, tsconfig, lint)
```

**Definition of Done (every milestone).** Deliverables implemented; **all milestone tests written and
green**; no hard-rule violation; specs not contradicted; lint/typecheck pass; CI green.

---

## Milestone index

| ID | Milestone | MVP phase |
|----|-----------|-----------|
| **M0** | Monorepo, tooling, CI, test harness | 0 |
| **M1** | Electron shell + hardened IPC + transport abstraction | 0 |
| **M2** | Design system, theming (light/dark + primary color), i18n (it/en) | 0 |
| **M3** | Authentication & session (local account) | 1 |
| **M4** | App-level store, homepage, create-workspace wizard, `.swaft` LocalAdapter | 2 |
| **M5** | Workspace shell, Working Tree, projects/folders/tags, settings/restrictions | 2 |
| **M6** | Seebo host, input-widget capabilities, Document View + Input Panel + rendering | 3 |
| **M7** | Render View, Template Editor, releases, changelog, release selection | 3 |
| **M8** | API templates + HTTP client (auth/allowed domains/proxy/history) + API View | 4 |
| **M9** | Database client (SQLite/Postgres read-only) + Database View | 4 |
| **M10** | Actions (confirm/fail-fast/receipts/sandbox) + Action Panel + Batcher | 5 |
| **M11** | Hardening, performance, UI coherence, packaging, release readiness | 6 |

---

## M0 — Monorepo, tooling, CI, test harness

**PROMPT**

> Set up the Swaft monorepo and tooling foundation. **Do not build product features yet.**
>
> **Build:**
> - A TypeScript monorepo (pnpm/npm workspaces) with packages `shared`, `main`, `preload`, `renderer`, and an `e2e/` folder, per the Global Context layout.
> - Electron + Vite + React + TypeScript baseline that launches an empty window from `renderer` loaded by `main` (no features).
> - `shared`: scaffolding for op contracts, DTO types, and the **coded error envelope** `{ error: { code, message, category, details } }` (categories: `policy | validation | execution | auth | not_found | internal`).
> - Tooling: ESLint + Prettier, strict `tsconfig`, scripts for dev/build/test/lint/typecheck.
> - Test harness: **Vitest** (+ Testing Library) and **Playwright for Electron**; one trivial passing test per layer.
> - CI: run lint + typecheck + unit/component tests on every push; build the Electron app on the target OSes (Recommended Windows + macOS; confirm OS targets — MVP OD-M3). Establish a place to track performance budgets.
>
> **Reference:** `SWAFT_ARCHITECTURE.md` §3–§4 (module structure), `SWAFT_MVP_SCOPE.md` §8–§9.
>
> **Tests to write & run (must pass):**
> - Smoke unit test in each package; a Playwright test that launches the app and sees the window.
> - CI executes the suite green.
>
> **Done when:** the app launches an empty window, the monorepo builds, lint/typecheck pass, and CI runs the (trivial) suite green.
>
> **See it:** `npm run dev` → the Swaft window with theme toggle, 5 primary colors, and a “Ping backend” button returning `pong=true …`. **Verify:** `npm run verify` (and `npm run build`).

---

## M1 — Electron shell + hardened IPC + transport abstraction

**PROMPT**

> Implement the **hardened renderer↔main boundary** and the **transport-agnostic API client**. Still no product features beyond a demo op.
>
> **Build (main):**
> - A single `BrowserWindow` with hardened `webPreferences` (`contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`, `nodeIntegrationInWorker:false`), strict **CSP**, single-instance lock, deny external navigation/`window.open` (`will-navigate`/`setWindowOpenHandler`), no `@electron/remote`.
> - An **IPC router** (thin): a **channel allow-list** registry, **sender-frame check**, **DTO validation** per op, error mapping to the envelope, and a hook point for the session guard (added in M3). No business logic in the router.
> - A `transport/` dispatch layer that maps an **op name → handler**, shared so a future HTTP server can reuse it.
> - Worker scaffolding (`utilityProcess`/`worker_threads`) with a demo task to prove offloading works.
>
> **Build (preload):** a minimal typed `contextBridge` surface exposing only `invoke(op, payload)` over the allow-list. Do **not** expose raw `ipcRenderer`.
>
> **Build (renderer):** a **transport-agnostic API client** (`IpcTransport` implementing a `Transport` interface; an `HttpTransport` stub for the future). Feature code will call `client.call(op, payload)` only.
>
> **Reference:** `SWAFT_ARCHITECTURE.md` §2–§5, `SWAFT_SECURITY_MODEL.md` §3.
>
> **Tests to write & run (must pass):**
> - Unknown/unlisted channel is rejected; a listed demo op round-trips; invalid payload returns a `validation` error envelope.
> - Sender check rejects non-app senders (simulated); external navigation is blocked.
> - The renderer cannot access Node/OS (context isolation verified).
>
> **Done when:** a demo op round-trips through the transport abstraction with full IPC hardening and passing security tests.
>
> **See it:** `npm run dev` → trigger the demo op; rejected channels/invalid payloads surface a coded error. **Verify:** `npm run verify`.

---

## M2 — Design system, theming (light/dark + primary color), i18n (it/en)

**PROMPT**

> Build the **UI foundation**: a single Material-style design system, theming, and localization. Still no product screens.
>
> **Build (renderer):**
> - A **single shared component library** (`ui/`): buttons, inputs, select, menu, dialog/confirm, table, tabs, toast, and standard **empty/loading/error** components. All consume **design tokens** (color/spacing/typography/radii/elevation) — no literal styling.
> - **ThemeProvider** at the app root supporting `light | dark | system` and a **primary color** chosen from 4–5 curated options (exact palette is pending design — UI OD-UI-7; use placeholders). Switching applies instantly.
> - **i18n** with externalized string catalogs for **`it` and `en`**, a provider, and locale-aware formatters; missing-key fallback to English.
> - A local "preferences" UI state for theme/primaryColor/language (persistence wired later in M4 to the app-level store).
> - (Recommended) a component catalog (Storybook) documenting the shared components.
>
> **Reference:** `SWAFT_UI_SPEC.md` §23 (design system, theming, i18n, UI coherence) and §20 (states).
>
> **Tests to write & run (must pass):**
> - Theme toggle switches tokens (light/dark) and primary color; component renders in both themes.
> - i18n switches it/en; no hard-coded strings in sample components; missing key falls back.
> - Shared empty/loading/error components render.
>
> **Done when:** the design system + theming + i18n are in place and reused by a sample screen; coherence rules (UCOH-*) are enforceable.
>
> **See it:** `npm run dev` → a design-system sample; switch light/dark, primary color, and it/en live. **Verify:** `npm run verify`.

---

## M3 — Authentication & session (local account)

**PROMPT**

> Implement **sign-up / sign-in** and **session** management gating the app. The app must be unusable until signed in.
>
> **Build (main):**
> - `AuthService`: **sign-up** (create local account + profile), **sign-in** (verify password), **sign-out**, **lock/unlock**. Hash the password with **Argon2id**; store the **verifier** in OS keychain / `safeStorage` (🟠 secure-local) — never in a file in clear, never to the renderer.
> - **Session** held in the main process (in-memory; not persisted). Add the **session guard** to the IPC router: all non-auth ops require an active session (the only exceptions are the auth ops and minimal bootstrap).
> - **Lockout/back-off** on repeated failed sign-ins; generic errors (no user enumeration).
> - App-level account store scaffolding (profile metadata, lockout counters) in the user-data dir — distinct from any `.swaft`.
>
> **Build (renderer):** Auth screens — **sign-up** (first run), **sign-in**, **locked** — using the M2 design system; sign-out + lock entry points. Passwords entered in renderer, verified in main; the renderer never receives the verifier.
>
> **Reference:** `SWAFT_SECURITY_MODEL.md` §3a, `SWAFT_DATA_MODEL.md` §20, `SWAFT_UI_SPEC.md` §2a.
>
> **Tests to write & run (must pass):**
> - First run → sign-up creates an Argon2id verifier in secure storage (never in clear/in a file).
> - Correct password signs in; wrong password fails generically; repeated failures trigger lockout/back-off.
> - Non-auth IPC ops are rejected without a session; sign-out/lock invalidate the session; verifier never reaches the renderer.
>
> **Done when:** the app is gated by working sign-up/sign-in with a session-guarded IPC surface and passing auth/security tests.
>
> **See it:** `npm run dev` → app opens on sign-in/sign-up; sign in to reach the (empty) home; sign-out/lock returns to sign-in. **Verify:** `npm run verify`.

---

## M4 — App-level store, homepage, create-workspace wizard, `.swaft` LocalAdapter

**PROMPT**

> Implement **local workspace persistence** and entry surfaces. (Requires M3 session.)
>
> **Build (main):**
> - **App-level local store** (small SQLite/JSON in user-data dir): user preferences (theme/color/language), recent-workspaces list. Wire M2 preferences to persist here.
> - **`.swaft` LocalAdapter** using `better-sqlite3` **on a dedicated DB worker** (synchronous driver must not block the main thread): schema for workspace metadata + organization + content + local-only tables, with `schemaVersion` and **sync-metadata columns** (`updatedAt`, `updatedByDeviceId`, `revision`, `deletedAt`, `createdAt`) on 🟢 synchronized entities. WAL journaling.
> - **Repository interfaces** + the LocalAdapter implementation behind them (services depend on interfaces, not the adapter).
> - WorkspaceService: create / open / close; **immutable `storageMode`** (local only enabled; p2p/server reserved/disabled); **optional whole-file encryption** — at minimum the CryptoService **adapter hook + unrecoverability warning**; full Argon2id+AEAD if feasible (run KDF/cipher on a worker). Migration scaffolding (forward-only; reject newer `schemaVersion`).
>
> **Build (renderer):** **Homepage** (recent/open/create) and **Create Workspace Wizard** (name; storage mode shown **immutable**; optional encryption with unrecoverability acknowledgement; execution mode default `sandbox`; location). Native open/save dialogs via a platform shim.
>
> **Reference:** `SWAFT_STORAGE_SYNC_MODEL.md` §2–§3, §13; `SWAFT_DATA_MODEL.md` §3–§4, §20; `SWAFT_UI_SPEC.md` §2–§3.
>
> **Tests to write & run (must pass):**
> - Create → close → reopen a `.swaft` workspace; data persists; storage mode is immutable (no mutation path).
> - Sync-metadata columns present on synchronized entities; local-only/secure-local separation holds.
> - If encryption enabled: wrong password fails clearly; warning shown at creation. DB access runs off the main thread.
> - Newer `schemaVersion` is rejected with a clear error.
>
> **Done when:** a user can create/open/reopen a local workspace via the wizard, with persistence, immutability, and (at least hooked) encryption, all tested.
>
> **See it:** `npm run dev` → create a workspace via the wizard; close and reopen the `.swaft`; data persists. **Verify:** `npm run verify`.

---

## M5 — Workspace shell, Working Tree, projects/folders/tags, settings/restrictions

**PROMPT**

> Implement the **workspace shell** and organization. (Requires M4.)
>
> **Build (main):** services + repositories for **Project**, **Folder**, **Tag**, **Workspace Settings**, **Restriction** CRUD (all 🟢 synchronized; carry sync metadata). SettingsService holds execution mode, allowed HTTP domains, allowed actions, allowed capabilities, proxy (non-secret), file-export root.
>
> **Build (renderer):**
> - **Workspace shell**: always-visible **Working Tree** (left) + right-hand view area + header (workspace name, execution-mode indicator, encryption/storage indicators, **Settings**, **Profile/Account** with Lock/Sign-out, Batcher entry).
> - **Working Tree** (virtualized): projects (filters), folders (collections), templates; **template context menu** (Open, Edit, Rename, Clone, Delete, Select release) and a folder context menu. Type/method/release visual encoding.
> - **Workspace Settings** UI (execution mode with `dev` gated by confirmation/permission; allowed domains; restrictions; proxy). **Profile/Preferences** UI (theme/color/language from M2/M4).
>
> **Reference:** `SWAFT_UI_SPEC.md` §4–§8, §19; `SWAFT_DATA_MODEL.md` §5–§6; `SWAFT_SECURITY_MODEL.md` §8 (execution modes).
>
> **Tests to write & run (must pass):**
> - Project/folder/tag/settings/restriction CRUD persists and survives reopen; carries sync metadata.
> - Working Tree renders virtualized; context menus expose the required items; projects filter the tree.
> - Entering `dev` requires confirmation/permission; settings persist.
>
> **Done when:** a user can organize a workspace in a coherent shell with a virtualized tree and working settings, all tested.
>
> **See it:** `npm run dev` → create projects/folders/tags in the Working Tree; use context menus; change settings. **Verify:** `npm run verify`.

---

## M6 — Seebo host, input-widget capabilities, Document View + Input Panel + rendering

**PROMPT**

> Integrate the **Seebo engine** and build **Document templates** end-to-end. (Requires M5.)
>
> **Build (main):**
> - **Seebo host** (`createEngine`): register the **input-widget capability catalog** (textbox, textarea, number, boolean, listbox, multiOption, jsonInput, datetime, duration) as **interactive capabilities**, plus policy (`allowedCapabilities` includes them; `allowedFunctions`/`allowedTypes`; limits; clock; workspace locale). Capabilities resolve via `stopOn` (host-driven input).
> - **TemplateService** for `document` templates (CRUD, draft `{ source }`).
> - **RenderService**: drive `start`/`run`/`drive` to render; surface `analyze().requirements` (with `capability`, `type`, `options`) to the renderer; resume with provided values. **Run heavy renders on a worker.** Collect the action plan (used in M10) but do not execute.
> - **Input State** persistence (🔵 local-only, per template): last input values pre-fill the panel; never persist secret-bound values in clear.
>
> **Build (renderer):**
> - **Document View** = **Input Panel** + **Main Document View** (+ Action Panel later, only when actions exist).
> - **Input Panel**: build a list of inputs from requirements; **select each widget by the requirement's `capability`** via an input-widget registry (widgets are shared design-system components); `listbox`/`multiOption` use `options`; `jsonInput` supports import + drag-and-drop. Persist/restore last inputs.
> - **Main Document View**: render output per document subtype; surface Seebo diagnostics (code/position) clearly; distinguish waiting-on-input from in-progress.
>
> **Reference:** `SWAFT_ARCHITECTURE.md` §8–§8.2.1; `SWAFT_UI_SPEC.md` §9–§9.1.1; Seebo `USAGE.md`/`API.md`.
>
> **Tests to write & run (must pass):**
> - A document template renders; requirements map to the **correct widget per capability**, with type/options honored.
> - Last input values persist locally and pre-fill on reopen; not synchronized (verified at storage layer).
> - Heavy render runs off the main thread; diagnostics surface correctly.
>
> **Done when:** a user can fill capability-driven inputs and render a document via Seebo, with persisted inputs, all tested.
>
> **See it:** `npm run dev` → open a document template; the Input Panel shows the right widget per capability; render the output. **Verify:** `npm run verify`.

---

## M7 — Render View, Template Editor, releases, changelog, release selection

**PROMPT**

> Add **Render templates**, the **Template Editor**, and the **release/changelog** model. (Requires M6.)
>
> **Build (main):**
> - **ReleaseService**: create **immutable**, **linearly versioned** releases (snapshot of the draft); list; immutability enforced (no field changes post-creation). **Changelog** entries (🟢 synchronized) for template/release/settings/etc. changes.
> - **ReleaseSelectionService**: per-template **personal, local-only** release selection (🔵); fallback latest→draft.
> - Render templates in TemplateService (`render` subtypes).
>
> **Build (renderer):**
> - **Render View**: view-only output for subtypes (html, markdown, eml, mermaid, swagger, openapi, echarts, json-preview). Heavy renderers (mermaid/echarts/swagger) **code-split + run in a Web Worker**. No Input/Action panels.
> - **Template Editor** (all types): document/render source editor; **per-input capability/type/options authoring**; inline `validate`/`analyze` feedback (debounced); **Create release** (immutable, linear); changelog editing. (API editors come in M8.)
> - **Release selection** via the Working Tree three-dot menu; selected release drives Input Panel + render.
>
> **Reference:** `SWAFT_UI_SPEC.md` §14, §16, §17; `SWAFT_DATA_MODEL.md` §7–§9; `SWAFT_PRODUCT_SPEC.md` §8.
>
> **Tests to write & run (must pass):**
> - Creating a release snapshots the draft immutably; editing the draft does not alter releases; versions are linear.
> - Release selection is personal/local-only (not synchronized) and changes the rendered release for that user.
> - Render View shows each subtype view-only; heavy renders run off the render thread.
>
> **Done when:** authors can edit templates, cut immutable releases with changelog, and pick releases; render templates display; all tested.
>
> **See it:** `npm run dev` → edit a template, create a release (+changelog), switch the selected release in the tree; view a render template. **Verify:** `npm run verify`.

---

## M8 — API templates + HTTP client + API View

**PROMPT**

> Implement **API templates** and the **real HTTP client**. (Requires M5–M7 infra.)
>
> **Build (main):**
> - **HttpService** (infra http-client): execute the **structured request model** (method/url/headers/query/body/auth) — never cURL. Auth: **Bearer / Basic / API key**, with secrets resolved from **SecretService** (OS keychain; references only to renderer). Enforce **allowed domains** (anchored host match; re-validate on redirects; SSRF hardening), **proxy** support (proxy creds secure). Run large response handling off the main thread; cap/stream.
> - **API history** per template (🔵 local-only, **metadata-only** by default): record, list, delete per record, clear per template.
> - API templates in TemplateService (subtype = method); structured request persisted (secrets referenced via `secretRef`).
>
> **Build (renderer):** **API View** only (no Document/Action panels): method selector, URL, structured params/headers/body editors, auth config (secrets as references, never shown), Send (routes via backend), response display, history (delete/clear). Blocked-domain errors shown clearly.
>
> **Reference:** `SWAFT_UI_SPEC.md` §11; `SWAFT_DATA_MODEL.md` §7.3–§7.4, §12; `SWAFT_SECURITY_MODEL.md` §9; `SWAFT_ARCHITECTURE.md` §10.1.
>
> **Tests to write & run (must pass):**
> - A real HTTP request executes via the backend and renders the response; cURL is never the stored model.
> - A non-allowed domain is blocked with a coded error; redirect to a non-allowed host is blocked.
> - Bearer/Basic/API-key work; secrets are in keychain and never shown; history is per-template, metadata-only, deletable/clearable.
>
> **Done when:** users author and run structured HTTP requests with enforced domains/proxy/auth and managed history, all tested.
>
> **See it:** `npm run dev` → in API View, send a request; try a non-allowed domain (blocked); review per-template history. **Verify:** `npm run verify`.

---

## M9 — Database client + Database View

**PROMPT**

> Implement the **read-only-by-default database client**. (Requires M5 infra.)
>
> **Build (main):**
> - **DatabaseService** (infra db-client): connect to **SQLite** and **PostgreSQL**; **read-only by default**; **block dangerous statements** (`DROP/DELETE/UPDATE/INSERT/ALTER/TRUNCATE/CREATE`) unless dev permissions allow; sandbox forbids writes outright. Prefer a **read-only role/transaction + statement classification** (do not rely on string matching alone, esp. Postgres). Run queries **on a DB worker**; **stream/paginate** results.
> - **Credentials** in OS keychain (🟠); never in `.swaft`, never synchronized.
> - **Query history** (🔵 local-only, **metadata-only** — no result rows). **Export** results to **CSV/JSON** (streamed to file). DB results are **not** Seebo inputs (v1); no masking (v1).
>
> **Build (renderer):** **Database View**: connection picker (engine, read-only indicator), SQL editor, Run, **virtualized** results grid, Export CSV/JSON, metadata-only history. Blocked statements show a clear explanatory error.
>
> **Reference:** `SWAFT_UI_SPEC.md` §15; `SWAFT_DATA_MODEL.md` §13; `SWAFT_SECURITY_MODEL.md` §10; `SWAFT_ARCHITECTURE.md` §10.2.
>
> **Tests to write & run (must pass):**
> - A SELECT runs read-only and renders (virtualized); `DELETE`/`DROP` is blocked with a coded error (SQLite and Postgres).
> - Credentials are in keychain; history stores metadata only (no rows); CSV/JSON export streams correctly.
> - Queries run off the main thread.
>
> **Done when:** users can safely inspect SQLite/Postgres read-only with export and metadata history, all tested.
>
> **See it:** `npm run dev` → connect a DB, run a SELECT (virtualized results), try `DELETE` (blocked), export CSV/JSON. **Verify:** `npm run verify`.

---

## M10 — Actions + Action Panel + Batcher

**PROMPT**

> Implement **action execution** and the **Batcher**. (Requires M6–M7.)
>
> **Build (main):**
> - **ActionService**: bridge to `seebo/actions`. The pure core only **prepares** the plan (from M6 render); ActionService **executes** via `executeActionPlan` with: only **confirmed** ids (`confirmedActions`), **`failFast: true`** for "Perform all", **permission/policy** checks (fail-closed), **allowed-actions** + **sandbox** gating (deny dangerous types/environments), **redaction**, and **audit**. Code-defined handlers only (v1; register via `defineAction`).
> - **Receipts** persisted **local-only** (🔵), redacted (no secrets), visible to the UI.
> - **BatcherService**: compose **document templates only**; preserve order; resolve **shared input IDs once** and reuse; apply **Seebo merge macros** (ABSORB/MERGE) respecting selected releases. Temporary (not a persisted synced object).
>
> **Build (renderer):**
> - **Action Panel** inside Document View — shown **only when the render produced ≥1 action**. Per-action display (id/type/environment, redacted input summary), per-action **confirmation**, **Perform all** (fail-fast), failure surfacing, action badges, **receipts** view.
> - **Batcher** UI: drag-and-drop ordered list of document templates, shared-input resolution, render batch; rejects API/render templates.
>
> **Reference:** `SWAFT_UI_SPEC.md` §9.3, §10, §12, §13, §18; `SWAFT_SECURITY_MODEL.md` §11; `SWAFT_ARCHITECTURE.md` §9; Seebo `ACTIONS.md`.
>
> **Tests to write & run (must pass):**
> - Action Panel appears only when actions exist; nothing runs without confirmation (backend rejects unconfirmed).
> - `Perform all` stops at first failure; remaining not executed; failure visible. Sandbox blocks dangerous/disallowed actions even when generated by rendering.
> - Receipts are local-only and redacted. Batcher accepts only document templates, preserves order, resolves shared inputs once, applies merge macros.
>
> **Done when:** users can review/confirm/execute Seebo actions with receipts, and compose document batches, all tested.
>
> **See it:** `npm run dev` → render a template that produces actions; confirm + execute; try Perform all (fail-fast); view receipts; compose a batch. **Verify:** `npm run verify`.

---

## M11 — Hardening, performance, UI coherence, packaging, release readiness

**PROMPT**

> Final hardening and release readiness. (Requires M0–M10.)
>
> **Build / verify:**
> - **Security:** complete the **enforcement matrix** (`SWAFT_SECURITY_MODEL.md` §17) and **IPC hardening** with passing, **release-blocking** tests; audit events emitted and **redacted**; verify no secret/verifier ever reaches the renderer, `.swaft`, sync, or logs.
> - **Performance:** finalize **worker offloading**, **virtualization**, **streaming**; establish and **meet performance budgets** (cold start, workspace open, render latency, DB first-row) and track them in CI.
> - **UI coherence & states:** ensure every view uses the **shared design system**; complete **empty/loading/error** states; verify **AA contrast** in both themes; remove any one-off components.
> - **Packaging:** `electron-builder` packaging with native modules (`better-sqlite3`/`pg`) per supported OS; **code signing/notarization**; **auto-update** (`electron-updater`); `schemaVersion` gating verified.
> - **Docs alignment:** confirm behavior matches the specs; record any resolved/deferred open decisions.
>
> **Reference:** `SWAFT_MVP_SCOPE.md` §8–§10; `SWAFT_SECURITY_MODEL.md` §17; `SWAFT_ARCHITECTURE.md` §11.
>
> **Tests to write & run (must pass):**
> - Full enforcement-matrix + IPC + auth security suite green (blocking).
> - Performance budgets met in CI; e2e smoke (sign in → workspace → template → render → API → DB → confirm action → receipt) green on at least one OS.
> - Packaged, signed app launches on supported OSes; newer-`schemaVersion` rejected.
>
> **Done when:** all **Release Readiness Criteria** (`SWAFT_MVP_SCOPE.md` §10) hold — **the MVP is ready to ship.**
>
> **See it:** install the **packaged, signed** app and launch it; run the full flow end-to-end. **Verify:** `npm run verify` + `npm run build` + `npm run e2e`, plus performance budgets in CI.

---

## After the MVP

Continue with [`NEXT_STEPS.md`](NEXT_STEPS.md) for the deferred scope (full P2P, server mode,
SSO/OIDC, MFA, plugin actions, advanced permissions, cURL import/export, advanced DB write workflows,
the web app build, etc.), using the same milestone-prompt format.
