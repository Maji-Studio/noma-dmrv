import { MASS_KG_STORAGE_DECIMALS } from "@/config/numeric-storage";
import type { OrgContext } from "@/lib/auth/server";
import { formatFacilityTime } from "@/lib/date-utils";
import { SafeError } from "@/lib/errors";
import { formatMassKg } from "@/lib/format-utils";
import {
  productionBatchMassUnitsMatch,
  type IsometricProductionBatch,
} from "@/lib/isometric/production-batches";
import type { Logger } from "@/lib/log";
import {
  compareProductionBatchFigures,
  type LegacyProductionBatchWindow,
} from "./production-batch-comparison";
import type { ProductionBatchSubmission } from "./production-batches";
import { markSubmissionRejectedBestEffort } from "./registry-create";
import {
  appendSyncEventBestEffort,
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
} from "./shared";

const DRIFT_TIMESTAMP_FORMAT = "yyyy-MM-dd HH:mm:ss";
const DRIFT_MILLISECOND_DIGITS = 3;
const DRIFT_TIME_ZONE = "UTC";

/** Called only when a registered batch's current payload hash has changed. */
export async function assertRegisteredProductionBatchMatches(args: {
  orgCtx: OrgContext;
  removalId: string;
  submissionRowId: string;
  expectedLockedAt?: Date;
  deferRejectionToAttempt?: boolean;
  submission: ProductionBatchSubmission;
  remote: IsometricProductionBatch;
  legacyWindow: LegacyProductionBatchWindow;
  log: Logger;
}): Promise<void> {
  const { remote, submission } = args;
  const current = submission.body;
  const matches = compareProductionBatchFigures(remote, current, args.legacyWindow);
  const differences: string[] = [];
  const describe = (label: string, registry: string, noma: string) => {
    differences.push(`${label}: Isometric ${registry}, noma ${noma}.`);
  };
  if (!matches.facility) describe("Facility mapping changed", remote.facility_id, current.facility_id);
  if (!matches.feedstocks) {
    describe("Feedstock types", [...remote.feedstock_type_ids].sort().join(", "), [...current.feedstock_type_ids].sort().join(", "));
  }
  if (!matches.kind) describe("Kind", remote.kind, current.kind);
  if (!matches.mass || !matches.massUnit) {
    describe("Dry mass", formatRegisteredMass(remote.mass), formatRegisteredMass(current.mass));
  }
  if (matches.window === "mismatch") {
    if (!matches.start) describe("Production window start", formatInstant(remote.started_at), formatInstant(current.started_at));
    if (!matches.end) describe("Production window end", formatInstant(remote.ended_at), formatInstant(current.ended_at));
  }

  const message = differences.length > 0
    ? `Credit batch ${submission.creditBatchCode} is already registered in Isometric with different figures than noma has now. ${differences.join(" ")} Check the production runs in this credit batch for edits made after the first submission. To fix it before finalization, delete this Removal, which also removes the records noma created in Isometric. Then submit again. Nothing is changed in Isometric automatically.`
    : null;
  args.log.warn(
    { creditBatchId: submission.creditBatchId, productionBatchId: remote.id },
    message
      ? "registered production batch differs from current batch figures; stopping submission"
      : "registered production batch differs from current batch data; reusing the registered record",
  );
  await appendSyncEventBestEffort(
    args.orgCtx,
    {
      provider: ISOMETRIC_PROVIDER,
      entityType: REMOVAL_ENTITY_TYPE,
      entityId: args.removalId,
      operation: `production-batch:drift:${submission.creditBatchId}`,
      status: message ? "failed" : "succeeded",
      requestPayload: current,
      responsePayload: { ...remote, reused: !message },
      ...(message ? { errorMessage: message } : {}),
    },
    { submissionId: args.submissionRowId },
  );
  if (message) {
    await markSubmissionRejectedBestEffort(args, message);
    throw new SafeError(message);
  }
}

function formatRegisteredMass(mass: { magnitude: number; unit: string }): string {
  if (productionBatchMassUnitsMatch(mass.unit, "kg")) {
    return formatMassKg(mass.magnitude, { digits: MASS_KG_STORAGE_DECIMALS });
  }
  return `${mass.magnitude.toLocaleString(undefined, { maximumFractionDigits: MASS_KG_STORAGE_DECIMALS })} ${mass.unit}`;
}

function formatInstant(value: string): string {
  const instant = new Date(value);
  return Number.isFinite(instant.getTime())
    ? `${formatFacilityTime(instant, DRIFT_TIME_ZONE, DRIFT_TIMESTAMP_FORMAT)}.${String(instant.getUTCMilliseconds()).padStart(DRIFT_MILLISECOND_DIGITS, "0")} +00:00`
    : value;
}
