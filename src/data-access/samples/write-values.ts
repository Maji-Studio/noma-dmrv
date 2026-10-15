/**
 * The values a lab Sample write stores, shared by create and update: the
 * request fields, their column mapping, and the derived ratios and entry
 * warnings computed from the effective row.
 */

import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { getBatchesWithLabReports } from "../sample-document-evidence";
import { requireOrgScope } from "../utils";
import type { samples } from "@/db/schema";
import { deriveSampleRatios, type SampleRatioNotice } from "@/lib/calculations/sample-ratios";
import { sampleEntryWarnings } from "@/lib/certification/sample-entry-warnings";
import type { EventInstant } from "@/schemas/event-instant";
import type { SampleWithRelations } from "./sample-by-id";
import type { LockedSampleBatch, SampleBatchFacility } from "./write-scope";

/** The optional measured and recorded fields; `null` stores empty. */
export interface SampleOptionalFields {
  labName?: string | null;
  labAccreditation?: string | null;
  analysisDate?: Date | null;
  weightGrams?: number | null;
  volumeMl?: number | null;
  inorganicCarbonPercent?: number | null;
  totalHydrogenPercent?: number | null;
  totalNitrogenPercent?: number | null;
  totalOxygenPercent?: number | null;
  totalSulfurPercent?: number | null;
  ashContentPercent?: number | null;
  moistureContentPercent?: number | null;
  bulkDensityKgPerM3?: number | null;
  ph?: number | null;
  saltContentGPerKg?: number | null;
  /** A lab O/C_org, stored only when the Sample has no oxygen figure (round 7 Q50). */
  oToCOrgRatio?: number | null;
  randomReflectanceR0Percent?: number | null;
  sReflectanceFraction?: number | null;
  r0MeasurementCount?: number | null;
  r0AnalysisDate?: Date | null;
  r0HistogramFileUrl?: string | null;
  reactiveCarbonPercent?: number | null;
  residualCarbonPercent?: number | null;
  tgaAnalysisDate?: Date | null;
  tgaThermogramFileUrl?: string | null;
  phosphorusPercent?: number | null;
  potassiumPercent?: number | null;
  magnesiumPercent?: number | null;
  calciumPercent?: number | null;
  ironPercent?: number | null;
}

export interface CreateSampleRequest extends SampleOptionalFields {
  sampleCode: string;
  creditBatchId: string;
  /** An instant, or a `{ date, time }` read in the credit batch facility's zone. */
  samplingTime: EventInstant;
  totalCarbonPercent: number;
  organicCarbonPercent: number;
}

/** PATCH semantics: `undefined` keeps the stored value, `null` clears an optional one. */
export interface UpdateSampleRequest extends SampleOptionalFields {
  expectedVersion: number;
  sampleCode?: string;
  /** Another batch moves the Sample. */
  creditBatchId?: string;
  samplingTime?: EventInstant;
  totalCarbonPercent?: number;
  organicCarbonPercent?: number;
}

/** A saved Sample, the calculated-ratio notices and the non-blocking certification warnings. */
export interface SampleWriteResult {
  sample: SampleWithRelations;
  notices: SampleRatioNotice[];
  warnings: string[];
}

type SampleColumns = Partial<typeof samples.$inferInsert>;

const DATE_FIELDS = ["analysisDate", "r0AnalysisDate", "tgaAnalysisDate"] as const;
const PASS_THROUGH_FIELDS = [
  "labName", "labAccreditation", "weightGrams", "volumeMl", "inorganicCarbonPercent",
  "totalHydrogenPercent", "totalNitrogenPercent", "totalOxygenPercent", "totalSulfurPercent",
  "ashContentPercent", "moistureContentPercent", "bulkDensityKgPerM3", "ph", "saltContentGPerKg",
  "randomReflectanceR0Percent", "sReflectanceFraction", "r0MeasurementCount", "r0HistogramFileUrl",
  "reactiveCarbonPercent", "residualCarbonPercent", "tgaThermogramFileUrl",
  "phosphorusPercent", "potassiumPercent", "magnesiumPercent", "calciumPercent", "ironPercent",
] as const satisfies readonly (keyof SampleOptionalFields)[];

/** A calendar date stored as its UTC day, as the date-only columns always have. */
function toDateColumn(value: Date | null): string | null {
  return value ? value.toISOString().split("T")[0] : null;
}

/**
 * The optional columns a request sets. With `fillMissing` (create) an absent
 * field stores null; without it (update) an absent field is left out. Ratios
 * are not here: they are derived from the effective row.
 */
export function optionalColumns(request: SampleOptionalFields, fillMissing: boolean): SampleColumns {
  const columns: Record<string, unknown> = {};
  for (const field of PASS_THROUGH_FIELDS) {
    const value = request[field];
    if (value !== undefined) columns[field] = value;
    else if (fillMissing) columns[field] = null;
  }
  for (const field of DATE_FIELDS) {
    const value = request[field];
    if (value !== undefined) columns[field] = toDateColumn(value);
    else if (fillMissing) columns[field] = null;
  }
  return columns as SampleColumns;
}

/** The stored row as the ratio, reconciliation and evidence checks see it after a write. */
export interface EffectiveSampleValues {
  sampleCode: string;
  totalCarbonPercent: number;
  organicCarbonPercent: number;
  inorganicCarbonPercent: number | null;
  totalHydrogenPercent: number | null;
  totalOxygenPercent: number | null;
  moistureContentPercent: number | null;
  oToCOrgRatio: number | null;
  randomReflectanceR0Percent: number | null;
  sReflectanceFraction: number | null;
  r0MeasurementCount: number | null;
  reactiveCarbonPercent: number | null;
  residualCarbonPercent: number | null;
}

const EFFECTIVE_OPTIONAL_FIELDS = [
  "inorganicCarbonPercent", "totalHydrogenPercent", "totalOxygenPercent", "moistureContentPercent",
  "randomReflectanceR0Percent", "sReflectanceFraction", "r0MeasurementCount", "reactiveCarbonPercent", "residualCarbonPercent",
] as const;

/**
 * The update merged over the locked row: an omitted input keeps the stored
 * value. The stored O/C_org is a lab value only when the row had no oxygen;
 * with oxygen it was calculated, so it never survives as a lab figure once
 * oxygen is cleared.
 */
export function mergeOverLocked(locked: typeof samples.$inferSelect, update: UpdateSampleRequest): EffectiveSampleValues {
  const merged = Object.fromEntries(EFFECTIVE_OPTIONAL_FIELDS.map((field) => [field, update[field] !== undefined ? update[field] : locked[field]]));
  const storedLabRatio = locked.totalOxygenPercent == null ? locked.oToCOrgRatio : null;
  return {
    ...(merged as Pick<EffectiveSampleValues, (typeof EFFECTIVE_OPTIONAL_FIELDS)[number]>),
    sampleCode: update.sampleCode ?? locked.sampleCode,
    totalCarbonPercent: update.totalCarbonPercent ?? locked.totalCarbonPercent,
    organicCarbonPercent: update.organicCarbonPercent ?? locked.organicCarbonPercent,
    oToCOrgRatio: update.oToCOrgRatio !== undefined ? update.oToCOrgRatio : storedLabRatio,
  };
}

/** Both ratios, always recomputed from the effective row; a calculated ratio above the stored maximum refuses. */
export function derivedRatioColumns(values: EffectiveSampleValues) {
  const ratios = deriveSampleRatios(values);
  return { columns: { hToCOrgRatio: ratios.hToCOrgRatio, oToCOrgRatio: ratios.oToCOrgRatio }, notices: ratios.notices };
}

/** `ratios` are the saved ones (`derivedRatioColumns`), never the lab O/C_org input in `values`. */
export async function batchEntryWarnings(
  ctx: OrgContext,
  tx: DbTransaction,
  values: EffectiveSampleValues,
  ratios: { hToCOrgRatio: number | null; oToCOrgRatio: number | null },
  batch: LockedSampleBatch,
  facility: SampleBatchFacility,
): Promise<string[]> {
  requireOrgScope(ctx);
  const batchesWithLabReports = await getBatchesWithLabReports(ctx, [batch.id], tx);
  return sampleEntryWarnings({
    hasLabReport: batchesWithLabReports.has(batch.id),
    ...values,
    hToCOrgRatio: ratios.hToCOrgRatio,
    oToCOrgRatio: ratios.oToCOrgRatio,
    creditBatchCode: batch.code,
    durabilityOption: facility.durabilityOption,
    sampling: batch.sampling,
  });
}
