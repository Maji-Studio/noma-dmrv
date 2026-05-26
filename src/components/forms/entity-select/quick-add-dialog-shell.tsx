/**
 * Quick Add Dialog Shell
 * Generic dialog wrapper for inline entity creation. Composes the shared
 * `Modal` primitive (chrome, centering, focus, backdrop, ESC) and adds an
 * inset header + error banner that the embedded form sits below.
 */
"use client";

import { useId } from "react";
import { X } from "@phosphor-icons/react";
import { Modal, type ModalWidth } from "@/components/ui";

interface QuickAddDialogShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  error?: string | null;
  /** Width token forwarded to Modal. Defaults to "md" (matches the previous max-w-lg ≈ 512px envelope). */
  width?: ModalWidth;
  /** Test ID for the dialog element */
  testId?: string;
  children: React.ReactNode;
}

export function QuickAddDialogShell({
  isOpen,
  onClose,
  title,
  error,
  width = "md",
  testId,
  children,
}: QuickAddDialogShellProps) {
  const titleId = useId();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy={titleId}
      width={width}
      // Inset header has its own padding + bottom border that must reach the
      // dialog edges, so we opt out of Modal's default content padding and
      // own all spacing here.
      contentClassName=""
    >
      <div className="flex flex-col" data-testid={testId}>
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
    </Modal>
  );
}
