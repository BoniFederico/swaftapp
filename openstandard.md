# Swaft & Open Standards — Status & Remaining Work

> **Status: mostly implemented.** This file used to be a forward-looking action plan; it is now a
> **handoff document** — a precise ledger of what was built (with `file:line` anchors into the current
> working tree) and what is still open. A fresh session with no other context should be able to read
> this file alone and continue the work.
>
> **Goal (unchanged):** make Swaft store and exchange its data using **open, plain-file standards** —
> the folder of files is the source of truth, API requests are `.http` files, while keeping Seebo
> formulas and Swaft's richer features, and offering guided import/export to the wider ecosystem
> (Postman, Bruno, OpenAPI, cURL, HAR). Scenarios-as-Arazzo (§1.7) and documents-as-front-matter (§1.8)
> are now wired into the projection.

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
| Front matter | [`front-matter.ts`](packages/shared/src/front-matter.ts) | `toFrontMatter` / `parseFrontMatter` | Dependency-free YAML-ish front matter. Wired into the projection (`document` templates, `FORMAT_VERSION` 4) — see §1.8/§3.2. |
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
  doc comment). A dedicated git-ignored `/.swaft/` cache directory for it is now built — see §3.5,
  done: [`local-cache.ts`](apps/desktop/src/main/workspace/projection/local-cache.ts) serializes all
  8 `LOCAL_ONLY_TABLES` to `/.swaft/local-cache.json`, read on open / written on save, for folder and
  git workspaces.

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
- **Environments multi-select + personal flag (§6.3) — done, see §3.6.** `ExportDialog` now offers a
  checkbox list of every environment (defaulting to the active one), with a Personal/Workspace
  ownership badge next to each so a shared export can't silently include a personal one unnoticed.
- **Round-trip identity preservation (§3.7) — done.** Bruno exports carry a `meta.swaftId` marker;
  re-importing into an existing project/folder updates that template in place instead of creating a
  duplicate. Postman/`.http` still always create fresh ids (no extension slot for one), as scoped.

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

### 1.8 Document templates get a YAML front-matter header (Workstream 5, projection done — see §3.2)

`FORMAT_VERSION = 4` ([`projection.ts:35`](apps/desktop/src/main/workspace/projection/projection.ts)):
a `document` template's `source.<ext>` body is prepended with a `---`-delimited front-matter header
(`swaftId`, `name`, `type`, `subtype`, `tags` — tag **names**, resolved from `tags` at dump time, not
ids) via `toFrontMatter`. `template.json` remains the sole source of truth for those fields; the header
is a **write-only mirror** for portability (a document opened directly in Jekyll/Hugo/Obsidian/any
front-matter-aware tool is self-describing) — `hydrateTemplates` parses it with `parseFrontMatter` and
keeps only the body, discarding the parsed meta. Front matter is only added for `type === 'document'`;
api/scenario/capability/action keep their existing dedicated body forms untouched. Reading is
version-tolerant rather than version-gated: a pre-v4 file with no (or a malformed) header just yields an
empty header and the whole file as body — `parseFrontMatter`'s existing tolerant-parse behavior, no new
branching needed. Covered by `projection.test.ts` (front-matter header assertion on the existing
`tpl-doc` fixture, a dedicated pre-v4 back-compat case) — no new JSON schema needed (the header lives
inside the body file, not a separate structured file).

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

**Done.** `dumpTemplates`/`hydrateTemplates`
([`projection.ts:265-424`](apps/desktop/src/main/workspace/projection/projection.ts)) prepend a
front-matter block (`swaftId`, `name`, `type`, `subtype`, `tags`-as-names) to a `document` template's
`source.<ext>` via `toFrontMatter`; `hydrateTemplates` parses it back via `parseFrontMatter` and keeps
only the body (`template.json` stays the source of truth for those fields — the header is a
write-only, external-tool-portability mirror, not a second copy that could drift and win on read).
`FORMAT_VERSION` is now **4** (documented in `FORMAT.md` §1/§4/§5); no new JSON schema needed (the
header lives inside the existing body file). Reading is tolerant rather than version-gated: a pre-v4
file with no header (or a hand-edited malformed one) degrades to treating the whole file as body,
`parseFrontMatter`'s existing behavior — no branching needed in `hydrateTemplates` beyond gating on
`type === 'document'`. api/scenario/capability/action are unaffected, per the original scope. Covered
by `projection.test.ts` (front-matter assertion on the `tpl-doc` fixture, a dedicated pre-v4
no-header back-compat case). See §1.8 for the full write-up.

### 3.3 Config/secret split for environment variables + dotenv form

**Item 1 done** (per the plan's own fallback: "if deprioritized, at least add the per-variable
`config`/`secret` label" — item 2, below, was deprioritized; item 1 was not).

- **Schema:** `environments.secret_vars TEXT NOT NULL DEFAULT '[]'` (a JSON array of the keys in `vars`
  labeled "secret" rather than "config"), `SCHEMA_VERSION` 25→26
  ([`schema.ts`](apps/desktop/src/main/storage/schema.ts): DDL + forward migration). **Advisory only**
  — mirrors Postman's `default`/`secret` variable types, gates UI display and (once export exists —
  see §3.6, not yet built) export; `env('KEY')` resolution
  ([`EnvironmentService.resolve`](apps/desktop/src/main/workspace/EnvironmentService.ts)) is unchanged
  and kind-agnostic, exactly like a keychain `secret(...)` value is only ever a reference, never
  re-derived from a label.
- **Service:** `EnvironmentService.update()` accepts `secretVars?: string[]`, always filtered against
  the live `vars` keys (on every `vars` and/or `secretVars` write) so renaming/removing a variable can
  never leave a stale secret label pointing at nothing.
- **Wire format:** `envUpdateRequestSchema`/`EnvironmentDto` in `ops.ts` carry `secretVars`; the
  projection's `environments` `FLAT_ENTITIES` entry and `environment.schema.json` both gained the
  field. Back-compat: an environment file written before this (no `secretVars` key at all, not `null`)
  hydrates the key as `[]` — a new `jsonDefaults` hook on `FlatEntity`/`domainToRow`
  ([`projection.ts`](apps/desktop/src/main/workspace/projection/projection.ts)) distinguishes "key
  absent → default" from "key present as `null` → stays `null`" (needed here because `secret_vars` is
  `NOT NULL`, unlike the already-nullable `vars`).
- **UI:** `KeyValueEditor` gained optional `secretKeys`/`onToggleSecret` props (only used by
  `EnvironmentsSettings`, a no-op everywhere else it's reused — request params/headers have no such
  concept) — a per-row lock-icon toggle, and the value input renders as `type="password"` once a row
  is marked secret.
- **Three gaps found and fixed while wiring this up** (all pre-existing, exposed by adding this
  column): (a) the v18 migration step referenced the *live* `ENVIRONMENTS_DDL` constant instead of a
  frozen historical snapshot, so mutating that constant for v26 silently broke `ALTER TABLE ... ADD
  COLUMN` on a fresh v1→v26 migration (`duplicate column name`) — fixed by inlining the v18-era DDL,
  matching how every other migration step already treats its DDL as frozen; (b) `domainToRow` would
  hydrate a literal SQL `NULL` into a `NOT NULL` column (or a wrong `0` into a `NOT NULL` `bool` column)
  for a domain field entirely absent from an old file, as opposed to present-and-`null` — generalized a
  `jsonDefaults`→**`defaults`** hook on `FlatEntity`/`domainToRow`
  ([`projection.ts`](apps/desktop/src/main/workspace/projection/projection.ts)) covering `json`, `bool`
  and plain columns alike; (c) applying (b) more broadly surfaced the *same* bug already latent for
  `folders.headers`/`actions`/`notes` (added at v21/v24, well after folders existed — a pre-existing
  file predating one of them would hit `NOT NULL constraint failed` on hydrate) and for
  `workspace_settings.batcher_enabled` (added at v22 — an old `settings.json` would silently hydrate the
  batcher *disabled* instead of its intended default-enabled) — both now covered by `defaults` entries
  too (`proxy`/`auth` stay undefaulted; they're genuinely nullable, so an absent key correctly hydrates
  as `null`, not `{}`).
- Covered by `Environment.test.ts` (label round-trip + pruning + kind-agnostic `resolve()`),
  `schema.test.ts` (fresh-schema + migration pair, the v24/v25 pattern), `migration.test.ts` (full
  v1→current path, which is what caught gap (a)), `projection.test.ts` (missing-key back-compat cases
  for environments/folders/settings, which caught gaps (b) and (c)), and `EnvironmentsSettings.test.tsx`
  (new — the renderer had no test file
  for this section before).

**Item 2 (dotenv on-disk form) — deprioritized, not done.** The JSON form already works, is validated,
and (as of item 1) now carries the secret label too; dotenv is a portability/hand-editing nicety with
no security value beyond what item 1 already delivers. Revisit only if a concrete need for hand-editable
`.env` files surfaces.

### 3.4 Pre-write secret scan + `secretRef` migration

**Items 1-2 done.** `scanForSecrets` ([`secret-scan.ts`](packages/shared/src/secret-scan.ts)) is now
wired into `git.commit` as a **warn-and-confirm** gate (decided over hard-refuse: an entropy heuristic
has real false-positive risk, and a git commit is the one point that durably captures a literal secret
into shared history — a local/folder save is not gated the same way, per the plan's own "weaker stakes"
framing).

- **`scanWorkspaceForSecrets(adapter)`** (new,
  [`projection.ts`](apps/desktop/src/main/workspace/projection/projection.ts)) dumps the workspace into
  a throwaway `MemoryDirFs` (never touches the real filesystem) and scans exactly the files that would
  be written: api `request.http` bodies, `folders/*.json` (propagated headers/auth), and
  `environments/*.json` `vars` — **excluding** any variable already labeled `secret` (§3.3), since a
  labeled variable is an acknowledged risk and re-flagging it would just be noise. Documents/scenarios/
  capabilities are not scanned (free-form text → far more false positives, no higher real-secret odds).
- **`GitOpsService.commit(message, force = false)`**
  ([`GitOpsService.ts`](apps/desktop/src/main/git/GitOpsService.ts)) runs the scan first (before
  `ws.save()`, so a refusal never touches disk); with findings and no `force`, throws
  `AppError('SECRETS_FOUND', 'validation', ..., { findings })` — `details` carries only `SecretFinding`s
  (`kind` + a redacted `hint`, never a full value), matching the wire contract's own "details MUST NOT
  contain secrets" rule. `force: z.boolean().optional()` added to `gitCommitRequestSchema` (`ops.ts`) —
  a new pattern in this codebase (no prior op had a force/confirm-through field).
- **UI:** [`GitStatusButton.tsx`](apps/desktop/src/renderer/src/git/GitStatusButton.tsx) intercepts a
  `SECRETS_FOUND` error (instead of routing it to the generic error toast), lists the findings in a
  `ConfirmDialog`, and on confirm re-sends the same commit with `force: true`.
- Covered by `GitOpsService.test.ts` (refuse / force-through / secret-labeled-var exclusion),
  `projection.test.ts` (`scanWorkspaceForSecrets` unit cases), and `GitStatusButton.test.tsx` (the full
  refuse → dialog → confirm → retry round trip).

**Item 3 (one-click `secretRef` → `secret('NAME')` migration action) — deferred, not done.** Pure UI
convenience per the plan's own framing (the legacy `auth.secretRef` keychain path keeps resolving
unchanged in [`HttpService.ts`](apps/desktop/src/main/http/HttpService.ts) either way) — and today
`secretRef` has **no UI at all** (not shown/editable in `AuthEditor.tsx`), so this would start from
scratch rather than adding a button next to an existing field. Revisit as its own pass.

### 3.5 Local-only data under a git-ignored `/.swaft/` cache directory — done

[`local-cache.ts`](apps/desktop/src/main/workspace/projection/local-cache.ts) adds `dumpLocalCache`/
`hydrateLocalCache`, serializing all 8 [`LOCAL_ONLY_TABLES`](apps/desktop/src/main/storage/schema.ts)
(`local_input_state`, `release_selection`, `api_history`, `api_action_runs`, `receipts`,
`environment_selection`, `scenario_runs`, `scenario_run_steps`) to a single
`/.swaft/local-cache.json`, alongside (not instead of) the versioned projection tree. `.gitignore`
already reserved `/.swaft/` in both `FolderPersistence`/`GitPersistence` (§1.3), so the cache file is
written to disk but never tracked/committed.

Wired into [`FolderPersistence.ts`](apps/desktop/src/main/workspace/persistence/FolderPersistence.ts)
and [`GitPersistence.ts`](apps/desktop/src/main/workspace/persistence/GitPersistence.ts) only (not the
single-file `.swaft` container mode, which keeps the local-only tables in its own SQLite file
already): `open()` calls `hydrateLocalCache` right after `hydrateWorkspace` succeeds; `save()` calls
`dumpLocalCache` right after `dumpWorkspace`. A missing or corrupt cache file is treated as "nothing
to restore" — this data was always best-effort/local, so it must never block opening or saving a
workspace.

Covered by [`local-cache.test.ts`](apps/desktop/src/main/workspace/projection/local-cache.test.ts)
(round-trip across several tables, missing-file no-op, corrupt-JSON tolerance, empty-cache shape) and
new cases in `FolderPersistence.test.ts`/`GitPersistence.test.ts` (save → reopen round-trip, absent
cache on an older workspace, and — on the real-git suite — that `.swaft/local-cache.json` lands on
disk but stays untracked by `git ls-files`).

### 3.6 Export dialog: environment multi-select + personal/shared flag — done

`ExportDialog.tsx` gained a checkbox list under the format/conversion pickers, one row per environment
(name + the existing `OwnerBadge` Personal/Workspace label reused from `EnvironmentPicker.tsx`),
default-checked to the workspace's active environment (`useEnvironmentsOptional()` — the `Optional`
variant so the dialog degrades to "no environments" instead of crashing outside an
`EnvironmentProvider`, e.g. in isolated tests). Selected ids go out as `environmentIds` on
`collection.export` (`collectionExportRequestSchema`, `ops.ts`).

`ExportService.export()` takes a fourth `environmentIds` param, fetches each via
`EnvironmentService.get`, filters out `secretVars`-labeled keys (never emit a literal secret into a
shared file, mirroring the invariant already documented on `ImportedEnvironment` — "environment values
are plain config, never secrets"), and reports how many were redacted. Silently skips an
unknown/deleted id rather than failing the whole export.

Per-format bundling (open-standards question, resolved: Postman + Bruno only):
- **Postman** — a companion `<name>.postman_environment.json` file per selected environment
  (`toPostmanEnvironment`, `postman.ts`), Postman's own environment-file format.
- **Bruno** — a `environments/<name>.bru` file per selected environment inside the collection
  directory (`toBruno` now takes an optional `environments` array; `bruno.ts`), Bruno's native
  environment block (`vars { key: value }`).
- **`.http`** — no native single-file environment concept; a selected environment is silently *not*
  bundled, and the fidelity report says so explicitly (`N environment(s) were not bundled — .http
  export has no environment file.`) rather than pretending to include it.

Covered by new cases in `ExportService.test.ts` (Postman/Bruno env file content, secret redaction,
`.http` limitation reported, unknown-id skip), `postman.test.ts`/`bruno.test.ts` (codec-level env file
shape), and `ExportDialog.test.tsx` (default-to-active-environment, personal badge shown, toggling
changes the `collection.export` payload).

### 3.7 Round-trip identity for Bruno exports — done

`ImportedRequest` (`packages/shared/src/collection.ts`) gained an optional `swaftId?: string`
(mirrored by `importedRequestDtoSchema`, `ops.ts`). `ExportService` stamps each exported request with
its own template id; `toBruno` writes it as a `swaftId` line in the `.bru` `meta { }` block (`bruno.ts`
— `dict()`/`parseDict()` already tolerated an extra key, so this was additive); `fromBruno` reads it
back. Postman/`.http` never set it (no extension slot), exactly as originally scoped.

`ImportService.importCollection` now checks each request's `swaftId` before creating anything: if it
still names a **live** template in this workspace (`TemplateService.getTemplate`), that template's
`source` is updated in place (`updateSource`) instead of a duplicate being created; any other id
(foreign workspace, stale, deleted) is ignored and falls through to a normal create — a stale id is
never reused for an unrelated new entity. `ImportResult`/`ImportResultDto` gained an `updated` counter
alongside `requests`, so callers can tell "created" from "updated in place" apart.

Covered by `bruno.test.ts` (meta round-trip, absent when no id), `ImportService.test.ts` (update path,
unknown-id fallback), and an `ExportService.test.ts` end-to-end case (export a project as Bruno,
`fromBruno` + re-`importCollection` into the same project, assert one template updated and no
duplicate). The renderer's import target picker still only offers "new project" (§1.5's noted gap),
so the update-in-place path is exercised whenever a collection is re-imported into an **existing**
project/folder — a scenario the backend now supports correctly even though today's UI doesn't yet
drive it end-to-end.

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
- **YAML front matter** — a `---`-delimited metadata block at the top of a text file; adopted for
  Swaft `document` templates — §1.8/§3.2.
- **JSON Schema (draft-07)** — used to publish/validate Swaft's own on-disk file shapes (§1.4).
- **OPC / Zip container** — the "documented zip of open files" pattern behind `.docx`/`.xlsx`/`.epub`;
  the model for `.swaft` (§1.3).
