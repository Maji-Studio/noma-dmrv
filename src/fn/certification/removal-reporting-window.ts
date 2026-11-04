/**
 * The removal's reporting window (issue #320).
 *
 * Biochar Protocol v1.1.1: the reporting period "ends upon application of
 * biochar from that batch at the storage site". The window's end anchors on
 * the latest biochar application across the removal's lineages, not the
 * production-run end.
 *
 * This module owns deriving that end date and reading a locked window back
 * out of a submission snapshot for the resume path.
 */
import type { CertificationSubmissionRow } from "@/data-access/certification";
import { formatFacilityDate, formatUtcDate } from "@/lib/date-utils";
import { SafeError } from "@/lib/errors";
import { z } from "zod";

// The reporting window (`semantic.startedOn` / `completedOn`) the original
// attempt locked. On resume the removal body's started_on/completed_on must
// come from here, not from the live context: a resumed draft posts the
// SNAPSHOT's datapoint magnitudes, so deriving dates from a since-changed
// lineage/run set would stamp a window that the datapoints no longer back.
const reportingWindowSnapshotSchema = z.object({
  startedOn: z.iso.datetime(),
  completedOn: z.iso.datetime(),
});

// The Reporting Period ends "upon application of biochar from that batch at
// the storage site" (Biochar Protocol v1.1.1). A removal aggregating N
// applications is complete when the LAST biochar is stored. Fails closed on an
// empty lineage list: there is no fallback to production end (issue #320).
export function resolveLatestApplicationTime(
  lineages: { application: { applicationDate: Date; code: string } }[],
): Date {
  if (lineages.length === 0) {
    throw new SafeError(
      "This Removal has no applications. Link an application before submitting.",
    );
  }
  let latest = lineages[0].application.applicationDate;
  for (const lineage of lineages) {
    if (lineage.application.applicationDate > latest) {
      latest = lineage.application.applicationDate;
    }
  }
  return latest;
}

/**
 * Resolve the facility calendar dates for the date-only registry contract,
 * represented as UTC midnight for payload formatting and submission snapshots.
 *
 * Production timestamps are instants converted to the facility's calendar day.
 * Application dates already store that calendar day at UTC midnight and must
 * not be converted through the facility timezone. Refuse an application day
 * before the production end's facility day; completion is the application day,
 * including when production ends on that same day.
 */
export function resolveRemovalReportingWindow(args: {
  earliestProductionStartTime: Date;
  latestProductionEndTime: Date;
  latestApplicationTime: Date;
  facilityTimezone: string;
}): { startedOn: Date; completedOn: Date } {
  const {
    earliestProductionStartTime,
    latestProductionEndTime,
    latestApplicationTime,
    facilityTimezone,
  } = args;
  const applicationDate = formatUtcDate(latestApplicationTime);
  const productionEndFacilityDay = formatFacilityDate(
    latestProductionEndTime,
    facilityTimezone,
  );
  if (applicationDate < productionEndFacilityDay) {
    throw new SafeError(
      `Latest application date ${applicationDate} precedes latest production end date ` +
        `${productionEndFacilityDay}. Correct the application date before submitting.`,
    );
  }
  return {
    startedOn: new Date(
      `${formatFacilityDate(earliestProductionStartTime, facilityTimezone)}T00:00:00Z`,
    ),
    completedOn: new Date(`${applicationDate}T00:00:00Z`),
  };
}

/**
 * Reject dates that Isometric cannot accept before the submission pipeline
 * mirrors evidence Sources or creates Datapoints. The latest application is the
 * GHG entry's `completed_on`; production end must not be in the future.
 * Per-Sample durability `measured_at` values are guarded by the durability
 * builder. Equality is valid because neither date is in the future.
 */
export function assertRemovalDatesNotFuture(args: {
  productionEndTime: Date;
  latestApplicationTime: Date;
  now?: Date;
}): void {
  const {
    productionEndTime,
    latestApplicationTime,
    now = new Date(),
  } = args;

  if (productionEndTime.getTime() > now.getTime()) {
    throw new SafeError(
      `Latest production run ends at ${productionEndTime.toISOString()}. ` +
        "Change the end time or wait until the run ends.",
    );
  }

  if (latestApplicationTime.getTime() > now.getTime()) {
    throw new SafeError(
      `Latest application is dated ${latestApplicationTime.toISOString()}. ` +
        "Change the application date or wait until then.",
    );
  }
}

// Reject each application dated before its own production run before any
// registry POST; an earlier sibling run must not mask invalid lineage.
// The application date is a stored facility business date, represented as UTC
// midnight of that day. Convert the run start instant to its facility day for
// this comparison so a same-day application can follow a mid-day run start.
// resolveRemovalReportingWindow also checks the production end's facility day
// and returns the start and application calendar dates at UTC midnight.
// Fail closed when the lineage's production run start cannot be resolved.
export function assertReportingWindowNotInverted(args: {
  lineages: {
    application: { applicationDate: Date; code: string };
    productionRun: { id: string; code: string } | null;
  }[];
  runStartTimeByRunId: ReadonlyMap<string, Date>;
  facilityTimezone: string;
}): void {
  const { lineages, runStartTimeByRunId, facilityTimezone } = args;
  for (const lineage of lineages) {
    const run = lineage.productionRun;
    const runStartTime = run ? runStartTimeByRunId.get(run.id) : undefined;
    if (!run || !runStartTime) {
      throw new SafeError(
        `Application ${lineage.application.code} has no resolvable production run start. ` +
          "Record the run start before submitting the Removal.",
      );
    }
    const applicationDate = formatUtcDate(lineage.application.applicationDate);
    const runStartDate = formatFacilityDate(runStartTime, facilityTimezone);
    if (applicationDate < runStartDate) {
      throw new SafeError(
        `Application ${lineage.application.code} is dated ${applicationDate}, ` +
          `before its production run ${run.code} started ${runStartDate}. ` +
          "Correct the application date before submitting.",
      );
    }
  }
}

// Reads the reporting window the original attempt locked into the snapshot, for
// the resume path. Returns the two date fields `buildCreateGhgEntryRequest` and
// `updateRemovalDates` consume, so a resumed removal stamps the window the
// snapshot's datapoints were built for rather than a since-drifted live one.
// Fail-loud like
// the other snapshot readers: a missing/malformed window (pre-dating this
// field) means the snapshot drifted, so refuse to resume.
export function readRemovalReportingWindow(row: CertificationSubmissionRow): {
  startedOn: Date;
  completedOn: Date;
} {
  const snapshot = row.payloadSnapshot as {
    semantic?: { startedOn?: unknown; completedOn?: unknown } | null;
  } | null;
  const parsed = reportingWindowSnapshotSchema.safeParse(snapshot?.semantic);
  const startedOn = parsed.success
    ? new Date(parsed.data.startedOn)
    : new Date(NaN);
  const completedOn = parsed.success
    ? new Date(parsed.data.completedOn)
    : new Date(NaN);
  if (Number.isNaN(startedOn.getTime()) || Number.isNaN(completedOn.getTime())) {
    throw new SafeError(
      "This saved submission uses an outdated reporting window. Start a new submission.",
    );
  }
  if (startedOn.getTime() > completedOn.getTime()) {
    throw new SafeError(
      "This saved submission has an invalid reporting window. Start a new submission.",
    );
  }
  return { startedOn, completedOn };
}
