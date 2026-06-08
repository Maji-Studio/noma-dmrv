/**
 * NewRemovalDialog — the modal wizard that replaces the old per-batch
 * "Group into…" dropdown (design doc §4). Three steps over the dimmed Removals
 * overview:
 *
 *   1. Select batches  — pick from the facility's ungrouped, healthy credit
 *      batches. "Confirm" is the DEFERRED-CREATE moment: it calls
 *      `createRemovalWithBatchesAction` (server re-validates health) and only
 *      then does the removal exist.
 *   2. Requirements    — facility/registry-level checks ("Resolve later" leaves
 *      the draft removal to resume; "Submit →" advances when all are met).
 *   3. Submit          — the same submit + production gate as the Review flow.
 *
 * State lives in the inner body, which is a child of `Modal` — `Modal` unmounts
 * its children when closed, so each open starts clean. Pass `resumeRemovalId` to
 * reopen an existing draft straight at the requirements step.
 */
"use client";

import { useState } from "react";
import { Button, Modal } from "@/components/ui";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import {
  useCreateRemovalWithBatches,
  useRemovalCertifyContext,
  useSelectableBatches,
} from "@/hooks/use-certification";
import {
  buildRemovalRequirementsChecklist,
  deriveRemovalReadiness,
} from "@/lib/certification/readiness";
import { toRemovalReadinessFacts } from "@/lib/certification/readiness-facts";
import { StepFlow, type StepFlowStep } from "@/components/ui/step-flow";
import { SelectBatchesStep } from "./select-batches-step";
import { RequirementsStep } from "./requirements-step";
import { SubmitStep } from "./submit-step";

const STEPS: StepFlowStep[] = [
  { key: "select", label: "Select batches" },
  { key: "requirements", label: "Requirements" },
  { key: "submit", label: "Submit" },
];
const STEP_KEYS = ["select", "requirements", "submit"] as const;
type StepKey = (typeof STEP_KEYS)[number];

interface NewRemovalDialogProps {
  facilityId: string;
  isOpen: boolean;
  onClose: () => void;
  /** Reopen an existing draft removal straight at the requirements step. */
  resumeRemovalId?: string | null;
}

export function NewRemovalDialog({
  facilityId,
  isOpen,
  onClose,
  resumeRemovalId = null,
}: NewRemovalDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      width="lg"
      ariaLabelledBy="new-removal-title"
    >
      <WizardBody
        facilityId={facilityId}
        onClose={onClose}
        resumeRemovalId={resumeRemovalId}
      />
    </Modal>
  );
}

function WizardBody({
  facilityId,
  onClose,
  resumeRemovalId,
}: {
  facilityId: string;
  onClose: () => void;
  resumeRemovalId: string | null;
}) {
  const [step, setStep] = useState<StepKey>(
    resumeRemovalId ? "requirements" : "select",
  );
  const [removalId, setRemovalId] = useState<string | null>(resumeRemovalId);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const selectable = useSelectableBatches(facilityId, step === "select");
  const ctxQuery = useRemovalCertifyContext(removalId ?? "", !!removalId);
  const createMutation = useCreateRemovalWithBatches();
  const toast = useToast();

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
          setStep("requirements");
        },
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Could not create removal.",
          ),
      },
    );
  };

  const currentIndex = STEP_KEYS.indexOf(step);

  // Guard a resumed draft: once its context loads, a removal that's already
  // `submitted` or mid-flight (`inProgress`) has nothing left to action, so the
  // wizard must not re-enter the requirements → submit steps. Stops a stale
  // `?resume=<id>` link (e.g. a bookmark) from re-opening a done removal — the
  // detail sheet already hides the entry, this covers direct navigation.
  const resumeReadiness =
    resumeRemovalId && ctxQuery.data
      ? deriveRemovalReadiness(toRemovalReadinessFacts(ctxQuery.data))
      : null;
  if (
    resumeReadiness?.state === "submitted" ||
    resumeReadiness?.state === "inProgress"
  ) {
    return (
      <div className="flex flex-col gap-24">
        <h2 id="new-removal-title" className="title-heading-2">
          Removal
        </h2>
        <p className="body-small text-[var(--color-text-secondary)]">
          {resumeReadiness.state === "submitted"
            ? "This removal has already been submitted to the registry — there's nothing left to do."
            : "A submission for this removal is in progress. Wait for it to finish before making changes."}
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
    <div className="flex flex-col gap-24">
      <div className="flex items-center justify-between gap-12">
        <h2 id="new-removal-title" className="title-heading-2">
          New removal
        </h2>
      </div>

      <StepFlow steps={STEPS} current={currentIndex} footer={null}>
        {step === "select" && (
          <SelectBatchesStep
            batches={selectable.data?.batches ?? []}
            facilitySetupComplete={
              selectable.data?.facilitySetupComplete ?? true
            }
            facilityId={facilityId}
            selectedIds={selectedIds}
            onToggle={toggle}
            isLoading={selectable.isLoading}
            isError={selectable.isError}
          />
        )}
        {step === "requirements" &&
          (ctxQuery.isLoading ? (
            <p className="body-small text-[var(--color-text-tertiary)]">
              Loading requirements…
            </p>
          ) : ctxQuery.error || !ctxQuery.data ? (
            <p className="body-small text-[var(--clr-red)]" role="alert">
              Couldn&apos;t load this removal. Try refreshing the page.
            </p>
          ) : (
            <RequirementsStep
              checklist={buildRemovalRequirementsChecklist(
                toRemovalReadinessFacts(ctxQuery.data),
              )}
              facilityId={facilityId}
            />
          ))}
        {step === "submit" &&
          removalId &&
          (ctxQuery.data ? (
            <SubmitStep
              removalId={removalId}
              ctx={ctxQuery.data}
              onDone={onClose}
            />
          ) : (
            <p className="body-small text-[var(--color-text-tertiary)]">
              Loading…
            </p>
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
        canConfirm={selectedIds.size > 0}
        canSubmit={
          ctxQuery.data
            ? deriveRemovalReadiness(toRemovalReadinessFacts(ctxQuery.data))
                .state === "ready"
            : false
        }
        onResolveLater={onClose}
        onAdvanceToSubmit={() => setStep("submit")}
      />
    </div>
  );
}

function Footer({
  step,
  selectable,
  confirmBusy,
  onCancel,
  onConfirm,
  canConfirm,
  canSubmit,
  onResolveLater,
  onAdvanceToSubmit,
}: {
  step: StepKey;
  selectable: { ready: number; total: number; selected: number };
  confirmBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  canConfirm: boolean;
  canSubmit: boolean;
  onResolveLater: () => void;
  onAdvanceToSubmit: () => void;
}) {
  // The submit step owns its own action row (and success "Done").
  if (step === "submit") return null;

  if (step === "select") {
    return (
      <div className="flex items-center justify-between gap-12 border-t border-[var(--color-border-secondary)] pt-16">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {selectable.ready} of {selectable.total} batches ready ·{" "}
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
            Confirm
          </Button>
        </div>
      </div>
    );
  }

  const submitButton = (
    <Button
      variant="primary"
      onClick={onAdvanceToSubmit}
      disabled={!canSubmit}
    >
      Submit
    </Button>
  );

  // requirements
  return (
    <div className="flex items-center justify-end gap-12 border-t border-[var(--color-border-secondary)] pt-16">
      <Button variant="default" onClick={onResolveLater}>
        Resolve later
      </Button>
      {canSubmit ? (
        submitButton
      ) : (
        <Tooltip content="Complete unmet registry requirements before submitting.">
          <span className="inline-flex" tabIndex={0}>
            {submitButton}
          </span>
        </Tooltip>
      )}
    </div>
  );
}
