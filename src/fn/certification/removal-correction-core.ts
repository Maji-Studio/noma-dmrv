import type { OrgContext } from "@/lib/auth/server";
import { loadRemovalCorrectionFacts } from "@/data-access/removal-entry-correction";
import type { EntryContender } from "@/lib/certification/removal-emission-contributions";
import { deriveEntryCorrection, buildRemovalCorrection, type EntryCorrectionState } from "@/lib/certification/removal-entry-correction";
import { compareRemovalCurrentContent } from "./removal-content-comparison-core";

/** Advisory projection inside the correction window; never authorizes mutations. */
export async function loadRemovalEntryCorrection(orgCtx: OrgContext, removalId: string, suppliedContenders?: EntryContender[]): Promise<EntryCorrectionState> {
  const loaded = await loadRemovalCorrectionFacts(orgCtx, removalId, suppliedContenders);
  if (!loaded) return deriveEntryCorrection(false, [], []);
  const { batches, correction, identity } = loaded;
  const { state, components } = await compareRemovalCurrentContent(orgCtx, removalId);
  return { ...state, removalId, removalCode: identity.code,
    correction: buildRemovalCorrection({ removalId, removalCode: identity.code, state,
      statement: { ...correction.returnedStatement!, reportingPeriodStartOn: identity.reportingPeriodStartOn,
        reportingPeriodEndOn: identity.reportingPeriodEndOn },
      batches: batches.map(({ id, code }) => ({ id, code })), components }),
  };
}
