import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Crash-safe file writes: write to a sibling temp file, then rename it over the target. Rename on
 * the same volume is atomic, so a reader (or a crash mid-write) sees either the old bytes or the
 * new bytes — never a torn file. Used for every durable store (`.swaft`, accounts, secrets,
 * app-store), where a torn write would silently destroy user data.
 */
function tempPathFor(path: string): string {
  return `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
}

export function writeFileAtomicSync(
  path: string,
  data: string | Uint8Array,
  options?: { mode?: number },
): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = tempPathFor(path);
  try {
    writeFileSync(tmp, data, options?.mode !== undefined ? { mode: options.mode } : {});
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = tempPathFor(path);
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
