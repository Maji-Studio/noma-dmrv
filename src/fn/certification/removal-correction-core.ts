import { loadBatchEmissionEntryFacts } from "@/data-access/emission-entry-facts";
import { logger } from "@/lib/log";
import type { OrgContext } from "@/lib/auth/server";
import { loadRemovalCorrectionFacts } from "@/data-access/removal-entry-correction";
import type { CoveredContenders } from "@/lib/certification/covered-contenders";
import { deriveEntryCorrection, buildRemovalCorrection, type EntryCorrectionState } from "@/lib/certification/removal-entry-correction";
import { compareRemovalCurrentContent } from "./removal-content-comparison-core";

/** Advisory projection inside the correction window; never authorizes mutations. */
export async function loadRemovalEntryCorrection(orgCtx: OrgContext, removalId: string, coveredContenders?: CoveredContenders): Promise<EntryCorrectionState> {
  const loaded = await loadRemovalCorrectionFacts(orgCtx, removalId, coveredContenders);
  if (!loaded) return deriveEntryCorrection(false, [], []);
  const { batches, correction, identity } = loaded;
  const comparison = await compareRemovalCurrentContent(orgCtx, removalId, loaded);
  const { state, observation } = comparison;
  const components = [...comparison.components];
  if (comparison.kind === "unavailable") {
    logger.warn({ removalId, reason: comparison.reason }, "Removal notice comparison failed");
  }
  // Historical names serve only the notice, never the locked statement guard.
  if (observation && state.changedPairs?.length) {
    const facts = await Promise.all(batches.map(batch => loadBatchEmissionEntryFacts(orgCtx, batch.id, observation)));
    components.push(...facts.flatMap(fact => [...fact.previousObservations.values()])
      .flatMap(item => item?.definition.groups.flatMap(group => group.components) ?? []));
  }
  return { ...state, removalId, removalCode: identity.code,
    correction: buildRemovalCorrection({ removalId, removalCode: identity.code, state,
      statement: { ...correction.returnedStatement!, reportingPeriodStartOn: identity.reportingPeriodStartOn,
        reportingPeriodEndOn: identity.reportingPeriodEndOn },
      batches: batches.map(({ id, code }) => ({ id, code })), components }),
  };
}
