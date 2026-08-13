import { formatFacilityDate, formatUtcDate } from "@/lib/date-utils";
import {
  CURRENT_1000_YEAR_PREVIEW_FORMULA_VERSION,
  computeBlueprint1000YearDurability,
} from "@/lib/calculations/biochar-removal";
import {
  buildPerBatchDurabilityData,
  type CreditBatchDurabilityInput,
} from "@/lib/isometric/utils/durability-aggregation";
import {
  CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
  DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR,
} from "@/lib/isometric/transformers/measurement-sample";
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
  componentKey?: string;
}

export const LEGACY_1000_YEAR_PREVIEW_FORMULA_VERSION =
  "isometric-1000-year-total-carbon-binomial-lower-uncapped-v1";

export const CURRENT_1000_YEAR_SEMANTICS_LABEL =
  "Current organic-carbon basis with durability bounded from 0 to 0.95";
export const LEGACY_1000_YEAR_SEMANTICS_LABEL =
  "Legacy total-carbon basis with uncapped durability";

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
    sample.inorganicCarbonPercent == null ||
    !Number.isFinite(sample.inorganicCarbonPercent) ||
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
    totalCarbonFraction: sample.totalCarbonPercent / 100,
    inorganicCarbonFraction: sample.inorganicCarbonPercent / 100,
    calculatedOrganicCarbonFraction:
      (sample.totalCarbonPercent - sample.inorganicCarbonPercent) / 100,
    sFraction: sample.sReflectanceFraction,
  };
}

function buildLegacyReplicate(
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
  const measuredInorganic =
    sample.inorganicCarbonPercent != null &&
    Number.isFinite(sample.inorganicCarbonPercent)
      ? sample.inorganicCarbonPercent / 100
      : null;
  return {
    ref: `R${index + 1}`,
    sampleCode: sample.sampleCode,
    samplingDay: samplingDay(sample.samplingTime, facilityTimezone),
    labName: sample.labName ?? null,
    totalCarbonFraction: sample.totalCarbonPercent / 100,
    inorganicCarbonFraction: measuredInorganic,
    calculatedOrganicCarbonFraction:
      measuredInorganic == null
        ? null
        : sample.totalCarbonPercent / 100 - measuredInorganic,
    sFraction: sample.sReflectanceFraction,
  };
}

function legacyDurability(replicates: ThousandYearLedgerReplicate[]): number {
  const meanS =
    replicates.reduce((sum, replicate) => sum + replicate.sFraction, 0) /
    replicates.length;
  return (
    meanS -
    Math.sqrt((meanS * (1 - meanS)) / replicates.length)
  );
}

export function buildThousandYearDurabilityLedgerModel(
  args: BuildThousandYearDurabilityLedgerModelArgs,
): ThousandYearDurabilityLedgerModel {
  const componentKey =
    args.componentKey ?? CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR;
  const isLegacy =
    componentKey === DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR;
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
          isLegacy
            ? buildLegacyReplicate(sample, index, batch.facilityTimezone)
            : buildReplicate(sample, index, batch.facilityTimezone),
        )
        .filter(
          (replicate): replicate is ThousandYearLedgerReplicate =>
            replicate !== null,
        );
      if (replicates.length === 0) return null;
      const currentDurability = isLegacy
        ? null
        : computeBlueprint1000YearDurability(
            replicates.map((replicate) => ({
              totalCarbonPercent: replicate.totalCarbonFraction * 100,
              inorganicCarbonPercent:
                (replicate.inorganicCarbonFraction ?? Number.NaN) * 100,
              sReflectanceFraction: replicate.sFraction,
            })),
          );
      if (!isLegacy && !currentDurability) return null;
      const rawDurability = isLegacy
        ? legacyDurability(replicates)
        : currentDurability!.rawDurability;
      return {
        creditBatchId: batch.creditBatchId,
        creditBatchCode: batch.creditBatchCode,
        replicates,
        replicateCount: replicates.length,
        productMassKg: productMassByBatchId.get(batch.creditBatchId) ?? 0,
        componentKey,
        componentLabel: isLegacy
          ? "Legacy 1,000-year durability component"
          : "Current 1,000-year durability component",
        formulaVersion: isLegacy
          ? LEGACY_1000_YEAR_PREVIEW_FORMULA_VERSION
          : CURRENT_1000_YEAR_PREVIEW_FORMULA_VERSION,
        formulaLabel: isLegacy
          ? "Binomial lower estimate without a durability cap"
          : "Organic-carbon binomial lower estimate bounded from 0 to 0.95",
        semanticsLabel: isLegacy
          ? LEGACY_1000_YEAR_SEMANTICS_LABEL
          : CURRENT_1000_YEAR_SEMANTICS_LABEL,
        rawDurability,
        cappedDurability: isLegacy
          ? rawDurability
          : currentDurability!.cappedDurability,
        capApplied: isLegacy ? false : currentDurability!.capApplied,
      };
    })
    .filter((batch) => batch !== null);

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
