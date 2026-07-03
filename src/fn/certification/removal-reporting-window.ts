/**
 * The removal's §8.6.2 reporting window (issue #320).
 *
 * Biochar protocol v1.3 §8.6.2: the Reporting Period "begins when the activity
 * associated with a batch of Removals begins, and ends upon application of
 * biochar from that batch at the storage site". The window's END therefore
 * anchors on the latest biochar application across the removal's lineages —
 * NOT the production-run end (which keeps feeding durability `measured_at`
 * and the sensor-telemetry window; those are production-time facts).
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
      "Cannot derive the removal's reporting-period end: no applications in the lineage.",
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

// Guards the window inversion BEFORE any registry POST — the local stamp's
// `startedOn <= completedOn` DB check runs inside a best-effort write the
// submit path swallows, so a back-dated application must fail loudly instead
// of silently posting an inverted window to Isometric. Compares at DATE
// granularity (what gets POSTed and stamped): form-entered application dates
// are UTC midnight, so a millisecond comparison would wrongly block a
// same-UTC-day application against a mid-day run start (issue #320 caveat 4).
export function assertReportingWindowNotInverted(args: {
  lineages: { application: { applicationDate: Date; code: string } }[];
  latestApplicationTime: Date;
  earliestStartTime: Date;
}): void {
  const { lineages, latestApplicationTime, earliestStartTime } = args;
  if (formatUtcDate(latestApplicationTime) >= formatUtcDate(earliestStartTime)) {
    return;
  }
  const latestLineage = lineages.find(
    (l) =>
      l.application.applicationDate.getTime() ===
      latestApplicationTime.getTime(),
  );
  throw new SafeError(
    `Application ${latestLineage?.application.code ?? "(unknown)"} is dated ` +
      `${formatUtcDate(latestApplicationTime)}, before the earliest production ` +
      `start ${formatUtcDate(earliestStartTime)} — correct the application ` +
      "date before submitting.",
  );
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
      "Stale submission cannot be resumed because its reporting-window snapshot does not match the current schema.",
    );
  }
  if (startedOn.getTime() > completedOn.getTime()) {
    throw new SafeError(
      "Stale submission cannot be resumed because its reporting-window snapshot has an inverted window (start after end).",
    );
  }
  return { startedOn, completedOn };
}
