/**
 * FeedstockProcessChip
 *
 * Shows the production process a declared feedstock type resolves to, and its
 * effective sampling method (Method A/B) for the entered batch start date plus
 * progress toward the Method-B baseline.
 * The process (keyed by facility + feedstock type) carries the method, cadence,
 * and borrow pool (ADR 0016/0017), so picking the feedstock surfaces the
 * durability method up front — before any run is assigned. A brand-new
 * (facility, feedstock) pair has no process row yet → treat as Method A, 0/N.
 */
"use client";

import { useProductionProcessesByFacility } from "@/hooks/use-production-processes";
import { METHOD_B_MINIMUM_METHOD_A_SAMPLES } from "@/config/certification";
import { deriveBatchSamplingMethod } from "@/lib/certification/sampling-requirements";

export function FeedstockProcessChip({
  facilityId,
  feedstockTypeId,
  batchStartDate,
}: {
  facilityId?: string;
  feedstockTypeId?: string;
  batchStartDate?: string | Date;
}) {
  const { data: processes } = useProductionProcessesByFacility(
    facilityId || undefined,
  );

  if (!facilityId || !feedstockTypeId) return null;

  const process = processes?.find(
    (candidate) => candidate.feedstockTypeId === feedstockTypeId,
  );
  const effectiveMethod =
    process && batchStartDate
      ? deriveBatchSamplingMethod({
          processMethod: process.samplingMethod,
          methodBUnlockedAt: process.methodBUnlockedAt,
          batchStartDate,
        })
      : process?.samplingMethod ?? "method_a";
  const isMethodB = effectiveMethod === "method_b";
  const isHistoricalMethodA =
    process?.samplingMethod === "method_b" && effectiveMethod === "method_a";
  const count = process?.eligibleSampleCount ?? 0;
  const target = process?.baselineTarget ?? METHOD_B_MINIMUM_METHOD_A_SAMPLES;
  const meetsBaseline = process?.meetsBaseline ?? false;
  const progress = target > 0 ? Math.min(1, count / target) : 0;

  const detail = isHistoricalMethodA
    ? "Historical batch — Method A applies because its start date is on or before the Method B unlock date."
    : isMethodB
      ? "Measured durability — Method B is unlocked for this process."
      : !process
        ? `New production process — 0/${target} eligible samples toward Method B.`
        : meetsBaseline
          ? `${count}/${target} eligible samples — ready to unlock Method B.`
          : `${count}/${target} eligible samples toward Method B.`;

  return (
    <div className="flex flex-col gap-8 mt-8 p-12 border border-[var(--color-border-tertiary)] bg-[var(--color-background-sunken)]">
      <div className="flex items-center gap-8">
        <span
          className={`inline-flex items-center px-8 py-2 body-caption font-medium ${
            isMethodB
              ? "bg-[var(--color-signal-green-light)] text-[var(--color-signal-green)]"
              : "bg-[var(--clr-purple-10)] text-[var(--clr-purple)]"
          }`}
        >
          {isMethodB ? "Method B" : "Method A"}
        </span>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {detail}
        </span>
      </div>
      {!isMethodB && (
        <div
          className="h-4 bg-[var(--color-background-medium)]"
          role="progressbar"
          aria-valuenow={count}
          aria-valuemin={0}
          aria-valuemax={target}
          aria-label="Eligible samples toward Method B"
        >
          <div
            className="h-full bg-[var(--clr-purple)]"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
