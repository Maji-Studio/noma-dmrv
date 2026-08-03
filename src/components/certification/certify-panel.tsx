/**
 * CertifyPanel — read-only certification *bridge* inside the credit-batch side
 * sheet (Stage 6 / ADR 0007). It used to be a second submission entry point
 * (the dual-entry of ADR 0003): it computed blockers, transport coverage, and
 * ran the submit. That muddied the flow — submission now lives entirely in the
 * Certification workspace, so this panel is demoted to a status bridge:
 *
 *   - shows the removal's **own local** status — never a verifier status
 *     attributed to the removal (P1-b). A removal's lifecycle ends at
 *     "Submitted". When the removal has been rolled into a GHG Statement, that
 *     statement's verifier status is shown inline as a separate, clearly
 *     labelled line that deep-links into the GHG Statements tab.
 *   - lists the member credit batches (read-only — grouping happens in the
 *     workspace).
 *   - deep-links into Certification (the removal's guided Review flow, or the
 *     Removals tab when the batch isn't grouped yet).
 *
 * The blocker / coverage / submit logic that used to live here is canonical in
 * `lib/certification/readiness.ts` + the guided Review flow; it is intentionally
 * not duplicated here anymore.
 */
"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui";
import { useCertifyContextForCreditBatch } from "@/hooks/use-certification";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import { StatusBadge } from "@/components/ui/status-badge";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { EnvBanner } from "./env-banner";
import { Section } from "./panel-layout";
import { SubmissionStatusBadge } from "./submission-status-badge";

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
      <p className="body-small text-[var(--color-signal-red)]" role="alert">
        Certification status could not be loaded. Refresh the page and try again.
      </p>
    );
  }

  const data = ctx.data;
  const { mapping, project, isProduction } = data;
  const settingsHref = data.facilityId
    ? `/certification/settings?facility=${encodeURIComponent(data.facilityId)}`
    : "/certification/settings";

  if (!mapping) {
    return (
      <div className="flex flex-col gap-8">
        <EnvBanner isProduction={isProduction} variant="inline" />
        <p className="body-small text-[var(--color-text-secondary)]">
          This facility isn&apos;t linked to an Isometric project. Link it in{" "}
          <Link
            href={settingsHref}
            className="underline underline-offset-2 hover:text-[var(--color-text-primary)]"
          >
            Certification → Settings
          </Link>{" "}
          to enable registry submission.
        </p>
      </div>
    );
  }

  const projectLabel = project?.name ?? mapping.externalProjectId;

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

      <RemovalStatusRow data={data} />

      <MemberBatchesRow data={data} currentCreditBatchId={creditBatchId} />

      <OpenInCertification data={data} />
    </div>
  );
}

function RemovalStatusRow({ data }: { data: RemovalCertifyContext }) {
  const latest = data.latestSubmission;
  const lockedInFlight = latest ? isLockedInFlight(latest) : false;
  const linked = data.linkedGhgStatement;

  return (
    <div className="flex flex-col gap-6 border-t border-[var(--color-border-secondary)] pt-12">
      <div className="flex items-center justify-between gap-8">
        <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Removal status
        </span>
        {latest ? (
          <SubmissionStatusBadge
            latest={latest}
            isLockedInFlight={lockedInFlight}
            artifact="removal"
          />
        ) : (
          <span className="body-caption text-[var(--color-text-tertiary)]">
            Not submitted
          </span>
        )}
      </div>
      {latest?.externalId && (
        <span className="body-caption font-mono text-[var(--color-text-tertiary)] truncate">
          {latest.externalId} · v{latest.version}
        </span>
      )}

      {linked ? (
        // The GHG Statement's verifier status — kept a distinct, labelled line
        // so it's never read as the removal's own status (P1-b).
        <div className="flex flex-col gap-4 border-t border-[var(--color-border-tertiary)] pt-8">
          <div className="flex items-center justify-between gap-8">
            <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
              GHG Statement
            </span>
            <StatusBadge
              status={linked.status.value}
              label={linked.status.label}
            />
          </div>
          <Link
            href={`/certification/ghg-statements?statement=${encodeURIComponent(
              linked.id,
            )}&facility=${encodeURIComponent(data.facilityId)}`}
            className="body-caption underline underline-offset-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            View in GHG Statements →
          </Link>
        </div>
      ) : (
        <p className="body-caption text-[var(--color-text-tertiary)]">
          A Removal is complete at &ldquo;Submitted&rdquo;. If it&apos;s included in
          a GHG Statement, the verifier status appears here.
        </p>
      )}
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
      <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
        Removal
      </span>
      {data.removalId ? (
        <span className="body-caption font-mono text-[var(--color-text-tertiary)]">
          {data.removalId}
        </span>
      ) : (
        <span className="body-caption text-[var(--color-text-tertiary)]">
          Not grouped. A Removal is created when you first submit.
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

function OpenInCertification({ data }: { data: RemovalCertifyContext }) {
  // A grouped removal deep-links to its guided Review flow; an ungrouped batch
  // goes to the Removals route, where it can be grouped and submitted.
  const href = data.removalId
    ? `/certification/removals/${encodeURIComponent(
        data.removalId,
      )}/review?facility=${encodeURIComponent(data.facilityId)}`
    : `/certification/removals?facility=${encodeURIComponent(data.facilityId)}`;

  return (
    <div className="border-t border-[var(--color-border-secondary)] pt-12">
      <Link
        href={href}
        className={buttonVariants({ variant: "primary", width: "full" })}
      >
        Open in Certification →
      </Link>
    </div>
  );
}
