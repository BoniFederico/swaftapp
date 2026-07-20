import { useEffect, useRef, type RefObject } from 'react';

/**
 * Bind Ctrl/Cmd+S to `save`. With a `rootRef`, the shortcut fires only while that element is the
 * visible tab (tabs stay mounted but hidden — `offsetParent` is null when hidden) and no modal is
 * open, since a modal owns the shortcut. Without a `rootRef` the binding is unconditional (used by
 * the editor modal itself). The latest `save` is kept in a ref so the listener never re-binds.
 */
export function useSaveShortcut(save: () => void, rootRef?: RefObject<HTMLElement | null>): void {
  const saveRef = useRef(save);
  saveRef.current = save;
  const hasRoot = rootRef !== undefined;
  const rootRefRef = useRef(rootRef);
  rootRefRef.current = rootRef;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 's' || !(e.ctrlKey || e.metaKey)) return;
      if (hasRoot) {
        if (rootRefRef.current?.current?.offsetParent == null) return; // not the active tab
        if (document.querySelector('[aria-modal="true"]')) return; // a modal owns the shortcut
      }
      e.preventDefault();
      saveRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasRoot]);
}
