import { describe, it, expect } from 'vitest';
import { CryptoService } from '../crypto/CryptoService';
import { SeeboHost, WIDGET_CAPABILITIES } from '../seebo/SeeboHost';
import { InProcessDbBackend } from '../storage/db-backend';
import { ChangelogService } from '../workspace/ChangelogService';
import { EnvironmentService } from '../workspace/EnvironmentService';
import { OrganizationService } from '../workspace/OrganizationService';
import { ReleaseService } from '../workspace/ReleaseService';
import { TemplateService } from '../workspace/TemplateService';
import { WorkspaceService, type WorkspaceFs } from '../workspace/WorkspaceService';
import type { ScriptRunRequest } from './contract';
import type { ScriptRuntime } from './ScriptRuntime';
import { UserCapabilityRegistry } from './UserCapabilityRegistry';

/** A runtime that records what it was asked to run and replays a scripted answer. */
class FakeRuntime implements ScriptRuntime {
  readonly calls: ScriptRunRequest[] = [];
  constructor(private readonly reply: (req: ScriptRunRequest) => unknown = () => ({ ok: true })) {}
  run(request: ScriptRunRequest): Promise<unknown> {
    this.calls.push(request);
    return Promise.resolve(this.reply(request));
  }
  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

async function setup(runtime: ScriptRuntime = new FakeRuntime()) {
  const files = new Map<string, Uint8Array>();
  const fs: WorkspaceFs = {
    read: (p) => Promise.resolve(files.get(p) ?? null),
    write: (p, b) => {
      files.set(p, b);
      return Promise.resolve();
    },
  };
  const ws = new WorkspaceService({
    createBackend: (bytes) => InProcessDbBackend.open(bytes),
    crypto: new CryptoService(),
    fs,
    deviceId: () => 'dev-1',
  });
  await ws.create({ name: 'WS', location: 'mem://uc.swaft', encrypt: false });
  const org = new OrganizationService(ws);
  const changelog = new ChangelogService(ws);
  const templates = new TemplateService(ws, org, changelog);
  const releases = new ReleaseService(ws, templates, changelog);
  const environments = new EnvironmentService(ws, () => 'alice');
  const registry = new UserCapabilityRegistry(ws, {
    templates,
    releases,
    environments,
    runtime,
    reservedNames: [...WIDGET_CAPABILITIES, 'template', 'env'],
  });

  const tree = await org.createProject({ name: 'P' });
  const projectId = tree.projects[0]!.id;
  const folderId = (await org.createFolder({ name: 'F', projectId })).folders[0]!.id;

  const addCapability = async (name: string, source: string): Promise<string> => {
    const res = await templates.createTemplate({ folderId, name, type: 'capability', source });
    return res.templates.find((x) => x.name === name)!.id;
  };

  return { ws, org, templates, releases, environments, registry, folderId, addCapability };
}

const OK_SOURCE = `export const type = 'object';\nexport default () => ({ ok: true });`;

describe('UserCapabilityRegistry', () => {
  it('registers a capability under the template name, with its declared type', async () => {
    const { registry, addCapability } = await setup();
    await addCapability('cfg', OK_SOURCE);

    expect(await registry.list()).toEqual([{ name: 'cfg', type: 'object' }]);
  });

  it('reads the declared type statically and defaults to object', async () => {
    const { registry, addCapability } = await setup();
    await addCapability('asText', `export const type = 'string';\nexport default () => 'hi';`);
    await addCapability('noDeclaration', `export default () => ({});`);
    await addCapability('bogus', `export const type = 'Widget';\nexport default () => ({});`);

    const byName = new Map((await registry.list()).map((c) => [c.name, c.type]));
    expect(byName.get('asText')).toBe('string');
    expect(byName.get('noDeclaration')).toBe('object');
    // An unknown type name is not a Seebo base type — fall back rather than register nonsense.
    expect(byName.get('bogus')).toBe('object');
  });

  it('keeps unusable names out of the engine and explains why', async () => {
    const { registry, addCapability } = await setup();
    const spaced = await addCapability('my cap', OK_SOURCE);
    const shadowing = await addCapability('env', OK_SOURCE);
    const usable = await addCapability('fine', OK_SOURCE);

    expect((await registry.list()).map((c) => c.name)).toEqual(['fine']);
    expect((await registry.describe(spaced)).status).toBe('invalid-name');
    expect((await registry.describe(shadowing)).status).toBe('reserved-name');
    expect((await registry.describe(usable)).status).toBe('ok');
    // The reason is human-readable, not just a code.
    expect((await registry.describe(shadowing)).message).toContain('built-in');
  });

  it('registers neither of two capabilities sharing a name, rather than picking one', async () => {
    const { registry, addCapability } = await setup();
    const first = await addCapability('dup', OK_SOURCE);
    const second = await addCapability('dup', OK_SOURCE);

    // Binding a formula to whichever loaded first would be an invisible coin toss.
    expect(await registry.list()).toEqual([]);
    expect((await registry.describe(first)).status).toBe('duplicate-name');
    expect((await registry.describe(second)).status).toBe('duplicate-name');
    await expect(registry.resolve('dup', { id: 'x' })).rejects.toMatchObject({
      code: 'USER_CODE_NOT_FOUND',
    });
  });

  it('passes the call arguments and the active environment to the runtime', async () => {
    const runtime = new FakeRuntime((req) => ({ seen: req.args }));
    const { registry, environments, addCapability } = await setup(runtime);
    await addCapability('cfg', OK_SOURCE);

    const env = await environments.create({ name: 'Staging', ownerKind: 'workspace' });
    await environments.update(env.id, { vars: { BASE_URL: 'https://api.test' } });
    await environments.setSelection(env.id);

    const value = await registry.resolve('cfg', {
      id: 'c1',
      x: 2,
      capability: 'cfg',
      type: 'object',
    });

    expect(value).toEqual({ seen: { id: 'c1', x: 2 } });
    const call = runtime.calls.at(-1)!;
    expect(call.name).toBe('cfg');
    expect(call.env).toEqual({ BASE_URL: 'https://api.test' });
    // Sandbox is the only profile until the developer unlocks exist.
    expect(call.profile).toBe('sandbox');
  });

  it('refuses to resolve a capability that is not registered', async () => {
    const { registry, addCapability } = await setup();
    await addCapability('env', OK_SOURCE); // reserved → never registered

    await expect(registry.resolve('env', { id: 'x' })).rejects.toMatchObject({
      code: 'USER_CODE_NOT_FOUND',
    });
    await expect(registry.resolve('nope', { id: 'x' })).rejects.toMatchObject({
      code: 'USER_CODE_NOT_FOUND',
    });
  });

  it('picks up an edited source without restarting (the snapshot follows the workspace)', async () => {
    const runtime = new FakeRuntime();
    const { registry, templates, addCapability } = await setup(runtime);
    const id = await addCapability('cfg', OK_SOURCE);
    await registry.resolve('cfg', { id: 'a' });
    expect(runtime.calls.at(-1)!.code).toContain('ok: true');

    await templates.updateSource(id, `export default () => ({ ok: 'edited' });`);
    await registry.resolve('cfg', { id: 'a' });

    expect(runtime.calls.at(-1)!.code).toContain("ok: 'edited'");
    // The hash travels with the source so the host can tell versions apart.
    expect(runtime.calls.at(-1)!.hash).not.toBe(runtime.calls[0]!.hash);
  });

  it('runs a one-off from the editor and reports how long it took', async () => {
    const runtime = new FakeRuntime((req) => ({ echoed: req.args.id }));
    const { registry, addCapability } = await setup(runtime);
    const id = await addCapability('cfg', OK_SOURCE);

    const res = await registry.runOnce(id, { id: 'demo' });
    expect(res.value).toEqual({ echoed: 'demo' });
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('lets a name clash be tested in place but refuses an unusable name', async () => {
    const { registry, addCapability } = await setup();
    await addCapability('dup', OK_SOURCE);
    const duplicate = await addCapability('dup', OK_SOURCE);
    const spaced = await addCapability('my cap', OK_SOURCE);

    // A clash is fixed by renaming, so the author must still be able to run the code they see.
    await expect(registry.runOnce(duplicate, {})).resolves.toBeDefined();
    await expect(registry.runOnce(spaced, {})).rejects.toMatchObject({
      code: 'USER_CODE_REJECTED',
    });
  });
});

describe('SeeboHost with user capabilities', () => {
  /** A provider standing in for the registry: no workspace, no process. */
  const provider = (value: unknown, type = 'object') => ({
    seen: [] as Record<string, unknown>[],
    list: () => Promise.resolve([{ name: 'cfg', type }]),
    resolve(_name: string, requirement: Record<string, unknown>) {
      this.seen.push(requirement);
      return Promise.resolve(value);
    },
  });

  it('resolves a user capability inside a formula', async () => {
    const p = provider({ base: 'https://api.test' });
    const host = new SeeboHost({}, { userCapabilities: p });

    const state = await host.render(`\${ cfg({ id: 'c' }).base }/v1`, {});
    expect(state.status).toBe('completed');
    expect(state.output).toBe('https://api.test/v1');
    expect(p.seen[0]).toMatchObject({ id: 'c' });
  });

  it('reports it as a data capability, so it never becomes an input widget', async () => {
    const host = new SeeboHost({}, { userCapabilities: provider({ base: 'x' }) });

    const names = await host.dataCapabilityNames();
    expect(names.has('cfg')).toBe(true);
    // The built-ins stay in the set.
    expect(names.has('template')).toBe(true);
    // …and the engine does list it as a requirement, which is exactly why callers filter on this set.
    const analysis = await host.analyze(`\${ cfg({ id: 'c' }).base }`);
    expect(analysis.requirements.map((r) => r.capability)).toContain('cfg');
  });

  it('surfaces a failing capability as a diagnostic instead of throwing', async () => {
    const host = new SeeboHost(
      {},
      {
        userCapabilities: {
          list: () => Promise.resolve([{ name: 'cfg', type: 'object' }]),
          resolve: () => Promise.reject(new Error('boom')),
        },
      },
    );

    const state = await host.render(`\${ cfg({ id: 'c' }).base }`, {});
    expect(state.status).toBe('failed');
    expect(state.diagnostics?.[0]?.code).toBe('CAPABILITY_ERROR');
  });

  it('never lets a user capability shadow a built-in', async () => {
    const host = new SeeboHost(
      {},
      {
        envData: { resolve: () => Promise.resolve('from-builtin') },
        userCapabilities: {
          list: () => Promise.resolve([{ name: 'env', type: 'string' }]),
          resolve: () => Promise.resolve('from-user-code'),
        },
      },
    );

    const state = await host.render(`\${ env({ id: 'K' }) }`, {});
    expect(state.output).toBe('from-builtin');
  });
});
