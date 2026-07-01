/**
 * Toast.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Simple toast notification system.
 * Provides a useToast hook and a ToastContainer component.
 */
import { useState, useCallback, useEffect, createContext, useContext, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'loading';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number; // ms, 0 = persistent
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, type: ToastType, duration?: number) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  addToast: () => '',
  removeToast: () => {},
  clearToasts: () => {},
});

let toastIdCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType, duration = 4000): string => {
    const id = `toast-${++toastIdCounter}`;
    setToasts((prev) => [...prev, { id, message, type, duration }]);
    if (type !== 'loading' && duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, clearToasts }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ─── Toast icon ───────────────────────────────────────────────────────────────

function ToastIcon({ type }: { type: ToastType }) {
  switch (type) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-status-success" />;
    case 'error':
      return <AlertCircle className="h-4 w-4 text-status-error" />;
    case 'loading':
      return <Loader2 className="h-4 w-4 text-ey-yellow animate-spin" />;
  }
}

// ─── Color map ────────────────────────────────────────────────────────────────

const TOAST_BG: Record<ToastType, string> = {
  success: 'border-status-success/30 bg-status-success/10',
  error: 'border-status-error/30 bg-status-error/10',
  loading: 'border-ey-yellow/30 bg-ey-yellow/10',
};

// ─── Container ────────────────────────────────────────────────────────────────

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-xs font-medium shadow-lg backdrop-blur-sm animate-in slide-in-from-right ${TOAST_BG[toast.type]}`}
        >
          <ToastIcon type={toast.type} />
          <span className="flex-1 text-text-primary">{toast.message}</span>
          <button
            onClick={() => onDismiss(toast.id)}
            className="p-0.5 rounded hover:bg-dark-surface text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export default ToastProvider;