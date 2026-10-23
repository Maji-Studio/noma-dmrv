import { Fragment } from "react";
import type { DetailPanelField } from "@/components/ui/detail-panel";
import { resolveCertFieldStatus } from "@/components/forms/cert-field-status";
import type { CertFieldStatus } from "@/components/ui/certification-field-tag";
import type { ProductionRunFeedstockWithDetails } from "@/data-access/production-runs";
import type { ProductionRunStatus } from "@/schemas/production-runs";
import { formatCount } from "@/lib/copy-utils";
import { formatDayString, formatMassKg } from "@/lib/format-utils";
import { StockRows } from "@/components/storage-locations/stock-figures";
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
    { label: "Start date", value: day(run.startTime) },
    { label: "Start time", value: clock(run.startTime) },
    { label: "End date", value: run.endTime ? day(run.endTime) : null },
    { label: "End time", value: run.endTime ? clock(run.endTime) : null },
    {
      label: "Time zone",
      value: productionRunTimezoneHelperText(facilities, run.facilityId),
    },
  ];
}

const compareCodes = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true });

export interface ProductionRunFeedstockSummary {
  typeName: string | null;
  intakeCount: number;
  /** Lowest and highest intake code; equal for one coded intake. */
  codeRange: readonly [string, string] | null;
}

/**
 * One entry per feedstock type, not per intake. A draw is allocated across
 * every intake in its bin, so a run fed from a long-lived bin links a hundred
 * intakes (#1403); listing them all buried the field. The per-intake list
 * belongs to traceability.
 */
export function summarizeProductionRunFeedstocks(
  feedstocks: ReadonlyArray<
    Pick<
      ProductionRunFeedstockWithDetails,
      "feedstockCode" | "feedstockTypeName"
    >
  >,
): ProductionRunFeedstockSummary[] {
  const groups = new Map<string, { count: number; codes: string[] }>();
  for (const { feedstockCode, feedstockTypeName } of feedstocks) {
    if (!feedstockTypeName && !feedstockCode) continue;
    const key = feedstockTypeName ?? "";
    const group = groups.get(key) ?? { count: 0, codes: [] };
    group.count += 1;
    if (feedstockCode) group.codes.push(feedstockCode);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([typeName, { count, codes }]) => {
      codes.sort(compareCodes);
      return {
        typeName: typeName || null,
        intakeCount: count,
        codeRange:
          codes.length > 0 ? [codes[0], codes[codes.length - 1]] : null,
      };
    });
}

// A code never wraps at its hyphens ("FS-26-" / "001").
const Code = ({ code }: { code: string }) => (
  <span className="whitespace-nowrap">{code}</span>
);

function FeedstockSummaryEntry({
  summary: { typeName, intakeCount, codeRange },
}: {
  summary: ProductionRunFeedstockSummary;
}) {
  // "Between", not "to": codes run across the facility, so other bins'
  // intakes fall inside the range.
  const range = codeRange && (
    <>
      {codeRange[0] !== codeRange[1] && "between "}
      <Code code={codeRange[0]} />
      {codeRange[0] !== codeRange[1] && (
        <>
          {" and "}
          <Code code={codeRange[1]} />
        </>
      )}
    </>
  );
  const details =
    intakeCount === 1 ? (
      range
    ) : (
      <>
        {formatCount(intakeCount, "intake")}
        {range && <> {range}</>}
      </>
    );
  if (!typeName) return details;
  return details ? (
    <>
      {typeName} ({details})
    </>
  ) : (
    typeName
  );
}

export function buildProductionRunFeedstockDetailField(
  feedstocks: ReadonlyArray<
    Pick<
      ProductionRunFeedstockWithDetails,
      "feedstockCode" | "feedstockTypeName" | "wetMassUsedKg"
    >
  >,
): DetailPanelField {
  const summaries = summarizeProductionRunFeedstocks(feedstocks);
  const intakes = feedstocks
    .filter((feedstock) => feedstock.feedstockCode)
    .toSorted((a, b) => compareCodes(a.feedstockCode!, b.feedstockCode!));
  return {
    label: "Feedstock",
    // The intakes behind the count, one (i) away.
    ...(intakes.length > 0 && {
      explanationTitle: "Feedstock intakes",
      hint: "Each draw is split across the intakes in its bin by their wet mass.",
      explanation: (
        <StockRows
          label="Wet mass used per intake"
          rows={intakes.map((intake) => ({
            label: intake.feedstockCode!,
            value: formatMassKg(intake.wetMassUsedKg),
          }))}
        />
      ),
    }),
    value:
      summaries.length > 0
        ? summaries.map((summary, index) => (
            <Fragment key={summary.typeName ?? ""}>
              {index > 0 && ", "}
              <FeedstockSummaryEntry summary={summary} />
            </Fragment>
          ))
        : null,
  };
}

export function productionRunStatusCertStatus(
  status: ProductionRunStatus,
): CertFieldStatus {
  return resolveCertFieldStatus(true, status === "complete");
}
