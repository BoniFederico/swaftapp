import { useState, type FormEvent } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/catalogs';
import { LanguagePicker } from '../settings/LanguagePicker';
import { Button, Card, TextField } from '../ui';
import { useAuth } from './AuthProvider';

/**
 * The unauthenticated gate. Renders sign-up (first run), sign-in, or the locked screen depending on
 * the main-process session state. Built entirely from the shared design system (UI-SPEC §2a).
 */
const SERVER_ERROR_KEYS: Record<string, TranslationKey> = {
  INVALID_CREDENTIALS: 'auth.error.invalid',
  NO_SESSION: 'auth.error.invalid',
  ACCOUNT_LOCKED: 'auth.error.locked',
  USERNAME_TAKEN: 'auth.error.taken',
};

function ErrorLine({ k }: { k: TranslationKey | null }) {
  const { t } = useI18n();
  if (!k) return null;
  return (
    <div className="auth-error" role="alert">
      {t(k)}
    </div>
  );
}

function SignUpForm() {
  const { t } = useI18n();
  const { signUp, busy, errorCode, clearError } = useAuth();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<TranslationKey | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    setLocalError(null);
    if (password.length < 8) return setLocalError('auth.error.tooShort');
    if (password !== confirm) return setLocalError('auth.error.mismatch');
    try {
      await signUp({ username, displayName: displayName || undefined, password });
    } catch {
      /* errorCode is set by the provider */
    }
  }

  const errorKey = localError ?? (errorCode ? (SERVER_ERROR_KEYS[errorCode] ?? 'auth.error.generic') : null);

  return (
    <form className="col" style={{ gap: 'var(--space-4)' }} onSubmit={onSubmit}>
      <TextField
        label={t('auth.username')}
        value={username}
        autoComplete="username"
        onChange={(e) => setUsername(e.target.value)}
      />
      <TextField
        label={t('auth.displayName')}
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      <TextField
        label={t('auth.password')}
        type="password"
        value={password}
        autoComplete="new-password"
        onChange={(e) => setPassword(e.target.value)}
      />
      <div className="auth-hint">{t('auth.password.hint')}</div>
      <TextField
        label={t('auth.confirmPassword')}
        type="password"
        value={confirm}
        autoComplete="new-password"
        onChange={(e) => setConfirm(e.target.value)}
      />
      <ErrorLine k={errorKey} />
      <Button type="submit" disabled={busy}>
        {busy ? t('auth.busy') : t('auth.signUp.submit')}
      </Button>
    </form>
  );
}

function SignInForm() {
  const { t } = useI18n();
  const { signIn, busy, errorCode, clearError } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    try {
      await signIn({ username, password });
    } catch {
      /* errorCode is set by the provider */
    }
  }

  const errorKey = errorCode ? (SERVER_ERROR_KEYS[errorCode] ?? 'auth.error.generic') : null;

  return (
    <form className="col" style={{ gap: 'var(--space-4)' }} onSubmit={onSubmit}>
      <TextField
        label={t('auth.username')}
        value={username}
        autoComplete="username"
        onChange={(e) => setUsername(e.target.value)}
      />
      <TextField
        label={t('auth.password')}
        type="password"
        value={password}
        autoComplete="current-password"
        onChange={(e) => setPassword(e.target.value)}
      />
      <ErrorLine k={errorKey} />
      <Button type="submit" disabled={busy}>
        {busy ? t('auth.busy') : t('auth.signIn.submit')}
      </Button>
    </form>
  );
}

function LockedForm() {
  const { t } = useI18n();
  const { unlock, busy, errorCode, clearError } = useAuth();
  const [password, setPassword] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    try {
      await unlock(password);
    } catch {
      /* errorCode is set by the provider */
    }
  }

  const errorKey = errorCode ? (SERVER_ERROR_KEYS[errorCode] ?? 'auth.error.generic') : null;

  return (
    <form className="col" style={{ gap: 'var(--space-4)' }} onSubmit={onSubmit}>
      <TextField
        label={t('auth.password')}
        type="password"
        value={password}
        autoFocus
        autoComplete="current-password"
        onChange={(e) => setPassword(e.target.value)}
      />
      <ErrorLine k={errorKey} />
      <Button type="submit" disabled={busy}>
        {busy ? t('auth.busy') : t('auth.unlock.submit')}
      </Button>
    </form>
  );
}

type AuthView = 'sign-in' | 'sign-up' | 'locked';

export function AuthScreen() {
  const { t } = useI18n();
  const { state, profile, clearError } = useAuth();
  // Toggle between sign-in and sign-up while signed-out (multiple local accounts are supported).
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');

  const view: AuthView =
    state === 'needs-setup' ? 'sign-up' : state === 'locked' ? 'locked' : mode;

  function switchMode(next: 'sign-in' | 'sign-up') {
    clearError();
    setMode(next);
  }

  const title =
    view === 'sign-up'
      ? t('auth.signUp.title')
      : view === 'locked'
        ? t('auth.locked.title')
        : t('auth.signIn.title');

  const subtitle =
    view === 'sign-up'
      ? t('auth.signUp.subtitle')
      : view === 'locked'
        ? t('auth.locked.subtitle', { name: profile?.displayName ?? '' })
        : t('auth.signIn.subtitle');

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          Swaft<span className="accent">.</span>
        </div>
        <div className="auth-tagline">{t('auth.brandTagline')}</div>

        <Card title={title}>
          <p className="subtitle" style={{ marginBottom: 'var(--space-4)' }}>
            {subtitle}
          </p>
          {view === 'sign-up' && <SignUpForm />}
          {view === 'locked' && <LockedForm />}
          {view === 'sign-in' && <SignInForm />}

          {/* Switching between existing-account sign-in and creating a new account. */}
          {state === 'signed-out' && (
            <button
              type="button"
              className="auth-switch"
              onClick={() => switchMode(view === 'sign-in' ? 'sign-up' : 'sign-in')}
            >
              {view === 'sign-in' ? t('auth.toSignUp') : t('auth.toSignIn')}
            </button>
          )}
        </Card>

        <div className="auth-appearance">
          <LanguagePicker />
        </div>
      </div>
    </div>
  );
}
