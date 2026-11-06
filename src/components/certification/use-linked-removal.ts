"use client";

import { useEffect, useRef } from "react";
import { useRemovalCarriedEntries } from "@/hooks/use-removal-carried-entries";
import { useToast } from "@/components/ui/toast";
import { useLinkedRecordFacility } from "@/hooks/use-linked-record-facility";
import { linkedRecordReadOnly } from "@/lib/linked-record-read-only";
import { useRemovalPreflightSummaries, useRemovalsForFacility } from "@/hooks/use-certification";
import { useRecordLocks } from "@/hooks/use-record-locks";
import { buildRemovalListRows } from "./removal-list-state";

/**
 * The Removal a `?removal=` link names when it is not on the working facility's
 * list: its facility is looked up, and a link into an archived facility opens
 * that one Removal read only. Shared by the list and the page with no active
 * facility, so both open the same sheet.
 */
export function useLinkedRemoval(
  removalId: string | null,
  lookupEnabled: boolean,
  setRemovalId: (value: null) => unknown,
) {
  const linkedRemoval = useRemovalCarriedEntries(removalId, { enabled: lookupEnabled });
  const linkedRecord = useLinkedRecordFacility(lookupEnabled ? linkedRemoval.data : undefined, linkedRemoval.isLoading);
  // A link into an archived facility never joins the working list (the working facility stays put),
  // so read that facility's own list for the one Removal and open it read only.
  const archivedFacilityId = lookupEnabled && linkedRecord.readOnly ? linkedRemoval.data?.facilityId : undefined;
  const archivedIdentities = useRemovalsForFacility(archivedFacilityId ?? "", !!archivedFacilityId);
  const archivedEntries = (archivedIdentities.data?.removals ?? []).filter((entry) => entry.removal.id === removalId);
  const archivedEnrichment = useRemovalPreflightSummaries(archivedFacilityId ?? "", archivedEntries.map((entry) => entry.removal.id));
  const archivedLocks = useRecordLocks("removal", archivedEntries.map((entry) => entry.removal.id));
  const toast = useToast();
  const invalidRemovalId = useRef<string | null>(null);
  useEffect(() => {
    if (!removalId || !lookupEnabled) {
      invalidRemovalId.current = null;
      return;
    }
    if (invalidRemovalId.current === removalId) return;
    // Dead when the read finished without the Removal. A failed refresh while data is held keeps the sheet.
    const archivedMissing = !!archivedFacilityId && ((archivedIdentities.isError && !archivedIdentities.data) || (!!archivedIdentities.data && archivedEntries.length === 0));
    if (archivedMissing || (!linkedRemoval.data && (linkedRemoval.isError || linkedRemoval.isSuccess))) {
      invalidRemovalId.current = removalId;
      toast.error("Linked Removal could not be opened");
      void setRemovalId(null);
    }
  }, [removalId, lookupEnabled, linkedRemoval.data, linkedRemoval.isError, linkedRemoval.isSuccess, archivedFacilityId, archivedIdentities.isError, archivedIdentities.data, archivedEntries.length, setRemovalId, toast]);

  const archivedRow = archivedFacilityId ? buildRemovalListRows(archivedEntries, archivedEnrichment)[0] : undefined;
  const archivedReadOnly = archivedRow ? linkedRecordReadOnly(linkedRecord, { facilityId: archivedFacilityId }, "Removal") : undefined;
  const archived = archivedRow && archivedReadOnly && archivedFacilityId && archivedIdentities.data
    ? {
        summary: archivedRow,
        facilityId: archivedFacilityId,
        isProduction: archivedIdentities.data.isProduction,
        lock: archivedLocks.locks[archivedRow.removalId],
        readOnly: archivedReadOnly,
        timeZone: linkedRecord.readOnly?.reason === "archived" ? linkedRecord.readOnly.timezone : undefined,
      }
    : undefined;
  return { linkedFacilityReady: linkedRecord.ready, archived };
}
