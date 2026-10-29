"use client";

import { useEffect, useRef } from "react";
import { useFacility } from "@/hooks/use-facilities";
import { useFacilityContext } from "@/hooks/use-facility-context";

/** What a list page needs to open a linked record's sheet. */
export type LinkedRecordFacility = {
  /** The record loaded and the facility selection settled, so the sheet may open. */
  ready: boolean;
  /**
   * The record's facility when it is archived. The sheet then opens read only
   * over the current page and the working facility stays where it is.
   */
  archivedFacility: { id: string; name: string } | null;
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

  const archived = needsLookup && lookup.data?.id === recordFacilityId && lookup.data.archivedAt != null
    ? { id: lookup.data.id, name: lookup.data.name }
    : null;
  // A facility that cannot be selected (archived, or beyond the loaded list)
  // shows the record where it is; an archived one only once that is known.
  const ready = !!record && !isLoading && !facilitiesLoading &&
    (!recordFacilityId || recordFacilityId === facilityId || (!selectable && lookupSettled));
  return { ready, archivedFacility: ready ? archived : null };
}
