/**
 * Facility Context
 * Provides the globally selected facility to all components via React Context.
 * The selected facility is resolved from URL + local storage with sensible fallbacks.
 */

import { createContext, useContext } from "react";
import type { Facility } from "@/db/schema";

export const FACILITY_STORAGE_KEY = "noma:selected-facility-id";

export interface FacilityContextValue {
  /** Active organization ID that scopes facility and organization-default queries. */
  activeOrganizationId: string | null;
  /** Currently selected facility ID (resolved from URL/local storage/fallback) */
  facilityId: string | null;
  /** Update the selected facility (writes to URL and local storage) */
  setFacilityId: (id: string | null) => void;
  /** All available facilities */
  facilities: Facility[];
  /** The full facility object for the selected ID */
  selectedFacility: Facility | undefined;
  /** Whether the facilities are still loading */
  isLoading: boolean;
  /**
   * Whether a deep-linked `?facility=` from the URL is still being resolved
   * against the active organization. While true the shell should render a
   * loading state rather than the "Select a facility" gate — the selection is
   * pending, not absent. Distinct from {@link isLoading}, which is also true
   * for background facility-list refreshes when a facility is already selected.
   */
  isResolving: boolean;
  /** Whether loading facilities failed */
  isError: boolean;
}

export const FacilityContext = createContext<FacilityContextValue | null>(null);

/**
 * Hook to access the global facility context.
 * Must be used within a FacilityProvider.
 */
export function useFacilityContext(): FacilityContextValue {
  const ctx = useContext(FacilityContext);
  if (!ctx) {
    throw new Error("useFacilityContext must be used within a FacilityProvider");
  }
  return ctx;
}
