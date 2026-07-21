# Swaft — Data Model

> ⚠️ **Partially superseded (2026-07).** `Workspace.storageMode` is now `'local' | 'git'`; the
> `p2p`/`server` modes and the **P2P trust entities** (Device Identity, Invitation, Allowlist,
> Revocation, §16) were never implemented and are removed. The per-entity **sync-metadata**
> (`updatedByDeviceId`, `revision`, `deletedAt`, …, §3) was designed for the unbuilt P2P
> last-write-wins engine; in **Git** mode it is not versioned (Git provides history and merge
> instead) — see [`../../git.md`](../../git.md).

> **Status:** Formal domain data model for implementation planning.
> **Source of truth:** [`init.md`](init.md). Fields beyond `init.md` are marked **Recommended**.
> **Audience:** Backend engineers, frontend engineers (DTOs), security reviewers.
> **Companions:** [`SWAFT_STORAGE_SYNC_MODEL.md`](SWAFT_STORAGE_SYNC_MODEL.md) (sync mechanics),
> [`SWAFT_SECURITY_MODEL.md`](SWAFT_SECURITY_MODEL.md) (sensitive data handling),
> [`../../git.md`](../../git.md) (Git storage mode).

---

## 1. Conventions

### 1.1 Data Classification Legend

Every entity and field is classified as exactly one of:

| Tag | Classification | Meaning |
|-----|----------------|---------|
| 🟢 **SYNC** | Synchronized | Shared workspace data; included in P2P synchronization. |
| 🔵 **LOCAL** | Local-only | Stored locally; never synchronized; personal to the device. |
| 🟠 **SECURE** | Secure-local | Stored/referenced via OS keychain / secure secret storage; never synchronized; never returned to the frontend in clear. |

A fourth orthogonal property:

| Tag | Meaning |
|-----|---------|
| 🔒 **ENCRYPTED-AT-REST** | When the workspace uses optional whole-file encryption, this data is inside the encrypted `.swaft` file. (Applies to all on-file data; secure-local secrets are protected separately by the OS keychain.) |

### 1.2 Field Conventions

- **`id`**: Recommended UUID/ULID string, unique within the workspace.
- **Timestamps**: ISO-8601 UTC strings (Recommended) or epoch ms; consistent project-wide.
- **Sync metadata**: every 🟢 SYNC entity carries the metadata defined in §3.
- **Soft delete**: 🟢 SYNC entities use `deletedAt` (tombstone) rather than hard delete, to support last-write-wins (see [`SWAFT_STORAGE_SYNC_MODEL.md`](SWAFT_STORAGE_SYNC_MODEL.md)).

### 1.3 Entity Inventory (from `init.md` §18.1)

| Entity | Classification | Section |
|--------|----------------|---------|
| Account (local) | 🔵 LOCAL (profile) / 🟠 SECURE (verifier) | §20 |
| Session | 🔵 LOCAL (in-memory) | §20 |
| Workspace | 🟢 SYNC (metadata) | §4 |
| Project | 🟢 SYNC | §5 |
| Folder | 🟢 SYNC | §5 |
| Tag | 🟢 SYNC | §5 |
| Restriction | 🟢 SYNC | §6 |
| Workspace Settings | 🟢 SYNC | §6 |
| Template | 🟢 SYNC | §7 |
| Template Release | 🟢 SYNC | §8 |
| Changelog Entry | 🟢 SYNC | §9 |
| User Preference | 🔵 LOCAL | §10 |
| Default Release Selection | 🔵 LOCAL | §10 |
| Last Input Value (Input State) | 🔵 LOCAL | §11 |
| API Call History Record | 🔵 LOCAL | §12 |
| Database Query History Record | 🔵 LOCAL | §13 |
| Local Action Receipt | 🔵 LOCAL | §14 |
| Secret Reference | 🟠 SECURE | §15 |
| Device Identity | 🟢 SYNC (public) / 🟠 SECURE (private key) | §16 |
| P2P Invitation | 🟢 SYNC | §16 |
| P2P Allowlist Entry (Authorized Device) | 🟢 SYNC | §16 |
| P2P Revocation Entry | 🟢 SYNC | §16 |
| Audit Event | 🔵 LOCAL (MVP) | §17 |

---

## 2. Entity-Relationship Overview

```
                         ┌───────────────┐
                         │   Workspace   │  (storageMode immutable)
                         └───────┬───────┘
        ┌─────────────┬──────────┼───────────┬──────────────┬─────────────┐
        ▼             ▼          ▼           ▼              ▼             ▼
   ┌─────────┐  ┌─────────┐ ┌────────┐  ┌───────────┐  ┌──────────┐ ┌──────────┐
   │ Project │  │ Folder  │ │  Tag   │  │Restriction│  │ Settings │ │Changelog │
   └────┬────┘  └────┬────┘ └───┬────┘  └───────────┘  └──────────┘ └──────────┘
        │  filters   │ groups   │ labels
        └─────┬──────┴──────────┘
              ▼
        ┌──────────┐ 1     * ┌──────────────────┐
        │ Template │─────────│ Template Release │ (immutable, linear)
        └────┬─────┘         └──────────────────┘
   ┌─────────┼───────────────────────────────────────────────┐
   │ LOCAL-ONLY, per template, per device                     │
   ▼         ▼                  ▼                   ▼          ▼
┌────────┐┌──────────────┐┌───────────────┐┌───────────────┐┌─────────────────┐
│Default ││ Last Input   ││ API Call      ││ Action Receipt││ (DB history is   │
│Release ││ Values       ││ History       ││               ││  per connection, │
│Select. ││              ││               ││               ││  not per template)│
└────────┘└──────────────┘└───────────────┘└───────────────┘└─────────────────┘

SECURE (OS keychain): Secret References ← used by HTTP auth, DB credentials, proxy, encryption
SYNC (P2P, future):   Device Identity · Invitation · Allowlist · Revocation
```

| Relationship | Cardinality | Notes |
|--------------|-------------|-------|
| Workspace → Template | 1 → * | All templates belong to one workspace. |
| Workspace → Project / Folder / Tag / Restriction | 1 → * | Organizational entities. |
| Template → Template Release | 1 → * | Linear, immutable releases. |
| Template → Project | * → 0..1 | A template may belong to one project. |
| Template → Folder | * → 0..1 | A template may belong to one folder (folder = HTTP collection for API). |
| Template ↔ Tag | * ↔ * | Many-to-many. |
| Template → Last Input Values | 1 → 0..1 | Local-only, per device. |
| Template → Default Release Selection | 1 → 0..1 | Local-only, per device. |
| Template(api) → API Call History | 1 → * | Local-only. |
| Template(document) → Action Receipts | 1 → * | Local-only. |
| DB Connection → DB Query History | 1 → * | Local-only, metadata only. |

---

## 3. Sync Metadata (applies to all 🟢 SYNC entities)

Every synchronized entity carries the following metadata to support deterministic
**last-write-wins** resolution. (Full semantics in [`SWAFT_STORAGE_SYNC_MODEL.md`](SWAFT_STORAGE_SYNC_MODEL.md).)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `updatedAt` | timestamp | Yes | Last modification time; primary LWW comparison key. |
| `updatedByDeviceId` | string | Yes | Device identity that produced the last write; LWW tiebreaker and provenance. |
| `revision` | integer | Yes | Monotonic per-entity revision counter; increments on each write. |
| `deletedAt` | timestamp \| null | Yes | Tombstone marker; non-null means logically deleted. |
| `logicalClock` | integer / vector | Recommended (optional) | Optional logical clock (e.g. Lamport) for ordering when wall-clock skew is a concern. |
| `createdAt` | timestamp | Yes | Creation time. |

> 🔵 LOCAL and 🟠 SECURE entities do **not** require sync metadata (they never synchronize), but
> may keep `createdAt`/`updatedAt` for local housekeeping.

---

## 4. Workspace

🟢 **SYNC** (metadata) · 🔒 ENCRYPTED-AT-REST (file contents)

| Field | Type | Required | Class | Description |
|-------|------|----------|-------|-------------|
| `id` | string | Yes | 🟢 | Unique workspace identifier. |
| `name` | string | Yes | 🟢 | Display name. |
| `storageMode` | enum `local` \| `p2p` \| `server` | Yes | 🟢 | **Immutable** after creation. |
| `executionMode` | enum `sandbox` \| `dev` | Yes | 🟢 | Current execution mode (mutable; storage mode is the immutable one). |
| `encryption` | object \| null | Yes | 🟢 (metadata) | Encryption descriptor (see §4.1); must not expose secrets. |
| `settingsId` | string | Yes | 🟢 | Reference to Workspace Settings (§6). |
| `p2pConfig` | object \| null | Conditional | 🟢 | P2P network config (§16) when `storageMode = p2p`. |
| `schemaVersion` | integer | Yes | 🟢 | `.swaft` schema/migration version (see [storage doc](SWAFT_STORAGE_SYNC_MODEL.md)). |
| `createdAt` | timestamp | Yes | 🟢 | Creation time. |
| `updatedAt` | timestamp | Yes | 🟢 | Last update time. |

### 4.1 Encryption Descriptor (`workspace.encryption`)

🟢 SYNC (metadata only) — **must not** contain key material.

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether whole-file encryption is active. |
| `kdf` | string | Key-derivation function id (Recommended: `argon2id`). |
| `kdfParams` | object | KDF parameters (salt is fine to store; **never** the derived key or password). |
| `cipher` | string | AEAD cipher id (Recommended: `xchacha20-poly1305` or `aes-256-gcm`). |
| `recovery` | const `none` | **No recovery**; loss of password/key makes the workspace unrecoverable. |

> The actual key/password is 🟠 SECURE (never in the file, never synchronized; see §15 and the
> [security model](SWAFT_SECURITY_MODEL.md)).

---

## 5. Project, Folder, Tag

All 🟢 **SYNC** · 🔒 ENCRYPTED-AT-REST · carry §3 sync metadata.

### 5.1 Project

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique id. |
| `name` | string | Yes | Display name. |
| `description` | string | No | Optional description. |
| `parentProjectId` | string \| null | Recommended | Optional nesting. |
| `order` | integer | Recommended | Sort order in the tree. |

> A Project is a **macro-folder that filters the Working Tree**; it does not own templates exclusively.

### 5.2 Folder

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique id. |
| `name` | string | Yes | Display name. |
| `parentFolderId` | string \| null | Recommended | Folder nesting. |
| `projectId` | string \| null | Recommended | Optional owning project. |
| `kind` | enum `general` \| `httpCollection` | Recommended | A folder containing API templates acts as an **HTTP collection**. |
| `order` | integer | Recommended | Sort order. |

### 5.3 Tag

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique id. |
| `name` | string | Yes | Tag label. |
| `color` | string | No | Optional display color. |

---

## 6. Workspace Settings and Restrictions

🟢 **SYNC** · 🔒 ENCRYPTED-AT-REST · carry §3 sync metadata.

### 6.1 Workspace Settings

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Settings id (referenced by `workspace.settingsId`). |
| `executionMode` | enum `sandbox` \| `dev` | Yes | Mirror/authoritative execution mode (Recommended: single source on workspace; avoid duplication). |
| `allowedHttpDomains` | string[] | Yes | Outbound HTTP allow-list (hosts/patterns). |
| `allowedActions` | string[] | Yes | Action types permitted to execute. |
| `allowedCapabilities` | string[] | Yes | Seebo capabilities permitted to resolve. |
| `proxy` | object \| null | No | Proxy configuration (non-secret parts; credentials are 🟠 SECURE references). |
| `locale` | string | No | Workspace locale (BCP-47) passed to Seebo. |
| `fileExportRoot` | string \| null | Recommended | Sandbox file-write boundary (workspace/export folder). |

> **Recommended:** keep `executionMode`, `allowed*` lists and `proxy` consolidated here, with the
> Workspace entity holding only the immutable `storageMode` plus a settings reference. This avoids
> the duplication implied by `init.md` listing `executionMode` on both Workspace and Settings.

### 6.2 Restriction

A Restriction is a typed, enforceable constraint. (Settings §6.1 may be modeled as denormalized
restriction values, or restrictions as discrete rows — **Recommended:** discrete typed rows for
audit/changelog granularity.)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique id. |
| `type` | enum `allowedDomain` \| `allowedAction` \| `allowedCapability` \| `fileBoundary` \| `dbPolicy` | Yes | Restriction kind. |
| `value` | string / object | Yes | Constraint payload (e.g. a domain pattern). |
| `enabled` | boolean | Yes | Whether active. |

### 6.3 Proxy Configuration (`settings.proxy`)

| Field | Type | Class | Description |
|-------|------|-------|-------------|
| `url` | string | 🟢 | Proxy URL (scheme/host/port). |
| `noProxy` | string[] | 🟢 | Bypass list. |
| `credentialRef` | string \| null | 🟢 → 🟠 | Reference to proxy credentials stored in OS keychain (value is 🟠 SECURE). |

---

## 7. Template

🟢 **SYNC** · 🔒 ENCRYPTED-AT-REST · carry §3 sync metadata.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique id. |
| `type` | enum `document` \| `api` \| `render` | Yes | Template type → primary view. |
| `subtype` | string | Yes | Subtype valid for `type` (see §7.1). |
| `name` | string | Yes | Display name. |
| `description` | string | No | Optional description. |
| `projectId` | string \| null | No | Owning project (filtering). |
| `folderId` | string \| null | No | Owning folder (HTTP collection for API). |
| `tagIds` | string[] | No | Associated tags. |
| `currentDraft` | object | Yes | Editable draft content/model (shape depends on `type`; see §7.2). |
| `latestReleaseId` | string \| null | Recommended | Convenience pointer to latest release. |
| `order` | integer | Recommended | Sort order within folder/project. |

### 7.1 Valid Subtypes by Type

| `type` | Valid `subtype` values |
|--------|------------------------|
| `document` | `html`, `markdown`, `eml`, `csv`, `json`, `xml`, `yaml`, `txt`, `javascript`, `python`, `sql`, `plain` |
| `api` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` |
| `render` | `html`, `markdown`, `eml`, `mermaid`, `swagger`, `openapi`, `echarts`, `json-preview` |

### 7.2 Draft Content Shapes (`currentDraft`)

| `type` | Draft shape (Recommended) |
|--------|---------------------------|
| `document` | `{ source: string }` — Seebo template source (subtype = output format). |
| `render` | `{ source: string }` — content rendered by the subtype renderer. |
| `api` | Structured HTTP request object (§7.3) — **never** a cURL string. |

> **Input declarations & widgets.** A template's inputs are Seebo `require({ id, type, capability, … })`
> declarations inside its `source`. The **`capability`** names a Swaft **input widget** (textbox,
> listbox, boolean, multi-option, JSON input, …) — see [`SWAFT_UI_SPEC.md`](SWAFT_UI_SPEC.md) §9.1.1
> and [`SWAFT_ARCHITECTURE.md`](SWAFT_ARCHITECTURE.md) §8.2.1. The chosen capability is therefore part
> of the template definition (🟢 SYNC) and is captured verbatim in releases (§8). The **values** the
> user enters for those inputs are stored separately as **Input State** (🔵 LOCAL, §11).

### 7.3 API Template Canonical Request Model (`init.md` §8.4.2)

🟢 SYNC. The canonical model is a **structured request object**; secrets are referenced, not inlined.

| Field | Type | Description |
|-------|------|-------------|
| `method` | enum HTTP method | Matches the template `subtype`. |
| `url` | string | Request URL (host validated against allowed domains at execution). |
| `headers` | object<string,string> | Request headers. |
| `query` | object<string,string> | Query parameters. |
| `body` | any (JSON-like) \| null | Request body. |
| `auth` | object | Auth descriptor (§7.4). |

### 7.4 API Auth Descriptor (`request.auth`)

| Field | Type | Class | Description |
|-------|------|-------|-------------|
| `type` | enum `none` \| `bearer` \| `basic` \| `apiKey` | 🟢 | Auth method (MVP set). |
| `secretRef` | string \| null | 🟢 → 🟠 | Reference to the credential in OS keychain. **The token/password/key value itself is 🟠 SECURE and never stored in the request.** |
| `apiKeyName` | string \| null | 🟢 | For `apiKey`: header/query name (non-secret). |
| `apiKeyIn` | enum `header` \| `query` \| null | 🟢 | For `apiKey`: placement. |
| `basicUsername` | string \| null | 🟢 (Recommended) | For `basic`: username may be non-secret metadata; password is 🟠 SECURE via `secretRef`. |

---

## 8. Template Release

🟢 **SYNC** · 🔒 ENCRYPTED-AT-REST · carry §3 sync metadata · **IMMUTABLE** after creation.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique release id. |
| `templateId` | string | Yes | Parent template. |
| `version` | string | Yes | Semantic version label (e.g. `v1.0.0`), **linear** per template. |
| `snapshot` | object | Yes | Immutable, full snapshot of the template at release time (type, subtype, draft content). |
| `notes` | string | No | Release notes. |
| `createdAt` | timestamp | Yes | Creation time. |
| `createdBy` | string \| null | No | Creator identifier/device, if available. |

| ID | Rule |
|----|------|
| REL-D1 | A release is immutable; no field may change after creation (only a tombstone via `deletedAt` is permitted, and even that is **Open decision**; Recommended: releases are not deletable). |
| REL-D2 | `version` is unique per `templateId` and linearly ordered. |
| REL-D3 | Releases are common to all template types. |

---

## 9. Changelog Entry

🟢 **SYNC** · 🔒 ENCRYPTED-AT-REST · carry §3 sync metadata.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique id. |
| `subjectType` | enum `template` \| `release` \| `settings` \| `project` \| `folder` \| `tag` \| `restriction` | Yes | What changed. |
| `subjectId` | string | Yes | The changed entity id. |
| `changeType` | enum `created` \| `updated` \| `deleted` \| `released` | Yes | Nature of change. |
| `summary` | string | Yes | Human-readable summary. |
| `authorDeviceId` | string | Yes | Device that authored the change. |
| `createdAt` | timestamp | Yes | When recorded. |

> Changelog is common to all template types and supports traceability for templates, releases,
> settings, projects/folders/tags and restrictions (`init.md` §20.2). It participates in P2P sync.

---

## 10. User Preference and Default Release Selection

🔵 **LOCAL** · never synchronized.

### 10.1 User Preference

A key/value store of local-only UI preferences. Well-known keys (Recommended):

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique id (or singleton per device/profile). |
| `key` | string | Preference key. |
| `value` | any | Preference value. |

**Well-known preference keys** (local-only; never synchronized):

| Key | Type / values | Description |
|-----|---------------|-------------|
| `theme` | `light` \| `dark` \| `system` | UI theme (Recommended default `system`). |
| `primaryColor` | enum (one of 4–5 curated colors) | Primary/accent color (exact palette is Open decision). |
| `language` | `it` \| `en` (extensible) | UI language (initial locales Italian, English). |
| `layout` / `density` | object | Optional layout/UI options (Recommended). |

> These map to the Preferences surface in [`SWAFT_UI_SPEC.md`](SWAFT_UI_SPEC.md) §23. The UI
> `language` is distinct from the workspace Seebo `locale` (§6.1), which governs value formatting
> during rendering.

### 10.2 Default Release Selection

| Field | Type | Description |
|-------|------|-------------|
| `templateId` | string | Template the selection applies to. |
| `releaseId` | string \| null | Selected release; `null` ⇒ fallback (Recommended: latest release, else current draft). |
| `updatedAt` | timestamp | Last change. |

| ID | Rule |
|----|------|
| SEL-1 | Release selection is **personal, local-only, not synchronized**. |
| SEL-2 | Set via the Working Tree three-dot menu. |

---

## 11. Input State (Last Input Values)

🔵 **LOCAL** · per template · per device · never synchronized.

| Field | Type | Description |
|-------|------|-------------|
| `templateId` | string | Owning document template. |
| `values` | object<string, any> | Map of Seebo requirement `id` → last entered value. |
| `updatedAt` | timestamp | Last save. |

| ID | Rule |
|----|------|
| INP-1 | Every **document** template persists the last input values used by the user. |
| INP-2 | Last input values pre-fill the Input Panel on reopen. |
| INP-3 | Local-only; never synchronized. |
| INP-4 *(Recommended)* | Do not persist values for requirements bound to secret capabilities; reference secrets instead. |

---

## 12. API Call History Record

🔵 **LOCAL** · per API template · never synchronized. **Recommended: metadata-only** (Open decision OD-1).

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique record id. |
| `templateId` | string | Owning API template. |
| `timestamp` | timestamp | When the call was made. |
| `method` | string | HTTP method. |
| `urlHost` | string | URL host (Recommended: host only in metadata-only mode). |
| `statusCode` | integer \| null | Response status, or null on transport error. |
| `durationMs` | integer | Round-trip duration. |
| `errorCategory` | string \| null | Error classification, if failed. |
| `fullRequest` | object \| null | **Only if** full-history mode is enabled (future opt-in); otherwise absent. |
| `fullResponse` | object \| null | **Only if** full-history mode is enabled (future opt-in); otherwise absent. |

| ID | Rule |
|----|------|
| HIST-1 | History records are individually **deletable**. |
| HIST-2 | History is **clearable per template**. |
| HIST-3 | Local-only; never synchronized. |
| HIST-4 | Default is metadata-only; sensitive values are not stored unless an explicit future decision enables configurable full history (OD-1). |

---

## 13. Database Query History Record

🔵 **LOCAL** · per connection · **metadata-only** · never synchronized.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique record id. |
| `connectionId` | string | DB connection reference (non-secret). |
| `engine` | enum `sqlite` \| `postgresql` | DB engine. |
| `timestamp` | timestamp | When executed. |
| `statementKind` | enum `read` \| `blocked` | Classification (writes are blocked, not executed, unless dev-permitted). |
| `statementHash` | string | Hash/fingerprint of the statement (Recommended; not the raw sensitive text — Open decision whether raw text is stored). |
| `durationMs` | integer | Execution duration. |
| `rowCount` | integer \| null | Rows returned (count only). |
| `outcome` | enum `ok` \| `error` \| `blocked` | Result. |

| ID | Rule |
|----|------|
| DBH-1 | Metadata only — **result rows are never stored** in history. |
| DBH-2 | Local-only; never synchronized. |
| DBH-3 *(Open decision)* | Whether the raw SQL text is stored or only a hash. Recommended: store statement text locally but classify/guard; never sync. |

---

## 14. Local Action Receipt

🔵 **LOCAL** · never synchronized · visible in UI.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique receipt id. |
| `templateId` | string | Document template that produced the action. |
| `actionId` | string | Action id from the prepared plan. |
| `actionType` | string | Handler type (e.g. `jira.createIssue`). |
| `status` | enum (Seebo `ActionStatus`: `succeeded` \| `failed` \| `skipped` \| `compensated` \| `compensationFailed` \| …) | Outcome. |
| `environment` | string | Target environment (`test`/`prod`/…). |
| `idempotencyKey` | string | Stable key from Seebo (`{id,type,environment,input}` hash). |
| `externalId` | string \| null | External system id, if any. |
| `error` | object \| null | Structured `ActionError` on failure. |
| `redactedInput` | object \| null | Inputs after redaction (no secrets in clear). |
| `timestamp` | timestamp | When executed. |

| ID | Rule |
|----|------|
| RCPT-1 | Receipts are local-only and never synchronized. |
| RCPT-2 | Receipts must be visible in the UI. |
| RCPT-3 | Inputs/outputs are redacted via Seebo's `redact` hook before persistence (no secrets stored in clear). |

---

## 15. Secret Reference

🟠 **SECURE** · stored in OS keychain / secure secret storage · never synchronized · never returned to the frontend in clear.

| Field | Type | Class | Description |
|-------|------|-------|-------------|
| `ref` | string | 🟢 (reference) | Opaque reference id used in `.swaft` data (e.g. `request.auth.secretRef`). |
| `label` | string | 🟢 | Human-readable label for UI (non-secret). |
| `kind` | enum `httpBearer` \| `httpBasic` \| `apiKey` \| `dbCredential` \| `proxyCredential` \| `workspaceKey` | 🟢 | What the secret is for. |
| `value` | string / object | 🟠 | **The actual secret.** Stored only in the OS keychain; never in `.swaft`; never synchronized; never sent to the frontend. |

| ID | Rule |
|----|------|
| SEC-1 | The `.swaft` file and synchronized data store only the **reference** (`ref`) and non-secret `label`/`kind`. |
| SEC-2 | The secret `value` lives exclusively in OS keychain / secure secret storage. |
| SEC-3 | Secrets are never synchronized and never exposed to the frontend in clear. |
| SEC-4 | Secret kinds include: API tokens, basic-auth credentials, API keys, DB credentials, proxy credentials, and workspace encryption key/password material. |

---

## 16. P2P Trust Entities (Future implementation; model reserved now)

All carry §3 sync metadata where synchronized. Detailed protocol in [`SWAFT_SECURITY_MODEL.md`](SWAFT_SECURITY_MODEL.md).

### 16.1 Device Identity

| Field | Type | Class | Description |
|-------|------|-------|-------------|
| `deviceId` | string | 🟢 | Stable device identity id. |
| `publicKey` | string | 🟢 | Device public key (shared). |
| `privateKey` | — | 🟠 | **Never** in `.swaft`/sync; held in OS keychain on the owning device. |
| `displayName` | string | 🟢 | Human-readable device name. |
| `createdAt` | timestamp | 🟢 | When the identity was created. |

### 16.2 P2P Invitation

| Field | Type | Class | Description |
|-------|------|-------|-------------|
| `id` | string | 🟢 | Invitation id. |
| `workspaceId` | string | 🟢 | Target workspace. |
| `issuerDeviceId` | string | 🟢 | Inviting device. |
| `inviteePublicKey` | string | 🟢 | Invitee's public key. |
| `signature` | string | 🟢 | **Signed** by the issuer (signed invitation). |
| `encryptedWorkspaceKey` | string | 🟢 | Workspace key encrypted to the invitee (encrypted workspace keys). |
| `expiresAt` | timestamp | 🟢 | Expiry. |
| `status` | enum `pending` \| `accepted` \| `revoked` \| `expired` | 🟢 | Lifecycle. |

### 16.3 Authorized Device (Allowlist Entry)

| Field | Type | Class | Description |
|-------|------|-------|-------------|
| `deviceId` | string | 🟢 | Authorized device. |
| `publicKey` | string | 🟢 | Its public key. |
| `addedByDeviceId` | string | 🟢 | Who authorized it. |
| `addedAt` | timestamp | 🟢 | When authorized. |

### 16.4 Revocation Entry

| Field | Type | Class | Description |
|-------|------|-------|-------------|
| `deviceId` | string | 🟢 | Revoked device. |
| `revokedByDeviceId` | string | 🟢 | Who revoked it. |
| `revokedAt` | timestamp | 🟢 | When revoked. |
| `reason` | string \| null | 🟢 | Optional reason. |

| ID | Rule |
|----|------|
| P2P-1 | Revoked devices must no longer receive future synchronization updates. |
| P2P-2 | Revocation is represented in synchronized workspace metadata. |
| P2P-3 | Device private keys are 🟠 SECURE and never synchronized. |

---

## 17. Audit Event

🔵 **LOCAL** (MVP) · append-only. (Synchronizable design deferred — see [architecture](SWAFT_ARCHITECTURE.md) OD-A6.)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique id. |
| `timestamp` | timestamp | When the event occurred. |
| `category` | enum `action` \| `http` \| `database` \| `secret` \| `p2p` \| `workspace` | Event domain. |
| `eventType` | string | Stable event code (e.g. `action.policy_denied`, `http.domain_blocked`, `db.statement_blocked`). |
| `outcome` | enum `allowed` \| `denied` \| `error` | Decision/result. |
| `subjectId` | string \| null | Related entity id. |
| `details` | object | Non-secret structured details (redacted). |

| ID | Rule |
|----|------|
| AUD-1 | Audit events never store secret values (redaction applied). |
| AUD-2 | Append-only (Recommended); local-only in MVP. |

---

## 18. Data-Classification Summary Matrix

| Data | 🟢 SYNC | 🔵 LOCAL | 🟠 SECURE | Sensitive | Encrypted-at-rest (if file encryption on) |
|------|:------:|:-------:|:--------:|:---------:|:------------------------------------------:|
| Workspace metadata | ✅ | | | | ✅ |
| Project / Folder / Tag | ✅ | | | | ✅ |
| Restrictions / Settings | ✅ | | | | ✅ |
| Template (incl. API request model) | ✅ | | | partial¹ | ✅ |
| Template Release | ✅ | | | | ✅ |
| Changelog | ✅ | | | | ✅ |
| User Preference | | ✅ | | | ✅ |
| Default Release Selection | | ✅ | | | ✅ |
| Last Input Values | | ✅ | | possibly² | ✅ |
| API Call History | | ✅ | | possibly² | ✅ |
| DB Query History | | ✅ | | possibly² | ✅ |
| Action Receipts | | ✅ | | possibly² | ✅ |
| Account profile | | ✅ | | | ✅ |
| Account password verifier | | | ✅ | ✅ | n/a (OS keychain) |
| Session | | ✅ (in-memory) | | | n/a |
| Secret values | | | ✅ | ✅ | n/a (OS keychain) |
| Device private key | | | ✅ | ✅ | n/a (OS keychain) |
| Device public key / Invitation / Allowlist / Revocation | ✅ | | | | ✅ |
| Audit events | | ✅ | | redacted | ✅ |

¹ API templates reference secrets via `secretRef`; the request model itself is non-secret.
² These local stores may incidentally contain sensitive data; default policies (metadata-only history, redacted receipts, no secret input persistence) minimize this.

---

## 19. Open Decisions (Data Model)

| ID | Topic | Recommendation |
|----|-------|----------------|
| **OD-D1** | HTTP history full vs metadata-only (mirrors product OD-1). | Metadata-only default; full behind future opt-in. |
| **OD-D2** | DB history: raw SQL text vs hash. | Store text locally (never sync) but guard; hash for fingerprinting. |
| **OD-D3** | Release deletability / tombstones. | Releases are not deletable (immutability favored). |
| **OD-D4** | `executionMode` duplication (Workspace vs Settings). | Single source on Workspace; Settings references it. |
| **OD-D5** | `logicalClock` form (Lamport vs vector). | Start with `updatedAt` + `revision` + `updatedByDeviceId`; add Lamport clock only if skew issues appear. |
| **OD-D6** | Whether `basicUsername` is non-secret metadata. | Treat username as metadata; password always secure-local. |
| **OD-D7** | Account scope: single local account vs multiple. | Single local account/profile per device in MVP. |
| **OD-D8** | Where the account profile is stored (per-device file vs OS). | App-level local store (outside any single `.swaft`); verifier in keychain. |

---

## 20. Account & Session (Authentication)

Swaft includes **sign-up / sign-in** (extends `init.md`). The MVP uses a **local account** that
gates app access and owns the local profile. (Future SSO/OIDC/MFA and server accounts —
[`NEXT_STEPS.md`](NEXT_STEPS.md).)

### 20.1 Account (local)

🔵 **LOCAL** profile · 🟠 **SECURE** verifier · app-level (not inside a single workspace) · never synchronized.

| Field | Type | Class | Description |
|-------|------|-------|-------------|
| `id` | string | 🔵 | Unique account id. |
| `email` / `username` | string | 🔵 | Login identifier (non-secret). |
| `displayName` | string | 🔵 | Display name. |
| `passwordVerifier` | string | 🟠 | **Argon2id** hash of the password (salted). Stored in OS keychain / `safeStorage`; never in `.swaft`; never synchronized; never sent to the renderer. |
| `kdfParams` | object | 🟠/🔵 | Argon2id parameters + salt (salt may be stored with the verifier; never the password). |
| `createdAt` | timestamp | 🔵 | Creation time. |
| `lastLoginAt` | timestamp \| null | 🔵 | Last successful sign-in. |
| `failedAttempts` | integer | 🔵 | For rate-limit/lockout (Recommended). |
| `lockedUntil` | timestamp \| null | 🔵 | Lockout expiry (Recommended). |

| ID | Rule |
|----|------|
| ACC-1 | The password is never stored; only its Argon2id verifier (🟠 SECURE). |
| ACC-2 | Account data is local-only; never synchronized. |
| ACC-3 | The verifier/KDF material never reaches the renderer. |
| ACC-4 | Account auth is distinct from workspace encryption (a separate password/key — see security OD-S7). |

### 20.2 Session

🔵 **LOCAL** · **in-memory** (Recommended; not persisted to disk) · per app run.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Session id (main-process held). |
| `accountId` | string | The signed-in account. |
| `createdAt` | timestamp | Sign-in time. |
| `lastActivityAt` | timestamp | For inactivity lock (Recommended). |
| `state` | enum `active` \| `locked` \| `ended` | Lifecycle. |

| ID | Rule |
|----|------|
| SESS-1 | A valid session is required by the IPC guard for all non-auth ops. |
| SESS-2 | The session is invalidated on sign-out, app exit, and (Recommended) inactivity timeout. |
| SESS-3 | The renderer sees only session **state** (e.g. signed-in/locked) and profile metadata — never credentials. |
| SESS-4 *(Recommended)* | Session is in-memory only; no long-lived persisted token in MVP (re-auth on relaunch). |
