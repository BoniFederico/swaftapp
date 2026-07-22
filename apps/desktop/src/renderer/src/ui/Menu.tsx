import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';
import { MoreIcon } from './icons';
import { usePopover } from './usePopover';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * Three-dot action menu. The popup is portalled to `document.body` and `position: fixed` at the
 * trigger's coordinates, so it anchors next to the button and escapes the Working Tree's scroll
 * clipping (and any transformed ancestor). Closes on outside-click / Escape.
 */
export function Menu({
  label,
  items,
  icon,
}: {
  label: string;
  items: MenuItem[];
  /** Trigger glyph; defaults to the three-dot icon. */
  icon?: ReactNode;
}) {
  const { open, setOpen, pos, triggerRef, popRef, toggle } = usePopover<HTMLUListElement>();

  return (
    <>
      <IconButton ref={triggerRef} label={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        {icon ?? <MoreIcon />}
      </IconButton>
      {open &&
        createPortal(
          <ul
            ref={popRef}
            role="menu"
            className="ui-menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
          >
            {items.map((item) => (
              <li key={item.label} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={`ui-menu__item${item.danger ? ' ui-menu__item--danger' : ''}`}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
