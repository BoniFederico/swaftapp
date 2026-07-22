# Swaft — Security Model

> **Status:** Strict, implementation-oriented security specification.
> **Source of truth:** [`init.md`](init.md) and the Seebo security model ([`docs/seebo/SECURITY.md`](../seebo/SECURITY.md)).
> Elaborations are marked **Recommended**; undecided items **Open decision**.
> **Audience:** Security reviewers, backend engineers, frontend engineers.

This document is intentionally strict. Where it says **MUST**, the requirement is mandatory.

---

## 1. Security Principles

| # | Principle |
|---|-----------|
| 1 | **Main process is the authority.** All security rules are enforced in the Electron main process. Renderer/UI checks are convenience only and MUST NOT be relied upon. |
| 2 | **Default-deny.** Dangerous operations are blocked by default and only allowed by explicit configuration/permission. |
| 3 | **Explicit confirmation.** Every action execution requires explicit user confirmation, enforced in the main process. |
| 4 | **Renderer is untrusted.** The renderer is isolated/sandboxed with no Node/OS access; it reaches the backend only through the allow-listed, session-guarded IPC bridge. There is no local network surface. |
| 5 | **Data minimization.** Sensitive data is not stored or transmitted unless necessary; histories are metadata-only by default; receipts/audit are redacted. |
| 6 | **Secrets are isolated.** Secrets and the account verifier live in OS keychain / secure secret storage, never in synchronized data, never in the renderer in clear. |
| 7 | **No recovery backdoors.** Encrypted workspaces are unrecoverable if the password/key is lost. |
| 8 | **Authenticated access.** App access is gated by sign-in; the session guards every privileged op. |
| 9 | **Deterministic, auditable trust for P2P.** Device identity, signed invitations, allowlists, encrypted workspace keys and revocation — never a single shared key. |

---

## 2. Threat Model

### 2.1 Assets

| Asset | Sensitivity |
|-------|-------------|
| Workspace contents (templates, releases, settings) | Medium–High (may contain proprietary technical procedures). |
| Secrets (HTTP/DB/proxy credentials, encryption keys) | Critical. |
| Account credentials (password verifier, session) | Critical. |
| Local-only data (histories, receipts, inputs) | Medium (may contain sensitive values). |
| Device private keys (P2P) | Critical. |

### 2.2 Trusted vs Untrusted Surfaces

| Surface | Trust | Rationale |
|---------|-------|-----------|
| Electron **main process** (Node backend) | **Trusted** | The enforcement authority. |
| Seebo `define*` extensions / capabilities / action handlers | **Trusted** | Host code registered at engine creation (per Seebo security model). |
| Preload script | **Trusted, minimal** | Runs isolated; exposes only the allow-listed `contextBridge` surface. |
| Template source & resolved data | **Untrusted** | Authored/imported content; Seebo bounds and sanitizes it. |
| **Renderer process** (React UI) | **Untrusted host** | Treated as untrusted web content; isolated/sandboxed; never the enforcement point. |
| External HTTP endpoints / databases | **Untrusted** | Subject to allowed-domain / read-only constraints. |
| P2P peers (future) | **Conditionally trusted** | Only allowlisted, non-revoked devices with valid signed invitations. |

### 2.3 In-Scope Threats

| ID | Threat | Mitigation |
|----|--------|------------|
| **T1** | Compromised/hostile renderer content attempting to reach Node/OS or call un-permitted ops. | `contextIsolation`+`sandbox`+`nodeIntegration:false`; channel allow-list; sender check; session guard; DTO validation (§3). |
| **T2** | Malicious template attempting code execution / prototype pollution. | Seebo pure core (no `eval`/globals), sanitization, limits (§9). |
| **T3** | Template-generated action causing unintended effects. | Confirmation, allowed-actions, sandbox blocking, backend enforcement (§11). |
| **T4** | Exfiltration via outbound HTTP. | Per-workspace allowed-domain allow-list enforced in backend (§9). |
| **T5** | Destructive DB statements. | Read-only default, dangerous-statement blocking, backend enforcement (§10). |
| **T6** | Secret leakage to renderer / synced data / logs. | Secret isolation, redaction, never-returned-in-clear (§4, §13, §14). |
| **T7** | Unauthorized device joining a P2P workspace. | Device identity, signed invitations, allowlist, revocation (§5–§7). |
| **T8** | Loss/theft of `.swaft` file. | Optional whole-file encryption (§4). |
| **T9** | File writes escaping the workspace. | Sandbox file-boundary enforcement (§8.3). |
| **T10** | Unauthorized app access / credential attacks on the account. | Sign-in gate, Argon2id verifier, lockout/backoff, session guard (§3a). |
| **T11** | Remote code / external navigation in the renderer (Electron-specific). | Strict CSP, deny external navigation/`window.open`, no remote module (§3). |

### 2.4 Out of Scope (v1)

| ID | Out-of-scope item | Note |
|----|-------------------|------|
| **OOS-1** | OS-level process isolation / hard CPU-memory sandbox for templates. | Seebo bounds work via limits; run in an isolated process if OS-level guarantees are needed. |
| **OOS-2** | Secrecy of trusted extension/handler code. | Trusted by definition. |
| **OOS-3** | Multi-user / role-based access within one device. | Single local account in MVP; advanced permissions deferred ([`NEXT_STEPS.md`](NEXT_STEPS.md)). |
| **OOS-4** | Sensitive-column masking in DB results. | Not required v1. |
| **OOS-5** | Full server-mode / web threat model. | Server/web are future; details undefined. |
| **OOS-6** | Recovery of lost encryption keys. | Intentionally impossible. |

---

## 3. Renderer ↔ Main IPC Security (Electron hardening)

The desktop app has **no local HTTP server and no network port**. The only renderer→main surface is
the allow-listed `contextBridge` API. This removes the local-server attack surface entirely and
replaces it with Electron process hardening.

| ID | Requirement |
|----|-------------|
| **IPC-1** | The `BrowserWindow` MUST use `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`. |
| **IPC-2** | The preload MUST expose only a **minimal, typed** API via `contextBridge`; raw `ipcRenderer` MUST NOT be exposed. |
| **IPC-3** | Only channels (ops) on an explicit **allow-list** are callable; unknown channels MUST be rejected. |
| **IPC-4** | The main process MUST verify the IPC **sender frame** is the app's own top-level window (reject remote/iframe/unknown senders). |
| **IPC-5** | Every op payload MUST be validated against its DTO schema in the main process **before** any service runs. |
| **IPC-6** | Non-auth ops MUST require an **active session** (§3a); auth/bootstrap ops are the only exceptions. |
| **IPC-7** | A strict **Content-Security-Policy** MUST be set; `@electron/remote` MUST NOT be used. |
| **IPC-8** | External **navigation** and `window.open` MUST be denied (`will-navigate` / `setWindowOpenHandler`); only the app origin loads. The renderer MUST NOT load remote/untrusted URLs. |
| **IPC-9** | Errors returned across IPC MUST use the coded envelope and MUST NOT contain secrets. |
| **IPC-10** *(Recommended)* | Enable Electron `sandbox` for the renderer and run with the latest Electron security defaults; track Electron security advisories. |

---

## 3a. Authentication & Session Security

> **REMOVED (desktop).** Local accounts / sign-up / sign-in / lock were removed from the desktop app —
> there is no user or login concept; the app opens straight to the workspace. The **session guard**
> (`transport/session.ts` + `dispatch`) is retained as a host-agnostic seam, left **open** on desktop
> (`isSignedIn: () => true`), so a future hosted web backend (SWAFT_ARCHITECTURE.md §12) can inject
> real per-request sessions without changing feature code. At-rest protection is now solely
> per-workspace encryption (§4) plus the OS user account. See `remove_users.md` for the removal
> analysis. The rest of this section is retained for historical context / the future web target.

Swaft includes **sign-up / sign-in** (extends `init.md`, which deferred SSO/OIDC/MFA). The MVP uses a
**local account** that gates app access and owns the local profile.

| ID | Requirement |
|----|-------------|
| **AUTH-1** | The app is **gated by sign-in**; until a session is established, only auth ops are callable (IPC-6). |
| **AUTH-2** | Passwords MUST be stored as an **Argon2id verifier** (salted), never in plaintext, never reversible. The verifier is **secure-local** (OS keychain / `safeStorage`), never in `.swaft`, never synchronized. |
| **AUTH-3** | Sign-in MUST verify the password against the verifier in the main process; the renderer never sees the verifier or any derived key. |
| **AUTH-4** | A **session** is established on successful sign-in and is required by the IPC guard; it MUST be invalidated on sign-out, app exit, and (Recommended) inactivity timeout/lock. |
| **AUTH-5** | Failed sign-in attempts MUST be rate-limited / backed-off to resist brute force (Recommended: lockout with increasing delay). |
| **AUTH-6** | Account credentials MUST NEVER be returned to the renderer in clear (only session state / profile metadata). |
| **AUTH-7** | The AuthService contract MUST be designed so future **SSO/OIDC, MFA and server-backed accounts** plug in without changing feature code ([`NEXT_STEPS.md`](NEXT_STEPS.md)). |
| **AUTH-8** *(Recommended)* | Account auth is **distinct** from workspace encryption: signing in does not decrypt an encrypted workspace; the workspace password/key is still required separately (§4). |
| **AUTH-9** | Account auth and workspace encryption are **separate** (resolved OD-S7): the account password never wraps workspace keys; an encrypted workspace always requires its own password/key. |

---

## 4. Workspace Encryption

| ID | Requirement |
|----|-------------|
| **ENC-1** | Whole-file encryption of the `.swaft` workspace is **optional**, chosen at creation. |
| **ENC-2** | Encryption MUST protect the **entire** workspace file. |
| **ENC-3** | Loss of password/key MUST make the workspace **unrecoverable**; there MUST be no recovery backdoor. |
| **ENC-4** | The user MUST be clearly warned (at creation and on relevant flows) of unrecoverability. |
| **ENC-5** | Encryption metadata stored in/alongside the file MUST NOT expose sensitive workspace contents or key material. |
| **ENC-6** *(Recommended)* | Use authenticated encryption (AEAD: AES-256-GCM or XChaCha20-Poly1305) with a memory-hard KDF (Argon2id) over a random salt. |
| **ENC-7** *(Recommended)* | The derived key/password material is **secure-local** (OS keychain or in-memory only); it is never written to the file or synchronized. |
| **ENC-8** *(Recommended)* | Authenticate the ciphertext (reject tampered files) rather than failing silently. |

> **Open decision (OD-S1):** Exact KDF/cipher parameters and whether the MVP ships full encryption
> or a warning-grade placeholder with the adapter hook in place. See [`SWAFT_MVP_SCOPE.md`](SWAFT_MVP_SCOPE.md).

---

## 5. P2P Trust Model (Future implementation; design now)

P2P MUST NOT rely on a single shared key. Trust is established per device.

| ID | Requirement |
|----|-------------|
| **P2P-1** | Each participating device MUST have a **stable device identity** (keypair). The private key is **secure-local** and never synchronized. |
| **P2P-2** | Devices MUST join a workspace through a **signed invitation** issued by an authorized device. |
| **P2P-3** | Devices MUST be on the workspace **allowlist** before any synchronization. |
| **P2P-4** | Workspace keys MUST be **encrypted to the invitee** when shared (encrypted workspace keys), never sent in clear. |
| **P2P-5** | **Revoked** devices MUST NOT receive future synchronization updates. |
| **P2P-6** | Revocation MUST be represented in synchronized workspace metadata. |
| **P2P-7** | Network mode (`lanOnly` / `internet` / `both`) MUST be configurable per workspace and enforced. |
| **P2P-8** | User-specific data (histories, receipts, inputs, preferences, default release selection, secrets) MUST NOT be synchronized over P2P. |

### 5.1 Device Identity

- A device generates a keypair; the **public key** is shareable workspace data, the **private key** is secure-local (OS keychain).
- Device identity is used to authenticate sync messages, sign invitations, and attribute writes (`updatedByDeviceId`).

---

## 6. Invitations

| ID | Requirement |
|----|-------------|
| **INV-1** | An invitation MUST be **signed** by an authorized issuing device. |
| **INV-2** | An invitation MUST carry the **encrypted workspace key** for the invitee (encrypted to the invitee's public key). |
| **INV-3** | An invitation MUST be verifiable: a peer MUST validate the signature and issuer authorization before honoring it. |
| **INV-4** *(Recommended)* | Invitations expire; replayed/expired invitations are rejected. |
| **INV-5** | Accepting an invitation adds the device to the allowlist (synchronized). |

---

## 7. Device Revocation

| ID | Requirement |
|----|-------------|
| **REV-1** | Revocation MUST be recorded in synchronized workspace metadata. |
| **REV-2** | After revocation, the device MUST receive no further sync updates. |
| **REV-3** *(Recommended)* | Re-key the workspace on revocation so a revoked device cannot decrypt future data with a previously shared key. |
| **REV-4** | Revocation participates in last-write-wins like other synchronized metadata, but a revocation MUST NOT be silently overridden by a stale allowlist write (Recommended: revocation is monotonic / tombstone-like). |

> **Open decision (OD-S2):** Workspace re-keying strategy on revocation (full re-encryption vs. key
> rotation with forward boundaries). Recommended: rotate the workspace key and re-encrypt to remaining
> authorized devices.

---

## 8. Sandbox / Dev Execution Modes

Two execution modes govern dangerous operations (`init.md` §16).

### 8.1 Mode Semantics

| Capability | `sandbox` | `dev` |
|------------|-----------|-------|
| Outbound HTTP | Allowed only to **allowed domains**. | Allowed to allowed domains (allow-list still enforced — Recommended). |
| File writes | Only inside the **workspace/export folder**. | Advanced operations only with explicit permissions. |
| Database writes / dangerous statements | **Forbidden**. | Allowed only with explicit permissions. |
| Dangerous actions | **Blocked** (even if rendering generates them). | Allowed only with explicit permissions. |
| Action confirmation | **Required**. | **Still required** (dev does not bypass confirmation). |
| Secret handling | Secure storage required. | Secure storage **still** required. |

### 8.2 Enforcement Rules

| ID | Requirement |
|----|-------------|
| **EXE-1** | Sandbox restrictions MUST be enforced by the backend, not the UI. |
| **EXE-2** | In sandbox, file writes outside the workspace/export folder MUST be rejected. |
| **EXE-3** | In sandbox, database writes MUST be rejected. |
| **EXE-4** | In sandbox, dangerous actions MUST be blocked even if generated by rendering. |
| **EXE-5** | In sandbox, HTTP MUST respect allowed-domain restrictions. |
| **EXE-6** | Dev mode MUST still require explicit permissions for advanced operations. |
| **EXE-7** | Dev mode MUST NOT bypass action confirmation. |
| **EXE-8** | Dev mode MUST NOT expose credentials insecurely and MUST respect secure storage. |

### 8.3 File-Write Boundary

| ID | Requirement |
|----|-------------|
| **FB-1** | The sandbox file-write boundary is the workspace/export folder (configured as `settings.fileExportRoot`). |
| **FB-2** | Path resolution MUST be canonicalized server-side to prevent traversal (`..`, symlink escape). Writes resolving outside the boundary MUST be rejected. |

---

## 9. Allowed HTTP Domains

| ID | Requirement |
|----|-------------|
| **DOM-1** | Allowed HTTP domains are configured **per workspace** (synchronized restriction). |
| **DOM-2** | Outbound HTTP requests MUST be checked against the allow-list in the **backend before** the request is made. |
| **DOM-3** | Blocked requests MUST produce a clear, coded error in the UI (e.g. `DOMAIN_NOT_ALLOWED`). |
| **DOM-4** *(Recommended)* | Host matching MUST be exact/anchored (no substring matches); consider scheme and port. Re-validate on redirects (a redirect to a non-allowed host MUST be blocked). |
| **DOM-5** *(Recommended)* | Block requests to loopback/link-local/metadata addresses unless explicitly allowed (SSRF hardening). |

---

## 10. Database Safety

| ID | Requirement |
|----|-------------|
| **DB-1** | DB connections MUST default to **read-only** (`readOnlyDefault: true`). |
| **DB-2** | Dangerous statements (`DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `TRUNCATE`, `CREATE`) MUST be blocked by default. |
| **DB-3** | In sandbox mode, write operations MUST be forbidden outright. |
| **DB-4** | DB restrictions MUST be enforced in the backend. |
| **DB-5** | DB credentials MUST be stored in OS keychain / secure secret storage — never in synchronized data and never as plaintext in the `.swaft` file. |
| **DB-6** | Query history MUST be metadata-only and local-only (no result rows stored). |
| **DB-7** | Dev mode may allow dangerous statements only with explicit permissions. |
| **DB-8** *(Recommended)* | Prefer a read-only DB role/transaction in addition to statement classification; do not rely on string matching alone (especially for PostgreSQL). |

---

## 11. Action Safety

| ID | Requirement |
|----|-------------|
| **ACT-1** | Actions MUST NOT execute automatically after rendering; the pure Seebo core only **prepares** an action plan. |
| **ACT-2** | Every action execution MUST require explicit user confirmation; only confirmed action ids may run (`confirmedActions`). |
| **ACT-3** | Confirmation MUST be enforced by the backend; UI confirmation alone is insufficient. |
| **ACT-4** | `Perform all` MUST be **fail-fast**: execute in document order, stop at the first failure, do not execute remaining actions, and surface the failure. |
| **ACT-5** | Action policy MUST be **fail-closed**: an action type absent from `allowedActions`, or an environment outside allowed environments, MUST be denied. |
| **ACT-6** | An unknown action type MUST never execute (`HANDLER_NOT_FOUND`). |
| **ACT-7** | Required permissions (descriptor + handler) MUST be checked against the actor's permissions before any effect. |
| **ACT-8** | Action input MUST be sanitized (Seebo guarantees `__proto__` dropped, non-JSON/cyclic rejected, bounded). |
| **ACT-9** | Action receipts MUST be produced and visible; inputs/outputs MUST be redacted before persistence/audit. |
| **ACT-10** | Actions are code-defined in v1; any future plugin actions MUST preserve confirmation, execution-mode enforcement and receipts. |

---

## 12. Confirmation Requirements (summary)

| Operation | Confirmation required? | Enforced where |
|-----------|------------------------|----------------|
| Execute any action | **Always** | Backend (`confirmedActions`) + UI prompt. |
| `Perform all` | Yes (per confirmed set), fail-fast | Backend. |
| Delete template/folder | Yes (UI) | UI + backend delete. |
| Enter `dev` mode | Recommended | Backend/permission (OD-4). |
| Enable encryption | Acknowledge unrecoverability | UI gate at creation. |
| Revoke device (future) | Yes | Backend. |

---

## 13. Audit Requirements

| ID | Requirement |
|----|-------------|
| **AUD-1** | Security-relevant events MUST be auditable: action executions/denials, blocked HTTP domains, blocked DB statements, credential access, (future) P2P device events. |
| **AUD-2** | Audit MUST use stable event codes (aligned with Seebo `ActionEventType` where applicable). |
| **AUD-3** | Audit MUST NOT contain secret values in clear; redaction MUST be applied. |
| **AUD-4** *(Recommended)* | Audit is append-only; local-only in MVP. |
| **AUD-5** | The backend MUST NOT log secrets to console/stdout. |

---

## 14. Data Minimization & Secret Handling

| ID | Requirement |
|----|-------------|
| **MIN-1** | Secrets (API tokens, basic-auth, API keys, DB/proxy credentials, encryption material) MUST be stored in OS keychain / secure secret storage. |
| **MIN-2** | Secrets MUST NOT be synchronized. |
| **MIN-3** | Secrets MUST NOT be stored as plaintext in workspace data. |
| **MIN-4** | HTTP history MUST default to metadata-only; sensitive values MUST NOT be stored unless an explicit future opt-in enables full history. |
| **MIN-5** | DB history MUST be metadata-only (no result rows). |
| **MIN-6** | Receipts MUST be redacted (no secrets in clear). |
| **MIN-7** *(Recommended)* | Input Panel MUST NOT persist values bound to secret capabilities in clear; reference secrets instead. |

---

## 15. What Is Never Exposed to the Renderer

| ID | Requirement |
|----|-------------|
| **NX-1** | Secret values (any credential, token, key, password) MUST NEVER be returned to the renderer in clear — only references/labels/metadata. |
| **NX-2** | Device private keys MUST NEVER be exposed to the renderer. |
| **NX-3** | Workspace encryption keys/passwords MUST NEVER be returned to the renderer after entry (used in backend only). |
| **NX-4** | Raw DB credentials and proxy credentials MUST NEVER reach the renderer. |
| **NX-6** | The **account password and its Argon2id verifier** MUST NEVER reach the renderer; only session state/profile metadata is exposed. |
| **NX-5** *(Recommended)* | Error responses MUST NOT include secret values in messages/details. |

---

## 16. Recovery Limitations for Encrypted Workspaces

| ID | Requirement |
|----|-------------|
| **REC-1** | There is **no** recovery mechanism for a lost encryption password/key. |
| **REC-2** | There is **no** backdoor, master key, or escrow. |
| **REC-3** | The UI MUST warn users before enabling encryption and MUST NOT imply recoverability. |
| **REC-4** *(Recommended)* | If the user wants resilience, the only supported path is the user keeping their own copy of the password/key — Swaft does not store or transmit it. |

---

## 17. Backend Enforcement Matrix (authoritative)

| Operation | Enforced rules |
|-----------|----------------|
| Any IPC op | Channel allow-list, sender-frame check, DTO validation (§3). |
| Any non-auth op | Active-session guard (§3, §3a). |
| Sign-in / sign-up | Argon2id verifier, rate-limit/lockout, no secret to renderer (§3a). |
| HTTP request execution | Allowed domains, redirect re-validation, proxy rules, credential access (§9). |
| DB query execution | Read-only default, dangerous-statement blocking, execution mode, credentials from keychain (§10). |
| File-write action | Workspace/export-folder boundary, path canonicalization (§8.3). |
| Action execution | Confirmation, allowed actions, environment, permissions, dangerous-action blocking (§11). |
| Secret retrieval | OS keychain only; never to renderer in clear (§14, §15). |
| Workspace open (encrypted) | Decryption with user key; no backdoor (§4, §16). |
| P2P sync (future) | Device identity, allowlist, invitation signature, revocation, network mode (§5–§7). |

---

## 18. Open Decisions (Security)

| ID | Topic | Recommendation |
|----|-------|----------------|
| **OD-S1** | Encryption KDF/cipher and MVP depth. | Argon2id + AEAD; ship adapter hook + warning in MVP. |
| **OD-S2** | Workspace re-key on revocation. | Rotate key; re-encrypt to remaining authorized devices. |
| **OD-S3** | HTTP full-history opt-in (mirrors OD-1). | Keep metadata-only; gate full history explicitly. |
| **OD-S4** | DB statement guard method. | Read-only role/transaction + parser; never string-match alone. |
| **OD-S5** | SSRF hardening defaults (loopback/metadata blocking). | Block by default unless explicitly allowed. |
| **OD-S6** | Execution-mode change permission. | Require permission/confirmation to enter `dev`. |
| ~~**OD-S7**~~ | Whether the account password also wraps workspace keys. | **Resolved: separate** — account auth and workspace encryption are independent (separate passwords/keys). |
| **OD-S8** | Session inactivity lock default. | Lock after inactivity timeout; require re-auth to unlock (Recommended on). |
