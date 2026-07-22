import { useId, type SVGProps } from 'react';

type SwaftMarkProps = { size?: number | string } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>;

/**
 * The Swaft app mark — a rounded tile whose "S" is drawn as a routed connector (a nod to the
 * scenario node graph) ending in the accent dot of the `Swaft.` wordmark.
 *
 * The tile follows the runtime primary color: its gradient stops are themed in CSS
 * (`.swaft-mark__tile-*`) via `color-mix(var(--primary) …)`, so the in-app mark recolors with the
 * user's chosen accent — cohesive with the wordmark dot. (Note: `var()` is not resolved in SVG
 * presentation attributes, so the stop colors must live in CSS, not on the elements.) The packaged
 * executable / taskbar icon at `apps/desktop/buildResources/icon.svg` stays the fixed brand blue — it is a
 * static asset that cannot read runtime CSS.
 *
 * The gradient ids are salted with `useId()` so multiple instances on one page never collide (an
 * SVG `url(#id)` reference resolves to the first matching def in the document, not the local one).
 * Defaults to `1em` so it scales with the surrounding font-size; pass `size` for a fixed box.
 */
export function SwaftMark({ size = '1em', ...props }: SwaftMarkProps) {
  const uid = useId();
  const tile = `swaft-tile-${uid}`;
  const sheen = `swaft-sheen-${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      role="img"
      aria-label="Swaft"
      {...props}
    >
      <defs>
        <linearGradient id={tile} x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
          <stop offset="0" className="swaft-mark__tile-hi" />
          <stop offset="0.55" className="swaft-mark__tile-mid" />
          <stop offset="1" className="swaft-mark__tile-lo" />
        </linearGradient>
        <linearGradient id={sheen} x1="512" y1="0" x2="512" y2="560" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1024" height="1024" rx="232" fill={`url(#${tile})`} />
      <rect x="0" y="0" width="1024" height="1024" rx="232" fill={`url(#${sheen})`} />
      <path
        d="M652 392 C652 324 588 292 512 292 C428 292 366 344 366 418 C366 486 424 516 512 528 C600 540 658 566 658 634 C658 708 596 732 512 732 C436 732 372 700 372 632"
        fill="none"
        stroke="#ffffff"
        strokeWidth="112"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="748" cy="740" r="58" fill="#ffffff" />
    </svg>
  );
}
