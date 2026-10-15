import { z } from "zod";
import { eventInstantSchema } from "./event-instant";
import {
  calendarDateSchema, clearableNumber, expectedVersionSchema, optionalNumber, PG_INTEGER_MAX, pipeToCanonicalNumber,
  RATIO_INPUT_MAX, RATIO_MAX_MESSAGE, requiredNumber, toClearableNumber, toNumberOrNull, uuidSchema,
} from "./helpers";
import { CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS, getSampleCarbonReconciliationErrors, samplePhysicalNumber, updateSampleSchema } from "./samples";

/**
 * What REST and MCP publish for one lab Sample (Phase 5a). Not published:
 * `hToCOrgRatio` (always calculated, round 7 Q50), the form-only
 * `durabilityOption` and `nutrientClaimEnabled`, the R0 histogram and TGA
 * thermogram file URLs, and the heavy metal and contaminant columns.
 */

const PERCENT_MIN = 0;
const PERCENT_MAX = 100;
const PH_MIN = 0;
const PH_MAX = 14;
const FRACTION_MAX = 1;
const LAB_TEXT_MAX_LENGTH = 200;
const PERCENT_RANGE_MESSAGE = "Enter a value from 0 to 100";
const NON_NEGATIVE_MESSAGE = "Must be a non-negative number";
const CARBON_REQUIRED_MESSAGE = "This field is required";
const TOLERANCE = CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS;

const percent = z.number().finite().min(PERCENT_MIN, PERCENT_RANGE_MESSAGE).max(PERCENT_MAX, PERCENT_RANGE_MESSAGE);
const nonNegative = z.number().finite().min(0, NON_NEGATIVE_MESSAGE);
const ph = z.number().finite().min(PH_MIN, `Must be between ${PH_MIN} and ${PH_MAX}`).max(PH_MAX, `Must be between ${PH_MIN} and ${PH_MAX}`);
const fraction = z.number().finite().min(0, "Must be between 0 and 1").max(FRACTION_MAX, "Must be between 0 and 1");
const ratio = nonNegative.max(RATIO_INPUT_MAX, RATIO_MAX_MESSAGE);
const count = z.number().int().min(0).max(PG_INTEGER_MAX, "Measurement count is too large");
const labText = z.string().trim().max(LAB_TEXT_MAX_LENGTH);

/** Create: a missing optional number is stored empty. */
const optional = (canonical: z.ZodNumber) => pipeToCanonicalNumber(optionalNumber, canonical.nullable().optional());
/** PATCH: missing leaves the stored value, null clears it. */
const clearable = (canonical: z.ZodNumber) => pipeToCanonicalNumber(clearableNumber, canonical.nullable().optional());

const DRY_BASIS = "percent of dry mass (dry basis)";

/** Descriptions shared by create and PATCH, keyed by field. */
const DESCRIPTIONS = {
  creditBatchId: "Credit batch this replicate characterises, UUID. Its facility sets the durability tier and the time zone a facility-local samplingTime is read in.",
  labName: "Laboratory that analysed the sample, untrusted plain text.",
  labAccreditation: "The laboratory's accreditation, for example ISO 17025, untrusted plain text.",
  analysisDate: "Date the laboratory analysed the sample, YYYY-MM-DD.",
  weightGrams: "Sample mass sent for analysis in grams.",
  volumeMl: "Sample volume sent for analysis in millilitres.",
  totalCarbonPercent: `Total carbon, ${DRY_BASIS}, 0 to 100.`,
  organicCarbonPercent: `Organic carbon, ${DRY_BASIS}, 0 to 100. Refused when it exceeds totalCarbonPercent by more than ${TOLERANCE} percentage points; a shortfall is not checked. Used with totalHydrogenPercent to calculate H/C_org.`,
  inorganicCarbonPercent: `Inorganic carbon, ${DRY_BASIS}, 0 to 100. Refused when organic plus inorganic carbon exceeds totalCarbonPercent by more than ${TOLERANCE} percentage points; a shortfall is not checked.`,
  totalHydrogenPercent: `Total hydrogen, ${DRY_BASIS}, 0 to 100. H/C_org is calculated from this and organicCarbonPercent; without it the sample has no H/C_org.`,
  totalNitrogenPercent: `Total nitrogen, ${DRY_BASIS}, 0 to 100.`,
  totalOxygenPercent: `Total oxygen, ${DRY_BASIS}, 0 to 100. When present, O/C_org is calculated from this and organicCarbonPercent.`,
  totalSulfurPercent: `Total sulfur, ${DRY_BASIS}, 0 to 100.`,
  ashContentPercent: `Ash, ${DRY_BASIS}, 0 to 100.`,
  moistureContentPercent: "Moisture as percent of wet mass, 0 to 100.",
  bulkDensityKgPerM3: "Bulk density in kilograms per cubic metre.",
  ph: `pH, ${PH_MIN} to ${PH_MAX}.`,
  saltContentGPerKg: "Salt content in grams per kilogram.",
  oToCOrgRatio: `Atomic O/C_org ratio as the laboratory reported it, 0 to ${RATIO_INPUT_MAX}. Stored only when totalOxygenPercent is absent; with oxygen, O/C_org is calculated and this value is not used.`,
  randomReflectanceR0Percent: "Mean random reflectance R0 in percent (ISO 7404-5). Optional for 1,000-year durability.",
  sReflectanceFraction: "Fraction of this sample's R0 readings at or above 2%, 0 to 1. Optional when saving; every Sample on a sampled 1,000-year credit batch needs it before a Removal can be submitted.",
  r0MeasurementCount: "Number of R0 readings behind randomReflectanceR0Percent.",
  r0AnalysisDate: "Date of the R0 analysis, YYYY-MM-DD.",
  reactiveCarbonPercent: "TGA reactive carbon in percent. Optional for 1,000-year durability.",
  residualCarbonPercent: "TGA non-reactive (residual) carbon in percent. Optional for 1,000-year durability.",
  tgaAnalysisDate: "Date of the TGA analysis, YYYY-MM-DD.",
  phosphorusPercent: `Phosphorus, ${DRY_BASIS}, 0 to 100.`,
  potassiumPercent: `Potassium, ${DRY_BASIS}, 0 to 100.`,
  magnesiumPercent: `Magnesium, ${DRY_BASIS}, 0 to 100.`,
  calciumPercent: `Calcium, ${DRY_BASIS}, 0 to 100.`,
  ironPercent: `Iron, ${DRY_BASIS}, 0 to 100.`,
} as const;

/** The numeric lab results, each with its canonical rule. Totals are handled separately: they are required. */
const NUMERIC_FIELDS = {
  weightGrams: samplePhysicalNumber("weightGrams"), volumeMl: samplePhysicalNumber("volumeMl"),
  inorganicCarbonPercent: percent,
  totalHydrogenPercent: percent, totalNitrogenPercent: percent, totalOxygenPercent: percent, totalSulfurPercent: percent,
  ashContentPercent: percent, moistureContentPercent: percent,
  bulkDensityKgPerM3: samplePhysicalNumber("bulkDensityKgPerM3"), ph, saltContentGPerKg: samplePhysicalNumber("saltContentGPerKg"),
  oToCOrgRatio: ratio,
  randomReflectanceR0Percent: percent, sReflectanceFraction: fraction,
  reactiveCarbonPercent: percent, residualCarbonPercent: percent,
  phosphorusPercent: percent, potassiumPercent: percent, magnesiumPercent: percent, calciumPercent: percent, ironPercent: percent,
} as const;

type NumericField = keyof typeof NUMERIC_FIELDS;

function numericFields<Wrapped extends z.ZodType>(wrap: (canonical: z.ZodNumber) => Wrapped): Record<NumericField, Wrapped> {
  return Object.fromEntries(
    (Object.keys(NUMERIC_FIELDS) as NumericField[]).map((field) => [field, wrap(NUMERIC_FIELDS[field]).describe(DESCRIPTIONS[field])]),
  ) as Record<NumericField, Wrapped>;
}

const sharedFields = {
  labName: labText.nullable().optional().describe(DESCRIPTIONS.labName),
  labAccreditation: labText.nullable().optional().describe(DESCRIPTIONS.labAccreditation),
  analysisDate: calendarDateSchema().nullable().optional().describe(DESCRIPTIONS.analysisDate),
  r0AnalysisDate: calendarDateSchema().nullable().optional().describe(DESCRIPTIONS.r0AnalysisDate),
  tgaAnalysisDate: calendarDateSchema().nullable().optional().describe(DESCRIPTIONS.tgaAnalysisDate),
};

interface CarbonValues {
  totalCarbonPercent?: number | null;
  organicCarbonPercent?: number | null;
  inorganicCarbonPercent?: number | null;
}

/** The carbon excess check on the figures in this body; the writer repeats it on the merged row. */
function refineCarbon(value: CarbonValues, ctx: z.RefinementCtx<CarbonValues>) {
  const errors = getSampleCarbonReconciliationErrors(value);
  for (const field of ["organicCarbonPercent", "inorganicCarbonPercent"] as const) {
    const message = errors[field];
    if (message) ctx.addIssue({ code: "custom", path: [field], message });
  }
}

/**
 * The published body of `record_lab_sample`. `samplingTime` is an offset
 * instant, or a `{ date, time }` read in the credit batch facility's zone;
 * a time in the future is refused.
 */
export const recordLabSampleInput = z.strictObject({
  creditBatchId: uuidSchema("Choose a valid credit batch.").describe(DESCRIPTIONS.creditBatchId),
  samplingTime: eventInstantSchema,
  totalCarbonPercent: pipeToCanonicalNumber(requiredNumber(CARBON_REQUIRED_MESSAGE), percent).describe(DESCRIPTIONS.totalCarbonPercent),
  organicCarbonPercent: pipeToCanonicalNumber(requiredNumber(CARBON_REQUIRED_MESSAGE), percent).describe(DESCRIPTIONS.organicCarbonPercent),
  ...sharedFields,
  ...numericFields(optional),
  r0MeasurementCount: z.preprocess(toNumberOrNull, count.nullable().optional()).describe(DESCRIPTIONS.r0MeasurementCount),
}).superRefine(refineCarbon);

export type RecordLabSampleInput = z.output<typeof recordLabSampleInput>;

/** The fields a PATCH may change: missing leaves the stored value, null clears an optional one. */
const publishedUpdateFields = {
  code: updateSampleSchema.shape.sampleCode.describe("Human-readable sample code: capital letters, digits and hyphens."),
  creditBatchId: uuidSchema("Choose a valid credit batch.").optional().describe(`${DESCRIPTIONS.creditBatchId} Send another batch to move the sample.`),
  samplingTime: eventInstantSchema.optional().describe("When the sample was taken: an RFC 3339 instant with explicit offset, or a { date, time } read in the credit batch facility's zone. A time in the future is refused."),
  // A direct preprocess publishes the canonical percent; null is refused, since the totals cannot be cleared.
  totalCarbonPercent: z.preprocess(toClearableNumber, percent.optional()).describe(`${DESCRIPTIONS.totalCarbonPercent} Cannot be cleared.`),
  organicCarbonPercent: z.preprocess(toClearableNumber, percent.optional()).describe(`${DESCRIPTIONS.organicCarbonPercent} Cannot be cleared.`),
  ...sharedFields,
  ...numericFields(clearable),
  r0MeasurementCount: z.preprocess(toClearableNumber, count.nullable().optional()).describe(DESCRIPTIONS.r0MeasurementCount),
};

/** The published PATCH body; the transport supplies the sample id and the If-Match version. */
export const updateLabSampleApiInput = z.strictObject(publishedUpdateFields).superRefine(refineCarbon);

/** The `update_lab_sample` input: the id and version join the body because MCP has no path or If-Match. */
export const updateLabSampleInput = z.strictObject({
  labSampleId: uuidSchema().describe("Target lab sample UUID."),
  expectedVersion: expectedVersionSchema.describe("Version from get_lab_sample."),
  ...publishedUpdateFields,
}).superRefine(refineCarbon);

export type UpdateLabSampleInput = z.output<typeof updateLabSampleInput>;

/** The `delete_lab_sample` input. Deleting also deletes the Sample's transport legs and retires its documents. */
export const deleteLabSampleInput = z.strictObject({
  labSampleId: uuidSchema().describe("Target lab sample UUID."),
  expectedVersion: expectedVersionSchema.describe("Version from get_lab_sample."),
});

export type DeleteLabSampleInput = z.output<typeof deleteLabSampleInput>;
