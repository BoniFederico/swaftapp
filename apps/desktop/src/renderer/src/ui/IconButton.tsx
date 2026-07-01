import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name (also the tooltip), since the button shows only an icon. */
  label: string;
  children: ReactNode;
}

/** Square, icon-only button. The label drives `aria-label`/`title` so it stays accessible. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={`ui-icon-btn ${className ?? ''}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
});
