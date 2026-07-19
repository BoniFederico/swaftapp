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
    expect(s.blockedDomains).toEqual([]);
    expect(s.proxyUrl).toBeNull();
    expect(s.enforcedHeaders).toEqual({});
  });

  it('updates blocked domains + proxy + enforced headers and persists across reopen', async () => {
    const { ws, settings } = await setup();
    await settings.updateSettings({
      blockedDomains: ['evil.example.com'],
      proxyUrl: 'http://proxy:8080',
      enforcedHeaders: { 'X-Tenant': 'acme' },
    });

    await ws.close();
    await ws.open({ path: 'mem://s.swaft' });

    const s = await settings.getSettings();
    expect(s.blockedDomains).toEqual(['evil.example.com']);
    expect(s.proxyUrl).toBe('http://proxy:8080');
    expect(s.enforcedHeaders).toEqual({ 'X-Tenant': 'acme' });
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

});
