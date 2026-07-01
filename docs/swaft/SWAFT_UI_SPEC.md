# Swaft — UI Specification

> **Status:** Implementation-oriented UI specification.
> **Source of truth:** [`init.md`](init.md). Elaborations are marked **Recommended**; undecided
> items **Open decision**.
> **Audience:** Frontend engineers, product designers.
> **Companions:** [`SWAFT_PRODUCT_SPEC.md`](SWAFT_PRODUCT_SPEC.md), [`SWAFT_ARCHITECTURE.md`](SWAFT_ARCHITECTURE.md).

---

## 1. Navigation Model

### 1.1 Top-Level Surfaces

| Surface | Purpose |
|---------|---------|
| **Auth (sign-up / sign-in)** | **Gate** before the app is usable; first run = sign-up, later = sign-in; sign-out/lock. |
| **Homepage** | Entry point after sign-in: recent/open workspaces, create-workspace, open `.swaft` file. |
| **Create Workspace Wizard** | Guided creation; storage mode, encryption, execution mode. |
| **Workspace Shell** | The main working surface once a workspace is open. |

> **Auth gate:** the app is **not usable until signed in** (X-9 / AUTH-1). The renderer shows only
> the Auth surface until the main process establishes a session; all other surfaces are unreachable
> beforehand. See §2a.

### 1.2 Invariant: View Determined by Template Type

```
 Open template ──► inspect type ──► select right-hand view
        type = document  ─► Document View (Input Panel + Main Document View + optional Action Panel)
        type = api       ─► API View
        type = render    ─► Render View
 Database View is opened from a DB connection, not from a template.
```

| ID | Navigation rule |
|----|-----------------|
| **NAV-1** | The **Working Tree is common to all layouts and always visible** in the Workspace Shell. |
| **NAV-2** | The right-hand view changes **based on the opened template's type** only. |
| **NAV-3** | Opening a `document` template shows the Document View; `api` shows the API View; `render` shows the Render View. |
| **NAV-4** | The Database View is reached via a database connection (not a template type). |
| **NAV-5** | The Batcher is a separate transient surface launched from the workspace (document templates only). |

---

## 2a. Authentication Screens

The app is gated by a sign-in screen. (Extends `init.md`; local account in MVP.)

### 2a.1 Screens

| Screen | When | Fields / actions |
|--------|------|------------------|
| **Sign-up** | First run (no account yet). | Email/username, display name, password, confirm password; password-strength feedback; create account. |
| **Sign-in** | An account exists, no active session. | Email/username, password; sign in; error on bad credentials (generic, no user-enumeration). |
| **Locked** | Session locked (inactivity/manual). | Re-enter password to unlock; sign out. |

### 2a.2 Behavior

| ID | Rule |
|----|------|
| **AUTHUI-1** | Until a session is active, only the Auth surface is shown; no workspace/tree/views are reachable. |
| **AUTHUI-2** | Passwords are entered in the renderer but verified in the main process; the renderer never receives the verifier or derived keys. |
| **AUTHUI-3** | Sign-in errors are generic ("invalid credentials"); repeated failures show lockout/back-off messaging (no enumeration of valid accounts). |
| **AUTHUI-4** | Sign-out and **Lock** are available from the workspace header/profile (§5, §19). |
| **AUTHUI-5** *(Recommended)* | Inactivity auto-locks to the Locked screen; unlocking requires the password. |
| **AUTHUI-6** | Account auth is distinct from workspace encryption: unlocking the app does **not** decrypt an encrypted workspace (still prompts its own password). |

> SSO/OIDC and MFA screens are **future** ([`NEXT_STEPS.md`](NEXT_STEPS.md)); the Auth surface is
> designed to accommodate additional methods without restructuring.

---

## 2. Homepage

### 2.1 Content

| Element | Behavior |
|---------|----------|
| Recent workspaces | List of recently opened `.swaft` workspaces (local paths/labels). |
| Open workspace | Native file dialog to open a `.swaft` file. |
| Create workspace | Launches the Create Workspace Wizard. |
| Encrypted-workspace indicator | Shows which recent workspaces are encrypted (lock badge). |

### 2.2 States

| State | UI |
|-------|----|
| Empty (no recent) | Empty state with "Create workspace" and "Open workspace" calls to action. |
| Opening encrypted | Password prompt; explicit warning that loss of password = unrecoverable. |
| Open error | Error state: file missing, corrupt, wrong password, unsupported schema version. |

---

## 3. Create Workspace Wizard

### 3.1 Steps

| Step | Field(s) | Notes |
|------|----------|-------|
| 1. Identity | Workspace name | Required. |
| 2. Storage mode | `local` \| `p2p` \| `server` | **Immutable after creation** — wizard must state this clearly. MVP enables `local`; `p2p`/`server` shown as **future/disabled** (Recommended). |
| 3. Encryption | Optional whole-file encryption + password/key | Must warn: **lost password/key ⇒ unrecoverable, no backdoor**. |
| 4. Execution mode | `sandbox` (default) \| `dev` | Default `sandbox`; entering `dev` may require confirmation (OD). |
| 5. Location | Target `.swaft` file path | Native save dialog. |
| 6. Review | Summary | Confirms immutable storage mode before creation. |

### 3.2 Rules

| ID | Rule |
|----|------|
| **CW-1** | Storage mode is selected once and is immutable; the wizard must surface this prominently. |
| **CW-2** | If encryption is enabled, the unrecoverability warning must be acknowledged before proceeding. |
| **CW-3** | The wizard must not offer a "change storage mode later" affordance. |
| **CW-4** *(Recommended)* | `p2p`/`server` appear as disabled/"coming soon" in MVP to preserve the model without enabling unfinished flows. |

---

## 4. Workspace Shell

### 4.1 Layout

```
┌───────────────────────────────────────────────────────────────────────┐
│  Workspace Header  (name · execution mode · settings · profile · batcher) │
├───────────────┬───────────────────────────────────────────────────────┤
│               │                                                       │
│  Working Tree │              Right-hand View Area                     │
│  (always      │   (Document View | API View | Render View |           │
│   visible)    │    Database View | Editor | Batcher)                   │
│               │                                                       │
│   projects    │                                                       │
│   folders     │                                                       │
│   templates   │                                                       │
│   3-dot menus │                                                       │
│               │                                                       │
├───────────────┴───────────────────────────────────────────────────────┤
│  Status / feedback area (persistence, execution, blocked-operation notices)│
└───────────────────────────────────────────────────────────────────────┘
```

| ID | Rule |
|----|------|
| **WSH-1** | The Working Tree pane is **always present** regardless of the selected view. |
| **WSH-2** | The right-hand area hosts exactly one active view at a time. |
| **WSH-3** | Persistence and execution operations give clear feedback (saved, rendering, executing, blocked). |

---

## 5. Workspace Header

| Element | Behavior |
|---------|----------|
| Workspace name | Display; (Recommended) inline rename via edit affordance. |
| Execution-mode indicator | Shows `sandbox`/`dev`; entering `dev` is visually distinct and may require confirmation (OD-4). |
| Encryption indicator | Lock badge when whole-file encryption is active. |
| Settings | Opens Workspace Settings. |
| Profile / Account | Opens local profile / preferences; shows signed-in account; **Lock** and **Sign out** actions (§2a). |
| Batcher | Opens the Batcher (document templates only). |
| Storage-mode indicator | Shows `local`/`p2p`/`server` (read-only; immutable). |

---

## 6. Working Tree

### 6.1 Behavior

| ID | Rule |
|----|------|
| **WT-1** | Always visible; common to all layouts. |
| **WT-2** | Navigates projects, folders, templates and related entities. |
| **WT-3** | Exposes template and folder context actions. |
| **WT-4** | Projects filter the tree (macro-folders); folders group templates (HTTP collections for API). |
| **WT-5** | Selecting a template opens the type-appropriate view (NAV-3). |

### 6.2 Visual Encoding (Recommended)

| Encoding | Meaning |
|----------|---------|
| Icon per type | document / api / render distinguishable at a glance. |
| API method badge | API templates show their method (GET/POST/…). |
| Release indicator | Shows selected release (or "draft"/"latest") per template. |
| Tag chips | Optional tag display/filter. |

---

## 7. Template Context Menu (Working Tree three-dot)

From `init.md` §10.2, the context menu **must** include:

| Item | Behavior |
|------|----------|
| **Open** | Opens the template in its type-appropriate view. |
| **Edit** | Opens the Template Editor. |
| **Rename** | Inline/dialog rename. |
| **Clone** | Duplicates the template (new id; draft copied). |
| **Delete** | Deletes (Recommended: tombstone for synced data; confirmation required). |
| **Select release** | Opens release selection (personal, local-only) — see §17. |

| ID | Rule |
|----|------|
| **CTX-1** | "Select release" sets a **personal, local-only, non-synchronized** selection. |
| **CTX-2** | Destructive items (Delete) require confirmation. |

---

## 8. Folder Context Menu

*(Recommended — `init.md` specifies the template context menu explicitly; folder menu is inferred.)*

| Item | Behavior |
|------|----------|
| New template | Create a template inside the folder (type chosen on creation). |
| New subfolder | Create a nested folder. |
| Rename | Rename folder. |
| Delete | Delete folder (confirmation; defines handling of contained templates). |
| Mark as HTTP collection | For folders grouping API templates (Recommended). |

> **Open decision (OD-UI-1):** Folder deletion semantics for contained templates (cascade vs.
> reparent). Recommended: block deletion of non-empty folders or require explicit cascade confirmation.

---

## 9. Document View

Composition (from `init.md` §11.2): **Input Panel + Main Document View + optional Action Panel**.

```
┌──────────────┬───────────────────────────────┬───────────────────────────┐
│ Input Panel  │     Main Document View        │  Action Panel (optional)  │
│              │                               │                           │
│ requirement  │  rendered document output     │  shown ONLY when render    │
│ fields       │  (Seebo rendering)            │  produces ≥1 action        │
│ (typed)      │                               │                           │
│ last-input   │                               │  per-action confirm        │
│ prefilled    │                               │  Perform all (fail-fast)   │
│              │                               │  receipts entry point      │
└──────────────┴───────────────────────────────┴───────────────────────────┘
```

| ID | Rule |
|----|------|
| **DV-1** | The Input Panel and Main Document View are always present in Document View. |
| **DV-2** | The Action Panel is shown **only when rendering produces actions**; if zero actions, it is **not rendered at all**. |
| **DV-3** | Actions never execute automatically; explicit confirmation is required (see §12). |

### 9.1 Input Panel

The Input Panel renders a **list of input objects** derived from the template's declared inputs.
Each input is a Seebo `require({ id, type, capability })`; the **`capability` selects the input
widget** that the frontend renders (see §9.1.1). The user fills these widgets to provide the values
needed to render the template.

| Aspect | Behavior |
|--------|----------|
| Source of fields | Generated from Seebo `analyze(template).requirements`. Each requirement carries `id`, `type`, `capability`, `label?`, `description?`, `optional?`, and `options?` (from `type.constraints.values`). |
| Widget selection | The requirement's **`capability`** maps to a **Swaft input widget** via the Input Widget Catalog (§9.1.1). The `type` and `options` refine the widget (e.g. value coercion, select choices). |
| Field list | The panel builds an ordered list of input objects, one per requirement, each rendered by its mapped widget. |
| Last input values | Pre-filled from local-only stored values per template; updated as the user edits. |
| Persistence | On change/submit, last input values are saved locally (not synchronized). |
| Secret-bound inputs | Inputs bound to secret capabilities reference secrets; their values are not persisted in clear (Recommended). |
| Render trigger | Explicit render/apply (Recommended) or live re-render within limits. |

| ID | Rule |
|----|------|
| **IP-1** | Every document template persists last input values locally. |
| **IP-2** | The Input Panel reflects the selected release's requirements. |
| **IP-3** | The Input Panel builds a list of input objects from the template requirements; the widget for each input is determined by the requirement's **capability**, not inferred from the type alone. |
| **IP-4** | Input widgets are **interactive Seebo capabilities**: at render time they are returned to the UI via `stopOn`, the user supplies values, and resolution resumes (the Seebo multi-turn pattern). |
| **IP-5** | A requirement whose capability is unknown to the catalog falls back to a default widget by type (Recommended: textbox for `string`, number for `int`/`float`, boolean toggle for `bool`, JSON input for `object`/`array`). |

#### 9.1.1 Input Widget Catalog (Swaft input capabilities)

Swaft defines a catalog of **input capabilities**, each representing one frontend input widget. An
author chooses the capability per input when editing a template; the Input Panel renders the matching
widget. (Capability **names** below are **Recommended**; the *mechanism* — capability-driven widgets —
is a consolidated decision.)

| Capability (Recommended name) | Widget | Typical Seebo `type` | Notes |
|-------------------------------|--------|----------------------|-------|
| `textbox` | Single-line text field | `string` | Default for free text. |
| `textarea` | Multi-line text area | `string` | For long text. |
| `number` | Numeric input (with step) | `int` / `float` | Coerces to numeric type. |
| `boolean` | Toggle / checkbox | `bool` | True/false. |
| `listbox` | Single-select dropdown | `string` (+ constraint values) | Choices from `options` (`type.constraints.values`). |
| `multiOption` | Multi-select list | `array` (+ constraint values) | Multiple choices from `options`. |
| `jsonInput` | JSON editor with **+ import** button and **drag-and-drop** | `object` / `array` | Import from file or drop a file; validated as JSON. |
| `datetime` | Date / time picker | `datetime` | Locale-aware (§23.4). |
| `duration` | Duration input | `duration` | |

| ID | Rule |
|----|------|
| **IW-1** | Each input capability maps to exactly one widget; the Input Panel selects the widget by capability. |
| **IW-2** | `listbox` / `multiOption` derive their choices from the requirement's `options` (Seebo `type.constraints.values`). |
| **IW-3** | `jsonInput` provides import (button) and drag-and-drop of a file, and validates the result as JSON before use. |
| **IW-4** | The input-capability set is registered in the backend Seebo host and is part of the workspace **allowed capabilities** (Recommended: the input capabilities are allowed by default). |
| **IW-5** *(Recommended)* | The widget catalog is extensible: new input capabilities can be added by registering a capability + a frontend widget, without changing the Input Panel contract. |

> **Authoring:** which capability an input uses is part of the **template definition** (the
> `require(...)` in the document template / API/render where applicable), set in the Template Editor
> (§16). See [`SWAFT_ARCHITECTURE.md`](SWAFT_ARCHITECTURE.md) §8 for the engine-side wiring and
> [`SWAFT_DATA_MODEL.md`](SWAFT_DATA_MODEL.md) §7 for where it lives in the model.

### 9.2 Main Document View

| Aspect | Behavior |
|--------|----------|
| Output | Rendered document from the backend Seebo render. |
| Format | Per document subtype (html/markdown/eml/csv/json/xml/yaml/txt/code/plain). |
| Errors | Seebo diagnostics (with positions/codes) surfaced clearly (see §15). |
| Waiting | If rendering is waiting on interactive input, the pending requirements drive the Input Panel. |

### 9.3 Action Panel

| Aspect | Behavior |
|--------|----------|
| Visibility | Only when the render produced ≥1 action. |
| Per-action display | Action id/type/environment, required confirmation, derived input summary (redacted). |
| Confirmation | Each action requires explicit confirmation before execution. |
| Perform all | Executes confirmed actions in document order, **fail-fast** (stops at first error; remaining not executed). |
| Failure surfacing | The failing action and error are clearly shown. |
| Receipts | After execution, receipts are displayed (see §13). |

---

## 10. Action Badges

*(Recommended visual language for actions.)*

| Badge / state | Meaning |
|---------------|---------|
| **Needs input (blocked)** | An action input requirement is unresolved (Seebo `blocked`). |
| **Ready** | All inputs resolved; executable. |
| **Needs confirmation** | `confirm: true` or policy requires confirmation. |
| **Succeeded** | Executed successfully (receipt available). |
| **Failed** | Execution failed (error in receipt). |
| **Skipped** | Not executed (e.g. policy denied, unconfirmed in a Perform all). |
| **Blocked by sandbox** | Action type/environment denied by execution mode. |

> Badges are derived from Seebo's action lifecycle and `ActionStatus`/receipt outcomes; the UI must
> never imply an action ran when it did not.

---

## 11. API View

For `api` templates only (API View only — no Document/Action panels).

```
┌───────────────────────────────────────────────────────────────────────┐
│ Method ▾   URL ____________________________________________   [ Send ] │
├───────────────────────────────────────────────────────────────────────┤
│ [ Params ] [ Headers ] [ Body ] [ Auth ]      ← structured editors      │
├───────────────────────────────────────────────────────────────────────┤
│ Response: status · time · size · headers · body                        │
├───────────────────────────────────────────────────────────────────────┤
│ History (per template):  ▸ records (deletable)      [ Clear history ]   │
└───────────────────────────────────────────────────────────────────────┘
```

| Element | Behavior |
|---------|----------|
| Method selector | One of GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS (matches subtype). |
| URL editor | Request URL; host validated against allowed domains at execution. |
| Query params editor | Structured key/value. |
| Headers editor | Structured key/value. |
| Body editor | Structured/JSON body per content type. |
| Auth config | None / Bearer / Basic / API key; secret values referenced via SecretService (never shown in clear). |
| Send/execute | Routes through the backend HTTP client; never direct from frontend. |
| Response display | Status, duration, size, headers, body. |
| History display | Per-template call history (metadata-only by default). |
| History delete | Delete individual records. |
| Clear history | Clear all history for the template. |

| ID | Rule |
|----|------|
| **API-1** | All calls execute via the backend; the UI shows blocked-domain errors clearly. |
| **API-2** | The canonical model is structured (never cURL). |
| **API-3** | History records are deletable individually and clearable per template. |
| **API-4** | Secrets are entered/managed as references; never displayed in clear. |

---

## 12. Action Confirmation (cross-view rule)

| ID | Rule |
|----|------|
| **AC-1** | No action executes without explicit user confirmation. |
| **AC-2** | The UI must display the action/action-group before execution. |
| **AC-3** | UI confirmation alone is insufficient — the backend enforces confirmation; the UI reflects backend outcomes. |
| **AC-4** | `Perform all` is fail-fast: execution stops at the first error and the failure is visible. |

---

## 13. Receipts (Action Receipts UI)

| Aspect | Behavior |
|--------|----------|
| Visibility | Receipts are visible in the UI (local-only data). |
| Content | Action id/type, status, environment, external id (if any), error (if failed), timestamp; inputs redacted. |
| Access | From the Action Panel after execution and (Recommended) a per-template receipts list. |

| ID | Rule |
|----|------|
| **RC-1** | Receipts are visible and local-only. |
| **RC-2** | No secret values appear in receipts (redaction applied). |

---

## 14. Render View

For `render` templates only — **view-only**.

| Element | Behavior |
|---------|----------|
| Render area | Rendered output for the subtype. |
| Subtypes | html, markdown, eml, mermaid, swagger, openapi, echarts, json-preview. |
| Controls | No Input Panel, no Action Panel, no API execution controls. |

| ID | Rule |
|----|------|
| **RV-1** | Render View is standalone and view-only. |
| **RV-2** | No actions, no execution. |
| **RV-3** | Supports all defined render subtypes. |

---

## 15. Database View

A real DB client; opened from a database connection (not a template).

```
┌───────────────────────────────────────────────────────────────────────┐
│ Connection ▾ (sqlite|postgresql)   [Read-only]   [ Connect ]            │
├───────────────────────────────────────────────────────────────────────┤
│ SQL editor                                              [ Run ]         │
├───────────────────────────────────────────────────────────────────────┤
│ Results grid                          [ Export CSV ] [ Export JSON ]   │
├───────────────────────────────────────────────────────────────────────┤
│ Query history (metadata only)                                          │
└───────────────────────────────────────────────────────────────────────┘
```

| Element | Behavior |
|---------|----------|
| Connection | Choose engine (SQLite/PostgreSQL); credentials from OS keychain; never shown in clear. |
| Read-only indicator | Clearly shows the connection is read-only by default. |
| SQL editor | Enter a statement. |
| Run | Executes via backend; dangerous statements blocked unless dev permissions allow. |
| Results grid | Tabular results; paginated/streamed for large sets. |
| Export | CSV / JSON export of results. |
| History | Metadata-only query history (no result rows). |

| ID | Rule |
|----|------|
| **DBV-1** | Read-only by default; writes/dangerous statements blocked unless dev-permitted; backend-enforced. |
| **DBV-2** | Blocked statements produce a clear, explanatory error. |
| **DBV-3** | History stores metadata only; results are never persisted. |
| **DBV-4** | DB results are **not** Seebo inputs (v1). |
| **DBV-5** | No automatic column masking (v1). |

---

## 16. Template Editor

| Aspect | Behavior |
|--------|----------|
| Scope | Edits the current draft of a template (any type). |
| Document/Render | Source editor for the Seebo template / render content. |
| API | Structured request editors (method/url/headers/query/body/auth) — never raw cURL. |
| Input authoring | For inputs (`require(...)`), the author selects the **input capability** (widget) from the Input Widget Catalog (§9.1.1) per input, plus type and any constraint values (options). This determines how the Input Panel renders that input. |
| Live feedback | Run Seebo `validate`/`analyze` (pure) for inline diagnostics, requirement preview, capabilities used (Recommended). |
| Save | Persists the draft. |
| Create release | Snapshots the current draft into an immutable release (linear version). |
| Changelog | Edits/records changelog entries on changes/releases. |

| ID | Rule |
|----|------|
| **ED-1** | Editing affects only the draft; releases remain immutable. |
| **ED-2** | Release creation is available from the editor and produces an immutable, linearly versioned snapshot. |
| **ED-3** | Changelog and release functionality are common to all template types. |
| **ED-4** | The input capability (widget) chosen per input is part of the template definition and is captured in releases like all other template content. |

---

## 17. Release Selection Behavior

| Aspect | Behavior |
|--------|----------|
| Entry point | Working Tree three-dot menu → "Select release". |
| Scope | Per template, **personal, local-only, not synchronized**. |
| Options | List of immutable releases + (Recommended) "Latest" and "Draft". |
| Effect | The selected release drives rendering/inputs/output for that user only. |
| Default/fallback | If none selected: latest release, else current draft (Recommended). |

| ID | Rule |
|----|------|
| **RS-1** | Release selection is personal and never synchronized. |
| **RS-2** | The selected release determines the Input Panel requirements and rendered output. |

---

## 18. Batcher

A temporary composition tool for **document templates only**.

```
┌───────────────────────────────────────────────────────────────────────┐
│ Batcher (temporary)                                                    │
├───────────────────────────────┬───────────────────────────────────────┤
│ Ordered list (drag & drop):    │  Shared inputs (resolved once)         │
│  1. doc-template-A             │   inputId → value                      │
│  2. doc-template-B             │                                        │
│  3. doc-template-C             │  [ Render batch ]                      │
│  (order is significant)        │                                        │
├───────────────────────────────┴───────────────────────────────────────┤
│ Batch output (ordered composition; merge macros applied)               │
└───────────────────────────────────────────────────────────────────────┘
```

| ID | Rule |
|----|------|
| **BT-1** | Document templates only; API and Render templates are rejected (drag rejected). |
| **BT-2** | Order is significant and preserved in output. |
| **BT-3** | Shared input IDs are resolved **once** and reused across templates. |
| **BT-4** | Supports Seebo merge macros (ABSORB/MERGE), respecting selected releases. |
| **BT-5** | The Batcher is temporary — not a persisted, standalone, synchronized object. |

---

## 19. User Profile / Local Profile

| Aspect | Behavior |
|--------|----------|
| Local mode | Requires only a **local profile** (minimal local identity). |
| Preferences | User preferences — local-only, not synchronized. Include **theme** (dark/light), **primary color**, **language**, and layout/UI options (§23). |
| Device identity (future) | For P2P: device identity management surfaces here (future). |
| SSO/OIDC, MFA | **Future** — not in MVP. |

| ID | Rule |
|----|------|
| **PR-1** | Local mode needs only a local profile. |
| **PR-2** | Preferences are local-only (theme, primary color, language, layout). |
| **PR-3** | Theme, primary color and language are user-selectable in Preferences and applied app-wide (§23). |

---

## 20. Empty, Loading, and Error States

### 20.1 Empty States

| Context | Empty state |
|---------|-------------|
| Homepage (no recents) | Create/Open calls to action. |
| Working Tree (no templates) | Prompt to create the first template. |
| Document View (no requirements) | Render directly; Input Panel shows "no inputs". |
| Action Panel | **Not shown** when there are no actions (not an empty state — absent). |
| API history | "No calls yet." |
| DB results | "No rows" / "Run a query." |
| Batcher (empty) | "Drag document templates here." |

### 20.2 Loading States

| Context | Loading state |
|---------|---------------|
| Opening workspace | Progress + (if encrypted) password prompt. |
| Rendering document | Rendering indicator; waiting-on-input distinguished from in-progress. |
| Executing action | Per-action executing indicator. |
| HTTP send | In-flight indicator with cancel (Recommended). |
| DB query | Running indicator; streaming for large sets. |

### 20.3 Error States

| Context | Error state |
|---------|-------------|
| Workspace open | Missing/corrupt file, wrong password, unsupported schema version. |
| Seebo render | Diagnostics with code/position; clearly attributed to the template. |
| Blocked HTTP domain | Coded, explanatory "domain not allowed" message. |
| Blocked DB statement | Coded, explanatory "statement blocked" message. |
| Action denied | Policy/sandbox denial clearly shown (badge + message). |
| Action failed | Error from receipt; `Perform all` shows where it stopped. |
| Encryption | Clear unrecoverability messaging on key loss. |

| ID | Rule |
|----|------|
| **ST-1** | Blocked operations are clearly distinguished from generic failures. |
| **ST-2** | Local-only vs synchronized data is visually distinguishable where relevant (Recommended). |
| **ST-3** | Encryption loss is communicated as unrecoverable. |

---

## 21. Panel Visibility Matrix

| View | Working Tree | Input Panel | Main Document | Action Panel | API editor/response | Render area | DB editor/results |
|------|:-----------:|:-----------:|:-------------:|:------------:|:-------------------:|:-----------:|:-----------------:|
| Document View | ✅ | ✅ | ✅ | ⚠️ only if actions | — | — | — |
| API View | ✅ | — | — | — | ✅ | — | — |
| Render View | ✅ | — | — | — | — | ✅ | — |
| Database View | ✅ | — | — | — | — | — | ✅ |
| Template Editor | ✅ | (preview) | (preview) | — | (api editors) | (preview) | — |
| Batcher | ✅ | shared inputs | batch output | — | — | — | — |

Legend: ✅ present · ⚠️ conditional · — not present.

---

## 22. Open Decisions (UI)

| ID | Topic | Recommendation |
|----|-------|----------------|
| **OD-UI-1** | Folder deletion semantics (cascade vs reparent). | Block non-empty deletion or require explicit cascade confirmation. |
| **OD-UI-2** | Render trigger: live re-render vs explicit. | Explicit render/apply by default, within Seebo limits. |
| **OD-UI-3** | Folder context menu contents (not specified in `init.md`). | Use §8 set; confirm with design. |
| **OD-UI-4** | Entering `dev` mode confirmation. | Require confirmation/permission to enter `dev`. |
| **OD-UI-5** | DB connection management surface (where connections are created/edited). | Recommended: a connections panel within Database View / Settings. |
| ~~**OD-UI-6**~~ | Input widget catalog canonical capability names + full set. | **Resolved:** the §9.1.1 catalog and capability names are confirmed. New widgets may still be added later via the extensible registry (IW-5). |
| ~~**OD-UI-7**~~ | Exact primary-color palette. | **Resolved: 5 primaries** (default Blue): Blue `#2563EB`, Indigo `#6750A4`, Teal `#0D9488`, Green `#16A34A`, Amber `#F59E0B`. Design may refine hues later (§23.3). |
| **OD-UI-8** | Theme default (system vs light vs dark) and "follow system" option. | Default to "follow system" with manual override. |

---

## 23. Design System, Theming & Localization

### 23.1 Visual Language

| ID | Requirement |
|----|-------------|
| **DS-1** | The UI is **modern, minimal, Material-style**. |
| **DS-2** | The UI ships **two themes: dark and light**, fully supported across all views. |
| **DS-3** | The user can choose a **primary (accent) color** from a curated set of **4–5** options in Preferences. |
| **DS-4** | The UI is **localized**; initial languages are **Italian** and **English**. |
| **DS-5** | Theming and localization follow established good practices (design tokens, a single theme provider, externalized strings, no hard-coded copy or colors). |
| **DS-6** | Components come from a **single shared design system**; one-off/bespoke components are not allowed (UI coherence — §23.6). |
| **DS-7** | The UI must be **attractive and coherent**: the same interaction patterns, spacing, and components are reused across screens, never reinvented per view. |

### 23.2 Theming (dark / light)

| ID | Requirement |
|----|-------------|
| **TH-1** | A single **theme provider** at the app root supplies the active theme to all components. |
| **TH-2** | Colors, spacing, radii, elevation and typography are expressed as **design tokens**; components consume tokens, never literal hex/px. |
| **TH-3** | Theme selection is `light` \| `dark` \| `system` (follow OS) — Recommended default `system`. |
| **TH-4** | The active theme is a **local-only user preference** (`pref.theme`); it is not synchronized. |
| **TH-5** | Theme switching applies instantly without reload and persists across sessions. |
| **TH-6** *(Recommended)* | Both themes meet WCAG AA contrast for text and essential UI; status colors (blocked/denied/error/success) remain distinguishable in both. |

### 23.3 Primary Color

| ID | Requirement |
|----|-------------|
| **PC-1** | Preferences offer **4–5 primary colors**; selecting one re-themes accent/primary surfaces app-wide. |
| **PC-2** | The chosen primary color is a **local-only preference** (`pref.primaryColor`); not synchronized. |
| **PC-3** | The primary color is a design token; derived shades/states (hover, active, disabled) are computed from it consistently in both themes. |
| **PC-4** | The palette (resolved OD-UI-7) is **5 primary colors** commonly used in UIs, default **Blue**: Blue `#2563EB`, Indigo `#6750A4`, Teal `#0D9488`, Green `#16A34A`, Amber `#F59E0B`. Each must remain accessible (AA) in light and dark; derived shades/states computed from the token. Design may later refine exact hues. |

### 23.4 Localization (i18n)

| ID | Requirement |
|----|-------------|
| **L10N-1** | All user-facing copy is **externalized** into translation resources; no hard-coded strings in components. |
| **L10N-2** | Initial locales: **`it`** and **`en`**; the language is user-selectable in Preferences. |
| **L10N-3** | The selected language is a **local-only preference** (`pref.language`); not synchronized. |
| **L10N-4** | The architecture supports adding locales without code changes to components (string catalogs only). |
| **L10N-5** *(Recommended)* | Dates, times, numbers and durations are formatted per locale (BCP-47), consistent with the Seebo `locale` used for rendering where applicable. |
| **L10N-6** *(Recommended)* | A missing translation falls back to English; the build flags missing keys. |

> **Scope note:** Localization governs the **application UI chrome**. Template/rendered output
> content is authored data (its language is the author's choice); the Seebo engine `locale`
> (workspace setting) governs value formatting during rendering and is distinct from the UI language.

### 23.5 Preferences Surface

| Preference | Values | Class |
|------------|--------|-------|
| Theme | `light` \| `dark` \| `system` | 🔵 local-only |
| Primary color | one of 4–5 curated colors | 🔵 local-only |
| Language | `it` \| `en` (extensible) | 🔵 local-only |
| Layout/UI options | Recommended (e.g. density) | 🔵 local-only |

> These preferences map to the **User Preference** entity (local-only) in
> [`SWAFT_DATA_MODEL.md`](SWAFT_DATA_MODEL.md) §10 and are never synchronized
> ([`SWAFT_STORAGE_SYNC_MODEL.md`](SWAFT_STORAGE_SYNC_MODEL.md) §6).

### 23.6 UI Coherence (consolidated requirement)

The UI must be **attractive and coherent**: identical problems get identical solutions everywhere.

| ID | Requirement |
|----|-------------|
| **UCOH-1** | A **single shared component library** is the only source of UI primitives (buttons, inputs, menus, dialogs, tables, tabs, toasts, empty/loading/error states). Feature code composes these; it does not create parallel variants. |
| **UCOH-2** | Interaction patterns are consistent: the same control for the same purpose across views (e.g. one confirmation-dialog pattern, one toast pattern, one form-field pattern). |
| **UCOH-3** | All visual values come from design tokens (color/spacing/typography/radii/elevation); no literal styling in components. |
| **UCOH-4** | Icons, empty states, loading states and error states use shared components (§20) — not per-view re-implementations. |
| **UCOH-5** *(Recommended)* | A component catalog (e.g. Storybook) documents the shared components; new UI reuses them. A review check rejects one-off components that duplicate existing ones. |
| **UCOH-6** | The Input Panel widgets (§9.1.1) are themselves shared components in the design system, so inputs look and behave consistently. |

### 23.7 UI Performance (renderer)

| ID | Requirement |
|----|-------------|
| **UIP-1** | Long lists (Working Tree, DB results grid) are **virtualized**. |
| **UIP-2** | Heavy views (DB grid, charts, swagger/openapi, mermaid/echarts) are **code-split** and lazy-loaded. |
| **UIP-3** | Heavy client-side rendering/parsing runs in a **Web Worker**, not on the React render thread. |
| **UIP-4** | Large payloads are paginated/streamed; the renderer never holds unbounded result sets in memory. |
| **UIP-5** *(Recommended)* | Editor `validate`/`analyze` feedback is debounced; large parses offloaded. |

> Backend/process-level performance is in [`SWAFT_ARCHITECTURE.md`](SWAFT_ARCHITECTURE.md) §11.
