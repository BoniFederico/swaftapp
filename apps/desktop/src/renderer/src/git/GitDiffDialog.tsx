import { useEffect, useState } from 'react';
import type { GitFileDiffResponse } from '@swaft/shared';
import type { ApiClient } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Dialog, EmptyState, LoadingState } from '../ui';
import { GitDiffView } from './GitDiffView';

/** Map a versioned file's extension to a CodeEditor language (best-effort; null = plain text). */
function languageForPath(path: string): string | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'js':
      return 'javascript';
    case 'html':
      return 'html';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'mmd':
      return 'mermaid';
    default:
      return null;
  }
}

/**
 * Side-by-side diff for one changed file: the committed (HEAD) version next to the current
 * working-tree version in CodeMirror's native `MergeView`, which highlights the changed lines and
 * keeps syntax highlighting. Opened by clicking a change in the Git panel.
 */
export function GitDiffDialog({
  open,
  client,
  path,
  label,
  onClose,
}: {
  open: boolean;
  client: ApiClient;
  path: string | null;
  label?: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [diff, setDiff] = useState<GitFileDiffResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || !path) return;
    let cancelled = false;
    setDiff(null);
    setError(false);
    void client
      .call('git.fileDiff', { path })
      .then((res) => !cancelled && setDiff(res))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [open, path, client]);

  const language = languageForPath(path ?? '');

  return (
    <Dialog
      open={open}
      className="ui-dialog--wide git-diff-dialog"
      backdropClassName="git-diff-backdrop"
      title={
        <span className="git-diff__title">
          <span className="git-diff__titleName">{label ?? path}</span>
          {label && path && <span className="git-diff__titlePath muted">{path}</span>}
        </span>
      }
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('git.diff.close')}
        </Button>
      }
    >
      {error ? (
        <EmptyState title={t('git.diff.error')} />
      ) : !diff ? (
        <LoadingState label={t('git.diff.loading')} />
      ) : (
        <div className="git-diff">
          <div className="git-diff__legend">
            <span>{t('git.diff.old')}</span>
            <span>{t('git.diff.current')}</span>
          </div>
          {diff.old == null && <div className="git-diff__note muted">{t('git.diff.added')}</div>}
          {diff.current == null && <div className="git-diff__note muted">{t('git.diff.removed')}</div>}
          <div className="git-diff__body">
            <GitDiffView
              oldText={diff.old ?? ''}
              newText={diff.current ?? ''}
              language={language}
            />
          </div>
        </div>
      )}
    </Dialog>
  );
}
