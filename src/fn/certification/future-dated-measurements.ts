/**
 * Future-dated measurement detection — the readiness-side half of the
 * submit-time guard `assertRemovalDatesNotFuture`
 * (`./removal-reporting-window.ts`).
 *
 * The submit pipeline refuses a removal whose Sample `measured_at`, latest
 * production-run end, or GHG entry `completed_on` (the latest biochar
 * application, §8.6.2) is still in the future. Those guards run during
 * compilation or submission, so without this module the operator only learns
 * the dates are wrong after clicking submit. This computes the same verdict
 * server-side, against the same `>` comparison on raw milliseconds, and ships
 * it on the Certify context as a plain blocker list so the pure (clock-free)
 * readiness classifier can render it as a red pre-submit check.
 *
 * Deliberately reports EVERY offending run/application rather than only the
 * latest one the guard trips on: naming the record is what makes the row
 * actionable. The verdict is identical either way — if any date is in the
 * future, so is the maximum.
 */
import { formatUtcDate } from "@/lib/date-utils";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";

type FutureDateRun = Pick<ProductionRunWithSamples, "code" | "endTime">;
type FutureDateSample = { sampleCode: string; samplingTime: Date };
type FutureDateLineage = {
  application: { applicationDate: Date; code: string };
};

/**
 * Blocker sentences for every production-run end time and biochar application
 * date that falls after `now`. Empty ⇒ the removal's dates have all happened.
 *
 * Runs with no end time are skipped: an open run is a different blocker, owned
 * by `aggregateProductionRuns` ("complete the run before it can be certified").
 */
export function collectFutureDatedMeasurements(args: {
  runs: FutureDateRun[];
  samples?: FutureDateSample[];
  lineages: FutureDateLineage[];
  now?: Date;
}): string[] {
  const { runs, samples = [], lineages, now = new Date() } = args;
  const nowMs = now.getTime();
  const blockers: string[] = [];

  for (const run of runs) {
    if (run.endTime && run.endTime.getTime() > nowMs) {
      blockers.push(
        `Production run ${run.code} ends on ${formatUtcDate(run.endTime)}. ` +
          "Change the end time or wait until the run ends.",
      );
    }
  }

  for (const sample of samples) {
    if (sample.samplingTime.getTime() > nowMs) {
      blockers.push(
        `Sample ${sample.sampleCode} is dated ${formatUtcDate(sample.samplingTime)}. ` +
          "Change the sampling time or wait until then.",
      );
    }
  }

  for (const { application } of lineages) {
    if (application.applicationDate.getTime() > nowMs) {
      blockers.push(
        `Application ${application.code} is dated ` +
          `${formatUtcDate(application.applicationDate)}. ` +
          "Change the application date or wait until then.",
      );
    }
  }

  // A run or application reachable through several lineages must not produce a
  // duplicated row.
  return Array.from(new Set(blockers));
}
