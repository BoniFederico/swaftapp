import { useState, type ReactNode, type UIEvent } from 'react';

interface VirtualListProps<T> {
  items: T[];
  /** Fixed row height in px. */
  itemHeight: number;
  /** Viewport height in px. */
  height: number;
  /** Extra rows rendered above/below the viewport to smooth scrolling. */
  overscan?: number;
  renderItem: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string;
}

/**
 * Minimal fixed-height windowed list. Renders only the rows intersecting the viewport (+ overscan),
 * so a large Working Tree stays cheap without a heavy dependency (consistent with the project's
 * lean-deps approach). Rows are absolutely positioned inside a full-height spacer.
 */
export function VirtualList<T>({
  items,
  itemHeight,
  height,
  overscan = 4,
  renderItem,
  getKey,
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);

  const total = items.length * itemHeight;
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(height / itemHeight) + overscan * 2;
  const end = Math.min(items.length, start + visibleCount);

  return (
    <div
      className="ui-vlist"
      style={{ height }}
      onScroll={(e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="ui-vlist__spacer" style={{ height: total }}>
        {items.slice(start, end).map((item, i) => {
          const index = start + i;
          return (
            <div
              key={getKey(item, index)}
              className="ui-vlist__row"
              style={{ height: itemHeight, transform: `translateY(${index * itemHeight}px)` }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
