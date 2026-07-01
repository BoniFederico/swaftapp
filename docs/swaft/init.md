# Swaft — Initial Product, Architecture and UI Decisions

## 1. Purpose

This document defines the initial product, architecture, UI, storage, security, synchronization, template, action, database, API, release, batcher, and MVP decisions for **Swaft**.

Swaft stands for **Strange Web App for Technician**.

Swaft is a **desktop-first technical application** for AM, development, and power-user workflows. It is based on **Seebo** concepts and focuses on structured technical templates, local-first workspaces, controlled execution, and optional synchronization.

This document is intended to be copied into the repository as:

```text
docs/swaft/init.md
```

## 2. Product Definition

### 2.1 Product Name

| Field | Value |
|---|---|
| Product name | Swaft |
| Acronym | Strange Web App for Technician |
| Product type | Desktop-first technical application |
| Target users | AM users, developers, technicians, and power users |
| Foundation | Based on Seebo concepts |

### 2.2 Product Positioning

Swaft is a technical workspace application for creating, rendering, organizing, executing, and sharing structured templates.

The product is designed for users who need:

- Repeatable document generation.
- Structured API requests.
- Render-only technical previews.
- Controlled local execution.
- Workspace-level organization.
- Optional peer-to-peer synchronization.
- Secure local storage.
- Explicit release management for templates.

### 2.3 Core Product Principles

Swaft must follow these principles:

1. **Desktop-first**
   - Swaft is primarily a desktop application.
   - The UI must be optimized for technical desktop workflows.

2. **Local-first**
   - A Swaft workspace can exist entirely on the local machine.
   - Local workspaces are stored as a single `.swaft` file.

3. **Explicit security**
   - Dangerous operations must be restricted by default.
   - User confirmation is required before actions are executed.
   - Workspace execution mode must determine allowed behavior.

4. **Structured over textual**
   - API templates must use a structured request model.
   - API templates must not be modeled as cURL strings.

5. **Immutable release snapshots**
   - Template releases are immutable.
   - Users can select which release to use.

6. **Predictable synchronization**
   - P2P synchronization must define exactly what is synchronized and what is local-only.
   - Conflict resolution must be deterministic.

7. **No unrelated features**
   - Features not defined in this document must not be added implicitly.

## 3. Technology Stack

### 3.1 Application Shell

Swaft uses **Tauri** as the desktop application shell.

| Layer | Technology |
|---|---|
| Desktop shell | Tauri |
| Frontend | React + Vite |
| Frontend language | TypeScript recommended |
| Local backend | Node.js |
| Frontend/backend communication | Secure local HTTP APIs |

### 3.2 Frontend

The frontend must be implemented with:

- **React**
- **Vite**
- **TypeScript recommended**

The frontend is responsible for:

- Rendering the application UI.
- Displaying the working tree.
- Displaying template views.
- Managing local UI state.
- Calling the local backend over secure local HTTP APIs.

### 3.3 Local Backend

The local backend must be implemented with **Node.js**.

The backend is responsible for:

- Workspace file access.
- SQLite-backed `.swaft` storage.
- Template persistence.
- Release persistence.
- API execution.
- Database query execution.
- Action execution.
- Local security enforcement.
- P2P synchronization support.
- Secure credential access.

### 3.4 Frontend/Backend Communication

Frontend/backend communication must use **secure local HTTP APIs**.

Implementation requirements:

- APIs must be bound to local access only.
- APIs must include request authentication or an equivalent local trust mechanism.
- APIs must not be exposed as a public network API.
- Dangerous backend operations must enforce workspace execution-mode rules.
- UI-level checks are not sufficient; backend enforcement is mandatory.

## 4. Workspace Model

### 4.1 Workspace Concept

A Swaft workspace is the top-level container for:

- Projects.
- Folders.
- Tags.
- Restrictions.
- Templates.
- Template releases.
- Workspace settings.
- Changelog entries.
- Storage mode configuration.
- Synchronization configuration.

### 4.2 Storage Modes

Swaft supports the following workspace storage modes:

| Storage mode | Description |
|---|---|
| `local` | Workspace is stored locally in a single `.swaft` file. |
| `p2p` | Workspace is synchronized in real time with allowed peer devices. |
| `server` | Workspace uses a server-backed storage/synchronization mode. |

### 4.3 Immutable Storage Mode

The workspace storage mode is **immutable**.

Once a workspace is created with a storage mode, that storage mode must not be changed in place.

Implementation requirements:

- The storage mode must be stored as workspace metadata.
- The UI must not expose a normal "change storage mode" operation.
- Migration between storage modes, if ever supported, must be implemented as an explicit export/import or clone operation, not as an in-place mutation.

## 5. Local Storage Model

### 5.1 Local Workspace File

In local mode, a Swaft workspace is stored as a single file:

```text
*.swaft
```

The `.swaft` file is **SQLite-based**.

Implementation requirements:

- A workspace must be portable as one file.
- The SQLite schema must support all persisted workspace entities.
- The file extension must be `.swaft`.
- The application must treat the file as the authoritative local workspace store.

### 5.2 Local Encryption

Swaft supports optional whole-file encryption for local `.swaft` files.

| Requirement | Decision |
|---|---|
| Encryption type | Optional whole-file encryption |
| Scope | Entire `.swaft` file |
| Recovery | Not recoverable if password/key is lost |

Implementation requirements:

- Encryption must protect the whole workspace file.
- The user must be clearly warned that losing the password or key makes the workspace unrecoverable.
- Recovery backdoors must not be introduced.
- Encryption metadata must not expose sensitive workspace contents.

### 5.3 Local-Only Data

Some data is intentionally not synchronized and remains local to the device.

Local-only data includes:

- Last input values.
- API call history.
- Database query history.
- User preferences.
- Default release selection per template.
- Local secrets.
- Local credentials.
- Local action receipts.

## 6. P2P Synchronization Model

### 6.1 P2P Synchronization Behavior

P2P mode uses **real-time synchronization**.

Supported P2P network modes:

| Network mode | Description |
|---|---|
| `lanOnly` | Peer discovery and synchronization are limited to the local network. |
| `internet` | Peer synchronization can occur over the internet. |
| `both` | Both LAN and internet synchronization are allowed. |

### 6.2 P2P Security Model

P2P synchronization must use:

- Device identities.
- Signed invitations.
- Device allowlists.
- Encrypted workspace keys.
- Revocation support.

Implementation requirements:

1. Each participating device must have a stable device identity.
2. Devices must join a workspace through a signed invitation.
3. Devices must be explicitly allowed before synchronization.
4. Workspace keys must be encrypted when shared.
5. Revoked devices must no longer receive future synchronization updates.
6. Revocation must be represented in synchronized workspace metadata.

### 6.3 P2P Conflict Resolution

P2P conflict resolution uses:

```text
last-write-wins
```

Implementation requirements:

- Each synchronized entity must carry enough metadata to determine the last write.
- Conflict resolution must be deterministic.
- The same set of changes must produce the same final state on all peers.
- Last-write-wins must be applied only to synchronized entities.

### 6.4 Data Synchronized in P2P Mode

The following data is synchronized:

- Templates.
- Template releases.
- Workspace settings.
- Projects.
- Folders.
- Tags.
- Restrictions.
- Changelog.

### 6.5 Data Not Synchronized in P2P Mode

The following data is not synchronized:

- Last input values.
- API call history.
- Database query history.
- User preferences.
- Default release selection per template.
- Local secrets.
- Local credentials.
- Local action receipts.

### 6.6 P2P Synchronization Table

| Data category | Synchronized |
|---|---:|
| Templates | Yes |
| Template releases | Yes |
| Workspace settings | Yes |
| Projects | Yes |
| Folders | Yes |
| Tags | Yes |
| Restrictions | Yes |
| Changelog | Yes |
| Last input values | No |
| API call history | No |
| Database query history | No |
| User preferences | No |
| Default release selection per template | No |
| Local secrets | No |
| Local credentials | No |
| Local action receipts | No |

## 7. Server Storage Mode

Swaft recognizes `server` as a workspace storage mode.

Initial decisions:

- `server` is a valid storage mode.
- Storage mode remains immutable.
- Server mode must not alter the local-first design assumptions for local workspaces.
- Server mode details are not defined beyond being a recognized storage mode in the initial model.

Implementation requirement:

- The data model must reserve support for `server` as a workspace storage mode without requiring all server behavior to be implemented in the MVP.

## 8. Template Model

### 8.1 Template Types

Swaft supports three template types:

| Template type | Primary view | Description |
|---|---|---|
| `document` | Document View | Input-driven document rendering with optional actions. |
| `api` | API View | Structured HTTP request execution. |
| `render` | Render View | Standalone view-only rendering. |

### 8.2 Template Type to UI Mapping

| Template type | UI view |
|---|---|
| `document` | Document View |
| `api` | API View |
| `render` | Render View |

### 8.3 Document Templates

Document templates use:

```text
Input Panel + Main Document View + optional Action Panel
```

The Action Panel is visible only if rendering produces actions.

#### 8.3.1 Document Template Subtypes

Supported document template subtypes:

- `html`
- `markdown`
- `eml`
- `csv`
- `json`
- `xml`
- `yaml`
- `txt`
- `javascript`
- `python`
- `sql`
- `plain`

#### 8.3.2 Document Template Persistence

Document templates persist:

- Template definition.
- Template releases.
- Last input values per template.

The following rule applies:

- Last input values are persisted locally per template.
- Last input values are not synchronized.

### 8.4 API Templates

API templates use the **API View**.

API templates must be modeled as a structured JSON-like HTTP request model, not as cURL.

#### 8.4.1 API Template Subtypes

Supported API template subtypes correspond to HTTP methods:

- `GET`
- `POST`
- `PUT`
- `PATCH`
- `DELETE`
- `HEAD`
- `OPTIONS`

#### 8.4.2 API Template Canonical Model

The canonical API template model is a structured HTTP request object.

Example shape:

```json
{
  "method": "POST",
  "url": "https://api.example.com/resource",
  "headers": {
    "Content-Type": "application/json"
  },
  "query": {
    "include": "details"
  },
  "body": {
    "name": "Example"
  },
  "auth": {
    "type": "bearer"
  }
}
```

Implementation requirements:

- cURL must not be the canonical storage format.
- Import/export helpers may exist later, but the internal model must remain structured.
- API templates must persist call history per template.
- API history records must be deletable.
- API history must be clearable.

### 8.5 Render Templates

Render templates use the **Render View** only.

Render templates are:

- Standalone.
- View-only.
- Not action-oriented.

#### 8.5.1 Render Template Subtypes

Supported render template subtypes:

- `html`
- `markdown`
- `eml`
- `mermaid`
- `swagger`
- `openapi`
- `echarts`
- `json-preview`

## 9. Template Releases

### 9.1 Release Versioning

Swaft uses **linear versioning** for template releases.

A release is an **immutable semantic snapshot**.

Example release versions:

- `v1.0.0`
- `v1.1.0`
- `v2.0.0`

### 9.2 Release Rules

Implementation requirements:

1. A template release must be immutable after creation.
2. Release versions must be semantic version labels.
3. Releases must follow a linear sequence per template.
4. A user can select which release to use.
5. Release selection is personal and not synchronized.
6. Template releases themselves are synchronized in P2P mode.

### 9.3 Release Selection

Release selection is performed through the working tree three-dot menu.

The release selection is:

- Per template.
- Personal.
- Local-only.
- Not synchronized.

## 10. Working Tree and Navigation

### 10.1 Working Tree

The working tree is common to all layouts and always visible.

Implementation requirements:

- The working tree must remain visible regardless of the selected template type.
- It must support navigation across projects, folders, templates, and related workspace entities.
- It must expose template context actions.

### 10.2 Working Tree Context Menu

The working tree context menu must include:

- Open.
- Edit.
- Rename.
- Clone.
- Delete.
- Select release.

### 10.3 View Selection

Opening a template must select the correct view based on template type:

| Template type | Opened view |
|---|---|
| `document` | Document View |
| `api` | API View |
| `render` | Render View |

## 11. UI Specification

### 11.1 Common Layout Requirements

All layouts must include:

- Always-visible working tree.
- Main content area.
- Template-specific view area.
- Contextual controls.
- Clear feedback for persistence and execution operations.

### 11.2 Document View

Document View includes:

1. **Input Panel**
   - Displays template inputs.
   - Allows users to enter values.
   - Persists last input values per template locally.

2. **Main Document View**
   - Displays rendered document output.
   - Uses Seebo rendering behavior.
   - May produce actions.

3. **Optional Action Panel**
   - Visible only when rendering produces actions.
   - Displays zero, one, or many generated actions.
   - Requires explicit user confirmation before execution.

### 11.3 API View

API View includes:

- Structured request editor.
- Method selector.
- URL editor.
- Headers editor.
- Query parameters editor.
- Body editor.
- Authentication configuration.
- Send/execute control.
- Response display.
- Call history display.
- History delete controls.
- Clear history control.

### 11.4 Render View

Render View includes:

- Rendered output area.
- View-only presentation.
- No action panel.
- No API execution controls.

Render View must support the defined render subtypes:

- HTML.
- Markdown.
- EML.
- Mermaid.
- Swagger.
- OpenAPI.
- ECharts.
- JSON preview.

## 12. Batcher

### 12.1 Batcher Purpose

The batcher is a temporary composition tool for document templates.

It allows users to combine multiple document templates for a single rendered batch output.

### 12.2 Batcher Rules

The batcher:

- Is temporary.
- Supports only document templates.
- Supports drag and drop.
- Treats item order as significant.
- Resolves shared input IDs once.
- Supports Seebo merge macros.

### 12.3 Batcher Restrictions

The batcher must not support:

- API templates.
- Render templates.
- Permanent batch entities unless explicitly added later.
- Synchronization as a standalone persisted object.

### 12.4 Batcher Input Resolution

When multiple document templates in the batch share input IDs:

- The shared input ID must be resolved once.
- The resolved value must be reused across templates in the batch.
- The batch order must be preserved during rendering.

### 12.5 Batcher Seebo Merge Macros

The batcher must support Seebo merge macros.

Implementation requirements:

- Merge macro processing must occur consistently across the batch.
- Macro resolution must respect the selected template releases.
- Batch output must preserve ordered document composition.

## 13. Actions

### 13.1 Action Definition

In version 1, actions are defined in code.

Future plugin-based actions are allowed as a future direction but are not part of the initial implementation.

### 13.2 Action Generation

Actions are generated by Seebo rendering.

A rendered document template can produce:

- Zero actions.
- One action.
- Many actions.

### 13.3 Action Panel Visibility

The Action Panel is visible only if rendering produces actions.

If no actions are produced, the Action Panel must not be shown.

### 13.4 Action Confirmation

Action execution always requires user confirmation.

Implementation requirements:

- Actions must not execute automatically after rendering.
- The UI must display the action or action group before execution.
- The user must explicitly confirm execution.
- Backend enforcement is required; UI confirmation alone is not sufficient.

### 13.5 Perform All Behavior

The "perform all" operation must use:

```text
failFast: true
```

Behavior:

- Actions are executed in order.
- Execution stops on the first failed action.
- Remaining actions are not executed after a failure.
- The failure must be visible to the user.

### 13.6 Action Receipts

Action receipts must be visible in the UI.

Action receipts are:

- Local-only.
- Not synchronized.
- Stored as local action receipts.

## 14. HTTP/API Client

### 14.1 Real HTTP Client

Swaft must include a real HTTP client.

HTTP execution must occur through the backend.

| Requirement | Decision |
|---|---|
| Real HTTP client | Yes |
| Execution path | Via backend |
| Canonical model | Structured request model |
| cURL canonical model | No |

### 14.2 Supported Authentication Methods

The HTTP client must support:

- Bearer token.
- Basic auth.
- API key.

### 14.3 Allowed Domains

Allowed domains are configured per workspace.

Implementation requirements:

- Outbound HTTP requests must be checked against the workspace allowed-domain restrictions.
- The backend must enforce allowed-domain rules.
- The UI must clearly show when a domain is blocked.
- Workspace restrictions are synchronized in P2P mode.

### 14.4 Proxy Support

The HTTP client must support proxy configuration.

Implementation requirements:

- Proxy behavior must be implemented in the backend HTTP client.
- Proxy settings must respect workspace and local security rules.
- Sensitive proxy credentials must be stored securely when required.

### 14.5 HTTP History

API templates persist call history per template.

History records must be:

- Viewable.
- Deletable individually.
- Clearable.

Current decision:

- Metadata-only history is recommended.
- Configurable history behavior is possible.
- Final HTTP history scope remains an open decision.

### 14.6 HTTP History Data Classification

HTTP history is not synchronized.

Recommended metadata-only history may include:

- Timestamp.
- Template ID.
- Method.
- URL host.
- Status code.
- Duration.
- Error category.

Sensitive values should not be stored unless an explicit future decision allows configurable full history.

## 15. Database Client

### 15.1 Real Database Client

Swaft must include a real database client.

Initial database support:

- SQLite.
- PostgreSQL.

### 15.2 Database Query Execution

Database query execution must be controlled by workspace execution mode.

Default behavior:

```text
readOnlyDefault: true
```

Implementation requirements:

- Database connections must default to read-only behavior.
- Write operations must be forbidden in sandbox mode.
- Dangerous statements must be blocked by default.
- The backend must enforce database restrictions.

### 15.3 Dangerous Statements

The following statements are blocked as dangerous:

- `DROP`
- `DELETE`
- `UPDATE`
- `INSERT`
- `ALTER`
- `TRUNCATE`
- `CREATE`

### 15.4 Database Credentials

Database credentials must be stored in:

```text
OS keychain / secure secret storage
```

Implementation requirements:

- Credentials must not be stored in synchronized workspace data.
- Credentials must not be stored as plain text in the `.swaft` database.
- Credentials are local-only.
- The backend must retrieve credentials through secure local storage.

### 15.5 Database History

Database query history must be:

- Metadata only.
- Local-only.
- Not synchronized.

### 15.6 Database Exports

Supported database export formats:

- CSV.
- JSON.

### 15.7 Database and Seebo Inputs

Database query results are not Seebo input.

Decision:

```text
notSeeboInput: true
```

Implementation requirement:

- Database results must not automatically become Seebo template input values.

### 15.8 Database Masking

Database masking is not required in version 1.

Decision:

```text
masking: not required v1
```

## 16. Workspace Execution Modes

### 16.1 Execution Modes

Swaft workspaces support two execution modes:

| Execution mode | Description |
|---|---|
| `sandbox` | Restricted mode for safer execution. |
| `dev` | Advanced mode for users who need elevated operations with permissions. |

### 16.2 Sandbox Mode

Sandbox mode enforces:

- Allowed domains.
- File writes only inside the workspace/export folder.
- Database writes forbidden.
- Dangerous actions blocked.

Implementation requirements:

- Sandbox restrictions must be enforced by the backend.
- File write operations outside the workspace/export folder must be rejected.
- Database write operations must be rejected.
- Dangerous actions must be blocked even if generated by rendering.
- HTTP requests must respect allowed-domain restrictions.

### 16.3 Dev Mode

Dev mode allows advanced operations with permissions.

Implementation requirements:

- Dev mode must still require explicit permissions for advanced operations.
- Dev mode must not bypass user confirmation for actions.
- Dev mode must not expose credentials insecurely.
- Dev mode must still respect secure storage requirements.

## 17. Security Model

### 17.1 Security Principles

Swaft security is based on:

- Local-first trust boundaries.
- Backend enforcement.
- Optional whole-file encryption.
- Secure credential storage.
- Explicit user confirmation.
- Workspace execution modes.
- P2P device identity and revocation.
- Local-only handling for secrets and histories.

### 17.2 Secrets and Credentials

Secrets and credentials include:

- API tokens.
- Basic auth credentials.
- API keys.
- Database credentials.
- Proxy credentials.
- Local workspace encryption keys or passwords.

Requirements:

- Secrets must not be synchronized.
- Secrets must not be stored in plain text in workspace data.
- Secrets must be stored in OS keychain or secure secret storage where applicable.
- Loss of encryption password/key must make encrypted local workspace data unrecoverable.

### 17.3 Backend Enforcement

The backend must enforce:

- Workspace execution mode.
- Allowed domains.
- File write boundaries.
- Database statement restrictions.
- Credential access controls.
- Action confirmation requirements.
- P2P authorization and revocation rules.

### 17.4 UI Security Requirements

The UI must:

- Clearly show when actions require confirmation.
- Clearly show blocked operations.
- Clearly distinguish local-only data from synchronized data where relevant.
- Warn users about unrecoverable encrypted workspace loss if password/key is lost.
- Display action receipts.

## 18. Data Model

### 18.1 Core Entities

The initial data model must include entities for:

- Workspace.
- Project.
- Folder.
- Tag.
- Restriction.
- Template.
- Template release.
- Changelog entry.
- User preference.
- Last input value.
- API call history record.
- Database query history record.
- Local secret reference.
- Local credential reference.
- Local action receipt.
- Device identity.
- P2P invitation.
- P2P allowlist entry.
- P2P revocation entry.

### 18.2 Workspace Entity

Workspace fields must include:

| Field | Description |
|---|---|
| `id` | Unique workspace identifier. |
| `name` | Workspace display name. |
| `storageMode` | One of `local`, `p2p`, or `server`. Immutable after creation. |
| `executionMode` | One of `sandbox` or `dev`. |
| `settings` | Workspace settings. |
| `createdAt` | Creation timestamp. |
| `updatedAt` | Last update timestamp. |

### 18.3 Template Entity

Template fields must include:

| Field | Description |
|---|---|
| `id` | Unique template identifier. |
| `type` | One of `document`, `api`, or `render`. |
| `subtype` | Subtype valid for the template type. |
| `name` | Template display name. |
| `projectId` | Associated project, if applicable. |
| `folderId` | Associated folder, if applicable. |
| `tags` | Associated tags. |
| `currentDraft` | Editable draft content/model. |
| `createdAt` | Creation timestamp. |
| `updatedAt` | Last update timestamp. |

### 18.4 Template Release Entity

Template release fields must include:

| Field | Description |
|---|---|
| `id` | Unique release identifier. |
| `templateId` | Parent template identifier. |
| `version` | Semantic version label, such as `v1.0.0`. |
| `snapshot` | Immutable template snapshot. |
| `createdAt` | Creation timestamp. |
| `createdBy` | Creator identifier, if available. |

### 18.5 Local Preference and Selection Data

Local-only preference data must include:

- User preferences.
- Default release selection per template.
- Last input values.

This data must not be synchronized.

### 18.6 History Data

History entities:

| Entity | Scope | Synchronization |
|---|---|---|
| API call history | Per template | Not synchronized |
| Database query history | Local metadata only | Not synchronized |
| Action receipts | Local | Not synchronized |

### 18.7 Synchronization Classification

Every persisted entity must be classified as one of:

| Classification | Meaning |
|---|---|
| Synchronized | Included in P2P synchronization. |
| Local-only | Stored locally and never synchronized. |
| Secure-local | Stored or referenced through OS keychain / secure secret storage. |

## 19. Local Backend API Surface

### 19.1 API Design Requirements

The frontend communicates with the backend through secure local HTTP APIs.

Backend API design requirements:

- Use structured JSON request and response bodies.
- Enforce all security rules in the backend.
- Return clear error responses for blocked operations.
- Avoid exposing sensitive values in responses.
- Keep local-only data separate from synchronized workspace data.

### 19.2 API Categories

The local backend should expose APIs for:

- Workspace lifecycle.
- Working tree operations.
- Template CRUD.
- Template release management.
- Release selection.
- Document rendering.
- Batcher rendering.
- Action execution.
- HTTP request execution.
- API history management.
- Database connection and query execution.
- Database export.
- Settings and restrictions.
- P2P device and invitation management.
- Secure credential references.

### 19.3 Required Backend Enforcement Points

| Operation | Backend enforcement |
|---|---|
| HTTP request execution | Allowed domains, proxy rules, credential access |
| Database query execution | Read-only default, dangerous statement blocking, execution mode |
| File write action | Workspace/export folder boundary in sandbox mode |
| Action execution | Confirmation requirement, dangerous action blocking |
| P2P sync | Device identity, allowlist, invitation signature, revocation |
| Credential retrieval | OS keychain / secure secret storage |

## 20. Changelog

### 20.1 Changelog Synchronization

The changelog is synchronized in P2P mode.

Implementation requirements:

- Changelog entries must be persisted in the workspace.
- Changelog entries must be included in P2P synchronization.
- Changelog entries must participate in conflict handling where applicable.

### 20.2 Changelog Purpose

The changelog should support traceability for:

- Template changes.
- Release creation.
- Workspace settings changes.
- Project/folder/tag changes.
- Restriction changes.

## 21. MVP Scope

### 21.1 MVP Product Scope

The MVP should include:

- Desktop application shell with Tauri.
- React + Vite frontend.
- Node.js local backend.
- Secure local HTTP communication.
- Local workspace creation and opening.
- Single `.swaft` SQLite-based workspace file.
- Optional whole-file encryption.
- Working tree always visible.
- Document templates.
- API templates.
- Render templates.
- Template releases with immutable semantic snapshots.
- Release selection through working tree three-dot menu.
- Local-only default release selection.
- Document View.
- API View.
- Render View.
- Temporary document-only batcher.
- Seebo rendering integration.
- Seebo merge macro support in batcher.
- Code-defined actions.
- Action confirmation.
- Action receipts visible in UI.
- Real backend HTTP client.
- Real database client for SQLite and PostgreSQL.
- Workspace execution modes: sandbox and dev.
- OS keychain / secure secret storage for credentials.
- P2P data classification and model support.

### 21.2 MVP Security Scope

The MVP must include:

- Backend enforcement for dangerous operations.
- Sandbox mode restrictions.
- Dev mode permissions.
- Allowed-domain enforcement.
- Database dangerous statement blocking.
- Read-only database default.
- Local-only secrets and credentials.
- Optional whole-file encryption warning.
- Action confirmation enforcement.

### 21.3 MVP UI Scope

The MVP UI must include:

- Always-visible working tree.
- Context menu with:
  - Open.
  - Edit.
  - Rename.
  - Clone.
  - Delete.
  - Select release.
- Document View.
- API View.
- Render View.
- Optional Action Panel for document templates.
- API history UI.
- Database history/export UI.
- Action receipt UI.
- Batcher UI for document templates.

### 21.4 MVP Synchronization Scope

The MVP must preserve the synchronization rules defined in this document.

At minimum, the implementation must correctly classify:

- Synchronized data.
- Local-only data.
- Secure-local data.

P2P implementation must be designed around:

- Real-time synchronization.
- LAN-only, internet, and both network modes.
- Device identities.
- Signed invitations.
- Allowlists.
- Encrypted workspace keys.
- Revocation.
- Last-write-wins conflict resolution.

### 21.5 Explicitly Deferred or Not Required in Version 1

The following are not required in version 1:

- Plugin-defined actions.
- Database masking.
- Treating database results as Seebo inputs.
- Synchronizing histories, secrets, credentials, receipts, preferences, or default release selections.
- API templates represented canonically as cURL.
- Batcher support for API or render templates.

## 22. Open Decisions

### 22.1 HTTP History Scope

Current recommendation:

```text
metadataOnly
```

Open decision:

- Whether HTTP history remains strictly metadata-only or becomes configurable.

Constraints:

- API call history is local-only.
- API call history is not synchronized.
- Sensitive values should not be stored unless explicitly enabled by a future decision.

### 22.2 Server Storage Mode Details

Current decision:

- `server` is a valid storage mode.
- Storage mode is immutable.

Open decision:

- Detailed server storage and synchronization behavior.

Constraints:

- Server mode must not invalidate the local and P2P data-classification model.
- The data model must reserve the `server` storage mode.

### 22.3 Future Plugin Actions

Current decision:

- Actions are defined in code in version 1.

Future direction:

- Plugin-based actions may be considered later.

Constraints:

- Plugin actions are not part of the MVP.
- Any future plugin system must preserve confirmation, execution-mode enforcement, and receipt behavior.

## 23. Documents to Generate

The following detailed documents must be generated from this initial decision document:

- `SWAFT_PRODUCT_SPEC.md`
- `SWAFT_ARCHITECTURE.md`
- `SWAFT_DATA_MODEL.md`
- `SWAFT_UI_SPEC.md`
- `SWAFT_SECURITY_MODEL.md`
- `SWAFT_STORAGE_SYNC_MODEL.md`
- `SWAFT_MVP_SCOPE.md`

## 24. Consolidated Decision Summary

| Area | Decision |
|---|---|
| Product name | Swaft |
| Acronym | Strange Web App for Technician |
| Target | Desktop-first technical app for AM/dev/power users based on Seebo |
| Shell | Tauri |
| Frontend | React + Vite |
| Frontend language | TypeScript recommended |
| Local backend | Node.js |
| Frontend/backend communication | Secure local HTTP APIs |
| Storage modes | `local`, `p2p`, `server` |
| Storage mode mutability | Immutable |
| Local storage | Single SQLite-based `.swaft` file |
| Local encryption | Optional whole-file encryption |
| P2P sync | Real-time |
| P2P network modes | `lanOnly`, `internet`, `both` |
| P2P conflict resolution | Last-write-wins |
| Template types | `document`, `api`, `render` |
| Document view | Input Panel + Main Document View + optional Action Panel |
| API view | Structured HTTP request model |
| Render view | Standalone view-only Render View |
| Working tree | Common to all layouts and always visible |
| Release model | Immutable semantic snapshots with linear versioning |
| Release selection | Working tree three-dot menu; personal; not synchronized |
| Batcher | Temporary; document templates only |
| Actions | Defined in code in v1; generated by Seebo rendering |
| Action confirmation | Always required |
| Perform all | `failFast: true` |
| HTTP client | Real client via backend |
| HTTP auth | Bearer token, Basic auth, API key |
| HTTP allowed domains | Per workspace |
| HTTP proxy | Supported |
| Database client | Real client |
| Initial databases | SQLite, PostgreSQL |
| Database default | Read-only |
| Database dangerous statements | Blocked |
| Database credentials | OS keychain / secure secret storage |
| Database history | Metadata only |
| Database exports | CSV, JSON |
| Database results as Seebo input | No |
| Database masking | Not required v1 |
| Workspace execution modes | `sandbox`, `dev` |

## 25. Final Implementation Notes

Swaft must be implemented according to the decisions in this document.

Key implementation requirements:

- Do not introduce implicit features outside this scope.
- Enforce security in the backend, not only in the UI.
- Preserve local-only and synchronized data boundaries.
- Keep template releases immutable.
- Keep storage mode immutable.
- Use structured models for API templates.
- Require confirmation for all action execution.
- Maintain a desktop-first technical workflow throughout the UI.