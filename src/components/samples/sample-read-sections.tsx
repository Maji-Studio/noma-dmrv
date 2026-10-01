/** Sample side-sheet view mode: the sections config for EntitySideSheet. */
import { TransportLegsSummary } from "@/components/transport-legs";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { formatDate, formatDateTime, formatPercent } from "@/lib/format-utils";
import { formatMoisturePercent, MOISTURE_FIELD_LABEL, PERCENT_SCALE } from "@/lib/mass-moisture";
import { formatDurabilityOption } from "@/schemas/samples";
import { SampleDocumentsPanel } from "./sample-documents-panel";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { SampleWithRelations } from "@/data-access/samples";

const LAB_PERCENT_FRACTION_DIGITS = 2;
/** Atomic ratios (H:C org, O:C org) read at four decimals. */
const RATIO_DIGITS = 4;

function formatLabPercent(value: number | null | undefined): string {
  return formatPercent(value, { digits: LAB_PERCENT_FRACTION_DIGITS });
}

export function sampleSheetSections(sample: SampleWithRelations): DetailPanelSection[] {
  return [
    {
      title: "Sample information",
      fields: [
        { label: "Credit batch", value: sample.creditBatchCode },
        { label: "Sampling time", value: formatDateTime(sample.samplingTime) },
        { label: "Analysis date", value: formatDate(sample.analysisDate) },
        { label: "Lab name", value: sample.labName },
        { label: "Lab accreditation", value: sample.labAccreditation },
        { label: "Sample weight (g)", value: sample.weightGrams },
        { label: "Sample volume (mL)", value: sample.volumeMl },
      ],
    },
    {
      title: "Lab analysis",
      fields: [
        { label: "Total carbon", value: formatLabPercent(sample.totalCarbonPercent) },
        { label: "Organic carbon", ...certificationDetailField("sample", "organicCarbonPercent"), value: formatLabPercent(sample.organicCarbonPercent) },
        { label: "Inorganic carbon", value: formatLabPercent(sample.inorganicCarbonPercent) },
        { label: "Ash content", value: formatLabPercent(sample.ashContentPercent) },
        { label: "Hydrogen", value: formatLabPercent(sample.totalHydrogenPercent) },
        { label: "Nitrogen", value: formatLabPercent(sample.totalNitrogenPercent) },
        { label: "Oxygen", value: formatLabPercent(sample.totalOxygenPercent) },
        { label: "Sulfur", value: formatLabPercent(sample.totalSulfurPercent) },
      ],
    },
    {
      title: "Physical properties",
      fields: [
        { label: "Bulk density (kg/m³)", value: sample.bulkDensityKgPerM3 },
        { label: "pH", value: sample.ph != null ? String(sample.ph) : null },
        { label: "Salt content (g/kg)", value: sample.saltContentGPerKg },
        { label: MOISTURE_FIELD_LABEL, value: formatMoisturePercent(sample.moistureContentPercent) },
      ],
    },
    {
      title: "Stability ratios",
      fields: [
        { label: "Inherited durability", value: formatDurabilityOption(sample.durabilityOption) },
        { label: "H:C org ratio", ...certificationDetailField("sample", "hToCOrgRatio"), value: sample.hToCOrgRatio?.toFixed(RATIO_DIGITS) ?? null },
        { label: "O:C org ratio", ...certificationDetailField("sample", "oToCOrgRatio"), value: sample.oToCOrgRatio?.toFixed(RATIO_DIGITS) ?? null },
      ],
    },
    ...(sample.durabilityOption === "1000_year" ? [
      {
        title: "1000-year durability · R₀ reflectance",
        fields: [
          { label: "Mean random reflectance R₀", ...certificationDetailField("sample", "randomReflectanceR0Percent"), value: formatLabPercent(sample.randomReflectanceR0Percent) },
          { label: "R₀ readings ≥ 2%", ...certificationDetailField("sample", "sReflectanceFraction"), value: sample.sReflectanceFraction == null ? null : formatLabPercent(sample.sReflectanceFraction * PERCENT_SCALE) },
          { label: "Measurement count", value: sample.r0MeasurementCount },
          { label: "R₀ analysis date", value: formatDate(sample.r0AnalysisDate) },
        ],
      },
      {
        title: "TGA non-reactive carbon",
        fields: [
          { label: "Reactive carbon", ...certificationDetailField("sample", "reactiveCarbonPercent"), value: formatLabPercent(sample.reactiveCarbonPercent) },
          { label: "Residual carbon", ...certificationDetailField("sample", "residualCarbonPercent"), value: formatLabPercent(sample.residualCarbonPercent) },
          { label: "TGA analysis date", value: formatDate(sample.tgaAnalysisDate) },
        ],
      },
    ] : []),
    {
      title: "Nutrient claims",
      fields: [
        { label: "Enable nutrient claims", value: sample.nutrientClaimEnabled ? "Yes" : "No" },
        ...(sample.nutrientClaimEnabled ? [
          { label: "Phosphorus (%)", value: formatLabPercent(sample.phosphorusPercent) },
          { label: "Potassium (%)", value: formatLabPercent(sample.potassiumPercent) },
          { label: "Magnesium (%)", value: formatLabPercent(sample.magnesiumPercent) },
          { label: "Calcium (%)", value: formatLabPercent(sample.calciumPercent) },
          { label: "Iron (%)", value: formatLabPercent(sample.ironPercent) },
        ] : []),
      ],
    },
    {
      title: "Evidence & documents",
      fields: [],
      content: <SampleDocumentsPanel sampleId={sample.id} readOnly />,
    },
    {
      title: "Transport",
      fields: [],
      content: <TransportLegsSummary entityType="sample" entityId={sample.id} />,
    },
  ];
}
