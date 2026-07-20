import { createHash } from 'node:crypto';
import type { UserCapabilityDto, UserCapabilityStatus } from '@swaft/shared';
import { AppError } from '../errors';
import type { UserCapabilityProvider, UserCapabilityRegistration } from '../seebo/SeeboHost';
import type { EnvironmentService } from '../workspace/EnvironmentService';
import type { ReleaseService } from '../workspace/ReleaseService';
import type { TemplateService } from '../workspace/TemplateService';
import type { WorkspaceService } from '../workspace/WorkspaceService';
import { DEFAULT_CAPABILITY_TYPE, type ScriptProfile } from './contract';
import { capabilityArgs, isValidCapabilityName, normalizeCapabilityType } from './guard';
import type { ScriptRuntime } from './ScriptRuntime';

/** A capability template, with the verdict on whether it may be registered. */
interface Entry {
  templateId: string;
  name: string;
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

export interface UserCapabilityRegistryDeps {
  templates: TemplateService;
  releases: ReleaseService;
  environments: EnvironmentService;
  runtime: ScriptRuntime;
  /** Capability names Swaft owns (widgets + built-in data capabilities); may not be shadowed. */
  reservedNames: readonly string[];
  trust: CodeTrustStore;
}

/**
 * Knows which user-authored capabilities exist and hands the engine a resolver for each.
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
export class UserCapabilityRegistry implements UserCapabilityProvider {
  private snapshot: Snapshot | null = null;
  private envCache: { revision: number; vars: Record<string, string> } | null = null;

  constructor(
    private readonly ws: WorkspaceService,
    private readonly deps: UserCapabilityRegistryDeps,
  ) {}

  /**
   * The capabilities the engine registers: those whose name is usable. Untrusted ones are included
   * on purpose — see the class note — and refuse to run when called.
   */
  async list(): Promise<UserCapabilityRegistration[]> {
    const snapshot = await this.load();
    return [...snapshot.byName.values()].map((e) => ({ name: e.name, type: e.type }));
  }

  /** Capabilities waiting for approval, for the review banner. */
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
      throw new AppError('TEMPLATE_NOT_FOUND', 'not_found', 'Capability template not found.');
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
    if (!entry) {
      throw new AppError('USER_CODE_NOT_FOUND', 'not_found', `Capability "${name}" is not available.`);
    }
    this.assertRunnable(entry);
    return this.invoke(entry, capabilityArgs(requirement));
  }

  /** What the capability editor shows in its header: the registered name and why it may be idle. */
  async describe(templateId: string): Promise<UserCapabilityDto> {
    const snapshot = await this.load();
    const entry = snapshot.byTemplate.get(templateId);
    if (!entry) {
      throw new AppError('TEMPLATE_NOT_FOUND', 'not_found', 'Capability template not found.');
    }
    return { name: entry.name, type: entry.type, status: entry.status, message: entry.message };
  }

  /** One-off run from the editor's test panel, with the arguments a formula would have passed. */
  async runOnce(
    templateId: string,
    args: Record<string, unknown>,
  ): Promise<{ value: unknown; durationMs: number }> {
    const snapshot = await this.load();
    const entry = snapshot.byTemplate.get(templateId);
    if (!entry) {
      throw new AppError('TEMPLATE_NOT_FOUND', 'not_found', 'Capability template not found.');
    }
    // A name clash keeps a capability out of the engine but must not block testing it in place.
    if (entry.status === 'invalid-name' || entry.status === 'reserved-name') {
      throw new AppError('USER_CODE_REJECTED', 'validation', entry.message ?? 'Invalid capability.');
    }
    // Pressing Run must not be a way around approval: the editor shows the code, then the button.
    this.assertRunnable(entry);
    const startedAt = Date.now();
    const value = await this.invoke(entry, args);
    return { value, durationMs: Date.now() - startedAt };
  }

  private assertRunnable(entry: Entry): void {
    if (entry.status === 'untrusted') {
      throw new AppError('USER_CODE_UNTRUSTED', 'policy', entry.message ?? 'Capability not approved.');
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

  private async invoke(entry: Entry, args: Record<string, unknown>): Promise<unknown> {
    return this.deps.runtime.run({
      name: entry.name,
      code: entry.code,
      hash: entry.hash,
      profile: this.profile(),
      args,
      env: await this.envVars(),
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

    const rows = await this.deps.templates.listByType('capability');
    const reserved = new Set(this.deps.reservedNames);
    const timesUsed = new Map<string, number>();
    for (const row of rows) timesUsed.set(row.name, (timesUsed.get(row.name) ?? 0) + 1);

    const entries: Entry[] = [];
    for (const row of rows) {
      const { source } = await this.deps.releases.resolveSource(row.id);
      const entry: Entry = {
        templateId: row.id,
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
        // Ambiguity is never resolved silently: with two capabilities of the same name a formula
        // would bind to whichever happened to load first, so neither is registered until it is fixed.
        entry.status = 'duplicate-name';
        entry.message = `More than one capability is named "${row.name}"; rename one so a formula resolves to exactly one.`;
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
