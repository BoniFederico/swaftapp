import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Minimal directory filesystem port used by the projection layer. All paths are POSIX-style and
 * relative to the workspace root; implementations resolve them against a concrete root (node) or an
 * in-memory map (tests). Kept intentionally small and serializable-friendly so the projection can be
 * unit-tested without touching the real disk (mirrors the {@link import('../persistence/LocalFilePersistence').WorkspaceFs}
 * approach for the single-file mode).
 */
export interface DirFs {
  /** Read a UTF-8 file, or null when it does not exist. */
  readFile(path: string): Promise<string | null>;
  /** Write a UTF-8 file, creating parent directories as needed. */
  writeFile(path: string, content: string): Promise<void>;
  /** Remove a file or directory (recursively); a no-op when the target is absent. */
  remove(path: string): Promise<void>;
  /** Immediate entry names (files and directories) under `dir`; `[]` when `dir` does not exist. */
  list(dir: string): Promise<string[]>;
}

/** Normalize a relative path to POSIX form without a leading `./` or trailing slash. */
function norm(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '');
}

/** {@link DirFs} over the real filesystem, rooted at a directory. */
export class NodeDirFs implements DirFs {
  constructor(private readonly root: string) {}

  private abs(path: string): string {
    return join(this.root, norm(path));
  }

  async readFile(path: string): Promise<string | null> {
    try {
      return await readFile(this.abs(path), 'utf8');
    } catch {
      return null;
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const target = this.abs(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }

  async remove(path: string): Promise<void> {
    await rm(this.abs(path), { recursive: true, force: true });
  }

  async list(dir: string): Promise<string[]> {
    try {
      return await readdir(this.abs(dir));
    } catch {
      return [];
    }
  }
}

/**
 * In-memory {@link DirFs} backed by a path→content map. Used by projection tests and available for
 * dry runs. Directories are implicit (derived from the file keys), matching real filesystem listing.
 */
export class MemoryDirFs implements DirFs {
  constructor(private readonly files = new Map<string, string>()) {}

  /** A snapshot of all files (relative path → content), for assertions. */
  snapshot(): Map<string, string> {
    return new Map(this.files);
  }

  readFile(path: string): Promise<string | null> {
    return Promise.resolve(this.files.get(norm(path)) ?? null);
  }

  writeFile(path: string, content: string): Promise<void> {
    this.files.set(norm(path), content);
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    const target = norm(path);
    const prefix = `${target}/`;
    for (const key of this.files.keys()) {
      if (key === target || key.startsWith(prefix)) this.files.delete(key);
    }
    return Promise.resolve();
  }

  list(dir: string): Promise<string[]> {
    const base = norm(dir);
    const prefix = base === '' ? '' : `${base}/`;
    const entries = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest === '') continue;
      const slash = rest.indexOf('/');
      entries.add(slash === -1 ? rest : rest.slice(0, slash));
    }
    return Promise.resolve([...entries]);
  }
}
