/**
 * FacilityProvider
 * Wraps the app to provide a global facility selection context.
 * Uses URL query param + localStorage with fallback-to-first selection.
 */
"use client";

import { type ReactNode, useEffect, useMemo } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { useFacilities, useFacility } from "@/hooks/use-facilities";
import { FacilityContext, type FacilityContextValue } from "@/hooks/use-facility-context";

const FACILITY_STORAGE_KEY = "noma:selected-facility-id";

function readStoredFacilityId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(FACILITY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredFacilityId(facilityId: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (!facilityId) {
      window.localStorage.removeItem(FACILITY_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(FACILITY_STORAGE_KEY, facilityId);
  } catch {
    // Ignore storage failures (e.g. private mode or blocked storage).
  }
}

export function FacilityProvider({ children }: { children: ReactNode }) {
  const [facilityId, setFacilityId] = useQueryState(
    "facility",
    parseAsString.withOptions({ shallow: true, history: "replace" })
  );

  // Keep within schema limit (max 100) so the sidebar facilities query does not fail.
  const { data: facilitiesData, isLoading, isError } = useFacilities({ pageSize: 100 });
  const facilities = useMemo(() => facilitiesData?.items ?? [], [facilitiesData]);
  const hasFacilityInList = facilityId
    ? facilities.some((facility) => facility.id === facilityId)
    : false;
  const shouldLoadSelectedFacility = Boolean(
    facilityId && !hasFacilityInList && !isLoading
  );
  const {
    data: selectedFacilityById,
    isLoading: isSelectedFacilityLoading,
  } = useFacility(facilityId ?? "", shouldLoadSelectedFacility);
  const selectedFacilityFromLookup =
    selectedFacilityById && selectedFacilityById.archivedAt == null
      ? selectedFacilityById
      : undefined;

  // Resolve facility selection from URL -> localStorage -> first facility.
  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (facilities.length === 0) {
      if (facilityId) {
        void setFacilityId(null);
      }
      writeStoredFacilityId(null);
      return;
    }

    if (facilityId && !hasFacilityInList) {
      if (isSelectedFacilityLoading) {
        return;
      }

      if (selectedFacilityFromLookup) {
        writeStoredFacilityId(facilityId);
        return;
      }
    }

    let nextFacilityId = hasFacilityInList ? facilityId : null;

    if (!nextFacilityId) {
      const storedFacilityId = readStoredFacilityId();
      const hasStoredFacility = storedFacilityId
        ? facilities.some((facility) => facility.id === storedFacilityId)
        : false;

      nextFacilityId = hasStoredFacility ? storedFacilityId : facilities[0].id;
    }

    if (nextFacilityId && facilityId !== nextFacilityId) {
      void setFacilityId(nextFacilityId);
    }

    writeStoredFacilityId(nextFacilityId);
  }, [
    isLoading,
    facilities,
    facilityId,
    hasFacilityInList,
    isSelectedFacilityLoading,
    selectedFacilityFromLookup,
    setFacilityId,
  ]);

  const hasSelectedFacility =
    hasFacilityInList || Boolean(facilityId && selectedFacilityFromLookup);
  const resolvedFacilityId =
    hasSelectedFacility ? facilityId : facilities[0]?.id ?? null;
  const selectedFacility =
    facilities.find((f) => f.id === resolvedFacilityId) ??
    selectedFacilityFromLookup;
  const availableFacilities =
    selectedFacilityFromLookup && !hasFacilityInList
      ? [selectedFacilityFromLookup, ...facilities]
      : facilities;

  const value: FacilityContextValue = {
    facilityId: resolvedFacilityId,
    setFacilityId: (id: string | null) => {
      writeStoredFacilityId(id);
      void setFacilityId(id);
    },
    facilities: availableFacilities,
    selectedFacility,
    isLoading: isLoading || isSelectedFacilityLoading,
    isError,
  };

  return (
    <FacilityContext.Provider value={value}>
      {children}
    </FacilityContext.Provider>
  );
}
