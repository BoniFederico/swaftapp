import { describe, expect, it } from 'vitest';
import { isZip } from '@swaft/shared';
import { CryptoService } from '../crypto/CryptoService';
import { InProcessDbBackend } from '../storage/db-backend';
import { LocalAdapter } from './LocalAdapter';
import { MemoryDirFs } from './projection/dir-fs';
import { ContainerService } from './ContainerService';
import type { WorkspaceService } from './WorkspaceService';

let tick = 0;
const isoNow = () => new Date(1_700_000_000_000 + tick++).toISOString();

async function sampleAdapter(): Promise<LocalAdapter> {
  const a = new LocalAdapter(await InProcessDbBackend.open());
  await a.initialize({ name: 'Portable', storageMode: 'local', executionMode: 'sandbox', deviceId: 'dev', now: isoNow() });
  return a;
}

/** A ContainerService over a shared in-memory dir and a mutable byte source. */
function make(adapter: LocalAdapter) {
  const box: { bytes: Uint8Array | null } = { bytes: null };
  const mem = new MemoryDirFs();
  const svc = new ContainerService({
    workspace: { requireAdapter: () => adapter } as unknown as WorkspaceService,
    crypto: new CryptoService(),
    read: () => Promise.resolve(box.bytes),
    dirFs: () => mem,
  });
  return { svc, box, mem };
}

describe('ContainerService', () => {
  it('exports a plaintext container and re-opens it to an extracted folder', async () => {
    const adapter = await sampleAdapter();
    const { svc, box, mem } = make(adapter);

    box.bytes = await svc.export();
    expect(isZip(box.bytes)).toBe(true);

    const dest = await svc.openAsContainer('/somewhere/Portable.swaft');
    expect(dest).not.toBeNull();
    expect(mem.snapshot().has('workspace.json')).toBe(true);
    await adapter.close();
  });

  it('encrypts the container and requires the password to open it', async () => {
    const adapter = await sampleAdapter();
    const { svc, box } = make(adapter);

    box.bytes = await svc.export('super-secret-pass');
    expect(isZip(box.bytes)).toBe(false); // wrapped in the AES envelope, not a bare zip
    expect(new CryptoService().isEncrypted(box.bytes)).toBe(true);

    await expect(svc.openAsContainer('/x/e.swaft')).rejects.toMatchObject({ code: 'PASSWORD_REQUIRED' });
    await expect(svc.openAsContainer('/x/e.swaft', 'wrong')).rejects.toMatchObject({
      code: 'WRONG_WORKSPACE_PASSWORD',
    });
    const dest = await svc.openAsContainer('/x/e.swaft', 'super-secret-pass');
    expect(dest).not.toBeNull();
    await adapter.close();
  });

  it('returns null for a non-container file (legacy SQLite .swaft) so normal open runs', async () => {
    const adapter = await sampleAdapter();
    const { svc, box } = make(adapter);
    box.bytes = new Uint8Array([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65]); // "SQLite" — not a zip
    expect(await svc.openAsContainer('/x/legacy.swaft')).toBeNull();
    await adapter.close();
  });

  it('returns null when the file is absent', async () => {
    const adapter = await sampleAdapter();
    const { svc } = make(adapter); // box.bytes stays null
    expect(await svc.openAsContainer('/x/missing.swaft')).toBeNull();
    await adapter.close();
  });
});
