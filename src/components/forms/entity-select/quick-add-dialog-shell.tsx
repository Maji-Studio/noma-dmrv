/**
 * Quick Add Dialog Shell
 * Generic dialog wrapper for inline entity creation.
 * Renders only the <dialog> chrome (header, close, error banner).
 * The embedded form component owns fields + action buttons.
 */
"use client";

import { useId } from "react";
import { useDialog } from "@/hooks/use-dialog";
import { X } from "@phosphor-icons/react";

interface QuickAddDialogShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  error?: string | null;
  /** Dialog max-width class — defaults to "max-w-lg" */
  maxWidth?: string;
  /** Test ID for the dialog element */
  testId?: string;
  children: React.ReactNode;
}

export function QuickAddDialogShell({
  isOpen,
  onClose,
  title,
  error,
  maxWidth = "max-w-lg",
  testId,
  children,
}: QuickAddDialogShellProps) {
  const titleId = useId();
  const dialogRef = useDialog(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className={`p-0 border border-[var(--color-border-primary)] backdrop:bg-black/50 ${maxWidth} w-full m-auto`}
      aria-labelledby={titleId}
      data-testid={testId}
    >
      <div className="flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-24 border-b border-[var(--color-border-primary)]">
          <h2 id={titleId} className="title-heading-3">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-4 rounded-4 hover:bg-[var(--color-background-medium)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>

        {/* Error banner + form content */}
        <div className="p-24 flex flex-col gap-24">
          {error && (
            <div role="alert" className="px-12 py-8 bg-[var(--color-signal-red-light)] text-[var(--color-signal-red)] text-[var(--text-s)] rounded-none">
              {error}
            </div>
          )}
          {children}
        </div>
      </div>
    </dialog>
  );
}
