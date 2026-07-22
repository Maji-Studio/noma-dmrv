import type { DetailPanelField } from "@/components/ui/detail-panel";
import { resolveCertFieldStatus } from "@/components/forms/cert-field-status";
import type { CertFieldStatus } from "@/components/ui/certification-field-tag";
import type { ProductionRunStatus } from "@/schemas/production-runs";

export function productionRunStatusCertStatus(
  status: ProductionRunStatus,
): CertFieldStatus {
  return resolveCertFieldStatus(true, status === "complete");
}

export function productionRunTelemetryCertification(
  status: ProductionRunStatus,
  readingsCount: number,
  persisted = true,
): Pick<DetailPanelField, "certifyRequired" | "certifyStatus"> {
  if (status === "failed" || status === "cancelled") {
    return { certifyRequired: false, certifyStatus: "neutral" };
  }

  return {
    certifyRequired: true,
    certifyStatus: resolveCertFieldStatus(
      persisted ? true : undefined,
      readingsCount > 0,
    ),
  };
}

export function buildProductionRunReadingsDetailField(
  status: ProductionRunStatus,
  readingsCount: number,
): DetailPanelField {
  const hasSavedReadings = readingsCount > 0;

  return {
    label: "Readings CSV",
    value: hasSavedReadings
      ? `${readingsCount.toLocaleString()} saved reading${readingsCount === 1 ? "" : "s"}`
      : null,
    ...productionRunTelemetryCertification(status, readingsCount),
  };
}
