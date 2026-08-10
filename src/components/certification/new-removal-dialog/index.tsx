/**
 * NewRemovalDialog — the modal wizard that replaces the old per-batch
 * "Group into…" dropdown (design doc §4). Two steps over the dimmed Removals
 * overview:
 *
 *   1. Select batches    — pick from the facility's ungrouped, ready credit
 *      batches (a batch is "ready" only when its own data is complete, so
 *      everything that could block — carbon, production, transport, the batch's
 *      entity certifier fields — is resolved here, where each card links out to
 *      the fix). "Continue" is the DEFERRED-CREATE moment: it calls
 *      `createRemovalWithBatchesAction` (server re-validates health) and only
 *      then does the removal exist.
 *   2. Confirm & submit  — the registry requirements (facility mapping, template,
 *      transport uniformity) shown inline as a confirmation, then the same submit
 *      + production gate as the Review flow. No separate "resolve later" hop:
 *      closing the dialog leaves the created removal as a draft, recoverable from
 *      the Removals list (`?resume=<id>` / the detail sheet).
 *
 * State lives in the inner body, which is a child of `Modal` — `Modal` unmounts
 * its children when closed, so each open starts clean. Pass `resumeRemovalId` to
 * reopen an existing draft straight at the confirm-&-submit step.
 */
"use client";

import { useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  useCreateRemovalWithBatches,
  useRemovalCertifyContext,
  useSelectableBatches,
  useSubmitRemoval,
} from "@/hooks/use-certification";
import { deriveRemovalReadiness } from "@/lib/certification/readiness";
import { toRemovalReadinessFacts } from "@/lib/certification/readiness-facts";
import { isSubmissionStreamStalledError } from "@/lib/certification/submission-progress-client";
import { StepFlow, type StepFlowStep } from "@/components/ui/step-flow";
import { SelectBatchesStep } from "./select-batches-step";
import { SubmitStep } from "./submit-step";
import { shouldBlockRemovalResume } from "./resume-state";

const STEPS: StepFlowStep[] = [
  { key: "select", label: "Select batches" },
  { key: "submit", label: "Confirm & submit" },
];
const STEP_KEYS = ["select", "submit"] as const;
type StepKey = (typeof STEP_KEYS)[number];

interface NewRemovalDialogProps {
  facilityId: string;
  facilityName: string;
  isOpen: boolean;
  onClose: () => void;
  /** Reopen an existing draft removal straight at the confirm-&-submit step. */
  resumeRemovalId?: string | null;
}

export function NewRemovalDialog({
  facilityId,
  facilityName,
  isOpen,
  onClose,
  resumeRemovalId = null,
}: NewRemovalDialogProps) {
  // Own the mutation above WizardBody so a live-lock query refresh cannot
  // unmount the observer that controls dialog dismissal.
  const submitMutation = useSubmitRemoval();
  const submissionPending = submitMutation.isPending;
  const closeIfIdle = () => {
    if (!submissionPending) onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeIfIdle}
      onOpen={() => {
        if (!submitMutation.isPending) submitMutation.reset();
      }}
      width="xl"
      contentClassName="p-20"
      ariaLabelledBy="new-removal-title"
      // Multi-step wizard: a stray backdrop click must not discard a
      // half-built removal. Close button + ESC still dismiss.
      dismissOnClickOutside={false}
      dismissible={!submissionPending}
    >
      <WizardBody
        facilityId={facilityId}
        facilityName={facilityName}
        onClose={closeIfIdle}
        resumeRemovalId={resumeRemovalId}
        submitMutation={submitMutation}
      />
    </Modal>
  );
}

function WizardBody({
  facilityId,
  facilityName,
  onClose,
  resumeRemovalId,
  submitMutation,
}: {
  facilityId: string;
  facilityName: string;
  onClose: () => void;
  resumeRemovalId: string | null;
  submitMutation: ReturnType<typeof useSubmitRemoval>;
}) {
  const [step, setStep] = useState<StepKey>(
    resumeRemovalId ? "submit" : "select",
  );
  const [removalId, setRemovalId] = useState<string | null>(resumeRemovalId);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const selectable = useSelectableBatches(facilityId, step === "select");
  const ctxQuery = useRemovalCertifyContext(
    facilityId,
    removalId ?? "",
    !!removalId,
  );
  const createMutation = useCreateRemovalWithBatches();
  const toast = useToast();

  const facilitySetupComplete = selectable.data?.facilitySetupComplete ?? false;

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirmSelection = () => {
    createMutation.mutate(
      { facilityId, creditBatchIds: [...selectedIds] },
      {
        onSuccess: ({ removalId: newId }) => {
          setRemovalId(newId);
          setStep("submit");
        },
        onError: (err) =>
          toast.error(
            err instanceof Error
              ? err.message
              : "The Removal was not created. Review the submission and try again.",
          ),
      },
    );
  };

  const currentIndex = STEP_KEYS.indexOf(step);

  // A live submission lock is the only resume blocker. Submitted Removals may
  // re-enter this step: the backend returns the existing version when nothing
  // changed and creates a superseding version when reviewed evidence or mapping
  // revisions changed.
  const resumeReadiness =
    resumeRemovalId && ctxQuery.data
      ? deriveRemovalReadiness(toRemovalReadinessFacts(ctxQuery.data))
      : null;
  if (
    resumeReadiness &&
    shouldBlockRemovalResume(resumeReadiness.state, submitMutation.isPending)
  ) {
    return (
      <div className="flex flex-col gap-24">
        <h2 id="new-removal-title" className="title-heading-2">
          Removal
        </h2>
        <p className="body-small text-[var(--color-text-secondary)]">
          {isSubmissionStreamStalledError(submitMutation.error)
            ? "The progress connection stopped responding. The registry submission may still be running. Close this dialog and refresh the page to reconcile its status."
            : "A submission for this Removal is in progress. Wait for it to finish before making changes."}
        </p>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-16">
      <div className="flex items-center justify-between gap-12">
        <h2 id="new-removal-title" className="title-heading-2">
          New Removal
        </h2>
      </div>

      <StepFlow
        steps={STEPS}
        current={currentIndex}
        footer={null}
        className="gap-16"
      >
        {step === "select" && (
          <SelectBatchesStep
            batches={selectable.data?.batches ?? []}
            facilitySetupGaps={selectable.data?.facilitySetupGaps ?? []}
            facilityId={facilityId}
            selectedIds={selectedIds}
            onToggle={toggle}
            isLoading={selectable.isLoading}
            isError={selectable.isError}
          />
        )}
        {step === "submit" &&
          removalId &&
          (ctxQuery.isLoading ? (
            <p className="body-small text-[var(--color-text-tertiary)]">
              Loading…
            </p>
          ) : ctxQuery.error || !ctxQuery.data ? (
            <p className="body-small text-[var(--clr-red)]" role="alert">
              This Removal could not be loaded. Refresh the page.
            </p>
          ) : (
            <SubmitStep
              removalId={removalId}
              ctx={ctxQuery.data}
              facilityId={facilityId}
              facilityName={facilityName}
              onDone={onClose}
              submitMutation={submitMutation}
            />
          ))}
      </StepFlow>

      <Footer
        step={step}
        selectable={{
          ready:
            selectable.data?.batches.filter(
              (b) => b.health.state === "ready",
            ).length ?? 0,
          total: selectable.data?.batches.length ?? 0,
          selected: selectedIds.size,
        }}
        confirmBusy={createMutation.isPending}
        onCancel={onClose}
        onConfirm={confirmSelection}
        canConfirm={
          selectedIds.size > 0 && facilitySetupComplete && !selectable.isLoading
        }
      />
    </div>
  );
}

export function Footer({
  step,
  selectable,
  confirmBusy,
  onCancel,
  onConfirm,
  canConfirm,
}: {
  step: StepKey;
  selectable: { ready: number; total: number; selected: number };
  confirmBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  canConfirm: boolean;
}) {
  // The confirm-&-submit step owns its own action row (and success "Done").
  if (step === "submit") return null;

  return (
    <div className="flex items-center justify-between gap-12 border-t border-[var(--color-border-secondary)] pt-16">
      <span className="body-caption text-[var(--color-text-tertiary)]">
        {selectable.ready} of {selectable.total} batches with complete data ·{" "}
        {selectable.selected} selected
      </span>
      <div className="flex items-center gap-12">
        <Button variant="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={onConfirm}
          disabled={!canConfirm}
          busy={confirmBusy}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
