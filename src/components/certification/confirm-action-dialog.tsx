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
import { ServerError } from "@/components/forms/server-error";
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
  /** Irreversible actions (delete) get red; reversible actions can stay neutral. */
  variant?: "default" | "neutral" | "destructive";
  /** Disables both buttons and shows the spinner on the primary; the label stays. */
  isPending?: boolean;
  /** Renders the inline production EnvBanner above the title. */
  isProduction?: boolean;
  /** Surface a server error below the body. */
  errorMessage?: string;
  /** Blocks the primary action when the body names a blocker. Cancel stays live. */
  confirmDisabled?: boolean;
  /** False holds the dialog open against Escape, the backdrop and the X, e.g. while a request runs. */
  dismissible?: boolean;
}

const TITLE_ID = "confirm-action-title";

export function ConfirmActionDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  variant = "default",
  isPending = false,
  isProduction = false,
  errorMessage,
  confirmDisabled = false,
  dismissible = true,
}: ConfirmActionDialogProps) {
  const isDestructive = variant === "destructive";
  const isNeutral = variant === "neutral";

  return (
    <Modal isOpen={isOpen} onClose={onClose} dismissible={dismissible} ariaLabelledBy={TITLE_ID} width="sm">
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

        <div className="flex flex-wrap justify-start gap-12">
          <Button
            size="large"
            variant={isDestructive || isNeutral ? "default" : "primary"}
            className={
              isDestructive
                ? "bg-[var(--color-signal-red)] text-white border-[var(--color-signal-red)] hover:opacity-90"
                : undefined
            }
            onClick={onConfirm}
            disabled={confirmDisabled}
            busy={isPending}
          >
            {confirmLabel}
          </Button>
          <Button
            size="large"
            variant="default"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
