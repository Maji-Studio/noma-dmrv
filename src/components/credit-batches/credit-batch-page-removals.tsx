"use client";

/**
 * The Removals tab: the detailed bar (each Removal split into its
 * applications, then the applied biochar in no Removal), the applications by
 * delivery with matching swatches, and the GHG Statement once one includes the
 * batch. Every Removal mention links to the Removal; nothing here hovers.
 */
import Link from "next/link";
import { ArchiveIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { StatusBadge, type StatusValue } from "@/components/ui/status-badge";
import type { CreditBatchPageModel } from "@/data-access/credit-batch-page-model";
import { ghgStatementPeriodLabel } from "@/lib/credit-batches/ghg-statement-period-label";
import {
  REMOVAL_BAR_SEGMENT_ORDER,
  removalBarGroups,
  segmentForRemoval,
} from "@/lib/credit-batches/removal-bar";
import { ghgStatementDeepLinkHref } from "@/lib/ghg-statement-links";
import { cn } from "@/lib/utils";
import { useCreditBatchPage } from "./credit-batch-page-context";
import { FOCUS_RING, MUTED_TEXT, PagePanel, ROW_RULE } from "./credit-batch-page-parts";
import {
  DetailedRemovalBar,
  NotAppliedCaption,
  RemovalStatus,
  SegmentSwatch,
  removalHref,
  sliceLabel,
  sliceMeta,
  tonnesFromKg,
} from "./credit-batch-removal-bar";

type StatementKind = NonNullable<CreditBatchPageModel["milestones"]["ghgStatement"]>["status"];

/** The statement's badge, with the values the credit batch lifecycle rail uses for the same kinds. */
const STATEMENT_BADGES: Partial<Record<StatementKind, { status: StatusValue; label: string }>> = {
  "in-progress": { status: "running", label: "Updating" },
  draft: { status: "running", label: "Draft" },
  "in-registry": { status: "running", label: "In registry" },
  "pending-changes": { status: "pending", label: "Pending changes" },
  "in-verification": { status: "pending", label: "In verification" },
  verified: { status: "verified", label: "Verified" },
  issued: { status: "issued", label: "Issued" },
  "verification-failed": { status: "rejected", label: "Verification failed" },
  superseded: { status: "superseded", label: "Superseded" },
};

function DeliveryList({ model }: { model: CreditBatchPageModel }) {
  const { batch } = useCreditBatchPage();
  const rows = model.slices
    .filter((slice) => slice.dryKg > 0)
    .map((slice) => {
      const removal = model.removals.find((candidate) => candidate.id === slice.removalId) ?? null;
      return { slice, removal, segment: segmentForRemoval(removal) };
    })
    .sort((a, b) => REMOVAL_BAR_SEGMENT_ORDER.indexOf(a.segment) - REMOVAL_BAR_SEGMENT_ORDER.indexOf(b.segment));
  return (
    <PagePanel title="Applied biochar by delivery" labelledBy="credit-batch-deliveries">
      <ul className="flex flex-col">
        {rows.map(({ slice, segment, removal }) => (
          <li
            key={slice.applicationId}
            className={cn("grid grid-cols-[12px_minmax(0,1fr)_auto] gap-x-12 gap-y-4 py-12 sm:grid-cols-[12px_minmax(0,1fr)_auto_200px] sm:items-center sm:gap-x-16", ROW_RULE)}
          >
            <SegmentSwatch segment={segment} className="mt-4 sm:mt-0" />
            <span className="flex min-w-0 flex-col">
              <span className="body-medium font-medium break-words">{sliceLabel(slice)}</span>
              <span className={cn("body-caption", MUTED_TEXT)}>{sliceMeta(slice)}</span>
            </span>
            <span className="body-medium tabular-nums">{tonnesFromKg(slice.dryKg)}</span>
            <span className="col-start-2 col-end-4 sm:col-auto">
              {removal ? (
                <Link
                  href={removalHref(batch.facilityId, removal.id)}
                  className={cn("group inline-flex min-h-44 flex-wrap items-center gap-8", FOCUS_RING)}
                >
                  <span className="body-small font-medium underline-offset-2 group-hover:underline">{removal.code}</span>
                  <RemovalStatus removal={removal} />
                </Link>
              ) : (
                <span className={cn("body-small", MUTED_TEXT)}>Not in a Removal</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </PagePanel>
  );
}

function GhgStatementPanel({ model }: { model: CreditBatchPageModel }) {
  const { batch } = useCreditBatchPage();
  const statement = model.milestones.ghgStatement;
  if (!statement) return null;
  const badge = STATEMENT_BADGES[statement.status];
  return (
    <PagePanel title="GHG Statement" labelledBy="credit-batch-ghg-statement">
      <Link
        href={ghgStatementDeepLinkHref(statement.id, batch.facilityId)}
        className={cn("group flex min-h-44 flex-wrap items-center justify-between gap-12", FOCUS_RING)}
      >
        <span className="body-medium font-medium underline-offset-2 group-hover:underline">
          GHG Statement {ghgStatementPeriodLabel(statement)}
        </span>
        {badge && <StatusBadge status={badge.status} label={badge.label} />}
      </Link>
    </PagePanel>
  );
}

export function CreditBatchRemovalsTab() {
  const { batch, pageModel } = useCreditBatchPage();
  if (!pageModel) return null;
  const groups = removalBarGroups(pageModel);
  if (groups.length === 0) {
    return (
      <div className="border border-[var(--color-border-secondary)] bg-[var(--paper)]">
        <EmptyState
          padding="md"
          icon={<ArchiveIcon size={40} />}
          title="No applied biochar yet"
          description="Applications recorded from this credit batch's biochar appear here, grouped by Removal."
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-24">
      <PagePanel
        title="Biochar in Removals"
        labelledBy="credit-batch-removals"
        action={<span className="body-medium tabular-nums">{tonnesFromKg(pageModel.mass.appliedDryKg)} applied</span>}
      >
        <DetailedRemovalBar groups={groups} facilityId={batch.facilityId} />
        <NotAppliedCaption model={pageModel} />
      </PagePanel>
      <DeliveryList model={pageModel} />
      <GhgStatementPanel model={pageModel} />
    </div>
  );
}
