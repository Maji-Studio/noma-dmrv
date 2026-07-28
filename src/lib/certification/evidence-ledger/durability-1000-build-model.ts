import { formatFacilityDate, formatUtcDate } from "@/lib/date-utils";
import {
  buildPerBatchDurabilityData,
  type CreditBatchDurabilityInput,
} from "@/lib/isometric/utils/durability-aggregation";
import type {
  ThousandYearDurabilityLedgerModel,
  ThousandYearLedgerReplicate,
} from "./durability-types";

export interface BuildThousandYearDurabilityLedgerModelArgs {
  batches: (CreditBatchDurabilityInput & {
    facilityTimezone?: string | null;
  })[];
  attributionByRunId: Map<string, number>;
  memberBatchCodes: string | null;
  facilityName: string | null;
  externalProjectId: string | null;
  generatedAtIso: string;
}

function samplingDay(
  value: unknown,
  facilityTimezone: string | null | undefined,
): string | null {
  const parsed =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  return facilityTimezone
    ? formatFacilityDate(parsed, facilityTimezone)
    : formatUtcDate(parsed);
}

function buildReplicate(
  sample: CreditBatchDurabilityInput["samples"][number],
  index: number,
  facilityTimezone: string | null | undefined,
): ThousandYearLedgerReplicate | null {
  if (
    sample.totalCarbonPercent == null ||
    !Number.isFinite(sample.totalCarbonPercent) ||
    sample.sReflectanceFraction == null ||
    !Number.isFinite(sample.sReflectanceFraction)
  ) {
    return null;
  }
  return {
    ref: `R${index + 1}`,
    sampleCode: sample.sampleCode,
    samplingDay: samplingDay(sample.samplingTime, facilityTimezone),
    labName: sample.labName ?? null,
    carbonContentFraction: sample.totalCarbonPercent / 100,
    sFraction: sample.sReflectanceFraction,
  };
}

export function buildThousandYearDurabilityLedgerModel(
  args: BuildThousandYearDurabilityLedgerModelArgs,
): ThousandYearDurabilityLedgerModel {
  const productMassByBatchId = new Map(
    buildPerBatchDurabilityData(args.batches, args.attributionByRunId).map(
      (batch) => [batch.creditBatchId, batch.productMassKg],
    ),
  );
  const batches = args.batches
    .map((batch) => {
      const orderedSamples = [...batch.samples].sort((left, right) =>
        String(left.id).localeCompare(String(right.id)),
      );
      const replicates = orderedSamples
        .map((sample, index) =>
          buildReplicate(sample, index, batch.facilityTimezone),
        )
        .filter(
          (replicate): replicate is ThousandYearLedgerReplicate =>
            replicate !== null,
        );
      return {
        creditBatchId: batch.creditBatchId,
        creditBatchCode: batch.creditBatchCode,
        replicates,
        replicateCount: replicates.length,
        productMassKg: productMassByBatchId.get(batch.creditBatchId) ?? 0,
      };
    })
    .filter((batch) => batch.replicateCount > 0);

  return {
    memberBatchCodes: args.memberBatchCodes,
    facilityName: args.facilityName,
    externalProjectId: args.externalProjectId,
    generatedAtIso: args.generatedAtIso,
    batches,
    totalReplicates: batches.reduce(
      (total, batch) => total + batch.replicateCount,
      0,
    ),
  };
}
