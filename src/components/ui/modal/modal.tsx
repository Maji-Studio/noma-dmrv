/**
 * Modal — shared chrome for every native <dialog> in the app.
 *
 * Wraps the native <dialog> element + `useDialog` hook so all modals
 * inherit the same border, backdrop, centering, focus management, and
 * width tokens. New dialogs should compose this component instead of
 * rolling their own <dialog> markup — it keeps the visual + a11y
 * contract consistent and removes the per-instance opportunity to
 * forget the centering fix.
 *
 * Centering is restored globally in `globals.css` (Tailwind v4 preflight
 * resets `margin: 0` on every element, which overrides the UA stylesheet's
 * `dialog[open] { margin: auto }`). This component does not re-apply
 * `m-auto` per instance — the global rule is the single source of truth.
 */
"use client";

import { type ReactNode } from "react";
import { useDialog } from "@/hooks/use-dialog";

/** Named width tokens map to the dialog widths already used in the app. */
const WIDTH_CLASSES = {
  sm: "w-[400px]", // confirmation prompts
  md: "w-[560px]", // default — forms, wizards
  lg: "w-[720px]", // dense forms / multi-column layouts
  xl: "w-[880px]", // rich content (previews, comparisons)
} as const;

export type ModalWidth = keyof typeof WIDTH_CLASSES;

export interface ModalProps {
  /** Controls visibility. Setting false triggers the close animation. */
  isOpen: boolean;
  /** Called on ESC, backdrop click (via cancel event), and Cancel buttons. */
  onClose: () => void;
  /** Optional callback fired when the dialog opens — use to reset form state. */
  onOpen?: () => void;
  /** ID of the heading element inside the modal (accessible name). */
  ariaLabelledBy?: string;
  /** Accessible label fallback when no heading element is present. */
  ariaLabel?: string;
  /** ID of the descriptive element inside the modal (e.g., warning copy). */
  ariaDescribedBy?: string;
  /** Width token. Defaults to "md" (560px) — matches most existing dialogs. */
  width?: ModalWidth;
  /** Custom dialog classes (rare — prefer width prop + content classes). */
  className?: string;
  /**
   * Class applied to the inner content wrapper. Defaults to `"p-24"`.
   * Pass an empty string when children render an edge-to-edge header
   * (e.g., a header with a bottom border that must reach the dialog
   * edges) and own all their padding.
   */
  contentClassName?: string;
  children: ReactNode;
}

/**
 * Renders a native modal <dialog> with the project's shared chrome.
 *
 * Returns `null` while closed so the dialog isn't kept in the DOM with stale
 * form state — matches the existing `if (!isOpen) return null` pattern.
 */
export function Modal({
  isOpen,
  onClose,
  onOpen,
  ariaLabelledBy,
  ariaLabel,
  ariaDescribedBy,
  width = "md",
  className,
  contentClassName = "p-24",
  children,
}: ModalProps) {
  const dialogRef = useDialog(isOpen, onClose, onOpen);

  if (!isOpen) return null;

  const widthClass = WIDTH_CLASSES[width];
  const baseClass =
    "p-0 border border-[var(--color-border-primary)] backdrop:bg-black/50 max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] overflow-auto";

  return (
    <dialog
      ref={dialogRef}
      className={`${baseClass} ${widthClass} ${className ?? ""}`.trim()}
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
    >
      <div className={contentClassName}>{children}</div>
    </dialog>
  );
}
