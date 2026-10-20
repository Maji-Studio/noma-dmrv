/**
 * The credit batch's pinned Removal template, in its view sheet. Removals of
 * the batch compile against this pin, never the facility default, so a batch
 * with no pin (or a pin Isometric no longer lists) cannot be submitted until an
 * Owner or Admin switches it here.
 *
 * Readiness blockers deep-link to this block (`?focus=removal-template`), and
 * the shared focus target scrolls to it. The block says why the operator landed
 * here once: its own Notice when the pin is missing, else a neutral line.
 *
 * While the pinned template has components to decide, every role sees it here with
 * the count the Components decided check uses (#1201); Owners and Admins also get
 * the link to decide them.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { ActionableFocusTarget } from "@/components/ui/actionable-focus-target";
import { Button } from "@/components/ui/button";
import { DetailField } from "@/components/ui/detail-panel";
import { Notice } from "@/components/ui/notice";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { useFacilityCertifierSummary, useIsometricProjectTemplates } from "@/hooks/use-certification";
import { useCreditBatch } from "@/hooks/use-credit-batches";
import { useRemovalTemplateReview } from "@/hooks/use-removal-template-review";
import { templateReadiness } from "@/components/certification/removal-template-review-model";
import { LOAD_FAILED, NOT_FOUND_ON_ISOMETRIC } from "@/lib/copy-utils";
import { REMOVAL_TEMPLATE_LANDING_LINE } from "@/lib/certification/removal-template-blockers";
import { DECIDE_LINES_LINK_LABEL, removalTemplateSetupHref } from "@/lib/certification/links";
import { linesDecidedByOwnerOrAdmin, linesToDecideLabel } from "@/lib/certification/requirement-labels";
import { ENTITY_FOCUS_TARGETS } from "@/lib/entity-deep-link";
import { RawIdentifiers } from "@/components/certification/removal-template-mapping-view";
import { CreditBatchTemplateSwitchDialog } from "./credit-batch-template-switch-dialog";

export interface CreditBatchRemovalTemplateProps {
  creditBatch: Pick<CreditBatchWithRelations, "id" | "code" | "facilityId" | "version" | "removalTemplateId">;
  /** Owner or Admin. Everyone else reads the pin. */
  canManage: boolean;
  /** A submitted Removal holds the batch, so its definition is locked. */
  locked: boolean;
  /** The deep-link focus target, when this sheet was opened by one. */
  activeFocusTarget?: string | null;
  /**
   * The batch's Components decided count (`batchLinesToDecide`), from the health the
   * page or the list already loads; 0 when none or not loaded yet.
   */
  linesToDecide: number;
  /** A Removal already holds biochar from this batch, so a further one is what waits. */
  inRemoval?: boolean;
}

/**
 * Why a credit batch with components to decide can't go into a Removal, and who
 * decides them. Owners and Admins get the Decide components link instead of the
 * second sentence.
 */
export function linesToDecideNoticeText(count: number, canManage: boolean, inRemoval = false): string {
  const lead = `${linesToDecideLabel(count)}, so this credit batch can't go into ${inRemoval ? "another" : "a"} Removal.`;
  if (canManage) return lead;
  return `${lead} ${linesDecidedByOwnerOrAdmin(count)}`;
}

export function CreditBatchRemovalTemplate({
  creditBatch: snapshot,
  canManage,
  locked,
  activeFocusTarget,
  linesToDecide: undecidedLines,
  inRemoval = false,
}: CreditBatchRemovalTemplateProps) {
  const [switching, setSwitching] = useState(false);
  // The sheet holds a snapshot; the pin and version come from the live record
  // so a switch (or a refused stale switch) shows without reopening the sheet.
  const live = useCreditBatch(snapshot.id);
  const batch = live.data ?? snapshot;
  const pinnedId = batch.removalTemplateId;
  const summary = useFacilityCertifierSummary(batch.facilityId);
  const projectId = summary.data?.mapping?.externalProjectId ?? null;
  const needsTemplates = !!pinnedId || switching;
  const templates = useIsometricProjectTemplates(needsTemplates ? projectId : null);
  // Readiness comes from Removal templates, read only while the dialog is open.
  const review = useRemovalTemplateReview(batch.facilityId, switching && canManage, { fresh: true });
  const readiness = review.data
    ? new Map(review.data.map((entry) => [entry.templateId, templateReadiness(entry)]))
    : undefined;

  const pinned = pinnedId ? templates.data?.find((template) => template.id === pinnedId) : undefined;
  const lookupSettled = !!projectId && templates.isSuccess;
  const pinnedMissing = !!pinnedId && lookupSettled && !pinned;
  const namePending = !!pinnedId && !pinned && !lookupSettled && !templates.isError && (summary.isLoading || templates.isLoading);
  // A pin whose name cannot be read says why: gone from Isometric, a failed
  // lookup, or no project to look it up in. Null while the name loads.
  const reason = !pinnedId || pinned
    ? null
    : pinnedMissing
      ? NOT_FOUND_ON_ISOMETRIC
      : templates.isError || summary.isError
        ? LOAD_FAILED
        : summary.isSuccess && !projectId
          ? "No Isometric project linked"
          : null;
  const value = pinned?.display_name ?? reason;
  const linesToDecide = pinnedId && !pinnedMissing ? undecidedLines : 0;

  // The two Notices below already say why an unpinned or vanished pin needs
  // attention, so the focus callout stays quiet there rather than repeat them.
  const landingLabel = !pinnedId || pinnedMissing ? null : REMOVAL_TEMPLATE_LANDING_LINE;

  return (
    <ActionableFocusTarget
      target={ENTITY_FOCUS_TARGETS.removalTemplate}
      activeTarget={activeFocusTarget}
      actionLabel={landingLabel}
      className="flex flex-col gap-12"
    >
      <div className="flex flex-wrap items-start justify-between gap-12">
        <DetailField
          label="Removal template"
          value={value}
          emptySituation="notSet"
          valuePresent={reason ? false : undefined}
          pending={namePending}
          className="min-w-0 flex-1"
        />
        {canManage && !locked && (
          <Button size="small" variant="default" onClick={() => setSwitching(true)}>
            {pinnedId ? "Switch template" : "Set template"}
          </Button>
        )}
      </div>

      {pinnedMissing && (
        <Notice tone="warning">
          {canManage
            ? "Template no longer exists in Isometric. Switch to another Removal template."
            : "Template no longer exists in Isometric. Ask an Owner or Admin to switch it."}
        </Notice>
      )}
      {!pinnedId && (
        <Notice tone="warning">
          {canManage
            ? "Choose a Removal template for this credit batch before adding it to a Removal."
            : "This credit batch has no Removal template. Ask an Owner or Admin to choose one."}
        </Notice>
      )}
      {linesToDecide > 0 && pinnedId && (
        <Notice
          tone="warning"
          action={canManage ? (
            <Link
              href={removalTemplateSetupHref(batch.facilityId, { templateId: pinnedId, step: "decisions", makeDefault: false })}
              className="inline-flex min-h-44 items-center gap-4 body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
            >
              {DECIDE_LINES_LINK_LABEL}
            </Link>
          ) : undefined}
        >
          {linesToDecideNoticeText(linesToDecide, canManage, inRemoval)}
        </Notice>
      )}
      {pinnedId && (
        <RawIdentifiers summary="Technical details" entries={[["Template", pinnedId]]} />
      )}

      {canManage && (
        <CreditBatchTemplateSwitchDialog
          isOpen={switching}
          onClose={() => setSwitching(false)}
          onStale={() => void live.refetch()}
          creditBatch={batch}
          defaultTemplateId={summary.data?.mapping?.defaultRemovalTemplateId ?? null}
          templates={templates.data}
          templatesLoading={summary.isLoading || templates.isLoading}
          templatesError={templates.error}
          readiness={readiness}
          readinessLoading={review.isLoading}
          readinessError={review.isError && !review.data}
          onRetryReadiness={() => void review.refetch()}
          unavailableReason={summary.isSuccess && !projectId
            ? "Link this facility to an Isometric project in Certification settings first."
            : undefined}
        />
      )}
    </ActionableFocusTarget>
  );
}
