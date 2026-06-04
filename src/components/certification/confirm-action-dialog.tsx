/**
 * ConfirmActionDialog
 * The one confirmation-gate modal for the certification area — replaces the
 * previously divergent SubmitConfirmDialog / UnlinkConfirmDialog patterns.
 * Composes the shared Modal + Button (`busy`) + the inline EnvBanner so every
 * "are you sure?" gate looks and behaves identically.
 *
 * Note: the in-form production checkbox (`ProductionConfirmation`) is a
 * deliberately separate interaction (an RHF field inside a stepper), not a
 * modal gate — it shares the EnvBanner but is not replaced here.
 */
"use client";

import type { ReactNode } from "react";
import { Button, Modal } from "@/components/ui";
import { ServerError } from "@/components/forms";
import { EnvBanner } from "./env-banner";

interface ConfirmActionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Heading — also the dialog's accessible name. */
  title: string;
  /** Body copy. */
  body: ReactNode;
  /** Primary button label. */
  confirmLabel: string;
  /** Label while the action is in flight. Defaults to `confirmLabel` + "…". */
  busyLabel?: string;
  /** Destructive actions (unlink, delete) get the red primary button. */
  variant?: "default" | "destructive";
  /** Disables both buttons and shows the spinner on the primary. */
  isPending?: boolean;
  /** Renders the inline production EnvBanner above the title. */
  isProduction?: boolean;
  /** Surface a server error below the body. */
  errorMessage?: string;
}

const TITLE_ID = "confirm-action-title";

export function ConfirmActionDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  busyLabel,
  variant = "default",
  isPending = false,
  isProduction = false,
  errorMessage,
}: ConfirmActionDialogProps) {
  const isDestructive = variant === "destructive";

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabelledBy={TITLE_ID} width="sm">
      <div className="flex flex-col gap-20">
        {isProduction && <EnvBanner isProduction variant="inline" />}

        <div className="flex flex-col gap-12">
          <h2 id={TITLE_ID} className="title-heading-3">
            {title}
          </h2>
          <div className="body-medium text-[var(--color-text-secondary)]">
            {body}
          </div>
        </div>

        {errorMessage && <ServerError message={errorMessage} />}

        <div className="flex justify-end gap-12">
          <Button
            size="large"
            variant="default"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            size="large"
            variant={isDestructive ? "default" : "primary"}
            className={
              isDestructive
                ? "bg-[var(--color-signal-red)] text-white border-[var(--color-signal-red)] hover:opacity-90"
                : undefined
            }
            onClick={onConfirm}
            busy={isPending}
          >
            {isPending ? (busyLabel ?? `${confirmLabel}…`) : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
