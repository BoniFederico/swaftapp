import { useEffect, useState } from 'react';
import type { GitFileDiffResponse } from '@swaft/shared';
import type { ApiClient } from '../api-client/client';
import { CodeEditor } from '../editor/CodeEditor';
import { useI18n } from '../i18n/I18nProvider';
import { Button, Dialog, EmptyState, LoadingState } from '../ui';

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

/** One read-only editor pane (committed or working-tree side), or a placeholder when absent. */
function DiffPane({
  title,
  content,
  language,
  absentLabel,
}: {
  title: string;
  content: string | null;
  language: string | null;
  absentLabel: string;
}) {
  return (
    <div className="git-diff__pane">
      <div className="git-diff__paneHead">{title}</div>
      <div className="git-diff__editor">
        {content == null ? (
          <EmptyState title={absentLabel} />
        ) : (
          <CodeEditor value={content} language={language} onChange={() => {}} readOnly ariaLabel={title} />
        )}
      </div>
    </div>
  );
}

/**
 * Side-by-side diff for one changed file: the committed (HEAD) version next to the current
 * working-tree version, each in a read-only CodeMirror editor — the same editor the Template Editor
 * uses, so it looks consistent. Opened by clicking a change in the Git panel.
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
          <DiffPane
            title={t('git.diff.old')}
            content={diff.old}
            language={language}
            absentLabel={t('git.diff.added')}
          />
          <DiffPane
            title={t('git.diff.current')}
            content={diff.current}
            language={language}
            absentLabel={t('git.diff.removed')}
          />
        </div>
      )}
    </Dialog>
  );
}
