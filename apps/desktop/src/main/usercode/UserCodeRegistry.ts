import { createHash } from 'node:crypto';
import type { UserCapabilityDto, UserCapabilityStatus } from '@swaft/shared';
import { AppError } from '../errors';
import type { UserCapabilityProvider, UserCapabilityRegistration } from '../seebo/SeeboHost';
import type { EnvironmentService } from '../workspace/EnvironmentService';
import type { ReleaseService } from '../workspace/ReleaseService';
import type { TemplateService } from '../workspace/TemplateService';
import type { WorkspaceService } from '../workspace/WorkspaceService';
import {
  DEFAULT_CAPABILITY_TYPE,
  type ScriptKind,
  type ScriptProfile,
  type ScriptRunOutcome,
} from './contract';
import { capabilityArgs, isValidCapabilityName, normalizeCapabilityType } from './guard';
import type { ScriptRuntime } from './ScriptRuntime';

/** A capability or action template, with the verdict on whether it may be registered. */
interface Entry {
  templateId: string;
  kind: ScriptKind;
  name: string;
  /** Capabilities only: the Seebo base type the resolved value is validated against. */
  type: string;
  hash: string;
  code: string;
  status: UserCapabilityStatus;
  message: string | null;
}

interface Snapshot {
  revision: number;
  entries: Entry[];
  byName: Map<string, Entry>;
  byTemplate: Map<string, Entry>;
}

/** The local record of which user code has been approved to run on this install. */
export interface CodeTrustStore {
  isCodeTrusted(workspacePath: string, templateId: string, sourceHash: string): boolean;
  trustCode(workspacePath: string, templateId: string, sourceHash: string): void;
  getDeviceId(): string;
}

export interface UserCodeRegistryDeps {
  templates: TemplateService;
  releases: ReleaseService;
  environments: EnvironmentService;
  runtime: ScriptRuntime;
  /** Capability names Swaft owns (widgets + built-in data capabilities); may not be shadowed. */
  reservedNames: readonly string[];
  trust: CodeTrustStore;
}

/**
 * Knows which user-authored capabilities and actions exist, and hands the engine a resolver (or an
 * action handler) for each. Both kinds share this registry because they share everything that is
 * hard: name resolution, the compiled snapshot, and trust.
 *
 * Registration is **pull-based**, not push: `SeeboHost` builds a fresh engine for every analyze /
 * validate / render, so there is no long-lived engine to register into on save. Instead this
 * registry keeps a snapshot of the `capability` templates keyed by the workspace revision, which
 * makes the per-engine cost a map lookup while still making a save visible immediately
 * (analisi_codice_utente.md §5.3).
 *
 * Nothing here executes user code. The declared `type` is read statically from the source, so
 * `validate` — which runs on every keystroke in the editor — never has a reason to run a script.
 *
 * **Trust.** A workspace is a file people exchange, so opening one must not run its author's code.
 * A capability may run only when this install wrote it (the row's device stamp) or the user approved
 * this exact source. Untrusted capabilities are still *registered* — the name resolves and fails
 * with a clear reason — because the alternative, an `UNKNOWN_FUNCTION` from Seebo, tells the reader
 * nothing about what is actually wrong.
 */
export class UserCodeRegistry implements UserCapabilityProvider {
  private snapshot: Snapshot | null = null;
  private envCache: { revision: number; vars: Record<string, string> } | null = null;

  constructor(
    private readonly ws: WorkspaceService,
    private readonly deps: UserCodeRegistryDeps,
  ) {}

  /**
   * The capabilities the engine registers: those whose name is usable. Untrusted ones are included
   * on purpose — see the class note — and refuse to run when called.
   */
  async list(): Promise<UserCapabilityRegistration[]> {
    const snapshot = await this.load();
    return [...snapshot.byName.values()]
      .filter((e) => e.kind === 'capability')
      .map((e) => ({ name: e.name, type: e.type }));
  }

  /** The action types the engine registers, so `action({ type: 'myAction' })` is known to it. */
  async listActions(): Promise<{ name: string }[]> {
    const snapshot = await this.load();
    return [...snapshot.byName.values()]
      .filter((e) => e.kind === 'action')
      .map((e) => ({ name: e.name }));
  }

  /**
   * Run one action. Unlike a capability this is an effect, so the environment writes it asked for
   * are applied here — after it succeeded, in one go, never half-way. A dry run is told so and its
   * writes are reported but not applied.
   */
  async runAction(
    name: string,
    input: Record<string, unknown>,
    opts: { api?: unknown; dryRun?: boolean } = {},
  ): Promise<{ value: unknown; logs: string[]; envWrites: string[] }> {
    const snapshot = await this.load();
    const entry = snapshot.byName.get(name);
    if (!entry || entry.kind !== 'action') {
      throw new AppError('USER_CODE_NOT_FOUND', 'not_found', `Action "${name}" is not available.`);
    }
    this.assertRunnable(entry);
    const outcome = await this.invokeRaw(entry, input, opts);
    const written = Object.keys(outcome.envWrites);
    if (!opts.dryRun && written.length > 0) {
      await this.deps.environments.applyWrites(outcome.envWrites);
      this.envCache = null;
    }
    // Only the names come back: values are routinely tokens, and receipts are persisted.
    return { value: outcome.value, logs: outcome.logs, envWrites: written };
  }

  /** Capabilities and actions waiting for approval, for the review banner. */
  async untrusted(): Promise<{ templateId: string; name: string }[]> {
    const snapshot = await this.load();
    return snapshot.entries
      .filter((e) => e.status === 'untrusted')
      .map((e) => ({ templateId: e.templateId, name: e.name }));
  }

  /** Approve the capability's current source, so it may run on this install from now on. */
  async trust(templateId: string): Promise<UserCapabilityDto> {
    const snapshot = await this.load();
    const entry = snapshot.byTemplate.get(templateId);
    if (!entry) {
      throw new AppError('TEMPLATE_NOT_FOUND', 'not_found', 'Code template not found.');
    }
    this.deps.trust.trustCode(this.workspacePath(), templateId, entry.hash);
    // Approving changes the verdict, so drop the snapshot rather than wait for the next save.
    this.snapshot = null;
    return this.describe(templateId);
  }

  /** Resolve one capability call. `requirement` is the descriptor the engine flattened for us. */
  async resolve(name: string, requirement: Record<string, unknown>): Promise<unknown> {
    const snapshot = await this.load();
    const entry = snapshot.byName.get(name);
    if (!entry || entry.kind !== 'capability') {
      throw new AppError('USER_CODE_NOT_FOUND', 'not_found', `Capability "${name}" is not available.`);
    }
    this.assertRunnable(entry);
    return (await this.invokeRaw(entry, capabilityArgs(requirement))).value;
  }

  /** What the code editor shows in its header: the registered name and why it may be idle. */
  async describe(templateId: string): Promise<UserCapabilityDto> {
    const snapshot = await this.load();
    const entry = snapshot.byTemplate.get(templateId);
    if (!entry) {
      throw new AppError('TEMPLATE_NOT_FOUND', 'not_found', 'Code template not found.');
    }
    return { name: entry.name, type: entry.type, status: entry.status, message: entry.message };
  }

  /** One-off run from the editor's test panel, with the arguments a formula would have passed. */
  async runOnce(
    templateId: string,
    args: Record<string, unknown>,
    opts: { dryRun?: boolean } = {},
  ): Promise<{ value: unknown; durationMs: number; logs: string[]; envWrites: string[] }> {
    const snapshot = await this.load();
    const entry = snapshot.byTemplate.get(templateId);
    if (!entry) {
      throw new AppError('TEMPLATE_NOT_FOUND', 'not_found', 'Code template not found.');
    }
    // A name clash keeps code out of the engine but must not block testing it in place.
    if (entry.status === 'invalid-name' || entry.status === 'reserved-name') {
      throw new AppError('USER_CODE_REJECTED', 'validation', entry.message ?? 'Invalid code template.');
    }
    // Pressing Run must not be a way around approval: the editor shows the code, then the button.
    this.assertRunnable(entry);
    const startedAt = Date.now();
    // Testing an action from its editor is a real run, environment writes included — that is the
    // point of the button — so it goes through the same path a trigger would use.
    const outcome =
      entry.kind === 'action'
        ? await this.runAction(entry.name, args, { dryRun: opts.dryRun })
        : { ...(await this.invokeRaw(entry, args)), envWrites: [] as string[] };
    return { ...outcome, durationMs: Date.now() - startedAt };
  }

  private assertRunnable(entry: Entry): void {
    if (entry.status === 'untrusted') {
      throw new AppError('USER_CODE_UNTRUSTED', 'policy', entry.message ?? 'Code not approved.');
    }
    if (entry.status === 'duplicate-name') {
      throw new AppError('USER_CODE_REJECTED', 'validation', entry.message ?? 'Ambiguous name.');
    }
  }

  /**
   * Code written on this install runs without ceremony — the user is the author, and asking on every
   * save would train them to click through the prompt. Everything else needs an explicit approval of
   * *that exact source*, so a newer version arriving with an updated workspace is not covered by the
   * approval given to the version that was actually read.
   *
   * Consequence worth knowing: editing received code adopts it, because the row then carries this
   * install's stamp. That is deliberate — editing happens in the capability view, with the source on
   * screen and the approve button beside it — but it does mean authorship, not just approval, is a
   * way to make code runnable.
   */
  private isTrusted(row: { id: string; updated_by_device_id: string | null }, hash: string): boolean {
    if (row.updated_by_device_id && row.updated_by_device_id === this.deps.trust.getDeviceId()) {
      return true;
    }
    return this.deps.trust.isCodeTrusted(this.workspacePath(), row.id, hash);
  }

  private workspacePath(): string {
    const path = this.ws.current()?.path;
    if (!path) throw new AppError('WORKSPACE_REQUIRED', 'policy', 'No workspace is open.');
    return path;
  }

  private async invokeRaw(
    entry: Entry,
    args: Record<string, unknown>,
    opts: { api?: unknown; dryRun?: boolean } = {},
  ): Promise<ScriptRunOutcome> {
    return this.deps.runtime.run({
      name: entry.name,
      kind: entry.kind,
      code: entry.code,
      hash: entry.hash,
      profile: this.profile(),
      args,
      env: await this.envVars(),
      api: opts.api,
      dryRun: opts.dryRun,
    });
  }

  /**
   * Sandbox is the only profile Swaft implements today; the developer unlocks (module allow-list,
   * HTTP through HttpService, bounded file writes) are a later phase, and until they exist honouring
   * `executionMode` here would grant power nothing is prepared to police.
   */
  private profile(): ScriptProfile {
    return 'sandbox';
  }

  private async envVars(): Promise<Record<string, string>> {
    const revision = this.ws.revision;
    if (this.envCache?.revision === revision) return this.envCache.vars;
    const vars = await this.deps.environments.snapshot();
    this.envCache = { revision, vars };
    return vars;
  }

  private async load(): Promise<Snapshot> {
    const revision = this.ws.revision;
    if (this.snapshot?.revision === revision) return this.snapshot;

    // Capabilities and actions share one namespace: `cfg` must mean one thing whether a formula
    // resolves it or an action plan names it.
    const rows = [
      ...(await this.deps.templates.listByType('capability')).map((r) => ({ ...r, kind: 'capability' as const })),
      ...(await this.deps.templates.listByType('action')).map((r) => ({ ...r, kind: 'action' as const })),
    ];
    const reserved = new Set(this.deps.reservedNames);
    const timesUsed = new Map<string, number>();
    for (const row of rows) timesUsed.set(row.name, (timesUsed.get(row.name) ?? 0) + 1);

    const entries: Entry[] = [];
    for (const row of rows) {
      const { source } = await this.deps.releases.resolveSource(row.id);
      const entry: Entry = {
        templateId: row.id,
        kind: row.kind,
        name: row.name,
        type: readDeclaredType(source),
        hash: createHash('sha256').update(source).digest('hex'),
        code: source,
        status: 'ok',
        message: null,
      };
      if (!isValidCapabilityName(row.name)) {
        entry.status = 'invalid-name';
        entry.message = `"${row.name}" is not a valid name — formulas call a capability like a function, so use letters, digits and _ (not starting with a digit).`;
      } else if (reserved.has(row.name)) {
        entry.status = 'reserved-name';
        entry.message = `"${row.name}" is a built-in capability; pick another name so existing templates keep their meaning.`;
      } else if ((timesUsed.get(row.name) ?? 0) > 1) {
        // Ambiguity is never resolved silently: with two of the same name a formula (or an action
        // plan) would bind to whichever loaded first, so neither is registered until it is fixed.
        entry.status = 'duplicate-name';
        entry.message = `More than one capability or action is named "${row.name}"; rename one so a reference resolves to exactly one.`;
      } else if (!this.isTrusted(row, entry.hash)) {
        entry.status = 'untrusted';
        entry.message = `"${row.name}" was written on another install. Review the code and approve it before it can run.`;
      }
      entries.push(entry);
    }

    this.snapshot = {
      revision,
      entries,
      // Untrusted capabilities keep their name registered so the failure can explain itself.
      byName: new Map(
        entries.filter((e) => e.status === 'ok' || e.status === 'untrusted').map((e) => [e.name, e]),
      ),
      byTemplate: new Map(entries.map((e) => [e.templateId, e])),
    };
    return this.snapshot;
  }
}

/**
 * The Seebo base type a capability contracts for, read **statically** from `export const type`.
 * Reading it without importing the module is what keeps `validate` free of user code; the price is
 * that the declaration must be a plain string literal. Anything else falls back to `object`, and a
 * template can always override the type at the call site.
 */
const DECLARED_TYPE = /export\s+const\s+type\s*=\s*['"]([A-Za-z]+)['"]/;
export function readDeclaredType(source: string): string {
  const declared = DECLARED_TYPE.exec(source);
  return (declared && normalizeCapabilityType(declared[1])) ?? DEFAULT_CAPABILITY_TYPE;
}
