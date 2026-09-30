/** Production run side-sheet view mode: the sections config for EntitySideSheet. */
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent, MOISTURE_FIELD_LABEL, qualifyMassLabel, WET_MASS_FIELD_LABEL } from "@/lib/mass-moisture";
import { MoistureSplit } from "@/components/ui/moisture-split";
import { ProductionIncidentTable } from "./production-incident-table";
import { ProductionReadingsDocuments } from "./production-readings-documents";
import { ProductionSampleTable } from "./production-sample-table";
import { buildProductionRunFeedstockDetailField, buildProductionRunWindowDetailFields, productionRunStatusCertStatus } from "./production-run-detail-fields";
import type { ReactNode } from "react";
import { CheckCircleIcon, ClockIcon, ProhibitIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { ProductionRunStatus } from "@/schemas/production-runs";
import type { ProductionRunWithRelations } from "@/data-access/production-runs";

const STATUS_ICON_PX = 14;
const STATUS_ICONS: Record<ProductionRunStatus, ReactNode> = {
  draft: <WarningIcon size={STATUS_ICON_PX} weight="fill" />,
  running: <ClockIcon size={STATUS_ICON_PX} weight="fill" />,
  complete: <CheckCircleIcon size={STATUS_ICON_PX} weight="fill" />,
  failed: <WarningIcon size={STATUS_ICON_PX} weight="fill" />,
  cancelled: <ProhibitIcon size={STATUS_ICON_PX} weight="fill" />,
};

export function RunStatusBadge({ status }: { status: ProductionRunStatus }) {
  return <StatusBadge status={status} icon={STATUS_ICONS[status]} />;
}

export function productionRunSheetSections(run: ProductionRunWithRelations, facilities: readonly { id: string; timezone: string }[]): DetailPanelSection[] {
  return [
    {
      title: "Run setup",
      fields: [
        { label: "Reactor", value: run.reactorIdentifier },
        {
          label: "Status",
          value: <RunStatusBadge status={run.status} />,
          certifyRequired: true,
          certifyStatus: productionRunStatusCertStatus(
            run.status,
          ),
        },
        ...(run.status === "cancelled"
          ? [{ label: "Cancellation reason", value: run.cancellationReason }]
          : []),
        ...buildProductionRunWindowDetailFields(run, facilities),
        { label: "Operator", value: run.operatorName },
      ],
    },
    {
      title: "Feedstock & processing",
      fields: [
        buildProductionRunFeedstockDetailField(run.feedstocks),
        ...run.feedstockDraws.map((draw, index) => ({
          label: `Source bin ${index + 1}`,
          value: `${draw.storageLocationName}: ${formatMassKg(draw.wetMassKg)}`,
        })),
        { label: qualifyMassLabel(WET_MASS_FIELD_LABEL, "Feedstock"), ...certificationDetailField("productionRun", "feedstockWetMassKg"), value: formatMassKg(run.totalFeedstockWetMassKg) },
        { label: qualifyMassLabel(MOISTURE_FIELD_LABEL, "Feedstock"), ...certificationDetailField("productionRun", "feedstockMoisturePercent"), value: formatMoisturePercent(run.feedstockMoisturePercent) },
        { label: "Feed rate (kg/hr)", value: run.feedingRateKgHr != null ? `${run.feedingRateKgHr} kg/hr` : null },
        { label: "Residence time (min)", value: run.residenceTimeMinutes != null ? `${run.residenceTimeMinutes} min` : null },
      ],
      content: (
        <MoistureSplit
          wetMassKg={run.totalFeedstockWetMassKg}
          moisturePercent={run.feedstockMoisturePercent}
          dryMassKg={run.feedstockMassDryKg}
          materialLabel="Feedstock"
        />
      ),
    },
    {
      title: "Output",
      fields: [
        {
          label: "Biochar storage",
          value: run.biocharStorageLocationName,
        },
        { label: qualifyMassLabel(WET_MASS_FIELD_LABEL, "Biochar"), ...certificationDetailField("productionRun", "biocharOutputKg"), value: formatMassKg(run.biocharOutputKg) },
        { label: qualifyMassLabel(MOISTURE_FIELD_LABEL, "Biochar"), ...certificationDetailField("productionRun", "biocharMoisturePercent"), value: formatMoisturePercent(run.biocharMoisturePercent) },
      ],
      content: (
        <MoistureSplit
          wetMassKg={run.biocharOutputKg}
          moisturePercent={run.biocharMoisturePercent}
          dryMassKg={run.biocharDryMassKg}
          materialLabel="Biochar"
        />
      ),
    },
    {
      title: "Energy",
      fields: [
        { label: "Startup / plant diesel (L)", ...certificationDetailField("productionRun", "dieselOperationLiters"), value: run.dieselOperationLiters != null ? `${run.dieselOperationLiters} L` : null },
        { label: "Genset diesel (L)", ...certificationDetailField("productionRun", "dieselGensetLiters"), value: run.dieselGensetLiters != null ? `${run.dieselGensetLiters} L` : null },
        { label: "Preprocess fuel (L)", ...certificationDetailField("productionRun", "preprocessingFuelLiters"), value: run.preprocessingFuelLiters != null ? `${run.preprocessingFuelLiters} L` : null },
        { label: "Electricity (kWh)", ...certificationDetailField("productionRun", "electricityKwh"), value: run.electricityKwh != null ? `${run.electricityKwh} kWh` : null },
      ],
    },
    {
      title: "Readings file",
      fields: [],
      content: (
        <ProductionReadingsDocuments
          productionRunId={run.id}
          readOnly
        />
      ),
    },
    {
      title: "Samples & incidents",
      fields: [],
      content: (
        <div className="space-y-20">
          <ProductionSampleTable productionRunId={run.id} readOnly />
          <ProductionIncidentTable productionRunId={run.id} readOnly />
        </div>
      ),
    },
  ];
}
