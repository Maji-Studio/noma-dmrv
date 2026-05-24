/**
 * CertifyPanel — Isometric Certify status strip inside the credit-batch
 * side sheet. A credit batch maps into one Isometric Removal (N credit
 * batches may share a removal — ADR 0003). The panel shows the removal's
 * transport readiness, its member credit batches, runs the submit, and
 * surfaces the Removal's status. Grouping is managed on the Certification
 * hub (/certification).
 */
"use client";

import { ArrowsClockwise } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  useCertifyContextForCreditBatch,
  useSubmitCreditBatchRemoval,
} from "@/hooks/use-certification";
import type {
  RemovalCertifyContext,
  TransportCategory,
  TransportCoverage,
} from "@/fn/certification/certify-context";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { EnvBanner } from "./env-banner";
import { Section } from "./panel-layout";
import { SubmissionStatusBadge } from "./submission-status-badge";
import { SubmitConfirmDialog } from "./submit-confirm-dialog";

const ICON_SIZE = 14;

export function CertifyPanel({ creditBatchId }: { creditBatchId: string }) {
  return (
    <Section>
      <div className="flex flex-col gap-12">
        <header>
          <h3 className="title-chapter-title">Isometric Certify</h3>
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

  const data = ctx.data;
  const { mapping, project, isProduction } = data;

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
  const templateResolved =
    !!data.defaultTemplate &&
    !data.missingDefaultTemplateId &&
    data.unresolvedBlueprintKeys.length === 0;

  const blocker = !templateResolved
    ? deriveBlocker({
        hasDefaultTemplate: !!data.defaultTemplate,
        missingDefaultTemplateId: data.missingDefaultTemplateId,
        unresolvedBlueprintKeys: data.unresolvedBlueprintKeys,
      })
    : null;

  const coverage = analyzeCoverage(
    data.transportCoverage,
    data.requiredTransportCategories,
  );
  const submitReady =
    templateResolved &&
    coverage.missing.length === 0 &&
    coverage.incomplete.length === 0;

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

      <MemberBatchesRow data={data} currentCreditBatchId={creditBatchId} />

      {templateResolved && data.requiredTransportCategories.length > 0 && (
        <TransportCoverageNotice
          missing={coverage.missing}
          incomplete={coverage.incomplete}
        />
      )}

      <SubmissionSection
        creditBatchId={creditBatchId}
        data={data}
        isProduction={isProduction}
        canSubmit={submitReady}
      />
    </div>
  );
}

function MemberBatchesRow({
  data,
  currentCreditBatchId,
}: {
  data: RemovalCertifyContext;
  currentCreditBatchId: string;
}) {
  const others = data.memberBatches.filter(
    (b) => b.id !== currentCreditBatchId,
  );
  return (
    <div className="flex flex-col gap-4 border-t border-[var(--color-border-secondary)] pt-12">
      <div className="flex items-center justify-between gap-8">
        <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Removal
        </span>
        <Link
          href="/certification"
          className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
        >
          Manage on Certification ↗
        </Link>
      </div>
      {data.removalId ? (
        <span className="body-caption font-mono text-[var(--color-text-tertiary)]">
          {data.removalId}
        </span>
      ) : (
        <span className="body-caption text-[var(--color-text-tertiary)]">
          A removal is created for this batch on first submit.
        </span>
      )}
      {others.length > 0 && (
        <p className="body-caption text-[var(--color-text-secondary)]">
          Grouped with {others.length} other credit batch
          {others.length === 1 ? "" : "es"}:{" "}
          <span className="font-mono">
            {others.map((b) => b.code).join(", ")}
          </span>
        </p>
      )}
    </div>
  );
}

function SubmissionSection({
  creditBatchId,
  data,
  isProduction,
  canSubmit,
}: {
  creditBatchId: string;
  data: RemovalCertifyContext;
  isProduction: boolean;
  canSubmit: boolean;
}) {
  const submitMutation = useSubmitCreditBatchRemoval();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const latest = data.latestSubmission;
  const lockedInFlight = latest ? isLockedInFlight(latest) : false;
  const submitDisabled =
    !canSubmit || lockedInFlight || submitMutation.isPending;

  const buttonLabel = (() => {
    if (submitMutation.isPending) return "Submitting…";
    if (lockedInFlight) return "In progress";
    return latest?.externalId ? "Resubmit Removal" : "Submit Removal";
  })();

  const fireSubmit = (confirmProduction = false) => {
    submitMutation.mutate(
      { creditBatchId, confirmProduction },
      {
        onSuccess: (result) => {
          toast.success(`Submitted Removal ${result.externalId}.`);
        },
        onError: (err) => {
          toast.error(
            `Submission failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
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

  return (
    <div className="flex flex-col gap-12 border-t border-[var(--color-border-secondary)] pt-12">
      <div className="flex items-center justify-between gap-12">
        <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Submission
        </span>
        <Button
          variant="primary"
          size="default"
          onClick={handleClick}
          disabled={submitDisabled}
        >
          {!lockedInFlight && submitMutation.isPending && (
            <ArrowsClockwise size={ICON_SIZE} className="animate-spin" />
          )}
          {buttonLabel}
        </Button>
      </div>

      {latest ? (
        <div className="flex items-center justify-between gap-8">
          <div className="flex flex-col gap-2 min-w-0">
            {latest.externalId && (
              <span className="body-caption font-mono text-[var(--color-text-tertiary)] truncate">
                {latest.externalId} · v{latest.version}
              </span>
            )}
          </div>
          <SubmissionStatusBadge
            latest={latest}
            isLockedInFlight={lockedInFlight}
          />
        </div>
      ) : (
        <p className="body-caption text-[var(--color-text-tertiary)]">
          This removal has not been submitted yet.
        </p>
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

const TRANSPORT_CATEGORY_LABELS: Record<TransportCategory, string> = {
  feedstock: "feedstock",
  biochar: "biochar",
  sample: "sample",
};

type CoverageStatus = "missing" | "incomplete" | "complete";

function coverageStatus(
  bucket: TransportCoverage[TransportCategory],
): CoverageStatus {
  if (bucket.count === 0) return "missing";
  return bucket.aggregationWarning !== null ? "incomplete" : "complete";
}

function analyzeCoverage(
  coverage: TransportCoverage,
  required: TransportCategory[],
): { missing: TransportCategory[]; incomplete: TransportCategory[] } {
  const missing: TransportCategory[] = [];
  const incomplete: TransportCategory[] = [];
  for (const category of required) {
    const status = coverageStatus(coverage[category]);
    if (status === "missing") missing.push(category);
    else if (status === "incomplete") incomplete.push(category);
  }
  return { missing, incomplete };
}

function TransportCoverageNotice({
  missing,
  incomplete,
}: {
  missing: TransportCategory[];
  incomplete: TransportCategory[];
}) {
  const ready = missing.length === 0 && incomplete.length === 0;
  return (
    <div className="border-t border-[var(--color-border-secondary)] pt-12">
      <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
        Transport coverage
      </span>
      <p className="body-small mt-6">
        {ready ? (
          <span className="text-[var(--color-text-secondary)]">
            <span className="text-[var(--clr-green,var(--color-text-primary))]">
              ✓
            </span>{" "}
            All required transport legs present for this removal.
          </span>
        ) : (
          <span className="text-[var(--color-text-primary)]">
            <span className="text-[var(--color-signal-orange)]">!</span>{" "}
            {describeGaps(missing, incomplete)}
          </span>
        )}
      </p>
    </div>
  );
}

function describeGaps(
  missing: TransportCategory[],
  incomplete: TransportCategory[],
): string {
  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(
      `missing ${missing
        .map((c) => TRANSPORT_CATEGORY_LABELS[c])
        .join(", ")} legs`,
    );
  }
  if (incomplete.length > 0) {
    parts.push(
      `incomplete ${incomplete
        .map((c) => TRANSPORT_CATEGORY_LABELS[c])
        .join(", ")} legs`,
    );
  }
  return parts.join("; ");
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
      message: `Template references ${unresolvedBlueprintKeys.length} unresolved blueprint${
        unresolvedBlueprintKeys.length === 1 ? "" : "s"
      }: ${list}.`,
      fixHint: "Refresh the link in facility settings →",
    };
  }
  return { message: "Submission blocked.", fixHint: "Check facility settings →" };
}
