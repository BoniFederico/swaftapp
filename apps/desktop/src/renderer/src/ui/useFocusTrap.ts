import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep keyboard focus inside a modal container while it is mounted (WCAG 2.4.3): move focus in on
 * open, cycle Tab/Shift+Tab at the edges, and restore focus to the previously focused element on
 * close. The container should have `tabIndex={-1}` so it can take initial focus when it holds no
 * focusable control.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = () => [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
    (focusables()[0] ?? container).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = els[0]!;
      const last = els[els.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === container)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    container.addEventListener('keydown', onKey);
    return () => {
      container.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [ref, active]);
}
