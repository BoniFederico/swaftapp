import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { EnvironmentSummaryDto } from '@swaft/shared';
import { api as defaultClient, ApiClient } from '../api-client/client';

/**
 * Renderer-side state for environments: the list plus the workspace's active selection. Feeds the
 * header picker and the settings section, and is the single source of truth so a change in one place
 * (select an env, edit/create/delete in settings) reflects in the other. The renderer is not the
 * authority — it mirrors what the main-process EnvironmentService reports.
 */
interface EnvironmentContextValue {
  environments: EnvironmentSummaryDto[];
  activeId: string | null;
  active: EnvironmentSummaryDto | null;
  loading: boolean;
  /**
   * Bumps whenever the active environment — or its variables — may have changed (select a different
   * env, or save an edit in settings). Views that resolve `env(...)` watch this to re-render.
   */
  revision: number;
  /** Reload the list + active selection from main (after a create/edit/delete in settings). */
  refresh(): Promise<void>;
  /** Set (or clear, with null) the active environment. */
  setActive(environmentId: string | null): Promise<void>;
}

const EnvironmentContext = createContext<EnvironmentContextValue | null>(null);

export function EnvironmentProvider({
  children,
  client = defaultClient,
}: {
  children: ReactNode;
  client?: ApiClient;
}) {
  const [environments, setEnvironments] = useState<EnvironmentSummaryDto[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [list, sel] = await Promise.all([
        client.call('env.list'),
        client.call('env.selection.get'),
      ]);
      setEnvironments(list.environments);
      setActiveId(sel.environmentId);
    } catch {
      setEnvironments([]);
      setActiveId(null);
    } finally {
      // A refresh follows any env edit (vars included) — nudge watchers to re-resolve `env(...)`.
      setRevision((r) => r + 1);
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const setActive = useCallback(
    async (environmentId: string | null) => {
      const res = await client.call('env.selection.set', { environmentId });
      setActiveId(res.environmentId);
      setRevision((r) => r + 1);
    },
    [client],
  );

  const value = useMemo<EnvironmentContextValue>(
    () => ({
      environments,
      activeId,
      active: environments.find((e) => e.id === activeId) ?? null,
      loading,
      revision,
      refresh,
      setActive,
    }),
    [environments, activeId, loading, revision, refresh, setActive],
  );

  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>;
}

export function useEnvironments(): EnvironmentContextValue {
  const ctx = useContext(EnvironmentContext);
  if (!ctx) throw new Error('useEnvironments must be used within an EnvironmentProvider');
  return ctx;
}

/** Like {@link useEnvironments} but returns null outside a provider (isolated component tests). */
export function useEnvironmentsOptional(): EnvironmentContextValue | null {
  return useContext(EnvironmentContext);
}
