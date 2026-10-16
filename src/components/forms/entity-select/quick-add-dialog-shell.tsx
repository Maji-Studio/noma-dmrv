/**
 * Quick Add Dialog Shell
 * Generic dialog wrapper for nested entity creation and editing. Composes the shared
 * `FormDialog` primitive (chrome, centering, focus, backdrop, ESC) and adds an
 * inset header around the embedded form.
 */
"use client";

import { useId, type SyntheticEvent } from "react";
import type { ModalWidth } from "@/components/ui/modal";
import { FormDialog } from "@/components/ui/form-dialog";
import { RequirednessLegendProvider } from "@/components/forms/requiredness-legend-context";
import { RequirednessLegendHint } from "@/components/forms/requiredness-legend";

/**
 * A dialog renders through a portal but still sits inside the entry form in
 * the React tree, where its own form's submit would bubble on to the entry
 * form's `onSubmit` and save it. Wrap the dialog's form to stop it there.
 */
export const stopSubmitBubbling = (event: SyntheticEvent) => event.stopPropagation();

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
    <FormDialog
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
      <RequirednessLegendProvider>
      <div className="flex flex-col" data-testid={testId}>
        {/* Header. The right padding keeps the title clear of Modal's close
            button (top-16 right-16, 32px wide). */}
        <div className="flex items-start gap-6 p-24 pr-48 border-b border-[var(--color-border-primary)]">
          <h2 id={titleId} className="title-heading-3 min-w-0">
            {title}
          </h2>
          <RequirednessLegendHint />
        </div>

        {/* Form content */}
        <div className="p-24 flex flex-col gap-24" onSubmit={stopSubmitBubbling}>
          {children}
        </div>
      </div>
      </RequirednessLegendProvider>
    </FormDialog>
  );
}
