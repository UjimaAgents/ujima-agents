"use client";

import { createContext, useCallback, useContext, useState, useRef, type ReactNode } from "react";
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from "lucide-react";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => string;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (toast: Omit<Toast, "id">): string => {
      const id = "toast-" + String(++nextId);
      const entry: Toast = { ...toast, id };
      setToasts((prev) => [...prev, entry]);
      const duration = toast.duration ?? 4000;
      if (duration > 0) {
        const timer = setTimeout(() => removeToast(id), duration);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Container                                                          */
/* ------------------------------------------------------------------ */

function ToastContainer() {
  const { toasts, removeToast } = useToast();
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Toast Item                                                        */
/* ------------------------------------------------------------------ */

const variantStyles = {
  success: {
    bg: "bg-emerald-50 dark:bg-emerald-950",
    border: "border-emerald-200 dark:border-emerald-800",
    icon: CheckCircle,
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
  error: {
    bg: "bg-red-50 dark:bg-red-950",
    border: "border-red-200 dark:border-red-800",
    icon: AlertCircle,
    iconColor: "text-red-600 dark:text-red-400",
  },
  warning: {
    bg: "bg-amber-50 dark:bg-amber-950",
    border: "border-amber-200 dark:border-amber-800",
    icon: AlertTriangle,
    iconColor: "text-amber-600 dark:text-amber-400",
  },
  info: {
    bg: "bg-blue-50 dark:bg-blue-950",
    border: "border-blue-200 dark:border-blue-800",
    icon: Info,
    iconColor: "text-blue-600 dark:text-blue-400",
  },
} as const;

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const style = variantStyles[toast.variant];
  const Icon = style.icon;

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border ${style.bg} ${style.border} px-4 py-3 shadow-lg animate-in slide-in-from-right-2 duration-300`}
      role="alert"
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconColor}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {toast.title}
        </p>
        {toast.message && (
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            {toast.message}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-200/50 hover:text-zinc-600 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-300"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* We wrap the container inside the provider so users only import ToastProvider */
export function ToastProviderWithContainer({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      {children}
      <ToastContainer />
    </ToastProvider>
  );
}
