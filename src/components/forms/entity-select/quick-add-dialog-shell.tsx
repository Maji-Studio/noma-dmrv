/**
 * Quick Add Dialog Shell
 * Generic dialog wrapper for nested entity creation and editing. Composes the shared
 * `Modal` primitive (chrome, centering, focus, backdrop, ESC) and adds an
 * inset header around the embedded form.
 */
"use client";

import { useId } from "react";
import { Modal, type ModalWidth } from "@/components/ui";

interface QuickAddDialogShellProps {
  isOpen: boolean;
  onClose: () => void;
  /** Reset dialog-owned state when a closed dialog opens. */
  onOpen?: () => void;
  title: string;
  /** Width token forwarded to Modal. Defaults to "md" (matches the previous max-w-lg ≈ 512px envelope). */
  width?: ModalWidth;
  /** Test ID for the dialog element */
  testId?: string;
  /** Forwarded modal dismissal controls; existing callers retain Modal defaults. */
  dismissOnClickOutside?: boolean;
  dismissible?: boolean;
  children: React.ReactNode;
}

export function QuickAddDialogShell({
  isOpen,
  onClose,
  onOpen,
  title,
  width = "md",
  testId,
  dismissOnClickOutside,
  dismissible,
  children,
}: QuickAddDialogShellProps) {
  const titleId = useId();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onOpen={onOpen}
      ariaLabelledBy={titleId}
      width={width}
      dismissOnClickOutside={dismissOnClickOutside}
      dismissible={dismissible}
      // Inset header has its own padding + bottom border that must reach the
      // dialog edges, so we opt out of Modal's default content padding and
      // own all spacing here.
      contentClassName=""
    >
      <div className="flex flex-col" data-testid={testId}>
        {/* Header */}
        <div className="flex items-center p-24 border-b border-[var(--color-border-primary)]">
          <h2 id={titleId} className="title-heading-3">
            {title}
          </h2>
        </div>

        {/* Form content */}
        <div className="p-24 flex flex-col gap-24">
          {children}
        </div>
      </div>
    </Modal>
  );
}
