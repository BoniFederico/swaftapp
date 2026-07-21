import { z } from 'zod';

/**
 * Op (operation) contract registry shared by renderer (API client) and main (IPC router + dispatch).
 * Each op has a stable name, a **request schema** (validated in the main process before any handler
 * runs — IPC-5) and a response DTO. The transport is irrelevant to this contract (IPC now, HTTP
 * later) — see SWAFT_ARCHITECTURE.md §3.4, §5; SWAFT_SECURITY_MODEL.md §3.
 *
 * M3 adds the **auth/session** ops. `auth.*` sign-in/sign-up/unlock + `system.ping` are PUBLIC
 * (callable without a session); every other op requires an active session (enforced in main).
 */

// --- Request schemas (validated) --------------------------------------------

/** `.strict()` rejects unknown keys, so malformed payloads are caught at the boundary. */
export const pingRequestSchema = z.object({ echo: z.string().optional() }).strict();

/** Empty, strict payload for ops that take no arguments. */
export const emptyRequestSchema = z.object({}).strict();

export const signUpRequestSchema = z
  .object({
    username: z.string().trim().min(3).max(64),
    displayName: z.string().trim().min(1).max(120).optional(),
    password: z.string().min(8).max(256),
  })
  .strict();

export const signInRequestSchema = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(256),
  })
  .strict();

export const unlockRequestSchema = z
  .object({
    password: z.string().min(1).max(256),
  })
  .strict();

// --- M4: preferences + workspace + native dialogs ---------------------------

export const preferencesSchema = z
  .object({
    themeMode: z.string().max(32).optional(),
    primaryColor: z.string().max(32).optional(),
    font: z.string().max(32).optional(),
    language: z.string().max(8).optional(),
    /** Double-clicking a Working Tree template: pin its tab (classic) or open the editor. */
    treeDoubleClick: z.enum(['pin', 'edit']).optional(),
  })
  .strict();

export const workspaceUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    icon: z.string().max(16).nullable().optional(),
  })
  .strict();

export const executionModeSchema = z.enum(['sandbox', 'dev']);

export const workspaceCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    location: z.string().min(1),
    encrypt: z.boolean(),
    password: z.string().min(8).max(256).optional(),
    executionMode: executionModeSchema.optional(),
  })
  .strict();

export const workspaceOpenRequestSchema = z
  .object({
    path: z.string().min(1),
    password: z.string().min(1).max(256).optional(),
  })
  .strict();

export const dialogCreateTargetRequestSchema = z
  .object({ defaultName: z.string().max(120).optional() })
  .strict();

// --- M5: workspace organization + settings ----------------------------------

const entityNameSchema = z.string().trim().min(1).max(120);
const entityColorSchema = z.string().max(32).optional();

export const nameColorRequestSchema = z
  .object({ name: entityNameSchema, color: entityColorSchema })
  .strict();
export const projectCreateRequestSchema = z
  .object({
    name: entityNameSchema,
    color: entityColorSchema,
    description: z.string().trim().max(2000).optional(),
  })
  .strict();
export const folderCreateRequestSchema = z
  .object({
    name: entityNameSchema,
    projectId: z.string().min(1),
    parentFolderId: z.string().min(1).nullable().optional(),
  })
  .strict();
export const folderMoveRequestSchema = z
  .object({ folderId: z.string().min(1), parentFolderId: z.string().min(1).nullable() })
  .strict();
export const templateMoveRequestSchema = z
  .object({
    templateId: z.string().min(1),
    // `null` folderId moves the template to the project root (then `projectId` is required).
    folderId: z.string().min(1).nullable(),
    projectId: z.string().min(1).optional(),
  })
  .strict();
export const templateTagAddRequestSchema = z
  .object({ templateId: z.string().min(1), name: entityNameSchema })
  .strict();
export const templateTagRemoveRequestSchema = z
  .object({ templateId: z.string().min(1), tagId: z.string().min(1) })
  .strict();
export const renameRequestSchema = z
  .object({ id: z.string().min(1), name: entityNameSchema })
  .strict();
export const idRequestSchema = z.object({ id: z.string().min(1) }).strict();

/** An outgoing-HTTP header name (RFC 7230 token). */
const headerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, 'Invalid header name.');

/** Where an API-key auth goes on the outgoing request. */
export const authPlacementSchema = z.enum(['header', 'query']);
/**
 * Request/folder authentication (M8, reworked). `inherit` resolves to the nearest folder-defined
 * auth up the chain at send time. String fields (username/password/token/key/value) may carry Seebo
 * `${ … }` formulas. `secretRef`/`headerName` are the legacy keychain-backed shape, still honored by
 * the HTTP client.
 */
export const httpAuthSchema = z
  .object({
    kind: z.enum(['none', 'inherit', 'bearer', 'basic', 'apikey']),
    username: z.string().max(1024).optional(),
    password: z.string().max(4096).optional(),
    token: z.string().max(4096).optional(),
    /** API-key name (header name or query-param name, per `placement`). */
    key: z.string().max(256).optional(),
    value: z.string().max(4096).optional(),
    placement: authPlacementSchema.optional(),
    /** Legacy: reference into the OS keychain — the renderer never sees the secret value. */
    secretRef: z.string().max(64).optional(),
    /** Legacy alias of `key` for header API keys. */
    headerName: z.string().max(64).optional(),
  })
  .strict();

/** A folder's propagated proxy for the API calls beneath it (null/absent = direct connection).
 * The hostname may carry Seebo `${ … }` formulas, rendered when the request is resolved. */
export const folderProxySchema = z
  .object({
    protocol: z.enum(['http', 'https']),
    hostname: z.string().trim().min(1).max(1024),
    port: z.number().int().min(1).max(65535),
  })
  .strict();

/**
 * An action attached to a request (or a folder, propagated to the calls beneath it), run around the
 * HTTP call. `pre` may return a patch merged into the request (signing it, refreshing a token);
 * `post` sees the response (extracting values, asserting). Declaring `action(...)` inside a *field*
 * stays forbidden — effects live here, not in the formulas (analisi_codice_utente.md §5.6).
 */
export const requestActionSchema = z
  .object({
    /** Name of the `action` template to run. */
    ref: z.string().trim().min(1).max(120),
    trigger: z.enum(['pre', 'post']),
    /** Values passed as `input`; may carry Seebo `${ … }` formulas. */
    input: z.record(z.string().max(4096)).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

/** Partial update of a folder's propagated HTTP policy + notes (the Folder view tabs). */
export const folderUpdateRequestSchema = z
  .object({
    id: z.string().min(1),
    /** Headers propagated to every API call in the folder; values may carry Seebo formulas. */
    headers: z.record(headerNameSchema, z.string().max(4096)).optional(),
    proxy: folderProxySchema.nullable().optional(),
    /** Auth propagated to every API call in the folder (null = inherit from the parent chain). */
    auth: httpAuthSchema.nullable().optional(),
    /** Actions propagated to every API call in the folder (concatenated down the parent chain). */
    actions: z.array(requestActionSchema).max(16).optional(),
    /** Markdown documentation for the folder. */
    notes: z.string().max(200_000).optional(),
  })
  .strict();

export const settingsUpdateSchema = z
  .object({
    executionMode: executionModeSchema.optional(),
    /** Show the Batcher panel under the Working Tree (false hides the whole section). */
    batcherEnabled: z.boolean().optional(),
    /** Hosts outgoing HTTP requests may NOT target (anchored host match, empty = allow all). */
    blockedDomains: z.array(z.string().trim().min(1).max(253)).optional(),
    /** Proxy every outgoing HTTP request through this URL (null = direct). */
    proxyUrl: z.string().nullable().optional(),
    /** Headers force-applied to every outgoing HTTP request (override the request's own). */
    enforcedHeaders: z.record(headerNameSchema, z.string().max(4096)).optional(),
    /** Required to switch execution mode to `dev` (a guarded action). */
    confirmDev: z.boolean().optional(),
  })
  .strict();

// --- M6: templates + Seebo rendering ----------------------------------------

// Template kinds. `render` was folded into `document` (its subtypes — mermaid/swagger/echarts — are
// now document subtypes that render in the output). `capability` and `action` are user-authored
// JavaScript: the first resolves data for a formula, the second is an effect (analisi_codice_utente.md).
export const templateTypeSchema = z.enum(['document', 'api', 'capability', 'action']);

export const templateCreateRequestSchema = z
  .object({
    // Omit `folderId` (or pass null) to create at the project root; then `projectId` is required.
    folderId: z.string().min(1).nullable().optional(),
    projectId: z.string().min(1).optional(),
    name: entityNameSchema,
    type: templateTypeSchema.optional(),
    subtype: z.string().max(64).optional(),
    source: z.string().max(200_000).optional(),
  })
  .strict();

export const templateUpdateSourceRequestSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().max(200_000),
    subtype: z.string().max(64).nullable().optional(),
  })
  .strict();

export const templateRenderRequestSchema = z
  .object({ id: z.string().min(1), values: z.record(z.unknown()) })
  .strict();

/** Free-text search across template names and contents (draft + release sources). */
export const templateSearchRequestSchema = z
  .object({ query: z.string().trim().min(1).max(512) })
  .strict();

export const inputStateGetRequestSchema = z.object({ templateId: z.string().min(1) }).strict();
export const inputStateSetRequestSchema = z
  .object({ templateId: z.string().min(1), values: z.record(z.unknown()) })
  .strict();

// --- M7: releases, changelog, release selection, editor feedback ------------

export const templateRefRequestSchema = z.object({ templateId: z.string().min(1) }).strict();
export const releaseSelectionSetRequestSchema = z
  .object({ templateId: z.string().min(1), releaseId: z.string().min(1) })
  .strict();
export const sourceRequestSchema = z.object({ source: z.string().max(200_000) }).strict();
export const renderSourceRequestSchema = z
  .object({ source: z.string().max(200_000), values: z.record(z.unknown()).default({}) })
  .strict();
export const releaseCreateRequestSchema = z
  .object({
    templateId: z.string().min(1),
    name: entityNameSchema,
    // When omitted, the new release snapshots the saved draft; the editor passes the current content.
    source: z.string().max(200_000).optional(),
    subtype: z.string().max(64).nullable().optional(),
  })
  .strict();
export const releaseUpdateRequestSchema = z
  .object({
    releaseId: z.string().min(1),
    source: z.string().max(200_000),
    subtype: z.string().max(64).nullable().optional(),
  })
  .strict();
export const releaseDeleteRequestSchema = z.object({ releaseId: z.string().min(1) }).strict();

// --- M8: API templates + HTTP client ----------------------------------------

export const httpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
export const bodyTypeSchema = z.enum(['none', 'json', 'form', 'text', 'xml']);
export const httpRequestSchema = z
  .object({
    method: httpMethodSchema,
    url: z.string().min(1).max(4096),
    headers: z.record(z.string()).optional(),
    query: z.record(z.string()).optional(),
    body: z.string().max(1_000_000).nullable().optional(),
    /** The body editor's chosen content kind (drives highlighting + the Content-Type header). */
    bodyType: bodyTypeSchema.optional(),
    /** Free-text Markdown documentation for the request (the "Information" tab). */
    info: z.string().max(100_000).optional(),
    auth: httpAuthSchema.optional(),
    /** Actions run before/after the call (see {@link requestActionSchema}). */
    actions: z.array(requestActionSchema).max(16).optional(),
  })
  .strict();
export const httpSendRequestSchema = z
  .object({
    templateId: z.string().optional(),
    request: httpRequestSchema,
    /** Input values resolving the request fields' `${ … }` Seebo formulas (when `templateId` is set). */
    values: z.record(z.unknown()).optional(),
  })
  .strict();
/** Analyze a request's formula fields → the input widgets they need (live, on the in-memory request). */
export const apiAnalyzeRequestSchema = z
  .object({
    templateId: z.string().min(1),
    request: httpRequestSchema,
    /** Current input values, so lazily-gated inputs are pruned / revealed progressively. */
    values: z.record(z.unknown()).optional(),
  })
  .strict();
export const secretSetRequestSchema = z
  .object({ ref: z.string().trim().min(1).max(64), value: z.string().max(4096) })
  .strict();

// --- User code: capabilities authored in JavaScript -------------------------

/** Inspect a `capability` template: the name it registers under and whether it is usable. */
export const userCodeRefRequestSchema = z.object({ templateId: z.string().min(1) }).strict();
/** Clear a request's persisted action history — optionally just one trigger. */
export const apiActionsClearRequestSchema = z
  .object({ templateId: z.string().min(1), trigger: z.enum(['pre', 'post']).optional() })
  .strict();
/** Run a `capability` template once from its editor, with the arguments a formula would pass. */
export const userCodeRunRequestSchema = z
  .object({
    templateId: z.string().min(1),
    /** A capability call's descriptor fields, or an action's `input`. */
    args: z.record(z.unknown()).optional(),
    /** Actions: ask what it *would* do instead of doing it. */
    dryRun: z.boolean().optional(),
  })
  .strict();

// --- M10: batcher + actions -------------------------------------------------

export const batchAnalyzeRequestSchema = z
  .object({ templateIds: z.array(z.string().min(1)).min(1) })
  .strict();
export const batchRenderRequestSchema = z
  .object({
    templateIds: z.array(z.string().min(1)).min(1),
    values: z.record(z.unknown()).default({}),
  })
  .strict();

export const actionExecuteRequestSchema = z
  .object({
    templateId: z.string().min(1),
    confirmedActions: z.array(z.string()).default([]),
    failFast: z.boolean().default(true),
    dryRun: z.boolean().default(false),
  })
  .strict();

// --- Environments (variable sets read by the `env(...)` capability) ----------

/** Who an environment belongs to: the current user (personal) or the whole workspace. */
export const environmentOwnerKindSchema = z.enum(['user', 'workspace']);

/** A single environment variable's key (identifier-like, so it maps cleanly to `env('KEY')`). */
const envVarKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/, 'Use letters, digits, _ . - (must start with a letter or _).');
const envVarsSchema = z.record(envVarKeySchema, z.string().max(8192));

export const envCreateRequestSchema = z
  .object({
    name: entityNameSchema,
    description: z.string().trim().max(2000).optional(),
    ownerKind: environmentOwnerKindSchema,
  })
  .strict();

export const envUpdateRequestSchema = z
  .object({
    id: z.string().min(1),
    name: entityNameSchema.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    vars: envVarsSchema.optional(),
  })
  .strict();

export const envSelectionSetRequestSchema = z
  .object({ environmentId: z.string().min(1).nullable() })
  .strict();

/** The canonical list of op names. The IPC router allow-list is derived from this. */
export const OP_NAMES = [
  'system.ping',
  'auth.status',
  'auth.signUp',
  'auth.signIn',
  'auth.unlock',
  'auth.signOut',
  'auth.lock',
  'session.whoami',
  'prefs.get',
  'prefs.set',
  'workspace.create',
  'workspace.open',
  'workspace.close',
  'workspace.current',
  'workspace.update',
  'workspace.recent',
  'dialog.createTarget',
  'dialog.openTarget',
  'tree.get',
  'project.create',
  'project.rename',
  'project.delete',
  'folder.create',
  'folder.rename',
  'folder.delete',
  'folder.move',
  'folder.get',
  'folder.update',
  'template.move',
  'tag.list',
  'template.tags.list',
  'template.tags.add',
  'template.tags.remove',
  'tag.create',
  'tag.delete',
  'settings.get',
  'settings.update',
  'template.create',
  'template.rename',
  'template.delete',
  'template.get',
  'template.search',
  'template.updateSource',
  'template.deleteDraft',
  'template.analyze',
  'template.render',
  'inputState.get',
  'inputState.set',
  'release.create',
  'release.update',
  'release.delete',
  'release.list',
  'changelog.list',
  'releaseSelection.get',
  'releaseSelection.set',
  'render.analyzeSource',
  'render.validateSource',
  'render.renderSource',
  'http.send',
  'api.analyze',
  'usercode.describe',
  'usercode.run',
  'usercode.untrusted',
  'usercode.trust',
  'api.history.list',
  'api.history.clear',
  'api.actions.list',
  'api.actions.clear',
  'api.history.delete',
  'secret.set',
  'secret.list',
  'batch.analyze',
  'batch.render',
  'action.execute',
  'receipt.list',
  'env.list',
  'env.get',
  'env.create',
  'env.update',
  'env.delete',
  'env.selection.get',
  'env.selection.set',
] as const;
export type OpName = (typeof OP_NAMES)[number];

/** op name → request schema. Dispatch validates the incoming payload against this. */
export const OP_REQUEST_SCHEMAS: Record<OpName, z.ZodTypeAny> = {
  'system.ping': pingRequestSchema,
  'auth.status': emptyRequestSchema,
  'auth.signUp': signUpRequestSchema,
  'auth.signIn': signInRequestSchema,
  'auth.unlock': unlockRequestSchema,
  'auth.signOut': emptyRequestSchema,
  'auth.lock': emptyRequestSchema,
  'session.whoami': emptyRequestSchema,
  'prefs.get': emptyRequestSchema,
  'prefs.set': preferencesSchema,
  'workspace.create': workspaceCreateRequestSchema,
  'workspace.open': workspaceOpenRequestSchema,
  'workspace.close': emptyRequestSchema,
  'workspace.current': emptyRequestSchema,
  'workspace.update': workspaceUpdateRequestSchema,
  'workspace.recent': emptyRequestSchema,
  'dialog.createTarget': dialogCreateTargetRequestSchema,
  'dialog.openTarget': emptyRequestSchema,
  'tree.get': emptyRequestSchema,
  'project.create': projectCreateRequestSchema,
  'project.rename': renameRequestSchema,
  'project.delete': idRequestSchema,
  'folder.create': folderCreateRequestSchema,
  'folder.rename': renameRequestSchema,
  'folder.delete': idRequestSchema,
  'folder.move': folderMoveRequestSchema,
  'folder.get': idRequestSchema,
  'folder.update': folderUpdateRequestSchema,
  'template.move': templateMoveRequestSchema,
  'tag.list': emptyRequestSchema,
  'template.tags.list': templateRefRequestSchema,
  'template.tags.add': templateTagAddRequestSchema,
  'template.tags.remove': templateTagRemoveRequestSchema,
  'tag.create': nameColorRequestSchema,
  'tag.delete': idRequestSchema,
  'settings.get': emptyRequestSchema,
  'settings.update': settingsUpdateSchema,
  'template.create': templateCreateRequestSchema,
  'template.rename': renameRequestSchema,
  'template.delete': idRequestSchema,
  'template.get': idRequestSchema,
  'template.search': templateSearchRequestSchema,
  'template.updateSource': templateUpdateSourceRequestSchema,
  'template.deleteDraft': idRequestSchema,
  'template.analyze': idRequestSchema,
  'template.render': templateRenderRequestSchema,
  'inputState.get': inputStateGetRequestSchema,
  'inputState.set': inputStateSetRequestSchema,
  'release.create': releaseCreateRequestSchema,
  'release.update': releaseUpdateRequestSchema,
  'release.delete': releaseDeleteRequestSchema,
  'release.list': templateRefRequestSchema,
  'changelog.list': templateRefRequestSchema,
  'releaseSelection.get': templateRefRequestSchema,
  'releaseSelection.set': releaseSelectionSetRequestSchema,
  'render.analyzeSource': sourceRequestSchema,
  'render.validateSource': sourceRequestSchema,
  'render.renderSource': renderSourceRequestSchema,
  'http.send': httpSendRequestSchema,
  'api.analyze': apiAnalyzeRequestSchema,
  'usercode.describe': userCodeRefRequestSchema,
  'usercode.run': userCodeRunRequestSchema,
  'usercode.untrusted': emptyRequestSchema,
  'usercode.trust': userCodeRefRequestSchema,
  'api.history.list': templateRefRequestSchema,
  'api.history.clear': templateRefRequestSchema,
  'api.actions.list': templateRefRequestSchema,
  'api.actions.clear': apiActionsClearRequestSchema,
  'api.history.delete': idRequestSchema,
  'secret.set': secretSetRequestSchema,
  'secret.list': emptyRequestSchema,
  'batch.analyze': batchAnalyzeRequestSchema,
  'batch.render': batchRenderRequestSchema,
  'action.execute': actionExecuteRequestSchema,
  'receipt.list': templateRefRequestSchema,
  'env.list': emptyRequestSchema,
  'env.get': idRequestSchema,
  'env.create': envCreateRequestSchema,
  'env.update': envUpdateRequestSchema,
  'env.delete': idRequestSchema,
  'env.selection.get': emptyRequestSchema,
  'env.selection.set': envSelectionSetRequestSchema,
};

/**
 * Ops callable WITHOUT an authenticated session (auth + minimal bootstrap). Everything else is
 * session-guarded in the main process (SWAFT_SECURITY_MODEL.md §3a). This list is the contract;
 * enforcement lives in main (never the renderer).
 */
export const PUBLIC_OP_NAMES = [
  'system.ping',
  'auth.status',
  'auth.signUp',
  'auth.signIn',
  'auth.unlock',
] as const satisfies readonly OpName[];

export function isPublicOp(name: string): boolean {
  return (PUBLIC_OP_NAMES as readonly string[]).includes(name);
}

/** True when an op may only run with an active session. */
export function requiresSession(name: OpName): boolean {
  return !isPublicOp(name);
}

// --- Request/response DTOs --------------------------------------------------

export type PingRequest = z.infer<typeof pingRequestSchema>;

export interface PingResponse {
  pong: true;
  echo: string;
  /** Server (main-process) timestamp, ISO-8601. */
  ts: string;
}

export type SignUpRequest = z.infer<typeof signUpRequestSchema>;
export type SignInRequest = z.infer<typeof signInRequestSchema>;
export type UnlockRequest = z.infer<typeof unlockRequestSchema>;
export type EmptyRequest = z.infer<typeof emptyRequestSchema>;

/** Authentication / session lifecycle state surfaced to the renderer. */
export type AuthState = 'needs-setup' | 'signed-out' | 'locked' | 'signed-in';

/** Non-secret account profile. NEVER carries the password/verifier. */
export interface AuthProfile {
  username: string;
  displayName: string;
}

/** The shape returned by every auth op + `auth.status`: the current state and (if any) profile. */
export interface AuthStatusResponse {
  state: AuthState;
  /** Present once an account exists (signed-out/locked/signed-in); null on `needs-setup`. */
  profile: AuthProfile | null;
}

export interface WhoamiResponse {
  profile: AuthProfile;
  /** When the active session began, ISO-8601. */
  sessionSince: string;
}

// --- M4 DTOs ----------------------------------------------------------------

/** Workspace storage backend. Only `local` is enabled in the MVP; the others are reserved. */
export type StorageMode = 'local' | 'p2p' | 'server';
export type ExecutionMode = z.infer<typeof executionModeSchema>;

/** Local-only UI preferences (theme/color/language). Opaque strings; the renderer interprets them. */
export type Preferences = z.infer<typeof preferencesSchema>;

export type PrefsSetRequest = Preferences;
export interface PrefsResponse {
  preferences: Preferences;
}

export type WorkspaceCreateRequest = z.infer<typeof workspaceCreateRequestSchema>;
export type WorkspaceOpenRequest = z.infer<typeof workspaceOpenRequestSchema>;
export type DialogCreateTargetRequest = z.infer<typeof dialogCreateTargetRequestSchema>;

/** Non-secret summary of the open workspace surfaced to the renderer. */
export interface WorkspaceSummary {
  name: string;
  /** Short icon/emoji for the workspace, or null. */
  icon: string | null;
  /** Absolute path of the `.swaft` file. */
  path: string;
  storageMode: StorageMode;
  executionMode: ExecutionMode;
  encrypted: boolean;
}

export type WorkspaceUpdateRequest = z.infer<typeof workspaceUpdateRequestSchema>;

export interface RecentWorkspace {
  path: string;
  name: string;
  encrypted: boolean;
  /** ISO-8601 of the last successful open. */
  lastOpenedAt: string;
}

export interface WorkspaceResponse {
  workspace: WorkspaceSummary | null;
}

export interface RecentWorkspacesResponse {
  items: RecentWorkspace[];
}

export interface DialogPathResponse {
  /** The chosen absolute path, or null if the user cancelled. */
  path: string | null;
}

// --- M5 DTOs ----------------------------------------------------------------

export interface ProjectDto {
  id: string;
  name: string;
  color: string | null;
  /** Optional free-text description, shown under the active project name. */
  description: string | null;
}
export interface FolderDto {
  id: string;
  name: string;
  projectId: string;
  parentFolderId: string | null;
}
export type FolderProxyDto = z.infer<typeof folderProxySchema>;
export type AuthPlacement = z.infer<typeof authPlacementSchema>;
/** Full folder incl. its propagated HTTP policy + markdown notes (the Folder view). */
export interface FolderDetailDto extends FolderDto {
  /** Headers propagated to every API call in the folder (values may carry Seebo formulas). */
  headers: Record<string, string>;
  /** Proxy propagated to every API call in the folder (null = direct connection). */
  proxy: FolderProxyDto | null;
  /** Auth propagated to every API call in the folder (null = inherit from the parent chain). */
  auth: HttpAuth | null;
  /** The concrete auth this folder would inherit from its ancestors (for `inherit` previews). */
  inheritedAuth: HttpAuth | null;
  /** Actions propagated to every API call in the folder (this folder's own, applied after inherited). */
  actions: RequestAction[];
  /** Actions this folder inherits from its ancestors, in apply order (root-most first), read-only. */
  inheritedActions: RequestAction[];
  /** Markdown documentation for the folder. */
  notes: string;
}
export interface TagDto {
  id: string;
  name: string;
  color: string | null;
}

export type TemplateType = z.infer<typeof templateTypeSchema>;

/** Lightweight template entry for the Working Tree (no source). */
export interface TemplateSummary {
  id: string;
  /** The containing folder, or null when the template lives at the project root. */
  folderId: string | null;
  /** The owning project for root templates (null when the template lives in a folder). */
  projectId: string | null;
  name: string;
  type: TemplateType;
  subtype: string | null;
  /** Ids of the tags assigned to this template (for the Tags grouping view + badges). */
  tagIds: string[];
  /** HTTP method for `api` templates (shown as the row badge), else null. */
  method: string | null;
}

/** Full template incl. its draft source. */
export interface TemplateDto extends TemplateSummary {
  source: string;
  /** Whether the editable Draft version still exists (it can be deleted, leaving only releases). */
  hasDraft: boolean;
  /** Template creation timestamp — the Draft version's date in the release picker. */
  createdAt: string;
}

/** The workspace organization snapshot rendered by the Working Tree. */
export interface WorkspaceTree {
  projects: ProjectDto[];
  folders: FolderDto[];
  tags: TagDto[];
  templates: TemplateSummary[];
}

// --- Seebo render DTOs ------------------------------------------------------

/** A single input requirement → a front-end widget chosen by `capability`. */
/** The value type behind a requirement — drives input validation (limits/format) in the UI. */
export interface RequirementTypeDto {
  /** 'int' | 'float' | 'string' | 'duration' | 'object' | 'datetime' | 'bool' | 'array' | … */
  kind: string;
  /** Float decimals (number) or duration precision ('second'…). */
  precision: number | null;
  /** Duration display pattern, e.g. 'HH:mm:ss'. */
  pattern: string | null;
  min: number | null;
  max: number | null;
  maxLength: number | null;
}

export interface RequirementDto {
  id: string;
  /** Widget type (textbox, listbox, …); the capability name. */
  capability: string;
  label: string | null;
  /** Choices for listbox/multiOption. */
  options: string[] | null;
  /** The underlying value type + constraints (null when unknown). */
  type: RequirementTypeDto | null;
}

/**
 * Non-widget **data** capabilities: they resolve a real value during the render (vs. input widgets,
 * which surface as requirements for the user). They are never shown in the Input panel. Single source
 * of truth for both the main host (`SeeboHost`) and the renderer (Input panel pruning).
 */
export const DATA_CAPABILITIES = ['template', 'env'] as const;
export type DataCapability = (typeof DATA_CAPABILITIES)[number];

export interface DiagnosticDto {
  code: string;
  message: string;
  position: { start: number; end: number } | null;
}

export type RenderStatus = 'completed' | 'waiting' | 'failed';

/** An action the render *prepared* (never executed). Surfaced to the Action Panel. */
export interface ActionSummaryDto {
  id: string;
  type: string;
  environment: string;
  requiresConfirmation: boolean;
  status: string;
}

export interface RenderResultDto {
  status: RenderStatus;
  output: string | null;
  pending: RequirementDto[];
  diagnostics: DiagnosticDto[];
  actions: ActionSummaryDto[];
  /**
   * Ids the lazy render actually **reached and resolved** (consumed inputs, capabilities, binds). With
   * `pending`, this is the set of inputs the render truly uses — so the UI can hide requirements gated
   * behind a branch that was not taken (Seebo collects `need(...)` lazily). See InputPanel pruning.
   */
  resolved: string[];
}

// --- M7 DTOs ----------------------------------------------------------------

export interface ReleaseDto {
  id: string;
  templateId: string;
  name: string;
  source: string;
  subtype: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Subtype catalog per template type. The Template Editor offers these in a listbox (documents are
 * alphabetical; APIs are fixed to `json`). Only RENDER_PREVIEW_SUBTYPES expose an inline view/code
 * preview in the editor; FORMATTABLE_SUBTYPES expose a "format" action; RENDERABLE_SUBTYPES are
 * shown rendered (not as code) in the Document output.
 */
export const SUBTYPES: Record<TemplateType, string[]> = {
  document: [
    'css',
    'csv',
    'echarts',
    'eml',
    'html',
    'java',
    'javascript',
    'json',
    'markdown',
    'mermaid',
    'swagger',
    'text',
    'yaml',
  ],
  api: ['json'],
  capability: ['javascript'],
  action: ['javascript'],
};
/** Default subtype assigned to a new template (and used to group subtype-less ones in the tree). */
export const DEFAULT_SUBTYPE: Record<TemplateType, string> = {
  document: 'text',
  api: 'json',
  capability: 'javascript',
  action: 'javascript',
};
/** Subtypes the Document output shows rendered (not as code). */
export const RENDERABLE_SUBTYPES = new Set(['html', 'markdown', 'eml', 'mermaid', 'swagger', 'echarts']);
export const RENDER_PREVIEW_SUBTYPES = new Set(['html', 'markdown']);
export const FORMATTABLE_SUBTYPES = new Set([
  'html',
  'markdown',
  'css',
  'javascript',
  'java',
  'json',
  'yaml',
  'swagger',
]);

export interface ChangelogEntryDto {
  id: string;
  entityType: string;
  entityId: string;
  message: string;
  username: string | null;
  createdAt: string;
}

/** The special selection meaning "the editable draft". */
export const DRAFT_RELEASE = 'draft';

// --- M8 DTOs ----------------------------------------------------------------

export type HttpMethod = z.infer<typeof httpMethodSchema>;
export type HttpAuth = z.infer<typeof httpAuthSchema>;
export type HttpBodyType = z.infer<typeof bodyTypeSchema>;
export type HttpRequestModel = z.infer<typeof httpRequestSchema>;
export type RequestAction = z.infer<typeof requestActionSchema>;

export interface HttpResponseDto {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
}

/** 🔵 local-only, metadata-only API history record (never bodies). */
export interface ApiHistoryItem {
  id: string;
  templateId: string;
  method: string;
  url: string;
  status: number | null;
  createdAt: string;
}

// --- M10 DTOs ---------------------------------------------------------------


/** 🔵 local-only, redacted action receipt (never the action input values). */
export interface ReceiptDto {
  id: string;
  actionId: string;
  actionType: string;
  /** Seebo receipt status: succeeded | failed | skipped | compensated | … */
  status: string;
  message: string;
  environment: string;
  createdAt: string;
  /** Value the action returned, on the run that just happened (not persisted). Input stays redacted. */
  output?: unknown;
  /** Lines the action logged with `swaft.log(...)`. */
  logs?: string[];
  /** Names of the environment variables the action wrote (values are never echoed). */
  envWrites?: string[];
}

export interface WorkspaceSettingsDto {
  executionMode: ExecutionMode;
  /** Whether the Batcher panel is shown under the Working Tree. */
  batcherEnabled: boolean;
  /** Hosts outgoing HTTP requests may NOT target (anchored host match, empty = allow all). */
  blockedDomains: string[];
  /** Proxy every outgoing HTTP request through this URL (null = direct). */
  proxyUrl: string | null;
  /** Headers force-applied to every outgoing HTTP request (override the request's own). */
  enforcedHeaders: Record<string, string>;
}
export type WorkspaceSettingsUpdate = z.infer<typeof settingsUpdateSchema>;

// --- Environment DTOs -------------------------------------------------------

export type EnvironmentOwnerKind = z.infer<typeof environmentOwnerKindSchema>;

/** An environment in a list (header picker + settings), without its variables. */
export interface EnvironmentSummaryDto {
  id: string;
  name: string;
  description: string | null;
  ownerKind: EnvironmentOwnerKind;
  /** Username for personal (user) environments, null for workspace ones. */
  ownerId: string | null;
  /** Number of variables (so the list can show a count without shipping every value). */
  varCount: number;
}

/** A single environment with its variables (settings editor + the `env(...)` capability source). */
export interface EnvironmentDto extends EnvironmentSummaryDto {
  vars: Record<string, string>;
}

export type EnvCreateRequest = z.infer<typeof envCreateRequestSchema>;
export type EnvUpdateRequest = z.infer<typeof envUpdateRequestSchema>;
export type EnvSelectionSetRequest = z.infer<typeof envSelectionSetRequestSchema>;

export interface EnvironmentsResponse {
  environments: EnvironmentSummaryDto[];
}
export interface EnvironmentResponse {
  environment: EnvironmentDto;
}
export interface EnvironmentSelectionResponse {
  /** The active environment id, or null when none is selected. */
  environmentId: string | null;
}

export type NameColorRequest = z.infer<typeof nameColorRequestSchema>;
export type ProjectCreateRequest = z.infer<typeof projectCreateRequestSchema>;
export type FolderCreateRequest = z.infer<typeof folderCreateRequestSchema>;
export type FolderMoveRequest = z.infer<typeof folderMoveRequestSchema>;
export type FolderUpdateRequest = z.infer<typeof folderUpdateRequestSchema>;

export interface FolderResponse {
  folder: FolderDetailDto;
}
export type TemplateMoveRequest = z.infer<typeof templateMoveRequestSchema>;
export type TemplateTagAddRequest = z.infer<typeof templateTagAddRequestSchema>;
export type TemplateTagRemoveRequest = z.infer<typeof templateTagRemoveRequestSchema>;

export interface TagsResponse {
  tags: TagDto[];
}
export type RenameRequest = z.infer<typeof renameRequestSchema>;
export type IdRequest = z.infer<typeof idRequestSchema>;
export type TemplateCreateRequest = z.infer<typeof templateCreateRequestSchema>;
export type TemplateSearchRequest = z.infer<typeof templateSearchRequestSchema>;
export type TemplateUpdateSourceRequest = z.infer<typeof templateUpdateSourceRequestSchema>;
export type TemplateRenderRequest = z.infer<typeof templateRenderRequestSchema>;
export type InputStateGetRequest = z.infer<typeof inputStateGetRequestSchema>;
export type InputStateSetRequest = z.infer<typeof inputStateSetRequestSchema>;

export interface TemplateResponse {
  template: TemplateDto;
}
/** Ids of the templates whose name or content matches a free-text search. */
export interface TemplateSearchResponse {
  ids: string[];
}
export interface RequirementsResponse {
  requirements: RequirementDto[];
}
export interface RenderResponse {
  result: RenderResultDto;
}
export interface InputStateResponse {
  values: Record<string, unknown>;
}

export type TemplateRefRequest = z.infer<typeof templateRefRequestSchema>;
export type ReleaseSelectionSetRequest = z.infer<typeof releaseSelectionSetRequestSchema>;
export type SourceRequest = z.infer<typeof sourceRequestSchema>;
export type ReleaseCreateRequest = z.infer<typeof releaseCreateRequestSchema>;
export type ReleaseUpdateRequest = z.infer<typeof releaseUpdateRequestSchema>;
export type ReleaseDeleteRequest = z.infer<typeof releaseDeleteRequestSchema>;
export type RenderSourceRequest = z.infer<typeof renderSourceRequestSchema>;

export interface ReleasesResponse {
  releases: ReleaseDto[];
}
export interface ChangelogResponse {
  entries: ChangelogEntryDto[];
}
export interface ReleaseSelectionResponse {
  releaseId: string;
}
export interface DiagnosticsResponse {
  diagnostics: DiagnosticDto[];
}

export type HttpSendRequest = z.infer<typeof httpSendRequestSchema>;
export type ApiAnalyzeRequest = z.infer<typeof apiAnalyzeRequestSchema>;
export type UserCodeRefRequest = z.infer<typeof userCodeRefRequestSchema>;
export type ApiActionsClearRequest = z.infer<typeof apiActionsClearRequestSchema>;
export type UserCodeRunRequest = z.infer<typeof userCodeRunRequestSchema>;
export type SecretSetRequest = z.infer<typeof secretSetRequestSchema>;

export interface HttpSendResponse {
  response: HttpResponseDto;
  /** True when the request carried `${ … }` formulas that were rendered before sending. */
  rendered?: boolean;
  /** The concrete (rendered) request that was actually sent — present only when `rendered`. */
  request?: HttpRequestModel;
  /** What the request's attached actions did, in run order (pre first, then post). */
  actions?: RequestActionOutcomeDto[];
}
/** Input widgets a request's formula fields need, plus any static diagnostics (live editor feedback). */
export interface ApiAnalyzeResponse {
  requirements: RequirementDto[];
  diagnostics: DiagnosticDto[];
}
export interface ApiHistoryResponse {
  items: ApiHistoryItem[];
}

/** What one request-attached action did, surfaced in the response panel after a send. */
export interface RequestActionOutcomeDto {
  ref: string;
  trigger: 'pre' | 'post';
  status: 'succeeded' | 'failed' | 'skipped';
  /** Whatever the action returned (its receipt payload), or null. */
  output: unknown;
  /** Lines it logged. */
  logs: string[];
  /** Names of the environment variables it wrote. */
  envWrites: string[];
  /** Present when it failed. */
  error: string | null;
  /** When the run happened (persisted history entries carry it; the fresh send response may omit it). */
  createdAt?: string;
}
/** The persisted pre/post action history for a request template. */
export interface RequestActionsResponse {
  outcomes: RequestActionOutcomeDto[];
}

/** Template kinds whose source is user-authored JavaScript rather than a Seebo template. */
export const CODE_TEMPLATE_TYPES: TemplateType[] = ['capability', 'action'];
export function isCodeTemplateType(type: string): boolean {
  return (CODE_TEMPLATE_TYPES as string[]).includes(type);
}

/** Why a `capability` template is (not) registered — shown in its editor header. */
export type UserCapabilityStatus =
  | 'ok'
  | 'invalid-name'
  | 'duplicate-name'
  | 'reserved-name'
  /** Written on another install and not approved here yet — the code will not run. */
  | 'untrusted';
export interface UserCapabilityDto {
  /** The name formulas call it by: the template name (see analisi_codice_utente.md §5.1). */
  name: string;
  /** Seebo base type the resolved value is validated against (`export const type`). */
  type: string;
  status: UserCapabilityStatus;
  /** Human-readable reason when `status !== 'ok'`. */
  message: string | null;
}
export interface UserCapabilityResponse {
  capability: UserCapabilityDto;
}
/** A capability awaiting approval, for the "review before it runs" banner. */
export interface UntrustedCapabilityDto {
  templateId: string;
  name: string;
}
export interface UntrustedCapabilitiesResponse {
  items: UntrustedCapabilityDto[];
}
/** One test run from the capability/action editor. */
export interface UserCodeRunResponse {
  value: unknown;
  durationMs: number;
  /** Lines the code emitted with `swaft.log(...)`. */
  logs: string[];
  /** Names of the environment variables an action wrote (values are never echoed back). */
  envWrites: string[];
}
export interface SecretsResponse {
  refs: string[];
}
export interface OkResponse {
  ok: true;
}

export type BatchAnalyzeRequest = z.infer<typeof batchAnalyzeRequestSchema>;
export type BatchRenderRequest = z.infer<typeof batchRenderRequestSchema>;
export type ActionExecuteRequest = z.infer<typeof actionExecuteRequestSchema>;

export interface ReceiptsResponse {
  receipts: ReceiptDto[];
}

export interface TreeResponse {
  tree: WorkspaceTree;
}
export interface SettingsResponse {
  settings: WorkspaceSettingsDto;
}

export interface OpContracts {
  'system.ping': { request: PingRequest; response: PingResponse };
  'auth.status': { request: EmptyRequest; response: AuthStatusResponse };
  'auth.signUp': { request: SignUpRequest; response: AuthStatusResponse };
  'auth.signIn': { request: SignInRequest; response: AuthStatusResponse };
  'auth.unlock': { request: UnlockRequest; response: AuthStatusResponse };
  'auth.signOut': { request: EmptyRequest; response: AuthStatusResponse };
  'auth.lock': { request: EmptyRequest; response: AuthStatusResponse };
  'session.whoami': { request: EmptyRequest; response: WhoamiResponse };
  'prefs.get': { request: EmptyRequest; response: PrefsResponse };
  'prefs.set': { request: PrefsSetRequest; response: PrefsResponse };
  'workspace.create': { request: WorkspaceCreateRequest; response: WorkspaceResponse };
  'workspace.open': { request: WorkspaceOpenRequest; response: WorkspaceResponse };
  'workspace.close': { request: EmptyRequest; response: WorkspaceResponse };
  'workspace.current': { request: EmptyRequest; response: WorkspaceResponse };
  'workspace.update': { request: WorkspaceUpdateRequest; response: WorkspaceResponse };
  'workspace.recent': { request: EmptyRequest; response: RecentWorkspacesResponse };
  'dialog.createTarget': { request: DialogCreateTargetRequest; response: DialogPathResponse };
  'dialog.openTarget': { request: EmptyRequest; response: DialogPathResponse };
  'tree.get': { request: EmptyRequest; response: TreeResponse };
  'project.create': { request: ProjectCreateRequest; response: TreeResponse };
  'project.rename': { request: RenameRequest; response: TreeResponse };
  'project.delete': { request: IdRequest; response: TreeResponse };
  'folder.create': { request: FolderCreateRequest; response: TreeResponse };
  'folder.rename': { request: RenameRequest; response: TreeResponse };
  'folder.delete': { request: IdRequest; response: TreeResponse };
  'folder.move': { request: FolderMoveRequest; response: TreeResponse };
  'folder.get': { request: IdRequest; response: FolderResponse };
  'folder.update': { request: FolderUpdateRequest; response: FolderResponse };
  'template.move': { request: TemplateMoveRequest; response: TreeResponse };
  'tag.list': { request: EmptyRequest; response: TagsResponse };
  'template.tags.list': { request: TemplateRefRequest; response: TagsResponse };
  'template.tags.add': { request: TemplateTagAddRequest; response: TagsResponse };
  'template.tags.remove': { request: TemplateTagRemoveRequest; response: TagsResponse };
  'tag.create': { request: NameColorRequest; response: TreeResponse };
  'tag.delete': { request: IdRequest; response: TreeResponse };
  'settings.get': { request: EmptyRequest; response: SettingsResponse };
  'settings.update': { request: WorkspaceSettingsUpdate; response: SettingsResponse };
  'template.create': { request: TemplateCreateRequest; response: TreeResponse };
  'template.rename': { request: RenameRequest; response: TreeResponse };
  'template.delete': { request: IdRequest; response: TreeResponse };
  'template.get': { request: IdRequest; response: TemplateResponse };
  'template.search': { request: TemplateSearchRequest; response: TemplateSearchResponse };
  'template.updateSource': { request: TemplateUpdateSourceRequest; response: TemplateResponse };
  'template.deleteDraft': { request: IdRequest; response: TemplateResponse };
  'template.analyze': { request: IdRequest; response: RequirementsResponse };
  'template.render': { request: TemplateRenderRequest; response: RenderResponse };
  'inputState.get': { request: InputStateGetRequest; response: InputStateResponse };
  'inputState.set': { request: InputStateSetRequest; response: InputStateResponse };
  'release.create': { request: ReleaseCreateRequest; response: ReleasesResponse };
  'release.update': { request: ReleaseUpdateRequest; response: ReleasesResponse };
  'release.delete': { request: ReleaseDeleteRequest; response: ReleasesResponse };
  'release.list': { request: TemplateRefRequest; response: ReleasesResponse };
  'changelog.list': { request: TemplateRefRequest; response: ChangelogResponse };
  'releaseSelection.get': { request: TemplateRefRequest; response: ReleaseSelectionResponse };
  'releaseSelection.set': { request: ReleaseSelectionSetRequest; response: ReleaseSelectionResponse };
  'render.analyzeSource': { request: SourceRequest; response: RequirementsResponse };
  'render.validateSource': { request: SourceRequest; response: DiagnosticsResponse };
  'render.renderSource': { request: RenderSourceRequest; response: RenderResponse };
  'http.send': { request: HttpSendRequest; response: HttpSendResponse };
  'api.analyze': { request: ApiAnalyzeRequest; response: ApiAnalyzeResponse };
  'usercode.describe': { request: UserCodeRefRequest; response: UserCapabilityResponse };
  'usercode.run': { request: UserCodeRunRequest; response: UserCodeRunResponse };
  'usercode.untrusted': { request: EmptyRequest; response: UntrustedCapabilitiesResponse };
  'usercode.trust': { request: UserCodeRefRequest; response: UserCapabilityResponse };
  'api.history.list': { request: TemplateRefRequest; response: ApiHistoryResponse };
  'api.history.clear': { request: TemplateRefRequest; response: ApiHistoryResponse };
  'api.actions.list': { request: TemplateRefRequest; response: RequestActionsResponse };
  'api.actions.clear': { request: ApiActionsClearRequest; response: RequestActionsResponse };
  'api.history.delete': { request: IdRequest; response: OkResponse };
  'secret.set': { request: SecretSetRequest; response: SecretsResponse };
  'secret.list': { request: EmptyRequest; response: SecretsResponse };
  'batch.analyze': { request: BatchAnalyzeRequest; response: RequirementsResponse };
  'batch.render': { request: BatchRenderRequest; response: RenderResponse };
  'action.execute': { request: ActionExecuteRequest; response: ReceiptsResponse };
  'receipt.list': { request: TemplateRefRequest; response: ReceiptsResponse };
  'env.list': { request: EmptyRequest; response: EnvironmentsResponse };
  'env.get': { request: IdRequest; response: EnvironmentResponse };
  'env.create': { request: EnvCreateRequest; response: EnvironmentResponse };
  'env.update': { request: EnvUpdateRequest; response: EnvironmentResponse };
  'env.delete': { request: IdRequest; response: EnvironmentsResponse };
  'env.selection.get': { request: EmptyRequest; response: EnvironmentSelectionResponse };
  'env.selection.set': { request: EnvSelectionSetRequest; response: EnvironmentSelectionResponse };
}

export type OpRequest<N extends OpName> = OpContracts[N]['request'];
export type OpResponse<N extends OpName> = OpContracts[N]['response'];

// --- Helpers ----------------------------------------------------------------

export function isKnownOp(name: string): name is OpName {
  return (OP_NAMES as readonly string[]).includes(name);
}

export type ValidationResult =
  | { ok: true; data: unknown }
  | { ok: false; issues: { path: string; message: string }[] };

/**
 * Validate a raw payload against an op's request schema. `undefined` is treated as an empty object
 * so ops with all-optional fields accept a missing payload. Returns flattened, non-secret issues.
 */
export function validateOpRequest(op: OpName, payload: unknown): ValidationResult {
  const schema = OP_REQUEST_SCHEMAS[op];
  const result = schema.safeParse(payload ?? {});
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}
