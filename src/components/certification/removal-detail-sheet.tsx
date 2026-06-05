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
  const isOneClick = state === "ready" && summary.memberBatchCodes.length === 1;

  const reviewHref = `/certification/removals/${encodeURIComponent(
    summary.removalId,
  )}/review?facility=${encodeURIComponent(facilityId)}`;
  const evidenceHref = `${reviewHref}&step=evidence`;
  const reviewLabel =
    state === "ready" || state === "blocked" ? "Review & submit" : "Open Review";

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

          <Field label="Reporting window">{window}</Field>

          <Field label={`Credit batches (${summary.memberBatchCodes.length})`}>
            <span className="font-mono">
              {summary.memberBatchCodes.join(", ") || "—"}
            </span>
          </Field>

          {summary.externalId && (
            <Field label="Registry record">
              <span className="font-mono text-[var(--color-text-secondary)]">
                {summary.externalId} · v{summary.version}
              </span>
            </Field>
          )}

          <ReadinessBlock summary={summary} />

          <Link
            href={evidenceHref}
            className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
          >
            Evidence &amp; sources →
          </Link>
        </SlideOverPanel.Body>

        <SlideOverPanel.Footer className="justify-stretch">
          {isOneClick ? (
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
              {reviewLabel}
            </Link>
          )}
          <SlideOverPanel.Close>
            <Button variant="default" className="flex-1">
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
