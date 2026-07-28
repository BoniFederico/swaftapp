import { isZip, unzipText, zipText } from '@swaft/shared';
import { AppError } from '../../errors';
import type { LocalAdapter } from '../LocalAdapter';
import { MemoryDirFs, type DirFs } from './dir-fs';
import { dumpWorkspace } from './projection';

/**
 * The `.swaft` **container** codec (open-standards plan D1): a `.swaft` file is a **zip of the open
 * workspace folder** — the exact same projection files a folder/git workspace holds — used to
 * move or archive a workspace as a single portable file, never as the live store.
 *
 * These helpers handle only the zip ⇄ projection-files mapping; whole-file AES encryption of the
 * container (via {@link import('../../crypto/CryptoService').CryptoService}) is layered on top by
 * {@link import('../ContainerService').ContainerService}.
 */

/** Pack the open workspace's projection files into a `.swaft` zip container (plaintext). */
export async function packContainer(adapter: LocalAdapter): Promise<Uint8Array> {
  const mem = new MemoryDirFs();
  await dumpWorkspace(adapter, mem);
  const entries = [...mem.snapshot()].map(([path, text]) => ({ path, text }));
  return zipText(entries);
}

/**
 * Unpack a (plaintext) `.swaft` zip container's files into `dest`. `dest` should be an empty
 * directory; the extracted tree is a folder-backed workspace ready to open.
 */
export async function unpackContainer(bytes: Uint8Array, dest: DirFs): Promise<void> {
  if (!isZip(bytes)) {
    throw new AppError('INVALID_WORKSPACE', 'validation', 'This file is not a Swaft container (.swaft).');
  }
  for (const { path, text } of unzipText(bytes)) await dest.writeFile(path, text);
}
