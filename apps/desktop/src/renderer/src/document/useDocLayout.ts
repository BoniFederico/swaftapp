import { useEffect, useRef, useState } from 'react';

export interface DocLayout {
  /** Width (px) of the Input panel; the Output panel takes the rest. */
  panelWidth: number;
  /** Explicit height (px) when the user has lengthened the view, else null (= fill). */
  height: number | null;
  /** Height (px) of the Actions panel below the output; the output takes the rest. */
  actionsHeight: number;
  /** Pointer-down on the horizontal divider between Input and Output. */
  onHResize: (e: React.PointerEvent) => void;
  /** Pointer-down on the bottom divider (vertical lengthen). */
  onVResize: (e: React.PointerEvent) => void;
  /** Pointer-down on the divider between Output and the Actions panel. */
  onActionsResize: (e: React.PointerEvent) => void;
}

const MIN_PANEL = 240;
const MIN_OUTPUT = 280;
const MIN_HEIGHT = 320;
const MIN_ACTIONS = 100;
/** Keep the output at least this tall when growing the actions panel. */
const MIN_OUTPUT_H = 160;
const DEFAULT_ACTIONS = 200;

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
  const [actionsHeight, setActionsHeight] = useState(DEFAULT_ACTIONS);
  const [loaded, setLoaded] = useState(false);
  const drag = useRef<{ axis: 'x' | 'y' | 'a'; start: number; base: number } | null>(null);

  // Load saved layout for this project.
  useEffect(() => {
    setLoaded(false);
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const v = JSON.parse(raw) as {
          panelWidth?: number;
          height?: number | null;
          actionsHeight?: number;
        };
        if (typeof v.panelWidth === 'number') setPanelWidth(v.panelWidth);
        setHeight(typeof v.height === 'number' ? v.height : null);
        setActionsHeight(typeof v.actionsHeight === 'number' ? v.actionsHeight : DEFAULT_ACTIONS);
      } else {
        setPanelWidth(defaultPanelWidth);
        setHeight(null);
        setActionsHeight(DEFAULT_ACTIONS);
      }
    } catch {
      /* ignore */
    }
    setLoaded(true);
    // Re-load only when the storage key changes; defaultPanelWidth is a fallback, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Persist on change.
  useEffect(() => {
    if (!storageKey || !loaded) return;
    localStorage.setItem(storageKey, JSON.stringify({ panelWidth, height, actionsHeight }));
  }, [storageKey, loaded, panelWidth, height, actionsHeight]);

  function startDrag(axis: 'x' | 'y' | 'a', e: React.PointerEvent) {
    e.preventDefault();
    const container = containerRef.current;
    const base =
      axis === 'x'
        ? panelWidth
        : axis === 'a'
          ? actionsHeight
          : (height ?? container?.getBoundingClientRect().height ?? MIN_HEIGHT);
    drag.current = { axis, start: axis === 'x' ? e.clientX : e.clientY, base };
    const onMove = (ev: PointerEvent) => {
      if (!drag.current) return;
      if (drag.current.axis === 'x') {
        const maxPanel = (container?.getBoundingClientRect().width ?? 1200) - MIN_OUTPUT;
        const next = drag.current.base + (ev.clientX - drag.current.start);
        setPanelWidth(Math.max(MIN_PANEL, Math.min(maxPanel, next)));
      } else if (drag.current.axis === 'a') {
        // Dragging the divider up grows the actions panel; the output keeps at least MIN_OUTPUT_H.
        const areaH = container?.getBoundingClientRect().height ?? MIN_HEIGHT;
        const maxActions = Math.max(MIN_ACTIONS, areaH - MIN_OUTPUT_H);
        const next = drag.current.base + (drag.current.start - ev.clientY);
        setActionsHeight(Math.max(MIN_ACTIONS, Math.min(maxActions, next)));
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
    actionsHeight,
    onHResize: (e) => startDrag('x', e),
    onVResize: (e) => startDrag('y', e),
    onActionsResize: (e) => startDrag('a', e),
  };
}
