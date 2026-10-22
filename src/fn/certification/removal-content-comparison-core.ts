import { z } from "zod";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { getSentRemovalForComparison } from "@/data-access/removal-entry-correction";
import { getCreditBatchesByRemovalId } from "@/data-access/certifier-removals";
import { getLatestTemplateObservation, getTemplateObservationById } from "@/data-access/removal-template-observations";
import type { RemovalTemplateObservation } from "@/db/schema/removal-template-observations";
import { entryInputManifestSchema } from "@/lib/certification/removal-emission-contributions";
import type { EntryCorrectionState, RemovalComparisonReason } from "@/lib/certification/removal-entry-correction";
import { deriveRemovalSemanticCorrection } from "@/lib/certification/removal-semantic-correction";
import { RemovalComparisonBlockedError } from "./removal-comparison-blocked-error";
import { compileRemovalCorrectionContent } from "./removal-correction-compile-core";
import { RESUBMIT_NEEDED_LABEL, comparisonUnavailableClause } from "@/lib/removal-correction-copy";

const snapshotSchema = z.object({ semantic: z.record(z.string(), z.unknown()), templateObservationId: z.string().optional() });
const entriesSchema = z.array(entryInputManifestSchema);
type ComparisonFacts = {
  submitted: Awaited<ReturnType<typeof getSentRemovalForComparison>>;
  batches: Awaited<ReturnType<typeof getCreditBatchesByRemovalId>>;
};
type ComparisonDetails = { state: EntryCorrectionState; observation?: RemovalTemplateObservation; components: { id: string; displayName: string }[] };
export type RemovalContentComparison = ComparisonDetails & (
  | { kind: "changed" }
  | { kind: "unchanged" }
  | { kind: "unavailable"; reason: RemovalComparisonReason; unavailableMessages: string[] }
);

/** One DB-only comparison, independent of display eligibility. Authorization callers
 * must hold withGhgVerifierSubmissionLock through provider I/O. Unexpected failures
 * propagate; callers must never log their messages or bodies.
 */
export async function compareRemovalCurrentContent(ctx: OrgContext, removalId: string, facts?: ComparisonFacts): Promise<RemovalContentComparison> {
  const batches = facts ? facts.batches : await getCreditBatchesByRemovalId(ctx, removalId);
  const batchIds = batches.map(batch => batch.id);
  let previous: Record<string, unknown> = {};
  let componentIds: string[] = [];
  const components: ComparisonDetails["components"] = [];
  const unavailable = (reason: RemovalComparisonReason, unavailableMessages: string[] = []): RemovalContentComparison => ({
    kind: "unavailable", reason, unavailableMessages, components,
    state: { ...deriveRemovalSemanticCorrection({ windowOpen: true, previous, current: null,
      previousEntries: [], currentEntries: [], componentIds, batchIds }),
      comparison: "unavailable", unavailableReason: reason, unavailableMessages,
      message: `${RESUBMIT_NEEDED_LABEL}: ${comparisonUnavailableClause("this Removal")}.`,
    },
  });
  const sent = facts ? facts.submitted : await getSentRemovalForComparison(ctx, removalId);
  const snapshot = snapshotSchema.safeParse(sent?.payloadSnapshot);
  if (!snapshot.success) return unavailable("invalid_snapshot");
  previous = snapshot.data.semantic;
  const previousEntries = entriesSchema.safeParse(previous.entryContributions ?? []);
  if (!previousEntries.success) return unavailable("invalid_snapshot");
  // Keep the sent template stable. Legacy snapshots predate observation IDs.
  const pin = batches[0]?.removalTemplateId;
  const observation = snapshot.data.templateObservationId
    ? await getTemplateObservationById(ctx, snapshot.data.templateObservationId)
    : pin ? await getLatestTemplateObservation(ctx, "isometric", pin) : null;
  if (!observation) return unavailable("missing_observation");
  components.push(...observation.definition.groups.flatMap(group => group.components));
  componentIds = components.map(component => component.id);
  let current: Record<string, unknown> | null;
  try {
    current = await compileRemovalCorrectionContent(ctx, removalId, observation);
  } catch (error) {
    if (error instanceof RemovalComparisonBlockedError) return unavailable("compile_refused", error.messages);
    if (error instanceof SafeError) return unavailable("compile_refused", [error.message]);
    if (error instanceof z.ZodError) return unavailable("invalid_compile");
    throw error;
  }
  if (!current) return unavailable("invalid_compile");
  const currentEntries = entriesSchema.safeParse(current.entryContributions ?? []);
  if (!currentEntries.success) return unavailable("invalid_compile");
  const state = deriveRemovalSemanticCorrection({ windowOpen: true, previous, current,
    previousEntries: previousEntries.data, currentEntries: currentEntries.data, componentIds, batchIds });
  const kind = state.correctionNeeded ? "changed" : "unchanged";
  return { kind, state: { ...state, comparison: kind, unavailableMessages: [] }, components, observation };
}
