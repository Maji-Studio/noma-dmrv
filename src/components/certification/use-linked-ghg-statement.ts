"use client";

import { useEffect } from "react";
import { useGhgStatementState } from "@/hooks/use-certification";
import { useToast } from "@/components/ui/toast";
import { useLinkedRecordFacility } from "@/hooks/use-linked-record-facility";
import { linkedRecordReadOnly } from "@/lib/linked-record-read-only";

/**
 * The GHG Statement a `?statement=` link names when it is not on the working
 * facility's list: the detail read learns its facility, and a link into an
 * archived facility opens read only. Shared by the list and the page with no
 * active facility.
 */
export function useLinkedGhgStatement(
  statementId: string | null,
  lookupEnabled: boolean,
  setStatementId: (value: null) => unknown,
) {
  const linkedStatement = useGhgStatementState(statementId ?? "", lookupEnabled);
  const linkedRecord = useLinkedRecordFacility(lookupEnabled ? linkedStatement.data?.statement : undefined, linkedStatement.isLoading);
  const toast = useToast();
  useEffect(() => {
    // A failed refresh of a statement already shown keeps its sheet; only one that never loaded closes.
    if (lookupEnabled && !linkedStatement.data && (linkedStatement.isError || linkedStatement.isSuccess)) {
      toast.error("Linked GHG Statement could not be opened");
      void setStatementId(null);
    }
  }, [lookupEnabled, linkedStatement.isError, linkedStatement.isSuccess, linkedStatement.data, setStatementId, toast]);
  // A link into an archived facility is not on any list: open it read only from the linked read.
  const linkedState = lookupEnabled && linkedRecord.ready ? linkedStatement.data : undefined;
  const readOnly = linkedRecordReadOnly(linkedRecord, linkedState?.statement, "GHG Statement");
  const timeZone = linkedRecord.readOnly?.reason === "archived" ? linkedRecord.readOnly.timezone : undefined;
  return { linkedFacilityReady: linkedRecord.ready, linkedState, readOnly, timeZone };
}
