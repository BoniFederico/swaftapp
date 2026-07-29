# Swaft & Open Standards — Status & Remaining Work

> **Status: mostly implemented.** This file used to be a forward-looking action plan; it is now a
> **handoff document** — a precise ledger of what was built (with `file:line` anchors into the current
> working tree) and what is still open. A fresh session with no other context should be able to read
> this file alone and continue the work.
>
> **Goal (unchanged):** make Swaft store and exchange its data using **open, plain-file standards** —
> the folder of files is the source of truth, API requests are `.http` files, while keeping Seebo
> formulas and Swaft's richer features, and offering guided import/export to the wider ecosystem
> (Postman, Bruno, OpenAPI, cURL, HAR). Scenarios-as-Arazzo is now wired end to end — projection +
> per-scenario Export/Import UI (§1.7). Documents-as-front-matter was designed but **not yet wired
> in** — see §3.2.

The load-bearing architectural principle held throughout: **the canonical *runtime* model is
unchanged.** An API request is still a `HttpRequestModel` ([`ops.ts`](packages/shared/src/ops.ts)) held
in the `source` column; a scenario is still a `ScenarioGraph` ([`scenario.ts`](packages/shared/src/scenario.ts)).
Only the **on-disk file form** changes, via per-type codecs in the projection
([`projection.ts`](apps/desktop/src/main/workspace/projection/projection.ts)). `ApiView`, the Seebo
engine, the send path and its security enforcement, the tab router — none of this changed.

---

## 1. What's implemented

### 1.1 Interchange codecs (pure functions, `packages/shared/src`)

All of these are **pure, dependency-light, unit-tested** converters — no Electron/Node dependency,
usable from the renderer or main:

| Codec | File | Direction | Notes |
|---|---|---|---|
| `.http` | [`http-file.ts`](packages/shared/src/http-file.ts) | `HttpRequestModel ⇄ request.http` | Seebo stored verbatim (`${ … }`); `info` as `#` comments; `bodyType` ⇄ `Content-Type`. |
| cURL | [`curl.ts`](packages/shared/src/curl.ts) | `fromCurl` / `toCurl` | Shell tokenizer, POSIX quoting. Wired into `ApiView` (Copy as cURL / Paste cURL). |
| OpenAPI 3.1 | [`openapi.ts`](packages/shared/src/openapi.ts) | **import only** → `ImportedCollection` | `{param}` → `${ param }`; `servers` → `BASE_URL` env; `security` → `${ secret('...') }`. |
| Postman v2.1 | [`postman.ts`](packages/shared/src/postman.ts) | `fromPostman` / `toPostman` (verbatim) | Conversion (variabilize vs. verbatim) is externalized to `ExportService`, not the codec. |
| Bruno | [`bruno.ts`](packages/shared/src/bruno.ts) | `toBruno` / `fromBruno` | File-per-request `.bru` DSL + `bruno.json`; brace-depth-aware block scanner. |
| HAR 1.2 | [`har.ts`](packages/shared/src/har.ts) | **export only** | `toHar(entries)`; wired to a UI action (API view → History → "Export HAR"). |
| Arazzo 1.0 | [`arazzo.ts`](packages/shared/src/arazzo.ts) | `toArazzo` / `fromArazzo` | Wired into the projection (`scenario` templates, `FORMAT_VERSION` 3) and into a per-scenario Export/Import UI — see §1.7/§3.1. |
| Front matter | [`front-matter.ts`](packages/shared/src/front-matter.ts) | `toFrontMatter` / `parseFrontMatter` | Dependency-free YAML-ish front matter. **NOT wired into the projection** — see §3.2. |
| Seebo conversion | [`seebo-convert.ts`](packages/shared/src/seebo-convert.ts) | `variabilizeSeebo`, `bracesToSeebo` | `env`/`secret`/bare `${ }` ⇄ `{{ }}`; used by `ExportService` at export time only (on-disk form always keeps Seebo verbatim). |
| Secret scan | [`secret-scan.ts`](packages/shared/src/secret-scan.ts) | `scanForSecrets`, `hasSecretLiteral` | Detector exists and is unit-tested. **NOT wired into any write/commit path yet** — see §3.4. |
| Neutral collection model | [`collection.ts`](packages/shared/src/collection.ts) | `ImportedCollection`, `ImportedRequest`, `ImportedEnvironment` | The shared shape all import adapters produce and `ImportService` consumes. |
| ZIP (store method) | [`zip.ts`](packages/shared/src/zip.ts) | `zip`/`unzip`, `zipText`/`unzipText` | Dependency-free, browser-safe. Verified interoperable with a standard unzip tool (Windows `Expand-Archive`). Backs the `.swaft` container (§1.3). |

### 1.2 API templates stored as `.http` (Workstream 2 — done)

`FORMAT_VERSION = 2` ([`projection.ts:35`](apps/desktop/src/main/workspace/projection/projection.ts)):
an `api` template's on-disk body is `templates/<slug>.<id>/request.http` (via `toHttpFile`/`fromHttpFile`)
plus a `template.json` `api` block for what `.http` can't carry (structured non-header auth, pre/post
actions). v1 workspaces (`source.json`) still hydrate; the next save upgrades them to v2. Send path,
editor and Seebo formula resolution are untouched.

### 1.3 Folder-as-truth + hybrid naming + `.swaft` container (Workstream 1 — done)

- **Hybrid naming (D2):** every flat entity, template directory and release file is named
  `<slug>.<shortId>` ([`naming.ts`](apps/desktop/src/main/workspace/projection/naming.ts):
  `slugify`/`shortId`/`entityBaseName`), wired into `dumpFlat`/`dumpTemplates`
  ([`projection.ts:209-319`](apps/desktop/src/main/workspace/projection/projection.ts)). The loader
  keys off the **in-file id**, never the path — legacy `<id>.json` files still hydrate; a rename is a
  pure file move.
- **Folder-backed `local` workspaces (D1):** [`FolderPersistence`](apps/desktop/src/main/workspace/persistence/FolderPersistence.ts)
  reuses `dumpWorkspace`/`hydrateWorkspace` verbatim (same on-disk form as a `git` workspace, minus git,
  minus encryption). [`WorkspaceService`](apps/desktop/src/main/workspace/WorkspaceService.ts) picks the
  strategy by location shape: a `.swaft` path stays single-file/encryptable
  (`isSwaftFile`/`localFor`, lines 18/103-104); any other path is folder-backed. `probePath` is
  `'file' | 'git' | 'folder' | 'missing'` (a directory with `.git` → git; otherwise a plain folder).
  Surfaced in the create UI as a third variant ("Local folder") alongside "Local file (.swaft)" and
  "Git".
- **`.swaft` as a zip container (D1):** [`ContainerService`](apps/desktop/src/main/workspace/ContainerService.ts) +
  [`projection/container.ts`](apps/desktop/src/main/workspace/projection/container.ts) pack the open
  workspace into a `.swaft` zip (optionally AES-encrypted, reusing
  [`CryptoService`](apps/desktop/src/main/crypto/CryptoService.ts)). Opening a `.swaft` is unified into
  `workspace.open`: a zip is unzipped to a sibling folder and opened as a folder workspace (idempotent);
  a legacy single-file SQLite `.swaft` returns `null` from the sniff and opens as before. New op
  `container.export` ([`ops.ts:626`](packages/shared/src/ops.ts)); UI action "Export .swaft container…"
  in the Working Tree's Import/Export menu.
- **Local-only data** (history, run logs, input state, selections) was already excluded from the
  projection (🔵 tables, [`projection.ts`](apps/desktop/src/main/workspace/projection/projection.ts)
  doc comment) — it simply isn't persisted for folder/git workspaces today. A dedicated git-ignored
  `/.swaft/` cache directory for this data was **not built** (see §3.5) — not needed yet since nothing
  currently needs to persist it there.

### 1.4 Published, machine-checkable format (Workstream "Phase 0" — done)

[`FORMAT.md`](FORMAT.md) (repo root) documents the full on-disk layout, hybrid naming, per-file JSON
shapes, the `.http` + `template.json` `api` block split, verbatim Seebo, `formatVersion`/`schemaVersion`,
what is deliberately not versioned, and the `.swaft` container. Backed by JSON Schema (draft-07) for
every JSON file shape under
[`apps/desktop/src/main/workspace/projection/schemas/`](apps/desktop/src/main/workspace/projection/schemas):
`workspace`, `settings`, `project`, `folder`, `tag`, `environment`, `changelog`, `template`, `release`.
A test ([`schemas.test.ts`](apps/desktop/src/main/workspace/projection/schemas.test.ts)) dumps a
workspace exercising every shape and validates each emitted file against its schema with `ajv` (a
devDependency), so a projection change that isn't reflected in the schemas — or vice versa — fails
loudly.

### 1.5 Import/Export UI (Workstream 3 — done for Postman/Bruno/.http/OpenAPI-import/cURL)

- **Import:** [`ImportDialog.tsx`](apps/desktop/src/renderer/src/workspace/ImportDialog.tsx) parses a
  foreign spec (OpenAPI JSON/YAML, Postman) with the shared codecs, previews it, and materializes it via
  op `collection.import` → [`ImportService`](apps/desktop/src/main/workspace/ImportService.ts) into a
  new/existing project, folder or workspace (target picker: new workspace / new project / new folder /
  existing node).
- **Export:** [`ExportDialog.tsx`](apps/desktop/src/renderer/src/workspace/ExportDialog.tsx) → op
  `collection.export` → [`ExportService`](apps/desktop/src/main/workspace/ExportService.ts). Scope =
  template / folder / project / workspace; format = Postman / `.http` / Bruno; conversion =
  verbatim / variabilize (only asked when the scope actually contains Seebo). Produces a **fidelity
  report** (what was skipped — non-api templates have no collection equivalent). Saved via native
  dialogs (`file.saveText` for a single file, `file.saveFiles` for a tree, with a path-traversal guard).
- **Entry points:** the Working Tree's per-node menus (folder → "Export folder…", api template →
  "Export request…"/"Copy as cURL"/"Replace from cURL") plus a single **Import/Export** menu in the top
  bar (`ExportIcon`, borderless, placed left of Settings) exposing Import, Export project (when a
  project is selected), Export workspace, and Export `.swaft` container. The Working Tree is a
  `forwardRef` ([`WorkingTree.tsx`](apps/desktop/src/renderer/src/workspace/WorkingTree.tsx),
  `WorkingTreeHandle`) so the top bar drives it imperatively while the dialogs/state stay owned by the
  tree (shared with the per-node menus).
- **Not built:** the **environments multi-select at export time** and the **"personal environment"
  opt-in/flag** described in the original plan's §6.3 — today `ExportService` exports whichever
  environments the scope implies, with no picker and no personal/shared distinction in the dialog.
  Also not built: **round-trip identity preservation** (a Bruno `meta.swaftId` marker so a re-import
  updates in place instead of creating new entities) — every import today creates fresh ids.

### 1.6 Secrets (Workstream 6, partial — see §3.3/§3.4 for what's left)

- **`secret('NAME')` data capability:** [`SeeboHost.ts`](apps/desktop/src/main/seebo/SeeboHost.ts)
  registers `secret` in `DATA_CAPABILITIES` ([`ops.ts:988`](packages/shared/src/ops.ts)), resolved
  main-process-only from the OS keychain via
  [`SecretService`](apps/desktop/src/main/secret/SecretService.ts) (`SafeStorageCipher`), redacted via
  `enginePolicy.redact`. Never written to any file, never sent to the renderer.
- **Secrets management UI:** Settings → Secrets
  ([`SecretsSettings.tsx`](apps/desktop/src/renderer/src/settings/sections/SecretsSettings.tsx)) lists
  secret names (never values), and adds/updates/deletes them. Ops `secret.set` / `secret.list` /
  `secret.delete` ([`ops.ts:601-603`](packages/shared/src/ops.ts)).
- **Not built:** the **config-vs-secret label on individual environment variables** (§3.3), **dotenv
  on-disk form for environments** (§3.3), the **pre-write/pre-commit secret scan wiring** (§3.4), and a
  **one-click `secretRef` → `secret('NAME')` migration action** (§3.4) — the legacy `auth.secretRef` →
  keychain path still works unchanged as a fallback
  ([`HttpService.ts`](apps/desktop/src/main/http/HttpService.ts)), it's just not offered a conversion UI.

### 1.7 Scenario templates stored as Arazzo (Workstream 4 — done, incl. UI)

`FORMAT_VERSION = 3` ([`projection.ts:35`](apps/desktop/src/main/workspace/projection/projection.ts)):
a `scenario` template's on-disk body is `templates/<slug>.<id>/scenario.arazzo.yaml` (via
`toArazzo`/`fromArazzo`), an Arazzo 1.0 workflow document. Everything Arazzo has no native concept for —
non-HTTP nodes, decision branches, breakpoints, canvas positions — lives under `x-swaft` extensions, so
nothing Swaft-specific needed its own JSON schema. v1/v2 workspaces (a scenario graph in `source.json`)
still hydrate; the next save upgrades them to v3. The canvas, execution engine and Seebo formula
resolution are untouched — only the on-disk form changed.

**UI (§3.1 item 4):** the scenario row's context menu in the Working Tree offers "Export scenario as
Arazzo…" (saves the current graph as a standalone `.arazzo.yaml`) and "Import Arazzo…" (replaces the
graph in place from a pasted/dropped Arazzo document, via
[`ImportArazzoDialog.tsx`](apps/desktop/src/renderer/src/workspace/ImportArazzoDialog.tsx)). Full detail
in §3.1.

---

## 2. Cross-cutting facts that still hold

- **Runtime model unchanged.** No change to `HttpRequestModel`, `ScenarioGraph`, document `source`, the
  Seebo engine, the send path's SSRF/blocked-domain/enforced-header enforcement, the sandbox, or the
  transport/IPC allow-list model (every new capability is an ordinary session-guarded op).
- **Storage mode is immutable** at workspace creation
  ([`WorkspaceService.ts`](apps/desktop/src/main/workspace/WorkspaceService.ts)) — `local` (file or
  folder) vs `git`.
- **Back-compat:** legacy single-file SQLite `.swaft` still opens directly; v1 `source.json` api
  templates still hydrate; legacy `<id>.json` flat-entity files still hydrate.
- Full test suite (node + dom) is green; typecheck and lint are clean; a production build succeeds. Run
  `npm test`, `npm run typecheck`, `npm run lint` from the repo root to re-verify after further changes.

---

## 3. What's left (concrete, actionable)

Ordered roughly by how directly each continues existing, tested code (least new plumbing first). Each
item names the exact files to touch and what "done" looks like, mirroring how Workstreams 1/2 were
delivered — projection codec first (with a domain-level round-trip test, since the on-disk form won't
be byte-identical to the runtime JSON), then UI.

### 3.1 Scenarios stored as Arazzo (was Workstream 4)

**Items 1-3 done.** `dumpTemplates`/`hydrateTemplates`
([`projection.ts:242-410`](apps/desktop/src/main/workspace/projection/projection.ts)) now branch on
`type === 'scenario'` the same way `type === 'api'` already branches: `dumpTemplates` writes
`scenario.arazzo.yaml` via `toArazzo`; `hydrateTemplates` reads it back via `fromArazzo` when present,
else falls back to the legacy `source.json` sidecar (v1/v2 back-compat, mirroring how api templates fall
back to `source.json`). `FORMAT_VERSION` is now **3** (documented in `FORMAT.md` §1/§4/§5); no new JSON
schema was needed — every Swaft-only piece (action/capability/delay nodes, decision branches,
breakpoints, canvas layout) lives under `x-swaft` extensions inside the YAML document itself, not a
separate file. A gap was found and fixed while wiring this up: the `breakpoint` field (added by the
block-breakpoints feature) was on `ScenarioNode` but never round-tripped by `toStep`/`fromArazzo` in
`arazzo.ts` — fixed, covered by a new case in `arazzo.test.ts`. Domain-level round-trip coverage (incl.
a legacy `source.json` back-compat case) is in `projection.test.ts` (`canonicalScenarioSource`,
`N.tplScenario`), following the `canonicalApiSource` pattern already there.

**Item 4 done.** Per-scenario "Export scenario as Arazzo…" / "Import Arazzo…" actions live on the
scenario row's context menu in the Working Tree
([`WorkingTree.tsx`](apps/desktop/src/renderer/src/workspace/WorkingTree.tsx), `templateMenu`,
`exportScenarioArazzo`/`importScenarioArazzo`). Unlike the collection Export/Import (scope + format
picker over many api templates), this is a single-scenario, single-format action, so it reuses the
existing generic `template.get`/`template.updateSource` ops instead of adding new ones — no new op,
service, or schema. Parsing/serialization happen in the renderer with the shared pure codecs
(`toArazzo`/`fromArazzo`/`parseScenarioGraph`/`serializeScenarioGraph` from `@swaft/shared`, dynamic
`import('js-yaml')` for YAML dump/parse — the same `parseSpec` JSON-or-YAML helper the OpenAPI import
path already uses), mirroring how `ImportDialog` parses OpenAPI/Postman client-side and only
materializes via an op.
- **Export** — `template.get` to read the current source, `parseScenarioGraph` + `toArazzo` + a YAML
  dump, saved via the existing `file.saveText` op. No dialog: a single scenario has no scope/format
  choice to make.
- **Import** — [`ImportArazzoDialog.tsx`](apps/desktop/src/renderer/src/workspace/ImportArazzoDialog.tsx)
  accepts a pasted/dropped Arazzo document (YAML or JSON), parses it with `fromArazzo`, previews the
  node/edge count, and — mirroring the collection import/export **fidelity-report** pattern rather than
  an interactive per-step remapping UI — lists any step whose `x-swaft` template `ref` doesn't resolve
  to a template id in this workspace (e.g. an Arazzo doc authored elsewhere, or hand-edited). Unresolved
  refs are reported, not blocked: confirming still replaces the scenario's graph in place via
  `template.updateSource`, importing the dangling ref as-is so it can be rewired on the canvas.
  Covered by `ImportArazzoDialog.test.tsx` (parse/preview/unresolved-ref report) and an end-to-end case
  in `tree.test.tsx` (menu → dialog → `template.updateSource` → persisted graph).

### 3.2 Documents stored as Markdown/native + YAML front matter (was Workstream 5)

The `front-matter.ts` codec exists and is unit-tested but document templates still write a plain
`source.<ext>` sidecar with a separate `template.json` for metadata.

**To do:**
1. In `dumpTemplates`, for `type === 'document'`, prepend a front-matter block (id, name, subtype, tags)
   to the body via `toFrontMatter` instead of writing a bare `source.<ext>` + separate `template.json`
   fields; `hydrateTemplates` parses it back via `parseFrontMatter` (defensive: a missing/malformed
   block degrades to treating the whole file as body content, same tolerance the projection already
   applies to other JSON reads).
2. Front matter only for `document` types; api/scenario/capability/action keep their dedicated forms.
3. Round-trip test + `FORMAT.md`/schema update, same shape as §3.1.

### 3.3 Config/secret split for environment variables + dotenv form

Environments today store `vars` as an untyped `string → string` map
([`EnvironmentService.ts`](apps/desktop/src/main/workspace/EnvironmentService.ts)) and are dumped as
plain JSON (`environments/<slug>.<id>.json`, `environment.schema.json`). The plan called for:

1. **Per-variable label** (`config` vs `secret`) in the data model, UI
   ([`EnvironmentsSettings.tsx`](apps/desktop/src/renderer/src/settings/sections/EnvironmentsSettings.tsx))
   and schema — mirrors Postman's `default`/`secret` variable types. A variable marked `secret` should
   not be exportable as a literal value (route it through the `${ secret('NAME') }` capability instead,
   or export as a placeholder — same rule already applied to keychain secrets in `ExportService`).
2. **Environments as `.env` (dotenv) files on disk** instead of JSON — the plan's `environments/<name>.env`
   form (§3 of the old plan). This is a projection change (new codec) plus an `environment.schema.json`
   revision (or its retirement in favor of a documented dotenv grammar in `FORMAT.md`).
3. Decide whether this is worth the churn now — the JSON form already works and is validated; the
   dotenv form is mostly a portability/readability nicety for hand-editing. If deprioritized, at least
   add the per-variable `config`/`secret` label (item 1), which has real security value.

### 3.4 Pre-write secret scan + `secretRef` migration

`scanForSecrets`/`hasSecretLiteral` ([`secret-scan.ts`](packages/shared/src/secret-scan.ts)) exist and
are unit-tested but are **not called from anywhere in `apps/desktop/src/main`**.

**To do:**
1. Wire the scan into the write path before a folder/git workspace is persisted — likely in
   `dumpWorkspace` ([`projection.ts:119-124`](apps/desktop/src/main/workspace/projection/projection.ts))
   or at `git.commit` time ([`GitOpsService.ts`](apps/desktop/src/main/git/GitOpsService.ts)) — flagging
   probable secret literals (high-entropy strings, literal `Authorization:` header values) before they
   reach a committed file, pointing the user at `secret(...)`.
2. Decide UX: hard refuse vs. warn-and-confirm. A local (non-git) folder workspace has weaker stakes
   than a `git commit`, so the gate might only need to be strict on the git commit path.
3. A one-click "convert `secretRef` → `secret('NAME')`" action (folder/auth editor UI) — the legacy
   `auth.secretRef` path already resolves through the keychain identically to the new capability
   ([`HttpService.ts`](apps/desktop/src/main/http/HttpService.ts)), so this is a UI convenience, not a
   behavior change.

### 3.5 Local-only data under a git-ignored `/.swaft/` cache directory

Not built. Today, local-only tables (request/run history, receipts, input state, selections) simply
aren't projected to files for folder/git workspaces — they live only in the in-memory SQLite cache and
are lost across a close/reopen of a folder or git workspace (this was already true before this work;
it is called out here because the original plan assumed a persistent local cache directory that was
never implemented). If this data should survive a reopen, add a `/.swaft/` directory (git-ignored, like
`.gitignore` already reserves) holding a serialized cache of the 🔵 local-only tables, read on open and
written on save, alongside (not instead of) the versioned projection tree.

### 3.6 Export dialog: environment multi-select + personal/shared flag

Noted in §1.5 as not built. `ExportDialog`/`ExportService` don't yet let the user pick which
environments to bundle with a collection export, and don't distinguish workspace-scoped from
user-scoped ("personal") environments. Add a multi-select to `ExportDialog.tsx`, default to the active
environment, and flag personal ones so a shared export can't silently leak them.

### 3.7 Round-trip identity for Bruno exports

`toBruno`/`fromBruno` don't yet carry a `meta.swaftId` field, so re-importing a previously-exported
Bruno collection creates new entities rather than updating in place. Add the id to the `.bru` `meta`
block on export and match on it during import (Postman v2.1 has no equivalent extension slot, so this
stays Bruno-only, as originally scoped).

---

## 4. Glossary of the standards involved

- **`.http` / `.rest` file** — plain-text request format (VS Code REST Client, JetBrains HTTP Client).
  The native on-disk form for Swaft's api templates.
- **Postman Collection v2.1** — the de-facto JSON interchange for a collection of saved requests.
- **Bruno / `.bru`** — open-source, file-per-request, git-native collection format.
- **OpenAPI 3.1** — the standard for *describing* an HTTP API; import source only (not a store of saved
  calls).
- **Arazzo Specification 1.0** — the OpenAPI Initiative standard for API *workflows*; the open
  counterpart of Swaft scenarios (codec built, not yet wired — §3.1).
- **HAR 1.2** — JSON log of HTTP requests/responses; used for history export.
- **dotenv (`.env`)** — `KEY=value` files; `.env` (committed config) vs `.env.local` (git-ignored
  secrets) is the standard split (not yet adopted for Swaft environments — §3.3).
- **CommonMark** — the standardized Markdown spec.
- **YAML front matter** — a `---`-delimited metadata block at the top of a text file; not yet adopted
  for Swaft documents — §3.2.
- **JSON Schema (draft-07)** — used to publish/validate Swaft's own on-disk file shapes (§1.4).
- **OPC / Zip container** — the "documented zip of open files" pattern behind `.docx`/`.xlsx`/`.epub`;
  the model for `.swaft` (§1.3).
