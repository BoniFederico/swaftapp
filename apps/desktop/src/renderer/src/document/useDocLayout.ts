import { useEffect, useRef, useState } from 'react';

export interface DocLayout {
  /** Width (px) of the Input panel; the Output panel takes the rest. */
  panelWidth: number;
  /** Explicit height (px) when the user has lengthened the view, else null (= fill). */
  height: number | null;
  /** Pointer-down on the horizontal divider between Input and Output. */
  onHResize: (e: React.PointerEvent) => void;
  /** Pointer-down on the bottom divider (vertical lengthen). */
  onVResize: (e: React.PointerEvent) => void;
}

const MIN_PANEL = 240;
const MIN_OUTPUT = 280;
const MIN_HEIGHT = 320;

/**
 * Persisted, two-axis resizing for the Document/Batch layout: a horizontal split between the Input
 * and Output panels and a vertical lengthen of the whole area. Choices are saved under `storageKey`
 * (one key per project) so they persist across sessions.
 */
export function useDocLayout(
  storageKey: string | null,
  containerRef: React.RefObject<HTMLElement>,
  opts: { defaultPanelWidth?: number } = {},
): DocLayout {
  const defaultPanelWidth = opts.defaultPanelWidth ?? 360;
  const [panelWidth, setPanelWidth] = useState(defaultPanelWidth);
  const [height, setHeight] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const drag = useRef<{ axis: 'x' | 'y'; start: number; base: number } | null>(null);

  // Load saved layout for this project.
  useEffect(() => {
    setLoaded(false);
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const v = JSON.parse(raw) as { panelWidth?: number; height?: number | null };
        if (typeof v.panelWidth === 'number') setPanelWidth(v.panelWidth);
        setHeight(typeof v.height === 'number' ? v.height : null);
      } else {
        setPanelWidth(defaultPanelWidth);
        setHeight(null);
      }
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, [storageKey]);

  // Persist on change.
  useEffect(() => {
    if (!storageKey || !loaded) return;
    localStorage.setItem(storageKey, JSON.stringify({ panelWidth, height }));
  }, [storageKey, loaded, panelWidth, height]);

  function startDrag(axis: 'x' | 'y', e: React.PointerEvent) {
    e.preventDefault();
    const container = containerRef.current;
    const base =
      axis === 'x' ? panelWidth : (height ?? container?.getBoundingClientRect().height ?? MIN_HEIGHT);
    drag.current = { axis, start: axis === 'x' ? e.clientX : e.clientY, base };
    const onMove = (ev: PointerEvent) => {
      if (!drag.current) return;
      if (drag.current.axis === 'x') {
        const maxPanel = (container?.getBoundingClientRect().width ?? 1200) - MIN_OUTPUT;
        const next = drag.current.base + (ev.clientX - drag.current.start);
        setPanelWidth(Math.max(MIN_PANEL, Math.min(maxPanel, next)));
      } else {
        const next = drag.current.base + (ev.clientY - drag.current.start);
        setHeight(Math.max(MIN_HEIGHT, next));
      }
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return {
    panelWidth,
    height,
    onHResize: (e) => startDrag('x', e),
    onVResize: (e) => startDrag('y', e),
  };
}
