# Swaft & Open Standards — Action Plan

> **Status: action plan.** Decisions are locked per the product owner's direction (§1); a few
> residual calls are listed in §12. Claims about the current app are grounded in the working tree with
> `file:line` anchors (pointers, not contracts). Written in English to match the code symbols and the
> published docs.
>
> **Goal:** make Swaft store and exchange its data using **open, plain-file standards** — the folder
> of files is the source of truth, API requests are `.http` files, scenarios are Arazzo documents,
> documents are Markdown-with-front-matter — while keeping Seebo formulas and Swaft's richer features,
> and offering guided import/export to the wider ecosystem (Postman, Bruno, OpenAPI, cURL, HAR).

---

## 1. Locked decisions

| # | Decision | Source |
|---|----------|--------|
| D1 | **Folder is the source of truth.** A local workspace is a directory of open files; `.swaft` is an **export/import container** (a zip), not the primary store. (Model 1.) | owner |
| D2 | **Hybrid naming:** human-readable, slug-based paths **plus** a stable UUID kept *inside* the files (rename = `git mv`; identity is content-based, not path-based). | owner |
| D3 | **API templates are stored as `.http` files + inline Seebo formulas** — the actual on-disk form in both `local` and `git` folders. | owner |
| D4 | **Export a request** as `.http`, **copy as cURL**, **export as Postman / Bruno**; **export a folder** as a Postman/Bruno **collection**; **import** the same back. | owner |
| D5 | **On export, only if Seebo formulas are present, ask the user how to convert:** (a) variabilize → `{{ }}`, (b) resolve/snapshot the formula value, (c) for inputs (`need`) → promote to environment/collection variables or leave empty. | owner |
| D6 | **Scenarios are stored in the Arazzo standard where possible** (with `x-swaft` extensions for the rest); offer Arazzo **export/import with guided conflict resolution**. | owner |
| D7 | **Documents** → Markdown/standard body + YAML front matter (§9, detailed). Secrets model reworked (§10, detailed). | owner (C2 & 7 confirmed) |

### 1.1 The load-bearing architectural principle (assumed — see §12/A1)

**The canonical *runtime* model stays exactly as today; only the *file* form changes, via a codec in
the projection layer.** Internally an API request is still a `HttpRequestModel`
([`ops.ts:303-318`](packages/shared/src/ops.ts)) held in the `source` column; a scenario is still a
`ScenarioGraph` ([`scenario.ts`](packages/shared/src/scenario.ts)). What changes is how the projection
([`projection.ts`](apps/desktop/src/main/workspace/projection/projection.ts)) reads/writes those to
disk: instead of `source.json`, it runs a **codec** (`HttpRequestModel ⇄ .http`,
`ScenarioGraph ⇄ Arazzo`, document `source ⇄ Markdown+front-matter`).

Why this matters: `ApiView`, the Seebo engine, the send path and its security enforcement, the tab
router — **none change**. The blast radius is confined to the projection's per-type codecs plus the
new adapters/UI. This is what makes the plan tractable.

---

## 2. Target architecture (end state)

```
                     ┌───────────────────────────── source of truth ─────────────────────────────┐
   Swaft UI  ⇄  SQLite working store (cache/index, rebuilt from files)  ⇄  OPEN FOLDER OF FILES
   (ApiView,      (HttpRequestModel / ScenarioGraph                        (.http, .arazzo.yaml,
    Scenario       JSON in `source` — UNCHANGED)          projection        .md+front-matter, .json)
    canvas…)                                              CODECS ↑↓
                                                                            .swaft  =  zip(folder)   ← export/import container
                                                                            adapters ↔ Postman / Bruno / OpenAPI / cURL / HAR / Arazzo / dotenv
```

Three layers, cleanly separated:

1. **Runtime model** (unchanged): `HttpRequestModel`, `ScenarioGraph`, document `source`, env sets.
2. **On-disk open form** (new codecs in the projection): `.http`, Arazzo YAML, Markdown+front-matter,
   canonical JSON — the *source of truth*, git-native, human-readable.
3. **Interchange adapters** (new, pure functions): convert the runtime model ⇄ foreign formats, with a
   **guided Seebo-conversion dialog** and a **fidelity report** (§5, §6).

---

## 3. The on-disk layout (final)

Reuse and extend today's projection tree
([`projection.ts:57-102,238-299`](apps/desktop/src/main/workspace/projection/projection.ts)). Hybrid
naming (D2): directories are `<slug>.<shortId>` so they're browsable *and* rename-stable; the full id
lives inside the file.

```
workspace.json                         # manifest (+ formatVersion, schemaVersion)
settings.json
FORMAT.md                              # NEW: human spec of this layout (points at the JSON Schemas)
schemas/*.schema.json                  # NEW: published JSON Schemas for every file shape
projects/<slug>.<id>.json
folders/<slug>.<id>.json               # name, parent, propagated headers/proxy/auth/actions, notes
tags/<slug>.<id>.json
environments/<name>.env                # NEW form: dotenv (config; non-secret) — see §10
changelog/<id>.json
templates/<slug>.<id>/
    template.json                      # generic metadata: id, name, type, subtype, tags, folder/project,
                                       #   hasDraft + (api only) optional `api` block: structured auth, actions
    request.http                       # API templates (D3): method/url/headers/body + Seebo, info as comments
    scenario.arazzo.yaml               # scenario templates (D6): Arazzo + x-swaft extensions
    content.<ext> + front matter       # document templates (§9): .md/.html/.mmd/… with YAML front matter
    code.js                            # capability/action templates (unchanged, verbatim)
    releases/<version>.<id>.<ext>      # release snapshots, same per-type form as the draft
/.swaft/                               # git-ignored: local-only data (history, receipts, inputs, selections) + DB cache
.secrets.local                         # git-ignored: secret values (or OS keychain) — NEVER committed (§10)
.gitignore .gitattributes
```

`.swaft` file (D1) = a **zip of this folder** (magic marker + `formatVersion`), optionally encrypted;
used only to move/archive a workspace, never the live store.

---

## 4. Workstream 1 — Folder as source of truth; `.swaft` as a container

**Objective (D1):** local workspaces live as the open folder above; `.swaft` becomes export/import.

**Tasks**
- Generalize `WorkspacePersistence`
  ([`WorkspacePersistence.ts:19-31`](apps/desktop/src/main/workspace/persistence/WorkspacePersistence.ts))
  with a **`FolderPersistence`** (folder-backed `local`), reusing `dumpWorkspace`/`hydrateWorkspace`
  ([`projection.ts:114-135`](apps/desktop/src/main/workspace/projection/projection.ts)) verbatim. The
  SQLite store becomes an in-memory cache rebuilt on open (as `GitPersistence.open` already does,
  [`GitPersistence.ts:79-104`](apps/desktop/src/main/workspace/persistence/GitPersistence.ts)).
- Implement **`.swaft` = zip(folder)**: "Export .swaft" zips the folder (+ optional AES, reusing
  [`CryptoService`](apps/desktop/src/main/crypto/CryptoService.ts)); "Open .swaft" unzips to a working
  dir and hydrates. Keep reading **legacy SQLite `.swaft`** via the current `LocalFilePersistence`
  ([`LocalFilePersistence.ts:31-93`](apps/desktop/src/main/workspace/persistence/LocalFilePersistence.ts))
  for back-compat.
- Apply **hybrid naming** (D2): change file/dir naming from `<id>` to `<slug>.<shortId>`; keep the full
  id inside each file; make the loader identify entities by **in-file id**, not path (so renames are
  pure moves). Update `dumpFlat`/`dumpTemplates`/`removeStaleJson`
  ([`projection.ts:205-299,406-419`](apps/desktop/src/main/workspace/projection/projection.ts)).
- Keep **local-only data out of the open tree** (already excluded,
  [`projection.ts:17-21`](apps/desktop/src/main/workspace/projection/projection.ts)) — move it under a
  git-ignored `/.swaft/`.
- **Publish the format:** author `FORMAT.md` + JSON Schemas for every file; govern `FORMAT_VERSION`
  ([`projection.ts:29-30,160-168`](apps/desktop/src/main/workspace/projection/projection.ts)).

**Acceptance**
- Create a local workspace → a readable folder appears; edits produce meaningful diffs; delete = file
  removal. Export `.swaft` → reopen elsewhere → identical workspace. Legacy `.swaft` still opens.
- `FORMAT.md` + schemas validate every emitted file in tests.

---

## 5. Workstream 2 — API templates as `.http` files

**Objective (D3):** the on-disk form of an `api` template is `request.http` + Seebo, with Swaft-only
extras in `template.json`.

### 5.1 The `.http` codec (`HttpRequestModel ⇄ request.http`)
A per-type codec inside the projection. Mapping:

| `HttpRequestModel` | `.http` |
|---|---|
| `method`, `url` | request line `GET https://…` |
| `headers` | `Header: value` lines |
| `query` | folded into the URL query string (URL is already the source of truth, [`ApiView.tsx:66-69`]) |
| `body`, `bodyType` | blank line + body; `Content-Type` header encodes `bodyType` |
| `info` | leading `#` comment lines |
| `auth` **header-expressible** (bearer, apikey-in-header, basic) | rendered as the actual `Authorization`/apikey header |
| `auth` **not header-expressible** (apikey-in-**query**, `inherit`, `secretRef`) | kept in `template.json` `api.auth`; a `# @swaft-auth: …` marker notes it |
| `actions` (pre/post) | kept in `template.json` `api.actions` (no `.http` equivalent) |

**Interpolation (decided A3, §12):** **Seebo is stored verbatim in the `.http`** — `${ env('X') }`,
`${ … }` logic and all — using **one syntax on disk**. No `{{X}}` mapping happens at rest. The
`.http` is still valid `.http` *syntax* (readable, git-native, diffable), but a formula-bearing file
carries Seebo inline, so another REST client would send `${ env('X') }` **literally**. Cross-tool use
therefore goes through **export** (§6.2), where the user chooses whether to translate `env('X') →
{{X}}`, snapshot values, etc. Requests with **no** Seebo are plain `.http` and run verbatim anywhere.
(Trade-off accepted: one uniform on-disk syntax + user-controlled translation at export, instead of a
more-portable-but-dual-syntax file.)

Example `templates/get-order.a1b2/request.http`:
```http
# Fetch one order by id
GET https://${ env('BASE_URL') }/orders/${ orderId }
Authorization: Bearer ${ secret('API_TOKEN') }
Accept: application/json
```
…with `template.json` carrying `{ id, name, type:"api", tags, api?: { auth?, actions? } }`. (Here
`env('BASE_URL')` is config, `orderId` an input, `secret('API_TOKEN')` a keychain secret — see §9;
on export to a foreign tool these become `{{BASE_URL}}` / `{{orderId}}` / `{{API_TOKEN}}` or resolved
values, per the §6.2 dialog.)

### 5.2 Send path & editor — unchanged
`request.http` is parsed to `HttpRequestModel` on load and serialized back on save; everything
downstream (`ApiView`, `ApiRequestService` formula resolution
[`ApiRequestService.ts:81-88`](apps/desktop/src/main/workspace/ApiRequestService.ts), `HttpService`
send + SSRF/blocked-domain enforcement) is untouched. Editing the `.http` by hand and reloading
re-parses it (defensive parse, mirroring `parseRequest` [`ApiView.tsx:62-76`]).

**Acceptance**
- A saved api template is a valid `.http` file another REST client can read; formula-free requests run
  verbatim elsewhere. Round-trip `HttpRequestModel → .http → HttpRequestModel` is lossless (extras via
  `template.json`). Hand-edited `.http` loads; a malformed one degrades gracefully.

---

## 6. Workstream 3 — Interchange adapters + the Seebo-conversion dialog

**Objective (D4/D5):** move requests and collections in and out of the ecosystem, with guided handling
of Seebo.

### 6.1 Adapters (pure, main-process; new session-guarded ops in [`ops.ts`](packages/shared/src/ops.ts))

| Adapter | Direction | Scope | Notes |
|---|---|---|---|
| **cURL** | in / out | request | Paste cURL → request; copy request → cURL. |
| **`.http`** | in / out | request | Already the native form (§5) — "export `.http`" is a file save; import parses a foreign `.http`. |
| **Postman v2.1** | in / out | folder = collection | folders↔items, folder policy↔collection auth/vars ([`folderUpdateRequestSchema`](packages/shared/src/ops.ts)), `env`↔variables. Scripts↔actions best-effort. |
| **Bruno** | in / out | folder = collection | file-per-request DSL; maps almost 1:1 to the folder tree. |
| **OpenAPI 3.1** | **in** (→ templates) | spec → many api templates | One template per operation; `servers` → `BASE_URL` env; reuse [`parseSpec.ts`] to read the spec, add a request generator. Export is lossy (report-only). |
| **HAR 1.2** | out | history | Export `api_history` as HAR. |

### 6.2 The Seebo-conversion dialog (D5)
Triggered **only** when exporting to a foreign format **and** the model contains Seebo beyond a plain
`{{var}}`. The user chooses (globally, with per-formula override):

| Strategy | Behavior |
|---|---|
| **Variabilize → `{{ }}`** | `env('X')`/`${ X }` → `{{X}}`; a declared **input** (`need`/widget) → a `{{id}}` collection variable; other formulas → attempt to variabilize, else fall through to the next choice. |
| **Resolve / snapshot** | Evaluate the formula with the **active environment + saved input values** → a concrete literal. Portable but static. |
| **Inputs (`need`) handling** | For interactive inputs with no value at export: **promote to environment/collection variable** `{{id}}` (empty default) **or leave empty/placeholder** — user's pick. |

**Secrets are never resolved into an exported file** — always emitted as `{{SECRET_NAME}}` variable
placeholders (flagged secret in Postman/Bruno) or omitted (§10).

Every export returns a **fidelity report**: what was variabilized, what was snapshotted, which inputs
became variables, and what was dropped (e.g. pre/post actions with no target-format equivalent). Import
produces the inverse report (e.g. Postman scripts → skipped/stubbed as `action` templates + note).

### 6.3 Collection scope: from where, what's included, what we warn about

This is the reconciliation between Swaft's structure (a workspace of projects → nestable folders →
mixed-type templates) and Postman/Bruno's (a **Collection** = a recursive tree of **requests**).

**Structural mapping.** A Postman/Bruno collection is a recursive tree, so **any Swaft subtree maps to
a collection rooted there.**

| Swaft | Postman | Bruno |
|---|---|---|
| Workspace | one Collection (projects → top-level folders) **or** a bundle of Collections | a set of collection directories |
| Project | a Collection root (its folders → top-level folders) | a collection directory |
| Folder (subtree) | a Collection root, or a sub-folder | a folder (`folder.bru`) |
| Folder HTTP policy (auth / headers / actions / proxy) | collection/folder `auth` + headers/scripts; **proxy not representable** | folder `auth` / `headers` / scripts |
| `api` template | a request `item` | a `.bru` request file |
| `document` / `capability` / `scenario` template | **— skipped** (no request equivalent) | **— skipped** |
| `action` template (pre/post) | pre-request/test **script** (best-effort) | `script:pre-request` / `post-response` (best-effort) |
| tags | request description / metadata (lossy) | Bruno `meta` (lossy) |
| release selection | the **selected** version is exported; other releases/history dropped | same |
| environment (chosen) | a separate environment JSON | `environments/*.bru` |

**Export unit — from any node (recommended).** Offer **"Export as collection ▾ (Postman / Bruno)"** on:
- a **Folder** → that folder + its nested folders/requests become the collection;
- a **Project** → the project is the collection root; its folders become top-level folders;
- the **Workspace** → either **one collection** (projects → top-level folders) **or** a **bundle**
  (one collection per project, zipped) — user's choice (default: **one-per-project bundle**, since
  projects are the natural top-level grouping). See §12/A7.

**Environments are chosen explicitly.** The export dialog shows a **multi-select** of every
environment in scope (workspace + your personal/user ones), so the user picks exactly which to emit as
companion files — none, one, or several. Default selection is the **active** environment. Two rules are
enforced: **user-scoped (personal) environments are opt-in and flagged** (so a shared export doesn't
leak personal config), and **secret-typed variables are exported as `{{NAME}}` placeholders, never as
values** (§9/§6.2).

**Include vs. skip — a pre-export *scope preview*, never a silent drop.** A Swaft folder is a
**superset** of an HTTP collection (it can also hold documents, scenarios, code), so a collection
export is a **projection onto the api subset**. Before writing anything, show a scope preview — this is
the §6.2 fidelity report moved *ahead* of the action, and it is the direct answer to "do we warn that
only API calls are exported?": **yes, explicitly, with counts, and the user proceeds knowingly.**

> Exporting **"Payments"** (project) as a **Postman collection**:
> - **24 API requests** across **6 folders** will be exported.
> - **Skipped** (no collection equivalent): 3 documents, 1 scenario, 2 capabilities.
> - **Partially mapped:** folder **proxy** settings (dropped); **4 pre/post actions** → script stubs;
>   **tags** → descriptions.
> - **Formulas:** 9 requests contain Seebo → conversion: [ Variabilize `{{ }}` ▾ ] (§6.2).
> - **Environments to export** (companion files): [✓] Staging (12) · [ ] Prod (12) · [ ] Local (8)
>   · [ ] *Personal: mine (5)* ⚠
>
> [ Export ]  [ Cancel ]

**Import — the inverse, and additive.** The import dialog lets the user pick **or create** the target
on the fly:
- **New workspace…** — create a brand-new workspace *from* the collection (a fast onboarding path:
  "import this Postman collection → a ready Swaft workspace"). The user picks storage mode
  (local folder / git) and the collection becomes its first project.
- **New project…** or **New folder…** — created as part of the import, named from the collection.
- **Existing project / folder ▾** — import under a node that already exists.

Then: nested folders → nested Swaft folders, requests → `api` templates, collection/folder auth →
folder-propagated policy, variables → a new (or merged) **workspace environment**, scripts →
best-effort `action` stubs + a report. Import **never overwrites** (it creates new entities) and shows
the same scope preview.

**Identity & round-trip.** Export → import preserves *structure and requests* (minus skipped types).
Swaft **ids survive where the format allows**: **Bruno** (file-based, permissive) can carry a
`meta.swaftId`, so a Bruno round-trip can update in place; **Postman v2.1** has no formal extension
slot, so a Postman round-trip creates **new** ids by default (optionally matched by name to update).

**Acceptance**
- "Export as collection" is available on a folder, a project, and the workspace; each shows a **scope
  preview** with request/skip counts before writing.
- The export dialog offers an **explicit multi-select of environments** (default: active; personal
  ones flagged; secrets as placeholders); exporting with none / one / several all work.
- **Import can create its target**: choosing "New workspace" from a Postman/Bruno collection yields a
  ready workspace; "New project"/"New folder" create the target inline; existing nodes also work.
- Export a formula-free collection to Postman/Bruno → re-import → equivalent structure (api subset).
  Export a formula-bearing request → the conversion dialog appears → each strategy yields the
  documented output + a report. cURL in/out and `.http` in/out round-trip. An OpenAPI spec imports into
  a browsable folder of api templates. A workspace with mixed template types exports **only** its api
  requests, and the preview lists exactly what was skipped.

---

## 7. Workstream 4 — Scenarios as Arazzo

**Objective (D6):** store scenarios in the **Arazzo Specification** where possible; export/import Arazzo
with guided conflict resolution.

### 7.1 The Arazzo codec (`ScenarioGraph ⇄ scenario.arazzo.yaml`)

| Swaft (`scenario.ts`) | Arazzo |
|---|---|
| scenario | a `workflow` in `workflows[]` |
| `template` node (api) | a `step` (references the request's `operationId`/`operationPath`) |
| `alias` + `previous('alias').json.x` | step `outputs` + `$steps.alias.outputs.x` runtime expressions |
| `decision` condition (boolean Seebo) | `successCriteria` + `onSuccess`/`onFailure` (`goto`) — Seebo logic under `x-swaft` when not expressible |
| edges / single active path | step order + `onSuccess.goto` targets |
| per-node `inputs` overrides | step `parameters` / `requestBody` |
| **`action` / `capability` / `delay` nodes** | **no native Arazzo concept** → `x-swaft` step extensions |
| canvas node positions | `x-swaft-layout` (ignored by other Arazzo tools) |

Where a scenario uses only api steps + simple criteria, the file is **clean, portable Arazzo**. Where
it uses actions/capabilities/delays or Seebo logic, those live under **`x-swaft-*` extensions** (Arazzo
permits vendor extensions), so the file stays a valid Arazzo document that other tools can partially
read.

### 7.2 Export/import with guided conflict resolution
- **Export** a scenario (or a folder of scenarios + their referenced requests) → an Arazzo doc (+ its
  OpenAPI, generated from the requests). When Swaft-only pieces can't be expressed natively, a
  **guided dialog** lets the user: keep them as `x-swaft` extensions, **snapshot/omit** delays and
  non-HTTP steps, or abort. Same fidelity-report pattern as §6.2.
- **Import** an Arazzo doc → a scenario graph (+ api templates for referenced operations), resolving
  the same conflicts in reverse (unmapped constructs → a report; positions auto-laid-out if absent).

**Acceptance**
- A pure-HTTP scenario round-trips through clean Arazzo and is readable by an external Arazzo tool. A
  scenario with an action/decision round-trips through Swaft losslessly via `x-swaft` and surfaces a
  clear report on foreign export.

---

## 8. Workstream 5 — Documents as Markdown + front matter (detail of C2)

**Objective:** make a document template a single, portable, open file.

**Design**
- The document body already *is* the standard artifact per subtype: **CommonMark** (`markdown`), HTML,
  **Mermaid** (`.mmd`), **ECharts option JSON**, **OpenAPI/Swagger** YAML
  ([`SUBTYPES`](packages/shared/src/ops.ts), [`sourceExtension`](apps/desktop/src/main/workspace/projection/projection.ts)).
- Move the template metadata that currently sits in `template.json` (id, name, subtype, tags) into a
  **YAML front-matter block** at the top of the body file (the Jekyll/Hugo/Obsidian convention), so a
  document is **one file** you can open anywhere:
  ```markdown
  ---
  swaftId: 7f3a…
  name: Release notes
  type: document
  subtype: markdown
  tags: [ops, template]
  ---
  # Release ${ textbox({ id: 'version', label: 'Version' }) }
  …
  ```
- **Seebo formulas stay inline in the body.** They degrade gracefully — a non-Swaft Markdown viewer
  renders `${ … }` as literal text. Document the widget vocabulary in `FORMAT.md` so others *could*
  interpret inputs, but don't require it.
- **Front matter is only for document types**; api/scenario/code keep their dedicated forms (§5/§7 and
  verbatim `code.js`). Front-matter parsing must be defensive (missing/oversized block → treat body as
  content, mirroring the projection's tolerant JSON reads).

**Acceptance**
- A markdown document is a single `.md` file with front matter, editable in any editor, that
  re-imports losslessly; other subtypes are their native standard file + front matter.

---

## 9. Workstream 6 — Secrets & the config/secret split (detail of §7-old / point 7)

**Why now:** opening the folder (D1) makes committing plaintext dangerous. Today the only
"never-in-files" secret path is the legacy `auth.secretRef` → OS keychain
([`HttpService.ts:114-133`](apps/desktop/src/main/http/HttpService.ts),
[`SecretService.ts:9-13`](apps/desktop/src/main/secret/SecretService.ts)), while modern formula auth
pushes secrets into **plaintext env vars** ([`environments/*`](apps/desktop/src/main/workspace/projection/projection.ts)).

**Design**
1. **A first-class `secret('NAME')` data capability**, resolved from the OS keychain (never written to
   any file), usable anywhere a formula is — the safe replacement for "put the token in an env var".
   Registered alongside `env`/`template`/`previous` in
   [`DATA_CAPABILITIES`](packages/shared/src/ops.ts); resolved in the main process only (like
   `secretRef` today), so the renderer never sees values.
2. **Explicit config-vs-secret split (dotenv convention):**
   - **Config** = non-secret, versioned. Environments export/store as **`environments/<name>.env`**
     (committed) and are read by `env('K')`/`${ K }`.
   - **Secret** = never versioned. Values live in the **OS keychain** (default) and/or a git-ignored
     **`.secrets.local`** (dotenv form, for portability), referenced only by name via `secret('K')`.
   - The UI labels each variable **config** or **secret** (mirrors Postman's `default`/`secret` types);
     a secret can never be moved into a committed file without an explicit, warned action.
3. **A pre-write / pre-commit secret scan:** before writing the open folder (or on `git.commit`), scan
   for probable secret literals (high-entropy strings, literal `Authorization:` values) and refuse /
   warn, pointing at `secret(...)`. Reuse the existing redaction discipline already applied to
   receipts/history.
4. **Migration:** existing `auth.secretRef` values keep working (already the fallback path,
   [`HttpService.ts:116`](apps/desktop/src/main/http/HttpService.ts)); offer a one-click "convert
   secretRef → `secret('NAME')`".
5. **Export interaction:** secrets are **never** resolved into an exported file; they become
   `{{SECRET_NAME}}` placeholders (flagged secret) or are omitted, with a report line (§6.2).

**Acceptance**
- A workspace can be fully committed to a public repo with **no secret value** in any file (verified by
  the scan in tests). `secret('X')` resolves at send time; the renderer never receives it. Legacy
  `secretRef` still sends; conversion works.

---

## 10. Cross-cutting impact

| Area | Impact | Notes |
|---|---|---|
| **Projection codecs** | Medium–High | New per-type codecs (`.http`, Arazzo, Markdown+front-matter) inside the existing dump/hydrate; the rest of the projection is reused. |
| **Persistence** | Medium | `FolderPersistence` for `local`; `.swaft` zip container; legacy SQLite read path retained. |
| **Runtime model** | **None** | `HttpRequestModel`/`ScenarioGraph`/document `source` unchanged (§1.1) — the key blast-radius limiter. |
| **Shared contract (`ops.ts`)** | Medium | New ops: `collection.import/export`, `request.import/export` (curl/http), `openapi.import`, `arazzo.import/export`, `env.import/export`; DTOs for **fidelity reports**. New `secret('…')` capability + `DATA_CAPABILITIES` entry. |
| **Adapters (new code)** | Medium–High | Pure converters + the conversion-dialog logic + reports. Reuse `parseSpec` for OpenAPI. |
| **Secrets/security** | Medium (critical) | `secret()`, config/secret split, pre-write scan — must land **before** folder-local is committed anywhere (Phase order below). |
| **UI** | Medium | "Export as ▾" (request/folder/scenario), import dialog, the **Seebo-conversion dialog** + report modal, config/secret labels, "open folder" affordance. |
| **Back-compat / migration** | Medium | Legacy SQLite `.swaft` opens; existing git workspaces migrate `source.json`→`.http`/Arazzo on first save (behind `FORMAT_VERSION` bump + a documented migration). New folder-local is opt-in at creation (storage mode is immutable, [`WorkspaceService.ts`](apps/desktop/src/main/workspace/WorkspaceService.ts)). |
| **Performance** | Low–Medium | Many small files vs one blob (fine for Git; batch writes as the projection already does). Adapters run off the send path. |
| **Testing** | Medium–High | Golden-file round-trip tests per codec/adapter (import→export→import stable; documented losses asserted); the secret scan; mirror the projection's existing DB⇄files inverse tests. |
| **Docs** | Low | `FORMAT.md`, an "Import/Export" guide page, a "Config vs Secrets" guide page in the published site. |

**Unchanged:** the Seebo engine, the send path + SSRF/blocked-domain/enforced-header enforcement, the
sandbox, the transport/IPC allow-list (adapters are ordinary session-guarded ops).

---

## 11. Phased delivery

Each phase is independently shippable and test-gated. Ordered to derisk security first and to land the
owner's headline asks early.

- **Phase 0 — Specify the format (no behavior change).** `FORMAT.md` + JSON Schemas for the *current*
  projection shapes; document/govern `FORMAT_VERSION`. Pure documentation of what already exists.
- **Phase 1 — Secrets split + cURL + `.http` I/O.** `secret('NAME')`, config/secret labels,
  pre-write scan (§9); cURL import/export; `.http` import/export of a single request. **High value,
  low risk, closes the security gap before anything is committed.**
- **Phase 2 — API templates natively `.http`.** The `.http` codec in the projection (§5); requests on
  disk become `request.http` + `template.json` `api` block. Migrate existing git workspaces on save.
- **Phase 3 — Folder-as-truth for local + `.swaft` container.** `FolderPersistence`, hybrid naming,
  `.swaft` = zip, legacy read path (§4).
- **Phase 4 — Collections: Postman & Bruno + OpenAPI import.** Folder ⇄ Postman/Bruno with the
  conversion dialog + reports (§6); OpenAPI 3.1 import → api templates; `.env` env I/O.
- **Phase 5 — Scenarios as Arazzo + HAR.** Arazzo codec + export/import with guided conflict
  resolution (§7); HAR history export.
- **Phase 6 — Documents as front matter.** Markdown+front-matter form for document templates (§8).

**Ship-first:** Phase 0 + Phase 1 (small, derisks secrets, delivers a visible "save/share an API call
in an open format" win) — then Phase 2/3 for the folder-native vision.

---

## 12. Open decisions for you

These are the residual calls I made to keep the plan concrete; flag any you want changed.

| # | Decision I assumed | Alternative |
|---|---|---|
| **A1** | **Runtime model stays canonical; only the file form changes via codecs** (§1.1) — minimal blast radius. | Make `.http`/Arazzo the *in-memory* truth too (bigger rewrite of `ApiView`/engine wiring; not recommended). |
| **A2** | **`.http` + `template.json` `api` block** for the bits `.http` can't hold (structured auth, pre/post actions). | Single `.http` with `# @swaft-*` structured comments (one file, but pollutes it and is harder to parse). |
| **A3** ✔ decided | **Store Seebo verbatim** (`${ env('X') }`, `${ … }`) in the `.http` — one on-disk syntax; the `env('X') → {{X}}` translation is offered **only at export** (§6.2). | *(Rejected: writing `{{X}}` at rest for portability — adds a second syntax and an un-mapping step on load.)* |
| **A4** | **Arazzo + `x-swaft` extensions** as the stored scenario form (D6 "where possible"). | Keep native `ScenarioGraph` JSON canonical and treat Arazzo as import/export only (safer, but not "stored as Arazzo"). |
| **A5** | **Documents: front matter replaces `template.json`** for document types (single file). | Keep a separate `template.json` for documents too (uniform with other types, but two files). |
| **A6** | **Secrets default to the OS keychain**, `.secrets.local` (git-ignored dotenv) as a portable option. | Keychain-only (more secure, less portable between machines). |
| **A7** | **Workspace → collection export defaults to a one-per-project bundle** (§6.3); folder/project export a single collection. | One flat collection for the whole workspace (projects → top-level folders). |

---

## 13. Glossary of the standards

- **`.http` / `.rest` file** — plain-text request format (VS Code REST Client, JetBrains HTTP Client);
  `{{var}}` interpolation, `# @name`, `###` separators. The native on-disk form for Swaft requests.
- **Postman Collection v2.1** — the de-facto JSON interchange for a collection of saved requests
  (folders, auth, variables, pre-request/test scripts). Imported by nearly every API tool.
- **Bruno / `.bru`** — open-source, **file-per-request**, git-native collection format (plain-text DSL
  + `bruno.json`).
- **OpenAPI 3.1** — the standard for *describing* an HTTP API (paths, operations, schemas, security,
  servers), built on JSON Schema 2020-12. Import source, not a store of saved calls.
- **Arazzo Specification 1.0** — the OpenAPI Initiative standard for *API workflows* (steps, outputs,
  success criteria, branching, `$` runtime expressions). The open counterpart of Swaft scenarios.
- **HAR 1.2** — JSON log of HTTP requests/responses ("HTTP Archive"); for captured traffic/history.
- **dotenv (`.env`)** — `KEY=value` files; the standard config/secret split is `.env` (committed) vs
  `.env.local` (git-ignored secrets).
- **CommonMark** — the standardized Markdown spec.
- **YAML front matter** — a `---`-delimited metadata block at the top of a text file (Jekyll/Hugo/
  Obsidian convention) used to attach type/tags/id to a document.
- **JSON Schema 2020-12** — used by OpenAPI and to **publish/validate Swaft's own file shapes** so the
  native format is itself open.
- **OPC / Zip container** — the "documented zip of open files" pattern behind `.docx`/`.xlsx`/`.epub`;
  the model for `.swaft`.
```
