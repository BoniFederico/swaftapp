# Removing login & the "user" concept — impact analysis

**Status:** analysis / design only. Nothing implemented.
**Goal:** eliminate the concept of *user*, *account* and *login* from Swaft. The app should launch
straight into the workspace homepage, with no sign-up / sign-in / lock / unlock and no per-user
identity anywhere.

This document inventories exactly what "auth" is today, what can be deleted cleanly, the four coupling
seams that need a decision, the proposed target architecture, and a phased plan.

---

## 1. Why this is tractable

Authentication in Swaft is a **self-contained local subsystem** ("local multi-account authentication":
several local accounts per device, an in-memory main-process session, Argon2id password verifiers
sealed with OS `safeStorage`). It is *not* woven through the domain. The only places account identity
leaks into features are a single `currentUsername()` function injected into three services, plus the
render/IPC gates. Everything else that sounds user-related — workspace encryption, `deviceId`,
`recent`, `preferences`, `trustedCode` — is **install-scoped, not user-scoped**.

So removal is mostly *deletion*, plus **four seams** that need an explicit decision (§4).

---

## 2. Current architecture (what "login" is today)

### 2.1 Renderer
- **`renderer/src/auth/AuthProvider.tsx`** — React context mirroring main-process session state
  (`state`, `profile`, `busy`, `errorCode` + actions `signUp/signIn/unlock/signOut/lock`). Bootstraps
  via `auth.status` on mount.
- **`renderer/src/auth/AuthScreen.tsx`** — the unauthenticated gate; contains `SignUpForm`,
  `SignInForm`, `LockedForm` inline + brand header + language picker.
- **Render gate — `renderer/src/App.tsx`** — `SignedInGate` (App.tsx:25-43): `loading` → spinner;
  **`state !== 'signed-in'` → `<AuthScreen/>`**; only when signed-in mount `WorkspaceProvider` /
  `WorkspaceRouter`. This one line is what hides the entire app behind auth.
- **Account controls** are inline in workspace chrome (there is no `AccountControls` component anymore —
  it was removed on `improve_gui`): `Homepage.tsx` shows `home.signedInAs` + Lock + Sign-out; the
  top-bar trio is Settings / Lock / Sign-out. `WorkspaceView.tsx` has a Lock button in its action trio.

### 2.2 Main process (`main/auth/`)
- **`AuthService.ts`** — the session authority: in-memory `session` + `lockedUsername`, `status()`,
  `isSignedIn()`, `currentUsername()`, `whoami()`, `signUp/signIn/unlock/signOut/lock`, lockout logic
  (5 attempts, 30 s exponential backoff). `AuthError extends AppError`.
- **`stores.ts`** — `FileAccountStore` (JSON at `userData/account.json`) + `InMemoryAccountStore`.
- **`types.ts`** — ports: `AccountRecord`, `AccountStore`, `SecureCipher`, `PasswordHasher`, `Session`.
- **`argon2-hasher.ts`** — Argon2id (hash-wasm, OWASP params).
- **`cipher.ts`** — `SafeStorageCipher` (Electron `safeStorage`, DPAPI/Keychain).
- **`registry.ts`** — process-wide `setAuthService`/`getAuthService`.
- **`bootstrap.ts`** — `bootstrapAuth()`: builds the real service, points it at `userData/account.json`,
  and wires `setSessionGate({ isSignedIn: () => service.isSignedIn() })`.
- **`testing.ts`** — `FakeHasher`, `IdentityCipher`, `makeTestAuthService()` used across tests.

### 2.3 Session / transport gate
- **`main/transport/session.ts`** — module-level `gate`, default **fail-closed**
  (`isSignedIn: () => false`), `setSessionGate()` / `isSignedIn()`. Deliberately free of Electron
  imports.
- **`main/transport/dispatch.ts:27`** — the enforcement point:
  `if (requiresSession(op) && !isSignedIn()) return makeError('NO_SESSION', 'auth', …)`.
- **`main/transport/handlers.ts`** — handlers for `auth.status/signUp/signIn/unlock/signOut/lock` +
  `session.whoami`, delegating to `getAuthService()`.

### 2.4 Ops & shared types (`packages/shared/src/ops.ts`)
- Schemas `signUpRequestSchema` / `signInRequestSchema` / `unlockRequestSchema`.
- Op names `auth.status/signUp/signIn/unlock/signOut/lock` + `session.whoami`.
- **`PUBLIC_OP_NAMES`** (`ops.ts:705`) = `system.ping`, `auth.status`, `auth.signUp`, `auth.signIn`,
  `auth.unlock`; `requiresSession(name) = !isPublicOp(name)` (`ops.ts:718`).
- DTOs: `AuthState = 'needs-setup'|'signed-out'|'locked'|'signed-in'`, `AuthProfile`,
  `AuthStatusResponse`, `WhoamiResponse`.

> ⚠️ **Do not confuse** with HTTP-request/folder auth (`httpAuthSchema`, `auth.none/inherit/apikey/…`).
> That is a completely separate feature (authenticating outgoing API calls) and must stay untouched.

---

## 3. Removal surface — what deletes cleanly

| Area | Delete |
| --- | --- |
| Renderer | `renderer/src/auth/` (AuthProvider, AuthScreen) |
| Main | `main/auth/` (AuthService, stores, types, argon2-hasher, cipher, registry, bootstrap, testing) |
| Ops | the 7 auth/session op names + `signUp/signIn/unlock` schemas + `AuthState`/`AuthProfile`/`AuthStatusResponse`/`WhoamiResponse` DTOs + their `OpContracts` rows |
| Handlers | the `auth.*` / `session.whoami` handler entries |
| i18n | `auth.*` (brandTagline, signUp/signIn/locked/username/displayName/password/…/error.*), `account.menu/lock/signOut`, `home.signedInAs`, `ipc.sessionOp` — **keep** the HTTP-auth `auth.none/inherit/apikey/token/placement*` keys |
| Persistence | `userData/account.json` (obsolete) |
| Tests | `auth/auth.test.tsx`, `main/auth/AuthService.test.ts`, `main/auth/stores.test.ts`; auth-specific cases in `dispatch.test.ts` |
| Deps | `hash-wasm` (Argon2) if used nowhere else — verify before dropping |

---

## 4. The four seams (need a decision, not a blind delete)

### Seam 1 — the session gate
`transport/session.ts` + `dispatch.ts:27` + `requiresSession`/`PUBLIC_OP_NAMES`.
Today **every non-public op requires a session**. With no accounts there is nothing to gate.

- **Option A: delete the guard.** Remove `session.ts`, the `dispatch.ts:27` check, and
  `PUBLIC_OP_NAMES`/`isPublicOp`/`requiresSession` from `ops.ts`. Simplest and honest — there is no
  session concept left.
- **Option B: keep the seam, hardwire open.** Leave `session.ts` but default `isSignedIn: () => true`.
  Lower churn, keeps a future re-introduction trivial, but leaves (small) scaffolding.

*Test impact:* ~15 renderer/main suites call `setSessionGate({ isSignedIn: () => true })`
(`document/action.test.tsx`, `batcher/batcher.test.tsx`, `document/editor.test.tsx`,
`document/render.test.tsx`, `workspace/tree.test.tsx`, `workspace/workspace.test.tsx`,
`document/api.test.tsx`, `dispatch.test.tsx`, `App.test.tsx`, …). Option A means removing those stub
calls and the sign-up helpers (`signUpToHomepage`, `signUpToWorkspaceApiTemplate`); Option B leaves
them working untouched.

> **Recommendation revised by §13 (web future): prefer Option B.** The hosted web backend will need
> *exactly* this gate (a session check in front of `dispatch`). Keep the seam, hardwire it open on
> desktop, and re-point `isSignedIn` at real server sessions on web. Deleting it now (Option A) only to
> rebuild it later is wasted work. Absent the web plan, Option A would be the clean choice.

### Seam 2 — `currentUsername()` attribution
Injected in `app-bootstrap.ts` (defined at :69, passed to three services at :151/:157/:189) and mirrored
in `workspace/testing.ts`.

- **`ChangelogService.ts`** writes `username: this.currentUsername()` (nullable column). → write `null`
  (or drop the param). The `changelog` column and `ChangelogEntryDto.username` are already
  `string | null`, so **no schema change is forced**; UI simply shows no author.
- **`ActionService.ts`** passes `actor: { username: currentUsername() ?? 'unknown' }` to Seebo
  `executeActionPlan`. → default `'unknown'` (already the fallback) or a fixed label like `'local'`.
- **`EnvironmentService.ts:58`** `ownerId = ownerKind === 'user' ? currentUsername() : null`. See Seam 3.

**Recommendation:** remove the `currentUsername` constructor parameter from all three services; changelog
writes `null`, action actor becomes a constant (`'local'`). Keep the nullable `username` column for now
(cheap, avoids a migration); optionally drop it in a later schema bump.

### Seam 3 — environment ownership (`owner_kind === 'user'`)
Environments can be **Personal** (`owner_kind='user'`, `owner_id=username`) or **Workspace**
(`owner_kind='workspace'`). The create form (`EnvironmentsSettings.tsx` → `CreateEnvForm` / `OwnerKindSeg`)
exposes this as a segmented control.

With no users, "Personal" has no meaning. Options:
- **Option A (recommended): collapse to workspace-only.** Remove the `OwnerKindSeg` from the create form;
  always create `owner_kind='workspace'`, `owner_id=null`. Keep the columns (existing rows stay valid);
  the picker/filter that distinguishes owners simplifies.
- **Option B: keep columns, hide the choice.** Same UI change, but treat any legacy `'user'` rows as
  read-only/visible. Needed only if existing workspaces already contain user-owned environments and we
  must not orphan them — a data-migration question (§6).

*Touch points:* `EnvironmentService.ts` (owner logic), `ops.ts` `EnvironmentOwnerKind` /
`env.create` schema, `environment/ownerKind.ts` (`OWNER_KIND_LABEL`), `EnvironmentsSettings.tsx`
(`OwnerKindSeg`), the env badges, and i18n `env.owner.*`.

### Seam 4 — renderer render gate + account controls
- **`App.tsx`**: drop `AuthProvider`/`SignedInGate`; render `WorkspaceProvider` → `WorkspaceRouter`
  directly (workspace open → `WorkspaceView`, else `Homepage`).
- **`Homepage.tsx`**: remove `useAuth`, the `home.signedInAs` label, and the **Lock / Sign-out**
  buttons. The top-bar actions collapse to just **Settings** (plus the workspace controls that only
  exist inside a workspace). Re-balance the `ws-actions` trio/​separators accordingly (this branch just
  tuned them — see `improve_gui`).
- **`WorkspaceView.tsx`**: remove the **Lock** button from the action trio; keep Settings + Close
  (close workspace → back to homepage). The trio becomes Settings / Close.

---

## 5. Confirmed NOT coupled (safe — no change)

- **Workspace encryption** — uses a **per-workspace password supplied in the op request**
  (`workspaceCreateRequestSchema.password`, `workspaceOpenRequestSchema.password`), whole-file
  AES-256-GCM via `CryptoService`/`LocalFilePersistence`. Zero reference to the account or its verifier.
- **`deviceId`** — a per-install `randomUUID()` in `AppStore` (`app-store.json`), stamped onto synced
  rows. Independent of accounts.
- **`recent`, `preferences`, `trustedCode`** — all install-scoped in `AppStore`, never keyed by user.
- **HTTP-request `auth.*`** (`httpAuthSchema`) — a different feature entirely.

---

## 6. Data / persistence impact

- **`account.json`** becomes dead. New installs never create it; existing files can be ignored or
  deleted on first run (a tiny best-effort cleanup, optional).
- **No user-keyed data exists**, so there is nothing to migrate for recent/preferences/trustedCode.
- **`changelog.username`**: existing rows keep their historical author strings; new rows get `null`.
  Harmless. A later schema bump can drop the column if desired.
- **`environments.owner_kind/owner_id`**: legacy `'user'`-owned rows remain in old workspaces. If we
  collapse to workspace-only (Seam 3A), decide whether to (a) leave them visible as-is, or (b) migrate
  them to `'workspace'` on load. Recommendation: leave as-is (they still open); no forced migration.
- **`.swaft` / Git workspace files**: unaffected (encryption independent).

---

## 7. Security model shift (call out explicitly)

Today the account gate provides an **app-open barrier** and the Lock feature. Removing it means:

- The app opens immediately; **the only at-rest protection left is per-workspace encryption** + the OS
  user account. This is appropriate for a local, single-user desktop tool, but it is a deliberate
  product/security decision worth recording (update `SWAFT_SECURITY_MODEL.md §3a`).
- No more Argon2id verifier, no `safeStorage`-sealed secret for the app itself. `safeStorage` may still
  be used elsewhere (verify) but the account cipher goes away.
- The IPC "public op" allow-list disappears; **every op is callable** by the renderer. Since the
  renderer is our own trusted bundle and there is no multi-user boundary, this is acceptable — but the
  op allow-list itself (`OP_NAMES` validation in `channels.ts`) should stay as an input-safety measure.

---

## 8. Proposed target architecture (after removal)

```
App.tsx
 └─ WorkspaceProvider
     └─ WorkspaceRouter        // no AuthProvider, no gate
         ├─ Homepage           // top bar: brand · … · [Settings]
         └─ WorkspaceView      // top bar: … · [Settings] [Close]
```

- **Main**: no `main/auth/`; `dispatch` runs op → validate → handle (no session check).
- **Ops**: no auth/session ops; no `PUBLIC_OP_NAMES`/`requiresSession`.
- **Attribution**: changelog author `null`, action actor `'local'`, environments workspace-owned.
- **Startup**: `app-bootstrap` no longer calls `bootstrapAuth()` / `setSessionGate`.

---

## 9. Phased plan

**Phase 0 — shared/ops (the contract).** Remove auth/session op names, schemas, DTOs, and
`PUBLIC_OP_NAMES`/`isPublicOp`/`requiresSession` from `ops.ts`. Update `OpContracts`. (Everything
downstream now fails to compile where it references these — a useful worklist.)

**Phase 1 — main process.** Delete `main/auth/`; drop the `session.ts` gate and the `dispatch.ts:27`
check; remove the `auth.*`/`session.whoami` handlers; remove `bootstrapAuth()`/`setSessionGate` from
`app-bootstrap.ts`; drop the `currentUsername` param from Changelog/Environment/Action services and their
wiring (`app-bootstrap.ts`, `workspace/testing.ts`).

**Phase 2 — environments.** Collapse ownership to workspace-only: remove `OwnerKindSeg` from
`CreateEnvForm`, always create `owner_kind='workspace'`; simplify `EnvironmentService`, the
`EnvironmentOwnerKind` type/schema, `ownerKind.ts`, badges, and `env.owner.*` i18n.

**Phase 3 — renderer shell.** Delete `renderer/src/auth/`; rewrite `App.tsx` to mount the workspace
router directly; strip Lock/Sign-out/`signedInAs` from `Homepage.tsx` and Lock from `WorkspaceView.tsx`;
re-balance the top-bar action trio/separators.

**Phase 4 — i18n, tests, docs, deps.** Remove the `auth.*`/`account.*`/`home.signedInAs`/`ipc.sessionOp`
keys (keep HTTP-auth keys). Delete auth tests; remove `setSessionGate`/sign-up helpers from the ~15
suites that used them (they get simpler). Update docs (`SWAFT_SECURITY_MODEL.md §3a`,
`SWAFT_DATA_MODEL.md §20`, `SWAFT_UI_SPEC.md §2a`, `SWAFT_ARCHITECTURE.md §5`, milestone/README files).
Drop `hash-wasm` if unused elsewhere. Optional: best-effort delete of `account.json`.

Each phase is independently type-checkable/testable; the repo stays green between phases if you fix the
compile errors each phase surfaces before moving on.

---

## 10. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Removing the gate exposes every op | Acceptable (single trusted renderer, no multi-user boundary); keep the `OP_NAMES` input-validation allow-list. |
| ~15 test suites rely on `setSessionGate`/sign-up helpers | Update them in Phase 4; net simplification (delete the sign-up dance). |
| Legacy `'user'`-owned environments in existing workspaces | Leave columns; rows still open. No forced migration. |
| `changelog.username` history | Keep column nullable; new rows `null`. Optional later drop. |
| Hidden `safeStorage`/`hash-wasm` uses | Grep before deleting the dep/cipher; only remove if account-only. |
| Security expectations change (no app lock) | Document the shift in `SWAFT_SECURITY_MODEL.md`; workspace encryption remains the at-rest control. |

---

## 11. Verification

- `npm run typecheck` after each phase (the ops removal in Phase 0 is the compiler-driven worklist).
- `npm run lint` (catches now-unused imports/vars left by deletions).
- `npm test` — expect the auth suites gone and the ~15 gate-stubbing suites simplified; the rest
  unchanged. Add/keep a smoke test that the app renders the Homepage directly with no auth screen.
- Manual smoke: fresh launch → Homepage immediately; create/open/clone a workspace; changelog entries
  have no author; environment creation offers no Personal/Workspace choice; no Lock/Sign-out anywhere.

---

## 12. Open decisions

1. **Session gate:** delete entirely (A) or keep hardwired-open (B)? *Recommend **B** given the web
   future — see §13; A only if the web plan is dropped.*
2. **Environment ownership:** collapse to workspace-only now (A) or keep columns + hide choice for
   legacy rows (B)? *Recommend A, leaving legacy rows as-is.*
3. **`changelog.username`:** keep nullable column (cheap) or schedule a schema bump to drop it?
   *Recommend keep for now.*
4. **`account.json` cleanup:** ignore old files, or best-effort delete on first run? *Cosmetic.*
5. **Action actor label:** `'local'` vs `'unknown'` vs omit the field. *Recommend `'local'`.*

---

## 13. The web-app future — does it change the decision to remove auth?

**Context.** Later, Swaft should become a **web app** — a *limited* one, keeping only the **document
view** (render/run templates) — **with real authentication**. The question: given that, is it worth
removing auth now? Is desktop + web in one repo hard? Can the backend be reused? How?

### 13.1 The codebase is already designed for this

This is the decisive fact. The architecture was built for web portability from day one:

- **Transport abstraction.** `renderer/src/api-client/transport/types.ts` defines a one-method
  `Transport`; the renderer's `ApiClient` is transport-agnostic and *feature code never touches a
  transport*. Desktop uses `ipc.ts`; **a web `HttpTransport` already exists as a stub** (`http.ts`) —
  it `POST`s `/op/<op>` with `credentials: 'include'` (cookie auth) to "the same service layer over an
  authenticated HTTP backend."
- **Transport-agnostic dispatch.** `main/transport/dispatch.ts` is explicitly written so "the IPC
  router **and a future HTTP server** both call this." No business logic in the transport.
- **The session gate is already host-neutral.** `main/transport/session.ts` is deliberately free of any
  Electron import so `dispatch` stays portable — its whole reason to exist is to let a *different host*
  inject a *different* `isSignedIn`.
- **Electron is confined to ~6 shell files** (`index.ts`, `ipc/router.ts`, `app-bootstrap.ts`,
  `auth/bootstrap.ts`, `auth/cipher.ts`, `usercode/UtilityProcessRuntime.ts`). The **service layer,
  handlers, ops, workspace/git/storage logic do not import Electron.**
- **Host concerns are already behind ports:** `WorkspacePersistence`, `DirFs`, `GitService`,
  `DbBackend`, `ScriptRuntime` (`UtilityProcessRuntime implements ScriptRuntime`). Swapping the host
  means swapping port implementations, not rewriting features.
- Documented as the intended path: `SWAFT_ARCHITECTURE.md §12` ("limited web app… reuse most layers via
  the transport abstraction"), `NEXT_STEPS.md N11` ("Web app build — HTTP transport + hosted backend").

**Implication:** the *plumbing* the web app needs — a session gate in front of `dispatch`, per-request
identity, per-user data scoping — is already present and host-agnostic. That plumbing is the valuable
part, and it is **the very thing an over-eager auth removal would delete.**

### 13.2 Is the *desktop* auth reusable for web? No — and that's the point

Desktop auth is **local multi-account**: Argon2id verifiers sealed with OS `safeStorage`, an in-memory
main-process session, sign-up/lock UI. None of that transfers to web, which needs **server-side sessions
(cookies/JWT over HTTPS), a real user store, password reset, and multi-tenant isolation**. So:

- The desktop **implementation** (`main/auth/*`, the sign-up/lock screens) is **throwaway** for web →
  keeping it "for later" buys nothing. **Remove it.**
- The **seams** (session gate, `currentUsername()` attribution injection, the render gate, the
  `Transport`/cookie contract) are **reused verbatim** by web → **keep them** (hardwire open on desktop).

So the web future doesn't argue *against* removing auth — it argues for a **precise** removal:
**delete the desktop login UX + local-account code; preserve the identity/session seams.** This is why
§4/§12 flip Seam 1 to *keep the gate, hardwired open* rather than *delete it*.

**Verdict on "vale la pena togliere l'autenticazione?"** Yes — removing the desktop login *flow* is
worthwhile (it's friction, and it's not the auth the web app will use). Just don't rip out the gate and
attribution seams; leave them inert on desktop so the web build slots real auth into them.

### 13.3 Is desktop + web in one repo hard? Moderate, and half-done already

It's a monorepo with npm workspaces and a shared contract package (`@swaft/shared`) — the hard
structural prerequisite is already in place. Proposed evolution:

```
packages/
  shared/     # ops, DTOs, schemas, error envelope — already shared, unchanged
  core/       # NEW: the host-agnostic backend — dispatch + handlers + services + ports
              #      (moved out of apps/desktop/src/main, minus the Electron shell)
apps/
  desktop/    # Electron shell: provides Electron port impls + IPC transport + preload
  server/     # NEW: Node HTTP server — hosts /op/:op → dispatch, real auth middleware,
              #      server port impls (DB, storage, git, sandbox)
  web/        # NEW: React app — the document-view subset + HttpTransport (already stubbed)
packages/
  ui/         # OPTIONAL: shared React components (document views) used by desktop + web
```

Cost is mostly **mechanical extraction** (move `main/` service code into `packages/core` behind the
ports it already mostly uses) plus building two new thin shells (`server`, `web`). The risky/creative
work is the web-only pieces in §13.5, not the reuse itself.

### 13.4 Can the backend be reused? Yes — substantially

| Layer | Reuse on web |
| --- | --- |
| `@swaft/shared` (ops/DTOs/schemas/errors) | **100%** — the contract is the shared truth. |
| `dispatch` + `handlers` | **~100%** — already transport-agnostic; the HTTP server calls `dispatch(op, payload)` just like the IPC router. |
| Domain services (workspace, changelog, environments, actions, tree, template, render, seebo…) | **High** — no Electron imports; depend on injected ports. |
| Ports: `WorkspacePersistence`, `DirFs`, `GitService`, `DbBackend`, `ScriptRuntime` | **Interface reused; implementation swapped** per host. |
| Electron-only host code (`safeStorage` cipher, native dialogs, `app.getPath`, `utilityProcess`, preload/IPC router) | **Not reused** — replaced by server equivalents (or dropped). |

The web app keeps only the **document view**, so it needs only a **subset of ops** (roughly:
`workspace.*` open/read, `tree.get`, `template.*` read, `document`/`render` execution, maybe
`actions.*`). A narrower surface means the web server can host a subset of handlers and skip
desktop-only ops (native dialogs, git UI, batcher, editor mutations) — simpler, not harder.

### 13.5 The genuinely web-specific work (where the effort actually is)

1. **Real auth + multi-tenancy.** Server sessions (cookie/JWT), user store, and — the deep change —
   **per-user data isolation**. Today `deviceId`, `recent`, `preferences`, `trustedCode`, and workspace
   files are **install-scoped**; on web they must become **user-scoped**. This is the single biggest
   web delta, and it re-introduces "user" — but as a *server tenancy* concept, not the desktop
   local-account one.
2. **Persistence.** Desktop uses **sql.js (WASM) serialized to a `.swaft` file** (or Git projection).
   Web needs a server story: either keep the sql.js-per-workspace blob in server storage (S3/DB blob)
   or project workspaces into a shared server DB (Postgres). The `DbBackend`/`WorkspacePersistence`
   ports make this a swap, but it's real design work (concurrency, per-tenant storage).
3. **User-code sandbox.** `UtilityProcessRuntime` (Electron `utilityProcess`) → a server sandbox
   (worker/isolate/container). `ScriptRuntime` is already the port; the impl is new and security-
   sensitive. (The limited web app may initially disable custom capabilities to sidestep this.)
4. **File I/O.** Native open/save dialogs → browser upload/download; local paths → server storage refs.
5. **Git workspace mode.** `execFile` to system git → server-side git service (or disable for web).
6. **Networking/HTTP policy.** The outgoing-HTTP client, blocked-domains/proxy policy already live in
   main; on a server they become an even more important egress control (SSRF surface).

### 13.6 How to get there (incremental, low-risk)

1. **Now (this task):** remove desktop login per §1–§11, but **keep the seams** (gate hardwired open;
   `currentUsername` returns `null`/`'local'`; keep `Transport`/cookie contract and `HttpTransport`
   stub). Desktop ships simpler; web plumbing intact.
2. **Extract `packages/core`:** move the host-agnostic backend out of `apps/desktop/src/main`, leaving
   Electron only in the desktop shell. No behavior change; both hosts consume `core`.
3. **Stand up `apps/server`:** thin HTTP server exposing `POST /op/:op` → `dispatch`, with an auth
   middleware that sets the session gate per request and injects the authenticated user into
   `currentUsername`. Start with server port impls for the document-view subset.
4. **Stand up `apps/web`:** reuse the document-view React components (extract to `packages/ui` if
   sharing with desktop) + `HttpTransport`. Add the login UI *there* (web auth, not desktop auth).
5. **Layer in multi-tenancy + server persistence + sandbox** as the web scope grows.

**Net:** removing desktop auth now and building web auth later are **not** in conflict — they touch
different layers. The desktop removal should be done in a way that **keeps the host-agnostic seams**,
which is exactly what turns "throwaway desktop auth" into "web-ready plumbing."
