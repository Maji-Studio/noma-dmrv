/**
 * SubmitConfirmDialog
 * Two-line confirmation gate for the irreversible "submit removal to
 * production Isometric" action. Used by the slim credit-batch panel and the
 * full certification surface.
 */
"use client";

import { Button } from "@/components/ui";
import { useDialog } from "@/hooks/use-dialog";
import { EnvBanner } from "./env-banner";

interface SubmitConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
  /** What gets submitted, e.g. "Removal" or "GHG statement". */
  artifactLabel?: string;
}

export function SubmitConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  isPending,
  artifactLabel = "Removal",
}: SubmitConfirmDialogProps) {
  const dialogRef = useDialog(isOpen, onClose);
  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className="p-0 border border-[var(--color-border-primary)] backdrop:bg-black/50"
      aria-labelledby="submit-confirm-title"
    >
      <div className="flex flex-col gap-20 w-[440px] max-w-[calc(100vw-32px)] p-24">
        <EnvBanner isProduction variant="inline" />

        <div className="flex flex-col gap-12">
          <h2 id="submit-confirm-title" className="title-heading-3">
            Submit {artifactLabel.toLowerCase()} to production?
          </h2>
          <p className="body-medium text-[var(--color-text-secondary)]">
            <strong className="font-semibold text-[var(--color-text-primary)]">
              This creates a verifier-visible record on the production Isometric
              registry.
            </strong>{" "}
            The {artifactLabel.toLowerCase()} can be resubmitted, but cannot be
            removed once it&apos;s been seen by the verifier.
          </p>
        </div>

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
            variant="primary"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "Submitting…" : `Submit ${artifactLabel.toLowerCase()}`}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
