/**
 * `.swaft` schema (v2). Encodes the data classification:
 *  - 🟢 **synchronized** entities carry the full sync-metadata column set so a future sync engine can
 *    reconcile them (createdAt/updatedAt/updatedByDeviceId/revision/deletedAt; soft-delete tombstones).
 *  - 🔵 **local-only** tables (e.g. per-template input state) carry NO sync metadata.
 *  - 🟠 **secure-local** data (secrets, the account verifier) is NEVER stored in `.swaft`; it lives in
 *    the OS keychain. The absence of any such table here is part of the contract.
 *
 * The version is stored in SQLite's `user_version` pragma; migrations are forward-only and a newer
 * file version is rejected. v1→v2 (M5) adds organization (folders
 * reshaped to flat collections) + workspace settings + restrictions.
 */

export const SCHEMA_VERSION = 25;

/** Sync-metadata columns present on every 🟢 synchronized entity. */
export const SYNC_META_COLUMNS = [
  'created_at',
  'updated_at',
  'updated_by_device_id',
  'revision',
  'deleted_at',
] as const;

/** 🟢 synchronized tables (carry sync metadata). */
export const SYNCHRONIZED_TABLES = [
  'workspace_meta',
  'projects',
  'folders',
  'tags',
  'workspace_settings',
  'templates',
  'releases',
  'changelog',
  'template_tags',
  'environments',
] as const;

/** 🔵 local-only tables (no sync metadata; never synchronized). */
export const LOCAL_ONLY_TABLES = [
  'local_input_state',
  'release_selection',
  'api_history',
  'api_action_runs',
  'receipts',
  'environment_selection',
  'scenario_runs',
  'scenario_run_steps',
] as const;

/** DDL fragment: the shared sync-metadata columns. */
const SYNC_META_DDL = `
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_device_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  deleted_at TEXT
`;

// Individual table DDL, reused by both the fresh schema and the migration so they never drift.
// v21: folders carry a propagated HTTP policy (`headers` JSON object, `proxy` JSON or NULL) applied
// to every API call beneath them, plus markdown `notes` (the Folder view). v22 adds `auth` (JSON or
// NULL = inherit from the parent chain). v24 adds `actions` (JSON array of request actions run around
// every API call beneath the folder, concatenated down the chain).
const FOLDERS_DDL = `CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_id TEXT,
  parent_folder_id TEXT,
  headers TEXT NOT NULL DEFAULT '{}',
  proxy TEXT,
  auth TEXT,
  actions TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  ${SYNC_META_DDL}
);`;

// v20: outgoing-HTTP restrictions only — blocked domains, enforced proxy and enforced headers.
// v22 adds `batcher_enabled` (hide the Batcher panel when 0).
const SETTINGS_DDL = `CREATE TABLE workspace_settings (
  id TEXT PRIMARY KEY,
  execution_mode TEXT NOT NULL,
  blocked_domains TEXT NOT NULL DEFAULT '[]',
  proxy_url TEXT,
  enforced_headers TEXT NOT NULL DEFAULT '{}',
  batcher_enabled INTEGER NOT NULL DEFAULT 1,
  ${SYNC_META_DDL}
);`;

// `folder_id` is '' for templates that live directly at the project root (no folder); in that case
// `project_id` carries the owning project. Foldered templates derive their project from the folder.
const TEMPLATES_DDL = `CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL,
  project_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  subtype TEXT,
  source TEXT NOT NULL,
  has_draft INTEGER NOT NULL DEFAULT 1,
  ${SYNC_META_DDL}
);`;

// M7/redesign: named, in-place-editable releases + a changelog + a local-only release selection.
// `version` is kept as an internal, stable ordering key; `name` is the user-facing identifier.
const RELEASES_DDL = `CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  subtype TEXT,
  ${SYNC_META_DDL}
);`;

const CHANGELOG_DDL = `CREATE TABLE changelog (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  message TEXT NOT NULL,
  username TEXT,
  ${SYNC_META_DDL}
);`;

const RELEASE_SELECTION_DDL = `CREATE TABLE release_selection (
  template_id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

// M8: 🔵 local-only, metadata-only API history (never the request/response bodies).
const API_HISTORY_DDL = `CREATE TABLE api_history (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  status INTEGER,
  created_at TEXT NOT NULL
);`;

// 🔵 local-only: what a request's pre/post actions did, kept as a history alongside api_history.
const API_ACTION_RUNS_DDL = `CREATE TABLE api_action_runs (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  output TEXT,
  logs TEXT,
  env_writes TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);`;

// Tags: 🟢 synchronized many-to-many between templates and the reusable workspace tags.
const TEMPLATE_TAGS_DDL = `CREATE TABLE template_tags (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  ${SYNC_META_DDL}
);`;

// Environments: 🟢 synchronized named variable sets. `owner_kind` scopes each environment to the
// current user (personal), the workspace (shared), or a specific project; `owner_id` carries the
// username / null / project id respectively. `vars` is a JSON object (string → string) — plain
// (non-secret) values, read by the `env(...)` Seebo data capability.
const ENVIRONMENTS_DDL = `CREATE TABLE environments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  owner_kind TEXT NOT NULL,
  owner_id TEXT,
  vars TEXT NOT NULL DEFAULT '{}',
  ${SYNC_META_DDL}
);`;

// 🔵 local-only: the single active environment for this workspace (per device/user, never synced).
const ENVIRONMENT_SELECTION_DDL = `CREATE TABLE environment_selection (
  id TEXT PRIMARY KEY,
  environment_id TEXT,
  updated_at TEXT NOT NULL
);`;

// M10: 🔵 local-only, redacted action receipts (never the action input values).
const RECEIPTS_DDL = `CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  environment TEXT NOT NULL,
  created_at TEXT NOT NULL
);`;

// Scenarios (M11): 🔵 local-only run history for a scenario workflow. A `scenario_runs` row groups the
// per-node `scenario_run_steps` of one run. Redacted like the other histories: step output is a
// truncated snapshot for display, API steps keep method/url/status (never bodies), inputs are never
// stored. Keyed by the scenario template id — the run history lives on the scenario, not its blocks.
const SCENARIO_RUNS_DDL = `CREATE TABLE scenario_runs (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  start_node_id TEXT,
  step_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);`;

const SCENARIO_RUN_STEPS_DDL = `CREATE TABLE scenario_run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  alias TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  method TEXT,
  url TEXT,
  http_status INTEGER,
  message TEXT,
  output TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);`;

/** Full schema DDL for a fresh workspace (current version). */
export const SCHEMA_DDL = `
CREATE TABLE workspace_meta (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  storage_mode TEXT NOT NULL,
  execution_mode TEXT NOT NULL,
  device_id TEXT NOT NULL,
  ${SYNC_META_DDL}
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  description TEXT,
  ${SYNC_META_DDL}
);

${FOLDERS_DDL}

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  ${SYNC_META_DDL}
);

${SETTINGS_DDL}

${TEMPLATES_DDL}

${RELEASES_DDL}

${CHANGELOG_DDL}

-- 🔵 local-only: per-template last input values. No sync metadata; never synchronized.
CREATE TABLE local_input_state (
  template_id TEXT PRIMARY KEY,
  values_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

${RELEASE_SELECTION_DDL}

${API_HISTORY_DDL}

${API_ACTION_RUNS_DDL}

${RECEIPTS_DDL}

${TEMPLATE_TAGS_DDL}

${ENVIRONMENTS_DDL}

${ENVIRONMENT_SELECTION_DDL}

${SCENARIO_RUNS_DDL}

${SCENARIO_RUN_STEPS_DDL}
`;

/**
 * Forward-only migrations, keyed by the version they upgrade TO. Applied in order for a file opened
 * at a lower version. Fresh workspaces are created directly at SCHEMA_VERSION and skip these.
 */
export const MIGRATIONS: { to: number; sql: string }[] = [
  {
    to: 2,
    // v1 had `folders(project_id)` (never populated) and no settings/restrictions tables.
    // NOTE: migrations are frozen snapshots — this creates the *v2-era* settings table (without the
    // allowed_types/subtypes added in v3, which the `to: 3` step adds via ALTER).
    sql: `
      DROP TABLE IF EXISTS folders;
      CREATE TABLE folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ${SYNC_META_DDL}
      );
      CREATE TABLE workspace_settings (
        id TEXT PRIMARY KEY,
        execution_mode TEXT NOT NULL,
        allowed_domains TEXT NOT NULL,
        allowed_actions TEXT NOT NULL,
        allowed_capabilities TEXT NOT NULL,
        proxy_url TEXT,
        file_export_root TEXT,
        ${SYNC_META_DDL}
      );
      CREATE TABLE restrictions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        ${SYNC_META_DDL}
      );
    `,
  },
  {
    to: 3,
    // v3 adds a workspace icon + allowed type/subtype restriction lists.
    sql: `
      ALTER TABLE workspace_meta ADD COLUMN icon TEXT;
      ALTER TABLE workspace_settings ADD COLUMN allowed_types TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE workspace_settings ADD COLUMN allowed_subtypes TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    to: 4,
    // v4 scopes folders to a project.
    sql: `ALTER TABLE folders ADD COLUMN project_id TEXT;`,
  },
  {
    to: 5,
    // v5 adds templates (document/render/api/db) living in folders.
    // NOTE: frozen snapshot — the v5-era table had no `has_draft` (added by the `to: 14` step).
    sql: `CREATE TABLE templates (
      id TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      subtype TEXT,
      source TEXT NOT NULL,
      ${SYNC_META_DDL}
    );`,
  },
  {
    to: 6,
    // v6 adds releases, a changelog, and a local-only release selection.
    // NOTE: frozen snapshot — the v6-era releases table had no `name` column (added by the `to: 10`
    // step), so it is inlined here rather than referencing the current RELEASES_DDL.
    sql: `
      CREATE TABLE releases (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        source TEXT NOT NULL,
        subtype TEXT,
        ${SYNC_META_DDL}
      );
      CREATE TABLE changelog (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        message TEXT NOT NULL,
        ${SYNC_META_DDL}
      );
      ${RELEASE_SELECTION_DDL}
    `,
  },
  {
    to: 7,
    // v7 adds local-only, metadata-only API history.
    sql: API_HISTORY_DDL,
  },
  {
    to: 8,
    // v8 added local-only, metadata-only DB query history (frozen snapshot — the DB client and its
    // table were removed again in v19).
    sql: `CREATE TABLE db_history (
      id TEXT PRIMARY KEY,
      engine TEXT NOT NULL,
      sql TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`,
  },
  {
    to: 9,
    // v9 adds local-only, redacted action receipts.
    sql: RECEIPTS_DDL,
  },
  {
    to: 10,
    // v10 makes releases user-named (in-place editable): add the `name` identifier column.
    sql: `ALTER TABLE releases ADD COLUMN name TEXT NOT NULL DEFAULT '';`,
  },
  {
    to: 11,
    // v11 allows folders to nest inside other folders.
    sql: `ALTER TABLE folders ADD COLUMN parent_folder_id TEXT;`,
  },
  {
    to: 12,
    // v12 attributes changelog entries to the acting user.
    sql: `ALTER TABLE changelog ADD COLUMN username TEXT;`,
  },
  {
    to: 13,
    // v13 adds the template↔tag many-to-many relation.
    sql: TEMPLATE_TAGS_DDL,
  },
  {
    to: 14,
    // v14 lets the editable Draft version be deleted (leaving only releases).
    sql: `ALTER TABLE templates ADD COLUMN has_draft INTEGER NOT NULL DEFAULT 1;`,
  },
  {
    to: 15,
    // v15 gives projects an optional description (shown under the active project name).
    sql: `ALTER TABLE projects ADD COLUMN description TEXT;`,
  },
  {
    to: 16,
    // v16 lets templates live at the project root (folder_id = '', project_id = owning project).
    sql: `ALTER TABLE templates ADD COLUMN project_id TEXT;`,
  },
  {
    to: 17,
    // v17 folds the `render` type into `document` (its subtypes are now document subtypes).
    sql: `UPDATE templates SET type = 'document' WHERE type = 'render';`,
  },
  {
    to: 18,
    // v18 adds environments (named variable sets, read by the `env(...)` capability) + the local-only
    // active-environment selection.
    sql: `
      ${ENVIRONMENTS_DDL}
      ${ENVIRONMENT_SELECTION_DDL}
    `,
  },
  {
    to: 19,
    // v19 removes the read-only database client: drop its query history and fold any stray reserved
    // `database` templates (never creatable from the UI) into `document`.
    sql: `
      DROP TABLE IF EXISTS db_history;
      UPDATE templates SET type = 'document' WHERE type = 'database';
    `,
  },
  {
    to: 20,
    // v20 narrows restrictions to outgoing-HTTP policy only: drops the type/subtype/capability/
    // action allow-lists, the export root and the restrictions table; the domains list becomes a
    // BLOCK-list (semantics inverted, so the old allow-list values are dropped, not carried over)
    // and enforced request headers are added.
    sql: `
      ALTER TABLE workspace_settings DROP COLUMN allowed_types;
      ALTER TABLE workspace_settings DROP COLUMN allowed_subtypes;
      ALTER TABLE workspace_settings DROP COLUMN allowed_capabilities;
      ALTER TABLE workspace_settings DROP COLUMN allowed_actions;
      ALTER TABLE workspace_settings DROP COLUMN allowed_domains;
      ALTER TABLE workspace_settings DROP COLUMN file_export_root;
      ALTER TABLE workspace_settings ADD COLUMN blocked_domains TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE workspace_settings ADD COLUMN enforced_headers TEXT NOT NULL DEFAULT '{}';
      DROP TABLE IF EXISTS restrictions;
    `,
  },
  {
    to: 21,
    // v21 gives folders a propagated HTTP policy (headers + proxy for the API calls beneath them)
    // and markdown notes, backing the Folder view.
    sql: `
      ALTER TABLE folders ADD COLUMN headers TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE folders ADD COLUMN proxy TEXT;
      ALTER TABLE folders ADD COLUMN notes TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    to: 22,
    // v22 adds folder-propagated auth (NULL = inherit from the parent chain) and the Batcher toggle.
    sql: `
      ALTER TABLE folders ADD COLUMN auth TEXT;
      ALTER TABLE workspace_settings ADD COLUMN batcher_enabled INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    to: 23,
    // v23 keeps a local-only history of what each request's pre/post actions did.
    sql: API_ACTION_RUNS_DDL,
  },
  {
    to: 24,
    // v24 gives folders propagated actions (pre/post actions run around every API call beneath them,
    // concatenated down the chain), like the headers/proxy/auth policy.
    sql: `ALTER TABLE folders ADD COLUMN actions TEXT NOT NULL DEFAULT '[]';`,
  },
  {
    to: 25,
    // v25 adds the scenario workflow run history (local-only): a run + its per-node steps.
    sql: `${SCENARIO_RUNS_DDL}\n${SCENARIO_RUN_STEPS_DDL}`,
  },
];
