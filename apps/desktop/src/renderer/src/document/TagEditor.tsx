import { useEffect, useRef, useState } from 'react';
import type { TagDto } from '@swaft/shared';
import type { ApiClient } from '../api-client/client';
import { useI18n } from '../i18n/I18nProvider';
import { notifyTreeChanged } from '../workspace/treeBus';

/**
 * Template tags: free-text, reusable across templates, shown as colored badges. Typing filters the
 * existing workspace tags in a dropdown (no chevron — it opens as you type); Enter assigns the typed
 * name (creating the reusable tag if new).
 */
export function TagEditor({ client, templateId }: { client: ApiClient; templateId: string }) {
  const { t } = useI18n();
  const [tags, setTags] = useState<TagDto[]>([]);
  const [all, setAll] = useState<TagDto[]>([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void client
      .call('template.tags.list', { templateId })
      .then((r) => setTags(r.tags))
      .catch(() => undefined);
    void client
      .call('tag.list')
      .then((r) => setAll(r.tags))
      .catch(() => undefined);
  }, [client, templateId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const query = input.trim().toLowerCase();
  const suggestions = all.filter(
    (a) => !tags.some((tg) => tg.id === a.id) && a.name.toLowerCase().includes(query),
  );

  async function add(name: string) {
    if (!name.trim()) return;
    setTags((await client.call('template.tags.add', { templateId, name: name.trim() })).tags);
    setAll((await client.call('tag.list')).tags);
    setInput('');
    setOpen(false);
    notifyTreeChanged();
  }

  async function remove(tagId: string) {
    setTags((await client.call('template.tags.remove', { templateId, tagId })).tags);
    notifyTreeChanged();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void add(open && suggestions[active] ? suggestions[active]!.name : input);
    } else if (e.key === 'ArrowDown' && open) {
      e.preventDefault();
      setActive((a) => Math.min(suggestions.length - 1, a + 1));
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="tag-editor">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="tag-badge"
          style={{ background: tag.color ?? 'var(--surface-2)' }}
        >
          {tag.name}
          <button
            type="button"
            className="tag-badge__x"
            aria-label={t('editor.removeTag', { name: tag.name })}
            onClick={() => void remove(tag.id)}
          >
            ×
          </button>
        </span>
      ))}
      <div className="tag-combo" ref={wrapRef}>
        <input
          className="tag-editor__input"
          aria-label={t('editor.addTag')}
          placeholder={t('editor.addTag')}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setActive(0);
            setOpen(e.target.value.trim() !== '');
          }}
          onFocus={() => setOpen(input.trim() !== '')}
          onKeyDown={onKeyDown}
        />
        {open && suggestions.length > 0 && (
          <ul className="ui-listbox tag-suggest" role="listbox">
            {suggestions.map((s, i) => (
              <li
                key={s.id}
                role="option"
                aria-selected={i === active}
                data-active={i === active}
                className="ui-option"
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  void add(s.name);
                }}
              >
                <span className="tag-dot" style={{ background: s.color ?? 'var(--surface-2)' }} />
                {s.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
