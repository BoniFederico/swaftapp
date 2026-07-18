import { describe, it, expect } from 'vitest';
import type { HttpRequestModel } from '@swaft/shared';
import { CryptoService } from '../crypto/CryptoService';
import { SeeboHost } from '../seebo/SeeboHost';
import { InProcessDbBackend } from '../storage/db-backend';
import { ApiRequestService } from './ApiRequestService';
import { ChangelogService } from './ChangelogService';
import { EnvironmentService } from './EnvironmentService';
import { OrganizationService } from './OrganizationService';
import { SettingsService } from './SettingsService';
import { TemplateService } from './TemplateService';
import { WorkspaceService, type WorkspaceFs } from './WorkspaceService';

async function setup(username: string | null = 'alice') {
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
  await ws.create({ name: 'WS', location: 'mem://env.swaft', encrypt: false });

  const org = new OrganizationService(ws);
  const settings = new SettingsService(ws);
  const changelog = new ChangelogService(ws);
  const templates = new TemplateService(ws, org, changelog);
  const environments = new EnvironmentService(ws, () => username);
  const host = new SeeboHost({}, { envData: environments });
  const apiRequest = new ApiRequestService(templates, settings, host);

  const tree = await org.createProject({ name: 'P' });
  const projectId = tree.projects[0]!.id;

  async function apiTemplate(): Promise<string> {
    const t = await templates.createTemplate({
      projectId,
      folderId: null,
      name: 'Call',
      source: 'x',
      type: 'api',
      subtype: 'json',
    });
    return t.templates.find((x) => x.name === 'Call')!.id;
  }

  return { environments, apiRequest, apiTemplate, projectId };
}

const GET = (over: Partial<HttpRequestModel>): HttpRequestModel => ({
  method: 'GET',
  url: 'https://example.com',
  ...over,
});

describe('EnvironmentService', () => {
  it('creates environments scoped to user / workspace with the right owner', async () => {
    const { environments } = await setup('alice');
    const personal = await environments.create({ name: 'Personal', ownerKind: 'user' });
    const shared = await environments.create({ name: 'Team', ownerKind: 'workspace' });

    expect(personal.ownerKind).toBe('user');
    expect(personal.ownerId).toBe('alice');

    expect(shared.ownerKind).toBe('workspace');
    expect(shared.ownerId).toBeNull();

    const list = await environments.list();
    expect(list.map((e) => e.name).sort()).toEqual(['Personal', 'Team']);
  });

  it('updates name, description and variables', async () => {
    const { environments } = await setup();
    const env = await environments.create({ name: 'E', ownerKind: 'workspace' });
    await environments.update(env.id, {
      name: 'Renamed',
      description: 'my env',
      vars: { API_URL: 'https://api.test', TOKEN: 'abc' },
    });
    const full = await environments.get(env.id);
    expect(full.name).toBe('Renamed');
    expect(full.description).toBe('my env');
    expect(full.vars).toEqual({ API_URL: 'https://api.test', TOKEN: 'abc' });
    expect((await environments.list()).find((e) => e.id === env.id)?.varCount).toBe(2);
  });

  it('resolves env(KEY) from the active environment; errors when absent', async () => {
    const { environments } = await setup();
    const env = await environments.create({ name: 'E', ownerKind: 'workspace' });
    await environments.update(env.id, { vars: { API_URL: 'https://api.test' } });

    // No active environment yet.
    await expect(environments.resolve('API_URL')).rejects.toMatchObject({ code: 'ENV_NO_ACTIVE' });

    await environments.setSelection(env.id);
    expect(await environments.resolve('API_URL')).toBe('https://api.test');
    await expect(environments.resolve('MISSING')).rejects.toMatchObject({ code: 'ENV_VAR_NOT_FOUND' });
  });

  it('clears the selection when the active environment is deleted', async () => {
    const { environments } = await setup();
    const env = await environments.create({ name: 'E', ownerKind: 'workspace' });
    await environments.setSelection(env.id);
    expect(await environments.getSelection()).toBe(env.id);
    await environments.delete(env.id);
    expect(await environments.getSelection()).toBeNull();
  });
});

describe('env(...) Seebo data capability', () => {
  it('resolves in a request field without surfacing an input, using the active environment', async () => {
    const { environments, apiRequest, apiTemplate } = await setup();
    const env = await environments.create({ name: 'E', ownerKind: 'workspace' });
    await environments.update(env.id, { vars: { base: 'api.example.com', token: 'xyz' } });
    await environments.setSelection(env.id);

    const id = await apiTemplate();
    const req = GET({
      url: "https://${ env({ id:'base', type:string() }) }/v/${ textbox({ id:'seg', type:string() }) }",
      headers: { Authorization: "Bearer ${ env({ id:'token', type:string() }) }" },
    });

    // `env` is auto-resolved data — only the textbox is asked of the user.
    const { requirements } = await apiRequest.analyze(id, req, {});
    expect(requirements.map((r) => r.id)).toEqual(['seg']);

    const out = await apiRequest.resolve(id, req, { seg: 'users' });
    expect(out.request.url).toBe('https://api.example.com/v/users');
    expect(out.request.headers).toEqual({ Authorization: 'Bearer xyz' });
  });

  it('fails to resolve when there is no active environment, with a readable message', async () => {
    const { apiRequest, apiTemplate } = await setup();
    const id = await apiTemplate();
    const req = GET({ url: "https://${ env({ id:'base', type:string() }) }/v" });
    // The message must be the provider's cause, not the opaque "CAPABILITY_ERROR" code.
    await expect(apiRequest.resolve(id, req, {})).rejects.toMatchObject({
      code: 'REQUEST_RESOLVE_FAILED',
    });
    await expect(apiRequest.resolve(id, req, {})).rejects.toThrow(/active environment/i);
  });

  it('surfaces a readable message when a variable is missing from the active environment', async () => {
    const { environments, apiRequest, apiTemplate } = await setup();
    const env = await environments.create({ name: 'E', ownerKind: 'workspace' });
    await environments.setSelection(env.id);
    const id = await apiTemplate();
    const req = GET({ url: "https://${ env({ id:'missing', type:string() }) }/v" });
    await expect(apiRequest.resolve(id, req, {})).rejects.toThrow(/"missing" is not defined/);
  });
});
