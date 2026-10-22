"use client";

import { useState } from "react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms/server-error";
import { ConfirmActionDialog } from "@/components/certification/confirm-action-dialog";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { MISSING_VALUE, formatCount } from "@/lib/copy-utils";
import type { MethodBEligibility } from "@/lib/certification/method-b-eligibility";
import {
  useMethodBEligibility,
  useStartNewProductionProcess,
} from "@/hooks/use-production-processes";

const MOISTURE_PATHWAY_LABELS: Record<string, string> = {
  dry_weight_every_batch: "Dry weight for every batch",
  consistent_target_moisture: "Consistent target moisture",
  measured_every_batch: "Moisture measured for every batch",
};

/** Why unsampled batches are not open yet: the Samples still short and the prerequisites still missing. */
function unsampledGap(status: Pick<MethodBEligibility, "eligibleSampleCount" | "agreedBaselineSize" | "prerequisitesRecorded">): string {
  const short = Math.max(0, status.agreedBaselineSize - status.eligibleSampleCount);
  const needs = [
    short > 0 ? `${formatCount(short, "more Sample")}` : null,
    status.prerequisitesRecorded ? null : "the Method-B prerequisites",
  ].filter((need): need is string => need !== null);
  return needs.length > 0 ? `Needs ${needs.join(" and ")}` : "Not open yet";
}

interface FeedstockTypeSamplingProps {
  facilityId: string;
  feedstockTypeId: string;
  canManage: boolean;
}

export function FeedstockTypeSampling({
  facilityId,
  feedstockTypeId,
  canManage,
}: FeedstockTypeSamplingProps) {
  const eligibility = useMethodBEligibility(facilityId, feedstockTypeId);
  const startNewProcess = useStartNewProductionProcess();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleStartNewProcess = async () => {
    setActionError(null);
    try {
      await startNewProcess.mutateAsync({ facilityId, feedstockTypeId });
      setConfirmOpen(false);
      toast.success("New production process started");
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The production process was not started. Try again.",
      );
    }
  };

  if (eligibility.isLoading) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        Loading sampling status…
      </p>
    );
  }

  if (eligibility.error || !eligibility.data) {
    return (
      <ServerError
        message={eligibility.error?.message ?? "The sampling status could not be loaded. Refresh the page and try again."}
      />
    );
  }

  const status = eligibility.data;
  const moisturePathway = status.moisturePathway
    ? MOISTURE_PATHWAY_LABELS[status.moisturePathway] ?? status.moisturePathway
    : MISSING_VALUE.notRecorded;

  return (
    <div
      className="flex flex-col gap-16 border border-[var(--color-border-tertiary)] bg-[var(--color-background-medium)] p-16"
      data-testid="feedstock-type-sampling"
    >
      <div className="grid grid-cols-1 gap-16 sm:grid-cols-2">
        <div className="flex flex-col gap-4">
          <span className="body-small text-[var(--color-text-secondary)]">
            Eligible Samples
          </span>
          <span className="body-medium font-medium tabular-nums text-[var(--color-text-primary)]">
            {status.eligibleSampleCount} / {status.agreedBaselineSize}
          </span>
        </div>
        <div className="flex flex-col gap-4">
          <span className="body-small text-[var(--color-text-secondary)]">
            Unsampled batches
          </span>
          <span className="body-medium font-medium text-[var(--color-text-primary)]">
            {status.unsampledAllowed ? "Available" : unsampledGap(status)}
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-12 border-t border-[var(--color-border-tertiary)] pt-12 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <dt className="body-caption text-[var(--color-text-tertiary)]">
            Random sampling plan
          </dt>
          <dd className="body-small text-[var(--color-text-secondary)]">
            {status.randomSamplingPlanRef ?? MISSING_VALUE.notRecorded}
          </dd>
        </div>
        <div className="flex flex-col gap-2">
          <dt className="body-caption text-[var(--color-text-tertiary)]">
            Moisture pathway
          </dt>
          <dd className="body-small text-[var(--color-text-secondary)]">
            {moisturePathway}
          </dd>
        </div>
      </dl>

      {canManage && (
        <div className="border-t border-[var(--color-border-tertiary)] pt-12">
          <Button variant="weak" size="small" onClick={() => setConfirmOpen(true)}>
            <ArrowCounterClockwiseIcon size={16} weight="bold" />
            Start new process
          </Button>
        </div>
      )}

      <ConfirmActionDialog
        isOpen={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          setActionError(null);
        }}
        onConfirm={handleStartNewProcess}
        title="Start a new production process?"
        body="This resets the eligible Sample count for this facility and feedstock type to zero. Existing credit batches keep their recorded sampling choice."
        confirmLabel="Start new process"
        variant="neutral"
        isPending={startNewProcess.isPending}
        errorMessage={actionError ?? undefined}
      />
    </div>
  );
}
