/**
 * SubmitStep — the final "Confirm & submit" step of the New-Removal wizard. It
 * folds in what used to be a separate "Requirements" step: the facility/registry-
 * level checks (project mapping, default template, cross-batch transport
 * uniformity) reach the operator through `SubmissionSummary` — a verdict line
 * plus the checks that still need attention, each with a fix link — and the
 * submit button is gated on the shared `deriveRemovalReadiness` verdict.
 * Per-batch concerns (carbon, production lineage, transport-leg presence, and the
 * batch's own entity certifier fields) were already resolved at selection — only
 * ready batches got grouped — so this screen is a true confirmation, not a place
 * to discover new blockers.
 *
 * Reuses the same single-phase `submitRemoval` (via `useSubmitRemoval`) and
 * production confirmation gate as the standalone Review flow, so the two submit
 * paths behave identically. On success it shows the resulting registry record.
 */
"use client";

import { useState } from "react";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms";
import { Button, buttonVariants } from "@/components/ui";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import {
  useRemovalCompilation,
} from "@/hooks/use-certification";
import type { useSubmitRemoval } from "@/hooks/use-certification";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import {
  buildRemovalRequirementsChecklist,
  deriveRemovalReadiness,
} from "@/lib/certification/readiness";
import { toRemovalReadinessFacts } from "@/lib/certification/readiness-facts";
import { isometricRegistry } from "@/lib/isometric/links";
import { SubmitConfirmDialog } from "../submit-confirm-dialog";
import { SubmissionProgress } from "../submission-progress";
import type { SubmissionProgressUpdate } from "@/lib/certification/submission-progress";
import { isSubmissionStreamStalledError } from "@/lib/certification/submission-progress-client";
import { DebugDrawer } from "./debug-drawer";
import { isRemovalCompilationReady } from "./submission-facts";
import { SubmissionSummary } from "./submission-summary";
import { allowsRemovalSubmission } from "./resume-state";

const REJECTED_IN_ISOMETRIC_MSG =
  "This Removal was rejected in Isometric. Resolve the registry record before trying again from noma.";

interface SubmitStepProps {
  removalId: string;
  ctx: RemovalCertifyContext;
  facilityId: string;
  onDone: () => void;
  submitMutation: ReturnType<typeof useSubmitRemoval>;
}

export function SubmitStep({
  removalId,
  ctx,
  facilityId,
  onDone,
  submitMutation,
}: SubmitStepProps) {
  const compilationQuery = useRemovalCompilation(facilityId, removalId);
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [progressUpdates, setProgressUpdates] = useState<
    SubmissionProgressUpdate[]
  >([]);

  const externalId = ctx.latestSubmission?.externalId ?? null;
  const rejectedWithExternal =
    ctx.latestSubmission?.status === "rejected" && externalId !== null;

  const facts = toRemovalReadinessFacts(ctx);
  const checklist = buildRemovalRequirementsChecklist(facts);
  const readiness = deriveRemovalReadiness(facts);
  const compilationReady = isRemovalCompilationReady(
    compilationQuery.data ?? null,
  );
  const requirementsMet =
    allowsRemovalSubmission(readiness.state) && compilationReady === true;

  const fireSubmit = (confirmProduction = false) => {
    if (rejectedWithExternal) {
      setSubmitError(REJECTED_IN_ISOMETRIC_MSG);
      return;
    }
    if (!compilationReady) {
      setSubmitError(
        "The submission review is not ready. Resolve every submission issue and try again.",
      );
      return;
    }
    setSubmitError(null);
    setProgressUpdates([]);
    submitMutation.mutate(
      {
        input: {
          removalId,
          confirmProduction,
          compilationHash: compilationQuery.data?.compilationHash ?? "",
        },
        onProgress: (update) => {
          setProgressUpdates((current) => [...current, update]);
        },
      },
      {
        onSuccess: (result) => {
          setSubmitError(null);
          toast.success(`Removal ${result.externalId} submitted.`);
        },
        onError: (err) => {
          setSubmitError(
            err instanceof Error
              ? err.message
              : "The Removal was not submitted. Try again.",
          );
        },
      },
    );
  };

  const handleSubmit = () => {
    if (ctx.isProduction) {
      setConfirmOpen(true);
      return;
    }
    fireSubmit();
  };

  const confirmDialog = (
    <SubmitConfirmDialog
      isOpen={confirmOpen}
      onClose={() => setConfirmOpen(false)}
      onConfirm={() => {
        setConfirmOpen(false);
        fireSubmit(true);
      }}
      isPending={submitMutation.isPending}
      artifact="removal"
      isProduction={ctx.isProduction}
    />
  );

  if (submitMutation.isSuccess && submitMutation.data) {
    // "View on Isometric" deep-links to the supplier's private Certify view of
    // this removal (project-scoped, environment-specific — see links.ts). Needs
    // the facility's mapped project id; omit the link if somehow unmapped.
    const projectId = ctx.mapping?.externalProjectId ?? null;
    const viewUrl = projectId
      ? isometricRegistry.removal({
          environment: ctx.isProduction ? "production" : "sandbox",
          externalProjectId: projectId,
          externalRemovalId: submitMutation.data.externalId,
        })
      : null;

    return (
      <div className="flex flex-col gap-24">
        <div className="flex items-start gap-12 border-l-2 border-[var(--st-ok)] pl-12 py-4">
          <CheckCircleIcon
            size={20}
            weight="fill"
            aria-hidden
            className="mt-px shrink-0 text-[var(--st-ok)]"
          />
          <div className="flex flex-col gap-4">
            <span className="body-medium text-[var(--color-text-primary)]">
              Removal submitted to the registry.
            </span>
            <span className="body-caption font-mono text-[var(--color-text-tertiary)]">
              {submitMutation.data.externalId} · v{submitMutation.data.version}
            </span>
          </div>
        </div>
        <SubmissionProgress kind="removal" updates={progressUpdates} />
        <div className="flex items-center justify-end gap-12">
          {viewUrl && (
            <a
              href={viewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "default" })}
            >
              View on Isometric
              <ArrowSquareOutIcon size={16} aria-hidden />
            </a>
          )}
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  if (submitMutation.isPending || progressUpdates.length > 0) {
    const submissionStalled = isSubmissionStreamStalledError(
      submitMutation.error,
    );
    return (
      <div className="flex flex-col gap-16">
        <SubmissionProgress
          kind="removal"
          updates={progressUpdates}
          error={submitError}
          stalled={submissionStalled}
        />
        {submitError && <ServerError message={submitError} />}
        <div className="flex flex-wrap items-center justify-between gap-12 border-t border-[var(--color-border-secondary)] pt-16">
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {submitMutation.isPending
              ? "noma is submitting the Removal to Isometric."
              : submissionStalled
                ? "Registry work may still be continuing. Close this dialog and refresh the page to reconcile its status."
                : "Return to the submission review before trying again. If noma reports that this submission is in progress, wait for it to finish."}
          </span>
          {!submitMutation.isPending && (
            <div className="flex items-center gap-12">
              {submissionStalled ? (
                <Button variant="primary" onClick={onDone}>
                  Close
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => {
                    setProgressUpdates([]);
                    submitMutation.reset();
                  }}
                >
                  Review submission
                </Button>
              )}
            </div>
          )}
        </div>
        {confirmDialog}
      </div>
    );
  }

  const submitButton = (
    <Button
      variant="primary"
      onClick={handleSubmit}
      busy={submitMutation.isPending}
      disabled={rejectedWithExternal || !requirementsMet}
    >
      {externalId ? "Resubmit Removal" : "Submit Removal"}
    </Button>
  );

  return (
    <div className="flex flex-col gap-16">
      <SubmissionSummary
        ctx={ctx}
        facilityId={facilityId}
        compilation={compilationQuery.data ?? null}
        isCompilationLoading={compilationQuery.isLoading}
        compilationError={compilationQuery.error}
        checks={checklist}
        readiness={readiness}
        rejectionMessage={
          rejectedWithExternal ? REJECTED_IN_ISOMETRIC_MSG : null
        }
      />

      <DebugDrawer
        compilation={compilationQuery.data ?? null}
        isCompilationLoading={compilationQuery.isLoading}
        compilationError={compilationQuery.error}
        onRetryCompilation={() => {
          void compilationQuery.refetch();
        }}
      />

      {/* The persisted rejected state belongs to the verdict line above; this
          alert is only for what the last submit attempt returned. */}
      {submitError && <ServerError message={submitError} />}

      <div className="flex justify-end">
        {requirementsMet ? (
          submitButton
        ) : (
          <Tooltip content="Resolve the issues above before submitting this Removal.">
            <span className="inline-flex" tabIndex={0}>
              {submitButton}
            </span>
          </Tooltip>
        )}
      </div>

      {confirmDialog}
    </div>
  );
}
