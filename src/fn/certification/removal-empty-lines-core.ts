import { emptyRemovalEmissionLines } from "@/lib/certification/removal-emission-lines";
import { requireEmissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { listEmissionEntriesForBatches } from "@/data-access/emission-entries";
import { getCertifierRemovalById } from "@/data-access/certifier-removals";
import type { OrgContext } from "@/lib/auth/server";
import { loadRemovalSubmissionContext } from "./certify-context-core";

/** The same context and contribution selection used by the submit gate. */
export async function loadRemovalEmptyLines(ctx: OrgContext, removalId: string) {
  requireEmissionsEntriesEnabled();
  const context = await loadRemovalSubmissionContext(ctx, removalId);
  const entries = await listEmissionEntriesForBatches(ctx, context.memberBatches.map((batch) => batch.id));
  const removal = await getCertifierRemovalById(ctx, removalId);
  const emptyLines = emptyRemovalEmissionLines(context.emissionLinesByBatchId ?? {});
  return { removalVersion: removal?.updatedAt.getTime() ?? null, batches: context.memberBatches.map((batch) => ({
    creditBatchId: batch.id, code: batch.code,
    lines: (emptyLines[batch.id] ?? [])
      .map((line) => ({ componentId: line.componentId, displayName: line.displayName, group: line.groupName, description: line.description })),
    zeros: entries.filter((entry) => entry.creditBatchId === batch.id && entry.kind === "zero" && entry.confirmedForRemovalId === removalId)
      .map((entry) => ({
        id: entry.id, componentId: entry.componentId, note: entry.note, authorId: entry.createdBy, createdAt: entry.createdAt,
        // The step lists a recorded zero by the component's name; a component retired from the template has none.
        displayName: context.emissionLinesByBatchId?.[batch.id]?.find((line) => line.componentId === entry.componentId)?.displayName ?? null,
      })),
  })) };
}
