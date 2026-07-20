import { describe, it, expect } from 'vitest';
import type { HttpRequestModel, TemplateType } from '@swaft/shared';
import { CryptoService } from '../crypto/CryptoService';
import { SeeboHost } from '../seebo/SeeboHost';
import { InProcessDbBackend } from '../storage/db-backend';
import { ApiRequestService } from './ApiRequestService';
import { ChangelogService } from './ChangelogService';
import { OrganizationService } from './OrganizationService';
import { ReleaseService } from './ReleaseService';
import { TemplateDataProvider } from './TemplateDataProvider';
import { TemplateService } from './TemplateService';
import { WorkspaceService, type WorkspaceFs } from './WorkspaceService';

async function setup() {
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
  await ws.create({ name: 'WS', location: 'mem://api.swaft', encrypt: false });

  const org = new OrganizationService(ws);
  const changelog = new ChangelogService(ws);
  const templates = new TemplateService(ws, org, changelog);
  const releases = new ReleaseService(ws, templates, changelog);
  const templateData = new TemplateDataProvider(ws, releases);
  const host = new SeeboHost({}, { templateData });
  const apiRequest = new ApiRequestService(templates, host, org);

  let tree = await org.createProject({ name: 'P' });
  const projectId = tree.projects[0]!.id;
  tree = await org.createFolder({ name: 'F', projectId });
  const folderId = tree.folders[0]!.id;
  // A second project, to prove the `template` capability is project-scoped.
  tree = await org.createProject({ name: 'Other' });
  const otherProjectId = tree.projects.find((p) => p.name === 'Other')!.id;

  async function newTemplate(
    name: string,
    source: string,
    opts: { type?: TemplateType; subtype?: string; folderId?: string; projectId?: string } = {},
  ): Promise<string> {
    const t = await templates.createTemplate({
      folderId: opts.projectId ? null : (opts.folderId ?? folderId),
      projectId: opts.projectId,
      name,
      source,
      type: opts.type ?? 'document',
      subtype: opts.subtype,
    });
    return t.templates.find((x) => x.name === name)!.id;
  }

  return { apiRequest, newTemplate, org, folderId, projectId, otherProjectId };
}

const GET = (over: Partial<HttpRequestModel>): HttpRequestModel => ({
  method: 'GET',
  url: 'https://example.com',
  ...over,
});

describe('ApiRequestService — formula fields (Fase 1)', () => {
  it('surfaces input widgets but NOT the `template` data capability', async () => {
    const { apiRequest, newTemplate } = await setup();
    await newTemplate('cfg', '{"base":"api.example.com"}', { subtype: 'json' });
    const id = await newTemplate('Call', 'x', { type: 'api', subtype: 'json' });
    const req = GET({
      url: "https://${ template({ id:'cfg', type:object() }).base }/v/${ textbox({ id:'seg', type:string() }) }",
    });

    const { requirements } = await apiRequest.analyze(id, req);
    expect(requirements.map((r) => r.id)).toEqual(['seg']);
  });

  it('hides inputs gated behind an untaken branch and reveals them progressively (lazy)', async () => {
    const { apiRequest, newTemplate } = await setup();
    const id = await newTemplate('Call', 'x', { type: 'api', subtype: 'json' });

    // `amount` is only referenced in the false branch → never reached → not an input.
    const gated = GET({
      url: "https://example.com/${ 1 == 2 ? textbox({ id:'amount', type:string() }) : 'x' }",
    });
    expect((await apiRequest.analyze(id, gated)).requirements).toEqual([]);

    // A condition input gates a second input: only the condition shows until it resolves true.
    const prog = GET({
      url: "https://example.com/${ boolean({ id:'flag', type:bool() }) ? textbox({ id:'seg', type:string() }) : 'x' }",
    });
    expect((await apiRequest.analyze(id, prog, {})).requirements.map((r) => r.id)).toEqual(['flag']);
    expect((await apiRequest.analyze(id, prog, { flag: true })).requirements.map((r) => r.id)).toEqual(
      ['flag', 'seg'],
    );
    expect(
      (await apiRequest.analyze(id, prog, { flag: false })).requirements.map((r) => r.id),
    ).toEqual(['flag']);
  });

  it('surfaces dynamic multiOption options from args.candidates (dependent dropdown)', async () => {
    const { apiRequest, newTemplate } = await setup();
    const id = await newTemplate('Call', 'x', { type: 'api', subtype: 'json' });
    const provider = "${ listbox({ id:'provider', type:string(), options:['Octotelematics','Vodafone'] }) }";
    const companies =
      "${ multiOption({ id:'companies', type:array(), args:{ candidates: provider match { 'Octotelematics' => ['Generali','Genertel'], * => ['Generali'] } } }) }";
    const req = GET({ url: 'https://example.com/' + provider + '/' + companies });

    // Before a provider is chosen: only the listbox is asked, with its static options.
    const a0 = await apiRequest.analyze(id, req, {});
    expect(a0.requirements.map((r) => r.id)).toEqual(['provider']);
    expect(a0.requirements[0]!.options).toEqual(['Octotelematics', 'Vodafone']);

    // After choosing a provider: `companies` appears with the resolved dynamic candidates.
    const a1 = await apiRequest.analyze(id, req, { provider: 'Octotelematics' });
    expect(a1.requirements.find((r) => r.id === 'companies')?.options).toEqual([
      'Generali',
      'Genertel',
    ]);
    const a2 = await apiRequest.analyze(id, req, { provider: 'Vodafone' });
    expect(a2.requirements.find((r) => r.id === 'companies')?.options).toEqual(['Generali']);
  });

  it('resolves url / headers / body with inputs and the `template` capability', async () => {
    const { apiRequest, newTemplate } = await setup();
    await newTemplate('cfg', '{"base":"api.example.com","token":"abc"}', { subtype: 'json' });
    const id = await newTemplate('Call', 'x', { type: 'api', subtype: 'json' });
    const req = GET({
      method: 'POST',
      url: "https://${ template({ id:'cfg', type:object() }).base }/v/${ textbox({ id:'seg', type:string() }) }",
      headers: { Authorization: "Bearer ${ template({ id:'cfg', type:object() }).token }" },
      body: '{"q":"${ textbox({ id:\'seg\', type:string() }) }"}',
      bodyType: 'json',
    });

    const out = await apiRequest.resolve(id, req, { seg: 'users' });
    expect(out.rendered).toBe(true);
    expect(out.request.url).toBe('https://api.example.com/v/users');
    expect(out.request.headers).toEqual({ Authorization: 'Bearer abc' });
    expect(out.request.body).toBe('{"q":"users"}');
  });

  it('throws INPUT_REQUIRED when an input is unfilled', async () => {
    const { apiRequest, newTemplate } = await setup();
    const id = await newTemplate('Call', 'x', { type: 'api', subtype: 'json' });
    const req = GET({ url: "https://example.com/${ textbox({ id:'seg', type:string() }) }" });
    await expect(apiRequest.resolve(id, req, {})).rejects.toMatchObject({ code: 'INPUT_REQUIRED' });
  });

  it('passes plain (formula-free) requests through unchanged', async () => {
    const { apiRequest, newTemplate } = await setup();
    const id = await newTemplate('Call', 'x', { type: 'api', subtype: 'json' });
    const req = GET({ url: 'https://example.com/a?b=1', headers: { 'X-Test': 'plain' } });
    const out = await apiRequest.resolve(id, req, {});
    expect(out.rendered).toBe(false);
    expect(out.request.url).toBe('https://example.com/a?b=1');
    expect(out.request.headers).toEqual({ 'X-Test': 'plain' });
  });

  it('rejects `action(...)` declared in a field (effects are not allowed)', async () => {
    const { apiRequest, newTemplate } = await setup();
    const id = await newTemplate('Call', 'x', { type: 'api', subtype: 'json' });
    const req = GET({
      url: "https://example.com/${ action({ id:'x', type:'log', input:{}, confirm:true, environment:'test' }) }",
    });
    const { diagnostics } = await apiRequest.analyze(id, req);
    expect(diagnostics.some((d) => d.code === 'ACTIONS_NOT_ALLOWED')).toBe(true);
    await expect(apiRequest.resolve(id, req, {})).rejects.toMatchObject({
      code: 'REQUEST_RESOLVE_FAILED',
    });
  });

  it('propagates folder-chain headers (nearest folder wins, request wins) and the nearest proxy', async () => {
    const { apiRequest, newTemplate, org, folderId, projectId } = await setup();
    await org.updateFolderMeta(folderId, {
      headers: { 'X-Root': 'root', 'X-Shared': 'root' },
    });
    const tree = await org.createFolder({ name: 'Sub', projectId, parentFolderId: folderId });
    const subId = tree.folders.find((f) => f.name === 'Sub')!.id;
    await org.updateFolderMeta(subId, {
      headers: { 'X-Shared': 'sub' },
      proxy: { protocol: 'http', hostname: 'proxy.local', port: 8080 },
    });
    const id = await newTemplate('Call', 'x', { type: 'api', subtype: 'json', folderId: subId });

    const out = await apiRequest.resolve(
      id,
      GET({ headers: { 'X-Own': 'own', 'X-Root': 'req' } }),
      {},
    );
    expect(out.request.headers).toEqual({ 'X-Root': 'req', 'X-Shared': 'sub', 'X-Own': 'own' });
    expect(out.proxy).toEqual({ protocol: 'http', hostname: 'proxy.local', port: 8080 });
    expect(out.rendered).toBe(true); // folder headers changed the request → show the render overview
  });

  it('renders Seebo formulas in folder header values and surfaces their inputs', async () => {
    const { apiRequest, newTemplate, org, folderId } = await setup();
    await org.updateFolderMeta(folderId, {
      headers: { 'X-Token': "${ textbox({ id:'tok', type:string() }) }" },
    });
    const id = await newTemplate('Call', 'x', { type: 'api', subtype: 'json' });
    const req = GET({});

    expect((await apiRequest.analyze(id, req, {})).requirements.map((r) => r.id)).toEqual(['tok']);
    await expect(apiRequest.resolve(id, req, {})).rejects.toMatchObject({ code: 'INPUT_REQUIRED' });
    const out = await apiRequest.resolve(id, req, { tok: 'abc' });
    expect(out.request.headers).toEqual({ 'X-Token': 'abc' });
  });

  it('resolves inherit auth from the folder chain and renders its formulas', async () => {
    const { apiRequest, newTemplate, org, folderId } = await setup();
    await org.updateFolderMeta(folderId, {
      auth: { kind: 'bearer', token: "Bearer-${ textbox({ id:'tok', type:string() }) }" },
    });
    const id = await newTemplate('Call', 'x', { type: 'api', subtype: 'json' });

    const req = GET({ auth: { kind: 'inherit' } });
    expect((await apiRequest.analyze(id, req, {})).requirements.map((r) => r.id)).toEqual(['tok']);
    const out = await apiRequest.resolve(id, req, { tok: 'abc' });
    expect(out.request.auth).toMatchObject({ kind: 'bearer', token: 'Bearer-abc' });

    // No folder auth up the chain → inherit resolves to none.
    await org.updateFolderMeta(folderId, { auth: null });
    const none = await apiRequest.resolve(id, req, {});
    expect(none.request.auth?.kind).toBe('none');
  });

  it('renders Seebo formulas in the proxy hostname (and surfaces their inputs)', async () => {
    const { apiRequest, newTemplate, org, folderId } = await setup();
    await org.updateFolderMeta(folderId, {
      proxy: { protocol: 'http', hostname: "${ textbox({ id:'ph', type:string() }) }", port: 8080 },
    });
    const id = await newTemplate('Call', 'x', { type: 'api', subtype: 'json' });

    expect((await apiRequest.analyze(id, GET({}), {})).requirements.map((r) => r.id)).toEqual(['ph']);
    await expect(apiRequest.resolve(id, GET({}), {})).rejects.toMatchObject({
      code: 'INPUT_REQUIRED',
    });
    const out = await apiRequest.resolve(id, GET({}), { ph: 'proxy.local' });
    expect(out.proxy).toEqual({ protocol: 'http', hostname: 'proxy.local', port: 8080 });
  });

  it('fails to resolve a `template` ref outside the same project', async () => {
    const { apiRequest, newTemplate, otherProjectId } = await setup();
    // The json template lives in another project → not visible to `Call`.
    await newTemplate('cfg', '{"base":"api.example.com"}', {
      subtype: 'json',
      projectId: otherProjectId,
    });
    const id = await newTemplate('Call', 'x', { type: 'api', subtype: 'json' });
    const req = GET({ url: "https://${ template({ id:'cfg', type:object() }).base }/v" });
    await expect(apiRequest.resolve(id, req, {})).rejects.toMatchObject({
      code: 'REQUEST_RESOLVE_FAILED',
    });
  });
});
