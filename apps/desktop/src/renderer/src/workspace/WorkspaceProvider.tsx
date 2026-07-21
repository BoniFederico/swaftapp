import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  RecentWorkspace,
  WorkspaceCreateRequest,
  WorkspaceSummary,
  WorkspaceUpdateRequest,
} from '@swaft/shared';
import { api as defaultClient, ApiClient, ApiError } from '../api-client/client';

/**
 * Renderer-side workspace state: the open workspace + the recent list, with create/open/close
 * commands routed through the API client to the main-process WorkspaceService. The renderer is not
 * the authority — it reflects what main reports. See SWAFT_UI_SPEC.md §2–§3.
 */
interface WorkspaceContextValue {
  current: WorkspaceSummary | null;
  recent: RecentWorkspace[];
  loading: boolean;
  busy: boolean;
  errorCode: string | null;
  /** Whether git is usable in this host; null while unknown. Gates the Git storage mode. */
  gitAvailable: boolean | null;
  create(req: WorkspaceCreateRequest): Promise<void>;
  open(path: string, password?: string): Promise<void>;
  /** Clone a Git repository from `url` into `parentDir`, then open it. */
  cloneAndOpen(url: string, parentDir: string): Promise<void>;
  update(patch: WorkspaceUpdateRequest): Promise<void>;
  close(): Promise<void>;
  refresh(): Promise<void>;
  clearError(): void;
  /** Native "save as" for a new `.swaft`; returns the chosen path or null. */
  pickCreateTarget(defaultName?: string): Promise<string | null>;
  /** Native "open" for an existing `.swaft`; returns the chosen path or null. */
  pickOpenTarget(): Promise<string | null>;
  /** Native directory picker (for a Git workspace folder); returns the path or null. */
  pickDirectory(): Promise<string | null>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  children,
  client = defaultClient,
}: {
  children: ReactNode;
  client?: ApiClient;
}) {
  const [current, setCurrent] = useState<WorkspaceSummary | null>(null);
  const [recent, setRecent] = useState<RecentWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [cur, rec] = await Promise.all([
        client.call('workspace.current'),
        client.call('workspace.recent'),
      ]);
      setCurrent(cur.workspace);
      setRecent(rec.items);
    } catch {
      // Best-effort: if the backend is unavailable, fall back to the empty homepage.
      setCurrent(null);
      setRecent([]);
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refresh();
      if (!cancelled) setLoading(false);
      // Probe git once so the wizard can gate the Git storage mode (best-effort).
      try {
        const res = await client.call('git.available');
        if (!cancelled) setGitAvailable(res.available);
      } catch {
        if (!cancelled) setGitAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, client]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setErrorCode(null);
      try {
        await fn();
      } catch (err) {
        setErrorCode(err instanceof ApiError ? err.swaft.code : 'UNKNOWN');
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      current,
      recent,
      loading,
      busy,
      errorCode,
      gitAvailable,
      clearError: () => setErrorCode(null),
      create: (req) =>
        run(async () => {
          const res = await client.call('workspace.create', req);
          setCurrent(res.workspace);
          await refresh();
        }),
      open: (path, password) =>
        run(async () => {
          const res = await client.call('workspace.open', { path, password });
          setCurrent(res.workspace);
          await refresh();
        }),
      cloneAndOpen: (url, parentDir) =>
        run(async () => {
          // The backend opens an existing Swaft repo, or initializes a fresh workspace into an
          // empty remote (keeping origin for the first push).
          const res = await client.call('git.clone', { url, parentDir });
          setCurrent(res.workspace);
          await refresh();
        }),
      update: (patch) =>
        run(async () => {
          const res = await client.call('workspace.update', patch);
          setCurrent(res.workspace);
        }),
      close: () =>
        run(async () => {
          await client.call('workspace.close');
          setCurrent(null);
          await refresh();
        }),
      refresh,
      pickCreateTarget: async (defaultName) => {
        try {
          return (await client.call('dialog.createTarget', { defaultName })).path;
        } catch {
          return null;
        }
      },
      pickOpenTarget: async () => {
        try {
          return (await client.call('dialog.openTarget')).path;
        } catch {
          return null;
        }
      },
      pickDirectory: async () => {
        try {
          return (await client.call('dialog.pickDirectory')).path;
        } catch {
          return null;
        }
      },
    }),
    [current, recent, loading, busy, errorCode, gitAvailable, run, client, refresh],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return ctx;
}

/** Like {@link useWorkspace} but returns null outside a provider (e.g. in isolated component tests). */
export function useWorkspaceOptional(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext);
}
