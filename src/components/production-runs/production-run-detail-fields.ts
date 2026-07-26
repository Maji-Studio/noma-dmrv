import type { DetailPanelField } from "@/components/ui/detail-panel";
import { resolveCertFieldStatus } from "@/components/forms/cert-field-status";
import type { CertFieldStatus } from "@/components/ui/certification-field-tag";
import type { ProductionRunFeedstockWithDetails } from "@/data-access/production-runs";
import type { ProductionRunStatus } from "@/schemas/production-runs";
import { formatDayString } from "@/lib/format-utils";
import {
  formatFacilityDate,
  formatFacilityTime,
  resolveFacilityTimezone,
} from "@/lib/date-utils";
import {
  productionRunTimezoneHelperText,
  TIME_INPUT_FORMAT,
} from "./production-run-timing";

/**
 * The run window as the side sheet reads it back: in the FACILITY's zone, the
 * same zone the edit form writes it in.
 *
 * The browser zone is not an option here. A CEST operator reading a
 * `Africa/Dar_es_Salaam` (UTC+3) run entered as 08:00–16:00 saw 07:00–15:00 in
 * this panel while the edit form showed 08:00–16:00 — one record, two times, on
 * the field the auditor reads. Near midnight the DAY diverged too. The trailing
 * zone field names the zone the four values are stated in, matching the edit
 * form's helper text.
 */
export function buildProductionRunWindowDetailFields(
  run: {
    facilityId: string;
    startTime: Date;
    endTime: Date | null;
  },
  facilities: readonly { id: string; timezone: string }[],
): DetailPanelField[] {
  const timeZone = resolveFacilityTimezone(facilities, run.facilityId);
  const day = (instant: Date) =>
    formatDayString(formatFacilityDate(instant, timeZone));
  const clock = (instant: Date) =>
    formatFacilityTime(instant, timeZone, TIME_INPUT_FORMAT);

  return [
    { label: "Start Date", value: day(run.startTime) },
    { label: "Start Time", value: clock(run.startTime) },
    { label: "End Date", value: run.endTime ? day(run.endTime) : null },
    { label: "End Time", value: run.endTime ? clock(run.endTime) : null },
    {
      label: "Time Zone",
      value: productionRunTimezoneHelperText(facilities, run.facilityId),
    },
  ];
}

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
