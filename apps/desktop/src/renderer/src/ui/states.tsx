import type { ReactNode } from 'react';

/** Shared empty/loading/error state components (UI-SPEC §20, §23.6 UCOH-4). */

export function EmptyState({ title, hint }: { title: ReactNode; hint?: ReactNode }) {
  return (
    <div className="ui-state" role="status">
      <div className="ui-state__title">{title}</div>
      {hint != null && <div>{hint}</div>}
    </div>
  );
}

export function LoadingState({ label }: { label?: ReactNode }) {
  return (
    <div className="ui-state" role="status" aria-live="polite">
      <div className="ui-spinner" />
      {label != null && <div>{label}</div>}
    </div>
  );
}

export function ErrorState({ title, detail }: { title: ReactNode; detail?: ReactNode }) {
  return (
    <div className="ui-state" role="alert">
      <div className="ui-state__title" style={{ color: 'var(--danger)' }}>
        {title}
      </div>
      {detail != null && <div>{detail}</div>}
    </div>
  );
}
