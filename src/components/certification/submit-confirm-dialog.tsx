/**
 * SubmitConfirmDialog
 * Two-line confirmation gate for the irreversible "submit removal to
 * production Isometric" action. Used by the slim credit-batch panel and the
 * full certification surface.
 */
"use client";

import { Button, Modal } from "@/components/ui";
import { EnvBanner } from "./env-banner";

export type SubmitArtifact = "removal" | "ghgStatement";

const ARTIFACT_LABEL: Record<SubmitArtifact, string> = {
  removal: "removal",
  ghgStatement: "GHG statement",
};

interface SubmitConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
  artifact?: SubmitArtifact;
  isProduction?: boolean;
}

export function SubmitConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  isPending,
  artifact = "removal",
  isProduction = false,
}: SubmitConfirmDialogProps) {
  const label = ARTIFACT_LABEL[artifact];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="submit-confirm-title"
      width="sm"
    >
      <div className="flex flex-col gap-20">
        <EnvBanner isProduction={isProduction} variant="inline" />

        <div className="flex flex-col gap-12">
          <h2 id="submit-confirm-title" className="title-heading-3">
            Submit {label} to production?
          </h2>
          <p className="body-medium text-[var(--color-text-secondary)]">
            <strong className="font-semibold text-[var(--color-text-primary)]">
              This creates a verifier-visible record on the production Isometric
              registry.
            </strong>{" "}
            The {label} can be resubmitted, but cannot be
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
            {isPending ? "Submitting…" : `Submit ${label}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
