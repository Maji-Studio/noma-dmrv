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
 *   2. Empty components — only when a selected batch has components with
 *      nothing recorded for this Removal: record them as zero or add an entry
 *      on the batch's Emissions page. Skipped otherwise; a reopened draft lands
 *      here while any component is unconfirmed.
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
import {
  EmptyComponentsCheckError,
  useEmptyComponentsActions,
  useLoadRemovalEmptyComponents,
  useRefreshRemovalReview,
  useRemovalEmptyComponents,
  useRemovalLanding,
} from "@/hooks/use-removal-empty-components";
import {
  CHECK_FAILED_MESSAGE,
  EmptyComponentsStep,
  type FocusRequest,
} from "./empty-components-step";
import { PHONE_TOUCH_TARGET } from "@/components/ui/touch-target";
import { Notice } from "@/components/ui/notice";
import {
  continueRefusal,
  hasEmptyComponentsStep,
} from "@/lib/certification/empty-components-state";
import { SelectBatchesStep } from "./select-batches-step";
import { SubmitStep } from "./submit-step";
import { shouldBlockRemovalResume } from "./resume-state";

const SELECT_STEP: StepFlowStep = { key: "select", label: "Select batches" };
const EMPTY_STEP: StepFlowStep = { key: "empty", label: "Empty components" };
const SUBMIT_STEP: StepFlowStep = { key: "submit", label: "Confirm & submit" };
type StepKey = "select" | "empty" | "submit";


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
  // A new or reopened Removal has no chosen step yet: it lands where the
  // server's answer sends it, resolved once (the empty components while any is
  // unconfirmed, the submit step otherwise).
  const [chosenStep, setChosenStep] = useState<StepKey | null>(
    resumeRemovalId ? null : "select",
  );
  const [removalId, setRemovalId] = useState<string | null>(resumeRemovalId);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [advancing, setAdvancing] = useState(false);
  // What a pressed Continue found: components still open, or a failed read.
  const [pressed, setPressed] = useState<"open" | "failed" | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const landing = useRemovalLanding(removalId, facilityId, chosenStep === null);
  const step: StepKey | null = chosenStep ?? landing.data?.step ?? null;
  const emptyQuery = useRemovalEmptyComponents(removalId, {
    enabled: !!landing.data,
    refetchOnFocus: step === "empty",
  });
  const actions = useEmptyComponentsActions();
  const loadEmptyComponents = useLoadRemovalEmptyComponents();
  const refreshReview = useRefreshRemovalReview();

  const selectable = useSelectableBatches(facilityId, step === "select");
  const ctxQuery = useRemovalCertifyContext(
    facilityId,
    removalId ?? "",
    !!removalId,
  );
  const createMutation = useCreateRemovalWithBatches();
  const toast = useToast();

  const facilitySetupComplete = selectable.data?.facilitySetupComplete ?? false;
  const showEmptyStep =
    step === "empty" ||
    (!!landing.data &&
      !!emptyQuery.data &&
      hasEmptyComponentsStep(emptyQuery.data));
  const steps = showEmptyStep
    ? [SELECT_STEP, EMPTY_STEP, SUBMIT_STEP]
    : [SELECT_STEP, SUBMIT_STEP];

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        const batch = selectable.data?.batches.find((item) => item.id === id);
        if (batch?.durabilityOption === "1000_year") {
          next.clear();
        }
        next.add(id);
      }
      return next;
    });
  };

  const has1000YearSelection = [...selectedIds].some(
    (id) =>
      selectable.data?.batches.find((batch) => batch.id === id)
        ?.durabilityOption === "1000_year",
  );

  const confirmSelection = () => {
    createMutation.mutate(
      { facilityId, creditBatchIds: [...selectedIds] },
      {
        onSuccess: ({ removalId: newId }) => {
          // The draft exists now: the landing read picks the next step.
          setRemovalId(newId);
          setChosenStep(null);
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

  // No step is current while the landing is unresolved (the rail shows none).
  const currentIndex = step ? steps.findIndex((item) => item.key === step) : -1;

  // Continue from the empty components re-reads the server first, so an entry
  // added in another tab counts, then refreshes the review the submit step reads.
  const continueFromEmpty = async () => {
    if (!removalId) return;
    setAdvancing(true);
    setPressed(null);
    const fresh = await loadEmptyComponents(removalId);
    if (!fresh) {
      setPressed("failed");
      setAdvancing(false);
      return;
    }
    const found = continueRefusal(fresh);
    if (found.reason) {
      setPressed("open");
      const batchId = found.firstBatchId;
      setFocusRequest((previous) =>
        batchId ? { batchId, nonce: (previous?.nonce ?? 0) + 1 } : previous,
      );
      setAdvancing(false);
      return;
    }
    await refreshReview();
    setChosenStep("submit");
    setAdvancing(false);
  };
  const liveRefusal = emptyQuery.data ? continueRefusal(emptyQuery.data) : null;
  // The reason shows after a refused press only: the card headers already count.
  const continueReason =
    pressed === "failed"
      ? CHECK_FAILED_MESSAGE
      : pressed === "open"
        ? (liveRefusal?.reason ?? null)
        : null;

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
        <div className="flex justify-start">
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
        steps={steps}
        current={currentIndex}
        // The empty components stay reachable from the submit step to undo a
        // recorded zero; the selection is fixed once the draft exists.
        furthest={currentIndex}
        onNavigate={(index) => {
          setPressed(null);
          setChosenStep(steps[index].key as StepKey);
        }}
        canNavigate={(index) =>
          steps[index].key === "empty" &&
          !submitMutation.isPending &&
          !submitMutation.isSuccess
        }
        footer={null}
        // The rail is the only way back to Empty components (to undo a recorded zero).
        phoneBack
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
        {step === null &&
          (landing.error instanceof EmptyComponentsCheckError ? (
            <Notice
              tone="error"
              action={
                <Button variant="default" onClick={() => void landing.refetch()}>
                  Try again
                </Button>
              }
            >
              {CHECK_FAILED_MESSAGE}
            </Notice>
          ) : landing.isError ? (
            // The context itself failed to load: the message the dialog always showed.
            <p className="body-small text-[var(--clr-red)]" role="alert">
              This Removal could not be loaded. Refresh the page.
            </p>
          ) : (
            <p className="body-small text-[var(--color-text-tertiary)]">
              Loading…
            </p>
          ))}
        {step === "empty" && removalId && (
          <EmptyComponentsStep
            removalId={removalId}
            facilityId={facilityId}
            data={emptyQuery.data}
            isLoading={emptyQuery.isLoading}
            isError={emptyQuery.isError}
            onRetry={() => void emptyQuery.refetch()}
            actions={actions}
            focusRequest={focusRequest}
            batchDates={Object.fromEntries(
              (ctxQuery.data?.memberBatches ?? []).map((batch) => [
                batch.id,
                { startDate: batch.startDate, endDate: batch.endDate },
              ]),
            )}
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
        step={step ?? "submit"}
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
          selectedIds.size > 0 &&
          (!has1000YearSelection || selectedIds.size === 1) &&
          facilitySetupComplete &&
          !selectable.isLoading
        }
      />
      {step === "empty" && (
        <EmptyStepFooter
          reason={continueReason}
          busy={advancing || actions.busy}
          onContinue={() => void continueFromEmpty()}
          onCancel={onClose}
        />
      )}
    </div>
  );
}

function EmptyStepFooter({
  reason,
  busy,
  onContinue,
  onCancel,
}: {
  /** Why the last press of Continue was refused, announced where the action is. */
  reason: string | null;
  busy: boolean;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-12 border-t border-[var(--color-border-secondary)] pt-16">
      <div className="flex items-center gap-12">
        {/* BTN-09: Continue stays pressable; pressing it while blocked names what is missing. */}
        <Button variant="primary" className={PHONE_TOUCH_TARGET} onClick={onContinue} busy={busy}>
          Continue
        </Button>
        <Button variant="default" className={PHONE_TOUCH_TARGET} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {reason && <Notice tone="error">{reason}</Notice>}
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
  // The later steps own their action rows (the submit step also its success "Done").
  if (step !== "select") return null;

  return (
    <div className="flex flex-wrap items-center justify-start gap-x-16 gap-y-12 border-t border-[var(--color-border-secondary)] pt-16">
      <div className="flex items-center gap-12">
        <Button
          variant="primary"
          className={PHONE_TOUCH_TARGET}
          onClick={onConfirm}
          disabled={!canConfirm}
          busy={confirmBusy}
        >
          Continue
        </Button>
        <Button variant="default" className={PHONE_TOUCH_TARGET} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <span className="body-caption text-[var(--color-text-tertiary)]">
        {selectable.ready} of {selectable.total} batches with complete data ·{" "}
        {selectable.selected} selected
      </span>
    </div>
  );
}
