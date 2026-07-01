import type { ReactNode } from 'react';

/** Shared Card surface. `actions` render right-aligned in the (more prominent) header band. */
export function Card({
  title,
  actions,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ui-card">
      {(title != null || actions != null) && (
        <div className="ui-card__head">
          {title != null && <h2 className="ui-card__title">{title}</h2>}
          {actions != null && <div className="ui-card__actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
