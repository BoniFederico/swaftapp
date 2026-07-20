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

export interface UserCapabilityRegistryDeps {
  templates: TemplateService;
  releases: ReleaseService;
  environments: EnvironmentService;
  runtime: ScriptRuntime;
  /** Capability names Swaft owns (widgets + built-in data capabilities); may not be shadowed. */
  reservedNames: readonly string[];
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
 */
export class UserCapabilityRegistry implements UserCapabilityProvider {
  private snapshot: Snapshot | null = null;
  private envCache: { revision: number; vars: Record<string, string> } | null = null;

  constructor(
    private readonly ws: WorkspaceService,
    private readonly deps: UserCapabilityRegistryDeps,
  ) {}

  /** The capabilities the engine may register: valid, unambiguous, non-reserved names only. */
  async list(): Promise<UserCapabilityRegistration[]> {
    const snapshot = await this.load();
    return snapshot.entries
      .filter((e) => e.status === 'ok')
      .map((e) => ({ name: e.name, type: e.type }));
  }

  /** Resolve one capability call. `requirement` is the descriptor the engine flattened for us. */
  async resolve(name: string, requirement: Record<string, unknown>): Promise<unknown> {
    const snapshot = await this.load();
    const entry = snapshot.byName.get(name);
    if (!entry || entry.status !== 'ok') {
      throw new AppError('USER_CODE_NOT_FOUND', 'not_found', `Capability "${name}" is not available.`);
    }
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
    const startedAt = Date.now();
    const value = await this.invoke(entry, args);
    return { value, durationMs: Date.now() - startedAt };
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
      }
      entries.push(entry);
    }

    this.snapshot = {
      revision,
      entries,
      byName: new Map(entries.filter((e) => e.status === 'ok').map((e) => [e.name, e])),
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
