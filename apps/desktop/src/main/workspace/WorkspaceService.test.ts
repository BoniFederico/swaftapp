import { describe, it, expect } from 'vitest';
import { AppError } from '../errors';
import { CryptoService } from '../crypto/CryptoService';
import { InProcessDbBackend } from '../storage/db-backend';
import { openSqliteDb } from '../storage/sqlite';
import { SCHEMA_DDL, SCHEMA_VERSION } from '../storage/schema';
import { WorkspaceService, type WorkspaceFs } from './WorkspaceService';

function makeFs() {
  const files = new Map<string, Uint8Array>();
  const fs: WorkspaceFs = {
    read: (p) => Promise.resolve(files.get(p) ?? null),
    write: (p, bytes) => {
      files.set(p, bytes);
      return Promise.resolve();
    },
  };
  return { files, fs };
}

function makeService(fs: WorkspaceFs) {
  return new WorkspaceService({
    createBackend: (bytes) => InProcessDbBackend.open(bytes),
    crypto: new CryptoService(),
    fs,
    deviceId: () => 'device-1',
  });
}

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(AppError);
  await p.catch((e: AppError) => expect(e.code).toBe(code));
}

describe('WorkspaceService', () => {
  it('creates, closes and reopens a plaintext .swaft; data persists', async () => {
    const { files, fs } = makeFs();
    const svc = makeService(fs);

    const created = await svc.create({ name: 'My Workspace', location: 'mem://ws.swaft', encrypt: false });
    expect(created.storageMode).toBe('local');
    expect(created.executionMode).toBe('sandbox');
    expect(created.encrypted).toBe(false);
    expect(svc.current()?.name).toBe('My Workspace');

    // The persisted file is a raw (unencrypted) SQLite image.
    expect(new CryptoService().isEncrypted(files.get('mem://ws.swaft')!)).toBe(false);

    await svc.close();
    expect(svc.current()).toBeNull();

    const opened = await svc.open({ path: 'mem://ws.swaft' });
    expect(opened.name).toBe('My Workspace');
    expect(opened.storageMode).toBe('local');
    expect(opened.executionMode).toBe('sandbox');
  });

  it('forces an immutable local storage mode regardless of reopen', async () => {
    const { fs } = makeFs();
    const svc = makeService(fs);
    const created = await svc.create({ name: 'WS', location: 'mem://a.swaft', encrypt: false });
    expect(created.storageMode).toBe('local');
    await svc.close();
    const opened = await svc.open({ path: 'mem://a.swaft' });
    expect(opened.storageMode).toBe('local'); // no mutation path exists
  });

  it('encrypts the file when requested and enforces the password on open', async () => {
    const { files, fs } = makeFs();
    const svc = makeService(fs);

    const created = await svc.create({
      name: 'Secret',
      location: 'mem://e.swaft',
      encrypt: true,
      password: 'workspace-pass',
    });
    expect(created.encrypted).toBe(true);
    expect(new CryptoService().isEncrypted(files.get('mem://e.swaft')!)).toBe(true);

    await svc.close();
    await expectAppError(svc.open({ path: 'mem://e.swaft' }), 'PASSWORD_REQUIRED');
    await expectAppError(svc.open({ path: 'mem://e.swaft', password: 'wrong-pass' }), 'WRONG_WORKSPACE_PASSWORD');

    const opened = await svc.open({ path: 'mem://e.swaft', password: 'workspace-pass' });
    expect(opened.name).toBe('Secret');
    expect(opened.encrypted).toBe(true);
  });

  it('rejects creating an encrypted workspace without a password', async () => {
    const { fs } = makeFs();
    const svc = makeService(fs);
    await expectAppError(
      svc.create({ name: 'x', location: 'mem://x.swaft', encrypt: true }),
      'PASSWORD_REQUIRED',
    );
  });

  it('rejects a workspace written by a newer schema version', async () => {
    const { files, fs } = makeFs();
    const svc = makeService(fs);

    const db = await openSqliteDb();
    db.exec(SCHEMA_DDL);
    db.setUserVersion(SCHEMA_VERSION + 1);
    const bytes = db.export();
    db.close();
    files.set('mem://new.swaft', bytes);

    await expectAppError(svc.open({ path: 'mem://new.swaft' }), 'SCHEMA_TOO_NEW');
  });

  it('rejects an invalid file and a missing file with coded errors', async () => {
    const { files, fs } = makeFs();
    const svc = makeService(fs);

    files.set('mem://bad.swaft', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    await expectAppError(svc.open({ path: 'mem://bad.swaft' }), 'INVALID_WORKSPACE');
    await expectAppError(svc.open({ path: 'mem://missing.swaft' }), 'WORKSPACE_NOT_FOUND');
  });

  it('records opened workspaces via the onOpened hook', async () => {
    const { fs } = makeFs();
    const opened: string[] = [];
    const svc = new WorkspaceService({
      createBackend: (bytes) => InProcessDbBackend.open(bytes),
      crypto: new CryptoService(),
      fs,
      deviceId: () => 'device-1',
      onOpened: (s) => opened.push(s.path),
    });
    await svc.create({ name: 'Hooked', location: 'mem://h.swaft', encrypt: false });
    expect(opened).toEqual(['mem://h.swaft']);
  });
});
