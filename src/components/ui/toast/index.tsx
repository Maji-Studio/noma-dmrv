/**
 * Toast Notification System
 *
 * A lightweight toast notification system using React context.
 * Supports success, error, warning, and info variants with auto-dismiss.
 */
"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { X, CheckCircle, XCircle, Warning, Info } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ============================================
// Types
// ============================================

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, variant?: ToastVariant, duration?: number) => void;
  removeToast: (id: string) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

// ============================================
// Context
// ============================================

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

// ============================================
// Provider
// ============================================

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, variant: ToastVariant = "info", duration: number = 4000) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const toast: Toast = { id, message, variant, duration };

      setToasts((prev) => [...prev, toast]);

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }

      return id;
    },
    [removeToast]
  );

  const success = useCallback(
    (message: string, duration?: number) => addToast(message, "success", duration),
    [addToast]
  );

  const error = useCallback(
    (message: string, duration?: number) => addToast(message, "error", duration ?? 6000),
    [addToast]
  );

  const warning = useCallback(
    (message: string, duration?: number) => addToast(message, "warning", duration),
    [addToast]
  );

  const info = useCallback(
    (message: string, duration?: number) => addToast(message, "info", duration),
    [addToast]
  );

  return (
    <ToastContext.Provider
      value={{ toasts, addToast, removeToast, success, error, warning, info }}
    >
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}

// ============================================
// Toast Container
// ============================================

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-24 right-24 z-50 flex flex-col gap-8 sm:max-w-[380px]"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

// ============================================
// Toast Item
// ============================================

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

const variantStyles: Record<
  ToastVariant,
  { accent: string; icon: string }
> = {
  success: {
    accent: "bg-[var(--clr-dark-purple)]",
    icon: "text-[var(--clr-dark-purple)]",
  },
  error: {
    accent: "bg-[var(--clr-red)]",
    icon: "text-[var(--clr-red)]",
  },
  warning: {
    accent: "bg-[var(--color-signal-orange)]",
    icon: "text-[var(--color-signal-orange)]",
  },
  info: {
    accent: "bg-[var(--clr-dark-purple-60)]",
    icon: "text-[var(--clr-dark-purple)]",
  },
};

const variantIcons: Record<ToastVariant, typeof CheckCircle> = {
  success: CheckCircle,
  error: XCircle,
  warning: Warning,
  info: Info,
};

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const Icon = variantIcons[toast.variant];
  const styles = variantStyles[toast.variant];
  const isAssertive = toast.variant === "error" || toast.variant === "warning";

  return (
    <div
      className="pointer-events-auto relative overflow-hidden border border-[var(--color-border-primary)] bg-[var(--color-background-white)] shadow-[0_4px_16px_var(--color-black-10)] animate-slide-in-right"
      role={isAssertive ? "alert" : "status"}
      aria-live={isAssertive ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <div className={cn("absolute inset-y-0 left-0 w-3", styles.accent)} aria-hidden="true" />
      <div className="flex items-center gap-12 pl-16 pr-8 py-12">
        <Icon size={20} weight="fill" className={cn("shrink-0", styles.icon)} aria-hidden="true" />
        <p className="body-small min-w-0 flex-1 text-[var(--color-text-primary)]">
          {toast.message}
        </p>
        <Button
          variant="noOutline"
          size="icon"
          onClick={() => onDismiss(toast.id)}
          className="h-28 w-28 shrink-0 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-light)] hover:text-[var(--color-text-primary)]"
          aria-label="Dismiss notification"
        >
          <X size={14} weight="bold" />
        </Button>
      </div>
    </div>
  );
}

// ============================================
// Export
// ============================================

export { ToastContainer, ToastItem };
