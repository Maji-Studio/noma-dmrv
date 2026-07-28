/**
 * FacilityProvider
 * Wraps the app to provide a global facility selection context.
 * Uses URL query param + localStorage with fallback-to-first selection.
 */
"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { useFacilities, useFacility } from "@/hooks/use-facilities";
import { useOrganizationDefaults } from "@/hooks/use-organization-settings";
import type { OrganizationDefaultsPayload } from "@/fn/organization-settings";
import { authClient } from "@/lib/auth/client";
import {
  FACILITY_STORAGE_KEY,
  FacilityContext,
  type FacilityContextValue,
} from "@/hooks/use-facility-context";

const EMPTY_FACILITIES: FacilityContextValue["facilities"] = [];

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

export function FacilityProvider({
  children,
  initialOrganizationId = null,
  initialOrganizationDefaults,
}: {
  children: ReactNode;
  /**
   * The organization's operating defaults, resolved server-side in the `(app)`
   * layout. Seeds the React Query cache so create forms can read them
   * synchronously on first render. `undefined` when there is no active org.
   */
  initialOrganizationDefaults?: OrganizationDefaultsPayload;
  /**
   * Active organization resolved on the server in the `(app)` layout. It is
   * authoritative until the client session hydrates, so the facilities query
   * can enable on first mount instead of waiting for `authClient.useSession()`
   * to deliver the active org (which otherwise leaves a window where the URL
   * `?facility=` param resolves to nothing and pages flash the "Select a
   * facility" gate). Membership is still verified server-side on every query.
   */
  initialOrganizationId?: string | null;
}) {
  const { data: sessionData, isPending: isSessionPending } =
    authClient.useSession();
  const clientActiveOrganizationId =
    (sessionData?.session as
      | { activeOrganizationId?: string | null }
      | undefined)?.activeOrganizationId ?? null;
  const activeOrganizationId =
    clientActiveOrganizationId ?? initialOrganizationId;
  // Seed the organization's operating defaults, resolved on the server in the
  // `(app)` layout, into the organization-scoped React Query cache. Every
  // create form reads them for its `defaultValues`, which react-hook-form
  // captures exactly once at mount. Do not seed the server payload under a
  // different organization if the hydrated client session has already moved.
  useOrganizationDefaults(
    activeOrganizationId,
    activeOrganizationId === initialOrganizationId
      ? initialOrganizationDefaults
      : undefined,
  );
  const previousOrganizationIdRef = useRef<string | null>(null);
  const [facilityId, setFacilityId] = useQueryState(
    "facility",
    parseAsString.withOptions({ shallow: true, history: "replace" })
  );

  // Keep within schema limit (max 100) so the sidebar facilities query does not fail.
  const {
    data: facilitiesData,
    isLoading: isFacilitiesLoading,
    isError,
  } = useFacilities({ pageSize: 100 }, activeOrganizationId);
  const isLoading = isSessionPending || isFacilitiesLoading;
  const facilities = facilitiesData?.items ?? EMPTY_FACILITIES;
  const hasFacilityInList = facilityId
    ? facilities.some((facility) => facility.id === facilityId)
    : false;
  const shouldLoadSelectedFacility = Boolean(
    facilityId && !hasFacilityInList && !isLoading
  );
  const {
    data: selectedFacilityById,
    isLoading: isSelectedFacilityLoading,
  } = useFacility(
    facilityId ?? "",
    shouldLoadSelectedFacility,
    activeOrganizationId,
  );
  const selectedFacilityFromLookup =
    selectedFacilityById && selectedFacilityById.archivedAt == null
      ? selectedFacilityById
      : undefined;

  // The URL and localStorage are external facility-selection stores. Drop
  // both as soon as Better Auth reports that the active organization changed.
  useEffect(() => {
    if (!activeOrganizationId) {
      return;
    }

    const previousOrganizationId = previousOrganizationIdRef.current;
    previousOrganizationIdRef.current = activeOrganizationId;
    if (
      previousOrganizationId &&
      previousOrganizationId !== activeOrganizationId
    ) {
      writeStoredFacilityId(null);
      void setFacilityId(null);
    }
  }, [activeOrganizationId, setFacilityId]);

  // Resolve facility selection from URL -> localStorage -> first facility.
  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (facilities.length === 0) {
      // Don't discard a deep-linked `?facility=` while its by-id membership
      // check is still in flight or has resolved it — the facility can belong
      // to this org even when it isn't on the first page of the sidebar list.
      // Stripping it here is what dropped the param on direct navigation (#473).
      if (facilityId && (isSelectedFacilityLoading || selectedFacilityFromLookup)) {
        return;
      }
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
  const resolvedFacilityId = facilityId
    ? hasSelectedFacility
      ? facilityId
      : null
    : facilities[0]?.id ?? null;
  const selectedFacility = resolvedFacilityId
    ? facilities.find((f) => f.id === resolvedFacilityId) ??
      selectedFacilityFromLookup
    : undefined;
  const availableFacilities =
    selectedFacilityFromLookup && !hasFacilityInList
      ? [selectedFacilityFromLookup, ...facilities]
      : facilities;

  // A deep-linked `?facility=` is still being resolved when it isn't yet
  // confirmed against the org (not in the sidebar list and not verified by id)
  // while a query that could confirm it is in flight. During this window the
  // shell shows a loading state instead of the misleading "Select a facility"
  // gate, and never canonicalizes the param away. Fail-closed: once every
  // query settles without confirming membership, this is false and the genuine
  // no-selection gate renders.
  const isResolving = Boolean(
    facilityId &&
      !hasSelectedFacility &&
      (isLoading || isSelectedFacilityLoading)
  );

  const value: FacilityContextValue = {
    activeOrganizationId,
    facilityId: resolvedFacilityId,
    isResolving,
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
