# Swaft — Post-MVP Implementation Steps (NEXT_STEPS)

> **Purpose.** Everything **deferred from the MVP** ([`SWAFT_MVP_SCOPE.md`](SWAFT_MVP_SCOPE.md) §3,
> [`SWAFT_PRODUCT_SPEC.md`](SWAFT_PRODUCT_SPEC.md) §11.2), structured as ordered **milestones** with
> **LLM-ready prompts** — same format as [`MVP_STEPS.md`](MVP_STEPS.md). Do the MVP first; then pick
> up here. Milestones are largely independent but ordered by typical value/dependency; respect the
> noted prerequisites.
>
> **All Global Context, hard rules, and the test-gated discipline from [`MVP_STEPS.md`](MVP_STEPS.md)
> still apply.** Include that Global Context alongside each prompt below. Nothing here may weaken MVP
> security, the data classification, the transport abstraction, or the action/confirmation model.

---

## Milestone index (post-MVP)

| ID | Milestone | Source (deferred) | Prereqs |
|----|-----------|-------------------|---------|
| **N1** | P2P foundation: device identity + secure transport | Full P2P | MVP |
| **N2** | P2P sync engine: real-time LWW of synchronized data | Full P2P | N1 |
| **N3** | P2P trust: invitations, encrypted keys, allowlist, revocation/re-key | Full P2P | N2 |
| **N4** | Server storage mode + server-backed accounts | Server mode | N1–N3 (recommended) |
| **N5** | SSO / OIDC + MFA | Advanced auth | MVP auth (M3) |
| **N6** | Advanced permission system | Advanced perms | MVP |
| **N7** | Plugin-defined actions + marketplace | Plugin actions | MVP actions (M10) |
| **N8** | cURL import/export | cURL | MVP API (M8) |
| **N9** | Advanced DB write workflows | DB writes | MVP DB (M9) |
| **N10** | Data/feature enhancements (full HTTP history, DB masking, DB→Seebo inputs, full encryption) | Misc deferred | MVP |
| **N11** | Web app build (HTTP transport + hosted backend) | Future web app | Transport abstraction (M1) |

> Resolve the related **Open Decisions** (server details, account scope, conflict granularity, etc.)
> at the start of the relevant milestone; see the per-doc open-decision tables and the README index.

---

## N1 — P2P foundation: device identity + secure transport

**PROMPT**

> Lay the **P2P foundation** without syncing data yet. Reuse the repository/adapter boundary; add a `P2PAdapter` that wraps the LocalAdapter.
>
> **Build:**
> - **Device identity**: per-device keypair; **public key** is shareable workspace data (🟢), **private key** is secure-local (OS keychain, never synchronized, never to renderer). Stable `deviceId`; attribute writes via `updatedByDeviceId`.
> - **Secure peer transport** supporting network modes **`lanOnly` / `internet` / `both`** (configurable per workspace), with authenticated, encrypted channels between devices. No data sync yet — just discovery + authenticated session establishment between two trusted devices (trust wiring completes in N3).
> - `P2PAdapter` scaffold implementing the repository interfaces by delegating to LocalAdapter, with sync hooks stubbed.
>
> **Reference:** `SWAFT_SECURITY_MODEL.md` §5; `SWAFT_DATA_MODEL.md` §16; `SWAFT_STORAGE_SYNC_MODEL.md` §6, §10; `init.md` §6.
>
> **Tests to write & run (must pass):** keypair generation; private key never leaves keychain/never to renderer; two devices establish an authenticated, encrypted channel honoring the configured network mode; adapter boundary intact.
>
> **Done when:** trusted devices can establish a secure channel with stable identities, all tested. No workspace data crosses yet.

---

## N2 — P2P sync engine: real-time LWW of synchronized data

**PROMPT**

> Implement **real-time synchronization** of 🟢 synchronized entities with deterministic **last-write-wins**. (Requires N1.)
>
> **Build:**
> - Sync only **synchronized** entities (templates, releases, settings, projects, folders, tags, restrictions, changelog, + P2P public trust data). **Never** sync local-only or secure-local data (inputs, histories, receipts, preferences, default release selection, secrets, account, private keys).
> - **LWW** using sync metadata (`updatedAt`, `updatedByDeviceId`, `revision`, `deletedAt`; optional Lamport clock if skew appears): later `updatedAt` wins; tie → logical clock → `updatedByDeviceId`. Whole-entity resolution (v1). Tombstones (`deletedAt`) participate. Convergent: same changes → same state on all peers.
> - Real-time propagation over the N1 transport; resync on reconnect.
>
> **Reference:** `SWAFT_STORAGE_SYNC_MODEL.md` §5–§8; `init.md` §6.3–§6.6.
>
> **Tests to write & run (must pass):** convergence on conflicting edits (deterministic LWW); deletes vs edits resolve correctly; **local-only/secure-local never emitted** to sync (asserted); two-peer real-time propagation; reconnect resync.
>
> **Done when:** two allowlisted peers converge deterministically in real time on synchronized data only, all tested.

---

## N3 — P2P trust: invitations, encrypted keys, allowlist, revocation/re-key

**PROMPT**

> Complete the **P2P trust model**. (Requires N2.) Must not rely on a single shared key.
>
> **Build:**
> - **Signed invitations**: an authorized device issues an invitation **signed** by its key, carrying the **workspace key encrypted to the invitee's public key**; expiry; verifiable signature + issuer authorization before acceptance.
> - **Allowlist**: only allowlisted, non-revoked devices sync (enforced before any data flows).
> - **Revocation**: recorded in synchronized metadata (monotonic/tombstone-like so a revoke isn't lost to a stale allowlist write); revoked devices receive no further updates; **re-key** the workspace and re-encrypt to remaining authorized devices.
> - Device-management UI (invite, list devices, revoke).
>
> **Reference:** `SWAFT_SECURITY_MODEL.md` §5–§7 (incl. OD-S2 re-key); `SWAFT_DATA_MODEL.md` §16.
>
> **Tests to write & run (must pass):** unauthorized/unsigned/expired invitations rejected; only allowlisted devices sync; revocation stops future sync and re-keys; revoked device cannot decrypt post-revocation data; revocation not overridden by stale writes.
>
> **Done when:** devices join only via signed invitations and can be revoked with re-keying, fully enforced and tested. **Full P2P mode is complete.**

---

## N4 — Server storage mode + server-backed accounts

**PROMPT**

> Implement the **`server` storage mode** and server-backed accounts. (Resolve server Open Decisions first: Product OD-2, Storage OD-ST3.) Requires the transport/service boundary; reuse services unchanged.
>
> **Build:**
> - **ServerAdapter** implementing the repository interfaces against a server backend, preserving the **synchronized / local-only / secure-local** classification (local-only/secure-local stay on device). Reuse the same conflict model where applicable.
> - Server-backed **accounts/sessions** plugged into `AuthService` (the MVP local-account contract extends to server auth without feature-code changes). Server-side secret management (a SecretService impl).
> - Storage mode remains **immutable**; `server` chosen at creation; must not weaken local-first assumptions for local workspaces.
>
> **Reference:** `SWAFT_STORAGE_SYNC_MODEL.md` §9–§10; `SWAFT_ARCHITECTURE.md` §7, §12; `SWAFT_SECURITY_MODEL.md`.
>
> **Tests to write & run (must pass):** server-mode workspace CRUD/sync; classification preserved (local-only/secure-local never sent to server); auth via server accounts; immutability of storage mode.
>
> **Done when:** a server-backed workspace works end-to-end with preserved classification and server accounts, all tested.

---

## N5 — SSO / OIDC + MFA

**PROMPT**

> Add **SSO/OIDC** and **MFA** to authentication, extending the M3 `AuthService` contract without breaking local accounts. (Requires MVP M3; pairs well with N4.)
>
> **Build:**
> - **OIDC/SSO** sign-in flow (authorization code + PKCE recommended) behind the same AuthService contract; map to a Swaft account/session. Secure token handling (tokens secure-local; never to renderer in clear).
> - **MFA** (email and/or TOTP) as a second factor on sign-in; recovery considerations documented.
> - Auth screens extended for SSO buttons and MFA challenge, reusing the design system; no restructuring of the existing flows.
>
> **Reference:** `SWAFT_SECURITY_MODEL.md` §3a (AUTH-7); `SWAFT_UI_SPEC.md` §2a; `SWAFT_PRODUCT_SPEC.md` §11.2.
>
> **Tests to write & run (must pass):** OIDC flow establishes a session; MFA challenge enforced; tokens never reach the renderer in clear; local-account path still works unchanged; failure/lockout paths.
>
> **Done when:** users can sign in via SSO/OIDC with MFA, alongside local accounts, all tested.

---

## N6 — Advanced permission system

**PROMPT**

> Introduce a **fine-grained permission system** beyond sandbox/dev. (Requires MVP.) Must preserve confirmation and main-process enforcement.
>
> **Build:**
> - A roles/permissions model governing privileged operations (dev operations, action types, DB writes, settings/restriction changes, device management). Enforced in the **service layer** (fail-closed), surfaced in the IPC guard and Seebo action policy (`permissions`).
> - UI to view/assign permissions (scope per the chosen model — per-account/per-workspace; decide explicitly).
>
> **Reference:** `SWAFT_SECURITY_MODEL.md` §8, §11; Seebo `ACTIONS.md` (permissions/policy).
>
> **Tests to write & run (must pass):** permitted vs denied operations enforced server-side (fail-closed); action permission checks; no bypass via UI; confirmation still required for actions.
>
> **Done when:** privileged operations honor fine-grained permissions, fully enforced and tested.

---

## N7 — Plugin-defined actions + marketplace

**PROMPT**

> Allow **plugin-defined actions** (and a marketplace) while preserving the v1 action guarantees. (Requires MVP M10.)
>
> **Build:**
> - A **plugin system** to register additional Seebo action handlers safely. Plugins must run under the **same** guarantees: confirmation required, execution-mode/sandbox enforcement, allowed-actions policy, idempotency, redaction, receipts. Define isolation/trust for plugin code (sandboxing, capability limits, signing).
> - Plugin lifecycle (install/enable/disable/update), and a **marketplace** surface (discovery/install). Allowed-actions/capabilities still governed per workspace.
>
> **Reference:** `SWAFT_SECURITY_MODEL.md` §11 (ACT-10); Seebo `ACTIONS.md`; `SWAFT_PRODUCT_SPEC.md` §13 (OD-3).
>
> **Tests to write & run (must pass):** plugin action requires confirmation; sandbox/policy still block dangerous plugin actions; receipts/redaction/idempotency preserved; unknown/untrusted plugin cannot execute; isolation holds.
>
> **Done when:** vetted plugin actions execute under all existing safety guarantees, with marketplace install, all tested.

---

## N8 — cURL import/export

**PROMPT**

> Add **cURL import/export** for API templates as a convenience — the **canonical model stays structured**. (Requires MVP M8.)
>
> **Build:**
> - **Import**: parse a cURL command into the structured request model (method/url/headers/query/body/auth), mapping secrets to `secretRef` (never inline secrets in stored data).
> - **Export**: render the structured model to a cURL string on demand (with secrets redacted/omitted by default).
>
> **Reference:** `SWAFT_DATA_MODEL.md` §7.3; `init.md` §8.4.2; `SWAFT_PRODUCT_SPEC.md` §11.2.
>
> **Tests to write & run (must pass):** round-trip import→structured→export; canonical storage remains structured (never cURL); secrets are not inlined into stored templates or exports by default.
>
> **Done when:** users can import/export cURL without changing the structured canonical model, all tested.

---

## N9 — Advanced DB write workflows

**PROMPT**

> Add **guarded write workflows** to the DB client. (Requires MVP M9.) Read-only remains the default.
>
> **Build:**
> - Explicit, permissioned **write mode** (transactions, parameterized statements, preview/confirm before commit), gated by execution mode + advanced permissions (N6) and **never** available in sandbox. Strong confirmation and audit for writes.
> - Keep the read-only default and statement guard intact; writes are an opt-in, permissioned path.
>
> **Reference:** `SWAFT_SECURITY_MODEL.md` §10; `SWAFT_PRODUCT_SPEC.md` §11.2.
>
> **Tests to write & run (must pass):** writes blocked by default/in sandbox; permitted writes require confirmation + permission and are audited; transactions/rollback behave; no bypass.
>
> **Done when:** guarded DB writes are available only under explicit permission/confirmation, all tested.

---

## N10 — Data/feature enhancements

**PROMPT**

> Implement the smaller deferred enhancements (resolve their Open Decisions first). (Requires MVP.) Each is independent; ship behind explicit flags.
>
> **Build (each independently, behind opt-in):**
> - **Configurable full HTTP history** (beyond metadata-only): store full request/response **only** when explicitly enabled; still local-only; clear warnings; redaction options. (Product OD-1.)
> - **DB sensitive-column masking**: optional masking of flagged columns in results/exports.
> - **DB results as Seebo inputs**: an explicit, opt-in path to feed query results into Seebo template inputs (not automatic). (`init.md` §15.7.)
> - **Full whole-file encryption** if it was deferred from MVP to a hook+warning: complete Argon2id + AEAD with worker offloading and tamper detection. (Product/Security OD-S1, MVP OD-M1.)
>
> **Reference:** `SWAFT_DATA_MODEL.md` §12–§13; `SWAFT_SECURITY_MODEL.md` §4, §14; `SWAFT_STORAGE_SYNC_MODEL.md` §3.
>
> **Tests to write & run (must pass):** full history only when enabled (off by default); masking applied where flagged; DB→Seebo only via explicit opt-in (never automatic); encryption round-trips and detects tampering; nothing weakens existing classification/minimization.
>
> **Done when:** each enhancement ships behind an explicit opt-in without weakening defaults, all tested.

---

## N11 — Web app build (HTTP transport + hosted backend)

**PROMPT**

> Deliver the **limited web app** by reusing the renderer and service layer over the **HTTP transport**. (Requires the transport abstraction from MVP M1; benefits from N4 server mode.)
>
> **Build:**
> - **HttpTransport** implementing the same `Transport` interface (op/DTO/error envelope identical to IPC). The renderer swaps the transport adapter with **no feature-code changes** (verify the boundary held).
> - A **hosted backend** running the **same service layer** behind an authenticated HTTP server adapter (reuse `transport/` op dispatch). Server-side SecretService and auth (N4/N5).
> - Replace Electron-only behaviors (dialogs, `safeStorage`, file association) via the platform shim with web-appropriate implementations. Scope is a **limited** web app — only what the boundaries already support.
>
> **Reference:** `SWAFT_ARCHITECTURE.md` §3.4, §12 (WEB-1..WEB-5); `SWAFT_PRODUCT_SPEC.md` §11.2.
>
> **Tests to write & run (must pass):** the renderer runs against HttpTransport with no feature-code change; the same op contract works over HTTP; service-layer enforcement holds server-side; platform-shim swaps work; secrets handled server-side.
>
> **Done when:** the web app runs the same UI and services over HTTP, proving the transport abstraction, all tested.

---

## Notes

- These milestones may be reordered by business priority; respect the listed prerequisites.
- Before starting each, resolve the relevant **Open Decisions** (see each spec's open-decision table and the [`README.md`](README.md) index).
- Every milestone remains **test-gated**: tests written and green before it is considered done.
