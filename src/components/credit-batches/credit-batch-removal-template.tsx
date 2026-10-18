/**
 * The credit batch's pinned Removal template, in its view sheet. Removals of
 * the batch compile against this pin, never the facility default, so a batch
 * with no pin (or a pin Isometric no longer lists) cannot be submitted until an
 * Owner or Admin switches it here.
 *
 * Readiness blockers deep-link to this block (`?focus=removal-template`), and
 * the shared focus target scrolls to it. The block says why the operator landed
 * here once: its own Notice when the pin is missing, else a neutral line.
 */
"use client";

import { useState } from "react";
import { ActionableFocusTarget } from "@/components/ui/actionable-focus-target";
import { Button } from "@/components/ui/button";
import { DetailField } from "@/components/ui/detail-panel";
import { Notice } from "@/components/ui/notice";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { useFacilityCertifierSummary, useIsometricProjectTemplates } from "@/hooks/use-certification";
import { useCreditBatch } from "@/hooks/use-credit-batches";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { REMOVAL_TEMPLATE_LANDING_LINE } from "@/lib/certification/removal-template-blockers";
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
}

export function CreditBatchRemovalTemplate({
  creditBatch: snapshot,
  canManage,
  locked,
  activeFocusTarget,
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

  const pinned = pinnedId ? templates.data?.find((template) => template.id === pinnedId) : undefined;
  const lookupSettled = !!projectId && templates.isSuccess;
  const pinnedMissing = !!pinnedId && lookupSettled && !pinned;
  const namePending = !!pinnedId && !pinned && !lookupSettled && !templates.isError && (summary.isLoading || templates.isLoading);
  const value = pinnedId ? pinned?.display_name ?? MISSING_VALUE.notAvailable : null;

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
          unavailableReason={summary.isSuccess && !projectId
            ? "Link this facility to an Isometric project in Certification settings first."
            : undefined}
        />
      )}
    </ActionableFocusTarget>
  );
}
