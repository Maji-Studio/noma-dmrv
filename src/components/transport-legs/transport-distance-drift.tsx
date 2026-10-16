"use client";

/**
 * The read-view drift notice for a feedstock or delivery distance, with its
 * deliberate "Refresh from location" correction (ADR 0034).
 *
 * Drift shows only for a derived distance whose location now has a different
 * facility distance. Overrides never drift: they are the operator's own value.
 */
import { useState } from "react";
import { ConfirmActionDialog } from "@/components/certification/confirm-action-dialog";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import type { TransportDistanceDrift } from "@/data-access/transport-distance-drift";
import { useRefreshTransportDistance, useTransportDistanceDrift } from "@/hooks/use-transport-distance-refresh";
import { formatDistanceKm } from "@/lib/format-utils";
import { toSaveErrorMessage } from "@/lib/stale-version";
import type { TransportDistanceTarget } from "@/schemas/transport-distance-refresh";

export const REFRESH_FROM_LOCATION_LABEL = "Refresh from location";
const DRIFT_TITLE = "Location distance changed";
const CONFIRM_TITLE = "Refresh distance from location?";
const REFRESH_FAILED_MESSAGE = "The distance was not refreshed. Try again.";

const RECORD_NOUNS: Record<TransportDistanceTarget["entityType"], string> = {
  feedstock: "feedstock",
  delivery: "delivery",
};

/** The drift worth showing: derived, different, and refreshable to a known value. */
export function visibleDrift(drift: TransportDistanceDrift | undefined): drift is TransportDistanceDrift & { currentDistanceKm: number } {
  return !!drift && !drift.isOverridden && drift.hasDrift && drift.currentDistanceKm != null;
}

export function driftSummary(drift: TransportDistanceDrift & { currentDistanceKm: number }): string {
  const recorded = drift.recordedDistanceKm == null
    ? "No distance recorded."
    : `Recorded ${formatDistanceKm(drift.recordedDistanceKm)}.`;
  return `${recorded} Location now ${formatDistanceKm(drift.currentDistanceKm)}.`;
}

interface TransportDistanceDriftNoticeProps {
  target: TransportDistanceTarget;
  /** Stable record code for the confirmation toast. */
  recordCode: string;
}

export function TransportDistanceDriftNotice({ target, recordCode }: TransportDistanceDriftNoticeProps) {
  const drift = useTransportDistanceDrift(target);
  const refresh = useRefreshTransportDistance(target.entityType);
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = drift.data;
  if (!visibleDrift(data)) return null;

  const noun = RECORD_NOUNS[target.entityType];
  const close = () => {
    setConfirming(false);
    setError(null);
  };
  const confirm = async () => {
    setError(null);
    try {
      const refreshed = await refresh.mutateAsync({ entityId: target.entityId, expectedVersion: data.expectedVersion });
      close();
      toast.success(`Distance for ${recordCode} refreshed to ${formatDistanceKm(refreshed.recordedDistanceKm)}.`);
    } catch (refusal) {
      setError(toSaveErrorMessage(refusal, REFRESH_FAILED_MESSAGE));
      // A refused version or a new lock changes what the next attempt sees.
      void drift.refetch();
    }
  };

  return (
    <>
      <Notice
        tone="warning"
        title={DRIFT_TITLE}
        data-testid="transport-distance-drift"
        action={
          <Button type="button" size="small" variant="default" onClick={() => setConfirming(true)}>
            {REFRESH_FROM_LOCATION_LABEL}
          </Button>
        }
      >
        {driftSummary(data)}
      </Notice>
      <ConfirmActionDialog
        isOpen={confirming}
        onClose={close}
        onConfirm={() => void confirm()}
        title={CONFIRM_TITLE}
        body={
          <div className="flex flex-col gap-12">
            <p>
              {data.recordedDistanceKm == null
                ? `The ${noun} records ${formatDistanceKm(data.currentDistanceKm)}, and its transport is recalculated.`
                : `The recorded distance changes from ${formatDistanceKm(data.recordedDistanceKm)} to ${formatDistanceKm(data.currentDistanceKm)}, and the ${noun}'s transport is recalculated.`}
            </p>
            {data.hasSubmittedRemoval && (
              <Notice tone="error" title="Feeds a submitted Removal">
                {`This ${noun} feeds a submitted Removal, so its transport data is locked. Ask an Organization Admin to review the linked Removal.`}
              </Notice>
            )}
          </div>
        }
        confirmLabel={REFRESH_FROM_LOCATION_LABEL}
        busyLabel="Refreshing…"
        variant="neutral"
        isPending={refresh.isPending}
        confirmDisabled={data.hasSubmittedRemoval}
        errorMessage={error ?? undefined}
      />
    </>
  );
}
