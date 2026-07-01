import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthProfile, AuthState, AuthStatusResponse } from '@swaft/shared';
import { api as defaultClient, ApiClient, ApiError } from '../api-client/client';

/**
 * Renderer-side auth/session state. The renderer is NOT the authority: it reflects the main-process
 * session and forwards credentials over the API client. Passwords are entered here and verified in
 * main; the verifier never reaches the renderer. See SWAFT_SECURITY_MODEL.md §3a, SWAFT_UI_SPEC §2a.
 */
type ViewState = AuthState | 'loading';

interface AuthContextValue {
  state: ViewState;
  profile: AuthProfile | null;
  busy: boolean;
  /** Stable error code of the last failed action (mapped to a localized message by screens). */
  errorCode: string | null;
  signUp(input: { username: string; displayName?: string; password: string }): Promise<void>;
  signIn(input: { username: string; password: string }): Promise<void>;
  unlock(password: string): Promise<void>;
  signOut(): Promise<void>;
  lock(): Promise<void>;
  clearError(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  client = defaultClient,
}: {
  children: ReactNode;
  client?: ApiClient;
}) {
  const [state, setState] = useState<ViewState>('loading');
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const apply = useCallback((res: AuthStatusResponse) => {
    setState(res.state);
    setProfile(res.profile);
  }, []);

  // Initial bootstrap: ask main for the current session state.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await client.call('auth.status');
        if (!cancelled) apply(res);
      } catch {
        if (!cancelled) setState('signed-out');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, apply]);

  /** Run a mutating auth op: manage busy/error and apply the resulting status. */
  const run = useCallback(
    async (fn: () => Promise<AuthStatusResponse>) => {
      setBusy(true);
      setErrorCode(null);
      try {
        apply(await fn());
      } catch (err) {
        setErrorCode(err instanceof ApiError ? err.swaft.code : 'UNKNOWN');
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      profile,
      busy,
      errorCode,
      clearError: () => setErrorCode(null),
      signUp: (input) => run(() => client.call('auth.signUp', input)),
      signIn: (input) => run(() => client.call('auth.signIn', input)),
      unlock: (password) => run(() => client.call('auth.unlock', { password })),
      signOut: () => run(() => client.call('auth.signOut')),
      lock: () => run(() => client.call('auth.lock')),
    }),
    [state, profile, busy, errorCode, run, client],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
