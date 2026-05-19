/**
 * CertifyPanel — slim status strip inside the credit-batch side sheet.
 *
 * Replaces the previous heavy accordion with a compact "what's the state of
 * this batch's submission?" view: status, last attempt, inline error, one-tap
 * resubmit. Heavy detail (blueprints, drift warnings, full audit log) lives
 * on the certification surface — accessible via the "View in certification →"
 * link below.
 */
"use client";

import { ArrowSquareOut, ArrowsClockwise } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  useCertifyContextForCreditBatch,
  useCreditBatchSubmissionState,
  useSubmitCreditBatch,
} from "@/hooks/use-certification";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import { getMetadataValue } from "@/lib/isometric/utils/submission-metadata";
import { EnvBanner } from "./env-banner";
import { Section } from "./panel-layout";
import { SubmissionStatusBadge } from "./submission-status-badge";
import { SubmitConfirmDialog } from "./submit-confirm-dialog";
import { SyncEventLog } from "./sync-event-log";

interface CertifyPanelProps {
  creditBatchId: string;
}

export function CertifyPanel({ creditBatchId }: CertifyPanelProps) {
  return (
    <Section>
      <div className="flex flex-col gap-12">
        <header className="flex items-baseline justify-between gap-12">
          <h3 className="title-chapter-title">Isometric Certify</h3>
          <Link
            href={`/certification?batch=${creditBatchId}`}
            className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)] inline-flex items-center gap-4"
          >
            View in certification
            <ArrowSquareOut size={ICON_SIZE_SMALL} weight="bold" />
          </Link>
        </header>
        <PanelBody creditBatchId={creditBatchId} />
      </div>
    </Section>
  );
}

function PanelBody({ creditBatchId }: { creditBatchId: string }) {
  const ctx = useCertifyContextForCreditBatch(creditBatchId);

  if (ctx.isLoading) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        Loading certification state…
      </p>
    );
  }

  if (ctx.error || !ctx.data) {
    return (
      <p className="body-small text-[var(--clr-red)]">
        Unable to load certification state. Try refreshing the page.
      </p>
    );
  }

  const {
    mapping,
    project,
    defaultTemplate,
    missingDefaultTemplateId,
    unresolvedBlueprintKeys,
    isProduction,
  } = ctx.data;

  if (!mapping) {
    return (
      <div className="flex flex-col gap-8">
        <EnvBanner isProduction={isProduction} variant="inline" />
        <p className="body-small text-[var(--color-text-secondary)]">
          This facility isn&apos;t linked to an Isometric project. Open the
          facility settings to set up registry submission.
        </p>
      </div>
    );
  }

  const projectLabel = project?.name ?? mapping.externalProjectId;
  const submitReady =
    !!defaultTemplate &&
    !missingDefaultTemplateId &&
    unresolvedBlueprintKeys.length === 0;

  const blocker = !submitReady
    ? deriveBlocker({
        hasDefaultTemplate: !!defaultTemplate,
        missingDefaultTemplateId,
        unresolvedBlueprintKeys,
      })
    : null;

  return (
    <div className="flex flex-col gap-12">
      <EnvBanner isProduction={isProduction} variant="inline" />

      <div className="flex flex-col gap-2">
        <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Project
        </span>
        <span className="body-small">{projectLabel}</span>
        <span className="body-caption text-[var(--color-text-tertiary)] font-mono">
          {mapping.externalProjectId}
        </span>
      </div>

      {blocker && (
        <BlockerNotice
          message={blocker.message}
          fixHint={blocker.fixHint}
          fixHref={blocker.fixHref}
        />
      )}

      <SubmissionRow
        creditBatchId={creditBatchId}
        isProduction={isProduction}
        canSubmit={submitReady}
      />
    </div>
  );
}

function SubmissionRow({
  creditBatchId,
  isProduction,
  canSubmit,
}: {
  creditBatchId: string;
  isProduction: boolean;
  canSubmit: boolean;
}) {
  const { data: state, isLoading, isError, error } =
    useCreditBatchSubmissionState(creditBatchId);
  const submitMutation = useSubmitCreditBatch();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (isLoading) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        Loading submission state…
      </p>
    );
  }

  if (isError || !state) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to load submission state.";
    return (
      <p className="body-small text-[var(--clr-red)]">{message}</p>
    );
  }

  const { latest, recentSyncEvents, isLockedInFlight } = state;
  const lockedAt = toDate(latest?.lockedAt);
  const submitDisabled =
    !canSubmit || isLockedInFlight || submitMutation.isPending;

  const buttonLabel = (() => {
    if (submitMutation.isPending) return "Submitting…";
    if (isLockedInFlight) return "In progress";
    if (latest?.status === "submitted" || latest?.status === "accepted") {
      return "Resubmit";
    }
    return "Submit to Isometric";
  })();

  const fireSubmit = (confirmProduction = false) => {
    submitMutation.mutate(
      { creditBatchId, confirmProduction },
      {
        onSuccess: (data) => {
          toast.success(
            `Submitted to Isometric · Removal ${data.externalId} (v${data.version}).`,
          );
        },
        onError: (err) => {
          toast.error(
            `Submission failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        },
      },
    );
  };

  const handleClick = () => {
    if (isProduction) {
      setConfirmOpen(true);
      return;
    }
    fireSubmit();
  };

  const errorMessage = deriveErrorMessage(latest, recentSyncEvents);

  return (
    <div className="flex flex-col gap-12 border-t border-[var(--color-border-secondary)] pt-12">
      <div className="flex items-start justify-between gap-12">
        <div className="flex flex-col gap-4 min-w-0">
          <div className="flex items-center gap-8 flex-wrap">
            <SubmissionStatusBadge
              latest={latest}
              isLockedInFlight={isLockedInFlight}
            />
            {isLockedInFlight && lockedAt && <ElapsedChip since={lockedAt} />}
          </div>
          <SubmissionMeta latest={latest} />
        </div>
        <Button
          variant="primary"
          size="default"
          onClick={handleClick}
          disabled={submitDisabled}
        >
          {!isLockedInFlight && submitMutation.isPending && (
            <ArrowsClockwise size={ICON_SIZE_MEDIUM} className="animate-spin" />
          )}
          {buttonLabel}
        </Button>
      </div>

      {errorMessage && (
        <p className="body-small text-[var(--clr-red)] break-words">
          {errorMessage}
        </p>
      )}

      {recentSyncEvents.length > 0 && (
        <SyncEventLog events={recentSyncEvents} compact />
      )}

      <SubmitConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          fireSubmit(true);
        }}
        isPending={submitMutation.isPending}
        artifact="removal"
        isProduction={isProduction}
      />
    </div>
  );
}

function SubmissionMeta({
  latest,
}: {
  latest: CertificationSubmissionRow | null;
}) {
  if (!latest) {
    return (
      <span className="body-caption text-[var(--color-text-tertiary)]">
        Never submitted
      </span>
    );
  }
  const submittedLabel = latest.submittedAt
    ? new Date(latest.submittedAt).toLocaleDateString()
    : "—";
  return (
    <span className="body-caption text-[var(--color-text-tertiary)]">
      {latest.externalId ? (
        <span className="font-mono">
          {latest.externalId} · v{latest.version}
        </span>
      ) : (
        <span>Draft · v{latest.version}</span>
      )}
      <span className="mx-6">·</span>
      Last attempt {submittedLabel}
    </span>
  );
}

function ElapsedChip({ since }: { since: Date }) {
  const elapsed = useElapsed(since);
  return (
    <span className="body-caption text-[var(--color-text-tertiary)] font-mono">
      {formatElapsed(elapsed)}
    </span>
  );
}

const ELAPSED_TICK_MS = 1000;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const ICON_SIZE_SMALL = 12;
const ICON_SIZE_MEDIUM = 14;

function useElapsed(since: Date): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return Math.max(0, now - since.getTime());
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / MS_PER_SECOND);
  if (totalSeconds < SECONDS_PER_MINUTE) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function deriveErrorMessage(
  latest: CertificationSubmissionRow | null,
  recentSyncEvents: { status: string; errorMessage: string | null }[],
): string | null {
  if (!latest) return null;
  if (latest.status === "rejected") {
    const rejection = getMetadataValue(latest.metadata, "rejectionReason");
    if (typeof rejection === "string" && rejection) return rejection;
  }
  if (latest.status === "submitted" || latest.status === "accepted") {
    return null;
  }
  const lastFailure = recentSyncEvents.find((e) => e.status === "failed");
  return lastFailure?.errorMessage ?? null;
}

function BlockerNotice({
  message,
  fixHint,
  fixHref,
}: {
  message: string;
  fixHint: string;
  fixHref?: string;
}) {
  return (
    <div className="border-l-2 border-[var(--color-signal-orange)] pl-12 py-4">
      <p className="body-small text-[var(--color-text-primary)]">{message}</p>
      {fixHref ? (
        <Link
          href={fixHref}
          className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
        >
          {fixHint}
        </Link>
      ) : (
        <p className="body-caption text-[var(--color-text-tertiary)]">
          {fixHint}
        </p>
      )}
    </div>
  );
}

function deriveBlocker({
  hasDefaultTemplate,
  missingDefaultTemplateId,
  unresolvedBlueprintKeys,
}: {
  hasDefaultTemplate: boolean;
  missingDefaultTemplateId: string | null;
  unresolvedBlueprintKeys: string[];
}): { message: string; fixHint: string; fixHref?: string } {
  if (missingDefaultTemplateId) {
    return {
      message: `Default removal template ${missingDefaultTemplateId} is no longer available in Certify.`,
      fixHint: "Pick a new template in facility settings →",
    };
  }
  if (!hasDefaultTemplate) {
    return {
      message: "No default removal template selected for this facility.",
      fixHint: "Set one in facility settings →",
    };
  }
  if (unresolvedBlueprintKeys.length > 0) {
    const list = unresolvedBlueprintKeys.join(", ");
    return {
      message: `Template references ${unresolvedBlueprintKeys.length} unresolved blueprint${unresolvedBlueprintKeys.length === 1 ? "" : "s"}: ${list}.`,
      fixHint: "View blueprint detail in certification →",
    };
  }
  return { message: "Submission blocked.", fixHint: "Check certification →" };
}
