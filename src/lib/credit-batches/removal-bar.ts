/**
 * The Removals bar on the credit batch page measures **applied dry mass**
 * (epic #1136): one group per Removal, submitted first, then drafts, split
 * into the applications it holds, then the applied biochar in no Removal.
 * Biochar produced but not applied yet is a caption under the bar, never a
 * segment. Figures are dry kg from the page model's persisted slices.
 */
import type { CreditBatchPageModel } from "@/data-access/credit-batch-page-model";
import { MIN_VISIBLE_NOT_APPLIED_DRY_KG } from "./open-items";

export type RemovalBarSegment = "submitted" | "draft" | "notInRemoval";

export const REMOVAL_BAR_SEGMENT_ORDER: readonly RemovalBarSegment[] = ["submitted", "draft", "notInRemoval"];

export type RemovalBarRemoval = CreditBatchPageModel["removals"][number];
export type RemovalBarSlice = CreditBatchPageModel["slices"][number];

export interface RemovalBarPart {
  /** The application slice id (application id). */
  id: string;
  slice: RemovalBarSlice;
  dryKg: number;
}

export interface RemovalBarGroup {
  /** The Removal id, or `not-in-removal`. */
  id: string;
  segment: RemovalBarSegment;
  removal: RemovalBarRemoval | null;
  dryKg: number;
  parts: RemovalBarPart[];
}

export const NOT_IN_REMOVAL_GROUP_ID = "not-in-removal";

function segmentOf(removal: RemovalBarRemoval): RemovalBarSegment {
  return removal.phase === "submitted" ? "submitted" : "draft";
}

function partsOf(slices: readonly RemovalBarSlice[]): RemovalBarPart[] {
  return slices
    .filter((slice) => slice.dryKg > 0)
    .map((slice) => ({ id: slice.applicationId, slice, dryKg: slice.dryKg }));
}

/** Groups in bar order. Empty groups (a Removal holding no dry mass here) are left out. */
export function removalBarGroups(model: CreditBatchPageModel): RemovalBarGroup[] {
  const groups: RemovalBarGroup[] = model.removals.map((removal) => ({
    id: removal.id,
    segment: segmentOf(removal),
    removal,
    dryKg: removal.dryKg,
    parts: partsOf(model.slices.filter((slice) => slice.removalId === removal.id)),
  }));
  // Stable sort keeps the model's creation order inside each segment.
  groups.sort((a, b) => REMOVAL_BAR_SEGMENT_ORDER.indexOf(a.segment) - REMOVAL_BAR_SEGMENT_ORDER.indexOf(b.segment));
  if (model.mass.notInRemovalDryKg > 0) {
    groups.push({
      id: NOT_IN_REMOVAL_GROUP_ID,
      segment: "notInRemoval",
      removal: null,
      dryKg: model.mass.notInRemovalDryKg,
      parts: partsOf(model.slices.filter((slice) => slice.removalId === null)),
    });
  }
  return groups.filter((group) => group.dryKg > 0);
}

/**
 * The Overview shows its Removals panel once the batch holds a Removal, or
 * once it is ready (nothing blocking) and has applied biochar to put in one.
 */
export function showOverviewRemovals(model: CreditBatchPageModel | undefined, blockingCount: number | null): boolean {
  if (!model) return false;
  if (model.removals.length > 0) return true;
  return blockingCount === 0 && model.mass.appliedDryKg > 0;
}

/** Produced but not applied yet, for the caption under the bar; null below the visible threshold. */
export function notAppliedCaptionKg(model: CreditBatchPageModel): number | null {
  const kg = model.mass.notAppliedDryKg;
  return kg != null && kg >= MIN_VISIBLE_NOT_APPLIED_DRY_KG ? kg : null;
}
