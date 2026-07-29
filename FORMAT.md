# Swaft workspace on-disk format

This document specifies the **open, on-disk form** of a Swaft workspace: a directory of plain,
human-readable, git-friendly files. It is the format the app reads and writes for **folder-backed
local** workspaces and **git** workspaces, and the same tree is what a **`.swaft` container** (a zip)
holds. One format, three storage forms.

The machine-checkable contracts for each JSON file live next to the projection code, under
[`apps/desktop/src/main/workspace/projection/schemas/`](apps/desktop/src/main/workspace/projection/schemas)
(JSON Schema, draft-07). A test validates every emitted file against these schemas, so this spec and
the code cannot silently drift.

> The runtime model is unchanged by this format. `HttpRequestModel` / `ScenarioGraph` remain canonical
> in the working store; the files are a projection produced by codecs. Reading a workspace rebuilds an
> in-memory SQLite cache from these files; saving writes them back.

---

## 1. Directory layout

```
workspace.json                          # manifest: formatVersion, schemaVersion, name, icon, executionMode
settings.json                           # workspace settings (execution mode, blocked domains, enforced headers, proxy, batcher)
projects/<slug>.<shortId>.json          # one file per project
folders/<slug>.<shortId>.json           # one file per folder (name, parent, propagated headers/proxy/auth/actions, notes)
tags/<slug>.<shortId>.json              # one file per tag
environments/<slug>.<shortId>.json      # one file per environment (vars + which keys are labeled secret; literal secret values are never stored here)
environments/<slug>.<shortId>.env       # write-only dotenv mirror of the same vars, minus secret-labeled ones; regenerated on save, never read back
changelog/<slug>.<shortId>.json         # one file per changelog entry
templates/<slug>.<shortId>/             # one directory per template
    template.json                       # metadata: id, name, type, subtype, folder/project, tags, hasDraft, (api only) `api` block
    request.http                        # api templates: method/url/headers/body + Seebo, info as `#` comments
    scenario.arazzo.yaml                # scenario templates: an Arazzo 1.0 workflow document, Swaft-only bits under `x-swaft`
    source.<ext>                        # other template types: verbatim editable body (e.g. .md, .js, .yaml)
    releases/v<version>.<shortId>.json  # published release snapshots
.gitignore  .gitattributes              # keep local caches / OS cruft out; normalize line endings to LF
```

A `.swaft` **container** is a zip of exactly this tree (see [§6](#6-the-swaft-container)).

---

## 2. Hybrid naming

Files and directories are named `<slug>.<shortId>`:

- **`slug`** — a filesystem-safe, lowercase, dash-separated form of the entity's name (e.g. `Get user`
  → `get-user`), capped in length, falling back to `untitled` for name-less input.
- **`shortId`** — the first 8 hex-ish characters of the entity's canonical id (dashes stripped).

The name is a convenience for browsing and diffs; **identity is content-based**. The canonical id lives
**inside** the file (`id`), and the loader keys off that, never the path. Consequences:

- Renaming an entity is a **pure move** (a new `<slug>.<shortId>` file, old one removed) — the id is
  unchanged, so history follows the content.
- Two entities can never collide (distinct ids → distinct short ids).
- Legacy `<id>.json` files (written by older versions) still load — the loader ignores the file name.

Naming is deterministic (no clock, no randomness): the same working store always dumps to the same
names, for reproducible diffs.

---

## 3. JSON file shapes

All JSON is **canonical**: keys sorted, two-space indented, one trailing newline. JSON-config columns
are inlined as real nested JSON (not escaped strings), and 0/1 flags are emitted as booleans.

| File | Schema |
|---|---|
| `workspace.json` | [`workspace.schema.json`](apps/desktop/src/main/workspace/projection/schemas/workspace.schema.json) |
| `settings.json` | [`settings.schema.json`](apps/desktop/src/main/workspace/projection/schemas/settings.schema.json) |
| `projects/*.json` | [`project.schema.json`](apps/desktop/src/main/workspace/projection/schemas/project.schema.json) |
| `folders/*.json` | [`folder.schema.json`](apps/desktop/src/main/workspace/projection/schemas/folder.schema.json) |
| `tags/*.json` | [`tag.schema.json`](apps/desktop/src/main/workspace/projection/schemas/tag.schema.json) |
| `environments/*.json` | [`environment.schema.json`](apps/desktop/src/main/workspace/projection/schemas/environment.schema.json) |
| `changelog/*.json` | [`changelog.schema.json`](apps/desktop/src/main/workspace/projection/schemas/changelog.schema.json) |
| `templates/*/template.json` | [`template.schema.json`](apps/desktop/src/main/workspace/projection/schemas/template.schema.json) |
| `templates/*/releases/*.json` | [`release.schema.json`](apps/desktop/src/main/workspace/projection/schemas/release.schema.json) |

---

## 4. Templates

A template directory always has a `template.json` (generic metadata) plus a **body file** whose form
depends on the template `type`:

- **`api`** → **`request.http`**, a standard [`.http`](https://learn.microsoft.com/aspnet/core/test/http-files)
  file: the request line, header lines, a blank line then the body, with the `info` note as leading
  `#` comments. The `Content-Type` header encodes `bodyType`. Header-expressible auth (bearer,
  api-key-in-header, basic) is rendered as the actual header; parts `.http` cannot carry — structured
  auth (api-key-in-**query**, `inherit`, `secretRef`) and pre/post **actions** — live in the
  `template.json` `api` block.
- **`scenario`** → **`scenario.arazzo.yaml`**, an [Arazzo 1.0](https://spec.openapis.org/arazzo/latest.html)
  workflow document: the graph's nodes become `steps`, edges become `onSuccess`/`onFailure` `goto`s. An
  `api`-typed node gets a best-effort native `operationId` hint. Everything Arazzo has no native concept
  for — non-HTTP nodes (action/capability/delay), decision branches, breakpoints, Seebo conditions,
  canvas positions — lives under **`x-swaft`** extensions on the workflow/step, so the round-trip is
  lossless while the document stays a valid Arazzo file another tool can partially read.
- **`document`** → **`source.<ext>`** with a **YAML front-matter** header prepended
  (`swaftId`/`name`/`type`/`subtype`/`tags`, the [Jekyll/Hugo/Obsidian](https://jekyllrb.com/docs/front-matter/)
  convention) — the file is self-describing when opened directly by another tool. `template.json` stays
  the source of truth for those fields; the header is a write-only mirror, tolerantly stripped back out
  on hydrate (a file with no, or a malformed, header just has an empty header — the whole file is body).
- **all other types** → **`source.<ext>`**, the editable body written verbatim with a type-appropriate
  extension (`.md`, `.html`, `.js`, `.yaml`, …). The extension is cosmetic; content is byte-for-byte.

### Interpolation — Seebo is stored verbatim

Seebo formulas (`${ env('X') }`, `${ secret('API_TOKEN') }`, `${ orderId }`, and full `${ … }` logic)
are stored **as-is** in `request.http` — one syntax on disk. A request with no formulas is plain,
portable `.http` that any REST client runs unchanged. A formula-bearing file is still valid `.http`
*syntax*, but another tool would send `${ … }` literally; cross-tool portability goes through **export**
(Postman / Bruno / `.http`), where you choose whether to translate `env('X') → {{X}}`, snapshot values,
etc. Secrets are never materialized to files.

---

## 5. Versioning

`workspace.json` carries two integers:

- **`formatVersion`** — the on-disk file *shapes*. Current: **4** (document templates get a YAML
  front-matter header on their `source.<ext>`; v3 added scenario templates as `scenario.arazzo.yaml`; v2
  added api templates as `request.http` + `api` block; earlier versions stored api/scenario sources as
  `source.json` and still load, upgraded on the next save). Front matter is read tolerantly regardless
  of `formatVersion` — an older document file with no header just parses as a header-less body.
- **`schemaVersion`** — the working-store schema. Opening a workspace whose `schemaVersion` is newer
  than the app supports is refused (`SCHEMA_TOO_NEW`) rather than risking a lossy downgrade.

### Not written to the files (regenerated on load)

- **sync metadata** — `created_at`, `updated_at`, `updated_by_device_id`, `revision`, `deleted_at`
  (git/history provide this; committing it would only add churn). Soft-deleted rows are omitted, so a
  delete surfaces as a file removal.
- **`storage_mode` / `device_id`** — environment-supplied, not versioned.
- **local-only data** — request/run history, receipts, input state, selections — never versioned.

---

## 6. The `.swaft` container

A `.swaft` file is a **zip of the tree above** — a portable, single-file way to move or archive a
workspace, **not** the live store. It can be wrapped in whole-file **AES-256-GCM** encryption (key
derived from a password via Argon2id) for at-rest protection.

Opening a `.swaft` zip unpacks it to a sibling folder and opens that as a folder-backed workspace.
Because the archive is a standard zip (store method, UTF-8 names), any unzip tool can read it. A legacy
single-file `.swaft` (a raw SQLite image, optionally encrypted) still opens directly.
