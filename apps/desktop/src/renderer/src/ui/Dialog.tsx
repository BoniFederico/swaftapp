import { useEffect, useRef, type ReactNode } from 'react';
import { useFocusTrap } from './useFocusTrap';

interface DialogProps {
  open: boolean;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  /** Extra class on the dialog surface (e.g. `ui-dialog--wide` for a large modal). */
  className?: string;
}

/** Shared modal Dialog (role=dialog, Esc to close, backdrop click closes, focus trapped). */
export function Dialog({ open, title, children, footer, onClose, className }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ui-dialog__backdrop" onClick={onClose}>
      <div
        ref={ref}
        className={`ui-dialog${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {title != null && <h2 className="ui-dialog__title">{title}</h2>}
        <div>{children}</div>
        {footer != null && <div className="ui-dialog__actions">{footer}</div>}
      </div>
    </div>
  );
}
