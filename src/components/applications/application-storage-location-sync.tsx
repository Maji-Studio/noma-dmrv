"use client";

import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusValue } from "@/components/ui/status-badge";
import {
  useApplicationStorageLocationSync,
  useSyncApplicationStorageLocation,
} from "@/hooks/use-storage-location-sync";
import { formatDateTime } from "@/lib/format-utils";
import type { ApplicationStorageLocationSyncState } from "@/fn/certification";

const STATE_PRESENTATION: Record<
  ApplicationStorageLocationSyncState,
  { badge: StatusValue; label: string; action: string }
> = {
  not_synced: {
    badge: "draft",
    label: "Not synced",
    action: "Sync storage site",
  },
  synced: { badge: "complete", label: "Synced", action: "Check for drift" },
  drifted: { badge: "pending", label: "Drifted", action: "Check again" },
  failed: { badge: "failed", label: "Sync failed", action: "Retry sync" },
};

export function ApplicationStorageLocationSync({
  applicationId,
}: {
  applicationId: string;
}) {
  const query = useApplicationStorageLocationSync(applicationId);
  const sync = useSyncApplicationStorageLocation();

  if (query.isLoading) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        Loading Storage Location status...
      </p>
    );
  }
  if (query.error || !query.data) {
    return (
      <ServerError
        message={
          query.error instanceof Error
            ? query.error.message
            : "Storage Location status could not be loaded."
        }
      />
    );
  }

  const view = query.data;
  const presentation = STATE_PRESENTATION[view.state];
  const errorMessage =
    sync.error instanceof Error ? sync.error.message : view.lastError;

  return (
    <div className="flex flex-col gap-12 border border-[var(--color-border-tertiary)] p-12">
      <div className="flex flex-wrap items-center justify-between gap-8">
        <StatusBadge
          status={presentation.badge}
          label={presentation.label}
          size="small"
        />
        {view.viewerCanManage && (
          <Button
            variant="weak"
            size="small"
            busy={sync.isPending}
            disabled={Boolean(view.blocker)}
            onClick={() => sync.mutate(applicationId)}
          >
            <ArrowsClockwiseIcon size={16} weight="bold" />
            {presentation.action}
          </Button>
        )}
      </div>

      {view.externalStorageLocationId && (
        <div className="flex flex-col gap-2">
          <span className="label-micro text-[var(--color-text-tertiary)]">
            Registry ID
          </span>
          <span className="body-caption break-all font-mono text-[var(--color-text-primary)]">
            {view.externalStorageLocationId}
          </span>
        </div>
      )}

      {view.blocker && (
        <p className="body-small text-[var(--color-text-secondary)]">
          {view.blocker}
        </p>
      )}
      {errorMessage && (
        <p className="body-small text-[var(--st-bad)]">{errorMessage}</p>
      )}
      {view.attemptedAt && (
        <p className="body-caption text-[var(--color-text-tertiary)]">
          Last checked {formatDateTime(view.attemptedAt)}
        </p>
      )}
      {view.state === "drifted" && (
        <p className="body-small text-[var(--color-text-secondary)]">
          The current customer-location details differ from the registered site.
          Review the name and coordinates. noma did not update Isometric.
        </p>
      )}
    </div>
  );
}
