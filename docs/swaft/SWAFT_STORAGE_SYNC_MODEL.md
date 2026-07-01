# Swaft — Storage & Synchronization Model

> **Status:** Implementation-oriented storage and synchronization specification.
> **Source of truth:** [`init.md`](init.md). Elaborations are marked **Recommended**; undecided
> items **Open decision**.
> **Audience:** Backend engineers, security reviewers.
> **Companions:** [`SWAFT_DATA_MODEL.md`](SWAFT_DATA_MODEL.md), [`SWAFT_SECURITY_MODEL.md`](SWAFT_SECURITY_MODEL.md),
> [`SWAFT_ARCHITECTURE.md`](SWAFT_ARCHITECTURE.md).

---

## 1. Storage Modes

| Mode | Description | Status |
|------|-------------|--------|
| `local` | Workspace stored locally as a single SQLite-based `.swaft` file. | **MVP** |
| `p2p` | Real-time synchronization with allowed peer devices (LAN / internet / both). | **Future** (model reserved & architecture-ready) |
| `server` | Server-backed storage/synchronization. | **Reserved / future** (details undefined) |

| ID | Rule |
|----|------|
| **SM-1** | Storage mode is stored as workspace metadata and is **immutable** after creation. |
| **SM-2** | The UI MUST NOT expose a normal "change storage mode" operation. |
| **SM-3** | Migration between modes, if ever supported, MUST be an explicit export/import or clone — never an in-place mutation. |
| **SM-4** | Server mode MUST NOT invalidate the local/P2P data-classification model; the data model MUST reserve `server` without requiring server behavior in MVP. |

---

## 2. Local `.swaft` Storage

### 2.1 File Model

| ID | Requirement |
|----|-------------|
| **LF-1** | In local mode, a workspace is a **single file** with extension `.swaft`. |
| **LF-2** | The `.swaft` file is **SQLite-based**. |
| **LF-3** | A workspace MUST be portable as one file. |
| **LF-4** | The SQLite schema MUST support all persisted workspace entities. |
| **LF-5** | The application treats the `.swaft` file as the **authoritative** local workspace store. |

### 2.2 SQLite Layout (Recommended)

The `.swaft` SQLite database contains tables for each persisted entity (see [`SWAFT_DATA_MODEL.md`](SWAFT_DATA_MODEL.md)). Recommended grouping:

| Group | Tables (Recommended) |
|-------|----------------------|
| Workspace metadata | `workspace`, `settings`, `restriction` |
| Organization (🟢 SYNC) | `project`, `folder`, `tag`, `template_tag` |
| Content (🟢 SYNC) | `template`, `template_release`, `changelog` |
| Local-only (🔵 LOCAL) | `pref`, `release_selection`, `input_state`, `api_history`, `db_history`, `action_receipt`, `audit_event` |
| P2P (🟢 SYNC, future) | `device`, `invitation`, `allowlist`, `revocation` |
| Sync bookkeeping (future) | `sync_state` / per-entity sync metadata columns |

| ID | Recommendation |
|----|----------------|
| **SQ-1** | Synchronized tables carry the sync-metadata columns of §5 (`updatedAt`, `updatedByDeviceId`, `revision`, `deletedAt`, optional `logicalClock`, `createdAt`). |
| **SQ-2** | Local-only and secure-local data are stored in separate tables (or clearly separated) so the sync layer can never read them. |
| **SQ-3** | Secrets are **not** stored in `.swaft`; only secret **references** are (§ data model SEC-1). |
| **SQ-4** | Use WAL journaling and a single writer per workspace for consistency/performance. |

### 2.3 Local-Only Data on File

Local-only data is stored **in the same `.swaft` file** (so it is encrypted-at-rest with the file when encryption is on) but is **never** emitted to the sync layer. Local-only data includes: last input values, API call history, DB query history, user preferences, default release selection per template, local action receipts (and audit events, Recommended).

> **Note:** "Local-only" means *not synchronized*; it does not mean *not in the file*. It lives in
> the file (benefiting from optional encryption) but is excluded from P2P/server sync.

### 2.4 App-Level Storage (outside any `.swaft`)

Some data is **app-level**, not tied to a single workspace, and lives outside any `.swaft` file:

| Data | Location | Class |
|------|----------|-------|
| **Account profile** (email, displayName, lockout counters) | App-level local store (Recommended: a small SQLite/JSON store in the app user-data dir) | 🔵 LOCAL |
| **Account password verifier** (Argon2id) | OS keychain / `safeStorage` | 🟠 SECURE |
| **Session** | In-memory only (main process); not persisted (Recommended) | 🔵 LOCAL |
| **User preferences** (theme, primary color, language, layout) | App-level local store (so they apply before/independent of any workspace) | 🔵 LOCAL |
| Recent-workspaces list | App-level local store | 🔵 LOCAL |

| ID | Rule |
|----|------|
| **APP-1** | App-level data is never synchronized and never placed in synchronized workspace data. |
| **APP-2** | The account verifier is secure-local (keychain), never in any file in clear. |
| **APP-3** *(Open decision OD-ST7)* | Whether user preferences live app-level (apply globally) or per-workspace. Recommended: app-level for theme/language/color; per-workspace overrides are future. |

> This refines `init.md`'s "user preferences" (local-only): preferences and account data are
> **app-level** local data, distinct from a workspace's local-only data inside its `.swaft`.

---

## 3. Optional Whole-File Encryption

| ID | Requirement |
|----|-------------|
| **ENC-1** | Encryption is optional and chosen at workspace creation. |
| **ENC-2** | Encryption protects the **entire** `.swaft` file (all entities, including local-only data). |
| **ENC-3** | Loss of password/key makes the workspace **unrecoverable** (no backdoor). |
| **ENC-4** | Encryption metadata MUST NOT expose sensitive contents (§ security ENC-5). |
| **ENC-5** *(Recommended)* | Implemented in the LocalAdapter open/save path via CryptoService; decrypt to a protected working form on open, re-encrypt on save. |

> Crypto primitives and MVP depth: see [`SWAFT_SECURITY_MODEL.md`](SWAFT_SECURITY_MODEL.md) §4 and
> [`SWAFT_MVP_SCOPE.md`](SWAFT_MVP_SCOPE.md). Recommended: Argon2id KDF + AEAD cipher.

---

## 4. Import / Export

| ID | Requirement |
|----|-------------|
| **IE-1** | Workspace portability is achieved by the single-file `.swaft` model (copy/move the file). |
| **IE-2** *(Recommended)* | Storage-mode "migration" (if ever offered) is an explicit export → import/clone that creates a **new** workspace with the target mode; the original is unchanged (SM-3). |
| **IE-3** *(Recommended)* | Export MUST exclude secrets (which live in OS keychain), and SHOULD clearly state that secret references will not resolve on another machine until re-provisioned. |
| **IE-4** *(Recommended)* | DB result exports (CSV/JSON) are a separate, content-level export — not workspace export. |

> **Open decision (OD-ST1):** Whether a structured (non-binary) export format (e.g. JSON bundle) is
> offered in addition to the raw `.swaft` file. Recommended: defer; raw-file portability suffices for MVP.

---

## 5. Sync Metadata (recommended schema-level fields)

Every **synchronized** entity carries the following, enabling deterministic last-write-wins.

| Field | Type | Purpose |
|-------|------|---------|
| `updatedAt` | timestamp | Primary comparison key for last-write-wins. |
| `updatedByDeviceId` | string | Provenance + deterministic tiebreaker when timestamps tie. |
| `revision` | integer | Monotonic per-entity counter; increments each write. |
| `deletedAt` | timestamp \| null | Tombstone; deletion is a write, resolved by LWW like any other. |
| `createdAt` | timestamp | Creation time (housekeeping/audit). |
| `logicalClock` | integer (Lamport) or vector | **Optional**; use if wall-clock skew across peers proves problematic. |

| ID | Rule |
|----|------|
| **SY-1** | Every synchronized entity MUST carry enough metadata to determine the last write deterministically. |
| **SY-2** | The same set of changes MUST produce the same final state on all peers. |
| **SY-3** | Local-only and secure-local entities do not require sync metadata. |

---

## 6. P2P Sync Scope

### 6.1 Synchronized vs Not (from `init.md` §6.4–§6.6)

| Data category | Synchronized | Classification |
|---------------|:------------:|----------------|
| Templates | ✅ Yes | 🟢 SYNC |
| Template releases | ✅ Yes | 🟢 SYNC |
| Workspace settings | ✅ Yes | 🟢 SYNC |
| Projects | ✅ Yes | 🟢 SYNC |
| Folders | ✅ Yes | 🟢 SYNC |
| Tags | ✅ Yes | 🟢 SYNC |
| Restrictions | ✅ Yes | 🟢 SYNC |
| Changelog | ✅ Yes | 🟢 SYNC |
| Last input values | ❌ No | 🔵 LOCAL |
| API call history | ❌ No | 🔵 LOCAL |
| Database query history | ❌ No | 🔵 LOCAL |
| User preferences | ❌ No | 🔵 LOCAL |
| Default release selection per template | ❌ No | 🔵 LOCAL |
| Local secrets | ❌ No | 🟠 SECURE |
| Local credentials | ❌ No | 🟠 SECURE |
| Local action receipts | ❌ No | 🔵 LOCAL |

Plus P2P trust entities (🟢 SYNC, public parts): device identities (public key), invitations, allowlist, revocation.

### 6.2 P2P Behavior

| ID | Requirement |
|----|-------------|
| **PS-1** | P2P synchronization is **real-time**. |
| **PS-2** | Network mode is configurable: `lanOnly`, `internet`, or `both`. |
| **PS-3** | Only allowlisted, non-revoked devices with valid signed invitations participate (see [`SWAFT_SECURITY_MODEL.md`](SWAFT_SECURITY_MODEL.md) §5–§7). |
| **PS-4** | User-specific/local-only and secure-local data MUST NOT be synchronized. |

---

## 7. P2P Non-Synced Local Data

| ID | Rule |
|----|------|
| **NS-1** | Local-only data (last inputs, API/DB history, preferences, default release selection, receipts, audit) stays on the device. |
| **NS-2** | Secure-local data (secrets, credentials, private keys, encryption material) stays in OS keychain, never synchronized. |
| **NS-3** | Release **selection** is personal and never synchronized, even though **releases themselves** are synchronized. |

---

## 8. Conflict Resolution — Last-Write-Wins

| ID | Requirement |
|----|-------------|
| **LWW-1** | Conflict resolution for synchronized entities is **last-write-wins**. |
| **LWW-2** | Resolution MUST be deterministic and convergent (same inputs ⇒ same final state on all peers). |
| **LWW-3** | LWW is applied **only** to synchronized entities. |
| **LWW-4** | Deletion (`deletedAt`) participates in LWW like any other write. |

### 8.1 Recommended LWW Algorithm

For a given entity id, when two versions A and B conflict:

```
1. Compare updatedAt:        the later updatedAt wins.
2. If updatedAt is equal:    compare logicalClock (if used) — higher wins.
3. If still tied:            compare updatedByDeviceId lexicographically (deterministic tiebreak).
4. Tombstone (deletedAt) is just a field value resolved by the same rule;
   a later delete beats an earlier edit, a later edit beats an earlier delete.
```

| ID | Recommendation |
|----|----------------|
| **LWW-R1** | Resolve at **entity granularity** in MVP-era design (whole-row LWW), not field-level merge — simpler and deterministic. |
| **LWW-R2** | Releases are immutable; conflicts on a release id should not occur in practice, but if they do, identical content makes resolution a no-op. |
| **LWW-R3** | Revocation entries SHOULD be treated as monotonic/append-only so a revoke is not lost to a stale allowlist write (see security REV-4). |

> **Open decision (OD-ST2):** Whether any entity warrants field-level merge (vs whole-entity LWW).
> Recommended: whole-entity LWW for all synced entities in v1.

---

## 9. Server Storage (Future Model)

| ID | Statement |
|----|-----------|
| **SV-1** | `server` is a recognized, **reserved** storage mode; behavior beyond recognition is undefined in the initial model. |
| **SV-2** | Storage mode (including `server`) remains immutable. |
| **SV-3** | Server mode MUST NOT alter local-first assumptions for local workspaces. |
| **SV-4** | The data model MUST reserve `server` without implementing server behavior in MVP. |
| **SV-5** *(Recommended)* | When defined, server mode SHOULD reuse the repository interfaces and the synchronized/local-only/secure-local classification, swapping only the adapter. |

> **Open decision (OD-ST3):** Full server storage and synchronization behavior (transport, auth,
> conflict model, multi-tenant). Deferred (mirrors product OD-2).

---

## 10. Storage Adapter Abstraction

The service layer depends on **repository interfaces**; a **storage adapter** implements them per mode.

```
 services → repository interfaces → { LocalAdapter | P2PAdapter | ServerAdapter }
                                       (chosen by workspace.storageMode, immutable)
```

| Adapter | Mode | Responsibility |
|---------|------|----------------|
| **LocalAdapter** | `local` | SQLite `.swaft` persistence; optional whole-file encryption; authoritative store. |
| **P2PAdapter** (future) | `p2p` | Local persistence **plus** real-time sync of 🟢 SYNC entities with allowlisted devices; LWW; revocation handling. |
| **ServerAdapter** (future) | `server` | Server-backed persistence/sync; reuses interfaces and classification. |

| ID | Rule |
|----|------|
| **AD-1** | The adapter is selected by the immutable `storageMode` and cannot change for a workspace. |
| **AD-2** | All adapters honor the sync classification: only 🟢 SYNC entities are ever synchronized. |
| **AD-3** *(Recommended)* | The P2P/server adapters wrap the same local persistence the LocalAdapter uses, layering sync on top — so local-first behavior is preserved. |

---

## 11. Workspace Immutability of Storage Mode

| ID | Requirement |
|----|-------------|
| **IMM-1** | `storageMode` is set at creation and immutable. |
| **IMM-2** | No in-place mutation operation exists in the API or UI. |
| **IMM-3** | "Changing" mode is only achievable via explicit export/import/clone to a new workspace. |

---

## 12. Backup Considerations

| ID | Recommendation |
|----|----------------|
| **BK-1** | The single-file `.swaft` model makes backup a file copy; document this for users. |
| **BK-2** | For encrypted workspaces, backups remain encrypted; the user MUST retain the password/key (no recovery — security REC-1). |
| **BK-3** | Secrets are **not** in the `.swaft` file; a file backup does **not** back up OS-keychain secrets. Users must re-provision secrets when restoring on a new machine. |
| **BK-4** *(Recommended)* | Warn against copying a `.swaft` file while the workspace is open (use safe-copy/checkpoint to avoid partial WAL state). |
| **BK-5** *(Open decision OD-ST4)* | Whether Swaft offers an in-app "safe backup/snapshot" command. Recommended: defer; rely on file copy with guidance for MVP. |

---

## 13. Migration / Versioning Considerations

| ID | Requirement |
|----|-------------|
| **MV-1** | The `.swaft` schema MUST carry a `schemaVersion` (on the workspace metadata). |
| **MV-2** | Opening a workspace MUST check `schemaVersion`; an **older** version is upgraded by ordered migrators; a **newer** version (from a newer Swaft) MUST be rejected with a clear error rather than guessed. |
| **MV-3** *(Recommended)* | Migrations are forward-only and ordered (`v → v+1`), mirroring Seebo's state-migration approach. |
| **MV-4** *(Recommended)* | Seebo contract versions (`astVersion`, `stateVersion`, `analysisVersion`) are independent of the `.swaft` `schemaVersion`; Swaft tracks both. Persisted Seebo state (if ever stored) follows Seebo's `migrateState`. |
| **MV-5** *(Recommended)* | Migrations MUST preserve the sync classification and sync metadata of synchronized entities. |

> **Open decision (OD-ST5):** Whether migrations run automatically on open or require explicit user
> confirmation (especially for encrypted workspaces). Recommended: auto-upgrade with a backup prompt
> for major schema changes.

---

## 14. Summary of Storage Rules

| ID | Rule |
|----|------|
| **R1** | One `.swaft` SQLite file per local workspace; portable; authoritative. |
| **R2** | Optional whole-file encryption; unrecoverable if key lost. |
| **R3** | Storage mode immutable; no in-place migration. |
| **R4** | Synchronized = templates, releases, settings, projects, folders, tags, restrictions, changelog (+ P2P public trust data). |
| **R5** | Local-only = inputs, histories, preferences, default release selection, receipts, audit. |
| **R6** | Secure-local = secrets/credentials/keys + **account verifier** (OS keychain), never in file, never synced. |
| **R6a** | App-level data (account profile, session, preferences, recent list) lives outside any `.swaft`; never synced. |
| **R7** | P2P conflict resolution = deterministic last-write-wins on synchronized entities only. |
| **R8** | Every synchronized entity carries `updatedAt`, `updatedByDeviceId`, `revision`, `deletedAt` (+ optional `logicalClock`). |
| **R9** | `schemaVersion` gates open/migrate; newer-than-supported is rejected. |

---

## 15. Open Decisions (Storage & Sync)

| ID | Topic | Recommendation |
|----|-------|----------------|
| **OD-ST1** | Structured export format beyond raw `.swaft`. | Defer; raw-file portability for MVP. |
| **OD-ST2** | Field-level merge vs whole-entity LWW. | Whole-entity LWW in v1. |
| **OD-ST3** | Full server storage behavior. | Deferred (mirrors product OD-2). |
| **OD-ST4** | In-app backup/snapshot command. | Defer; file copy + guidance for MVP. |
| **OD-ST5** | Auto-migrate vs confirm on open. | Auto-upgrade with backup prompt for major changes. |
| **OD-ST6** | Logical clock form (Lamport vs vector). | Start without; add Lamport if skew issues appear (mirrors data-model OD-D5). |
| **OD-ST7** | Preferences app-level vs per-workspace. | App-level for theme/language/color; per-workspace overrides future. |
| **OD-ST8** | App-level store format (SQLite vs JSON). | Small SQLite store in user-data dir (Recommended); verifier in keychain. |
