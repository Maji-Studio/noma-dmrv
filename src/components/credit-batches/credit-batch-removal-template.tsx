/**
 * The credit batch's Removal template, read-only, in its view sheet. Removals of
 * the batch compile against it, so a batch with no template (or one Isometric
 * no longer lists) cannot be submitted until an Admin sets the facility's
 * Removal template in Settings. Nothing is changed here: the template reads as
 * a plain Batch details row, and only the notices below it link to Settings.
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
import { DECIDE_LINES_LINK_LABEL, SET_TEMPLATE_LINK_LABEL, removalTemplateSetupHref } from "@/lib/certification/links";
import { linesDecidedByAdmin, linesToDecideLabel } from "@/lib/certification/requirement-labels";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { ENTITY_FOCUS_TARGETS } from "@/lib/entity-deep-link";
import { DetailRow } from "./credit-batch-page-parts";
import { RawIdentifiers } from "@/components/certification/removal-template-mapping-view";

const NOTICE_LINK_CLASS = "inline-flex min-h-44 items-center gap-4 body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline";

export interface CreditBatchRemovalTemplateProps {
  creditBatch: Pick<CreditBatchWithRelations, "id" | "code" | "facilityId" | "version" | "removalTemplateId">;
  /** Admin. Everyone else reads the template. */
  canManage: boolean;
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
  /** Show the template as a Batch details row (the page's `<dl>` rows), not as a detail field. */
  asDetailRow?: boolean;
}

/** Why a credit batch with components to decide can't go into a Removal, and who decides them. */
export function linesToDecideNoticeText(count: number, canManage: boolean, inRemoval = false, readOnly = false): string {
  const lead = `${linesToDecideLabel(count)}, so this credit batch can't go into ${inRemoval ? "another" : "a"} Removal.`;
  if (canManage || readOnly) return lead;
  return `${lead} ${linesDecidedByAdmin(count)}`;
}

/** The batch's pinned template, its name (or why the name cannot be read) and whether the name is still loading. */
function useRemovalTemplateName(snapshot: Pick<CreditBatchWithRelations, "id" | "facilityId" | "removalTemplateId">) {
  // The sheet holds a snapshot; the template comes from the live record
  // so a change made in Settings shows without reopening the sheet.
  const live = useCreditBatch(snapshot.id);
  const batch = live.data ?? snapshot;
  const pinnedId = batch.removalTemplateId;
  const summary = useFacilityCertifierSummary(batch.facilityId);
  const projectId = summary.data?.mapping?.externalProjectId ?? null;
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
  return { batch, pinnedId, summary, pinned, pinnedMissing, namePending, reason, value: pinned?.display_name ?? reason };
}

/** An Admin's way to Settings from a notice about an unset or vanished template. */
function SetTemplateLink({ facilityId }: { facilityId: string }) {
  return (
    <Link href={removalTemplateSetupHref(facilityId)} className={NOTICE_LINK_CLASS}>
      {SET_TEMPLATE_LINK_LABEL}
    </Link>
  );
}

export function CreditBatchRemovalTemplate({
  creditBatch: snapshot,
  canManage,
  activeFocusTarget,
  linesToDecide: undecidedLines,
  inRemoval = false,
  readOnly = false,
  asDetailRow = false,
}: CreditBatchRemovalTemplateProps) {
  const { batch, pinnedId, summary, pinned, pinnedMissing, namePending, reason, value } = useRemovalTemplateName(snapshot);
  // Answering in Settings makes the picked template the facility's and switches every
  // open batch, so a kept batch on an older template gets text, not that link.
  const pinIsFacilityTemplate = summary.data?.mapping?.removalTemplateId === pinnedId;
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
      {asDetailRow ? (
        // Inside the focus target, so a deep link highlights the name with its notices.
        <dl className="flex flex-col">
          <DetailRow label="Removal template" value={pinned?.display_name ?? null} pending={namePending} emptyText={reason ?? MISSING_VALUE.notSet} />
        </dl>
      ) : (
        <DetailField
          label="Removal template"
          value={value}
          emptySituation="notSet"
          valuePresent={reason ? false : undefined}
          pending={namePending}
          className="min-w-0 flex-1"
        />
      )}

      {pinnedMissing && (
        <Notice tone="warning" action={canManage && !readOnly ? <SetTemplateLink facilityId={batch.facilityId} /> : undefined}>
          {readOnly
            ? "Template no longer exists in Isometric."
            : canManage
              ? "Template no longer exists in Isometric. Choose another Removal template in Settings."
              : "Template no longer exists in Isometric. Ask an Admin to change it."}
        </Notice>
      )}
      {!pinnedId && (
        <Notice tone="warning" action={canManage && !readOnly ? <SetTemplateLink facilityId={batch.facilityId} /> : undefined}>
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
              className={NOTICE_LINK_CLASS}
            >
              {DECIDE_LINES_LINK_LABEL}
            </Link>
          ) : undefined}
        >
          {linesToDecideNoticeText(linesToDecide, canManage, inRemoval, readOnly)}
        </Notice>
      )}
      {pinnedId && (
        <RawIdentifiers summary="Technical details" entries={[["Template", pinnedId]]} />
      )}

    </ActionableFocusTarget>
  );
}
