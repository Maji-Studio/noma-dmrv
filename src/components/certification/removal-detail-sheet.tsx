/**
 * RemovalDetailSheet — the read-only quick view for a Removal, opened from the
 * Removals table via `?removal=<id>`. Shows status, reporting window, member
 * batches, submission identity, and the readiness verdict. Actions adapt to the
 * removal (ADR 0003 decision 6): a ready 1:1 removal submits in one click
 * (production-gated); anything more complex routes to the guided Review flow.
 *
 * Built on SlideOverPanel rather than EntitySideSheet because the quick view
 * is read-only with bespoke actions (Submit / Review & submit), not the
 * view↔edit form lifecycle EntitySideSheet models.
 */
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import { CheckCircle, Warning } from "@phosphor-icons/react/dist/ssr";
import { Button, buttonVariants } from "@/components/ui";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { useSubmitRemoval } from "@/hooks/use-certification";
import type { RemovalPreflightSummary } from "@/fn/certification";
import { deriveRemovalStatus } from "@/lib/certification/status";
import { EnvBanner } from "./env-banner";
import { RegistryRecordLink } from "./registry-record-link";
import { RemovalCarbonBreakdown } from "./removal-carbon-breakdown";
import { SubmitConfirmDialog } from "./submit-confirm-dialog";

interface RemovalDetailSheetProps {
  summary: RemovalPreflightSummary;
  isProduction: boolean;
  facilityId: string;
  open: boolean;
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
        {label}
      </span>
      <div className="body-small text-[var(--color-text-primary)]">{children}</div>
    </div>
  );
}

function ReadinessBlock({ summary }: { summary: RemovalPreflightSummary }) {
  const { state, reasons } = summary.readiness;
  if (state === "ready") {
    return (
      <div className="flex items-center gap-8 border-l-2 border-[var(--color-signal-green)] pl-12 py-4">
        <CheckCircle
          size={16}
          weight="fill"
          aria-hidden
          className="shrink-0 text-[var(--color-signal-green)]"
        />
        <span className="body-small text-[var(--color-text-primary)]">
          Ready to submit — all preconditions met.
        </span>
      </div>
    );
  }
  if (state === "blocked") {
    return (
      <div className="flex flex-col gap-6 border-l-2 border-[var(--color-signal-orange)] pl-12 py-4">
        <span className="body-small font-medium text-[var(--color-text-primary)]">
          Blocked — resolve before submitting:
        </span>
        <ul className="flex flex-col gap-4">
          {reasons.map((reason) => (
            <li key={reason} className="flex items-start gap-6">
              <Warning
                size={14}
                weight="fill"
                aria-hidden
                className="mt-2 shrink-0 text-[var(--color-signal-orange)]"
              />
              <span className="body-caption text-[var(--color-text-secondary)]">
                {reason}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <p className="body-small text-[var(--color-text-secondary)]">
      {state === "inProgress"
        ? "A submission is in progress."
        : "This removal has been submitted to the registry."}
    </p>
  );
}

export function RemovalDetailSheet({
  summary,
  isProduction,
  facilityId,
  open,
  onClose,
}: RemovalDetailSheetProps) {
  const submitMutation = useSubmitRemoval();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const derived = deriveRemovalStatus({
    local: summary.local,
    lockInFlight: summary.lockInFlight,
  });
  const { state } = summary.readiness;
  // The workflow may only be (re)entered while something still needs doing:
  // `ready` (submit it) or `blocked` (resolve preconditions). A `submitted`
  // removal is done, and an `inProgress` one is mid-flight — neither offers an
  // action, so the sheet stays read-only (the server would refuse a resubmit
  // anyway; this just stops offering a dead-end control).
  const isActionable = state === "ready" || state === "blocked";
  const isOneClick = state === "ready" && summary.memberBatchCodes.length === 1;

  // Resume the New-Removal wizard directly on this removal. The legacy
  // `/removals/[id]/review` route only redirects here (dropping any `?step=`),
  // so we skip the hop and build the resume URL these links resolve to.
  const reviewHref = `/certification/removals?resume=${encodeURIComponent(
    summary.removalId,
  )}&facility=${encodeURIComponent(facilityId)}`;
  const evidenceHref = reviewHref;

  const window =
    summary.startedOn && summary.completedOn
      ? `${summary.startedOn} → ${summary.completedOn}`
      : "Set on submit";

  const fireSubmit = (confirmProduction = false) => {
    submitMutation.mutate(
      { removalId: summary.removalId, confirmProduction },
      {
        onSuccess: (result) =>
          toast.success(`Submitted Removal ${result.externalId}.`),
        onError: (err) =>
          toast.error(
            `Submission failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
      },
    );
  };

  const handleSubmit = () => {
    if (isProduction) {
      setConfirmOpen(true);
      return;
    }
    fireSubmit();
  };

  return (
    <SlideOverPanel.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <SlideOverPanel.Content size="default">
        <SlideOverPanel.Header showClose>
          <SlideOverPanel.Title>
            Removal {summary.removalId.slice(0, 8)}…
          </SlideOverPanel.Title>
          <SlideOverPanel.Description>{window}</SlideOverPanel.Description>
        </SlideOverPanel.Header>

        <SlideOverPanel.Body className="flex flex-col gap-24">
          <EnvBanner isProduction={isProduction} variant="inline" />

          <div className="flex items-center justify-between gap-12">
            <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
              Status
            </span>
            <StatusBadge status={derived.value} label={derived.label} />
          </div>

          <RemovalCarbonBreakdown removalId={summary.removalId} enabled={open} />

          <Field label="Reporting window">{window}</Field>

          <Field label={`Credit batches (${summary.memberBatchCodes.length})`}>
            <span className="font-mono">
              {summary.memberBatchCodes.join(", ") || "—"}
            </span>
          </Field>

          {summary.externalId && (
            <Field label="Registry record">
              <RegistryRecordLink
                facilityId={facilityId}
                externalId={summary.externalId}
                version={summary.version}
                isProduction={isProduction}
                kind="removal"
              />
            </Field>
          )}

          <ReadinessBlock summary={summary} />

          {isActionable && (
            <Link
              href={evidenceHref}
              className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
            >
              Evidence &amp; sources →
            </Link>
          )}
        </SlideOverPanel.Body>

        <SlideOverPanel.Footer className="justify-stretch">
          {isActionable &&
            (isOneClick ? (
              <Button
                variant="primary"
                className="flex-1"
                onClick={handleSubmit}
                busy={submitMutation.isPending}
              >
                {summary.externalId ? "Resubmit" : "Submit"}
              </Button>
            ) : (
              <Link
                href={reviewHref}
                className={buttonVariants({
                  variant: "primary",
                  className: "flex-1",
                })}
              >
                Review &amp; submit
              </Link>
            ))}
          <SlideOverPanel.Close>
            <Button
              variant={isActionable ? "default" : "primary"}
              className="flex-1"
            >
              Close
            </Button>
          </SlideOverPanel.Close>
        </SlideOverPanel.Footer>
      </SlideOverPanel.Content>

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
    </SlideOverPanel.Root>
  );
}
