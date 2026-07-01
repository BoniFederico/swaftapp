import { useEffect, useState } from 'react';
import type { ApiClient } from '../../api-client/client';
import type { TagDto } from '@swaft/shared';
import { useI18n } from '../../i18n/I18nProvider';
import { useWorkspace } from '../../workspace/WorkspaceProvider';
import { Button, IconButton, PlusIcon, TextField } from '../../ui';

/** GENERAL settings: workspace name, icon, and the workspace tag list. */
export function GeneralSettings({ client }: { client: ApiClient }) {
  const { t } = useI18n();
  const { current, update } = useWorkspace();
  const [name, setName] = useState(current?.name ?? '');
  const [icon, setIcon] = useState(current?.icon ?? '');
  const [tags, setTags] = useState<TagDto[]>([]);
  const [draftTag, setDraftTag] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        setTags((await client.call('tree.get')).tree.tags);
      } catch {
        /* best-effort */
      }
    })();
  }, [client]);

  async function saveGeneral() {
    await update({ name: name.trim(), icon: icon.trim() || null });
  }

  async function addTag() {
    const value = draftTag.trim();
    if (!value) return;
    setTags((await client.call('tag.create', { name: value })).tree.tags);
    setDraftTag('');
  }

  async function removeTag(id: string) {
    setTags((await client.call('tag.delete', { id })).tree.tags);
  }

  return (
    <div className="col" style={{ gap: 'var(--space-5)', maxWidth: 440 }}>
      <TextField label={t('gen.name')} value={name} onChange={(e) => setName(e.target.value)} />
      <TextField
        label={t('gen.icon')}
        placeholder={t('gen.iconPlaceholder')}
        value={icon}
        onChange={(e) => setIcon(e.target.value)}
      />
      <div className="row">
        <Button variant="primary" onClick={() => void saveGeneral()} disabled={!name.trim()}>
          {t('wsset.save')}
        </Button>
      </div>

      <div className="ui-field">
        <span className="ui-field__label">{t('gen.tags')}</span>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <input
            className="ui-input"
            aria-label={t('gen.tags')}
            value={draftTag}
            onChange={(e) => setDraftTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addTag();
              }
            }}
          />
          <IconButton label={t('wsset.add')} onClick={() => void addTag()}>
            <PlusIcon />
          </IconButton>
        </div>
        {tags.length === 0 ? (
          <span className="muted">{t('wsset.empty')}</span>
        ) : (
          <ul className="chip-list">
            {tags.map((tag) => (
              <li key={tag.id} className="chip">
                <span>{tag.name}</span>
                <button
                  type="button"
                  className="chip__remove"
                  aria-label={`${t('wsset.remove')} ${tag.name}`}
                  onClick={() => void removeTag(tag.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
