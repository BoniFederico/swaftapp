import { useEffect, useRef, useState } from 'react';

/**
 * Shared popover state: open/close, viewport-anchored position from the trigger, and
 * outside-click / Escape dismissal. The popup itself must be rendered in a portal (to `document.body`)
 * so `position: fixed` is viewport-relative — otherwise a transformed ancestor becomes its
 * containing block and the coordinates are wrong.
 */
export function usePopover<E extends HTMLElement>(width = 200) {
  const [open, setOpen] = useState(false);
  // `width` is the trigger's own width, so a popup can choose to match it (e.g. a select dropdown).
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<E>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  function toggle() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setPos({ top: rect.bottom + 4, left, width: rect.width });
    }
    setOpen((o) => !o);
  }

  return { open, setOpen, pos, triggerRef, popRef, toggle };
}
