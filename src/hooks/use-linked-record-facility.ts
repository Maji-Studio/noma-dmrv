"use client";

import { useEffect, useRef } from "react";
import { useFacilityContext } from "@/hooks/use-facility-context";

/** Synchronize the external facility stores before exposing a linked sheet. */
export function useLinkedRecordFacility(
  record: { facilityId?: string | null } | null | undefined,
  isLoading = false,
): boolean {
  const { facilityId, facilities, setFacilityId, isLoading: facilitiesLoading } = useFacilityContext();
  const recordFacilityId = record?.facilityId;
  const requestedSwitch = useRef<string | null>(null);
  const selectable = !!recordFacilityId && !!facilities?.some((facility) => facility.id === recordFacilityId);
  const canSwitch = !isLoading && !facilitiesLoading && selectable;

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

  // A facility that cannot be selected (archived, or beyond the loaded list) shows the record where it is.
  return !!record && !isLoading && !facilitiesLoading &&
    (!recordFacilityId || recordFacilityId === facilityId || !selectable);
}
