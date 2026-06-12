/**
 * SubmitConfirmDialog
 * Production submit gate — now a thin preset of the shared ConfirmActionDialog
 * so it stays visually + behaviourally identical to every other gate. Used by
 * the slim credit-batch panel and the certification surfaces.
 */
"use client";

import { ConfirmActionDialog } from "./confirm-action-dialog";

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
    <ConfirmActionDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      isPending={isPending}
      isProduction={isProduction}
      title={`Submit ${label} to production?`}
      confirmLabel={`Submit ${label}`}
      busyLabel="Submitting…"
      body={
        <>
          <strong className="body-bold text-[var(--color-text-primary)]">
            This creates a verifier-visible record on the production Isometric
            registry.
          </strong>{" "}
          The {label} can be resubmitted, but cannot be removed once it&apos;s
          been seen by the verifier.
        </>
      }
    />
  );
}
