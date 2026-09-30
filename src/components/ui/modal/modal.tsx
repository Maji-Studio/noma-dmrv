/**
 * Modal — shared chrome for every centered dialog in the app.
 *
 * Built on Base UI `Dialog` (the same primitive as `SlideOverPanel`) so the
 * whole app speaks one dialog library. New centered dialogs should compose
 * this component instead of rolling their own markup — it keeps the visual +
 * a11y contract consistent and gives every instance the same affordances:
 *
 * - a built-in close button in the top-right corner (no per-instance X)
 * - dismiss on ESC and on outside (backdrop) click when dismissible
 * - focus trap + scroll lock + focus restore (handled by Base UI)
 *
 * Outside-click dismissal can be turned off per instance via
 * `dismissOnClickOutside={false}` — use it for multi-step workflows where an
 * accidental backdrop click would discard in-progress work. Set
 * `dismissible={false}` only while an irreversible request is active.
 */
"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";
import { SideSheetActionsContext } from "@/components/ui/entity-side-sheet/side-sheet-context";

/**
 * Named width tokens map to the dialog widths already used in the app.
 * Mobile-first: every token is full-width below `sm` (the
 * `max-w-[calc(100vw-32px)]` backstop on the popup keeps a 16px gutter), then
 * locks to its fixed desktop width at `sm`+ so centered dialogs never overflow
 * a phone screen.
 */
const WIDTH_CLASSES = {
  sm: "w-full sm:w-[400px]", // confirmation prompts
  md: "w-full sm:w-[560px]", // default — forms, wizards
  lg: "w-full sm:w-[720px]", // dense forms / multi-column layouts
  xl: "w-full sm:w-[880px]", // rich content (previews, comparisons)
} as const;

export type ModalWidth = keyof typeof WIDTH_CLASSES;

export interface ModalProps {
  /** Controls visibility. Setting false triggers the close animation. */
  isOpen: boolean;
  /** Called on ESC, outside click, and the built-in close button. */
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
  /**
   * Whether clicking the backdrop dismisses the modal. Defaults to `true`.
   * Set `false` for multi-step workflows so a stray click can't discard
   * in-progress work — the close button and ESC still work.
   */
  dismissOnClickOutside?: boolean;
  /**
   * Whether the built-in close button, Escape, and backdrop may close the
   * dialog. Set false only while an irreversible request is in progress.
   */
  dismissible?: boolean;
  children: ReactNode;
}

/**
 * Renders a centered modal dialog with the project's shared chrome.
 *
 * Children unmount while closed (Base UI default), so each open starts with
 * fresh form state — matching the previous `if (!isOpen) return null` pattern.
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
  dismissOnClickOutside = true,
  dismissible = true,
  children,
}: ModalProps) {
  // A modal dialog with no accessible name is announced as just "dialog" by
  // screen readers. The props exist to prevent that, but nothing enforced
  // them — flag the omission at dev time so it's caught before review rather
  // than shipping silently. Stripped from production bundles by the guard.
  if (process.env.NODE_ENV !== "production" && !ariaLabelledBy && !ariaLabel) {
    console.warn(
      "[Modal] Rendered without an accessible name. Pass `ariaLabelledBy` " +
        "(id of the heading) or `ariaLabel` so screen readers can announce it."
    );
  }

  // Fire `onOpen` on the closed→open transition. Base UI's `onOpenChange`
  // only fires for user-driven changes (not the controlled `open` prop), and
  // consumers depend on this to reset form state that lives in a parent that
  // never unmounts. A ref tracks the previous value so it fires once per open.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) onOpen?.();
    wasOpen.current = isOpen;
    // onOpen intentionally excluded — only react to isOpen changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const widthClass = WIDTH_CLASSES[width];

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && dismissible) onClose();
      }}
      disablePointerDismissal={!dismissOnClickOutside || !dismissible}
      modal
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          data-overlay-layer="dialog-backdrop"
          forceRender
          className={cn(
            "fixed inset-0 bg-[var(--color-black-50)]",
            "transition-opacity duration-200",
            "data-[open]:opacity-100",
            "data-[starting-style]:opacity-0",
            "data-[ending-style]:opacity-0"
          )}
        />
        <Dialog.Popup
          data-overlay-layer="dialog"
          aria-labelledby={ariaLabelledBy}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          className={cn(
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "bg-[var(--color-background-white)] border border-[var(--color-border-primary)]",
            "max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] overflow-auto",
            "outline-none",
            "transition-opacity duration-200",
            "data-[open]:opacity-100",
            "data-[starting-style]:opacity-0",
            "data-[ending-style]:opacity-0",
            widthClass,
            className
          )}
        >
          <Dialog.Close
            aria-label="Close"
            disabled={!dismissible}
            className={cn(
              "absolute top-16 right-16 z-10",
              "flex items-center justify-center",
              "w-32 h-32 shrink-0",
              "text-[var(--color-text-tertiary)]",
              "hover:text-[var(--color-text-primary)]",
              "hover:bg-[var(--color-background-medium)]",
              "transition-colors duration-200",
              "focus-visible:outline-none focus-visible:ring-2",
              "focus-visible:ring-[var(--color-border-primary)]",
              "cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            )}
          >
            <CloseIcon />
          </Dialog.Close>
          {/* Context barrier: a dialog opened from inside a side sheet is its
              own interaction scope, so a FormActions Cancel in here must not
              navigate the sheet underneath. */}
          <SideSheetActionsContext.Provider value={null}>
            <div className={contentClassName}>{children}</div>
          </SideSheetActionsContext.Provider>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
