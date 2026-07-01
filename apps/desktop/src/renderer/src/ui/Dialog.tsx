import { useEffect, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}

/** Shared modal Dialog (role=dialog, Esc to close, backdrop click closes). */
export function Dialog({ open, title, children, footer, onClose }: DialogProps) {
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
        className="ui-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {title != null && <h2 className="ui-dialog__title">{title}</h2>}
        <div>{children}</div>
        {footer != null && <div className="ui-dialog__actions">{footer}</div>}
      </div>
    </div>
  );
}
