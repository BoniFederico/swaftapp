import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastContextValue {
  show: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Shared toast system: one ToastProvider near the root; components call useToast().show(). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  // Clear pending dismiss timers on unmount so they can't fire setState afterwards.
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 3500);
    timers.current.add(timer);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="ui-toasts" aria-live="polite" aria-atomic="true">
        {toasts.map((t) => (
          <div key={t.id} className="ui-toast" data-kind={t.kind} role="status">
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
