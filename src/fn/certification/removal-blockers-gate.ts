import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { describeFeedstockTypeMappingGap } from "@/lib/certification/feedstock-type-mapping";
import { legacyBlocker, type RemovalBlocker } from "@/lib/certification/removal-blockers";
import { REMOVAL_TEMPLATE_BLOCKERS, removalTemplateBlockerDestination, type RemovalTemplateBlockerCode } from "@/lib/certification/removal-template-blockers";
import { durabilityConfigurationBlockers } from "@/lib/certification/submission-readiness";
import { removalTemplateTierCompatibilityBlocker } from "@/lib/certification/removal-template-tier";
import type { RemovalSubmissionContext } from "./certify-context-types";
import { prepareRemovalSubmission, REMOVAL_PREPARATION_BLOCKERS, type RemovalPreparationBlocker } from "./removal-submission-prepare";
import { assertEntityReadinessGapsResolved, buildRemovalSubmissionBuild } from "./removal-submission-build";

function preparationBlocker(blocker: RemovalPreparationBlocker): RemovalBlocker {
  if (blocker.code === "noTemplate") {
    return { code: "unpinnedTemplate", message: blocker.message, fixTarget: "creditBatchTemplate" };
  }
  if (Object.hasOwn(REMOVAL_TEMPLATE_BLOCKERS, blocker.code)) {
    const code = blocker.code as RemovalTemplateBlockerCode;
    return { ...blocker, code, fixTarget: removalTemplateBlockerDestination(code) };
  }
  return legacyBlocker(blocker.message);
}

/** Pure over loaded facts. The prefix ends at submit's user-confirmation boundary. */
export function collectContextRemovalBlockers(
  ctx: RemovalSubmissionContext,
  options: { beforeConfirmation?: boolean } = {},
): RemovalBlocker[] {
  const blockers: RemovalBlocker[] = [];
  // Submit checks these before recovery. Review needs the same connection refusal.
  const preparation = prepareRemovalSubmission(ctx);
  if (!ctx.mapping || !ctx.hasOrgCredentials) return preparation.blockers.map(preparationBlocker);
  if (ctx.feedstockTypeMappingGaps.length) {
    blockers.push({ code: "feedstockTypeMapping", message: ctx.feedstockTypeMappingGaps.map(describeFeedstockTypeMappingGap).join(" "), fixTarget: "feedstockTypes" });
  }
  try {
    assertEntityReadinessGapsResolved(ctx.entityReadinessGaps);
  } catch (error) {
    if (!(error instanceof SafeError)) throw error;
    const targets = new Set(ctx.entityReadinessIssues?.map((issue) => issue.fixTarget));
    blockers.push({ code: "entityReadiness", message: error.message, fixTarget: targets.size === 1 ? [...targets][0] : null });
  }
  const { prepared } = preparation;
  if (!prepared) {
    blockers.push(...(preparation.blockers.length ? preparation.blockers.map(preparationBlocker) : [legacyBlocker(REMOVAL_PREPARATION_BLOCKERS.noTemplate, "creditBatchTemplate")]));
  } else {
    blockers.push(...preparation.blockers.filter((blocker) => blocker.code !== "durabilityUnavailable").map(preparationBlocker));
    const tierBlocker = removalTemplateTierCompatibilityBlocker(ctx, prepared.removalTemplate);
    if (tierBlocker) blockers.push({ code: "durabilityTier", message: tierBlocker, fixTarget: "creditBatchTemplate" });
    blockers.push(...preparation.blockers.filter((blocker) => blocker.code === "durabilityUnavailable").map(preparationBlocker));
    if (prepared.hasDurabilityComponents) {
      blockers.push(...durabilityConfigurationBlockers(ctx.batchesWithSamples).map((message) => ({ code: "durabilityConfiguration" as const, message, fixTarget: "batchDetails" as const })));
    }
  }
  if (options.beforeConfirmation) return blockers;
  if (!ctx.memberBatches.length) blockers.push(legacyBlocker("This Removal has no credit batches.", "batchDetails"));
  if (!ctx.batchesWithSamples[0]?.durabilityOption) blockers.push({ code: "durabilityTier", message: "Facility durability tier could not be resolved. Reload and retry.", fixTarget: "certificationTemplates" });
  return blockers;
}

/** No mutation: the build gets an explicit empty Source set and is discarded. */
export async function evaluateRemovalBlockers(args: {
  orgCtx: OrgContext;
  removalId: string;
  ctx: RemovalSubmissionContext;
}): Promise<RemovalBlocker[]> {
  const blockers = collectContextRemovalBlockers(args.ctx);
  // Earlier failures invalidate the build's prerequisites or already refuse
  // this attempt. Keep its existing first-failure semantics only on a clear prefix.
  if (blockers.length) return blockers;
  const { prepared } = prepareRemovalSubmission(args.ctx);
  if (!prepared) return [legacyBlocker(REMOVAL_PREPARATION_BLOCKERS.noTemplate, "creditBatchTemplate")];
  try {
    await buildRemovalSubmissionBuild({ ...args, prepared, sourceIds: [] });
  } catch (error) {
    if (!(error instanceof SafeError)) throw error;
    const lineage = args.ctx.submissionLineageBlockers;
    // The build joins exactly these details for its lineage refusal. Other
    // build errors must never inherit an unrelated lineage repair target.
    const matchingLineage = lineage?.filter((blocker) => blocker.detail === error.message);
    const matchesAggregate = lineage?.length && error.message === `Removal submission blocked:\n${lineage.map((blocker) => blocker.detail).join("\n")}`;
    const targets = new Set((matchesAggregate ? lineage : matchingLineage)?.map((blocker) => blocker.fixTarget));
    blockers.push(legacyBlocker(error.message, targets.size === 1 ? [...targets][0] : null));
  }
  return blockers;
}
