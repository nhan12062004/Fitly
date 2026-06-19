import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

type ToastTone = 'success' | 'error' | 'warning' | 'info';

type Toast = {
  id: string;
  tone: ToastTone;
  message: string;
  title?: string;
  duration: number;
};

type ToastInput = string | {
  message: string;
  title?: string;
  duration?: number;
};

type ToastContextValue = {
  showToast: (toast: ToastInput & { tone?: ToastTone }) => string;
  success: (toast: ToastInput) => string;
  error: (toast: ToastInput) => string;
  warning: (toast: ToastInput) => string;
  info: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const toneConfig = {
  success: {
    Icon: CheckCircle2,
    className: 'border-accent/35 bg-bg-secondary text-text-primary shadow-[0_22px_54px_rgba(0,0,0,0.35)]',
    iconClassName: 'text-accent',
  },
  error: {
    Icon: AlertCircle,
    className: 'border-danger/35 bg-bg-secondary text-text-primary shadow-[0_22px_54px_rgba(0,0,0,0.35)]',
    iconClassName: 'text-danger',
  },
  warning: {
    Icon: TriangleAlert,
    className: 'border-warning/35 bg-bg-secondary text-text-primary shadow-[0_22px_54px_rgba(0,0,0,0.35)]',
    iconClassName: 'text-warning',
  },
  info: {
    Icon: Info,
    className: 'border-info/35 bg-bg-secondary text-text-primary shadow-[0_22px_54px_rgba(0,0,0,0.35)]',
    iconClassName: 'text-info',
  },
} satisfies Record<ToastTone, { Icon: typeof Info; className: string; iconClassName: string }>;

const normalizeToastInput = (toast: ToastInput & { tone?: ToastTone }): Omit<Toast, 'id'> => {
  if (typeof toast === 'string') {
    return {
      tone: 'info',
      message: toast,
      duration: 3200,
    };
  }

  return {
    tone: toast.tone || 'info',
    message: toast.message,
    title: toast.title,
    duration: toast.duration ?? 3200,
  };
};

const createToastId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Record<string, number>>({});

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current[id];
    if (timer) {
      window.clearTimeout(timer);
      delete timersRef.current[id];
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((input: ToastInput & { tone?: ToastTone }) => {
    const toast = {
      ...normalizeToastInput(input),
      id: createToastId(),
    };

    setToasts((current) => [...current.slice(-3), toast]);

    if (toast.duration > 0) {
      timersRef.current[toast.id] = window.setTimeout(() => dismiss(toast.id), toast.duration);
    }

    return toast.id;
  }, [dismiss]);

  const value = useMemo<ToastContextValue>(() => ({
    showToast,
    success: (toast) => showToast(typeof toast === 'string' ? { message: toast, tone: 'success' } : { ...toast, tone: 'success' }),
    error: (toast) => showToast(typeof toast === 'string' ? { message: toast, tone: 'error' } : { ...toast, tone: 'error' }),
    warning: (toast) => showToast(typeof toast === 'string' ? { message: toast, tone: 'warning' } : { ...toast, tone: 'warning' }),
    info: (toast) => showToast(typeof toast === 'string' ? { message: toast, tone: 'info' } : { ...toast, tone: 'info' }),
    dismiss,
  }), [dismiss, showToast]);

  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach((timer) => window.clearTimeout(timer));
      timersRef.current = {};
    };
  }, []);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[500] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 sm:right-5 sm:top-5">
        {toasts.map((toast) => {
          const config = toneConfig[toast.tone];
          const Icon = config.Icon;
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm backdrop-blur-xl transition-all duration-200 ${config.className}`}
              role="status"
              aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${config.iconClassName}`} />
              <div className="min-w-0 flex-1">
                {toast.title ? <p className="font-black text-text-primary">{toast.title}</p> : null}
                <p className={`${toast.title ? 'mt-0.5 text-text-secondary' : 'font-semibold text-text-primary'} leading-5`}>
                  {toast.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                aria-label="Đóng thông báo"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return context;
}
