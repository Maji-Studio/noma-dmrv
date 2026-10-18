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

type VisibleDrift = TransportDistanceDrift & { currentDistanceKm: number };

/**
 * The one confirmation for a deliberate refresh from location, shared by the
 * read view's notice and the edit form's compact action.
 */
function DistanceRefreshDialog({
  open, onClose, target, drift, recordCode, onRefused, onRefreshed,
}: {
  open: boolean;
  onClose: () => void;
  target: TransportDistanceTarget;
  drift: VisibleDrift;
  recordCode: string;
  /** A refused version or a new lock changes what the next attempt sees. */
  onRefused: () => void;
  onRefreshed?: (refreshed: TransportDistanceDrift) => void;
}) {
  const refresh = useRefreshTransportDistance(target.entityType);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const noun = RECORD_NOUNS[target.entityType];
  const close = () => {
    setError(null);
    onClose();
  };
  const confirm = async () => {
    setError(null);
    try {
      const refreshed = await refresh.mutateAsync({ entityId: target.entityId, expectedVersion: drift.expectedVersion });
      close();
      toast.success(`Distance for ${recordCode} refreshed to ${formatDistanceKm(refreshed.recordedDistanceKm)}.`);
      onRefreshed?.(refreshed);
    } catch (refusal) {
      setError(toSaveErrorMessage(refusal, REFRESH_FAILED_MESSAGE));
      onRefused();
    }
  };

  return (
    <ConfirmActionDialog
      isOpen={open}
      onClose={close}
      onConfirm={() => void confirm()}
      title={CONFIRM_TITLE}
      body={
        <div className="flex flex-col gap-12">
          <p>
            {drift.recordedDistanceKm == null
              ? `The ${noun} records ${formatDistanceKm(drift.currentDistanceKm)}, the location's current distance, and its transport is recalculated.`
              : `The recorded distance changes from ${formatDistanceKm(drift.recordedDistanceKm)} to ${formatDistanceKm(drift.currentDistanceKm)}, the location's current distance, and the ${noun}'s transport is recalculated.`}
          </p>
          {drift.hasSubmittedRemoval && (
            <Notice tone="error" title="Locked by a submitted Removal">
              {`This ${noun} feeds a submitted Removal, so its distance cannot be refreshed. Ask an Organization Admin to review the linked Removal.`}
            </Notice>
          )}
        </div>
      }
      confirmLabel={REFRESH_FROM_LOCATION_LABEL}
      busyLabel="Refreshing…"
      isPending={refresh.isPending}
      confirmDisabled={drift.hasSubmittedRemoval}
      errorMessage={error ?? undefined}
    />
  );
}

interface TransportDistanceDriftNoticeProps {
  target: TransportDistanceTarget;
  /** Stable record code for the confirmation toast. */
  recordCode: string;
}

/** Read view: a warning notice with the drift and its refresh action. */
export function TransportDistanceDriftNotice({ target, recordCode }: TransportDistanceDriftNoticeProps) {
  const drift = useTransportDistanceDrift(target);
  const [confirming, setConfirming] = useState(false);
  const data = drift.data;
  if (!visibleDrift(data)) return null;

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
      <DistanceRefreshDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        target={target}
        drift={data}
        recordCode={recordCode}
        onRefused={() => void drift.refetch()}
      />
    </>
  );
}

export const SAVE_BEFORE_REFRESH_REASON = "Save or discard your changes first.";

interface DistanceDriftActionProps extends TransportDistanceDriftNoticeProps {
  /** Why the action is unavailable, shown beside it (unsaved form edits). */
  disabledReason?: string | null;
  /** The refresh committed a new version: the form must reload the record. */
  onRefreshed: (refreshed: TransportDistanceDrift) => void;
}

/**
 * Edit form: one compact line under the derived distance, "Location now
 * 55 km." with a small Refresh from location action and the same dialog.
 */
export function DistanceDriftAction({ target, recordCode, disabledReason, onRefreshed }: DistanceDriftActionProps) {
  const drift = useTransportDistanceDrift(target);
  const [confirming, setConfirming] = useState(false);
  const data = drift.data;
  if (!visibleDrift(data)) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-8" data-testid="transport-distance-drift-action">
      <p className="body-caption text-[var(--color-text-secondary)]">
        {`Location now ${formatDistanceKm(data.currentDistanceKm)}.`}
        {disabledReason ? ` ${disabledReason}` : ""}
      </p>
      <Button
        type="button"
        size="small"
        variant="noOutline"
        disabled={!!disabledReason}
        onClick={() => setConfirming(true)}
      >
        {REFRESH_FROM_LOCATION_LABEL}
      </Button>
      <DistanceRefreshDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        target={target}
        drift={data}
        recordCode={recordCode}
        onRefused={() => void drift.refetch()}
        onRefreshed={onRefreshed}
      />
    </div>
  );
}
