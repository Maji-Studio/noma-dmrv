/**
 * The credit batch's Removal template, read-only, in its view sheet. Removals of
 * the batch compile against it, so a batch with no template (or one Isometric
 * no longer lists) cannot be submitted until an Admin sets the facility's
 * Removal template in Settings. Nothing is changed here: the link goes to the
 * setup, which switches every credit batch whose Removal is not sent.
 *
 * Readiness blockers deep-link to this block (`?focus=removal-template`), and
 * the shared focus target scrolls to it. The block says why the operator landed
 * here once: its own Notice when the pin is missing, else a neutral line.
 *
 * While the pinned template has components to decide, every role sees it here with
 * the count the Components decided check uses (#1201); Admins also get an
 * "Answer in Settings" link to the setup's Check step with this template picked,
 * unless the batch was kept on an older template than the facility's (see
 * docs/open-questions.md, "Answering components for a kept batch's older template").
 */
"use client";

import Link from "next/link";
import { ActionableFocusTarget } from "@/components/ui/actionable-focus-target";
import { DetailField } from "@/components/ui/detail-panel";
import { Notice } from "@/components/ui/notice";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { useFacilityCertifierSummary, useIsometricProjectTemplates } from "@/hooks/use-certification";
import { useCreditBatch } from "@/hooks/use-credit-batches";
import { LOAD_FAILED, NOT_FOUND_ON_ISOMETRIC } from "@/lib/copy-utils";
import { REMOVAL_TEMPLATE_LANDING_LINE } from "@/lib/certification/removal-template-blockers";
import { DECIDE_LINES_LINK_LABEL, removalTemplateSetupHref } from "@/lib/certification/links";
import { linesDecidedByAdmin, linesToDecideLabel } from "@/lib/certification/requirement-labels";
import { ENTITY_FOCUS_TARGETS } from "@/lib/entity-deep-link";
import { RawIdentifiers } from "@/components/certification/removal-template-mapping-view";

export interface CreditBatchRemovalTemplateProps {
  creditBatch: Pick<CreditBatchWithRelations, "id" | "code" | "facilityId" | "version" | "removalTemplateId">;
  /** Admin. Everyone else reads the template. */
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
  /** A read-only batch states the fact alone, with no instruction to fix it. */
  readOnly?: boolean;
}

/** Why a credit batch with components to decide can't go into a Removal, and who decides them. */
export function linesToDecideNoticeText(count: number, canManage: boolean, inRemoval = false): string {
  const lead = `${linesToDecideLabel(count)}, so this credit batch can't go into ${inRemoval ? "another" : "a"} Removal.`;
  if (canManage) return lead;
  return `${lead} ${linesDecidedByAdmin(count)}`;
}

const CHANGE_IN_SETTINGS_LABEL = "Change in Settings";

export function CreditBatchRemovalTemplate({
  creditBatch: snapshot,
  canManage,
  locked,
  activeFocusTarget,
  linesToDecide: undecidedLines,
  inRemoval = false,
  readOnly = false,
}: CreditBatchRemovalTemplateProps) {
  // The sheet holds a snapshot; the template comes from the live record
  // so a change made in Settings shows without reopening the sheet.
  const live = useCreditBatch(snapshot.id);
  const batch = live.data ?? snapshot;
  const pinnedId = batch.removalTemplateId;
  const summary = useFacilityCertifierSummary(batch.facilityId);
  const projectId = summary.data?.mapping?.externalProjectId ?? null;
  // Answering in Settings makes the picked template the facility's and switches every
  // open batch, so a kept batch on an older template gets text, not that link.
  const pinIsFacilityTemplate = summary.data?.mapping?.removalTemplateId === pinnedId;
  const templates = useIsometricProjectTemplates(pinnedId ? projectId : null);

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
          <Link
            href={removalTemplateSetupHref(batch.facilityId)}
            className="inline-flex min-h-44 items-center body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
          >
            {CHANGE_IN_SETTINGS_LABEL}
          </Link>
        )}
      </div>

      {pinnedMissing && (
        <Notice tone="warning">
          {readOnly
            ? "Template no longer exists in Isometric."
            : canManage
              ? "Template no longer exists in Isometric. Choose another Removal template in Settings."
              : "Template no longer exists in Isometric. Ask an Admin to change it."}
        </Notice>
      )}
      {!pinnedId && (
        <Notice tone="warning">
          {readOnly
            ? "This credit batch has no Removal template."
            : canManage
              ? "Set a Removal template in Settings before adding this credit batch to a Removal."
              : "This credit batch has no Removal template. Ask an Admin to set one."}
        </Notice>
      )}
      {linesToDecide > 0 && pinnedId && (
        <Notice
          tone="warning"
          action={canManage && pinIsFacilityTemplate ? (
            <Link
              href={removalTemplateSetupHref(batch.facilityId, { templateId: pinnedId, step: "check" })}
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

    </ActionableFocusTarget>
  );
}
