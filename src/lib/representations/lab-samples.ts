import { z } from "zod";

const DRY_BASIS = "percent of dry mass (dry basis)";
const nullableNumber = (description: string) => z.number().nullable().describe(description);
const nullableDate = (description: string) => z.iso.date().nullable().describe(description);

/**
 * One lab replicate characterising a credit batch (round 7 Q48). Ids and UTC
 * instants only (plan decision 48): no facility, durability tier, batch code,
 * production run or facility zone. Look the batch up through /credit-batches.
 */
export const labSampleRepresentationSchema = z.object({
  id: z.uuid().describe("Lab sample identifier, UUID."),
  code: z.string().describe("Human-readable sample code, unique within the organization."),
  version: z.number().int().positive().describe("Positive row version for concurrency checks."),
  creditBatchId: z.uuid().nullable().describe("Credit batch this replicate characterises, UUID, or null on a legacy sample that never had one."),
  samplingTime: z.iso.datetime().describe("When the sample was taken, an instant in UTC, RFC 3339."),
  labName: z.string().nullable().describe("Laboratory that analysed the sample, untrusted plain text, or null."),
  labAccreditation: z.string().nullable().describe("The laboratory's accreditation, untrusted plain text, or null."),
  analysisDate: nullableDate("Date the laboratory analysed the sample, YYYY-MM-DD, or null."),
  weightGrams: nullableNumber("Sample mass sent for analysis in grams."),
  volumeMl: nullableNumber("Sample volume sent for analysis in millilitres."),
  totalCarbonPercent: z.number().describe(`Total carbon, ${DRY_BASIS}.`),
  organicCarbonPercent: z.number().describe(`Organic carbon, ${DRY_BASIS}.`),
  inorganicCarbonPercent: nullableNumber(`Inorganic carbon, ${DRY_BASIS}.`),
  totalHydrogenPercent: nullableNumber(`Total hydrogen, ${DRY_BASIS}.`),
  totalNitrogenPercent: nullableNumber(`Total nitrogen, ${DRY_BASIS}.`),
  totalOxygenPercent: nullableNumber(`Total oxygen, ${DRY_BASIS}.`),
  totalSulfurPercent: nullableNumber(`Total sulfur, ${DRY_BASIS}.`),
  ashContentPercent: nullableNumber(`Ash, ${DRY_BASIS}.`),
  moistureContentPercent: nullableNumber("Moisture as percent of wet mass."),
  bulkDensityKgPerM3: nullableNumber("Bulk density in kilograms per cubic metre."),
  ph: nullableNumber("pH, 0 to 14."),
  saltContentGPerKg: nullableNumber("Salt content in grams per kilogram."),
  hToCOrgRatio: nullableNumber("Atomic H/C_org ratio, calculated by the server from totalHydrogenPercent and organicCarbonPercent; null without hydrogen."),
  oToCOrgRatio: nullableNumber("Atomic O/C_org ratio: calculated from totalOxygenPercent and organicCarbonPercent when oxygen is present, otherwise the laboratory's value or null."),
  randomReflectanceR0Percent: nullableNumber("Mean random reflectance R0 in percent (ISO 7404-5)."),
  sReflectanceFraction: nullableNumber("Fraction of this sample's R0 readings at or above 2%, 0 to 1."),
  r0MeasurementCount: z.number().int().nullable().describe("Number of R0 readings behind randomReflectanceR0Percent."),
  r0AnalysisDate: nullableDate("Date of the R0 analysis, YYYY-MM-DD, or null."),
  reactiveCarbonPercent: nullableNumber("TGA reactive carbon in percent."),
  residualCarbonPercent: nullableNumber("TGA non-reactive (residual) carbon in percent."),
  tgaAnalysisDate: nullableDate("Date of the TGA analysis, YYYY-MM-DD, or null."),
  phosphorusPercent: nullableNumber(`Phosphorus, ${DRY_BASIS}.`),
  potassiumPercent: nullableNumber(`Potassium, ${DRY_BASIS}.`),
  magnesiumPercent: nullableNumber(`Magnesium, ${DRY_BASIS}.`),
  calciumPercent: nullableNumber(`Calcium, ${DRY_BASIS}.`),
  ironPercent: nullableNumber(`Iron, ${DRY_BASIS}.`),
  createdAt: z.iso.datetime().describe("Creation instant in UTC, RFC 3339."),
  updatedAt: z.iso.datetime().describe("Last update instant in UTC, RFC 3339."),
});
export type LabSampleRepresentation = z.infer<typeof labSampleRepresentationSchema>;

type Instant = Date | string;
export type LabSampleRepresentationInput = Omit<LabSampleRepresentation, "samplingTime" | "createdAt" | "updatedAt"> & {
  samplingTime: Instant; createdAt: Instant; updatedAt: Instant;
};

const instant = (value: Instant) => new Date(value).toISOString();

/** Explicit public projection for database reads and stored JSON outcomes. Joined or private columns never pass through. */
export function representLabSample(row: LabSampleRepresentationInput): LabSampleRepresentation {
  return labSampleRepresentationSchema.parse({
    id: row.id, code: row.code, version: row.version, creditBatchId: row.creditBatchId,
    samplingTime: instant(row.samplingTime),
    labName: row.labName, labAccreditation: row.labAccreditation, analysisDate: row.analysisDate,
    weightGrams: row.weightGrams, volumeMl: row.volumeMl,
    totalCarbonPercent: row.totalCarbonPercent, organicCarbonPercent: row.organicCarbonPercent,
    inorganicCarbonPercent: row.inorganicCarbonPercent,
    totalHydrogenPercent: row.totalHydrogenPercent, totalNitrogenPercent: row.totalNitrogenPercent,
    totalOxygenPercent: row.totalOxygenPercent, totalSulfurPercent: row.totalSulfurPercent,
    ashContentPercent: row.ashContentPercent, moistureContentPercent: row.moistureContentPercent,
    bulkDensityKgPerM3: row.bulkDensityKgPerM3, ph: row.ph, saltContentGPerKg: row.saltContentGPerKg,
    hToCOrgRatio: row.hToCOrgRatio, oToCOrgRatio: row.oToCOrgRatio,
    randomReflectanceR0Percent: row.randomReflectanceR0Percent, sReflectanceFraction: row.sReflectanceFraction,
    r0MeasurementCount: row.r0MeasurementCount, r0AnalysisDate: row.r0AnalysisDate,
    reactiveCarbonPercent: row.reactiveCarbonPercent, residualCarbonPercent: row.residualCarbonPercent,
    tgaAnalysisDate: row.tgaAnalysisDate,
    phosphorusPercent: row.phosphorusPercent, potassiumPercent: row.potassiumPercent,
    magnesiumPercent: row.magnesiumPercent, calciumPercent: row.calciumPercent, ironPercent: row.ironPercent,
    createdAt: instant(row.createdAt), updatedAt: instant(row.updatedAt),
  });
}
