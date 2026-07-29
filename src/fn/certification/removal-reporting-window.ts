/**
 * The removal's §8.6.2 reporting window (issue #320).
 *
 * Biochar Protocol §8.6.2 (local interpretation pin v1.2): the Reporting Period
 * begins with the batch's activity and ends when its biochar is applied at the
 * storage site. The window's END therefore anchors on the latest biochar
 * application across the removal's lineages — NOT the production-run end
 * (which keeps feeding durability `measured_at` and the sensor-telemetry
 * window; those are production-time facts).
 *
 * This module owns deriving that end date and reading a locked window back
 * out of a submission snapshot for the resume path.
 */
import type { CertificationSubmissionRow } from "@/data-access/certification";
import { formatUtcDate } from "@/lib/date-utils";
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
// the storage site" (§8.6.2) — a removal aggregating N applications is
// complete when the LAST biochar is stored. Fails closed on an empty lineage
// list: there is no fallback to production end anywhere (issue #320).
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
 * Reject dates that Isometric cannot accept before the submission pipeline
 * mirrors evidence Sources or creates Datapoints. Production end is the
 * durability `measured_at`; latest application is the GHG entry's
 * `completed_on`. Equality is valid because neither date is in the future.
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

// Guards the window inversion BEFORE any registry POST — the local stamp's
// `startedOn <= completedOn` DB check runs inside a best-effort write the
// submit path swallows, so a back-dated application must fail loudly instead
// of silently posting an inverted window to Isometric. Compares each lineage
// against ITS OWN production run's start, not the removal-wide earliest:
// biochar cannot be applied before the run that produced it started, and in a
// mixed removal an earlier sibling run would otherwise mask a lineage whose
// application predates its own run (PR #336 second-pass review). Fails closed
// on a lineage whose run start cannot be resolved. Compares at DATE
// granularity (what gets POSTed and stamped): form-entered application dates
// are UTC midnight, so a millisecond comparison would wrongly block a
// same-UTC-day application against a mid-day run start (issue #320 caveat 4).
export function assertReportingWindowNotInverted(args: {
  lineages: {
    application: { applicationDate: Date; code: string };
    productionRun: { id: string; code: string } | null;
  }[];
  runStartTimeByRunId: ReadonlyMap<string, Date>;
}): void {
  const { lineages, runStartTimeByRunId } = args;
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
    const runStartDate = formatUtcDate(runStartTime);
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
// snapshot's datapoints were built for rather than a since-drifted live one
// (pre-#320 drafts resume with their locked production-end window; the next
// fresh submit supersedes with the application-anchored one). Fail-loud like
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
