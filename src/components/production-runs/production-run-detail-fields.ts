import type { DetailPanelField } from "@/components/ui/detail-panel";
import { resolveCertFieldStatus } from "@/components/forms/cert-field-status";
import type { CertFieldStatus } from "@/components/ui/certification-field-tag";
import type { ProductionRunStatus } from "@/schemas/production-runs";

export function productionRunStatusCertStatus(
  status: ProductionRunStatus,
): CertFieldStatus {
  return resolveCertFieldStatus(true, status === "complete");
}

export function buildProductionRunReadingsDetailField(
  readingsCount: number,
): DetailPanelField {
  const hasSavedReadings = readingsCount > 0;

  return {
    label: "Readings CSV",
    value: hasSavedReadings
      ? `${readingsCount.toLocaleString()} saved reading${readingsCount === 1 ? "" : "s"}`
      : null,
    certifyRequired: true,
    certifyStatus: resolveCertFieldStatus(true, hasSavedReadings),
  };
}
