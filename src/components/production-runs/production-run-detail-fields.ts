import type { DetailPanelField } from "@/components/ui/detail-panel";
import { resolveCertFieldStatus } from "@/components/forms/cert-field-status";
import type { CertFieldStatus } from "@/components/ui/certification-field-tag";
import type { ProductionRunFeedstockWithDetails } from "@/data-access/production-runs";
import type { ProductionRunStatus } from "@/schemas/production-runs";

export function buildProductionRunFeedstockDetailField(
  feedstocks: ReadonlyArray<
    Pick<
      ProductionRunFeedstockWithDetails,
      "feedstockCode" | "feedstockTypeName"
    >
  >,
): DetailPanelField {
  const labels = feedstocks.flatMap((feedstock) => {
    if (feedstock.feedstockTypeName && feedstock.feedstockCode) {
      return [
        `${feedstock.feedstockTypeName} (${feedstock.feedstockCode})`,
      ];
    }
    if (feedstock.feedstockTypeName) return [feedstock.feedstockTypeName];
    if (feedstock.feedstockCode) return [feedstock.feedstockCode];
    return [];
  });

  return {
    label: "Feedstock",
    value: labels.length > 0 ? labels.join(", ") : null,
  };
}

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
