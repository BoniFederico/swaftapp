import { describe, it, expect } from 'vitest';
import { AppError } from '../errors';
import { CryptoService } from '../crypto/CryptoService';
import { InProcessDbBackend } from '../storage/db-backend';
import { SettingsService } from './SettingsService';
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
  await ws.create({ name: 'WS', location: 'mem://s.swaft', encrypt: false });
  return { ws, settings: new SettingsService(ws) };
}

describe('SettingsService', () => {
  it('returns safe defaults on first access', async () => {
    const { settings } = await setup();
    const s = await settings.getSettings();
    expect(s.executionMode).toBe('sandbox');
    expect(s.allowedDomains).toEqual([]);
    expect(s.proxyUrl).toBeNull();
    expect(s.fileExportRoot).toBeNull();
  });

  it('updates allowed domains + proxy and persists across reopen', async () => {
    const { ws, settings } = await setup();
    await settings.updateSettings({
      allowedDomains: ['api.example.com'],
      proxyUrl: 'http://proxy:8080',
    });

    await ws.close();
    await ws.open({ path: 'mem://s.swaft' });

    const s = await settings.getSettings();
    expect(s.allowedDomains).toEqual(['api.example.com']);
    expect(s.proxyUrl).toBe('http://proxy:8080');
  });

  it('gates the dev execution mode behind explicit confirmation', async () => {
    const { settings } = await setup();
    await expect(settings.updateSettings({ executionMode: 'dev' })).rejects.toBeInstanceOf(AppError);
    await settings
      .updateSettings({ executionMode: 'dev' })
      .catch((e: AppError) => expect(e.code).toBe('DEV_CONFIRMATION_REQUIRED'));

    const s = await settings.updateSettings({ executionMode: 'dev', confirmDev: true });
    expect(s.executionMode).toBe('dev');
  });

  it('manages restrictions (create/list/delete)', async () => {
    const { settings } = await setup();
    let list = await settings.createRestriction({ kind: 'capability', value: 'jsonInput' });
    expect(list.map((r) => r.value)).toEqual(['jsonInput']);

    const id = list[0]!.id;
    list = await settings.deleteRestriction(id);
    expect(list).toHaveLength(0);
  });
});
