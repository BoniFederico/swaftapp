import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { usePopover } from './usePopover';
import type { ButtonVariant } from './Button';

export interface SplitButtonItem {
  id: string;
  label: string;
}

/**
 * A button that either performs a single action or opens a portalled menu of choices — the shared
 * "listbox of buttons" shape used by the scenario Run/Add controls and the homepage Create/Open
 * entry points. With `directWhenSingle` and exactly one item it collapses to a plain button (no
 * caret) that picks that item directly; the trigger is disabled (and caret-less) when there are none.
 *
 * The visible `label` can be short (e.g. "Create") while `ariaLabel` supplies a fuller accessible
 * name (e.g. "Create workspace") for screen readers and tests.
 */
export function SplitButton({
  label,
  ariaLabel,
  variant = 'primary',
  icon,
  items,
  disabled,
  directWhenSingle,
  menuWidth = 220,
  className,
  onPick,
}: {
  label: ReactNode;
  ariaLabel?: string;
  variant?: ButtonVariant;
  icon?: ReactNode;
  items: SplitButtonItem[];
  disabled?: boolean;
  directWhenSingle?: boolean;
  menuWidth?: number;
  className?: string;
  onPick: (id: string) => void;
}) {
  const { open, setOpen, pos, triggerRef, popRef, toggle } = usePopover<HTMLUListElement>(menuWidth);
  const direct = !!directWhenSingle && items.length === 1;
  const empty = items.length === 0;

  function onClick() {
    if (direct) onPick(items[0]!.id);
    else toggle();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`ui-btn ui-btn--${variant} ui-split-btn${className ? ` ${className}` : ''}`}
        disabled={disabled || empty}
        aria-label={ariaLabel}
        aria-haspopup={direct ? undefined : 'menu'}
        aria-expanded={direct ? undefined : open}
        onClick={onClick}
      >
        {icon}
        <span>{label}</span>
        {!direct && (
          <span className="ui-select__chevron" aria-hidden="true">
            ▾
          </span>
        )}
      </button>
      {open &&
        !direct &&
        createPortal(
          <ul
            ref={popRef}
            role="menu"
            className="ui-menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
          >
            {items.map((it) => (
              <li key={it.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="ui-menu__item"
                  onClick={() => {
                    setOpen(false);
                    onPick(it.id);
                  }}
                >
                  {it.label}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
