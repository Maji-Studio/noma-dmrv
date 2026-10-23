/**
 * Saved locations of a customer in the edit sheet: active locations first,
 * archived ones in their own muted group below. Delete is the one action: it
 * removes an unused location and archives a used one (stored orders keep it),
 * then says which happened. Archived locations can be restored.
 */
"use client";

import { useState } from "react";
import {
  ArrowCounterClockwiseIcon,
  CaretDownIcon,
  MapPinIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Collapsible } from "@base-ui/react/collapsible";
import { FormSection, ServerError } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { ICON_BUTTON_TOUCH_PROPS } from "@/components/ui/touch-target";
import { DefaultLocationBadge } from "@/components/ui/default-location-badge";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { InUseDeleteDialog } from "@/components/ui/in-use-delete-dialog";
import { isInUseDeleteRefusal } from "@/lib/delete-refusal";
import { useToast } from "@/components/ui/toast";
import { InfoHint } from "@/components/ui/tooltip";
import {
  useArchiveCustomerLocation,
  useCustomerLocations,
  useDeleteCustomerLocation,
  useRestoreCustomerLocation,
} from "@/hooks/use-customers";
import { useLocationEditIntent } from "@/hooks/use-location-edit-intent";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { toArchiveRestoreErrorMessage, toDeleteErrorMessage } from "@/lib/stale-version";
import { CustomerLocationDialog } from "./customer-location-dialog";
import type { EditableCustomerLocation } from "./customer-location-form";

type SavedLocation = EditableCustomerLocation & { archivedAt: Date | null };

const ICON_SIZE = 16;

const ARCHIVED_HINT = "Pickers hide these. Existing orders keep them. Restore a location to edit it.";

/** Why a refused delete was archived instead, taken from the refusal's own wording. */
const STORAGE_SITE_MARKER = "storage site";
const usedByPhrase = (refusal: unknown) =>
  refusal instanceof Error && refusal.message.includes(STORAGE_SITE_MARKER) ? "a registered storage site" : "used by orders";
const archivedInsteadMessage = (name: string, refusal: unknown) => {
  const reason = usedByPhrase(refusal);
  return `${name} is ${reason}, so it was archived. Restore it from Archived locations.`;
};

/** An in-use refusal for the only active location: neither Delete nor Archive can work yet. */
const onlyActiveInUseMessage = (name: string) =>
  `${name} cannot be deleted because orders use it, and it cannot be archived because it is the only active location. Add another location first, then archive this one.`;

/**
 * Second line of a saved location row: the site description and the position,
 * whichever are on file. The site description is optional, so a location saved
 * from GPS alone shows only its coordinates, and a row with neither falls back
 * to the shared missing-value token rather than a hand-written string.
 */
function formatSavedLocationSummary({
  address,
  gpsLatitude,
  gpsLongitude,
}: Pick<SavedLocation, "address" | "gpsLatitude" | "gpsLongitude">): string {
  const position =
    gpsLatitude !== null && gpsLongitude !== null
      ? `${gpsLatitude.toFixed(4)}, ${gpsLongitude.toFixed(4)}`
      : null;
  const parts = [address?.trim() || null, position].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : MISSING_VALUE.notRecorded;
}

function LocationIdentity({ location }: { location: SavedLocation }) {
  return (
    <div className="flex items-center gap-10 min-w-0">
      <MapPinIcon size={ICON_SIZE} className="shrink-0 text-[var(--color-text-tertiary)]" />
      <div className="min-w-0">
        <p className="body-small font-medium flex items-center gap-8 min-w-0">
          <span className="truncate">{location.name}</span>
          {location.isDefault ? <DefaultLocationBadge /> : null}
        </p>
        <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] truncate">
          {formatSavedLocationSummary(location)}
        </p>
      </div>
    </div>
  );
}

const ROW_CLASS = "flex items-center justify-between gap-12 px-12 py-8 border border-[var(--color-border-tertiary)]";

export function CustomerSavedLocations({ customerId }: { customerId: string }) {
  const toast = useToast();
  // `editingLocation` is deliberately not cleared on close: the modal keeps its
  // subtree mounted for the exit transition, so clearing it there would flip the
  // dialog title and submit label to the "Add" wording mid-fade. Opening the add
  // dialog clears it instead.
  const [isLocationDialogOpen, setIsLocationDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<SavedLocation | null>(null);
  const [deletingLocation, setDeletingLocation] = useState<SavedLocation | null>(null);
  const [deleteConflict, setDeleteConflict] = useState<SavedLocation | null>(null);
  // A used location that cannot be archived (the only active one, or already archived): the dialog explains and offers no Archive.
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  const { data: locations, isLoading, isError } = useCustomerLocations(customerId);
  const deleteLocation = useDeleteCustomerLocation(customerId);
  const archiveLocation = useArchiveCustomerLocation(customerId);
  const restoreLocation = useRestoreCustomerLocation(customerId);

  const activeLocations = (locations ?? []).filter((location) => !location.archivedAt);
  const archivedLocations = (locations ?? []).filter((location) => location.archivedAt);
  // The last active location cannot be archived: a customer always keeps one destination for new orders.
  const isOnlyActive = activeLocations.length === 1;

  useLocationEditIntent(locations, (location) => {
    // An archived location is read-only: restore it before editing.
    if (location.archivedAt) return;
    setEditingLocation(location);
    setIsLocationDialogOpen(true);
  });

  // Act on the list's current row: the snapshot a notice or dialog holds goes stale after a refused version.
  const currentVersion = (location: SavedLocation) =>
    locations?.find((row) => row.id === location.id)?.version ?? location.version;

  const showWarnings = (warnings: string[] | undefined) => {
    if (warnings?.length) toast.warning(warnings.join(" "));
  };

  const handleRestore = async (location: SavedLocation) => {
    setLifecycleError(null);
    try {
      const saved = await restoreLocation.mutateAsync({ locationId: location.id, expectedVersion: currentVersion(location) });
      toast.success(`${location.name} restored.`);
      showWarnings(saved?.warnings);
    } catch (error) {
      setLifecycleError(toArchiveRestoreErrorMessage(error, `Location ${location.name}`, "restore", "The location was not restored. Try again."));
    }
  };

  // A used location is archived in the same step, so Delete stays the only action.
  // An archived one, or the only active one, cannot be archived: the in-use dialog explains.
  const archiveInstead = async (target: SavedLocation, refusal: unknown) => {
    const row = locations?.find((candidate) => candidate.id === target.id);
    if (target.archivedAt || row?.archivedAt || isOnlyActive) {
      setDeleteConflict(target);
      return;
    }
    try {
      // The version the operator confirmed: the server just matched it before refusing the delete as in use, so it is current.
      // (The render's list is stale inside this handler, so it is not re-read here.)
      const saved = await archiveLocation.mutateAsync({ locationId: target.id, expectedVersion: target.version });
      toast.success(archivedInsteadMessage(target.name, refusal));
      showWarnings(saved?.warnings);
    } catch (error) {
      toast.error(toArchiveRestoreErrorMessage(error, `Location ${target.name}`, "archive", "The location was not archived. Try again."));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingLocation) return;
    const target = deletingLocation;
    setLifecycleError(null);
    try {
      // The version the operator confirmed: a newer one means someone else changed it, so the delete is refused.
      const deleted = await deleteLocation.mutateAsync({ locationId: target.id, expectedVersion: target.version });
      setDeletingLocation(null);
      toast.success(`${target.name} deleted.`);
      showWarnings(deleted?.warnings);
    } catch (error) {
      const message = toDeleteErrorMessage(error, `Location ${target.name}`, "Location was not deleted. Try again.");
      setDeletingLocation(null);
      if (isInUseDeleteRefusal(error)) {
        await archiveInstead(target, error);
        return;
      }
      toast.error(message);
    }
  };

  const openAdd = () => {
    setEditingLocation(null);
    setIsLocationDialogOpen(true);
  };

  return (
    <FormSection
      title="Locations"
      actions={
        <Button variant="noOutline" size="small" onClick={openAdd} className="text-[var(--color-interaction)]">
          <PlusIcon size={14} weight="bold" />
          Add location
        </Button>
      }
    >
      {isLoading ? (
        <p className="body-small text-[var(--color-text-tertiary)]">Loading locations...</p>
      ) : isError ? (
        <p className="body-small text-[var(--color-signal-red)]" role="alert" aria-live="assertive" aria-atomic="true">
          Locations could not be loaded. Refresh the page and try again.
        </p>
      ) : !locations || locations.length === 0 ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          No locations yet. Add one to use in orders and deliveries.
        </p>
      ) : (
        <div className="flex flex-col gap-16">
          <div className="flex flex-col gap-8">
            {activeLocations.map((loc) => (
              <div key={loc.id} className={`${ROW_CLASS} bg-[var(--color-surface-light)]`}>
                <LocationIdentity location={loc} />
                <div className="flex shrink-0 items-center gap-12">
                  <Button
                    variant="noOutline"
                    {...ICON_BUTTON_TOUCH_PROPS}
                    onClick={() => {
                      setEditingLocation(loc);
                      setIsLocationDialogOpen(true);
                    }}
                    aria-label={`Edit ${loc.name || loc.country}`}
                  >
                    <PencilIcon size={ICON_SIZE} />
                  </Button>
                  <Button
                    variant="destructive"
                    {...ICON_BUTTON_TOUCH_PROPS}
                    onClick={() => setDeletingLocation(loc)}
                    aria-label={`Delete ${loc.name || loc.country}`}
                  >
                    <TrashIcon size={ICON_SIZE} />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {archivedLocations.length > 0 && (
            <Collapsible.Root role="group" aria-label="Archived locations" className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <Collapsible.Trigger className="group flex min-h-24 cursor-pointer items-center gap-6 rounded-[4px] body-small font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]">
                  Archived locations ({archivedLocations.length})
                  <CaretDownIcon
                    size={14}
                    weight="bold"
                    className="text-[var(--color-text-tertiary)] transition-transform duration-200 group-data-[panel-open]:rotate-180"
                  />
                </Collapsible.Trigger>
                <InfoHint label="About archived locations">{ARCHIVED_HINT}</InfoHint>
              </div>
              <Collapsible.Panel>
                <ul className="flex flex-col">
                  {archivedLocations.map((loc) => (
                    <li key={loc.id} className="flex min-h-44 items-center justify-between gap-12 px-12 py-4 text-[var(--color-text-tertiary)]">
                      <span className="body-small truncate">{loc.name || loc.country}</span>
                      <div className="flex shrink-0 items-center gap-12">
                        <Button
                          variant="noOutline"
                          {...ICON_BUTTON_TOUCH_PROPS}
                          onClick={() => handleRestore(loc)}
                          disabled={restoreLocation.isPending}
                          aria-label={`Restore ${loc.name || loc.country}`}
                        >
                          <ArrowCounterClockwiseIcon size={ICON_SIZE} />
                        </Button>
                        <Button
                          variant="destructive"
                          {...ICON_BUTTON_TOUCH_PROPS}
                          onClick={() => setDeletingLocation(loc)}
                          aria-label={`Delete ${loc.name || loc.country}`}
                        >
                          <TrashIcon size={ICON_SIZE} />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </Collapsible.Panel>
            </Collapsible.Root>
          )}
        </div>
      )}

      {deleteConflict && (
        <InUseDeleteDialog
          label={deleteConflict.name}
          onClose={() => {
            setDeleteConflict(null);
            setLifecycleError(null);
          }}
          errorMessage={lifecycleError}
        >
          {deleteConflict.archivedAt ? undefined : <p>{onlyActiveInUseMessage(deleteConflict.name)}</p>}
        </InUseDeleteDialog>
      )}

      {lifecycleError && !deleteConflict && <ServerError message={lifecycleError} />}

      <CustomerLocationDialog
        isOpen={isLocationDialogOpen}
        onClose={() => setIsLocationDialogOpen(false)}
        customerId={customerId}
        location={editingLocation ?? undefined}
        isFirstLocation={!isLoading && !isError && activeLocations.length === 0}
      />

      <DeleteConfirmDialog
        isOpen={!!deletingLocation}
        title="Delete location"
        message="Are you sure you want to delete this location? A location that is in use is archived instead, and you can restore it."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletingLocation(null)}
        isPending={deleteLocation.isPending || archiveLocation.isPending}
      />
    </FormSection>
  );
}
