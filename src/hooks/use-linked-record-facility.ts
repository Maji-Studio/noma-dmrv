"use client";

import { useEffect, useRef } from "react";
import { useFacility } from "@/hooks/use-facilities";
import { useFacilityContext } from "@/hooks/use-facility-context";

/**
 * Why a linked record opens read only: its facility is archived, or the
 * facility read failed and nothing can show it is active (fail closed).
 */
export type LinkedRecordReadOnly =
  | { reason: "archived"; facilityId: string; facilityName: string; timezone: string }
  | { reason: "unchecked"; facilityId: string; retry: () => void; retrying: boolean };

/** What a list page needs to open a linked record's sheet. */
export type LinkedRecordFacility = {
  /** The record loaded and the facility selection settled, so the sheet may open. */
  ready: boolean;
  /**
   * Set when the record's facility cannot be worked in. The sheet then opens
   * read only over the current page and the working facility stays where it is.
   */
  readOnly: LinkedRecordReadOnly | null;
};

/** Synchronize the external facility stores before exposing a linked sheet. */
export function useLinkedRecordFacility(
  record: { facilityId?: string | null } | null | undefined,
  isLoading = false,
): LinkedRecordFacility {
  const {
    activeOrganizationId,
    facilityId,
    facilities,
    setFacilityId,
    isLoading: facilitiesLoading,
  } = useFacilityContext();
  const recordFacilityId = record?.facilityId;
  const requestedSwitch = useRef<string | null>(null);
  const selectable = !!recordFacilityId && !!facilities?.some((facility) => facility.id === recordFacilityId);
  const canSwitch = !isLoading && !facilitiesLoading && selectable;
  // A facility outside the selectable list is read by id (org-scoped) to learn
  // whether it is archived. The provider shares this query for `?facility=`.
  const needsLookup = !!recordFacilityId && !isLoading && !facilitiesLoading && !selectable;
  const lookup = useFacility(recordFacilityId ?? "", needsLookup, activeOrganizationId);
  const lookupSettled = !needsLookup || activeOrganizationId === null || lookup.data?.id === recordFacilityId || lookup.isError;

  // URL, localStorage and sidebar selection are owned by the context setter.
  useEffect(() => {
    if (!recordFacilityId || recordFacilityId === facilityId) {
      requestedSwitch.current = null;
      return;
    }
    const request = `${facilityId}:${recordFacilityId}`;
    if (canSwitch && requestedSwitch.current !== request) {
      requestedSwitch.current = request;
      setFacilityId(recordFacilityId);
    }
  }, [canSwitch, facilityId, recordFacilityId, setFacilityId]);

  const facilityRead = needsLookup && lookup.data?.id === recordFacilityId ? lookup.data : undefined;
  const unchecked: LinkedRecordReadOnly | null = recordFacilityId
    ? { reason: "unchecked", facilityId: recordFacilityId, retry: () => void lookup.refetch(), retrying: lookup.isFetching }
    : null;
  // A failed refetch fails closed even while cached data exists: the cache
  // may be older than an archive nobody could read.
  const readOnly: LinkedRecordReadOnly | null = !needsLookup || !recordFacilityId
    ? null
    : lookup.isRefetchError
      ? unchecked
      : facilityRead
        ? facilityRead.archivedAt != null
          ? { reason: "archived", facilityId: facilityRead.id, facilityName: facilityRead.name, timezone: facilityRead.timezone }
          : null
        : lookup.isError || activeOrganizationId === null
          ? unchecked
          : null;
  // A facility that cannot be selected (archived, or beyond the loaded list)
  // shows the record where it is, once its read settles. An archived facility,
  // or one whose read failed, opens the record read only.
  const ready = !!record && !isLoading && !facilitiesLoading &&
    (!recordFacilityId || recordFacilityId === facilityId || (!selectable && lookupSettled));
  return { ready, readOnly: ready ? readOnly : null };
}
